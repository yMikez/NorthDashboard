// Fase 5 — métricas do Copy Optimizer (CopyView × Order).
//
// Camada de query (DB) + reducer PURO (testável). A query devolve uma linha por
// view na janela, com flags de conversão e gross da sessão; o reducer agrega em
// byStage / byAffiliate / byLayer / daily. Espelha o padrão do metrics.ts.

import { Prisma } from '@prisma/client';
import { db } from '../db';

// Stage → produto BuyGoods esperado naquela etapa (PHASE_5_6_7_BRIEFING §8).
// Conversão "no stage" = upsell APPROVED daquele produto específico.
export const STAGE_PRODUCT: Record<string, string> = {
  Upsell01: 'neu6u',
  Upsell02: 'nig6u',
  Upsell03: 'fleimu33u',
};

export type CopyFunnelPeriod = '1h' | '24h' | '7d' | '30d';

const PERIOD_HOURS: Record<CopyFunnelPeriod, number> = {
  '1h': 1, '24h': 24, '7d': 24 * 7, '30d': 24 * 30,
};

export interface CopyFunnelFilters {
  period: CopyFunnelPeriod;
  stage?: string | null;
  family?: string | null;
  affiliate?: string | null; // casa affName OU affId
  target: number; // target AOV pro gap
  windowHours?: number; // override do period (usado pelo auto-tune, ex: 48h)
}

// Linha por view (CopyView) na janela, já com outcomes computados.
export interface RawFunnelView {
  stage: string | null;
  layer: string;
  affName: string | null;
  affId: string | null;
  convertedStage: boolean; // upsell APPROVED do produto esperado do stage
  convertedAny: boolean; // qualquer upsell APPROVED na sessão
  grossSession: number; // soma do gross APPROVED da sessão
  shownAt: string; // ISO
}

const BRT_SHIFT_MS = 3 * 60 * 60 * 1000;
const MIN_AFF_SAMPLE = 5; // abaixo disso o afiliado vira ruído — não exibe

// ---------- Query ----------

export async function queryCopyFunnel(f: CopyFunnelFilters): Promise<RawFunnelView[]> {
  const hours = f.windowHours && f.windowHours > 0 ? f.windowHours : (PERIOD_HOURS[f.period] ?? 24);
  const conds: Prisma.Sql[] = [
    Prisma.sql`cv."shownAt" >= NOW() - (${`${hours} hours`}::interval)`,
  ];
  if (f.stage) conds.push(Prisma.sql`cv."stage" = ${f.stage}`);
  if (f.family) conds.push(Prisma.sql`cv."family" = ${f.family}`);
  if (f.affiliate) {
    conds.push(Prisma.sql`(cv."affName" = ${f.affiliate} OR cv."affId" = ${f.affiliate})`);
  }
  const where = Prisma.join(conds, ' AND ');

  const rows = await db.$queryRaw<Array<{
    stage: string | null;
    layer: string;
    aff_name: string | null;
    aff_id: string | null;
    converted_stage: boolean;
    converted_any: boolean;
    gross_session: Prisma.Decimal;
    shown_at: Date;
  }>>(Prisma.sql`
    SELECT
      cv."stage"   AS stage,
      cv."layer"   AS layer,
      cv."affName" AS aff_name,
      cv."affId"   AS aff_id,
      EXISTS (
        SELECT 1 FROM "Order" o
        JOIN "Product" p ON p.id = o."productId"
        WHERE o."parentExternalId" = cv."orderIdGlobal"
          AND o."productType" = 'UPSELL'
          AND o."status" = 'APPROVED'
          AND p."externalId" = CASE cv."stage"
            WHEN 'Upsell01' THEN 'neu6u'
            WHEN 'Upsell02' THEN 'nig6u'
            WHEN 'Upsell03' THEN 'fleimu33u'
            ELSE NULL END
      ) AS converted_stage,
      EXISTS (
        SELECT 1 FROM "Order" o
        WHERE o."parentExternalId" = cv."orderIdGlobal"
          AND o."productType" = 'UPSELL'
          AND o."status" = 'APPROVED'
      ) AS converted_any,
      (
        SELECT COALESCE(SUM(o."grossAmountUsd"), 0)
        FROM "Order" o
        WHERE o."parentExternalId" = cv."orderIdGlobal"
          AND o."status" = 'APPROVED'
      ) AS gross_session,
      cv."shownAt" AS shown_at
    FROM "CopyView" cv
    WHERE ${where}
  `);

  return rows.map((r) => ({
    stage: r.stage,
    layer: r.layer,
    affName: r.aff_name,
    affId: r.aff_id,
    convertedStage: r.converted_stage,
    convertedAny: r.converted_any,
    grossSession: Number(r.gross_session),
    shownAt: r.shown_at.toISOString(),
  }));
}

// ---------- Reducer puro ----------

export interface LayerStats {
  n: number;
  converted: number;
  conv: number;
  aov: number;
}

