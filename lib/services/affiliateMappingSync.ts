// Reconciliação do mapeamento (pull) — GET {API}/api/integrations/affiliates/mapping
// do NorthScale Afiliados (contrato §5) — e o scheduler in-process.
//
// Estratégia (§5 "Estratégia recomendada"):
//   1. carga inicial: paginar SEM updated_since até next_cursor == null;
//   2. incremental: updated_since = maior updated_at já visto (inclusivo —
//      o último afiliado da rodada anterior vem de novo, e é esperado);
//   3. upsert idempotente por affiliate_id substituindo o conjunto inteiro
//      (applyAffiliateState — mesma regra "mais recente vence" do webhook);
//   4. carga COMPLETA: afiliado que sumiu do mapping é marcado removedAt
//      (não há evento de exclusão; histórico de vendas fica).
//
// Marcador incremental fica em IntegrationSetting (affiliates.sync.since).
// Uma rodada de cada vez (mutex). Cada rodada grava UM IngestLog
// (platformSlug 'affiliates', eventType 'mapping-sync') com o resumo — é o
// que a UI mostra como "última reconciliação". O scheduler roda a primeira
// rodada 45s após o boot e depois a cada AFFILIATES_SYNC_INTERVAL_MIN
// (padrão 1440 = diário, como pedido); o webhook é o canal de baixa
// latência, a reconciliação é a rede de segurança.

import { db } from '../db';
import { logger } from '../logger';
import {
  getAffiliatesApiUrl, getAffiliatesOutboundKey, getSetting, setSetting, INTERNAL_SETTING_KEYS,
} from './integrationSettings';
import { parseAffiliateState, type Pair } from './affiliateMappingCore';
import { applyAffiliateState, reprocessPairs, backfillAffiliateMapping, type ReprocessStats } from './affiliateMapping';

export const MAPPING_PAGE_LIMIT = 500;
const REQUEST_TIMEOUT_MS = 15_000;

export class AffiliatesNotConfiguredError extends Error {
  constructor() {
    super('NorthScale Afiliados: chave de saída não configurada (INTEGRATION_API_KEY ou setting affiliates.integrationApiKey)');
    this.name = 'AffiliatesNotConfiguredError';
  }
}
export class AffiliatesSyncBusyError extends Error {
  constructor() {
    super('NorthScale Afiliados: já existe uma reconciliação em andamento');
    this.name = 'AffiliatesSyncBusyError';
  }
}

export interface MappingSyncStats {
  mode: 'full' | 'incremental';
  since: string | null;
  pages: number;
  items: number;
  applied: number;
  unchanged: number;
  stale: number;
  invalid: number;
  removed: number;          // só na carga completa
  maxUpdatedAt: string | null;
  reprocess: ReprocessStats | null;
  durationMs: number;
}

interface MappingPage {
  data: unknown[];
  next_cursor: string | null;
}

/** Uma página do mapping. Exportado pra teste/diagnóstico; `fetchImpl` injetável. */
export async function fetchMappingPage(
  params: { apiUrl: string; apiKey: string; updatedSince: string | null; cursor: string | null; limit?: number },
  fetchImpl: typeof fetch = fetch,
): Promise<MappingPage> {
  const url = new URL(`${params.apiUrl}/api/integrations/affiliates/mapping`);
  url.searchParams.set('limit', String(params.limit ?? MAPPING_PAGE_LIMIT));
  if (params.updatedSince) url.searchParams.set('updated_since', params.updatedSince);
  if (params.cursor) url.searchParams.set('cursor', params.cursor);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url.toString(), {
      headers: { Accept: 'application/json', 'X-Api-Key': params.apiKey, 'User-Agent': 'NorthScale-Dashboard/1.0' },
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`mapping HTTP ${res.status}: ${text.slice(0, 300)}`);
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw new Error(`mapping: resposta não é JSON (${text.slice(0, 120)})`); }
    if (!body || typeof body !== 'object' || !Array.isArray((body as MappingPage).data)) {
      throw new Error('mapping: formato inesperado (esperado {data: [], next_cursor})');
    }
    const b = body as MappingPage;
    return { data: b.data, next_cursor: typeof b.next_cursor === 'string' && b.next_cursor ? b.next_cursor : null };
  } finally {
    clearTimeout(timer);
  }
}

let running = false;
export function isAffiliateSyncRunning(): boolean {
  return running;
}

export interface SyncOptions { full?: boolean; source?: string; fetchImpl?: typeof fetch }

export async function syncAffiliateMapping(opts: SyncOptions = {}): Promise<MappingSyncStats> {
  const apiKey = await getAffiliatesOutboundKey();
  if (!apiKey) throw new AffiliatesNotConfiguredError();
  if (running) throw new AffiliatesSyncBusyError();
  running = true;
  // TUDO depois de `running = true` fica sob o finally — uma rejeição em
  // qualquer await (banco fora no boot, por ex.) não pode travar o mutex.
  try {
    return await runSync(opts, apiKey);
  } finally {
    running = false;
  }
}

