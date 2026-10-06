// Visões de IA por tool: o que o MODELO recebe de cada serviço. Os serviços
// ficam intactos (alimentam as abas); aqui só se tira ruído, corrige-se o
// que confundia e se derivam números que a tela mostra mas o payload não
// trazia.
//
// Os motivos, um por um:
//   - Overview: `kpis.netProfit` = net − CPA subtrai o CPA DUAS vezes (o net
//     já é pós-CPA) — sai. Os cards de reembolso e o "Net after CPA
//     (modelo)" da tela vêm do profit split, não do overview: `screenCards`
//     traz os cards 1:1, com o rótulo da tela.
//   - Comparação com hoje parcial: hoje-até-14h contra ontem INTEIRO dava
//     "queda" falsa. Com a janela atual incluindo agora, o anterior é
//     cortado no mesmo tempo decorrido ([início−L, agora−L]).
//   - Produtos: taxa de reembolso por SKU não existia (o modelo dividia pelo
//     denominador errado, com as linhas sintéticas da Digistore); URLs só
//     ocupavam contexto.
//   - Pedidos: horário em BRT ao lado do ISO UTC (o modelo convertia de
//     cabeça e errava o dia na borda).

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { SESSION_KEY_SQL, type MetricsFilters, type OverviewKPIs, type OverviewResponse, type ProductsResponse, type OrdersResponse } from '../services/metrics';
import type { ProfitSplitResponse } from '../services/profitSplit';
import { realOrderCount } from '../services/profitModel';
import { formatBrt } from './meta';
import { resolveUnit } from './units';

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

// ── Overview ────────────────────────────────────────────────────────────

export type AiOverviewKpis = Omit<OverviewKPIs, 'netProfit'>;

export function stripNetProfit(k: OverviewKPIs): AiOverviewKpis {
  const { netProfit: _doubleCpa, ...rest } = k;
  return rest;
}

// dow na convenção do Postgres (0 = domingo), extraído em BRT pelo serviço.
const DOW_LABELS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;

export function labelHeatmap(cells: OverviewResponse['hourlyHeatmap']): Array<OverviewResponse['hourlyHeatmap'][number] & { dowLabel: string }> {
  return cells.map((c) => ({ ...c, dowLabel: DOW_LABELS[c.dow] ?? String(c.dow) }));
}

export type CardState = 'ok' | 'warn' | 'danger';

export interface ScreenCard {
  /** Rótulo exato do card na Visão Geral. */
  card: string;
  value: number;
  /** 'pp' = o número JÁ é a porcentagem exibida (8.53 = 8,53%). */
  unit: 'usd' | 'count' | 'pp';
  /** Campo de origem (pra reproduzir / citar). */
  source: string;
  /** Semáforo que a tela pinta no card (só onde a tela tem um). */
  state?: CardState;
  detail?: Record<string, number>;
}

/**
 * Os cards da Visão Geral, 1:1 com public/src/pages/overview.jsx (mesmas
 * fontes e limiares). Os de reembolso contam o estorno pela DATA DO ESTORNO
 * (profit split); aprovação e chargeback são contagem ÷ todas as linhas pela
 * data da VENDA (kpis) — é o que a tela faz.
 */
