// Pull da retenção do SendTrace (P10 → R4 "auditável por pedido").
//
// Eles expõem GET /api/retencao?updated_since=&limit= e o dash PUXA a cada
// 30 min — frequência escolhida por eles (25/09). Mesmo desenho do polling
// da Logicall: marcador incremental em IntegrationSetting, mutex de rodada,
// upsert idempotente por id deles, e UM IngestLog por rodada com o resumo.
//
// Duas decisões que valem explicar:
//
//  1. NÃO vira Order. Retenção é estorno que não aconteceu; contar como
//     venda inflaria faturamento. Fica em RetentionOffer, ligada ao pedido
//     por transactionId == Order.externalId da MESMA plataforma.
//  2. HTTP puro é recusado por padrão. A API deles está na porta 4400 sem
//     TLS; a resposta traz e-mail de cliente e a nossa chave vai no header.
//     Mandar isso em claro tem que ser decisão explícita
//     (setting sendtrace.retention.allowInsecure = '1'), não default.
//
// O item pode chegar ANTES da venda existir no dash (ou de uma plataforma
// que ainda não ingerimos): guardamos com orderId null e resolvemos depois —
// nunca se perde uma retenção por causa de ordem de chegada.

import { db } from '../db';
import { logger } from '../logger';
import { getRetentionConfig, getSetting, setSetting, INTERNAL_SETTING_KEYS } from './integrationSettings';
import { parseRetentionPage, maxSourceUpdatedAt, type RetentionItem } from '../connectors/sendtrace/retention';

export const RETENTION_PAGE_LIMIT = 500;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_PAGES = 20;

export class RetentionNotConfiguredError extends Error {
  constructor(what: string) {
    super(`Retenção (SendTrace): ${what}`);
    this.name = 'RetentionNotConfiguredError';
  }
}
export class RetentionSyncBusyError extends Error {
  constructor() {
    super('Retenção (SendTrace): já existe uma sincronização em andamento');
    this.name = 'RetentionSyncBusyError';
  }
}

export interface RetentionSyncStats {
  since: string | null;
  pages: number;
  items: number;
  created: number;
  updated: number;
  linked: number;        // casaram com um pedido do dash
  unlinked: number;      // ainda sem pedido (chegou antes da venda, ou plataforma não ingerida)
  dropped: number;
  dropReasons: Record<string, number>;
  preservedUsd: number;  // só dos aceitos
  maxUpdatedAt: string | null;
  durationMs: number;
}

let running = false;

/** Monta a URL da página, tolerando base com ou sem o caminho. */
export function retentionUrl(base: string, since: string | null, limit = RETENTION_PAGE_LIMIT): string {
  const clean = base.trim().replace(/\/+$/, '');
  const path = /\/api\/retencao$/i.test(clean) ? clean : `${clean}/api/retencao`;
  const u = new URL(path);
  if (since) u.searchParams.set('updated_since', since);
  u.searchParams.set('limit', String(limit));
  return u.toString();
}

/**
 * Resolve o pedido de cada item: transactionId + plataforma → Order.id.
 * Uma query por rodada (não por item).
 */
async function linkOrders(items: RetentionItem[]): Promise<Map<string, string>> {
  if (!items.length) return new Map();
  const ids = [...new Set(items.map((i) => i.transactionId))];
  const rows = await db.order.findMany({
    where: { externalId: { in: ids } },
    select: { id: true, externalId: true, platform: { select: { slug: true } } },
  });
  const map = new Map<string, string>();
  for (const r of rows) map.set(`${r.platform.slug}|${r.externalId}`, r.id);
  return map;
}

