// Análise de afiliados — camada de banco + orquestração.
//
// UMA query afiliado × dia (BRT) sobre os últimos 121 dias alimenta todas as
// janelas (3/7/15/30/60 dias, cada uma vs a anterior de mesmo tamanho),
// sparklines, séries e o comparativo — sem re-consultar por janela.
// Por padrão as janelas fecham ONTEM (último dia completo): comparar hoje
// parcial com dias cheios viciava todos os Δ e etiquetava todo mundo como
// "queda" de madrugada. `includeToday` liga o dia corrente.
// Visão "partner" soma as contas do mesmo AffiliatePartner (identidade
// unificada); visão "platform" mostra cada conta separada.

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { getProfitModelInputs, type ProfitModelInputs } from './profitModel';
import { effectiveInternal } from './affiliateIdentityCore';
import {
  COVERAGE_DAYS, WINDOWS, windowRanges, sumRange, latestCpaInRange, metricsFor, mergeMetrics,
  pctDelta, trendTag, explainChange, ZERO_BUCKET, round2, round4,
  type WindowDays, type Bucket, type WindowMetrics, type Driver, type TrendTag, type RateInputs, type WindowRange,
} from './affiliateAnalysisCore';

const DAY_MS = 86_400_000;
const BRT_OFFSET_MS = 3 * 3600 * 1000;

/** Meia-noite BRT do dia que contém `d`. */
export function brtDayStart(d: Date): Date {
  const shifted = d.getTime() - BRT_OFFSET_MS;
  return new Date(Math.floor(shifted / DAY_MS) * DAY_MS + BRT_OFFSET_MS);
}
function brtDateStr(d: Date): string {
  return new Date(d.getTime() - BRT_OFFSET_MS).toISOString().slice(0, 10);
}

export interface AnalysisOptions {
  window: WindowDays;
  view: 'partner' | 'platform';
  includeInternal: boolean;
  includeToday?: boolean;
  platformSlugs?: string[];
  families?: string[];
  includeContact: boolean;
  now?: Date;
}

export interface AccountRef {
  id: string;
  platformSlug: string;
  externalId: string;
  nickname: string | null;
  email: string | null; // só com includeContact (admin)
  internal: boolean;
}

export interface WindowCompact {
  days: WindowDays;
  revenue: number; prevRevenue: number;
  sales: number; prevSales: number;
  aov: number; prevAov: number;
  refundRate: number; prevRefundRate: number;
  netAfterCpa: number | null; prevNetAfterCpa: number | null;
  netAfterCpaTotal: number | null; prevNetAfterCpaTotal: number | null;
}

export interface AnalysisRow {
  key: string;
  kind: 'partner' | 'affiliate';
  name: string;
  platforms: string[];
  accounts: AccountRef[];
  contact: { email: string | null; phone: string | null } | null;
  internal: boolean;
  cur: WindowMetrics;
  prev: WindowMetrics;
  delta: { revenue: number | null; sales: number | null; aov: number | null; refundRate: number | null; netAfterCpa: number | null; netAfterCpaTotal: number | null };
  trend: TrendTag;
  topDriver: Driver | null;
  sparkline: number[];
  windows: WindowCompact[];
}

export interface AnalysisWindowTotals {
  days: WindowDays;
  start: string; end: string; prevStart: string; prevEnd: string;
  cur: WindowMetrics;
  prev: WindowMetrics;
  active: number; activePrev: number;
}

export interface AffiliateAnalysisResponse {
  asOf: string;
  todayBrt: string;
  window: WindowDays;
  view: 'partner' | 'platform';
  includeInternal: boolean;
  includeToday: boolean;
  range: { start: string; end: string; prevStart: string; prevEnd: string };
  summary: {
    entities: number; active: number; activePrev: number; newCount: number; churnCount: number;
    concentrationTop10: number; internalExcluded: number; internalRevenueExcluded: number;
  };
  windows: AnalysisWindowTotals[];
  rows: AnalysisRow[];
  daily: Array<Record<string, number | string>>;
  topKeys: Array<{ key: string; name: string }>;
}