export function buildScreenCards(k: OverviewKPIs | AiOverviewKpis, split: ProfitSplitResponse): ScreenCard[] {
  const approvalPp = round2(k.approvalRate * 100);
  const cbPp = round2(k.cbRate * 100);
  const cards: ScreenCard[] = [
    { card: 'Receita bruta', value: k.gross, unit: 'usd', source: 'kpis.gross', detail: { modoEvento: k.grossOriginal } },
    { card: 'Receita líquida', value: k.net, unit: 'usd', source: 'kpis.net' },
    { card: 'Pedidos aprovados', value: k.approvedCount, unit: 'count', source: 'kpis.approvedCount' },
    { card: 'AOV', value: k.aov, unit: 'usd', source: 'kpis.aov' },
    {
      card: 'Taxa de aprovação', value: approvalPp, unit: 'pp', source: 'kpis.approvalRate × 100',
      state: k.approvalRate >= 0.9 ? 'ok' : k.approvalRate >= 0.85 ? 'warn' : 'danger',
    },
    {
      card: 'Taxa de reembolso', value: split.refunds.valuePct, unit: 'pp', source: 'get_profit_split.refunds.valuePct',
      detail: { refundedUsd: split.refunds.refundedUsd, grossUsd: split.refunds.grossUsd, modeloDescontaUsd: split.front.refundCbUsd },
    },
    {
      card: 'Reembolso por pedidos', value: split.refunds.pct, unit: 'pp', source: 'get_profit_split.refunds.pct',
      detail: { refundedCount: split.refunds.refundedCount, salesCount: split.refunds.salesCount },
    },
    {
      card: 'Reembolso por pedidos — últimos 7d (limite 10%)', value: split.refunds7d.pct, unit: 'pp', source: 'get_profit_split.refunds7d.pct',
      state: split.refunds7d.pct > 10 ? 'danger' : split.refunds7d.pct > 8 ? 'warn' : 'ok',
      detail: { refundedCount: split.refunds7d.refundedCount, salesCount: split.refunds7d.salesCount },
    },
    {
      card: 'Chargeback', value: cbPp, unit: 'pp', source: 'kpis.cbRate × 100',
      state: k.cbRate >= 0.02 ? 'danger' : k.cbRate >= 0.01 ? 'warn' : 'ok',
    },
    {
      card: 'Net after CPA (modelo)', value: split.front.profitUsd, unit: 'usd', source: 'get_profit_split.front.profitUsd',
      ...(split.front.profitUsd < 0 ? { state: 'danger' as const } : {}),
    },
    {
      card: 'Net after CPA (modelo) — total front + back', value: split.totalUsd, unit: 'usd', source: 'get_profit_split.totalUsd',
      detail: { frontUsd: split.front.profitUsd, backUsd: split.back.profitUsd },
    },
  ];
  return cards;
}

export interface KpiDelta {
  cur: number;
  prev: number;
  abs: number;
  /** Variação relativa em FRAÇÃO (0.123 = +12,3%); null sem base. */
  pct: number | null;
  /** Diferença em pontos percentuais — só nos campos de taxa. */
  pp?: number;
}

/** Deltas prontos (o modelo não faz conta de cabeça): abs, relativo e pp nas taxas. */
export function kpiDeltas(cur: object, prev: object, tool = 'get_overview'): Record<string, KpiDelta> {
  const out: Record<string, KpiDelta> = {};
  const p = prev as Record<string, unknown>;
  for (const [key, c] of Object.entries(cur as Record<string, unknown>)) {
    const b = p[key];
    if (typeof c !== 'number' || typeof b !== 'number') continue;
    const unit = resolveUnit(tool, ['kpis', key])?.unit;
    const diff = c - b;
    const d: KpiDelta = {
      cur: c,
      prev: b,
      abs: unit === 'fraction' ? round4(diff) : round2(diff),
      pct: b !== 0 ? round4(diff / Math.abs(b)) : null,
    };
    if (unit === 'fraction') d.pp = round2(diff * 100);
    if (unit === 'pp') d.pp = round2(diff);
    out[key] = d;
  }
  return out;
}

/**
 * Janela anterior no MESMO tempo decorrido quando a atual inclui agora
 * (hoje parcial): [início − L, agora − L], L = duração nominal. null quando
 * a janela já fechou (aí o anterior de mesma duração do serviço serve).
 */
export function alignedPreviousWindow(start: Date, end: Date, now: Date): { start: Date; end: Date } | null {
  const s = start.getTime();
  const e = end.getTime();
  const n = now.getTime();
  if (e < n || s > n) return null;
  // Fim inclusivo (…23:59:59.999) conta o milissegundo final no comprimento.
  const length = e - s + ((e + 1) % 1000 === 0 ? 1 : 0);
  return { start: new Date(s - length), end: new Date(n - length) };
}

/** Janela do `previous` que getOverview monta (mesma duração, logo antes). */
export function servicePreviousWindow(start: Date, end: Date): { start: Date; end: Date } {
  const span = end.getTime() - start.getTime();
  const prevEnd = start.getTime() - 1;
  return { start: new Date(prevEnd - span), end: new Date(prevEnd) };
}