async function runSync(opts: SyncOptions, apiKey: string): Promise<MappingSyncStats> {
  const t0 = Date.now();
  const apiUrl = await getAffiliatesApiUrl();
  const sinceStored = await getSetting(INTERNAL_SETTING_KEYS.affiliatesSyncSince);
  const full = opts.full || !sinceStored;
  const stats: MappingSyncStats = {
    mode: full ? 'full' : 'incremental', since: full ? null : sinceStored, pages: 0, items: 0,
    applied: 0, unchanged: 0, stale: 0, invalid: 0, removed: 0, maxUpdatedAt: null, reprocess: null, durationMs: 0,
  };
  const log = await db.ingestLog.create({
    data: {
      source: opts.source ?? 'scheduler-affiliates',
      platformSlug: 'affiliates',
      eventType: 'mapping-sync',
      externalId: stats.mode,
      payload: { mode: stats.mode, since: stats.since },
      signatureOk: null,
    },
    select: { id: true },
  });
  try {
    const seen = new Set<string>();
    const touched: Pair[] = [];
    let cursor: string | null = null;
    let maxTs = 0;
    do {
      const page = await fetchMappingPage({ apiUrl, apiKey, updatedSince: stats.since, cursor }, opts.fetchImpl);
      stats.pages++;
      for (const item of page.data) {
        stats.items++;
        const parsed = parseAffiliateState(item);
        if (!parsed.ok) { stats.invalid++; logger.warn({ error: parsed.error }, '[affiliateSync] item inválido no mapping'); continue; }
        seen.add(parsed.state.affiliateId);
        if (parsed.state.occurredAt.getTime() > maxTs) maxTs = parsed.state.occurredAt.getTime();
        const r = await applyAffiliateState(parsed.state, { deferReprocess: true });
        if (r.action === 'apply') { stats.applied++; touched.push(...r.added, ...r.removed, ...r.transferred); }
        else if (r.action === 'unchanged') { stats.unchanged++; touched.push(...parsed.state.platforms); } // replay: reprocessa mesmo assim
        else stats.stale++;
      }
      cursor = page.next_cursor;
    } while (cursor);

    if (full && seen.size > 0) {
      // Sumiu do mapping completo = removido do sistema de afiliados (§5.5).
      // Mapping VAZIO não marca ninguém: é mais provável "ainda não
      // publicado" (state deles vazio até a 1ª reconciliação) do que
      // "todo mundo excluído".
      const res = await db.affiliateMappingState.updateMany({
        where: { removedAt: null, affiliateId: { notIn: [...seen] } },
        data: { removedAt: new Date() },
      });
      stats.removed = res.count;
    }
    // Reprocesso ANTES de avançar o marcador: se falhar, a próxima rodada
    // rebusca os mesmos itens (updated_since inclusivo) e tenta de novo.
    // Carga completa = backfill de TODAS as contas (pega o histórico);
    // incremental = só as contas dos pares que apareceram.
    stats.reprocess = full ? await backfillAffiliateMapping() : await reprocessPairs(dedupePairs(touched));
    if (maxTs > 0) {
      stats.maxUpdatedAt = new Date(maxTs).toISOString();
      const prev = sinceStored ? Date.parse(sinceStored) : 0;
      if (!Number.isFinite(prev) || maxTs >= prev) await setSetting(INTERNAL_SETTING_KEYS.affiliatesSyncSince, stats.maxUpdatedAt);
    } else if (full && !sinceStored) {
      // Mapping vazio na carga inicial: marca "agora" pra próxima rodada ser incremental.
      await setSetting(INTERNAL_SETTING_KEYS.affiliatesSyncSince, new Date(t0).toISOString());
    }
    stats.durationMs = Date.now() - t0;
    await db.ingestLog.update({
      where: { id: log.id },
      data: { processedOk: true, processedAt: new Date(), payload: stats as unknown as object },
    });
    logger.info(stats, '[affiliateSync] reconciliação ok');
    return stats;
  } catch (err) {
    stats.durationMs = Date.now() - t0;
    const message = err instanceof Error ? err.message : String(err);
    await db.ingestLog.update({
      where: { id: log.id },
      data: { processedOk: false, processedAt: new Date(), error: message.slice(0, 500), payload: stats as unknown as object },
    }).catch(() => { /* log é best-effort */ });
    logger.error({ err, stats }, '[affiliateSync] reconciliação falhou');
    throw err;
  }
}