export interface AffiliateExplainResponse {
  entity: Pick<AnalysisRow, 'key' | 'kind' | 'name' | 'platforms' | 'accounts' | 'contact' | 'internal'> & { partnerId: string | null; notes: string | null };
  window: WindowDays;
  includeToday: boolean;
  range: { start: string; end: string; prevStart: string; prevEnd: string };
  cur: WindowMetrics;
  prev: WindowMetrics;
  trend: TrendTag;
  drivers: Driver[];
  windows: WindowCompact[];
  daily: Array<{ date: string; atual: number; anterior: number; atualVendas: number; anteriorVendas: number }>;
  byFamily: Array<{ family: string; revenue: number; prevRevenue: number; sales: number; prevSales: number; share: number; prevShare: number }>;
  byAccount: Array<{ account: AccountRef; cur: WindowMetrics; prev: WindowMetrics; trend: TrendTag }>;
}

// ── carga ───────────────────────────────────────────────────────────────

interface AffMeta {
  id: string;
  slug: string;
  externalId: string;
  nickname: string | null;
  email: string | null;
  partnerId: string | null;
  isInternal: boolean | null;
  refundCbPctOverride: number | null;
  partner: { id: string; displayName: string; email: string | null; phone: string | null; notes: string | null } | null;
}

interface RawData {
  coverageStart: Date;
  lastIdx: number;      // último dia das janelas (ontem, ou hoje com includeToday)
  affiliates: Map<string, AffMeta>;
  days: Map<string, Map<number, Bucket>>;              // affiliateId → dayIdx → bucket
  families: Map<string, Map<number, Map<string, { revenue: number; sales: number }>>>; // affiliateId → dayIdx → family
  cpa: Map<string, Map<number, number>>;               // affiliateId → dayIdx → último cpa do dia
  pm: ProfitModelInputs;
}

