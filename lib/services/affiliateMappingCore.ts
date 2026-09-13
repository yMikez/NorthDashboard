// Núcleo PURO da integração com o NorthScale Afiliados (sem DB, sem HTTP).
// Contrato: integration-dashboard.md. Tudo que dá pra testar sem banco
// vive aqui: normalização do external_id, extração dos candidatos por
// plataforma, resolução contra um índice, validação do webhook
// affiliate.updated / item do mapping, decisão de idempotência
// (occurred_at), janelas de período em America/Sao_Paulo e a agregação
// das métricas por afiliado na MESMA régua de líquido/estorno das abas.

import { wallClockToUtc } from '../shared/datetime';
import { EXTRA_ROW_REFUND_PLATFORMS } from './profitModel';

// Plataformas que participam do mapeamento (contrato §4). ClickBank e
// Cartpanda não fazem parte — vendas delas nunca entram na fila.
export const MAPPING_PLATFORMS = ['buygoods', 'digistore24', 'jvzoo'] as const;
export type MappingPlatform = (typeof MAPPING_PLATFORMS)[number];
const MAPPING_PLATFORM_SET = new Set<string>(MAPPING_PLATFORMS);

export function isMappingPlatform(slug: string | null | undefined): slug is MappingPlatform {
  return !!slug && MAPPING_PLATFORM_SET.has(slug);
}

/** Contrato §4: trim + minúsculas; vazio depois do trim não existe. */
export function normalizeExternalId(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  return s ? s : null;
}

// ---------------------------------------------------------------------
// Candidatos por plataforma — o que o payload de venda traz vs. o que o
// sistema de afiliados publica (§4 "De onde vêm os identificadores"):
//   BuyGoods    aff_id (ID por produto) e aff_name (username da conta)
//   Digistore24 affiliate_name (= "Digistore ID" da conta) e affiliate_id
//               (numérico interno) — o dashboard grava o numérico como
//               externalId e o nome como nickname
//   JVZoo       affiliate_id (Affiliate ID numérico) e affiliate_name
// A ordem importa: o PRIMEIRO candidato é o que vai pra fila de não
// mapeados; o resto é fallback.
// ---------------------------------------------------------------------
export interface AccountIdentifiers {
  externalId: string | null | undefined;   // Affiliate.externalId (o que o connector escolheu)
  nickname?: string | null | undefined;    // Affiliate.nickname
}

export function candidateExternalIds(platformSlug: string, ids: AccountIdentifiers): string[] {
  if (!isMappingPlatform(platformSlug)) return [];
  const ext = normalizeExternalId(ids.externalId);
  const nick = normalizeExternalId(ids.nickname);
  const ordered = platformSlug === 'digistore24' ? [nick, ext] : [ext, nick];
  const out: string[] = [];
  for (const c of ordered) {
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

/** Índice (platform, external_id) → affiliate_id. */
export type MappingIndex = ReadonlyMap<string, string>;

export function mappingKey(platform: string, externalId: string): string {
  return `${platform}:${externalId}`;
}

export function buildMappingIndex(rows: Iterable<{ platform: string; externalId: string; affiliateId: string }>): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) m.set(mappingKey(r.platform, r.externalId), r.affiliateId);
  return m;
}

export interface Resolution {
  affiliateId: string | null;
  candidates: string[];        // normalizados, na ordem tentada
  matchedExternalId: string | null;
}

/** Resolve uma conta contra o índice; null quando nenhum candidato existe. */
export function resolveAffiliateId(index: MappingIndex, platformSlug: string, ids: AccountIdentifiers): Resolution {
  const candidates = candidateExternalIds(platformSlug, ids);
  for (const c of candidates) {
    const hit = index.get(mappingKey(platformSlug, c));
    if (hit) return { affiliateId: hit, candidates, matchedExternalId: c };
  }
  return { affiliateId: null, candidates, matchedExternalId: null };
}

// ---------------------------------------------------------------------
// Estado de afiliado (corpo do webhook §6 == item do mapping §5)
// ---------------------------------------------------------------------
export interface AffiliateStateInput {
  affiliateId: string;
  name: string;
  status: 'active' | 'inactive';
  platforms: Array<{ platform: MappingPlatform; externalId: string }>; // normalizados, sem duplicata
  occurredAt: Date;
}