export async function syncRetention(opts: { source?: string; since?: string | null } = {}): Promise<RetentionSyncStats> {
  const cfg = await getRetentionConfig();
  if (!cfg.url) throw new RetentionNotConfiguredError('URL não configurada (setting sendtrace.retention.apiUrl)');
  if (!cfg.apiKey) throw new RetentionNotConfiguredError('chave não configurada (setting sendtrace.retention.apiKey)');
  if (!/^https:\/\//i.test(cfg.url) && !cfg.allowInsecure) {
    throw new RetentionNotConfiguredError(
      'a URL não é HTTPS. A resposta traz e-mail de cliente e a chave vai no header — '
      + "libere explicitamente com o setting sendtrace.retention.allowInsecure = '1' se for intencional",
    );
  }
  if (running) throw new RetentionSyncBusyError();
  running = true;

  const startedAt = Date.now();
  const since = opts.since !== undefined ? opts.since : await getSetting(INTERNAL_SETTING_KEYS.retentionSyncSince);
  const stats: RetentionSyncStats = {
    since: since ?? null, pages: 0, items: 0, created: 0, updated: 0, linked: 0, unlinked: 0,
    dropped: 0, dropReasons: {}, preservedUsd: 0, maxUpdatedAt: null, durationMs: 0,
  };

  const log = await db.ingestLog.create({
    data: {
      source: opts.source ?? 'poll-retencao',
      platformSlug: 'sendtrace',
      eventType: 'retention-sync',
      externalId: since ?? 'full',
      payload: { since: since ?? null },
      signatureOk: null,
    },
    select: { id: true },
  });

  try {
    let cursor: string | null = since ?? null;
    let maxSeen: Date | null = null;

    for (let page = 0; page < MAX_PAGES; page++) {
      const url = retentionUrl(cfg.url, cursor);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let body: unknown;
      try {
        const res = await fetch(url, {
          headers: { 'X-Api-Key': cfg.apiKey, Accept: 'application/json' },
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} em ${url.split('?')[0]}`);
        body = await res.json();
      } finally {
        clearTimeout(timer);
      }

      const parsed = parseRetentionPage(body);
      stats.pages++;
      stats.dropped += parsed.dropped.length;
      for (const d of parsed.dropped) stats.dropReasons[d.reason] = (stats.dropReasons[d.reason] ?? 0) + 1;
      if (!parsed.items.length) break;

      const links = await linkOrders(parsed.items);
      for (const it of parsed.items) {
        const orderId = links.get(`${it.platform}|${it.transactionId}`) ?? null;
        if (orderId) stats.linked++; else stats.unlinked++;
        if (it.status === 'aceito') stats.preservedUsd += it.preservedUsd;

        const data = {
          transactionId: it.transactionId,
          platform: it.platform,
          email: it.email,
          stepOffered: it.stepOffered,
          stepAccepted: it.stepAccepted,
          preservedUsd: it.preservedUsd,
          status: it.status,
          occurredAt: it.occurredAt,
          sourceUpdatedAt: it.sourceUpdatedAt,
          orderId,
          raw: it.raw as object,
        };
        const before = await db.retentionOffer.findUnique({ where: { externalId: it.externalId }, select: { id: true } });
        await db.retentionOffer.upsert({
          where: { externalId: it.externalId },
          create: { externalId: it.externalId, ...data },
          update: data,
        });
        if (before) stats.updated++; else stats.created++;
        stats.items++;
        if (!maxSeen || it.sourceUpdatedAt > maxSeen) maxSeen = it.sourceUpdatedAt;
      }

      // Continuação: o marcador deles vence; senão, o maior atualizado_em da
      // página (inclusivo — o último item volta no próximo pull, é esperado).
      const next = parsed.nextUpdatedSince ?? (maxSourceUpdatedAt(parsed.items)?.toISOString() ?? null);
      if (!next || next === cursor || parsed.items.length < RETENTION_PAGE_LIMIT) { cursor = next ?? cursor; break; }
      cursor = next;
    }

    stats.maxUpdatedAt = maxSeen?.toISOString() ?? null;
    if (stats.maxUpdatedAt) await setSetting(INTERNAL_SETTING_KEYS.retentionSyncSince, stats.maxUpdatedAt);
    stats.durationMs = Date.now() - startedAt;
    await db.ingestLog.update({ where: { id: log.id }, data: { payload: { ...stats } as object, signatureOk: true } });
    logger.info({ ...stats }, '[retentionSync] rodada concluída');
    return stats;
  } catch (err) {
    stats.durationMs = Date.now() - startedAt;
    await db.ingestLog.update({
      where: { id: log.id },
      data: { payload: { ...stats, erro: String(err) } as object, signatureOk: false },
    }).catch(() => {});
    throw err;
  } finally {
    running = false;
  }
}

/**
 * Religa retenções órfãs (chegaram antes da venda). Barato e idempotente —
 * roda junto com o pull.
 */
export async function relinkOrphanRetention(limit = 2000): Promise<number> {
  const orphans = await db.retentionOffer.findMany({
    where: { orderId: null },
    select: { id: true, transactionId: true, platform: true },
    take: limit,
  });
  if (!orphans.length) return 0;
  const rows = await db.order.findMany({
    where: { externalId: { in: [...new Set(orphans.map((o) => o.transactionId))] } },
    select: { id: true, externalId: true, platform: { select: { slug: true } } },
  });
  const map = new Map(rows.map((r) => [`${r.platform.slug}|${r.externalId}`, r.id]));
  let n = 0;
  for (const o of orphans) {
    const orderId = map.get(`${o.platform}|${o.transactionId}`);
    if (!orderId) continue;
    await db.retentionOffer.update({ where: { id: o.id }, data: { orderId } });
    n++;
  }
  if (n) logger.info({ religadas: n }, '[retentionSync] retenções órfãs religadas ao pedido');
  return n;
}