async function loadRaw(opts: AnalysisOptions, affiliateIds?: string[]): Promise<RawData> {
  const now = opts.now ?? new Date();
  const todayStart = brtDayStart(now);
  const coverageStart = new Date(todayStart.getTime() - (COVERAGE_DAYS - 1) * DAY_MS);
  const end = new Date(todayStart.getTime() + DAY_MS - 1);
  const todayIdx = COVERAGE_DAYS - 1;
  const lastIdx = opts.includeToday ? todayIdx : todayIdx - 1;

  const conds: Prisma.Sql[] = [
    Prisma.sql`o."affiliateId" IS NOT NULL`,
    Prisma.sql`o."orderedAt" >= ${coverageStart}`,
    Prisma.sql`o."orderedAt" <= ${end}`,
  ];
  if (opts.platformSlugs?.length) conds.push(Prisma.sql`pl."slug" IN (${Prisma.join(opts.platformSlugs)})`);
  if (opts.families?.length) conds.push(Prisma.sql`pr."family" IN (${Prisma.join(opts.families)})`);
  if (affiliateIds?.length) conds.push(Prisma.sql`o."affiliateId" IN (${Prisma.join(affiliateIds)})`);
  const where = Prisma.join(conds, ' AND ');
  // Dia BRT relativo ao início da cobertura (coverageStart = meia-noite BRT).
  // Mesma técnica da sparkline em metrics.ts. NUNCA repetir esta expressão
  // em DISTINCT ON + ORDER BY: o Prisma numera cada ${} como parâmetro novo
  // e o Postgres não reconhece as cópias como a mesma expressão.
  const dayIdx = Prisma.sql`FLOOR(EXTRACT(EPOCH FROM (o."orderedAt" - ${coverageStart})) / 86400)::int`;

  const [dayRows, famRows, cpaRows, affRows, pm] = await Promise.all([
    db.$queryRaw<Array<{
      affiliate_id: string; day_idx: number; all_orders: number; approved: number; refunds: number; chargebacks: number;
      revenue: number; net: number; cpa: number; fe_approved: number; fe_all: number; backend_approved: number;
      fe_revenue: number; backend_revenue: number;
    }>>(Prisma.sql`
      SELECT
        o."affiliateId" AS affiliate_id,
        ${dayIdx} AS day_idx,
        COUNT(*)::int AS all_orders,
        COUNT(*) FILTER (WHERE o."status" = 'APPROVED')::int AS approved,
        COUNT(*) FILTER (WHERE o."status" = 'REFUNDED')::int AS refunds,
        COUNT(*) FILTER (WHERE o."status" = 'CHARGEBACK')::int AS chargebacks,
        COALESCE(SUM(o."grossAmountUsd") FILTER (WHERE o."status" = 'APPROVED'), 0)::float8 AS revenue,
        COALESCE(SUM(o."netAmountUsd"), 0)::float8 AS net,
        COALESCE(SUM(o."cpaPaidUsd"), 0)::float8 AS cpa,
        COUNT(*) FILTER (WHERE o."status" = 'APPROVED' AND o."productType" = 'FRONTEND')::int AS fe_approved,
        COUNT(*) FILTER (WHERE o."productType" = 'FRONTEND')::int AS fe_all,
        COUNT(*) FILTER (WHERE o."status" = 'APPROVED' AND o."productType" IN ('UPSELL', 'DOWNSELL', 'BUMP'))::int AS backend_approved,
        COALESCE(SUM(o."grossAmountUsd") FILTER (WHERE o."status" = 'APPROVED' AND o."productType" = 'FRONTEND'), 0)::float8 AS fe_revenue,
        COALESCE(SUM(o."grossAmountUsd") FILTER (WHERE o."status" = 'APPROVED' AND o."productType" <> 'FRONTEND'), 0)::float8 AS backend_revenue
      FROM "Order" o
      JOIN "Platform" pl ON pl.id = o."platformId"
      JOIN "Product" pr ON pr.id = o."productId"
      WHERE ${where}
      GROUP BY 1, 2
    `),
    db.$queryRaw<Array<{ affiliate_id: string; day_idx: number; family: string; revenue: number; sales: number }>>(Prisma.sql`
      SELECT
        o."affiliateId" AS affiliate_id,
        ${dayIdx} AS day_idx,
        COALESCE(pr."family", 'Sem família') AS family,
        COALESCE(SUM(o."grossAmountUsd"), 0)::float8 AS revenue,
        COUNT(*)::int AS sales
      FROM "Order" o
      JOIN "Platform" pl ON pl.id = o."platformId"
      JOIN "Product" pr ON pr.id = o."productId"
      WHERE ${where} AND o."status" = 'APPROVED'
      GROUP BY 1, 2, 3
    `),
    // Último CPA de FE aprovada por (afiliado, dia). A expressão do dia é
    // calculada UMA vez na subquery; o DISTINCT ON/ORDER BY usam o alias.
    db.$queryRaw<Array<{ affiliate_id: string; day_idx: number; cpa: number }>>(Prisma.sql`
      SELECT DISTINCT ON (t.affiliate_id, t.day_idx)
        t.affiliate_id, t.day_idx, t.cpa
      FROM (
        SELECT
          o."affiliateId" AS affiliate_id,
          ${dayIdx} AS day_idx,
          o."cpaPaidUsd"::float8 AS cpa,
          o."orderedAt" AS ordered_at,
          o.id AS order_id
        FROM "Order" o
        JOIN "Platform" pl ON pl.id = o."platformId"
        JOIN "Product" pr ON pr.id = o."productId"
        WHERE ${where} AND o."status" = 'APPROVED' AND o."productType" = 'FRONTEND' AND o."cpaPaidUsd" > 0
      ) t
      ORDER BY t.affiliate_id, t.day_idx, t.ordered_at DESC, t.order_id DESC
    `),
    db.affiliate.findMany({
      where: affiliateIds?.length ? { id: { in: affiliateIds } } : undefined,
      select: {
        id: true, externalId: true, nickname: true, email: true, partnerId: true, isInternal: true,
        refundCbPctOverride: true, platform: { select: { slug: true } },
        partner: { select: { id: true, displayName: true, email: true, phone: true, notes: true } },
      },
    }),
    getProfitModelInputs(),
  ]);

  const affiliates = new Map<string, AffMeta>();
  for (const a of affRows) {
    affiliates.set(a.id, {
      id: a.id, slug: a.platform.slug, externalId: a.externalId, nickname: a.nickname, email: a.email,
      partnerId: a.partnerId, isInternal: a.isInternal,
      refundCbPctOverride: a.refundCbPctOverride != null ? Number(a.refundCbPctOverride) : null,
      partner: a.partner,
    });
  }
  const days = new Map<string, Map<number, Bucket>>();
  for (const r of dayRows) {
    if (r.day_idx < 0 || r.day_idx > todayIdx) continue;
    const m = days.get(r.affiliate_id) ?? new Map<number, Bucket>();
    m.set(r.day_idx, {
      allOrders: r.all_orders, approved: r.approved, refunds: r.refunds, chargebacks: r.chargebacks,
      revenue: r.revenue, net: r.net, cpa: r.cpa, feApproved: r.fe_approved, feAll: r.fe_all,
      backendApproved: r.backend_approved, feRevenue: r.fe_revenue, backendRevenue: r.backend_revenue,
    });
    days.set(r.affiliate_id, m);
  }
  const families = new Map<string, Map<number, Map<string, { revenue: number; sales: number }>>>();
  for (const r of famRows) {
    if (r.day_idx < 0 || r.day_idx > todayIdx) continue;
    const byDay = families.get(r.affiliate_id) ?? new Map();
    const byFam = byDay.get(r.day_idx) ?? new Map<string, { revenue: number; sales: number }>();
    byFam.set(r.family, { revenue: r.revenue, sales: r.sales });
    byDay.set(r.day_idx, byFam);
    families.set(r.affiliate_id, byDay);
  }
  const cpa = new Map<string, Map<number, number>>();
  for (const r of cpaRows) {
    const m = cpa.get(r.affiliate_id) ?? new Map<number, number>();
    m.set(r.day_idx, r.cpa);
    cpa.set(r.affiliate_id, m);
  }
  return { coverageStart, lastIdx, affiliates, days, families, cpa, pm };
}