export interface CopyFunnelResponse {
  summary: {
    totalViews: number;
    byLayer: Record<string, number>;
    aovOverall: number;
    aovTarget: number;
    aovGap: number;
    convOverall: number;
  };
  byStage: Array<{
    stage: string;
    product: string | null;
    nViews: number;
    byLayer: Record<string, LayerStats>;
    liftPp: number | null;
  }>;
  byAffiliate: Array<{
    key: string;
    affId: string | null;
    affName: string | null;
    nLeads: number;
    byLayer: Record<string, LayerStats>;
    liftPp: number | null;
    currentPct: number | null;
    autotune: boolean | null;
  }>;
  daily: Array<{ date: string; aov: number; views: number; convOverall: number }>;
  forecast: ForecastResult;
}

export interface ForecastResult {
  // insufficient = poucos dias de dado; reached = já bateu; flat = AOV não sobe
  // no ritmo atual (sem ETA); eta = tem estimativa.
  status: 'insufficient' | 'reached' | 'flat' | 'eta';
  currentAov: number; // nível atual estimado pela tendência (fitted no último dia)
  target: number;
  slopePerDay: number; // ritmo da tendência em $/dia
  daysToTarget: number | null;
  avgDailyViews: number;
  daysOfData: number;
}

/**
 * Previsão de tempo até a meta de AOV. Regressão linear da série diária de AOV
 * (ritmo $/dia) extrapolada até o target. PURA — é uma estimativa "no ritmo
 * atual", não garantia: assume a tendência recente constante.
 */
export function forecastToTarget(
  daily: Array<{ aov: number; views: number }>,
  target: number,
): ForecastResult {
  const n = daily.length;
  const avgDailyViews = n ? Math.round(daily.reduce((s, d) => s + d.views, 0) / n) : 0;
  const base = { target: round2(target), avgDailyViews, daysOfData: n };

  if (n < 3) {
    return { status: 'insufficient', currentAov: 0, slopePerDay: 0, daysToTarget: null, ...base };
  }

  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  daily.forEach((d, i) => { sx += i; sy += d.aov; sxy += i * d.aov; sxx += i * i; });
  const denom = n * sxx - sx * sx;
  const slope = denom !== 0 ? (n * sxy - sx * sy) / denom : 0;
  const intercept = (sy - slope * sx) / n;
  const currentFitted = slope * (n - 1) + intercept;
  const cur = round2(currentFitted);
  const sl = round2(slope);

  if (currentFitted >= target) {
    return { status: 'reached', currentAov: cur, slopePerDay: sl, daysToTarget: 0, ...base };
  }
  if (slope <= 0.0001) {
    return { status: 'flat', currentAov: cur, slopePerDay: sl, daysToTarget: null, ...base };
  }
  const days = (target - currentFitted) / slope;
  return { status: 'eta', currentAov: cur, slopePerDay: sl, daysToTarget: Math.round(days * 10) / 10, ...base };
}

