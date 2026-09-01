// Análise de afiliados — camada de banco + orquestração.
//
// UMA query afiliado × dia (BRT) sobre a cobertura necessária alimenta todas
// as janelas (presets 3/7/15/30/60 + personalizada 1..90, cada uma vs a
// anterior de mesmo tamanho), sparklines, séries, o comparativo e a
// SEQUÊNCIA (Janela 1..K) — sem re-consultar por janela.
// A última janela termina em `anchor` (data escolhida) ou ONTEM (último dia
// completo); `includeToday` liga o dia corrente quando não há âncora.
// Visão "partner" soma as contas do mesmo AffiliatePartner (identidade
// unificada); visão "platform" mostra cada conta separada.

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { getProfitModelInputs, type ProfitModelInputs } from './profitModel';
import { effectiveInternal, suggestLinks, type IdentityAffiliate } from './affiliateIdentityCore';
import {
  COVERAGE_DAYS, WINDOWS, windowRanges, sumRange, latestCpaInRange, metricsFor, mergeMetrics,
  pctDelta, trendTag, explainChange, ZERO_BUCKET, round2, round4,
  type WindowDays, type Bucket, type WindowMetrics, type Driver, type TrendTag, type RateInputs, type WindowRange,
} from './affiliateAnalysisCore';
import {
  sequenceRanges, narrateEntity, transitionBetween, healthNote, riskText, reactivationList,
  type EntitySeries, type SeqTag, type Transition, type HealthNote, type ReactivationEntry, type WindowTotals,
} from './affiliateSequenceCore';

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
function parseBrtDay(ymd: string): Date | null {
  const t = Date.parse(ymd + 'T00:00:00Z');
  return Number.isNaN(t) ? null : new Date(t + BRT_OFFSET_MS);
}

export interface AnalysisOptions {
  window: WindowDays;
  view: 'partner' | 'platform';
  includeInternal: boolean;
  includeToday?: boolean;
  /** YYYY-MM-DD: último dia da janela atual (janela personalizada). */
  anchor?: string;
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
  origin: { type: string; ref: string | null } | null;
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
  anchor: string; // último dia da janela atual (YYYY-MM-DD BRT)
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
  entity: Pick<AnalysisRow, 'key' | 'kind' | 'name' | 'platforms' | 'accounts' | 'contact' | 'origin' | 'internal'> & { partnerId: string | null; notes: string | null };
  window: WindowDays;
  anchor: string;
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
  partner: { id: string; displayName: string; email: string | null; phone: string | null; notes: string | null; originType: string | null; originRef: string | null } | null;
}

function originOf(p: AffMeta['partner']): { type: string; ref: string | null } | null {
  return p?.originType ? { type: p.originType, ref: p.originRef } : null;
}

interface RawData {
  coverageStart: Date;
  lastIdx: number;      // último dia das janelas (âncora, ontem, ou hoje com includeToday)
  lastDayStart: Date;
  affiliates: Map<string, AffMeta>;
  days: Map<string, Map<number, Bucket>>;              // affiliateId → dayIdx → bucket
  families: Map<string, Map<number, Map<string, { revenue: number; sales: number }>>>; // affiliateId → dayIdx → family
  cpa: Map<string, Map<number, number>>;               // affiliateId → dayIdx → último cpa do dia
  pm: ProfitModelInputs;
}

/** Último dia das janelas: âncora (nunca no futuro), senão ontem/hoje. */
function resolveLastDay(opts: AnalysisOptions): Date {
  const now = opts.now ?? new Date();
  const todayStart = brtDayStart(now);
  if (opts.anchor) {
    const a = parseBrtDay(opts.anchor);
    if (a && a.getTime() <= todayStart.getTime()) return a;
  }
  return opts.includeToday ? todayStart : new Date(todayStart.getTime() - DAY_MS);
}