// KPIs do overview num intervalo EXATO de instantes. A MV daily_metrics é
// diária: um anterior "até ontem 14h" viraria ontem inteiro. Mesmas colunas
// e filtros da MV (migração 20260430140000) + a definição canônica de AOV
// (feSessionStats) — o teste de paridade compara as duas no PGlite.
export function overviewKpisSql(f: MetricsFilters): { totals: Prisma.Sql; sessions: Prisma.Sql } {
  const conds: Prisma.Sql[] = [
    Prisma.sql`o."orderedAt" >= ${f.startDate}`,
    Prisma.sql`o."orderedAt" <= ${f.endDate}`,
  ];
  if (f.platformSlugs?.length) conds.push(Prisma.sql`pl."slug" = ANY(${f.platformSlugs})`);
  if (f.countries?.length) conds.push(Prisma.sql`COALESCE(o."country", '_unknown') = ANY(${f.countries})`);
  if (f.productFamilies?.length) conds.push(Prisma.sql`COALESCE(pr."family", '_unknown') = ANY(${f.productFamilies})`);
  if (f.productTypes?.length) conds.push(Prisma.sql`o."productType" = ANY(${f.productTypes}::"ProductType"[])`);
  const totals = Prisma.sql`
    SELECT
      COUNT(*)::bigint AS total_count,
      COUNT(*) FILTER (WHERE o."status" = 'APPROVED')::bigint AS approved_count,
      COUNT(*) FILTER (WHERE o."status" = 'REFUNDED')::bigint AS refunded_count,
      COUNT(*) FILTER (WHERE o."status" = 'CHARGEBACK')::bigint AS chargeback_count,
      COALESCE(SUM(o."grossAmountUsd") FILTER (WHERE o."status" = 'APPROVED'), 0)::float8 AS gross,
      COALESCE(SUM(COALESCE(o."originalGrossUsd", ABS(o."grossAmountUsd"))), 0)::float8 AS gross_original,
      COALESCE(SUM(o."netAmountUsd") FILTER (WHERE o."status" = 'APPROVED'), 0)::float8 AS net,
      COALESCE(SUM(o."cpaPaidUsd"), 0)::float8 AS cpa,
      COALESCE(SUM(o."cogsUsd"), 0)::float8 AS cogs,
      COALESCE(SUM(o."fulfillmentUsd"), 0)::float8 AS fulfillment
    FROM "Order" o
    JOIN "Platform" pl ON o."platformId" = pl.id
    JOIN "Product" pr ON o."productId" = pr.id
    WHERE ${Prisma.join(conds, ' AND ')}`;

  // AOV canônico: igual a feSessionStats (metrics.ts) — base sem filtro de
  // família/etapa; a família do FE (e o afiliado) escolhe a sessão inteira.
  const baseConds: Prisma.Sql[] = [
    Prisma.sql`o."orderedAt" >= ${f.startDate}`,
    Prisma.sql`o."orderedAt" <= ${f.endDate}`,
  ];
  if (f.platformSlugs?.length) baseConds.push(Prisma.sql`pl."slug" = ANY(${f.platformSlugs})`);
  if (f.countries?.length) baseConds.push(Prisma.sql`o."country" = ANY(${f.countries})`);
  const feConds: Prisma.Sql[] = [Prisma.sql`b."productType" = 'FRONTEND'`, Prisma.sql`b."status" = 'APPROVED'`];
  if (f.productFamilies?.length) feConds.push(Prisma.sql`b."family" = ANY(${f.productFamilies})`);
  if (f.mappedAffiliateIds?.length) feConds.push(Prisma.sql`b."mappedAffiliateId" = ANY(${f.mappedAffiliateIds})`);
  if (f.affiliateIds?.length) feConds.push(Prisma.sql`b."affiliateId" = ANY(${f.affiliateIds})`);
  const sessions = Prisma.sql`
    WITH base AS (
      SELECT o."productType", o."status", o."grossAmountUsd", o."netAmountUsd", o."mappedAffiliateId", o."affiliateId",
             pr."family" AS family, ${SESSION_KEY_SQL} AS skey
      FROM "Order" o
      JOIN "Platform" pl ON o."platformId" = pl.id
      JOIN "Product" pr ON o."productId" = pr.id
      WHERE ${Prisma.join(baseConds, ' AND ')}
    ),
    fe AS (SELECT DISTINCT skey FROM base b WHERE ${Prisma.join(feConds, ' AND ')})
    SELECT
      COUNT(DISTINCT fe.skey)::bigint AS sessions,
      COALESCE(SUM(b."grossAmountUsd") FILTER (WHERE b."status" = 'APPROVED'), 0)::float8 AS revenue,
      COALESCE(SUM(b."netAmountUsd") FILTER (WHERE b."status" = 'APPROVED'), 0)::float8 AS net
    FROM fe JOIN base b ON b.skey = fe.skey`;
  return { totals, sessions };
}

