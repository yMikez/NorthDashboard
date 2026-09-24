// CRM de afiliados — camada de banco + orquestração.
//
// Reaproveita a carga da Análise de afiliados (loadRaw): a mesma query
// afiliado × dia que alimenta as janelas 3/7/15/30/60 alimenta aqui a
// dormência, o volume semanal e o valor. Uma régua só de "o que é venda"
// nas duas abas — se a Análise diz que ele vendeu ontem, o CRM também.
//
// Entra também o afiliado que existe SÓ no mapeamento do NorthScale
// Afiliados (cadastrado lá, nenhuma venda ainda): é exatamente o público do
// onboarding, e ele não tem linha em Affiliate (que nasce na 1ª venda).
//
// Telefone e tier vêm do que a plataforma de afiliados mandar
// (AffiliateMappingState.phone/tier) e podem ser corrigidos à mão
// (AffiliateCrmProfile) — o manual sempre vence.

import { db } from '../db';
import { logger } from '../logger';
import {
  loadRaw, buildEntities, entityRange, familyTotals, dateAt,
  type RawData, type Entity,
} from './affiliateAnalysis';
import { windowRanges, round2 } from './affiliateAnalysisCore';
import {
  DEFAULT_CRM_CONFIG, buildCrmRow, rowsToCsv, sortForQueue, summarize,
  lastSaleIndex, weeklyBlocks, peakWindow,
  SEGMENT_ORDER, SKIP_TOUCHPOINT,
  type CrmConfigInput, type CrmInput, type CrmRow, type CrmSegment, type CrmSummary, type Tier, type TouchRecord,
} from './affiliateCrmCore';

const DAY_MS = 86_400_000;
/** Semanas de histórico semanal levadas pro núcleo (cobre risco e upgrade). */
const WEEK_BLOCKS = 8;
/** Janela de "produto principal" — família que ele mais vendeu. */
const MAIN_FAMILY_DAYS = 60;
const CONVERSION_WINDOW_DAYS = 7;

// ── config ─────────────────────────────────────────────────────────────

export interface CrmConfigOut extends CrmConfigInput {
  updatedAt: string | null;
}

const num = (v: unknown): number => Number(v);