async function loadRaw(opts: AnalysisOptions, affiliateIds?: string[], coverageDays = COVERAGE_DAYS): Promise<RawData> {
  const lastDayStart = resolveLastDay(opts);
  const days = Math.max(coverageDays, 2 * opts.window, COVERAGE_DAYS);
  const coverageStart = new Date(lastDayStart.getTime() - (days - 1) * DAY_MS);
  const end = new Date(lastDayStart.getTime() + DAY_MS - 1);
  const lastIdx = days - 1;

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
        partner: { select: { id: true, displayName: true, email: true, phone: true, notes: true, originType: true, originRef: true } },
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
  const dayMaps = new Map<string, Map<number, Bucket>>();
  for (const r of dayRows) {
    if (r.day_idx < 0 || r.day_idx > lastIdx) continue;
    const m = dayMaps.get(r.affiliate_id) ?? new Map<number, Bucket>();
    m.set(r.day_idx, {
      allOrders: r.all_orders, approved: r.approved, refunds: r.refunds, chargebacks: r.chargebacks,
      revenue: r.revenue, net: r.net, cpa: r.cpa, feApproved: r.fe_approved, feAll: r.fe_all,
      backendApproved: r.backend_approved, feRevenue: r.fe_revenue, backendRevenue: r.backend_revenue,
    });
    dayMaps.set(r.affiliate_id, m);
  }
  const families = new Map<string, Map<number, Map<string, { revenue: number; sales: number }>>>();
  for (const r of famRows) {
    if (r.day_idx < 0 || r.day_idx > lastIdx) continue;
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
  return { coverageStart, lastIdx, lastDayStart, affiliates, days: dayMaps, families, cpa, pm };
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

/** Métricas de UMA conta num intervalo arbitrário (+ série diária). */
function accountRange(raw: RawData, a: AffMeta, r: WindowRange): { m: WindowMetrics; daily: number[]; sales: number[] } {
  const dayMap = raw.days.get(a.id) ?? new Map<number, Bucket>();
  const s = sumRange(dayMap, r);
  const cpaMap = raw.cpa.get(a.id) ?? new Map<number, number>();
  const sales: number[] = [];
  for (let d = r.from; d <= r.to; d++) sales.push(dayMap.get(d)?.approved ?? 0);
  const days = r.to - r.from + 1;
  return { m: metricsFor(s.bucket, s.activeDays, days, latestCpaInRange(cpaMap, r), ratesFor(a, raw.pm)), daily: s.daily, sales };
}

function entityRange(raw: RawData, e: Entity, r: WindowRange): { m: WindowMetrics; daily: number[]; sales: number[] } {
  const parts = e.accountIds.map((id) => accountRange(raw, raw.affiliates.get(id)!, r));
  const len = r.to - r.from + 1;
  const sumSeries = (pick: (p: typeof parts[number]) => number[]) => {
    const out = new Array<number>(len).fill(0);
    for (const p of parts) pick(p).forEach((v, i) => { out[i] += v; });
    return out.map(round2);
  };
  return { m: mergeMetrics(parts.map((p) => p.m), raw.pm.thresholds), daily: sumSeries((p) => p.daily), sales: sumSeries((p) => p.sales) };
}

function accountMetrics(raw: RawData, a: AffMeta, days: WindowDays) {
  const { cur, prev } = windowRanges(days, raw.lastIdx);
  const c = accountRange(raw, a, cur);
  const p = accountRange(raw, a, prev);
  return { cur: c.m, prev: p.m, dailyCur: c.daily, dailyPrev: p.daily, salesCur: c.sales, salesPrev: p.sales };
}

function entityWindow(raw: RawData, e: Entity, days: WindowDays) {
  const { cur, prev } = windowRanges(days, raw.lastIdx);
  const c = entityRange(raw, e, cur);
  const p = entityRange(raw, e, prev);
  return { cur: c.m, prev: p.m, dailyCur: c.daily, dailyPrev: p.daily, salesCur: c.sales, salesPrev: p.sales };
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

function windowList(custom: WindowDays): WindowDays[] {
  return [...new Set<number>([...WINDOWS, custom])].sort((a, b) => a - b);
}

function compactWindows(raw: RawData, e: Entity, custom: WindowDays): WindowCompact[] {
  return windowList(custom).map((days) => {
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

function dateAt(raw: RawData, idx: number): string {
  return brtDateStr(new Date(raw.coverageStart.getTime() + idx * DAY_MS));
}

function rangeStrings(raw: RawData, days: WindowDays) {
  const { cur, prev } = windowRanges(days, raw.lastIdx);
  return { start: dateAt(raw, cur.from), end: dateAt(raw, cur.to), prevStart: dateAt(raw, prev.from), prevEnd: dateAt(raw, prev.to) };
}

function emptyMetrics(days: WindowDays, pm: ProfitModelInputs): WindowMetrics {
  return metricsFor(ZERO_BUCKET, 0, days, 0, { slug: '', feePct: 0, refundCbPct: 0, opexPct: 0, thresholds: pm.thresholds });
}

function hasActivity(m: WindowMetrics): boolean {
  return m.sales > 0 || m.realOrders > 0 || m.revenue !== 0;
}

function entityPlatforms(raw: RawData, e: Entity): string[] {
  return [...new Set(e.accountIds.map((id) => raw.affiliates.get(id)!.slug))];
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
      origin: originOf(e.partner),
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
      windows: compactWindows(raw, e, days),
    });
  }
  rows.sort((a, b) => b.cur.revenue - a.cur.revenue || b.prev.revenue - a.prev.revenue);

  // Totais por janela (soma das entidades visíveis).
  const windows: AnalysisWindowTotals[] = windowList(days).map((wd) => {
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
    const row: Record<string, number | string> = { date: dateAt(raw, curRange.from + i), total: round2(totalSeries[i]) };
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
    window: days, anchor: brtDateStr(raw.lastDayStart), view: opts.view, includeInternal: opts.includeInternal, includeToday: !opts.anchor && !!opts.includeToday,
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
    date: dateAt(raw, curRange.from + i),
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
      origin: originOf(e.partner),
      internal: accounts.every((a) => a.internal),
      partnerId: resolved.partnerId,
      notes: opts.includeContact ? e.partner?.notes ?? null : null,
    },
    window: days,
    anchor: brtDateStr(raw.lastDayStart),
    includeToday: !opts.anchor && !!opts.includeToday,
    range: rs,
    cur: w.cur, prev: w.prev,
    trend: trendTag(w.cur, w.prev, w.dailyCur),
    drivers: explainChange(w.cur, w.prev, toRev(famCur), toRev(famPrev)),
    windows: compactWindows(raw, e, days),
    daily,
    byFamily,
    byAccount,
  };
}

// ── SEQUÊNCIA de janelas (Janela 1..K) — evolução, saúde, reativação ────

export interface SequenceOptions extends AnalysisOptions { count: number }

export interface SequenceWindowRow { key: string; name: string; kind: 'partner' | 'affiliate'; platforms: string[]; rank: number; m: WindowMetrics }

export interface SequenceWindow {
  index: number;
  label: string;
  start: string;
  end: string;
  totals: WindowMetrics;
  active: number;
  concentrationTop10: number;
  topShare2: number;
  internalExcluded: number;
  internalRevenueExcluded: number;
  rows: SequenceWindowRow[]; // todas as entidades com atividade, por receita
}

export interface EvolutionPoint {
  revenue: number; sales: number; feApproved: number; aov: number; approvalRate: number; refundRate: number;
  cpaPerFe: number; netAfterCpa: number | null; netAfterCpaTotal: number | null; cpaStatus: WindowMetrics['cpaStatus']; rank: number | null;
}

export interface EvolutionEntry {
  key: string; name: string; kind: 'partner' | 'affiliate'; platforms: string[];
  tag: SeqTag; title: string; text: string;
  deltas: Array<number | null>;
  per: Array<EvolutionPoint | null>;
  bestRank: number | null;
  migrationHint: { otherKey: string; otherName: string } | null;
}

export interface SlowingEntry {
  key: string; name: string; kind: 'partner' | 'affiliate'; platforms: string[];
  state: 'parou' | 'caindo';
  peakRevenue: number; peakIndex: number; peakSales: number;
  lastRevenue: number; lastSales: number; lastActiveIndex: number;
  dropPct: number; // vs pico (negativo)
  revenue: Array<number | null>;
}

export interface NewAffiliateEntry {
  key: string;               // partner:<id> | aff:<id> — abre o "por quê"
  name: string;
  kind: 'partner' | 'affiliate';
  platforms: string[];
  firstSaleAt: string;       // ISO da 1ª venda FE aprovada (EVER)
  firstSaleDay: string;      // YYYY-MM-DD (BRT)
  sales: number;             // FEs aprovadas nos 7 dias
  revenue: number;           // gross aprovado (com backend) nos 7 dias
}

export interface AffiliateSequenceResponse {
  asOf: string;
  window: WindowDays;
  count: number;
  anchor: string;
  view: 'partner' | 'platform';
  includeInternal: boolean;
  windows: SequenceWindow[];
  transitions: Transition[];
  evolution: EvolutionEntry[];
  reactivation: Array<ReactivationEntry & { platforms: string[] }>;
  /** Quem está parando de rodar: sumiu na última janela ou caiu ≥ 50% vs o pico e segue caindo. */
  slowing: SlowingEntry[];
  /** Quadro de NOVOS: 1ª venda de todos os tempos caiu nos últimos 7 dias (até a âncora). */
  newAffiliates: NewAffiliateEntry[];
  newRange: { start: string; end: string; days: number };
  health: { notes: HealthNote[]; risk: string };
}

// Novos afiliados: contas cuja PRIMEIRA venda FE aprovada (histórico
// inteiro, não só a cobertura das janelas) caiu nos últimos 7 dias até a
// âncora. Em view=partner, o parceiro só é novo se a 1ª venda do PARCEIRO
// (todas as contas) caiu na janela — conta nova de parceiro veterano não
// entra (isso é migração de conta, e a Evolução já dá a pista).
const NEW_AFF_DAYS = 7;

async function loadNewAffiliates(
  opts: SequenceOptions,
  lastDayStart: Date,
): Promise<{ rows: NewAffiliateEntry[]; range: { start: string; end: string; days: number } }> {
  const end = new Date(lastDayStart.getTime() + DAY_MS);
  const start = new Date(lastDayStart.getTime() - (NEW_AFF_DAYS - 1) * DAY_MS);
  const range = { start: brtDateStr(start), end: brtDateStr(lastDayStart), days: NEW_AFF_DAYS };

  const platCond = opts.platformSlugs?.length
    ? Prisma.sql`AND pl."slug" IN (${Prisma.join(opts.platformSlugs)})`
    : Prisma.empty;
  const firsts = await db.$queryRaw<Array<{
    id: string; externalId: string; nickname: string | null; partnerId: string | null;
    isInternal: boolean | null; platform: string; first_sale: Date;
  }>>(Prisma.sql`
    SELECT a."id", a."externalId", a."nickname", a."partnerId", a."isInternal",
           pl."slug" AS platform, MIN(o."orderedAt") AS first_sale
    FROM "Order" o
    JOIN "Affiliate" a ON a."id" = o."affiliateId"
    JOIN "Platform" pl ON pl."id" = a."platformId"
    WHERE o."status" = 'APPROVED' AND o."productType" = 'FRONTEND' ${platCond}
    GROUP BY a."id", a."externalId", a."nickname", a."partnerId", a."isInternal", pl."slug"
    HAVING MIN(o."orderedAt") >= ${start} AND MIN(o."orderedAt") < ${end}
  `);
  const fresh = firsts.filter((a) => opts.includeInternal || !effectiveInternal(a));
  if (fresh.length === 0) return { rows: [], range };

  // 1ª venda do PARCEIRO inteiro (pra barrar conta nova de veterano).
  const pids = Array.from(new Set(fresh.map((f) => f.partnerId).filter((x): x is string => x != null)));
  const partnerFirst = new Map<string, Date>();
  const partnerName = new Map<string, string>();
  if (pids.length > 0) {
    const [pf, pn] = await Promise.all([
      db.$queryRaw<Array<{ pid: string; first_sale: Date }>>(Prisma.sql`
        SELECT a."partnerId" AS pid, MIN(o."orderedAt") AS first_sale
        FROM "Order" o JOIN "Affiliate" a ON a."id" = o."affiliateId"
        WHERE o."status" = 'APPROVED' AND o."productType" = 'FRONTEND'
          AND a."partnerId" IN (${Prisma.join(pids)})
        GROUP BY a."partnerId"
      `),
      db.affiliatePartner.findMany({ where: { id: { in: pids } }, select: { id: true, displayName: true } }),
    ]);
    for (const r of pf) partnerFirst.set(r.pid, r.first_sale);
    for (const p of pn) partnerName.set(p.id, p.displayName);
  }

  const ids = fresh.map((f) => f.id);
  const stats = new Map<string, { fe: number; revenue: number }>();
  const st = await db.$queryRaw<Array<{ id: string; fe: bigint; revenue: number }>>(Prisma.sql`
    SELECT o."affiliateId" AS id,
           COUNT(*) FILTER (WHERE o."productType" = 'FRONTEND')::bigint AS fe,
           COALESCE(SUM(o."grossAmountUsd"), 0)::float AS revenue
    FROM "Order" o
    WHERE o."status" = 'APPROVED' AND o."affiliateId" IN (${Prisma.join(ids)})
      AND o."orderedAt" >= ${start} AND o."orderedAt" < ${end}
    GROUP BY o."affiliateId"
  `);
  for (const r of st) stats.set(r.id, { fe: Number(r.fe), revenue: r.revenue });

  const rows: NewAffiliateEntry[] = [];
  if (opts.view === 'partner') {
    const grouped = new Map<string, typeof fresh>();
    for (const f of fresh) {
      if (f.partnerId != null) {
        const pFirst = partnerFirst.get(f.partnerId);
        if (pFirst && pFirst < start) continue; // veterano abrindo conta nova
        const list = grouped.get(f.partnerId) ?? [];
        list.push(f);
        grouped.set(f.partnerId, list);
      } else {
        const s = stats.get(f.id) ?? { fe: 0, revenue: 0 };
        rows.push({
          key: `aff:${f.id}`, name: f.nickname?.trim() || f.externalId, kind: 'affiliate',
          platforms: [f.platform], firstSaleAt: f.first_sale.toISOString(),
          firstSaleDay: brtDateStr(f.first_sale), sales: s.fe, revenue: round2(s.revenue),
        });
      }
    }
    for (const [pid, list] of grouped) {
      const first = list.reduce((a, b) => (b.first_sale < a.first_sale ? b : a));
      const agg = list.reduce(
        (acc, f) => {
          const s = stats.get(f.id) ?? { fe: 0, revenue: 0 };
          return { fe: acc.fe + s.fe, revenue: acc.revenue + s.revenue };
        },
        { fe: 0, revenue: 0 },
      );
      rows.push({
        key: `partner:${pid}`,
        name: partnerName.get(pid) ?? list[0].nickname ?? pid,
        kind: 'partner',
        platforms: Array.from(new Set(list.map((f) => f.platform))),
        firstSaleAt: first.first_sale.toISOString(),
        firstSaleDay: brtDateStr(first.first_sale),
        sales: agg.fe, revenue: round2(agg.revenue),
      });
    }
  } else {
    for (const f of fresh) {
      const s = stats.get(f.id) ?? { fe: 0, revenue: 0 };
      rows.push({
        key: `aff:${f.id}`, name: f.nickname?.trim() || f.externalId, kind: 'affiliate',
        platforms: [f.platform], firstSaleAt: f.first_sale.toISOString(),
        firstSaleDay: brtDateStr(f.first_sale), sales: s.fe, revenue: round2(s.revenue),
      });
    }
  }
  rows.sort((a, b) => b.revenue - a.revenue || b.sales - a.sales);
  return { rows, range };
}

export async function getAffiliateSequence(opts: SequenceOptions): Promise<AffiliateSequenceResponse> {
  const count = Math.min(Math.max(Math.trunc(opts.count) || 3, 2), 8);
  const raw = await loadRaw(opts, undefined, count * opts.window);
  const { entities, excludedIds } = buildEntities(raw, opts.view, opts.includeInternal);
  const ranges = sequenceRanges(opts.window, count, raw.lastIdx);
  const labels = ranges.map((_, i) => `Janela ${i + 1}`);

  // Métricas de cada entidade em cada janela.
  const perEntity = new Map<string, Array<WindowMetrics>>();
  for (const e of entities) perEntity.set(e.key, ranges.map((r) => entityRange(raw, e, r).m));
  const platformsOf = new Map(entities.map((e) => [e.key, entityPlatforms(raw, e)]));
  const nameOf = new Map(entities.map((e) => [e.key, e.name]));
  const kindOf = new Map(entities.map((e) => [e.key, e.kind]));

  const windows: SequenceWindow[] = ranges.map((r, i) => {
    const rows: SequenceWindowRow[] = entities
      .map((e) => ({ key: e.key, name: e.name, kind: e.kind, platforms: platformsOf.get(e.key)!, rank: 0, m: perEntity.get(e.key)![i] }))
      // Só quem VENDEU na janela entra no ranking dela (uma janela só com
      // estorno não é venda — ficaria "#45 · $0 · reemb. 100%").
      .filter((x) => x.m.sales > 0 || x.m.revenue > 0)
      .sort((a, b) => b.m.revenue - a.m.revenue || b.m.sales - a.m.sales);
    rows.forEach((x, idx) => { x.rank = idx + 1; });
    const totals = rows.length ? mergeMetrics(rows.map((x) => x.m), raw.pm.thresholds) : emptyMetrics(opts.window, raw.pm);
    const totalRev = rows.reduce((n, x) => n + x.m.revenue, 0);
    const top10 = rows.slice(0, 10).reduce((n, x) => n + x.m.revenue, 0);
    const top2 = rows.slice(0, 2).reduce((n, x) => n + x.m.revenue, 0);
    let internalExcluded = 0; let internalRevenueExcluded = 0;
    for (const id of excludedIds) {
      const m = raw.days.get(id);
      if (!m) continue;
      let rev = 0; let orders = 0;
      for (let d = r.from; d <= r.to; d++) { rev += m.get(d)?.revenue ?? 0; orders += m.get(d)?.allOrders ?? 0; }
      if (orders > 0) { internalExcluded++; internalRevenueExcluded += rev; }
    }
    return {
      index: i, label: labels[i], start: dateAt(raw, r.from), end: dateAt(raw, r.to),
      totals, active: rows.filter((x) => x.m.sales > 0).length,
      concentrationTop10: totalRev > 0 ? round4(top10 / totalRev) : 0,
      topShare2: totalRev > 0 ? round4(top2 / totalRev) : 0,
      internalExcluded, internalRevenueExcluded: round2(internalRevenueExcluded),
      rows,
    };
  });

  const transitions: Transition[] = [];
  for (let i = 1; i < windows.length; i++) {
    const toRows = (w: SequenceWindow) => w.rows.map((x) => ({ key: x.key, name: x.name, revenue: x.m.revenue, sales: x.m.sales }));
    transitions.push(transitionBetween(toRows(windows[i - 1]), toRows(windows[i]), i - 1, i));
  }

  // Séries por entidade (null = sem venda na janela) + ranks.
  const rankOf = windows.map((w) => new Map(w.rows.map((x) => [x.key, x.rank])));
  const series: EntitySeries[] = entities.map((e) => {
    const ms = perEntity.get(e.key)!;
    return {
      key: e.key, name: e.name,
      metrics: ms.map((m) => (m.sales > 0 || m.revenue > 0 ? m : null)),
      ranks: ms.map((_, i) => rankOf[i].get(e.key) ?? null),
    };
  });

  // Evolução: quem esteve no Top 10 de alguma janela.
  const evoKeys = new Set<string>();
  for (const w of windows) w.rows.slice(0, 10).forEach((x) => evoKeys.add(x.key));
  // Pistas de migração de conta (visão por plataforma): pares sugeridos
  // pela identidade cujas trajetórias se espelham (um desaba quando o
  // outro aparece/salta na mesma transição).
  const migration = new Map<string, { otherKey: string; otherName: string }>();
  if (opts.view === 'platform') {
    const idList: IdentityAffiliate[] = entities.map((e) => {
      const a = raw.affiliates.get(e.accountIds[0])!;
      return { id: a.id, platformSlug: a.slug, externalId: a.externalId, nickname: a.nickname, email: a.email, partnerId: a.partnerId, isInternal: a.isInternal, lastOrderAt: null };
    });
    const seriesByKey = new Map(series.map((s) => [s.key, s]));
    for (const sug of suggestLinks(idList, { max: 400 })) {
      const ka = `aff:${sug.a.id}`; const kb = `aff:${sug.b.id}`;
      if (!evoKeys.has(ka) && !evoKeys.has(kb)) continue;
      const sa = seriesByKey.get(ka); const sb = seriesByKey.get(kb);
      if (!sa || !sb) continue;
      const rev = (s: EntitySeries) => s.metrics.map((m) => m?.revenue ?? 0);
      const ra = rev(sa); const rb = rev(sb);
      // Piso: quem desaba tinha ≥ $2k e quem sobe chega a ≥ 25% disso (senão
      // uma venda de $40 de um homônimo virava "migração de conta").
      const MIN_DROP_BASE = 2000;
      for (let i = 1; i < count; i++) {
        const aDrop = ra[i - 1] >= MIN_DROP_BASE && ra[i] <= 0.4 * ra[i - 1];
        const bJump = rb[i] >= 0.25 * ra[i - 1] && (rb[i - 1] === 0 || rb[i] >= 2 * rb[i - 1]);
        const bDrop = rb[i - 1] >= MIN_DROP_BASE && rb[i] <= 0.4 * rb[i - 1];
        const aJump = ra[i] >= 0.25 * rb[i - 1] && (ra[i - 1] === 0 || ra[i] >= 2 * ra[i - 1]);
        const strong = sug.confidence !== 'baixa';
        if ((aDrop && bJump && (strong || rb[i] >= 0.5 * ra[i - 1])) || (bDrop && aJump && (strong || ra[i] >= 0.5 * rb[i - 1]))) {
          migration.set(ka, { otherKey: kb, otherName: sb.name });
          migration.set(kb, { otherKey: ka, otherName: sa.name });
          break;
        }
      }
    }
  }
  const evolution: EvolutionEntry[] = series
    .filter((s) => evoKeys.has(s.key))
    .map((s) => {
      const n = narrateEntity(s, labels, raw.pm.thresholds);
      const hint = migration.get(s.key) ?? null;
      const text = hint
        ? `${n.text} Importante: essa mudança acontece quase no mesmo instante em que "${hint.otherName}" faz o movimento oposto — nomes parecidos e trajetórias espelhadas sugerem a mesma pessoa migrando de conta ou link de rastreamento. Vale confirmar com o afiliado e unificar as contas em Identidades.`
        : n.text;
      const ranks = s.ranks.filter((r): r is number => r != null);
      return {
        key: s.key, name: s.name, kind: kindOf.get(s.key)!, platforms: platformsOf.get(s.key)!,
        tag: n.tag, title: n.title, text, deltas: n.deltas,
        per: s.metrics.map((m, i) => (m ? {
          revenue: m.revenue, sales: m.sales, feApproved: m.feApproved, aov: m.aov, approvalRate: m.approvalRate, refundRate: m.refundRate,
          cpaPerFe: m.cpaPerFe, netAfterCpa: m.netAfterCpa, netAfterCpaTotal: m.netAfterCpaTotal, cpaStatus: m.cpaStatus, rank: s.ranks[i],
        } : null)),
        bestRank: ranks.length ? Math.min(...ranks) : null,
        migrationHint: hint,
      };
    })
    .sort((a, b) => {
      const order: SeqTag[] = ['breakout', 'novo', 'crescimento', 'volatil', 'estagnado', 'queda', 'queda_forte', 'churn', 'estavel'];
      const oa = order.indexOf(a.tag); const ob = order.indexOf(b.tag);
      if (oa !== ob) return oa - ob;
      const la = a.per[a.per.length - 1]?.revenue ?? 0; const lb = b.per[b.per.length - 1]?.revenue ?? 0;
      return lb - la;
    });

  const newAff = await loadNewAffiliates(opts, raw.lastDayStart);

  const totals: WindowTotals[] = windows.map((w) => ({
    revenue: w.totals.revenue, sales: w.totals.sales, active: w.active, concentrationTop10: w.concentrationTop10,
    topShare2: w.topShare2, topNames: w.rows.slice(0, 2).map((x) => x.name),
  }));
  const notes = windows.map((_, i) => healthNote(i, totals, transitions, labels));
  const reactivation = reactivationList(series).slice(0, 60).map((r) => ({ ...r, platforms: platformsOf.get(r.key) ?? [] }));

  // Quem está parando de rodar (Evolução): pico ≥ $500 e, na última janela,
  // zero vendas ("parou") ou ≤ 50% do pico ainda caindo ("caindo").
  const slowing: SlowingEntry[] = [];
  for (const s of series) {
    const rev = s.metrics.map((m) => (m && m.revenue > 0 ? m.revenue : null));
    const idx = rev.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) continue;
    const K = rev.length;
    const peakIndex = idx.reduce((b, i) => (rev[i]! > rev[b]! ? i : b), idx[0]);
    const peak = rev[peakIndex]!;
    if (peak < 500 || peakIndex === K - 1) continue;
    const last = rev[K - 1];
    const lastActive = idx[idx.length - 1];
    let state: SlowingEntry['state'] | null = null;
    if (last == null) state = 'parou';
    else if (last <= 0.5 * peak && (rev[K - 2] == null || last < rev[K - 2]!)) state = 'caindo';
    if (!state) continue;
    slowing.push({
      key: s.key, name: s.name, kind: kindOf.get(s.key)!, platforms: platformsOf.get(s.key) ?? [],
      state, peakRevenue: round2(peak), peakIndex, peakSales: s.metrics[peakIndex]!.sales,
      lastRevenue: round2(last ?? 0), lastSales: s.metrics[K - 1]?.sales ?? 0, lastActiveIndex: lastActive,
      dropPct: round4(((last ?? 0) - peak) / peak), revenue: rev,
    });
  }
  slowing.sort((a, b) => b.peakRevenue - a.peakRevenue);

  return {
    asOf: (opts.now ?? new Date()).toISOString(),
    window: opts.window, count, anchor: brtDateStr(raw.lastDayStart), view: opts.view, includeInternal: opts.includeInternal,
    windows, transitions, evolution, reactivation, slowing: slowing.slice(0, 80),
    newAffiliates: newAff.rows.slice(0, 100), newRange: newAff.range,
    health: { notes, risk: riskText(totals, transitions) },
  };
}