// ── cálculo por entidade ────────────────────────────────────────────────

interface Entity {
  key: string;
  kind: 'partner' | 'affiliate';
  name: string;
  accountIds: string[];
  partner: AffMeta['partner'];
}

function ratesFor(a: AffMeta, pm: ProfitModelInputs): RateInputs {
  const base = pm.byPlatform.get(a.slug) ?? { feePct: 0, refundCbPct: 0 };
  return {
    slug: a.slug, feePct: base.feePct,
    refundCbPct: a.refundCbPctOverride ?? base.refundCbPct,
    opexPct: pm.opexPct, thresholds: pm.thresholds,
  };
}

function accountMetrics(raw: RawData, a: AffMeta, days: WindowDays): { cur: WindowMetrics; prev: WindowMetrics; dailyCur: number[]; dailyPrev: number[]; salesCur: number[]; salesPrev: number[] } {
  const { cur, prev } = windowRanges(days, raw.lastIdx);
  const dayMap = raw.days.get(a.id) ?? new Map<number, Bucket>();
  const c = sumRange(dayMap, cur);
  const p = sumRange(dayMap, prev);
  const cpaMap = raw.cpa.get(a.id) ?? new Map<number, number>();
  const rates = ratesFor(a, raw.pm);
  const salesOf = (r: WindowRange) => {
    const out: number[] = [];
    for (let d = r.from; d <= r.to; d++) out.push(dayMap.get(d)?.approved ?? 0);
    return out;
  };
  return {
    cur: metricsFor(c.bucket, c.activeDays, days, latestCpaInRange(cpaMap, cur), rates),
    prev: metricsFor(p.bucket, p.activeDays, days, latestCpaInRange(cpaMap, prev), rates),
    dailyCur: c.daily, dailyPrev: p.daily, salesCur: salesOf(cur), salesPrev: salesOf(prev),
  };
}