export interface KpiTotalsRow {
  total_count: bigint | number; approved_count: bigint | number; refunded_count: bigint | number; chargeback_count: bigint | number;
  gross: number; gross_original: number; net: number; cpa: number; cogs: number; fulfillment: number;
}
export interface KpiSessionsRow { sessions: bigint | number; revenue: number; net: number }

/** Linhas cruas → KPIs, com os mesmos arredondamentos de kpisFromRows (metrics.ts). */
export function kpisFromTotals(t: KpiTotalsRow, s: KpiSessionsRow): AiOverviewKpis {
  const n = (v: bigint | number) => Number(v);
  const totalCount = n(t.total_count);
  const denom = totalCount || 1;
  const sessions = n(s.sessions);
  const estimatedProfit = round2(t.net - t.cogs - t.fulfillment);
  return {
    gross: round2(t.gross),
    grossOriginal: round2(t.gross_original),
    net: round2(t.net),
    cpa: round2(t.cpa),
    approvalRate: round4(n(t.approved_count) / denom),
    refundRate: round4(n(t.refunded_count) / denom),
    cbRate: round4(n(t.chargeback_count) / denom),
    aov: round2(sessions ? s.revenue / sessions : 0),
    approvedCount: n(t.approved_count),
    totalCount,
    orderGroups: sessions,
    epo: round2(sessions ? s.net / sessions : 0),
    cogs: round2(t.cogs),
    fulfillment: round2(t.fulfillment),
    estimatedProfit,
    estimatedMarginPct: t.gross > 0 ? Math.round((estimatedProfit / t.gross) * 10000) / 100 : 0,
  };
}

export async function overviewKpisBetween(f: MetricsFilters): Promise<AiOverviewKpis> {
  const { totals, sessions } = overviewKpisSql(f);
  const [[t], [s]] = await Promise.all([
    db.$queryRaw<KpiTotalsRow[]>(totals),
    db.$queryRaw<KpiSessionsRow[]>(sessions),
  ]);
  return kpisFromTotals(t, s ?? { sessions: 0, revenue: 0, net: 0 });
}

// ── Produtos ────────────────────────────────────────────────────────────

type ProductRow = ProductsResponse['products'][number];
type ProductUrls = 'salesPageUrl' | 'checkoutUrl' | 'thanksPageUrl' | 'driveUrl';
export type AiProductRow = Omit<ProductRow, ProductUrls> & Partial<Pick<ProductRow, ProductUrls>> & {
  realOrders: number; refundRate: number; cbRate: number;
};

/**
 * Taxas por SKU com o denominador certo: realOrders (sem as linhas
 * sintéticas de estorno da Digistore — mesma régua das taxas por afiliado).
 * Contagem pela data da VENDA — não é o card de reembolso.
 */
export function productRows(products: ProductRow[], includeUrls: boolean): AiProductRow[] {
  return products.map((p) => {
    const { salesPageUrl, checkoutUrl, thanksPageUrl, driveUrl, ...rest } = p;
    const realOrders = realOrderCount(p.platformSlug, p.allOrders, p.refunds, p.chargebacks);
    return {
      ...rest,
      ...(includeUrls ? { salesPageUrl, checkoutUrl, thanksPageUrl, driveUrl } : {}),
      realOrders,
      refundRate: realOrders > 0 ? round4(p.refunds / realOrders) : 0,
      cbRate: realOrders > 0 ? round4(p.chargebacks / realOrders) : 0,
    };
  });
}