export type ParseResult =
  | { ok: true; state: AffiliateStateInput; dropped: Array<{ platform: string; externalId: string; reason: string }> }
  | { ok: false; error: string };

/**
 * Valida/normaliza o corpo do webhook (ou um item do mapping — `occurred_at`
 * ou `updated_at`). Plataforma fora do contrato (cartpanda…) e external_id
 * vazio são DESCARTADOS (não invalidam o evento). Nunca lança.
 */
export function parseAffiliateState(body: unknown): ParseResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'corpo não é um objeto JSON' };
  const b = body as Record<string, unknown>;
  const affiliateId = typeof b.affiliate_id === 'string' ? b.affiliate_id.trim() : '';
  if (!affiliateId) return { ok: false, error: 'affiliate_id ausente' };
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  const statusRaw = typeof b.status === 'string' ? b.status.trim().toLowerCase() : '';
  if (statusRaw !== 'active' && statusRaw !== 'inactive') return { ok: false, error: `status inválido: ${String(b.status)}` };
  const tsRaw = b.occurred_at ?? b.updated_at;
  const occurredAt = typeof tsRaw === 'string' || typeof tsRaw === 'number' ? new Date(tsRaw) : null;
  if (!occurredAt || Number.isNaN(occurredAt.getTime())) return { ok: false, error: 'occurred_at/updated_at inválido' };
  if (b.platforms != null && !Array.isArray(b.platforms)) return { ok: false, error: 'platforms deve ser uma lista' };
  const seen = new Set<string>();
  const platforms: AffiliateStateInput['platforms'] = [];
  const dropped: Array<{ platform: string; externalId: string; reason: string }> = [];
  for (const item of (b.platforms as unknown[] | undefined) ?? []) {
    if (!item || typeof item !== 'object') { dropped.push({ platform: '?', externalId: '?', reason: 'item inválido' }); continue; }
    const it = item as Record<string, unknown>;
    const platform = typeof it.platform === 'string' ? it.platform.trim().toLowerCase() : '';
    const externalId = normalizeExternalId(it.external_id);
    if (!isMappingPlatform(platform)) { dropped.push({ platform, externalId: externalId ?? '', reason: 'plataforma fora do contrato' }); continue; }
    if (!externalId) { dropped.push({ platform, externalId: '', reason: 'external_id vazio' }); continue; }
    const key = mappingKey(platform, externalId);
    if (seen.has(key)) continue;
    seen.add(key);
    platforms.push({ platform, externalId });
  }
  // Ordem estável (contrato §4): plataforma, depois external_id.
  platforms.sort((a, b2) => (a.platform === b2.platform ? a.externalId.localeCompare(b2.externalId) : a.platform.localeCompare(b2.platform)));
  return { ok: true, state: { affiliateId, name: name || affiliateId, status: statusRaw, platforms, occurredAt }, dropped };
}

export interface Pair { platform: string; externalId: string }

export interface StatePlan {
  // 'stale' = occurred_at menor que o já aplicado → ignorar (responder 2xx).
  // 'unchanged' = mesmo occurred_at e mesmo conjunto → nada a fazer.
  // 'apply' = gravar substituindo o conjunto inteiro.
  action: 'stale' | 'unchanged' | 'apply';
  added: Pair[];
  removed: Pair[];
}

/** Decide o que fazer com um estado recebido, dado o que já está gravado. */
export function planStateChange(
  current: { occurredAt: Date; name: string; status: string; platforms: Pair[] } | null,
  incoming: AffiliateStateInput,
): StatePlan {
  if (current && current.occurredAt.getTime() > incoming.occurredAt.getTime()) {
    return { action: 'stale', added: [], removed: [] };
  }
  // occurred_at IGUAL = o MESMO estado na fonte (§6: corpo diferente sempre
  // vem com occurred_at maior). Nunca reaplica o conjunto: se um par saiu
  // daqui por TRANSFERÊNCIA pra outro afiliado, um replay atrasado deste
  // não pode roubá-lo de volta. Quem chama reprocessa os pares atuais.
  if (current && current.occurredAt.getTime() === incoming.occurredAt.getTime()) {
    return { action: 'unchanged', added: [], removed: [] };
  }
  const curKeys = new Set((current?.platforms ?? []).map((p) => mappingKey(p.platform, p.externalId)));
  const newKeys = new Set(incoming.platforms.map((p) => mappingKey(p.platform, p.externalId)));
  const added = incoming.platforms.filter((p) => !curKeys.has(mappingKey(p.platform, p.externalId)));
  const removed = (current?.platforms ?? []).filter((p) => !newKeys.has(mappingKey(p.platform, p.externalId)));
  return { action: 'apply', added, removed };
}