function familyTotals(raw: RawData, ids: string[], r: WindowRange): Map<string, { revenue: number; sales: number }> {
  const out = new Map<string, { revenue: number; sales: number }>();
  for (const id of ids) {
    const byDay = raw.families.get(id);
    if (!byDay) continue;
    for (let d = r.from; d <= r.to; d++) {
      const byFam = byDay.get(d);
      if (!byFam) continue;
      for (const [fam, v] of byFam) {
        const cur = out.get(fam) ?? { revenue: 0, sales: 0 };
        out.set(fam, { revenue: cur.revenue + v.revenue, sales: cur.sales + v.sales });
      }
    }
  }
  return out;
}

function entityWindow(raw: RawData, e: Entity, days: WindowDays) {
  const parts = e.accountIds.map((id) => accountMetrics(raw, raw.affiliates.get(id)!, days));
  const cur = mergeMetrics(parts.map((p) => p.cur), raw.pm.thresholds);
  const prev = mergeMetrics(parts.map((p) => p.prev), raw.pm.thresholds);
  const len = parts[0]?.dailyCur.length ?? days;
  const sumSeries = (pick: (p: typeof parts[number]) => number[]) => {
    const out = new Array<number>(len).fill(0);
    for (const p of parts) pick(p).forEach((v, i) => { out[i] += v; });
    return out.map(round2);
  };
  return {
    cur, prev,
    dailyCur: sumSeries((p) => p.dailyCur), dailyPrev: sumSeries((p) => p.dailyPrev),
    salesCur: sumSeries((p) => p.salesCur), salesPrev: sumSeries((p) => p.salesPrev),
  };
}

function toRef(a: AffMeta, includeContact: boolean): AccountRef {
  return {
    id: a.id, platformSlug: a.slug, externalId: a.externalId, nickname: a.nickname,
    email: includeContact ? a.email : null, internal: effectiveInternal(a),
  };
}

function buildEntities(raw: RawData, view: 'partner' | 'platform', includeInternal: boolean): { entities: Entity[]; excludedIds: string[] } {
  const all = [...raw.affiliates.values()];
  const kept = includeInternal ? all : all.filter((a) => !effectiveInternal(a));
  const keptIds = new Set(kept.map((a) => a.id));
  const excludedIds = all.filter((a) => !keptIds.has(a.id)).map((a) => a.id);
  const entities: Entity[] = [];
  if (view === 'partner') {
    const byPartner = new Map<string, AffMeta[]>();
    for (const a of kept) {
      if (a.partnerId) byPartner.set(a.partnerId, [...(byPartner.get(a.partnerId) ?? []), a]);
      else entities.push({ key: `aff:${a.id}`, kind: 'affiliate', name: a.nickname?.trim() || a.externalId, accountIds: [a.id], partner: null });
    }
    for (const [pid, list] of byPartner) {
      entities.push({ key: `partner:${pid}`, kind: 'partner', name: list[0].partner?.displayName ?? list[0].nickname ?? pid, accountIds: list.map((a) => a.id), partner: list[0].partner });
    }
  } else {
    for (const a of kept) entities.push({ key: `aff:${a.id}`, kind: 'affiliate', name: a.nickname?.trim() || a.externalId, accountIds: [a.id], partner: a.partner });
  }
  return { entities, excludedIds };
}