// ── Pedidos ─────────────────────────────────────────────────────────────

export type AiOrderRow = OrdersResponse['orders'][number] & { orderedAtBrt: string; eventAtBrt: string };

export function orderRows(orders: OrdersResponse['orders']): AiOrderRow[] {
  return orders.map((o) => ({
    ...o,
    orderedAtBrt: formatBrt(new Date(o.orderedAt)),
    eventAtBrt: formatBrt(new Date(o.eventAt)),
  }));
}

// ── Janelas / vazio / notas fixas ───────────────────────────────────────

/** Primeiro e último dia (BRT) das tools de janela, lidos do próprio resultado. */
export function windowSpanOf(tool: string, value: unknown): { start: string; end: string } | undefined {
  const v = value as { range?: { start?: unknown; end?: unknown }; windows?: Array<{ start?: unknown; end?: unknown }> };
  if (tool === 'get_affiliate_analysis' || tool === 'get_affiliate_explain') {
    if (typeof v.range?.start === 'string' && typeof v.range?.end === 'string') return { start: v.range.start, end: v.range.end };
    return undefined;
  }
  if (tool === 'get_affiliate_sequence' || tool === 'get_funnel_sequence') {
    const w = Array.isArray(v.windows) ? v.windows : [];
    const first = w[0]?.start;
    const last = w[w.length - 1]?.end;
    if (typeof first === 'string' && typeof last === 'string') return { start: first, end: last };
  }
  return undefined;
}

type Obj = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' ? v : 0);
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});

// "Vazio" por tool: o que, na tela, apareceria como zerado.
const EMPTY: Record<string, (v: Obj) => boolean> = {
  get_overview: (v) => num(obj(v.kpis).totalCount) === 0,
  get_affiliates: (v) => num(v.returned) === 0,
  get_affiliate_analysis: (v) => arr(v.rows).length === 0,
  get_affiliate_sequence: (v) => arr(v.windows).every((w) => arr(w.rows).length === 0),
  get_funnel: (v) => num(obj(v.summary).feGroups) === 0 && num(obj(v.summary).totalRevenue) === 0,
  get_funnel_sequence: (v) => arr(v.windows).every((w) => num(obj(obj(w.all).summary).feGroups) === 0),
  get_products: (v) => arr(v.products).length === 0,
  get_families: (v) => arr(v.families).every((f) => num(f.totalOrders) === 0),
  get_platforms: (v) => arr(v.platforms).every((p) => num(p.allOrders) === 0),
  get_orders: (v) => num(v.total) === 0,
  get_profit_split: (v) => num(obj(v.front).orders) === 0 && num(obj(v.refunds).salesCount) === 0,
  get_costs_overview: (v) => num(obj(v.kpis).grossUsd) === 0 && num(obj(v.kpis).refundsCount) === 0,
  get_fulfillment: (v) => num(obj(v.kpis).orders) === 0,
  get_refund_cohorts: (v) => num(obj(v.totals).baseCount) === 0,
  get_call_center: (v) => num(obj(v.totals).sales) === 0,
};

export function isEmptyResult(tool: string, value: unknown): boolean {
  const check = EMPTY[tool];
  return !!check && !!value && typeof value === 'object' && check(value as Obj);
}

/** Ressalvas fixas que mudam a leitura do resultado (vão em _meta.notes). */
export const TOOL_NOTES: Record<string, string[]> = {
  get_overview: [
    'kpis.approvalRate/refundRate/cbRate = contagem ÷ TODAS as linhas pela data da VENDA (inclui as linhas sintéticas de estorno da Digistore); os cards de reembolso da tela contam pela data do ESTORNO — use screenCards.',
    'hourlyHeatmap em horário de Brasília (dow 0 = domingo).',
  ],
  get_products: ['refundRate/cbRate por SKU = contagem pela data da VENDA ÷ realOrders — não é o card de reembolso.'],
  get_costs_overview: [
    '`daily` agrupa por dia UTC (não BRT): venda após 21:00 BRT cai no dia seguinte — não compare dia a dia com get_overview.',
    'byFamily.profitUsd = gross − COGS − frete (sem fee nem CPA); kpis.profitUsd desconta tudo.',
  ],
};