export interface RuleInfo {
  black2Pct: number;
  autotune: boolean;
  keyType: string;
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round4(n: number): number { return Math.round(n * 10000) / 10000; }

function emptyAgg() {
  return { n: 0, converted: 0, grossSum: 0 };
}
function toLayerStats(a: { n: number; converted: number; grossSum: number }): LayerStats {
  return {
    n: a.n,
    converted: a.converted,
    conv: a.n ? round4(a.converted / a.n) : 0,
    aov: a.n ? round2(a.grossSum / a.n) : 0,
  };
}
function liftPpBetween(byLayer: Record<string, LayerStats>): number | null {
  const b1 = byLayer.black1, b2 = byLayer.black2;
  if (!b1 || !b2 || b1.n === 0 || b2.n === 0) return null;
  return Math.round((b2.conv - b1.conv) * 1000) / 10; // pp, 1 casa
}

/**
 * Agrega as views em summary/byStage/byAffiliate/daily. Puro — `rules` mapeia
 * affKey→info pra anexar currentPct/autotune; `target` é o AOV alvo.
 */
export function reduceCopyFunnel(
  views: RawFunnelView[],
  target: number,
  rules: Map<string, RuleInfo>,
): CopyFunnelResponse {
  // ----- summary -----
  const byLayerCount: Record<string, number> = { white: 0, black1: 0, black2: 0, loading: 0 };
  let grossSum = 0, convertedAnyTotal = 0;
  for (const v of views) {
    byLayerCount[v.layer] = (byLayerCount[v.layer] ?? 0) + 1;
    grossSum += v.grossSession;
    if (v.convertedAny) convertedAnyTotal++;
  }
  const totalViews = views.length;
  const aovOverall = totalViews ? round2(grossSum / totalViews) : 0;

  // ----- byStage (conversão = convertedStage) -----
  const stageMap = new Map<string, { nViews: number; layers: Map<string, ReturnType<typeof emptyAgg>> }>();
  for (const v of views) {
    if (!v.stage) continue;
    let s = stageMap.get(v.stage);
    if (!s) { s = { nViews: 0, layers: new Map() }; stageMap.set(v.stage, s); }
    s.nViews++;
    let la = s.layers.get(v.layer);
    if (!la) { la = emptyAgg(); s.layers.set(v.layer, la); }
    la.n++; la.grossSum += v.grossSession; if (v.convertedStage) la.converted++;
  }
  const byStage = Array.from(stageMap.entries())
    .map(([stage, s]) => {
      const byLayer: Record<string, LayerStats> = {};
      for (const [layer, a] of s.layers) byLayer[layer] = toLayerStats(a);
      return { stage, product: STAGE_PRODUCT[stage] ?? null, nViews: s.nViews, byLayer, liftPp: liftPpBetween(byLayer) };
    })
    .sort((a, b) => a.stage.localeCompare(b.stage));

  // ----- byAffiliate (conversão = convertedAny) -----
  const affMap = new Map<string, { affName: string | null; affId: string | null; layers: Map<string, ReturnType<typeof emptyAgg>> }>();
  for (const v of views) {
    const key = v.affName ?? v.affId;
    if (!key) continue;
    let a = affMap.get(key);
    if (!a) { a = { affName: v.affName, affId: v.affId, layers: new Map() }; affMap.set(key, a); }
    let la = a.layers.get(v.layer);
    if (!la) { la = emptyAgg(); a.layers.set(v.layer, la); }
    la.n++; la.grossSum += v.grossSession; if (v.convertedAny) la.converted++;
  }
  const byAffiliate = Array.from(affMap.entries())
    .map(([key, a]) => {
      const byLayer: Record<string, LayerStats> = {};
      let nLeads = 0;
      for (const [layer, agg] of a.layers) { byLayer[layer] = toLayerStats(agg); nLeads += agg.n; }
      const info = rules.get(key) ?? (a.affId ? rules.get(a.affId) : undefined);
      return {
        key, affId: a.affId, affName: a.affName, nLeads, byLayer,
        liftPp: liftPpBetween(byLayer),
        currentPct: info ? info.black2Pct : null,
        autotune: info ? info.autotune : null,
      };
    })
    .filter((a) => a.nLeads >= MIN_AFF_SAMPLE)
    .sort((a, b) => b.nLeads - a.nLeads);

  // ----- daily (bucket por dia BRT) -----
  const dayMap = new Map<string, { views: number; grossSum: number; converted: number }>();
  for (const v of views) {
    const day = new Date(new Date(v.shownAt).getTime() - BRT_SHIFT_MS).toISOString().slice(0, 10);
    let d = dayMap.get(day);
    if (!d) { d = { views: 0, grossSum: 0, converted: 0 }; dayMap.set(day, d); }
    d.views++; d.grossSum += v.grossSession; if (v.convertedAny) d.converted++;
  }
  const daily = Array.from(dayMap.entries())
    .map(([date, d]) => ({
      date,
      aov: d.views ? round2(d.grossSum / d.views) : 0,
      views: d.views,
      convOverall: d.views ? round4(d.converted / d.views) : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    summary: {
      totalViews,
      byLayer: byLayerCount,
      aovOverall,
      aovTarget: round2(target),
      aovGap: round2(aovOverall - target),
      convOverall: totalViews ? round4(convertedAnyTotal / totalViews) : 0,
    },
    byStage,
    byAffiliate,
    daily,
    forecast: forecastToTarget(daily, target),
  };
}

// ---------- Orquestrador ----------

// Métricas no formato que o auto-tune precisa (n/conv por layer + aov overall
// do afiliado), derivadas das views. Puro — testável. convertedAny = qualquer
// upsell APPROVED na sessão.
export function metricsFromViews(views: RawFunnelView[]): {
  n_b1: number; n_b2: number; conv_b1: number; conv_b2: number; aov_observed: number;
} {
  let n_b1 = 0, n_b2 = 0, c_b1 = 0, c_b2 = 0, grossSum = 0;
  for (const v of views) {
    grossSum += v.grossSession;
    if (v.layer === 'black1') { n_b1++; if (v.convertedAny) c_b1++; }
    else if (v.layer === 'black2') { n_b2++; if (v.convertedAny) c_b2++; }
  }
  const total = views.length;
  return {
    n_b1, n_b2,
    conv_b1: n_b1 ? round4(c_b1 / n_b1) : 0,
    conv_b2: n_b2 ? round4(c_b2 / n_b2) : 0,
    aov_observed: total ? round2(grossSum / total) : 0,
  };
}

export async function getCopyFunnel(f: CopyFunnelFilters): Promise<CopyFunnelResponse> {
  const views = await queryCopyFunnel(f);
  const ruleRows = await db.affiliateCopyRule.findMany({
    select: { key: true, black2Pct: true, autotune: true, keyType: true },
  });
  const rules = new Map<string, RuleInfo>(
    ruleRows.map((r) => [r.key, { black2Pct: r.black2Pct, autotune: r.autotune, keyType: r.keyType }]),
  );
  return reduceCopyFunnel(views, f.target, rules);
}