function compactWindows(raw: RawData, e: Entity): WindowCompact[] {
  return WINDOWS.map((days) => {
    const w = entityWindow(raw, e, days);
    return {
      days,
      revenue: w.cur.revenue, prevRevenue: w.prev.revenue,
      sales: w.cur.sales, prevSales: w.prev.sales,
      aov: w.cur.aov, prevAov: w.prev.aov,
      refundRate: w.cur.refundRate, prevRefundRate: w.prev.refundRate,
      netAfterCpa: w.cur.netAfterCpa, prevNetAfterCpa: w.prev.netAfterCpa,
      netAfterCpaTotal: w.cur.netAfterCpaTotal, prevNetAfterCpaTotal: w.prev.netAfterCpaTotal,
    };
  });
}

function rangeStrings(raw: RawData, days: WindowDays) {
  const { cur, prev } = windowRanges(days, raw.lastIdx);
  const at = (idx: number) => brtDateStr(new Date(raw.coverageStart.getTime() + idx * DAY_MS));
  return { start: at(cur.from), end: at(cur.to), prevStart: at(prev.from), prevEnd: at(prev.to) };
}

function emptyMetrics(days: WindowDays, pm: ProfitModelInputs): WindowMetrics {
  return metricsFor(ZERO_BUCKET, 0, days, 0, { slug: '', feePct: 0, refundCbPct: 0, opexPct: 0, thresholds: pm.thresholds });
}

function hasActivity(m: WindowMetrics): boolean {
  return m.sales > 0 || m.realOrders > 0 || m.revenue !== 0;
}

// ── API pública ─────────────────────────────────────────────────────────