function dedupePairs(pairs: Pair[]): Pair[] {
  const seen = new Set<string>();
  const out: Pair[] = [];
  for (const p of pairs) {
    const k = `${p.platform}:${p.externalId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

export interface AffiliateSyncStatus {
  configured: { outbound: boolean; inbound: boolean; apiUrl: string };
  running: boolean;
  since: string | null;
  lastRunAt: string | null;
  lastOk: boolean | null;
  lastError: string | null;
  lastStats: Partial<MappingSyncStats> | null;
  lastWebhookAt: string | null;
  lastWebhookOk: boolean | null;
  webhooks24h: number;
  scheduler: { enabled: boolean; intervalMin: number };
}

export async function getAffiliateSyncStatus(inboundConfigured: boolean): Promise<AffiliateSyncStatus> {
  const since24h = new Date(Date.now() - 86_400_000);
  const [outKey, apiUrl, since, last, lastWebhook, webhooks24h] = await Promise.all([
    getAffiliatesOutboundKey(),
    getAffiliatesApiUrl(),
    getSetting(INTERNAL_SETTING_KEYS.affiliatesSyncSince),
    db.ingestLog.findFirst({
      where: { platformSlug: 'affiliates', eventType: 'mapping-sync', processedAt: { not: null } },
      orderBy: { receivedAt: 'desc' },
      select: { receivedAt: true, processedOk: true, error: true, payload: true },
    }),
    db.ingestLog.findFirst({
      where: { platformSlug: 'affiliates', eventType: 'affiliate.updated' },
      orderBy: { receivedAt: 'desc' },
      select: { receivedAt: true, processedOk: true },
    }),
    db.ingestLog.count({ where: { platformSlug: 'affiliates', eventType: 'affiliate.updated', receivedAt: { gte: since24h } } }),
  ]);
  return {
    configured: { outbound: Boolean(outKey), inbound: inboundConfigured, apiUrl },
    running,
    since,
    lastRunAt: last?.receivedAt.toISOString() ?? null,
    lastOk: last ? last.processedOk === true : null,
    lastError: last?.error ?? null,
    lastStats: (last?.payload as Partial<MappingSyncStats> | null) ?? null,
    lastWebhookAt: lastWebhook?.receivedAt.toISOString() ?? null,
    lastWebhookOk: lastWebhook ? lastWebhook.processedOk === true : null,
    webhooks24h,
    scheduler: { enabled: schedulerEnabled(), intervalMin: schedulerIntervalMin() },
  };
}

// ---------------------------------------------------------------------
// Scheduler in-process (armado por instrumentation.ts)
// ---------------------------------------------------------------------
const FIRST_RUN_DELAY_MS = 45_000;
const DEFAULT_INTERVAL_MIN = 1440; // diário (pedido do briefing)

export function schedulerEnabled(): boolean {
  if (process.env.NODE_ENV === 'test') return false;
  const raw = process.env.AFFILIATES_SYNC_ENABLED?.trim().toLowerCase();
  return !(raw === '0' || raw === 'false' || raw === 'off');
}
export function schedulerIntervalMin(): number {
  const n = Number(process.env.AFFILIATES_SYNC_INTERVAL_MIN);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_INTERVAL_MIN;
  return Math.max(5, Math.floor(n)); // mínimo 5 min (valores menores sobem pra 5, não caem no diário)
}

let started = false;
// Rodada de boot que falhou (API do parceiro fora, banco ainda subindo) é
// retentada em 5 / 15 / 45 min — sem isso a carga inicial esperaria o
// intervalo diário.
const BOOT_RETRY_MS = [5, 15, 45].map((m) => m * 60_000);

/** true = nada a retentar (ok, não configurado ou já rodando); false = falhou. */
async function tick(source: string): Promise<boolean> {
  try {
    await syncAffiliateMapping({ source });
  } catch (err) {
    if (err instanceof AffiliatesNotConfiguredError || err instanceof AffiliatesSyncBusyError) return true;
    logger.warn({ err }, '[affiliateSync] rodada falhou (tenta de novo no próximo tick)');
    return false;
  }
  // Backfill de todas as contas a cada rodada: barato (só onde difere) e
  // cura qualquer deriva — ex.: reatribuição D24 no boot, reprocesso que
  // falhou numa rodada anterior.
  try {
    await backfillAffiliateMapping();
  } catch (err) {
    logger.warn({ err }, '[affiliateSync] backfill pós-rodada falhou');
  }
  return true;
}

export function startAffiliateMappingScheduler(): void {
  if (started || !schedulerEnabled()) return;
  started = true;
  const intervalMs = schedulerIntervalMin() * 60_000;
  const bootRun = async (attempt: number): Promise<void> => {
    const ok = await tick(attempt === 0 ? 'scheduler-affiliates-boot' : `scheduler-affiliates-boot-retry${attempt}`);
    if (!ok && attempt < BOOT_RETRY_MS.length) {
      const t = setTimeout(() => { void bootRun(attempt + 1); }, BOOT_RETRY_MS[attempt]);
      t.unref?.();
    }
  };
  const first = setTimeout(() => {
    void bootRun(0);
    const every = setInterval(() => { void tick('scheduler-affiliates'); }, intervalMs);
    every.unref?.();
  }, FIRST_RUN_DELAY_MS);
  first.unref?.();
  logger.info({ intervalMin: schedulerIntervalMin() }, '[affiliateSync] scheduler armado');
}