export async function getCrmConfig(): Promise<CrmConfigOut> {
  const row = await db.crmConfig.findUnique({ where: { id: 'global' } });
  if (!row) return { ...DEFAULT_CRM_CONFIG, updatedAt: null };
  return {
    dormantDays: { BASE: row.dormantDaysBase, ASCENDENTE: row.dormantDaysAscendente, NORTH: row.dormantDaysNorth },
    coldDays: row.coldDays,
    ladderOffsets: row.ladderOffsets.length ? row.ladderOffsets : DEFAULT_CRM_CONFIG.ladderOffsets,
    onboardingOffsets: row.onboardingOffsets.length ? row.onboardingOffsets : DEFAULT_CRM_CONFIG.onboardingOffsets,
    onboardingDays: row.onboardingDays,
    atRiskDropPct: num(row.atRiskDropPct),
    atRiskWeeks: row.atRiskWeeks,
    upgradeWeeks: row.upgradeWeeks,
    upgradeSales: { ASCENDENTE: row.upgradeSalesAscendente, NORTH: row.upgradeSalesNorth },
    tierCpaMin: { ASCENDENTE: num(row.tierCpaAscendenteMin), NORTH: num(row.tierCpaNorthMin) },
    minValueUsd: num(row.minValueUsd),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface CrmConfigPatch {
  dormantDaysBase?: number; dormantDaysAscendente?: number; dormantDaysNorth?: number;
  coldDays?: number; ladderOffsets?: number[]; onboardingOffsets?: number[]; onboardingDays?: number;
  atRiskDropPct?: number; atRiskWeeks?: number; upgradeWeeks?: number;
  upgradeSalesAscendente?: number; upgradeSalesNorth?: number;
  tierCpaAscendenteMin?: number; tierCpaNorthMin?: number; minValueUsd?: number;
}

const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

/** Só aceita número plausível — parâmetro fora de faixa quebra a régua inteira. */
export function sanitizeConfigPatch(patch: CrmConfigPatch): Record<string, number | number[]> {
  const out: Record<string, number | number[]> = {};
  const int = (k: keyof CrmConfigPatch, lo: number, hi: number) => {
    const v = patch[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = clampInt(v, lo, hi);
  };
  const dec = (k: keyof CrmConfigPatch, lo: number, hi: number) => {
    const v = patch[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.min(hi, Math.max(lo, Math.round(v * 100) / 100));
  };
  const list = (k: 'ladderOffsets' | 'onboardingOffsets') => {
    const v = patch[k];
    if (Array.isArray(v) && v.length && v.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      out[k] = [...new Set(v.map((n) => clampInt(n, 0, 365)))].sort((a, b) => a - b);
    }
  };
  int('dormantDaysBase', 1, 120); int('dormantDaysAscendente', 1, 120); int('dormantDaysNorth', 1, 120);
  int('coldDays', 2, 365); int('onboardingDays', 1, 120);
  int('atRiskWeeks', 1, 12); int('upgradeWeeks', 1, 12);
  int('upgradeSalesAscendente', 1, 10_000); int('upgradeSalesNorth', 1, 10_000);
  dec('atRiskDropPct', 1, 99); dec('tierCpaAscendenteMin', 1, 10_000); dec('tierCpaNorthMin', 1, 10_000);
  dec('minValueUsd', 0, 1_000_000);
  list('ladderOffsets'); list('onboardingOffsets');
  return out;
}

export async function saveCrmConfig(patch: CrmConfigPatch): Promise<CrmConfigOut> {
  const data = sanitizeConfigPatch(patch);
  await db.crmConfig.upsert({ where: { id: 'global' }, create: { id: 'global', ...data }, update: data });
  return getCrmConfig();
}

// ── perfil (telefone/tier manuais) ─────────────────────────────────────

export interface ProfilePatch {
  crmKey: string;
  phone?: string | null;
  tier?: Tier | null;
  notes?: string | null;
  optOut?: boolean;
}

export async function saveCrmProfile(patch: ProfilePatch): Promise<void> {
  const data: Record<string, unknown> = {};
  if ('phone' in patch) data.phone = patch.phone?.trim() || null;
  if ('tier' in patch) data.tier = patch.tier ?? null;
  if ('notes' in patch) data.notes = patch.notes?.trim() || null;
  if ('optOut' in patch) data.optOut = !!patch.optOut;
  await db.affiliateCrmProfile.upsert({
    where: { crmKey: patch.crmKey },
    create: { crmKey: patch.crmKey, ...data },
    update: data,
  });
}

// ── toques ─────────────────────────────────────────────────────────────

export interface TouchInput {
  crmKey: string;
  cycleKey: string;
  segment: string;
  touchpoint: string;
  tag?: string | null;
  notes?: string | null;
  origin?: string;
  sentAt?: Date;
  createdBy?: string | null;
}

/** Idempotente por (afiliado, ciclo, toque): registrar duas vezes não duplica. */
export async function recordTouch(t: TouchInput): Promise<void> {
  const sentAt = t.sentAt ?? new Date();
  await db.affiliateCrmTouch.upsert({
    where: { crmKey_cycleKey_touchpoint: { crmKey: t.crmKey, cycleKey: t.cycleKey, touchpoint: t.touchpoint } },
    create: {
      crmKey: t.crmKey, cycleKey: t.cycleKey, segment: t.segment, touchpoint: t.touchpoint,
      tag: t.tag ?? null, notes: t.notes ?? null, origin: t.origin ?? 'manual', sentAt, createdBy: t.createdBy ?? null,
    },
    update: { tag: t.tag ?? null, notes: t.notes ?? null, sentAt },
  });
}

export async function undoTouch(crmKey: string, cycleKey: string, touchpoint: string): Promise<number> {
  const res = await db.affiliateCrmTouch.deleteMany({ where: { crmKey, cycleKey, touchpoint } });
  return res.count;
}

/** Registra vários toques de uma vez (o "marquei a lista inteira como enviada"). */
export async function recordTouchBatch(items: TouchInput[]): Promise<number> {
  let n = 0;
  for (const it of items) {
    await recordTouch(it);
    n++;
  }
  return n;
}

// ── listagem ───────────────────────────────────────────────────────────

export interface CrmListOptions {
  now?: Date;
  segment?: CrmSegment | 'todos' | null;
  tier?: Tier | null;
  pendingOnly?: boolean;
  withPhone?: boolean | null;
  search?: string | null;
  limit?: number | null;
}

export interface CrmListResponse {
  asOf: string;
  anchorDay: string;
  weekKey: string;
  config: CrmConfigOut;
  summary: CrmSummary & { touches30: number; converted30: number; conversionPct: number | null };
  rows: CrmRow[];
  truncated: boolean;
}

/** Semana ISO (YYYY-Www) do dia — âncora dos toques que repetem por semana. */
export function isoWeekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function brtDayString(d: Date): string {
  return new Date(d.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

interface MappingInfo { phone: string | null; tier: string | null; status: string; name: string; createdAt: Date }

function entityMappedId(raw: RawData, e: Entity): string | null {
  const counts = new Map<string, number>();
  for (const id of e.accountIds) {
    const m = raw.affiliates.get(id)?.mappedAffiliateId;
    if (m) counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  let best: string | null = null; let bestN = 0;
  for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
  return best;
}

export async function listAffiliateCrm(opts: CrmListOptions = {}): Promise<CrmListResponse> {
  const now = opts.now ?? new Date();
  const [config, raw] = await Promise.all([
    getCrmConfig(),
    loadRaw({ window: 30, view: 'partner', includeInternal: false, includeContact: true, now, includeToday: true }),
  ]);
  const { entities } = buildEntities(raw, 'partner', false);
  const anchorDay = dateAt(raw, raw.lastIdx);
  const weekKey = isoWeekKey(raw.lastDayStart);

  const [profiles, touches, mappingRows] = await Promise.all([
    db.affiliateCrmProfile.findMany(),
    db.affiliateCrmTouch.findMany({
      where: { sentAt: { gte: new Date(now.getTime() - 365 * DAY_MS) } },
      orderBy: { sentAt: 'asc' },
    }),
    db.affiliateMappingState.findMany({
      where: { removedAt: null },
      select: { affiliateId: true, name: true, status: true, phone: true, tier: true, createdAt: true },
    }),
  ]);

  const profileByKey = new Map(profiles.map((p) => [p.crmKey, p]));
  const touchesByKey = new Map<string, TouchRecord[]>();
  for (const t of touches) {
    const list = touchesByKey.get(t.crmKey) ?? [];
    list.push({ touchpoint: t.touchpoint, cycleKey: t.cycleKey, tag: t.tag, sentAt: t.sentAt.toISOString(), origin: t.origin });
    touchesByKey.set(t.crmKey, list);
  }
  const mappingById = new Map<string, MappingInfo>(
    mappingRows.map((m) => [m.affiliateId, { phone: m.phone, tier: m.tier, status: m.status, name: m.name, createdAt: m.createdAt }]),
  );

  const coverage = { from: 0, to: raw.lastIdx };
  const cur30 = windowRanges(30, raw.lastIdx).cur;
  const famRange = { from: Math.max(0, raw.lastIdx - MAIN_FAMILY_DAYS + 1), to: raw.lastIdx };

  // Ranking de receita dos últimos 7 dias — alimenta o toque "Top 10".
  const week7 = { from: Math.max(0, raw.lastIdx - 6), to: raw.lastIdx };
  const rev7: Array<{ key: string; revenue: number }> = [];

  const inputs: CrmInput[] = [];
  const salesByKey = new Map<string, number[]>();
  const seenMapped = new Set<string>();

  for (const e of entities) {
    const full = entityRange(raw, e, coverage);
    const m30 = entityRange(raw, e, cur30).m;
    const idx = lastSaleIndex(full.sales);
    const mappedId = entityMappedId(raw, e);
    if (mappedId) seenMapped.add(mappedId);
    const mapping = mappedId ? mappingById.get(mappedId) ?? null : null;

    // Dormência: dia da última venda na cobertura; fora dela, o lastOrderAt
    // da conta (afiliado parado há mais de 120 dias ainda precisa aparecer).
    let daysSince: number | null = null;
    let lastSaleDay: string | null = null;
    if (idx != null) {
      daysSince = raw.lastIdx - idx;
      lastSaleDay = dateAt(raw, idx);
    } else {
      const last = e.accountIds
        .map((id) => raw.affiliates.get(id)?.lastOrderAt ?? null)
        .filter((d): d is Date => !!d)
        .sort((a, b) => a.getTime() - b.getTime())
        .pop() ?? null;
      if (last) {
        daysSince = Math.max(0, Math.floor((raw.lastDayStart.getTime() - last.getTime()) / DAY_MS));
        lastSaleDay = brtDayString(last);
      }
    }

    const firstSeen = e.accountIds
      .map((id) => raw.affiliates.get(id)?.firstSeenAt ?? null)
      .filter((d): d is Date => !!d)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

    const fams = familyTotals(raw, e.accountIds, famRange);
    let mainFamily: string | null = null; let bestSales = 0;
    for (const [fam, v] of fams) if (v.sales > bestSales) { mainFamily = fam; bestSales = v.sales; }

    const weekly = weeklyBlocks(full.sales, raw.lastIdx, WEEK_BLOCKS);
    const sales7 = weekly[weekly.length - 1] ?? 0;
    let sales30 = 0;
    for (let d = cur30.from; d <= cur30.to; d++) sales30 += full.sales[d] ?? 0;
    let revenue7 = 0;
    for (let d = week7.from; d <= week7.to; d++) revenue7 += full.daily[d] ?? 0;
    rev7.push({ key: e.key, revenue: revenue7 });

    const profile = profileByKey.get(e.key) ?? null;
    salesByKey.set(e.key, full.sales);
    inputs.push({
      key: e.key,
      name: e.name,
      kind: e.kind,
      platforms: [...new Set(e.accountIds.map((id) => raw.affiliates.get(id)!.slug))],
      mappingStatus: mapping ? (mapping.status === 'inactive' ? 'inactive' : 'active') : null,
      tierManual: (profile?.tier ?? null) as Tier | null,
      tierPlatform: mapping?.tier ?? null,
      phoneManual: profile?.phone ?? null,
      phonePlatform: mapping?.phone ?? null,
      phoneIdentity: e.partner?.phone ?? null,
      optOut: profile?.optOut ?? false,
      daysSinceLastSale: daysSince,
      lastSaleDay,
      daysSinceFirstSeen: firstSeen ? Math.max(0, Math.floor((raw.lastDayStart.getTime() - firstSeen.getTime()) / DAY_MS)) : null,
      firstSeenDay: firstSeen ? brtDayString(firstSeen) : null,
      cpaAtual: m30.cpaPerFe > 0 ? round2(m30.cpaPerFe) : null,
      mainFamily,
      sales7,
      sales30,
      revenue30: round2(m30.revenue),
      netAfterCpa30: m30.netAfterCpaTotal,
      peakRevenue30: peakWindow(full.daily, 30),
      weeklySales: weekly,
      rankTop10: false,
      weekKey,
      touches: touchesByKey.get(e.key) ?? [],
    });
  }

  // Afiliado que só existe no mapeamento (cadastrado e ainda sem venda): é o
  // público do onboarding e não tem linha em Affiliate.
  for (const [affiliateId, m] of mappingById) {
    if (seenMapped.has(affiliateId)) continue;
    const key = `map:${affiliateId}`;
    const profile = profileByKey.get(key) ?? null;
    inputs.push({
      key, name: m.name || affiliateId, kind: 'mapping', platforms: [],
      mappingStatus: m.status === 'inactive' ? 'inactive' : 'active',
      tierManual: (profile?.tier ?? null) as Tier | null,
      tierPlatform: m.tier,
      phoneManual: profile?.phone ?? null,
      phonePlatform: m.phone,
      phoneIdentity: null,
      optOut: profile?.optOut ?? false,
      daysSinceLastSale: null, lastSaleDay: null,
      daysSinceFirstSeen: Math.max(0, Math.floor((raw.lastDayStart.getTime() - m.createdAt.getTime()) / DAY_MS)),
      firstSeenDay: brtDayString(m.createdAt),
      cpaAtual: null, mainFamily: null,
      sales7: 0, sales30: 0, revenue30: 0, netAfterCpa30: null, peakRevenue30: 0,
      weeklySales: new Array(WEEK_BLOCKS).fill(0),
      rankTop10: false, weekKey, touches: touchesByKey.get(key) ?? [],
    });
  }

  const top10 = new Set(rev7.filter((r) => r.revenue > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 10).map((r) => r.key));
  for (const i of inputs) if (top10.has(i.key)) i.rankTop10 = true;

  const allRows = inputs.map((i) => buildCrmRow(i, config));
  const summaryBase = summarize(allRows);
  const conv = conversionStats(touches, salesByKey, raw, now);

  let rows = allRows;
  if (opts.segment && opts.segment !== 'todos') rows = rows.filter((r) => r.segment === opts.segment);
  if (opts.tier) rows = rows.filter((r) => r.tier === opts.tier);
  if (opts.pendingOnly) rows = rows.filter((r) => r.pending);
  if (opts.withPhone === true) rows = rows.filter((r) => !!r.phone);
  if (opts.withPhone === false) rows = rows.filter((r) => !r.phone);
  if (opts.search) {
    const q = opts.search.trim().toLowerCase();
    if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.key.toLowerCase().includes(q));
  }
  rows = sortForQueue(rows);
  const limit = opts.limit && opts.limit > 0 ? opts.limit : 2000;
  const truncated = rows.length > limit;
  if (truncated) rows = rows.slice(0, limit);

  return {
    asOf: now.toISOString(),
    anchorDay,
    weekKey,
    config,
    summary: { ...summaryBase, ...conv },
    rows,
    truncated,
  };
}

/**
 * Mediu o que o playbook não mediu: dos toques dos últimos 30 dias, quantos
 * foram seguidos de venda em até 7 dias. Não prova causa — mostra o sinal.
 */
function conversionStats(
  touches: Array<{ crmKey: string; sentAt: Date; touchpoint: string }>,
  salesByKey: Map<string, number[]>,
  raw: RawData,
  now: Date,
): { touches30: number; converted30: number; conversionPct: number | null } {
  const since = now.getTime() - 30 * DAY_MS;
  let total = 0; let converted = 0;
  for (const t of touches) {
    if (t.sentAt.getTime() < since) continue;
    if (t.touchpoint === SKIP_TOUCHPOINT) continue;
    total++;
    const sales = salesByKey.get(t.crmKey);
    if (!sales) continue;
    const idx = Math.floor((t.sentAt.getTime() - raw.coverageStart.getTime()) / DAY_MS);
    for (let d = Math.max(0, idx); d <= Math.min(raw.lastIdx, idx + CONVERSION_WINDOW_DAYS); d++) {
      if ((sales[d] ?? 0) > 0) { converted++; break; }
    }
  }
  return {
    touches30: total,
    converted30: converted,
    conversionPct: total > 0 ? Math.round((converted / total) * 1000) / 10 : null,
  };
}

// ── leitura de query (compartilhada pelas duas rotas) ──────────────────
// Fica aqui de propósito: route.ts do App Router só pode exportar handlers
// e config — exportar helper dele quebra o build.

const SEGMENTS = new Set<string>(SEGMENT_ORDER);

export function crmOptionsFromQuery(sp: URLSearchParams): CrmListOptions {
  const seg = sp.get('segment');
  const tier = sp.get('tier');
  const phone = sp.get('phone');
  return {
    segment: seg && seg !== 'todos' && SEGMENTS.has(seg) ? (seg as CrmSegment) : null,
    tier: tier === 'BASE' || tier === 'ASCENDENTE' || tier === 'NORTH' ? tier : null,
    pendingOnly: sp.get('pending') === '1',
    withPhone: phone === '1' ? true : phone === '0' ? false : null,
    search: sp.get('q'),
    limit: sp.get('limit') ? Number(sp.get('limit')) : null,
  };
}

// ── export ─────────────────────────────────────────────────────────────

export async function crmCsv(opts: CrmListOptions = {}): Promise<{ csv: string; count: number; anchorDay: string }> {
  const res = await listAffiliateCrm({ ...opts, limit: 10_000 });
  logger.info({ count: res.rows.length, segment: opts.segment ?? 'todos', pendingOnly: !!opts.pendingOnly }, '[crm] export csv');
  return { csv: rowsToCsv(res.rows), count: res.rows.length, anchorDay: res.anchorDay };
}

export { SEGMENT_ORDER };