// ---------------------------------------------------------------------
// Período do GET …/metrics (§7). "Dia" = America/Sao_Paulo.
// ---------------------------------------------------------------------
export type MetricsPeriod = '7d' | '30d' | 'mtd' | 'custom';
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const CUSTOM_MAX_DAYS = 366;

export function isValidYmd(s: string): boolean {
  const m = s.match(YMD_RE);
  if (!m) return false;
  const [, y, mo, d] = m.map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Data civil (AAAA-MM-DD) de um instante em America/Sao_Paulo. */
export function brtYmd(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(at);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}

function brtMidnight(ymd: string): Date {
  const d = wallClockToUtc(`${ymd} 00:00:00`, 'America/Sao_Paulo');
  if (!d) throw new Error(`data inválida: ${ymd}`);
  return d;
}
function brtEndOfDay(ymd: string): Date {
  const d = wallClockToUtc(`${ymd} 23:59:59`, 'America/Sao_Paulo');
  if (!d) throw new Error(`data inválida: ${ymd}`);
  return new Date(d.getTime() + 999);
}
function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export type PeriodResult =
  | { ok: true; period: MetricsPeriod; start: Date; end: Date; from: string; to: string }
  | { ok: false; error: string };

/**
 * 7d/30d = janela móvel incluindo o dia corrente (hoje e os N−1 anteriores,
 * em BRT) até AGORA; mtd = dia 1 do mês corrente até agora; custom =
 * from..to inclusivos, dias inteiros, ≤ 366 dias.
 */
export function resolvePeriod(period: string | null, from: string | null, to: string | null, now = new Date()): PeriodResult {
  const today = brtYmd(now);
  switch (period) {
    case '7d':
    case '30d': {
      const days = period === '7d' ? 7 : 30;
      const fromYmd = addDaysYmd(today, -(days - 1));
      return { ok: true, period, start: brtMidnight(fromYmd), end: now, from: fromYmd, to: today };
    }
    case 'mtd': {
      const fromYmd = `${today.slice(0, 7)}-01`;
      return { ok: true, period, start: brtMidnight(fromYmd), end: now, from: fromYmd, to: today };
    }
    case 'custom': {
      if (!from || !to) return { ok: false, error: 'period=custom exige from e to (AAAA-MM-DD)' };
      if (!isValidYmd(from)) return { ok: false, error: 'from deve ser uma data AAAA-MM-DD válida' };
      if (!isValidYmd(to)) return { ok: false, error: 'to deve ser uma data AAAA-MM-DD válida' };
      if (from > to) return { ok: false, error: 'from deve ser anterior ou igual a to' };
      const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
      if (span > CUSTOM_MAX_DAYS) return { ok: false, error: `intervalo custom limitado a ${CUSTOM_MAX_DAYS} dias` };
      return { ok: true, period, start: brtMidnight(from), end: brtEndOfDay(to), from, to };
    }
    default:
      return { ok: false, error: 'period deve ser 7d, 30d, mtd ou custom' };
  }
}

// ---------------------------------------------------------------------
// Métricas por afiliado (§7) — MESMA régua das abas do dashboard:
//   gross_sales  = faturado no período por data da VENDA (orderedAt):
//                  vendas aprovadas + (plataformas in-place) vendas que
//                  depois foram estornadas, pelo valor ORIGINAL da venda
//                  (originalGrossUsd) — é o "Receita bruta" do overview,
//                  que não abate estorno. Na Digistore (linha extra) a
//                  venda original segue APPROVED, então só APPROVED conta.
//   refunds      = |$ devolvido| por data do ESTORNO (refundedAt /
//                  chargebackAt) dentro do período — a lente de EVENTO
//                  dos cards de reembolso da Visão Geral (2026-08-11).
//                  Inclui chargeback (dinheiro que voltou é dinheiro que
//                  voltou; a taxa por pedidos idem).
//   net_sales    = gross_sales − refunds (o "líquido de estorno").
//   orders_count = pedidos REAIS do período (mesmo realOrderCount das
//                  taxas por afiliado: APPROVED + estornadas in-place;
//                  linhas sintéticas da Digistore fora; PENDING/CANCELED
//                  não são pedidos).
//   refund_rate  = (refunds + chargebacks, por evento) ÷ orders_count × 100
//                  — percentual 0–100, como o contrato pede.
// ---------------------------------------------------------------------
export interface AffiliateAggRow {
  affiliateId: string;
  platformSlug: string;
  approvedGross: number;          // Σ gross APPROVED (orderedAt no período)
  approvedCount: number;
  refundedRowsCount: number;      // linhas REFUNDED com orderedAt no período
  chargebackRowsCount: number;    // linhas CHARGEBACK com orderedAt no período
  refundedRowsOriginalGross: number;   // Σ originalGrossUsd>0 dessas linhas (in-place: valor da venda)
  chargebackRowsOriginalGross: number;
  refundEventsUsd: number;        // Σ |gross| REFUNDED por refundedAt no período
  refundEventsCount: number;
  chargebackEventsUsd: number;    // Σ |gross| CHARGEBACK por chargebackAt no período
  chargebackEventsCount: number;
}

export interface AffiliateMetricsOut {
  affiliate_id: string;
  gross_sales: number;
  refunds: number;
  net_sales: number;
  orders_count: number;
  refund_rate: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function aggregateAffiliateMetrics(rows: AffiliateAggRow[]): AffiliateMetricsOut[] {
  const acc = new Map<string, { gross: number; refunds: number; orders: number; badEvents: number }>();
  for (const r of rows) {
    const extraRow = EXTRA_ROW_REFUND_PLATFORMS.has(r.platformSlug);
    let a = acc.get(r.affiliateId);
    if (!a) { a = { gross: 0, refunds: 0, orders: 0, badEvents: 0 }; acc.set(r.affiliateId, a); }
    // Faturado: aprovadas + (in-place) vendas depois estornadas, pelo valor
    // original. Na Digistore as linhas REFUNDED/CHARGEBACK são sintéticas.
    a.gross += r.approvedGross + (extraRow ? 0 : r.refundedRowsOriginalGross + r.chargebackRowsOriginalGross);
    a.orders += r.approvedCount + (extraRow ? 0 : r.refundedRowsCount + r.chargebackRowsCount);
    a.refunds += r.refundEventsUsd + r.chargebackEventsUsd;
    a.badEvents += r.refundEventsCount + r.chargebackEventsCount;
  }
  const out: AffiliateMetricsOut[] = [];
  for (const [affiliateId, a] of acc) {
    const gross = r2(a.gross);
    const refunds = r2(a.refunds);
    out.push({
      affiliate_id: affiliateId,
      gross_sales: gross,
      refunds,
      net_sales: r2(gross - refunds),
      orders_count: a.orders,
      refund_rate: a.orders > 0 ? r2((a.badEvents / a.orders) * 100) : 0,
    });
  }
  out.sort((x, y) => y.net_sales - x.net_sales || x.affiliate_id.localeCompare(y.affiliate_id));
  return out;
}

// ---------------------------------------------------------------------
// Chave entre sistemas (§2): comparação em tempo constante via sha256.
// ---------------------------------------------------------------------
export function pickFirstHeader(raw: string | null | undefined): string {
  if (!raw) return '';
  // Header repetido chega como "a, b" — usa o primeiro (como o ApiKeyGuard).
  return raw.split(',')[0].trim();
}

// ---------------------------------------------------------------------
// Fila de não mapeados — o que gravar quando a resolução falha.
// ---------------------------------------------------------------------
export interface UnmappedEntry {
  platform: string;
  externalId: string;      // primeiro candidato (o que o sistema de afiliados deveria ter)
  altExternalId: string | null;
}

export function unmappedEntryFor(platformSlug: string, ids: AccountIdentifiers): UnmappedEntry | null {
  const cands = candidateExternalIds(platformSlug, ids);
  if (cands.length === 0) return null;
  return { platform: platformSlug, externalId: cands[0], altExternalId: cands[1] ?? null };
}