export async function getAffiliateAnalysis(opts: AnalysisOptions): Promise<AffiliateAnalysisResponse> {
  const raw = await loadRaw(opts);
  const { entities, excludedIds } = buildEntities(raw, opts.view, opts.includeInternal);
  const days = opts.window;
  const { cur: curRange, prev: prevRange } = windowRanges(days, raw.lastIdx);

  const rows: AnalysisRow[] = [];
  for (const e of entities) {
    const w = entityWindow(raw, e, days);
    if (!hasActivity(w.cur) && !hasActivity(w.prev)) continue; // sem atividade nas duas janelas
    const famCur = familyTotals(raw, e.accountIds, curRange);
    const famPrev = familyTotals(raw, e.accountIds, prevRange);
    const toRev = (m: Map<string, { revenue: number }>) => new Map([...m].map(([k, v]) => [k, v.revenue]));
    const drivers = explainChange(w.cur, w.prev, toRev(famCur), toRev(famPrev));
    const accounts = e.accountIds.map((id) => toRef(raw.affiliates.get(id)!, opts.includeContact));
    rows.push({
      key: e.key, kind: e.kind, name: e.name,
      platforms: [...new Set(accounts.map((a) => a.platformSlug))],
      accounts,
      contact: opts.includeContact ? { email: e.partner?.email ?? accounts.find((a) => a.email)?.email ?? null, phone: e.partner?.phone ?? null } : null,
      internal: accounts.every((a) => a.internal),
      cur: w.cur, prev: w.prev,
      delta: {
        revenue: pctDelta(w.cur.revenue, w.prev.revenue),
        sales: pctDelta(w.cur.sales, w.prev.sales),
        aov: pctDelta(w.cur.aov, w.prev.aov),
        refundRate: w.prev.realOrders ? round4(w.cur.refundRate - w.prev.refundRate) : null,
        netAfterCpa: w.cur.netAfterCpa != null && w.prev.netAfterCpa != null ? round2(w.cur.netAfterCpa - w.prev.netAfterCpa) : null,
        netAfterCpaTotal: w.cur.netAfterCpaTotal != null && w.prev.netAfterCpaTotal != null ? round2(w.cur.netAfterCpaTotal - w.prev.netAfterCpaTotal) : null,
      },
      trend: trendTag(w.cur, w.prev, w.dailyCur),
      topDriver: drivers[0] ?? null,
      sparkline: w.dailyCur,
      windows: compactWindows(raw, e),
    });
  }
  rows.sort((a, b) => b.cur.revenue - a.cur.revenue || b.prev.revenue - a.prev.revenue);

  // Totais por janela (soma das entidades visíveis).
  const windows: AnalysisWindowTotals[] = WINDOWS.map((wd) => {
    const per = entities.map((e) => entityWindow(raw, e, wd));
    const cur = per.length ? mergeMetrics(per.map((p) => p.cur), raw.pm.thresholds) : emptyMetrics(wd, raw.pm);
    const prev = per.length ? mergeMetrics(per.map((p) => p.prev), raw.pm.thresholds) : emptyMetrics(wd, raw.pm);
    return {
      days: wd, ...rangeStrings(raw, wd), cur, prev,
      active: per.filter((p) => p.cur.sales > 0).length,
      activePrev: per.filter((p) => p.prev.sales > 0).length,
    };
  });

  // Série diária dos top 8 da janela (por receita) + total.
  const topKeys = rows.slice(0, 8).map((r) => ({ key: r.key, name: r.name }));
  const daily: Array<Record<string, number | string>> = [];
  const totalSeries = new Array<number>(days).fill(0);
  for (const r of rows) r.sparkline.forEach((v, i) => { totalSeries[i] += v; });
  for (let i = 0; i < days; i++) {
    const row: Record<string, number | string> = { date: brtDateStr(new Date(raw.coverageStart.getTime() + (curRange.from + i) * DAY_MS)), total: round2(totalSeries[i]) };
    for (const t of topKeys) row[t.key] = rows.find((r) => r.key === t.key)?.sparkline[i] ?? 0;
    daily.push(row);
  }

  const totalRev = rows.reduce((n, r) => n + r.cur.revenue, 0);
  const top10 = rows.slice(0, 10).reduce((n, r) => n + r.cur.revenue, 0);
  // Internos excluídos: só os que tiveram atividade na janela (e a receita
  // deles), pra transparência — como a nota metodológica do ranking HTML.
  let internalExcluded = 0;
  let internalRevenueExcluded = 0;
  for (const id of excludedIds) {
    const m = raw.days.get(id);
    if (!m) continue;
    let rev = 0;
    let orders = 0;
    for (let d = curRange.from; d <= curRange.to; d++) { rev += m.get(d)?.revenue ?? 0; orders += m.get(d)?.allOrders ?? 0; }
    if (orders > 0) { internalExcluded++; internalRevenueExcluded += rev; }
  }

  return {
    asOf: (opts.now ?? new Date()).toISOString(),
    todayBrt: brtDateStr(opts.now ?? new Date()),
    window: days, view: opts.view, includeInternal: opts.includeInternal, includeToday: !!opts.includeToday,
    range: rangeStrings(raw, days),
    summary: {
      entities: rows.length,
      active: rows.filter((r) => r.cur.sales > 0).length,
      activePrev: rows.filter((r) => r.prev.sales > 0).length,
      newCount: rows.filter((r) => r.trend === 'novo').length,
      churnCount: rows.filter((r) => r.trend === 'churn').length,
      concentrationTop10: totalRev > 0 ? round4(top10 / totalRev) : 0,
      internalExcluded,
      internalRevenueExcluded: round2(internalRevenueExcluded),
    },
    windows,
    rows,
    daily,
    topKeys,
  };
}

/** Resolve a chave de entidade ("partner:<id>" | "aff:<id>") → contas. */
async function resolveEntity(key: string): Promise<{ kind: 'partner' | 'affiliate'; ids: string[]; partnerId: string | null } | null> {
  if (key.startsWith('partner:')) {
    const pid = key.slice('partner:'.length);
    const accounts = await db.affiliate.findMany({ where: { partnerId: pid }, select: { id: true } });
    return accounts.length ? { kind: 'partner', ids: accounts.map((a) => a.id), partnerId: pid } : null;
  }
  if (key.startsWith('aff:')) {
    const id = key.slice('aff:'.length);
    const a = await db.affiliate.findUnique({ where: { id }, select: { id: true, partnerId: true } });
    return a ? { kind: 'affiliate', ids: [a.id], partnerId: a.partnerId } : null;
  }
  return null;
}

export async function getAffiliateExplain(key: string, opts: AnalysisOptions): Promise<AffiliateExplainResponse | null> {
  const resolved = await resolveEntity(key);
  if (!resolved) return null;
  const raw = await loadRaw(opts, resolved.ids);
  let metas = resolved.ids.map((id) => raw.affiliates.get(id)).filter((m): m is AffMeta => !!m);
  // Mesmo recorte do ranking: sem "incluir internos", as contas internas de
  // um parceiro misto ficam de fora (senão o drawer somava mais que a linha).
  if (!opts.includeInternal) {
    const real = metas.filter((m) => !effectiveInternal(m));
    if (real.length) metas = real;
  }
  if (!metas.length) return null;
  const e: Entity = {
    key, kind: resolved.kind,
    name: resolved.kind === 'partner' ? (metas[0].partner?.displayName ?? metas[0].nickname ?? key) : (metas[0].nickname?.trim() || metas[0].externalId),
    accountIds: metas.map((m) => m.id), partner: metas[0].partner,
  };
  const days = opts.window;
  const { cur: curRange, prev: prevRange } = windowRanges(days, raw.lastIdx);
  const w = entityWindow(raw, e, days);
  const famCur = familyTotals(raw, e.accountIds, curRange);
  const famPrev = familyTotals(raw, e.accountIds, prevRange);
  const totalCur = [...famCur.values()].reduce((n, v) => n + v.revenue, 0);
  const totalPrev = [...famPrev.values()].reduce((n, v) => n + v.revenue, 0);
  const byFamily = [...new Set([...famCur.keys(), ...famPrev.keys()])].map((fam) => {
    const c = famCur.get(fam) ?? { revenue: 0, sales: 0 };
    const p = famPrev.get(fam) ?? { revenue: 0, sales: 0 };
    return {
      family: fam, revenue: round2(c.revenue), prevRevenue: round2(p.revenue), sales: c.sales, prevSales: p.sales,
      share: totalCur > 0 ? round4(c.revenue / totalCur) : 0,
      prevShare: totalPrev > 0 ? round4(p.revenue / totalPrev) : 0,
    };
  }).sort((a, b) => b.revenue - a.revenue);
  const toRev = (m: Map<string, { revenue: number }>) => new Map([...m].map(([k, v]) => [k, v.revenue]));
  const accounts = metas.map((m) => toRef(m, opts.includeContact));
  const rs = rangeStrings(raw, days);
  const daily = w.dailyCur.map((v, i) => ({
    date: brtDateStr(new Date(raw.coverageStart.getTime() + (curRange.from + i) * DAY_MS)),
    atual: v, anterior: w.dailyPrev[i] ?? 0, atualVendas: w.salesCur[i] ?? 0, anteriorVendas: w.salesPrev[i] ?? 0,
  }));
  const byAccount = metas.map((m) => {
    const am = accountMetrics(raw, m, days);
    return { account: toRef(m, opts.includeContact), cur: am.cur, prev: am.prev, trend: trendTag(am.cur, am.prev, am.dailyCur) };
  }).sort((a, b) => b.cur.revenue - a.cur.revenue);
  return {
    entity: {
      key, kind: e.kind, name: e.name,
      platforms: [...new Set(accounts.map((a) => a.platformSlug))],
      accounts,
      contact: opts.includeContact ? { email: e.partner?.email ?? accounts.find((a) => a.email)?.email ?? null, phone: e.partner?.phone ?? null } : null,
      internal: accounts.every((a) => a.internal),
      partnerId: resolved.partnerId,
      notes: opts.includeContact ? e.partner?.notes ?? null : null,
    },
    window: days,
    includeToday: !!opts.includeToday,
    range: rs,
    cur: w.cur, prev: w.prev,
    trend: trendTag(w.cur, w.prev, w.dailyCur),
    drivers: explainChange(w.cur, w.prev, toRev(famCur), toRev(famPrev)),
    windows: compactWindows(raw, e),
    daily,
    byFamily,
    byAccount,
  };
}
