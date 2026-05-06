// Insights service.
//
// Computes a curated set of "narrative" cards that interpret the dashboard
// data instead of just displaying it. Examples: "afiliado X dando prejuízo
// $87 nos últimos 30d" or "UP1 take rate da NeuroMindPro caiu 6pp".
//
// Window: fixed last-30-days (NOT tied to the FilterBar). The Insights page
// is meant as a daily health snapshot, not period-filtered analytics.
//
// Cache: in-memory for one calendar day. First request after midnight
// recomputes; subsequent same-day requests return cached. Process restart
// invalidates (acceptable: recompute is sub-second).

import { Prisma } from '@prisma/client';
import { db } from '../db';
import {
  getAffiliates,
  getProducts,
  type AffiliatesResponse,
  type ProductsResponse,
  type MetricsFilters,
} from './metrics';

export type InsightSeverity = 'alert' | 'insight' | 'good';
export type InsightCategory = 'profit' | 'affiliates' | 'funnel' | 'operations';

export interface Insight {
  id: string;
  category: InsightCategory;
  severity: InsightSeverity;
  headline: string;
  body?: string;
  metrics?: Array<{ label: string; value: string }>;
  // Optional deep-link to where the user can act on the insight. Path is
  // resolved by the SPA router (e.g., '/leaderboard?...').
  cta?: { label: string; href: string };
}

export interface InsightsResponse {
  insights: Insight[];
  generatedAt: string;
  windowDays: number;
}

// 30-day rolling window. Long enough to escape weekly noise, short enough
// to surface fresh problems.
const WINDOW_DAYS = 30;

interface CacheEntry { date: string; payload: InsightsResponse }
let cache: CacheEntry | null = null;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getInsights(forceRefresh = false): Promise<InsightsResponse> {
  if (!forceRefresh && cache && cache.date === todayKey()) return cache.payload;
  const payload = await computeAll();
  cache = { date: todayKey(), payload };
  return payload;
}

export function invalidateInsightsCache(): void {
  cache = null;
}

async function computeAll(): Promise<InsightsResponse> {
  const now = new Date();
  const start = new Date(now.getTime() - WINDOW_DAYS * 24 * 3600 * 1000);
  const filters: MetricsFilters = { startDate: start, endDate: now };

  // Fetch shared data once.
  const [affResp, prodResp] = await Promise.all([
    getAffiliates(filters),
    getProducts(filters),
  ]);

  const insights: Insight[] = [];
  // Run each. Each function pushes 0+ insights; failures are isolated so
  // one broken calc doesn't wipe the page.
  for (const fn of [
    () => insightA1(affResp),
    () => insightB1(affResp),
    () => insightB3(affResp),
    () => insightB4(filters),
    () => insightB5(filters),
    () => insightC4(prodResp),
    () => insightD1(filters),
    () => insightD4(filters),
    () => insightD5(filters),
    // ---- novos (PROFIT) ----
    () => insightProfitRoas(),
    () => insightProfitRefundCost(prodResp),
    () => insightProfitUpsellZero(prodResp),
    () => insightProfitAffUnderpriced(affResp),
    // ---- novos (AFFILIATES) ----
    () => insightAffTrafficDrop(),
    () => insightAffRefundFingerprint(affResp),
    // ---- novos (FUNNEL) ----
    () => insightFunnelTakerateDrop(),
    () => insightFunnelNoUpsell(),
    () => insightFunnelDownsellSaver(),
    () => insightFunnelTakerateImprove(prodResp),
    // ---- novos (OPERATIONS) ----
    () => insightOpsPeakByDay(filters),
    () => insightOpsDowDip(filters),
    () => insightOpsPlatformStale(),
    // ---- Quality cohort (refunds/chargebacks) ----
    () => insightRefundTime(),
    () => insightSkuRefundRank(),
    () => insightSkuCbRank(),
    () => insightFeVsFunnelRefund(),
    () => insightAffD60Cohort(),
    () => insightAffBadQualityRank(affResp),
    () => insightVslQuality(),
  ]) {
    try {
      const arr = await fn();
      insights.push(...arr);
    } catch (err) {
      console.error('[insights] calc failed:', err);
    }
  }

  // Sort: alerts first, then insights, then good. Within tier, by category.
  const tier = (s: InsightSeverity) => (s === 'alert' ? 0 : s === 'insight' ? 1 : 2);
  insights.sort((a, b) => tier(a.severity) - tier(b.severity) || a.category.localeCompare(b.category));

  return {
    insights,
    generatedAt: now.toISOString(),
    windowDays: WINDOW_DAYS,
  };
}

// ============================================================
// A1 — Top afiliado por receita ≠ top por lucro
//      Usa session-attribution: o lucro inclui o funil completo
//      (FE + UPs/DWs/bumps) das sessões trazidas pelo afiliado, não
//      só os pedidos onde ele está no affiliateId.
// ============================================================
function insightA1(aff: AffiliatesResponse): Insight[] {
  const withProfit = aff.affiliates.filter((a) => a.attributedSessions >= 5);
  if (withProfit.length < 2) return [];

  const byRev = [...withProfit].sort((a, b) => b.attributedRevenue - a.attributedRevenue);
  const byProfit = [...withProfit].sort((a, b) => b.attributedProfit - a.attributedProfit);
  const topRev = byRev[0];
  const topProfit = byProfit[0];
  if (topRev.externalId === topProfit.externalId) return [];

  const revMargin = topRev.attributedRevenue > 0 ? topRev.attributedProfit / topRev.attributedRevenue : 0;
  const profitMargin = topProfit.attributedRevenue > 0 ? topProfit.attributedProfit / topProfit.attributedRevenue : 0;
  if (Math.abs(profitMargin - revMargin) < 0.05) return [];

  return [{
    id: 'a1-rank-mismatch',
    category: 'profit',
    severity: 'insight',
    headline: `Top afiliado por receita não é o top por lucro (atribuído à sessão)`,
    body: `Considerando o funil completo das sessões: ${topRev.nickname || topRev.externalId} traz ${fmt(topRev.attributedRevenue)} em receita mas gera ${fmt(topRev.attributedProfit)} de lucro (margem ${pct(revMargin)}). Comparativamente ${topProfit.nickname || topProfit.externalId} gera ${fmt(topProfit.attributedRevenue)} → ${fmt(topProfit.attributedProfit)} (margem ${pct(profitMargin)}).`,
    metrics: [
      { label: `Top receita atribuída`, value: `${topRev.nickname || topRev.externalId} · ${fmt(topRev.attributedRevenue)} · ${pct(revMargin)} margem` },
      { label: `Top lucro atribuído`, value: `${topProfit.nickname || topProfit.externalId} · ${fmt(topProfit.attributedProfit)} · ${pct(profitMargin)} margem` },
    ],
    cta: { label: 'Abrir Ranking', href: '/leaderboard' },
  }];
}

// ============================================================
// B1 — Afiliados dando prejuízo (visão atribuída à sessão)
//      Conta a sessão completa do lead: se o afiliado traz volume mas
//      o lead converte bem em UPs, ele pode ser rentável apesar do CPA
//      alto. Só sinaliza prejuízo quando o funil INTEIRO é negativo.
// ============================================================
function insightB1(aff: AffiliatesResponse): Insight[] {
  const losers = aff.affiliates
    .filter((a) => a.attributedSessions >= 5 && a.attributedProfit < 0)
    .sort((a, b) => a.attributedProfit - b.attributedProfit);
  if (losers.length === 0) return [];

  const totalLoss = losers.reduce((s, a) => s + a.attributedProfit, 0);
  const top3 = losers.slice(0, 3).map((a) =>
    `${a.nickname || a.externalId} (${fmt(a.attributedProfit)} em ${a.attributedSessions} sessões / ${a.attributedOrders} pedidos)`,
  ).join(' · ');

  return [{
    id: 'b1-affiliates-losing',
    category: 'affiliates',
    severity: 'alert',
    headline: `${losers.length} ${losers.length === 1 ? 'afiliado dá' : 'afiliados dão'} prejuízo no funil completo (${WINDOW_DAYS}d)`,
    body: `Mesmo contando as conversões em UPs/DWs trazidas pelos leads, esses afiliados ficam negativos. Total absorvido: ${fmt(totalLoss)}. Considerar reduzir CPA ou pausar tráfego.`,
    metrics: [
      { label: 'Top deficitários', value: top3 },
      { label: 'Prejuízo total', value: fmt(totalLoss) },
    ],
    cta: { label: 'Abrir Ranking', href: '/leaderboard' },
  }];
}

// ============================================================
// B3 — Concentração top 5
// ============================================================
function insightB3(aff: AffiliatesResponse): Insight[] {
  const c = aff.summary.concentration;
  if (c < 0.5) return []; // saudável
  return [{
    id: 'b3-concentration',
    category: 'affiliates',
    severity: c > 0.7 ? 'alert' : 'insight',
    headline: `Top 5 afiliados = ${pct(c)} do volume`,
    body: c > 0.7
      ? `Concentração crítica: se 1 afiliado sair, perda significativa. Diversificar a rede é prioridade.`
      : `Concentração elevada (acima de 50%). Vale começar a diversificar.`,
    metrics: [
      { label: 'Top 5 share', value: pct(c) },
      { label: 'Threshold saudável', value: '≤ 50%' },
    ],
    cta: { label: 'Ver afiliados', href: '/all-affiliates' },
  }];
}

// ============================================================
// B4 — Afiliados churning (silentes)
// ============================================================
async function insightB4(filters: MetricsFilters): Promise<Insight[]> {
  // Affiliates who: had ≥10 orders in days [60, 14] before now, and 0 orders
  // in last 14 days. They're "ghosting".
  const now = filters.endDate;
  const fortnightAgo = new Date(now.getTime() - 14 * 24 * 3600 * 1000);
  const sixtyAgo = new Date(now.getTime() - 60 * 24 * 3600 * 1000);

  // Group counts by affiliate in two windows.
  const recentByAff = await db.order.groupBy({
    by: ['affiliateId'],
    where: { affiliateId: { not: null }, orderedAt: { gte: fortnightAgo, lte: now } },
    _count: { _all: true },
  });
  const priorByAff = await db.order.groupBy({
    by: ['affiliateId'],
    where: { affiliateId: { not: null }, orderedAt: { gte: sixtyAgo, lt: fortnightAgo } },
    _count: { _all: true },
  });
  const recentSet = new Set(recentByAff.map((r) => r.affiliateId));
  const churnIds = priorByAff
    .filter((r) => r._count._all >= 10 && !recentSet.has(r.affiliateId))
    .map((r) => r.affiliateId!);

  if (churnIds.length === 0) return [];

  const churns = await db.affiliate.findMany({
    where: { id: { in: churnIds } },
    select: { externalId: true, nickname: true, lastOrderAt: true,
              platform: { select: { slug: true } } },
  });
  const sorted = churns.sort((a, b) =>
    (b.lastOrderAt?.getTime() ?? 0) - (a.lastOrderAt?.getTime() ?? 0));
  const top3 = sorted.slice(0, 3)
    .map((a) => `${a.nickname || a.externalId} (última venda ${a.lastOrderAt ? fmtDateAgo(a.lastOrderAt) : 'n/d'})`)
    .join(' · ');

  return [{
    id: 'b4-churning',
    category: 'affiliates',
    severity: 'alert',
    headline: `${churns.length} ${churns.length === 1 ? 'afiliado sumiu' : 'afiliados sumiram'} (eram ativos há 14d+)`,
    body: `Afiliados que rodavam consistente (≥10 pedidos em 60-14d atrás) sem nenhuma venda nas últimas 2 semanas. Vale alerta na rede.`,
    metrics: [
      { label: 'Casos', value: top3 },
      { label: 'Total', value: `${churns.length} afiliados` },
    ],
    cta: { label: 'Ver todos os afiliados', href: '/all-affiliates' },
  }];
}

// ============================================================
// B5 — Take rate de upsell anômala por afiliado
// ============================================================
async function insightB5(filters: MetricsFilters): Promise<Insight[]> {
  // For each (affiliate, family), compute UP take rate = upsell-bearing
  // sessions / FE sessions for that affiliate. Compare to family-wide
  // average. Surface affiliates with materially higher rates (>=10pp
  // above avg, n>=10 FE sessions).
  const orders = await db.order.findMany({
    where: {
      orderedAt: { gte: filters.startDate, lte: filters.endDate },
      status: 'APPROVED',
      affiliateId: { not: null },
    },
    select: {
      affiliateId: true, parentExternalId: true, externalId: true,
      productType: true,
      product: { select: { family: true } },
      affiliate: { select: { externalId: true, nickname: true } },
      platform: { select: { slug: true } },
    },
  });

  // Group: (family, affiliateId) → set of session keys with FE / set with UP
  interface Bucket { feSessions: Set<string>; upSessions: Set<string>; affRef: { externalId: string; nickname: string | null; platform: string } }
  const byFamAff = new Map<string, Bucket>();
  // Family totals for baseline avg
  const famTotalsAcc = new Map<string, { fe: Set<string>; up: Set<string> }>();

  for (const o of orders) {
    const family = o.product.family;
    if (!family || !o.affiliate) continue;
    const session = `${o.platform.slug}:${o.parentExternalId ?? o.externalId}`;

    const fk = `${family}|${o.affiliateId}`;
    let b = byFamAff.get(fk);
    if (!b) {
      b = {
        feSessions: new Set(), upSessions: new Set(),
        affRef: { externalId: o.affiliate.externalId, nickname: o.affiliate.nickname, platform: o.platform.slug },
      };
      byFamAff.set(fk, b);
    }
    let ft = famTotalsAcc.get(family);
    if (!ft) { ft = { fe: new Set(), up: new Set() }; famTotalsAcc.set(family, ft); }

    if (o.productType === 'FRONTEND') { b.feSessions.add(session); ft.fe.add(session); }
    if (o.productType === 'UPSELL')   { b.upSessions.add(session); ft.up.add(session); }
  }

  // Family avg take rate
  const famAvg = new Map<string, number>();
  for (const [fam, t] of famTotalsAcc.entries()) {
    famAvg.set(fam, t.fe.size > 0 ? t.up.size / t.fe.size : 0);
  }

  const winners: Array<{ family: string; aff: Bucket['affRef']; rate: number; avg: number; fe: number; up: number; lift: number }> = [];
  for (const [key, b] of byFamAff.entries()) {
    const family = key.split('|')[0];
    if (b.feSessions.size < 10) continue; // sample too small
    const personal = b.upSessions.size / b.feSessions.size;
    const avg = famAvg.get(family) ?? 0;
    if (personal - avg < 0.10) continue; // need >=10pp lift
    winners.push({ family, aff: b.affRef, rate: personal, avg, fe: b.feSessions.size, up: b.upSessions.size, lift: personal - avg });
  }
  if (winners.length === 0) return [];

  winners.sort((a, b) => b.lift - a.lift);
  const top = winners[0];
  return [{
    id: 'b5-upsell-outlier',
    category: 'affiliates',
    severity: 'good',
    headline: `${top.aff.nickname || top.aff.externalId} converte ${pct(top.rate)} em UP da ${top.family}`,
    body: `Média da família ${top.family} é ${pct(top.avg)} (${pct(top.lift)} pontos a mais). Algo no tráfego desse afiliado vale entender e replicar nos outros.`,
    metrics: [
      { label: 'Sessões FE / UP', value: `${top.fe} / ${top.up}` },
      { label: 'Lift sobre a média', value: `+${pct(top.lift)}` },
    ],
  }];
}

// ============================================================
// C4 — SKU com margem ruim
//      Pra SKUs FE: usa attributedMarginPct (funil completo da sessão).
//      Um FE pode parecer prejuízo standalone mas recuperar com os
//      upsells trazidos pelo lead — só sinaliza quando o funil INTEIRO
//      ainda fica negativo.
//      Pra SKUs backend (UP/DW/RC): usa direct (são partes da sessão,
//      não a originam).
// ============================================================
function insightC4(prod: ProductsResponse): Insight[] {
  const losers = prod.products
    .filter((p) => {
      if (p.orders < 5) return false;
      // FE: julga pelo lucro atribuído (funil completo)
      if (p.productType === 'FRONTEND' && p.attributedSessions >= 3) {
        return p.attributedMarginPct < 0;
      }
      // Backend: julga pelo lucro direto (sua própria contribuição)
      return p.estimatedMarginPct < 0;
    })
    .sort((a, b) => {
      const am = a.productType === 'FRONTEND' ? a.attributedMarginPct : a.estimatedMarginPct;
      const bm = b.productType === 'FRONTEND' ? b.attributedMarginPct : b.estimatedMarginPct;
      return am - bm;
    });
  if (losers.length === 0) return [];

  const top = losers.slice(0, 3).map((p) => {
    const isFE = p.productType === 'FRONTEND';
    const margin = isFE ? p.attributedMarginPct : p.estimatedMarginPct;
    const profit = isFE ? p.attributedProfit : p.estimatedProfit;
    const note = isFE ? ' (funil completo)' : '';
    return `${p.name} (${margin.toFixed(1)}% margem · ${fmt(profit)} em ${p.orders} pedidos${note})`;
  }).join(' · ');

  return [{
    id: 'c4-sku-loss',
    category: 'funnel',
    severity: 'alert',
    headline: `${losers.length} ${losers.length === 1 ? 'SKU está' : 'SKUs estão'} com margem negativa`,
    body: `Pra SKUs FE, a margem conta o funil INTEIRO (FE + UPs/DWs trazidos pelo lead). Mesmo assim ficam negativos — algo no preço, CPA ou conversão de upsell precisa de revisão. Considerar ajustar preço, reduzir CPA ou retirar do funil.`,
    metrics: [
      { label: 'Casos', value: top },
    ],
    cta: { label: 'Abrir Produtos', href: '/products' },
  }];
}

// ============================================================
// D1 — Hora dourada
// ============================================================
async function insightD1(filters: MetricsFilters): Promise<Insight[]> {
  const rows = await db.$queryRaw<Array<{ dow: number; hour: number; orders: bigint }>>(Prisma.sql`
    SELECT EXTRACT(DOW FROM "orderedAt")::int AS dow,
           EXTRACT(HOUR FROM "orderedAt")::int AS hour,
           COUNT(*) FILTER (WHERE status='APPROVED')::bigint AS orders
    FROM "Order"
    WHERE "orderedAt" >= ${filters.startDate} AND "orderedAt" <= ${filters.endDate}
    GROUP BY 1, 2
    HAVING COUNT(*) FILTER (WHERE status='APPROVED') > 0
  `);
  if (rows.length === 0) return [];
  const cells = rows.map((r) => ({ dow: r.dow, hour: r.hour, orders: Number(r.orders) }));
  const ordersDesc = [...cells].sort((a, b) => b.orders - a.orders);
  const top = ordersDesc[0];
  const total = cells.reduce((s, c) => s + c.orders, 0);
  const median = ordersDesc[Math.floor(ordersDesc.length / 2)]?.orders ?? 1;
  const ratio = top.orders / Math.max(1, median);
  if (ratio < 4) return [];

  const dows = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  return [{
    id: 'd1-hot-hour',
    category: 'operations',
    severity: 'good',
    headline: `${dows[top.dow]} ${String(top.hour).padStart(2, '0')}:00 UTC concentra ${pct(top.orders / total)} das vendas`,
    body: `O slot mais quente da semana — ${top.orders} pedidos vs mediana de ${median}/h (${ratio.toFixed(1)}x). Concentrar push de tráfego e oncall nesse horário.`,
    metrics: [
      { label: 'Pedidos no slot', value: String(top.orders) },
      { label: 'Vs mediana', value: `${ratio.toFixed(1)}× ${median}` },
    ],
    cta: { label: 'Ver heatmap', href: '/overview' },
  }];
}

// ============================================================
// D4 — Método de pagamento com refund anômalo
// ============================================================
async function insightD4(filters: MetricsFilters): Promise<Insight[]> {
  const rows = await db.$queryRaw<Array<{ method: string; total: bigint; refunds: bigint }>>(Prisma.sql`
    SELECT
      COALESCE("paymentMethod", 'unknown') AS method,
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE status='REFUNDED')::bigint AS refunds
    FROM "Order"
    WHERE "orderedAt" >= ${filters.startDate} AND "orderedAt" <= ${filters.endDate}
    GROUP BY 1
    HAVING COUNT(*) >= 20
  `);
  if (rows.length < 2) return [];
  const stats = rows.map((r) => ({
    method: r.method,
    total: Number(r.total),
    refunds: Number(r.refunds),
    rate: Number(r.refunds) / Math.max(1, Number(r.total)),
  }));
  const allTotal = stats.reduce((s, x) => s + x.total, 0);
  const allRefunds = stats.reduce((s, x) => s + x.refunds, 0);
  const globalRate = allRefunds / Math.max(1, allTotal);

  // Outliers: rate >= 2× global AND difference > 1pp.
  const outliers = stats.filter((s) =>
    s.rate >= globalRate * 2 && (s.rate - globalRate) > 0.01,
  );
  if (outliers.length === 0) return [];
  outliers.sort((a, b) => b.rate - a.rate);
  const worst = outliers[0];
  return [{
    id: 'd4-payment-refund',
    category: 'operations',
    severity: 'alert',
    headline: `${worst.method} tem refund rate ${(worst.rate * 100).toFixed(1)}% (${(worst.rate / globalRate).toFixed(1)}× a média)`,
    body: `Método de pagamento com taxa de refund anormal vs baseline ${pct(globalRate)}. Vale revisar fraude/aceitação.`,
    metrics: [
      { label: 'Pedidos / refunds', value: `${worst.total} / ${worst.refunds}` },
      { label: 'Outros métodos', value: `${pct(globalRate)} médio` },
    ],
  }];
}

// ============================================================
// D5 — Refunds tardios
// ============================================================
async function insightD5(filters: MetricsFilters): Promise<Insight[]> {
  // Refunds that landed in last 7d for orders that are >30d old. They
  // distort historical KPIs.
  const sevenAgo = new Date(filters.endDate.getTime() - 7 * 24 * 3600 * 1000);
  const rows = await db.$queryRaw<Array<{ count: bigint; total: Prisma.Decimal }>>(Prisma.sql`
    SELECT
      COUNT(*)::bigint AS count,
      COALESCE(SUM("grossAmountUsd"), 0)::numeric(14,2) AS total
    FROM "Order"
    WHERE "status" = 'REFUNDED'
      AND "refundedAt" >= ${sevenAgo}
      AND ("refundedAt" - "orderedAt") > INTERVAL '30 days'
  `);
  const r = rows[0];
  const count = r ? Number(r.count) : 0;
  const total = r ? Number(r.total) : 0;
  if (count === 0) return [];

  return [{
    id: 'd5-late-refunds',
    category: 'operations',
    severity: 'insight',
    headline: `${count} refunds tardios (>30d) nos últimos 7 dias · ${fmt(total)} retroativo`,
    body: `Esses reembolsos chegaram pra orders antigas. Comem KPIs do passado mas não da semana atual. Os números de meses anteriores podem mudar conforme refunds tardios continuam chegando — esperar mais 30d antes de fechar mês.`,
    metrics: [
      { label: 'Quantidade', value: String(count) },
      { label: 'Volume retroativo', value: fmt(total) },
    ],
  }];
}

// ============================================================
// P-ROAS — Família com ROAS negativo nos últimos 14d
//   Janela menor que os 30d gerais pra surfar problemas frescos:
//   net - cpa - cogs - fulfillment < 0 com volume material.
//   Action: pausar campanhas ou revisar CPA imediato.
// ============================================================
async function insightProfitRoas(): Promise<Insight[]> {
  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000);
  const rows = await db.$queryRaw<Array<{
    family: string;
    net: Prisma.Decimal;
    cpa: Prisma.Decimal;
    cogs: Prisma.Decimal;
    fulfillment: Prisma.Decimal;
    orders: bigint;
  }>>(Prisma.sql`
    SELECT p.family AS family,
           COALESCE(SUM(o."netAmountUsd"), 0)::numeric(14,2) AS net,
           COALESCE(SUM(o."cpaPaidUsd"), 0)::numeric(14,2) AS cpa,
           COALESCE(SUM(o."cogsUsd"), 0)::numeric(14,2) AS cogs,
           COALESCE(SUM(o."fulfillmentUsd"), 0)::numeric(14,2) AS fulfillment,
           COUNT(*)::bigint AS orders
    FROM "Order" o
    JOIN "Product" p ON p.id = o."productId"
    WHERE o."orderedAt" >= ${since}
      AND o.status = 'APPROVED'
      AND p.family IS NOT NULL
    GROUP BY p.family
    HAVING COUNT(*) >= 10
  `);

  const losers = rows.map((r) => {
    const net = Number(r.net), cpa = Number(r.cpa), cogs = Number(r.cogs), ff = Number(r.fulfillment);
    return { family: r.family, profit: net - cpa - cogs - ff, net, cpa, cogs, ff, orders: Number(r.orders) };
  }).filter((r) => r.profit < 0);

  if (losers.length === 0) return [];
  losers.sort((a, b) => a.profit - b.profit);
  const out: Insight[] = [];
  for (const l of losers.slice(0, 3)) {
    out.push({
      id: `p-roas-neg-${l.family.toLowerCase()}`,
      category: 'profit',
      severity: 'alert',
      headline: `${l.family} com ROAS negativo: ${fmt(l.profit)} em 14d`,
      body: `Net ${fmt(l.net)} − CPA ${fmt(l.cpa)} − COGS ${fmt(l.cogs)} − Fulfillment ${fmt(l.ff)} = ${fmt(l.profit)}. Pausar campanhas ou rever CPA imediato.`,
      metrics: [
        { label: 'Pedidos (14d)', value: String(l.orders) },
        { label: 'Margem por pedido', value: fmt(l.profit / Math.max(1, l.orders)) },
      ],
      cta: { label: 'Abrir Produtos', href: '/products' },
    });
  }
  return out;
}

// ============================================================
// P-REFUND-COST — SKU com refunds devorando margem
//   Refund-rate só conta % de pedidos; aqui mostramos o tamanho do
//   buraco em USD (revenue perdida + COGS/fulfillment já enviados).
// ============================================================
async function insightProfitRefundCost(prod: ProductsResponse): Promise<Insight[]> {
  // Buscar refunded gross + cogs por SKU diretamente (getProducts agrega
  // mas não expõe refunded_gross/refunded_cogs separados). Janela 30d.
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000);
  const rows = await db.$queryRaw<Array<{
    externalId: string;
    name: string;
    refundedGross: Prisma.Decimal;
    refundedCogs: Prisma.Decimal;
    refundedFulfillment: Prisma.Decimal;
    refunds: bigint;
    total: bigint;
  }>>(Prisma.sql`
    SELECT p."externalId" AS "externalId",
           p.name AS name,
           COALESCE(SUM(o."originalGrossUsd") FILTER (WHERE o.status='REFUNDED'), 0)::numeric(14,2) AS "refundedGross",
           COALESCE(SUM(o."cogsUsd") FILTER (WHERE o.status='REFUNDED'), 0)::numeric(14,2) AS "refundedCogs",
           COALESCE(SUM(o."fulfillmentUsd") FILTER (WHERE o.status='REFUNDED'), 0)::numeric(14,2) AS "refundedFulfillment",
           COUNT(*) FILTER (WHERE o.status='REFUNDED')::bigint AS refunds,
           COUNT(*)::bigint AS total
    FROM "Order" o
    JOIN "Product" p ON p.id = o."productId"
    WHERE o."orderedAt" >= ${since}
    GROUP BY p."externalId", p.name
    HAVING COUNT(*) >= 20
       AND COUNT(*) FILTER (WHERE o.status='REFUNDED')::float / COUNT(*) >= 0.15
  `);

  if (rows.length === 0) return [];
  const items = rows.map((r) => {
    const refundedGross = Math.abs(Number(r.refundedGross));
    const sunkCogs = Math.abs(Number(r.refundedCogs)) + Math.abs(Number(r.refundedFulfillment));
    const lost = refundedGross + sunkCogs;
    const refunds = Number(r.refunds), total = Number(r.total);
    return { ...r, externalId: r.externalId, name: r.name, refundedGross, sunkCogs, lost, refunds, total, rate: refunds / total };
  }).sort((a, b) => b.lost - a.lost);

  const top = items[0];
  const others = items.slice(1, 3).map((i) => `${i.name} (${pct(i.rate)} · ${fmt(i.lost)})`).join(' · ');

  return [{
    id: 'p-refund-cost',
    category: 'profit',
    severity: 'alert',
    headline: `${top.name}: ${pct(top.rate)} de refund engoliu ${fmt(top.lost)} em 30d`,
    body: `Inclui receita perdida (${fmt(top.refundedGross)}) + COGS/fulfillment já enviados (${fmt(top.sunkCogs)}). Threshold da listagem: refund-rate ≥ 15% e ≥ 20 pedidos.`,
    metrics: [
      { label: 'Refunds / Total', value: `${top.refunds} / ${top.total}` },
      { label: 'Outros impactados', value: others || 'só este SKU' },
    ],
    cta: { label: 'Abrir Produtos', href: '/products' },
  }];
}

// ============================================================
// P-UPSELL-ZERO — Backend rodando perto do zero de margem
//   SKU UP/DW com take-rate decente mas margem unitária mínima.
//   Esforço alto pra retorno baixo: vale repensar o slot.
// ============================================================
function insightProfitUpsellZero(prod: ProductsResponse): Insight[] {
  const candidates = prod.products
    .filter((p) =>
      (p.productType === 'UPSELL' || p.productType === 'DOWNSELL') &&
      p.orders >= 20,
    )
    .map((p) => ({ ...p, profitPerSale: (p.estimatedProfit ?? 0) / Math.max(1, p.orders) }))
    .filter((p) => p.profitPerSale < 5 && p.profitPerSale > -5) // perto de zero
    .sort((a, b) => a.profitPerSale - b.profitPerSale);

  if (candidates.length === 0) return [];
  const out: Insight[] = [];
  for (const c of candidates.slice(0, 3)) {
    out.push({
      id: `p-upsell-zero-${c.externalId}`,
      category: 'profit',
      severity: 'insight',
      headline: `${c.name} rende ${fmt(c.profitPerSale)} por venda`,
      body: `Esse backend converte (${c.orders} pedidos em 30d) mas a margem por venda após COGS/fulfillment é desprezível. Considere: subir o preço, reduzir COGS (negociar fornecedor), ou substituir por outro produto no mesmo slot.`,
      metrics: [
        { label: 'Receita / Lucro 30d', value: `${fmt(c.revenue)} / ${fmt(c.estimatedProfit ?? 0)}` },
        { label: 'Margem unitária', value: fmt(c.profitPerSale) },
      ],
    });
  }
  return out;
}

// ============================================================
// P-AFF-UNDERPRICED — Afiliado AOV alto pagando CPA padrão
//   AOV global ≥ 2× mediana mas CPA por venda na média do catálogo.
//   Risco: concorrência leva ele com tier mais alto.
// ============================================================
function insightProfitAffUnderpriced(aff: AffiliatesResponse): Insight[] {
  const eligible = aff.affiliates.filter((a) => a.attributedSessions >= 10 && a.attributedRevenue > 0);
  if (eligible.length < 5) return [];

  const aovs = eligible.map((a) => a.attributedRevenue / a.attributedSessions);
  const sorted = [...aovs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median <= 0) return [];

  const cpasPerSale = eligible
    .map((a) => a.orders > 0 ? a.cpa / a.orders : 0)
    .filter((c) => c > 0);
  const medianCpa = [...cpasPerSale].sort((a, b) => a - b)[Math.floor(cpasPerSale.length / 2)] ?? 0;

  const winners = eligible
    .map((a) => ({
      ...a,
      aov: a.attributedRevenue / a.attributedSessions,
      cpaPerSale: a.orders > 0 ? a.cpa / a.orders : 0,
    }))
    .filter((a) => a.aov >= median * 2 && a.cpaPerSale <= medianCpa * 1.3)
    .sort((a, b) => b.aov - a.aov);

  if (winners.length === 0) return [];
  const top = winners.slice(0, 3).map((w) =>
    `${w.nickname || w.externalId} (AOV ${fmt(w.aov)} · CPA/venda ${fmt(w.cpaPerSale)})`,
  ).join(' · ');

  return [{
    id: 'p-aff-underpriced',
    category: 'profit',
    severity: 'insight',
    headline: `${winners.length} ${winners.length === 1 ? 'afiliado entrega' : 'afiliados entregam'} AOV alto pagando CPA padrão`,
    body: `AOV global ≥ 2× a mediana (${fmt(median)}) mas CPA na média do mercado. Risco: concorrente leva eles com tier maior. Considere boost de CPA condicionado a manter quality bar.`,
    metrics: [
      { label: 'Casos', value: top },
      { label: 'Mediana AOV / CPA', value: `${fmt(median)} / ${fmt(medianCpa)}` },
    ],
    cta: { label: 'Abrir Ranking', href: '/leaderboard' },
  }];
}

// ============================================================
// A-TRAFFIC-DROP — Afiliado com queda brusca de tráfego
//   Pedidos esta semana < 40% da média semanal das 4 anteriores
//   AND média prévia ≥ 5/sem (pra evitar ruído de afiliado pequeno).
//   Mensagem CONVITE pra investigar (não acusação): pode ser pausa
//   programada, problema técnico, mudança de estratégia.
// ============================================================
async function insightAffTrafficDrop(): Promise<Insight[]> {
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const fiveWeeksAgo = new Date(now.getTime() - 35 * 24 * 3600 * 1000);

  const rows = await db.$queryRaw<Array<{
    affiliateId: string;
    thisWeek: bigint;
    prior4w: bigint;
    externalId: string;
    nickname: string | null;
    platformSlug: string;
  }>>(Prisma.sql`
    SELECT o."affiliateId" AS "affiliateId",
           COUNT(*) FILTER (WHERE o."orderedAt" >= ${oneWeekAgo})::bigint AS "thisWeek",
           COUNT(*) FILTER (WHERE o."orderedAt" >= ${fiveWeeksAgo} AND o."orderedAt" < ${oneWeekAgo})::bigint AS "prior4w",
           a."externalId" AS "externalId",
           a.nickname AS nickname,
           pl.slug AS "platformSlug"
    FROM "Order" o
    JOIN "Affiliate" a ON a.id = o."affiliateId"
    JOIN "Platform" pl ON pl.id = a."platformId"
    WHERE o."affiliateId" IS NOT NULL
      AND o."orderedAt" >= ${fiveWeeksAgo}
    GROUP BY o."affiliateId", a."externalId", a.nickname, pl.slug
    HAVING COUNT(*) FILTER (WHERE o."orderedAt" >= ${fiveWeeksAgo} AND o."orderedAt" < ${oneWeekAgo}) >= 20
  `);

  const drops = rows.map((r) => {
    const thisWeek = Number(r.thisWeek);
    const priorAvg = Number(r.prior4w) / 4;
    const ratio = priorAvg > 0 ? thisWeek / priorAvg : 1;
    return { ...r, thisWeek, priorAvg, ratio };
  }).filter((r) => r.ratio < 0.4 && r.priorAvg >= 5)
    .sort((a, b) => a.ratio - b.ratio);

  if (drops.length === 0) return [];
  const out: Insight[] = [];
  for (const d of drops.slice(0, 3)) {
    out.push({
      id: `a-traffic-drop-${d.affiliateId}`,
      category: 'affiliates',
      severity: 'alert',
      headline: `${d.nickname || d.externalId}: queda brusca de tráfego (-${pct(1 - d.ratio)})`,
      body: `Esta semana: ${d.thisWeek} pedidos. Média das 4 semanas anteriores: ${d.priorAvg.toFixed(1)}/sem. Vale chamar pra entender — pausou campanha? mudou de produto? problema com link/postback? Iniciar conversa antes de presumir churn.`,
      metrics: [
        { label: 'Esta semana / média prévia', value: `${d.thisWeek} / ${d.priorAvg.toFixed(1)}` },
        { label: 'Plataforma', value: d.platformSlug === 'digistore24' ? 'D24' : 'CB' },
      ],
      cta: { label: 'Abrir afiliado', href: `/all-affiliates?aff=${encodeURIComponent(d.externalId)}` },
    });
  }
  return out;
}

// ============================================================
// A-REFUND-FINGERPRINT — Afiliado com refund-rate anormal
//   refund-rate ≥ 2× a média global E pedidos ≥ 10 (anti-ruído).
// ============================================================
function insightAffRefundFingerprint(aff: AffiliatesResponse): Insight[] {
  const all = aff.affiliates.filter((a) => a.allOrders >= 10);
  if (all.length === 0) return [];
  const totalOrders = all.reduce((s, a) => s + a.allOrders, 0);
  const totalRefunds = all.reduce((s, a) => s + a.refunds, 0);
  if (totalOrders === 0) return [];
  const globalRate = totalRefunds / totalOrders;
  if (globalRate < 0.01) return []; // base muito baixa, não vale comparar

  const offenders = all
    .filter((a) => a.refundRate >= globalRate * 2 && (a.refundRate - globalRate) > 0.02)
    .sort((a, b) => b.refundRate - a.refundRate);

  if (offenders.length === 0) return [];
  const top = offenders.slice(0, 3).map((o) =>
    `${o.nickname || o.externalId} (${pct(o.refundRate)} · ${o.refunds}/${o.allOrders})`,
  ).join(' · ');

  return [{
    id: 'a-refund-fingerprint',
    category: 'affiliates',
    severity: 'alert',
    headline: `${offenders.length} ${offenders.length === 1 ? 'afiliado tem' : 'afiliados têm'} refund-rate anormal (≥ 2× média)`,
    body: `Padrão típico de tráfego de baixa qualidade ou audiência incompatível com a oferta. Vale revisar fonte do tráfego ou pausar antes que afete reputação na plataforma.`,
    metrics: [
      { label: 'Casos', value: top },
      { label: 'Média global', value: pct(globalRate) },
    ],
    cta: { label: 'Abrir Ranking', href: '/leaderboard?sortBy=refundRate' },
  }];
}

// ============================================================
// F-TAKERATE-DROP — Take-rate em queda
//   Por (família, step), compara take-rate desta semana vs média
//   das 4 anteriores. Drop > 30% E volume material (≥ 20 FE/sem).
// ============================================================
async function insightFunnelTakerateDrop(): Promise<Insight[]> {
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const fiveWeeksAgo = new Date(now.getTime() - 35 * 24 * 3600 * 1000);

  // Volume por (família, productType, funnelStep) em duas janelas.
  const rows = await db.$queryRaw<Array<{
    family: string;
    productType: string;
    funnelStep: number | null;
    thisWeek: bigint;
    prior4w: bigint;
  }>>(Prisma.sql`
    SELECT p.family AS family,
           o."productType"::text AS "productType",
           o."funnelStep" AS "funnelStep",
           COUNT(*) FILTER (WHERE o."orderedAt" >= ${oneWeekAgo} AND o.status='APPROVED')::bigint AS "thisWeek",
           COUNT(*) FILTER (WHERE o."orderedAt" >= ${fiveWeeksAgo} AND o."orderedAt" < ${oneWeekAgo} AND o.status='APPROVED')::bigint AS "prior4w"
    FROM "Order" o
    JOIN "Product" p ON p.id = o."productId"
    WHERE o."orderedAt" >= ${fiveWeeksAgo}
      AND p.family IS NOT NULL
    GROUP BY p.family, o."productType", o."funnelStep"
  `);

  // Pivot: pra cada família, FE this/prior + UP/DW por step this/prior.
  type StepCounts = { thisWeek: number; prior4w: number };
  const fam = new Map<string, { fe: StepCounts; ups: Map<number, StepCounts>; dws: Map<number, StepCounts> }>();
  for (const r of rows) {
    const f = fam.get(r.family) ?? { fe: { thisWeek: 0, prior4w: 0 }, ups: new Map(), dws: new Map() };
    fam.set(r.family, f);
    const tw = Number(r.thisWeek), pw = Number(r.prior4w);
    if (r.productType === 'FRONTEND') {
      f.fe.thisWeek += tw; f.fe.prior4w += pw;
    } else if (r.productType === 'UPSELL' && r.funnelStep != null) {
      const c = f.ups.get(r.funnelStep) ?? { thisWeek: 0, prior4w: 0 };
      c.thisWeek += tw; c.prior4w += pw; f.ups.set(r.funnelStep, c);
    } else if (r.productType === 'DOWNSELL' && r.funnelStep != null) {
      const c = f.dws.get(r.funnelStep) ?? { thisWeek: 0, prior4w: 0 };
      c.thisWeek += tw; c.prior4w += pw; f.dws.set(r.funnelStep, c);
    }
  }

  const drops: Array<{ family: string; label: string; thisRate: number; priorRate: number; drop: number }> = [];
  for (const [family, data] of fam) {
    const priorFEPerWeek = data.fe.prior4w / 4;
    if (priorFEPerWeek < 20 || data.fe.thisWeek < 5) continue; // amostra pequena
    for (const [step, c] of data.ups) {
      const thisRate = data.fe.thisWeek > 0 ? c.thisWeek / data.fe.thisWeek : 0;
      const priorRate = data.fe.prior4w > 0 ? c.prior4w / data.fe.prior4w : 0;
      if (priorRate < 0.05) continue; // baseline muito baixa
      const drop = priorRate > 0 ? (priorRate - thisRate) / priorRate : 0;
      if (drop > 0.3) drops.push({ family, label: `Upsell ${step - 1}`, thisRate, priorRate, drop });
    }
    for (const [step, c] of data.dws) {
      const thisRate = data.fe.thisWeek > 0 ? c.thisWeek / data.fe.thisWeek : 0;
      const priorRate = data.fe.prior4w > 0 ? c.prior4w / data.fe.prior4w : 0;
      if (priorRate < 0.05) continue;
      const drop = priorRate > 0 ? (priorRate - thisRate) / priorRate : 0;
      if (drop > 0.3) drops.push({ family, label: `Downsell ${step - 1}`, thisRate, priorRate, drop });
    }
  }

  if (drops.length === 0) return [];
  drops.sort((a, b) => b.drop - a.drop);
  const out: Insight[] = [];
  for (const d of drops.slice(0, 3)) {
    out.push({
      id: `f-takerate-drop-${d.family.toLowerCase()}-${d.label.replace(/\s/g, '')}`,
      category: 'funnel',
      severity: 'alert',
      headline: `${d.label} do ${d.family}: take-rate caiu ${pct(d.drop)} esta semana`,
      body: `${pct(d.priorRate)} (média 4 semanas anteriores) → ${pct(d.thisRate)} (esta semana). Possíveis causas: mudança no checkout, oferta esgotada/pausada, problema com o vídeo da página, bug no postback. Investigar antes de virar tendência.`,
      metrics: [
        { label: 'Take-rate antes / agora', value: `${pct(d.priorRate)} → ${pct(d.thisRate)}` },
      ],
      cta: { label: 'Abrir Funil', href: '/funnel' },
    });
  }
  return out;
}

// ============================================================
// F-NO-UPSELL — Família vendendo só FE
//   Razão (sessões com qualquer não-FE) / (sessões com FE) < 5%
//   E ≥ 20 FE no período. Indica funil sem upsell ofertado ou
//   conversão tão ruim que vira ruído.
// ============================================================
async function insightFunnelNoUpsell(): Promise<Insight[]> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000);
  const rows = await db.$queryRaw<Array<{
    family: string;
    feSessions: bigint;
    nonFeSessions: bigint;
    feRevenue: Prisma.Decimal;
  }>>(Prisma.sql`
    WITH session_data AS (
      SELECT pl.slug || ':' || COALESCE(o."parentExternalId", o."externalId") AS session_key,
             p.family AS family,
             BOOL_OR(o."productType"='FRONTEND' AND o.status='APPROVED') AS has_fe,
             BOOL_OR(o."productType" <> 'FRONTEND' AND o.status='APPROVED') AS has_non_fe,
             SUM(CASE WHEN o."productType"='FRONTEND' AND o.status='APPROVED' THEN o."grossAmountUsd" ELSE 0 END) AS fe_rev
      FROM "Order" o
      JOIN "Product" p ON p.id = o."productId"
      JOIN "Platform" pl ON pl.id = o."platformId"
      WHERE o."orderedAt" >= ${since}
        AND p.family IS NOT NULL
      GROUP BY 1, 2
    )
    SELECT family,
           COUNT(*) FILTER (WHERE has_fe)::bigint AS "feSessions",
           COUNT(*) FILTER (WHERE has_fe AND has_non_fe)::bigint AS "nonFeSessions",
           COALESCE(SUM(fe_rev) FILTER (WHERE has_fe), 0)::numeric(14,2) AS "feRevenue"
    FROM session_data
    GROUP BY family
    HAVING COUNT(*) FILTER (WHERE has_fe) >= 20
  `);

  const noUpsell = rows.map((r) => ({
    family: r.family,
    feSessions: Number(r.feSessions),
    nonFeSessions: Number(r.nonFeSessions),
    feRevenue: Number(r.feRevenue),
    rate: Number(r.feSessions) > 0 ? Number(r.nonFeSessions) / Number(r.feSessions) : 0,
  })).filter((r) => r.rate < 0.05);

  if (noUpsell.length === 0) return [];

  // Benchmark: maior rate da janela pra estimar potencial perdido.
  const bench = rows.map((r) =>
    Number(r.feSessions) > 0 ? Number(r.nonFeSessions) / Number(r.feSessions) : 0,
  ).reduce((a, b) => Math.max(a, b), 0);

  const out: Insight[] = [];
  for (const f of noUpsell) {
    const lostFactor = Math.max(0, bench - f.rate); // diff sobre o benchmark
    const estLost = f.feRevenue * lostFactor; // estimativa simplificada
    out.push({
      id: `f-no-upsell-${f.family.toLowerCase()}`,
      category: 'funnel',
      severity: 'insight',
      headline: `${f.family}: ${pct(f.rate)} das sessões compram algo além do FE`,
      body: `Funil parece estar só apresentando o FE. Benchmark do catálogo: ${pct(bench)}. Estimativa do que está sendo deixado na mesa em 30d: ${fmt(estLost)}. Verificar se UP/DW estão configurados na sales page e se o postback do upsell está funcionando.`,
      metrics: [
        { label: 'Sessões FE / com extras', value: `${f.feSessions} / ${f.nonFeSessions}` },
        { label: 'Benchmark do catálogo', value: pct(bench) },
      ],
      cta: { label: 'Abrir Funil', href: `/funnel?fam=${encodeURIComponent(f.family)}` },
    });
  }
  return out;
}

// ============================================================
// F-DOWNSELL-SAVER — Downsell recuperando rejeições do upsell
//   De sessões que recusaram UP1 (FE ✓ / UP1 ✗), quantas % aceitam DW1?
//   Se ≥ 30%, é um modelo replicável pras outras famílias.
// ============================================================
async function insightFunnelDownsellSaver(): Promise<Insight[]> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000);
  const rows = await db.$queryRaw<Array<{
    family: string;
    rejectedUp1: bigint;
    recoveredDw1: bigint;
    dw1Revenue: Prisma.Decimal;
  }>>(Prisma.sql`
    WITH session_data AS (
      SELECT pl.slug || ':' || COALESCE(o."parentExternalId", o."externalId") AS session_key,
             p.family AS family,
             BOOL_OR(o."productType"='FRONTEND' AND o.status='APPROVED') AS has_fe,
             BOOL_OR(o."productType"='UPSELL' AND o."funnelStep"=2 AND o.status='APPROVED') AS has_up1,
             BOOL_OR(o."productType"='DOWNSELL' AND o."funnelStep"=2 AND o.status='APPROVED') AS has_dw1,
             SUM(CASE WHEN o."productType"='DOWNSELL' AND o."funnelStep"=2 AND o.status='APPROVED'
                      THEN o."grossAmountUsd" ELSE 0 END) AS dw1_rev
      FROM "Order" o
      JOIN "Product" p ON p.id = o."productId"
      JOIN "Platform" pl ON pl.id = o."platformId"
      WHERE o."orderedAt" >= ${since}
        AND p.family IS NOT NULL
      GROUP BY 1, 2
    )
    SELECT family,
           COUNT(*) FILTER (WHERE has_fe AND NOT has_up1)::bigint AS "rejectedUp1",
           COUNT(*) FILTER (WHERE has_fe AND NOT has_up1 AND has_dw1)::bigint AS "recoveredDw1",
           COALESCE(SUM(dw1_rev) FILTER (WHERE has_fe AND NOT has_up1 AND has_dw1), 0)::numeric(14,2) AS "dw1Revenue"
    FROM session_data
    GROUP BY family
    HAVING COUNT(*) FILTER (WHERE has_fe AND NOT has_up1) >= 20
  `);

  const savers = rows.map((r) => {
    const rejected = Number(r.rejectedUp1);
    const recovered = Number(r.recoveredDw1);
    return {
      family: r.family,
      rejected,
      recovered,
      revenue: Number(r.dw1Revenue),
      recoveryRate: rejected > 0 ? recovered / rejected : 0,
    };
  }).filter((r) => r.recoveryRate >= 0.3 && r.recovered >= 10)
    .sort((a, b) => b.recoveryRate - a.recoveryRate);

  if (savers.length === 0) return [];
  const top = savers[0];
  const others = savers.slice(1, 3).map((s) => `${s.family} ${pct(s.recoveryRate)}`).join(' · ');

  return [{
    id: 'f-downsell-saver',
    category: 'funnel',
    severity: 'good',
    headline: `${top.family}: DW1 recupera ${pct(top.recoveryRate)} de quem rejeitou UP1`,
    body: `${top.recovered} sessões recuperadas via DW1, gerando ${fmt(top.revenue)} extra em 30d. Modelo digno de replicar nas outras famílias. Revisar oferta DW + condições de gatilho.`,
    metrics: [
      { label: 'Rejeições UP1 / Recuperações DW1', value: `${top.rejected} / ${top.recovered}` },
      { label: 'Outras famílias com bom recovery', value: others || '—' },
    ],
    cta: { label: 'Abrir Funil', href: '/funnel' },
  }];
}

// ============================================================
// F-TAKERATE-IMPROVE — Step com take-rate baixo, sugerir mudanças
//   Backend SKU com take-rate < 5% E volume elevado de sessões FE
//   relacionadas (≥ 30 FE da mesma família). Não sugere remover —
//   sugere o que testar pra subir conversão.
// ============================================================
function insightFunnelTakerateImprove(prod: ProductsResponse): Insight[] {
  // Computar take-rate aproximada por SKU backend = orders / FE da família.
  const fePerFamily = new Map<string, number>();
  for (const p of prod.products) {
    if (p.productType === 'FRONTEND' && p.family) {
      fePerFamily.set(p.family, (fePerFamily.get(p.family) ?? 0) + p.orders);
    }
  }
  if (fePerFamily.size === 0) return [];

  // Benchmark: take-rate médio por productType no catálogo (UPSELL vs
  // DOWNSELL). Não temos funnelStep no Product (é per-order), então
  // benchmark fica por categoria — menos preciso mas acionável.
  const benchAcc = new Map<string, { sum: number; n: number }>();
  for (const p of prod.products) {
    if ((p.productType !== 'UPSELL' && p.productType !== 'DOWNSELL') || !p.family) continue;
    const fe = fePerFamily.get(p.family) ?? 0;
    if (fe < 30 || p.orders < 1) continue;
    const rate = p.orders / fe;
    const key = p.productType;
    const acc = benchAcc.get(key) ?? { sum: 0, n: 0 };
    acc.sum += rate; acc.n += 1; benchAcc.set(key, acc);
  }

  const candidates = prod.products
    .filter((p) => (p.productType === 'UPSELL' || p.productType === 'DOWNSELL') && p.family)
    .map((p) => {
      const fe = fePerFamily.get(p.family!) ?? 0;
      const rate = fe > 0 ? p.orders / fe : 0;
      const bench = benchAcc.get(p.productType);
      const benchRate = bench && bench.n > 0 ? bench.sum / bench.n : 0;
      return { ...p, fe, rate, benchRate };
    })
    .filter((p) => p.fe >= 30 && p.rate < 0.05 && p.benchRate > p.rate * 1.5)
    .sort((a, b) => (a.rate - a.benchRate) - (b.rate - b.benchRate)); // pior gap primeiro

  if (candidates.length === 0) return [];
  const out: Insight[] = [];
  for (const c of candidates.slice(0, 3)) {
    const typeLabel = c.productType === 'UPSELL' ? 'Upsell' : 'Downsell';
    out.push({
      id: `f-takerate-improve-${c.externalId}`,
      category: 'funnel',
      severity: 'insight',
      headline: `${c.name}: take-rate ${pct(c.rate)} (benchmark ${typeLabel.toLowerCase()}s do catálogo: ${pct(c.benchRate)})`,
      body: `Conversão muito abaixo do que outros ${typeLabel.toLowerCase()}s do catálogo entregam. Pra subir: testar variação de preço (downstep ou upstep), revisar copy/headline da oferta, simplificar checkout, mudar a posição no funil (ex: trocar com outro ${typeLabel.toLowerCase()}), ou substituir por um produto com mais aderência ao FE da família.`,
      metrics: [
        { label: 'Vendas / FE da família', value: `${c.orders} / ${c.fe}` },
        { label: 'Gap vs benchmark', value: `-${pct(c.benchRate - c.rate)}` },
      ],
      cta: { label: 'Abrir Produtos', href: '/products' },
    });
  }
  return out;
}

// ============================================================
// O-PEAK-BY-DAY — Hora de pico de cada dia da semana
//   Pra cada DOW, encontra o slot horário com mais vendas APROVADAS.
//   Útil pra programar campanhas + oncall.
// ============================================================
async function insightOpsPeakByDay(filters: MetricsFilters): Promise<Insight[]> {
  const rows = await db.$queryRaw<Array<{ dow: number; hour: number; orders: bigint; revenue: Prisma.Decimal }>>(Prisma.sql`
    SELECT EXTRACT(DOW FROM "orderedAt")::int AS dow,
           EXTRACT(HOUR FROM "orderedAt")::int AS hour,
           COUNT(*) FILTER (WHERE status='APPROVED')::bigint AS orders,
           COALESCE(SUM("grossAmountUsd") FILTER (WHERE status='APPROVED'), 0)::numeric(14,2) AS revenue
    FROM "Order"
    WHERE "orderedAt" >= ${filters.startDate} AND "orderedAt" <= ${filters.endDate}
    GROUP BY 1, 2
    HAVING COUNT(*) FILTER (WHERE status='APPROVED') > 0
  `);
  if (rows.length === 0) return [];

  // Pra cada dow, pega o slot com mais orders.
  const peakByDow = new Map<number, { hour: number; orders: number; revenue: number }>();
  for (const r of rows) {
    const orders = Number(r.orders), revenue = Number(r.revenue);
    const cur = peakByDow.get(r.dow);
    if (!cur || orders > cur.orders) peakByDow.set(r.dow, { hour: r.hour, orders, revenue });
  }

  const dows = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const ordered = [1, 2, 3, 4, 5, 6, 0]; // Mon-first
  const lines = ordered
    .filter((d) => peakByDow.has(d))
    .map((d) => {
      const p = peakByDow.get(d)!;
      return `${dows[d]} ${String(p.hour).padStart(2, '0')}h (${p.orders} · ${fmt(p.revenue)})`;
    });

  if (lines.length === 0) return [];

  return [{
    id: 'o-peak-by-day',
    category: 'operations',
    severity: 'insight',
    headline: `Hora de pico por dia da semana`,
    body: `Slot horário (UTC) com mais vendas aprovadas em cada dia, baseado em 30d. Use pra programar push de campanhas e garantir oncall presente.`,
    metrics: lines.map((l) => ({ label: l.split(' ')[0], value: l.substring(l.indexOf(' ') + 1) })),
    cta: { label: 'Ver heatmap', href: '/overview' },
  }];
}

// ============================================================
// O-DOW-DIP — Dia da semana com queda significativa
//   Compara revenue diária média de cada DOW vs média geral.
//   Se algum DOW está -25% ou mais abaixo, sinaliza.
// ============================================================
async function insightOpsDowDip(filters: MetricsFilters): Promise<Insight[]> {
  const rows = await db.$queryRaw<Array<{ dow: number; revenue: Prisma.Decimal; orders: bigint; days: bigint }>>(Prisma.sql`
    SELECT EXTRACT(DOW FROM "orderedAt")::int AS dow,
           COALESCE(SUM("grossAmountUsd") FILTER (WHERE status='APPROVED'), 0)::numeric(14,2) AS revenue,
           COUNT(*) FILTER (WHERE status='APPROVED')::bigint AS orders,
           COUNT(DISTINCT DATE("orderedAt"))::bigint AS days
    FROM "Order"
    WHERE "orderedAt" >= ${filters.startDate} AND "orderedAt" <= ${filters.endDate}
    GROUP BY 1
  `);
  if (rows.length < 7) return []; // sem dado de algum DOW

  const perDay = rows.map((r) => ({
    dow: r.dow,
    avgRev: Number(r.days) > 0 ? Number(r.revenue) / Number(r.days) : 0,
    orders: Number(r.orders),
  }));
  const overallAvg = perDay.reduce((s, x) => s + x.avgRev, 0) / perDay.length;
  if (overallAvg <= 0) return [];

  const dows = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const dips = perDay
    .map((d) => ({ ...d, drop: (overallAvg - d.avgRev) / overallAvg }))
    .filter((d) => d.drop > 0.25)
    .sort((a, b) => b.drop - a.drop);

  if (dips.length === 0) return [];
  const top = dips[0];
  return [{
    id: 'o-dow-dip',
    category: 'operations',
    severity: 'insight',
    headline: `${dows[top.dow]} rende -${pct(top.drop)} vs média diária`,
    body: `Revenue média de ${dows[top.dow]} (${fmt(top.avgRev)}/dia) está significativamente abaixo da média semanal (${fmt(overallAvg)}/dia). Considere reduzir bid de ads neste DOW e realocar pros dias mais quentes.`,
    metrics: [
      { label: `${dows[top.dow]} média`, value: `${fmt(top.avgRev)}/dia` },
      { label: 'Média geral', value: `${fmt(overallAvg)}/dia` },
    ],
  }];
}

// ============================================================
// O-PLATFORM-STALE — Plataforma sem sync recente
//   lastSyncAt > 6h atrás indica webhook/IPN possivelmente quebrado.
//   Operação crítica: venda chegando pra plataforma e não pra cá =
//   afiliado/contabilidade desincronizado.
// ============================================================
async function insightOpsPlatformStale(): Promise<Insight[]> {
  const platforms = await db.platform.findMany({
    select: { slug: true, displayName: true, lastSyncAt: true, isActive: true },
    where: { isActive: true },
  });
  const stale = platforms.filter((p) => {
    if (!p.lastSyncAt) return false; // nunca sincronizou — caso separado
    const ageMs = Date.now() - p.lastSyncAt.getTime();
    return ageMs > 6 * 3600 * 1000;
  });

  if (stale.length === 0) return [];
  const out: Insight[] = [];
  for (const p of stale) {
    const ageH = Math.floor((Date.now() - (p.lastSyncAt as Date).getTime()) / 3600 / 1000);
    out.push({
      id: `o-platform-stale-${p.slug}`,
      category: 'operations',
      severity: 'alert',
      headline: `${p.displayName} sem sync há ${ageH}h`,
      body: `Última atividade registrada: ${fmtDateAgo(p.lastSyncAt as Date)}. Pode ser webhook/IPN quebrado, mudança de URL no painel da plataforma, ou bloqueio de IP. Verificar antes que vendas comecem a sumir do dashboard.`,
      metrics: [
        { label: 'Última sync', value: (p.lastSyncAt as Date).toISOString() },
        { label: 'Threshold', value: '6h' },
      ],
      cta: { label: 'Abrir Plataformas', href: '/platforms' },
    });
  }
  return out;
}

// ============================================================
// Q-REFUND-TIME — Tempo médio até refund (multi-dim breakdown)
//   Janela: refunds dos últimos 90d (com refundedAt populated).
//   Calcula avg dias por dimensão (SKU, afiliado, plataforma, país)
//   pra revelar onde o refund acontece "tarde demais" (refund tardio
//   vs refund imediato indica diferentes problemas: reembolso tardio
//   sugere insatisfação pós-uso; reembolso imediato sugere arrependimento
//   ou checkout defeituoso).
// ============================================================
async function insightRefundTime(): Promise<Insight[]> {
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000);

  const [globalRow, byPlatform, bySku, byAff, byCountry] = await Promise.all([
    db.$queryRaw<Array<{ avgDays: number; n: bigint }>>(Prisma.sql`
      SELECT AVG(EXTRACT(EPOCH FROM ("refundedAt" - "orderedAt")) / 86400)::float AS "avgDays",
             COUNT(*)::bigint AS n
      FROM "Order"
      WHERE status = 'REFUNDED'
        AND "refundedAt" IS NOT NULL
        AND "orderedAt" >= ${since}
    `),
    db.$queryRaw<Array<{ slug: string; avgDays: number; n: bigint }>>(Prisma.sql`
      SELECT pl.slug AS slug,
             AVG(EXTRACT(EPOCH FROM (o."refundedAt" - o."orderedAt")) / 86400)::float AS "avgDays",
             COUNT(*)::bigint AS n
      FROM "Order" o JOIN "Platform" pl ON pl.id = o."platformId"
      WHERE o.status='REFUNDED' AND o."refundedAt" IS NOT NULL AND o."orderedAt" >= ${since}
      GROUP BY pl.slug
      HAVING COUNT(*) >= 5
    `),
    db.$queryRaw<Array<{ name: string; avgDays: number; n: bigint }>>(Prisma.sql`
      SELECT p.name AS name,
             AVG(EXTRACT(EPOCH FROM (o."refundedAt" - o."orderedAt")) / 86400)::float AS "avgDays",
             COUNT(*)::bigint AS n
      FROM "Order" o JOIN "Product" p ON p.id = o."productId"
      WHERE o.status='REFUNDED' AND o."refundedAt" IS NOT NULL AND o."orderedAt" >= ${since}
      GROUP BY p.name
      HAVING COUNT(*) >= 10
      ORDER BY "avgDays" DESC
      LIMIT 3
    `),
    db.$queryRaw<Array<{ aff: string; avgDays: number; n: bigint }>>(Prisma.sql`
      SELECT COALESCE(a.nickname, a."externalId") AS aff,
             AVG(EXTRACT(EPOCH FROM (o."refundedAt" - o."orderedAt")) / 86400)::float AS "avgDays",
             COUNT(*)::bigint AS n
      FROM "Order" o JOIN "Affiliate" a ON a.id = o."affiliateId"
      WHERE o.status='REFUNDED' AND o."refundedAt" IS NOT NULL AND o."orderedAt" >= ${since}
      GROUP BY 1
      HAVING COUNT(*) >= 10
      ORDER BY "avgDays" DESC
      LIMIT 3
    `),
    db.$queryRaw<Array<{ country: string; avgDays: number; n: bigint }>>(Prisma.sql`
      SELECT COALESCE(country, '—') AS country,
             AVG(EXTRACT(EPOCH FROM ("refundedAt" - "orderedAt")) / 86400)::float AS "avgDays",
             COUNT(*)::bigint AS n
      FROM "Order"
      WHERE status='REFUNDED' AND "refundedAt" IS NOT NULL AND "orderedAt" >= ${since}
      GROUP BY 1
      HAVING COUNT(*) >= 10
      ORDER BY "avgDays" DESC
      LIMIT 3
    `),
  ]);

  if (globalRow.length === 0 || Number(globalRow[0].n) === 0) return [];
  const global = globalRow[0];

  const fmtRow = (label: string, days: number, n: bigint) =>
    `${label}: ${days.toFixed(1)}d (${n} refunds)`;

  return [{
    id: 'q-refund-time',
    category: 'operations',
    severity: 'insight',
    headline: `Tempo médio até refund: ${global.avgDays.toFixed(1)} dias (${Number(global.n)} casos em 90d)`,
    body: `Refund tardio (>30d) costuma ser insatisfação após uso; refund rápido (<7d) costuma ser arrependimento ou problema no checkout. Quebra por dimensão abaixo identifica onde o problema concentra.`,
    metrics: [
      { label: 'Por plataforma',
        value: byPlatform.map((r) => `${r.slug === 'digistore24' ? 'D24' : 'CB'} ${r.avgDays.toFixed(1)}d`).join(' · ') || '—' },
      { label: 'SKUs com refund mais tardio',
        value: bySku.map((r) => fmtRow(r.name, r.avgDays, r.n)).join(' · ') || '—' },
      { label: 'Afiliados com refund mais tardio',
        value: byAff.map((r) => fmtRow(r.aff, r.avgDays, r.n)).join(' · ') || '—' },
      { label: 'Países com refund mais tardio',
        value: byCountry.map((r) => fmtRow(r.country, r.avgDays, r.n)).join(' · ') || '—' },
    ],
  }];
}

// ============================================================
// Q-SKU-REFUND-RANK — SKU com refund-rate maior que irmãos da família
//   Compara FE SKUs da mesma família (geralmente bottle counts diferentes).
//   Se max/min ≥ 2× E ambos com volume material, sinaliza desbalanço.
//   Útil pra identificar packs que não casam com expectativa do cliente.
// ============================================================
async function insightSkuRefundRank(): Promise<Insight[]> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000);
  const rows = await db.$queryRaw<Array<{
    family: string; bottles: number | null; name: string; externalId: string;
    refundRate: number; total: bigint; refunds: bigint;
  }>>(Prisma.sql`
    SELECT p.family AS family,
           p.bottles AS bottles,
           p.name AS name,
           p."externalId" AS "externalId",
           COUNT(*) FILTER (WHERE o.status='REFUNDED')::float / NULLIF(COUNT(*),0) AS "refundRate",
           COUNT(*)::bigint AS total,
           COUNT(*) FILTER (WHERE o.status='REFUNDED')::bigint AS refunds
    FROM "Order" o JOIN "Product" p ON p.id = o."productId"
    WHERE o."orderedAt" >= ${since}
      AND p.family IS NOT NULL
      AND o."productType" = 'FRONTEND'
    GROUP BY p.family, p.bottles, p.name, p."externalId"
    HAVING COUNT(*) >= 20
  `);

  // Group by family, find max/min refund rate ratio.
  const byFamily = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byFamily.get(r.family) ?? [];
    arr.push(r);
    byFamily.set(r.family, arr);
  }

  const insights: Insight[] = [];
  for (const [family, skus] of byFamily) {
    if (skus.length < 2) continue;
    const sorted = [...skus].sort((a, b) => b.refundRate - a.refundRate);
    const worst = sorted[0], best = sorted[sorted.length - 1];
    if (best.refundRate <= 0) continue;
    const ratio = worst.refundRate / best.refundRate;
    if (ratio < 2) continue;
    const worstBottles = worst.bottles != null ? `${worst.bottles} Bottles` : 'pack';
    const bestBottles = best.bottles != null ? `${best.bottles} Bottles` : 'pack';
    insights.push({
      id: `q-sku-refund-${family.toLowerCase()}`,
      category: 'funnel',
      severity: 'alert',
      headline: `${family}: ${worstBottles} tem refund ${ratio.toFixed(1)}× maior que ${bestBottles}`,
      body: `${pct(worst.refundRate)} (${Number(worst.refunds)}/${Number(worst.total)}) vs ${pct(best.refundRate)} (${Number(best.refunds)}/${Number(best.total)}). Cliente provavelmente está esperando coisa diferente do que recebe — revisar copy do pack, expectativa de duração, ou consider remover/repensar a SKU pior.`,
      metrics: [
        { label: 'SKU mais refundado', value: `${worst.name} · ${pct(worst.refundRate)}` },
        { label: 'SKU mais saudável', value: `${best.name} · ${pct(best.refundRate)}` },
      ],
      cta: { label: 'Abrir Produtos', href: '/products' },
    });
  }
  return insights;
}

// ============================================================
// Q-SKU-CB-RANK — SKUs com maior chargeback rate
//   CB rate ≥ 0.5% E volume ≥ 50. Top 3.
//   Chargeback é o tipo de refund mais caro: dispute fee + reputation
//   damage na plataforma + potencial freeze da conta vendor.
// ============================================================
async function insightSkuCbRank(): Promise<Insight[]> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000);
  const rows = await db.$queryRaw<Array<{
    name: string; externalId: string; cbRate: number; cbs: bigint; total: bigint;
  }>>(Prisma.sql`
    SELECT p.name AS name,
           p."externalId" AS "externalId",
           COUNT(*) FILTER (WHERE o.status='CHARGEBACK')::float / NULLIF(COUNT(*),0) AS "cbRate",
           COUNT(*) FILTER (WHERE o.status='CHARGEBACK')::bigint AS cbs,
           COUNT(*)::bigint AS total
    FROM "Order" o JOIN "Product" p ON p.id = o."productId"
    WHERE o."orderedAt" >= ${since}
    GROUP BY p.name, p."externalId"
    HAVING COUNT(*) >= 50
       AND COUNT(*) FILTER (WHERE o.status='CHARGEBACK')::float / COUNT(*) >= 0.005
    ORDER BY "cbRate" DESC
    LIMIT 3
  `);

  if (rows.length === 0) return [];
  const top = rows[0];
  const others = rows.slice(1).map((r) => `${r.name} ${pct(r.cbRate)}`).join(' · ');
  return [{
    id: 'q-sku-cb-rank',
    category: 'funnel',
    severity: 'alert',
    headline: `${top.name}: maior chargeback rate da operação (${pct(top.cbRate)})`,
    body: `${Number(top.cbs)} chargebacks em ${Number(top.total)} pedidos nos últimos 30d. CB sai caro (dispute fee + reputation com a plataforma + risco de account freeze). Revisar: tráfego do SKU, descrição que aparece no extrato do cartão, política de cobrança recorrente.`,
    metrics: [
      { label: 'CB rate', value: pct(top.cbRate) },
      { label: 'Outros SKUs em risco', value: others || '—' },
    ],
    cta: { label: 'Abrir Produtos', href: '/products' },
  }];
}

// ============================================================
// Q-FE-VS-FUNNEL-REFUND — Cliente que aceita upsell tem menos refund?
//   Sessões agrupadas por "FE only" vs "FE + qualquer extra (UP/DW/BUMP)".
//   Compara refund-rate entre os dois cohorts. Se sessão com upsell
//   refunda significativamente menos, é argumento pra investir mais
//   em upsell (não só pelo AOV mas pela qualidade do cliente).
// ============================================================
async function insightFeVsFunnelRefund(): Promise<Insight[]> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000);
  const rows = await db.$queryRaw<Array<{
    feOnlySessions: bigint; feOnlyRefunded: bigint;
    funnelSessions: bigint; funnelRefunded: bigint;
  }>>(Prisma.sql`
    WITH session_data AS (
      SELECT pl.slug || ':' || COALESCE(o."parentExternalId", o."externalId") AS session_key,
             BOOL_OR(o."productType"='FRONTEND' AND o.status='APPROVED') AS has_fe_approved,
             BOOL_OR(o."productType" <> 'FRONTEND' AND o.status='APPROVED') AS has_extra,
             BOOL_OR(o.status='REFUNDED') AS has_refund
      FROM "Order" o
      JOIN "Platform" pl ON pl.id = o."platformId"
      WHERE o."orderedAt" >= ${since}
      GROUP BY 1
    )
    SELECT
      COUNT(*) FILTER (WHERE has_fe_approved AND NOT has_extra)::bigint AS "feOnlySessions",
      COUNT(*) FILTER (WHERE has_fe_approved AND NOT has_extra AND has_refund)::bigint AS "feOnlyRefunded",
      COUNT(*) FILTER (WHERE has_fe_approved AND has_extra)::bigint AS "funnelSessions",
      COUNT(*) FILTER (WHERE has_fe_approved AND has_extra AND has_refund)::bigint AS "funnelRefunded"
    FROM session_data
  `);

  const r = rows[0];
  if (!r) return [];
  const feOnly = Number(r.feOnlySessions);
  const feOnlyRef = Number(r.feOnlyRefunded);
  const funnel = Number(r.funnelSessions);
  const funnelRef = Number(r.funnelRefunded);
  if (feOnly < 50 || funnel < 50) return []; // amostras pequenas

  const feOnlyRate = feOnlyRef / feOnly;
  const funnelRate = funnelRef / funnel;
  if (feOnlyRate <= 0) return [];
  const diff = (feOnlyRate - funnelRate) / feOnlyRate; // % menor
  if (Math.abs(diff) < 0.15) return []; // sem diff material

  if (funnelRate < feOnlyRate) {
    return [{
      id: 'q-fe-vs-funnel-refund',
      category: 'funnel',
      severity: 'good',
      headline: `Clientes que aceitam upsell têm ${pct(diff)} menos refund`,
      body: `Sessões só com FE: ${pct(feOnlyRate)} de refund-rate. Sessões com FE + UP/DW/BUMP: ${pct(funnelRate)}. Cliente que escala o ticket também tem mais commitment com a compra — argumento pra investir em otimizar a apresentação do upsell (não só pelo AOV imediato).`,
      metrics: [
        { label: 'FE only · sessões / refunds', value: `${feOnly} / ${feOnlyRef}` },
        { label: 'FE + funil · sessões / refunds', value: `${funnel} / ${funnelRef}` },
      ],
    }];
  }
  // Inverso: clientes que aceitam upsell refundam MAIS (red flag).
  return [{
    id: 'q-fe-vs-funnel-refund-inverse',
    category: 'funnel',
    severity: 'alert',
    headline: `Clientes que aceitam upsell refundam ${pct(-diff)} MAIS que FE-only`,
    body: `Sessões só com FE: ${pct(feOnlyRate)}. Sessões com upsell: ${pct(funnelRate)}. Padrão invertido — cliente entra no funil, escala ticket e depois se arrepende. Indica oferta de upsell agressiva ou pressão de venda. Revisar copy.`,
    metrics: [
      { label: 'FE only · sessões / refunds', value: `${feOnly} / ${feOnlyRef}` },
      { label: 'FE + funil · sessões / refunds', value: `${funnel} / ${funnelRef}` },
    ],
  }];
}

// ============================================================
// Q-AFF-D60-COHORT — Afiliado positivo no curto, prejuízo no D60
//   Pega cohort de vendas 60-90d atrás. Soma originalGrossUsd
//   (revenue na hora da venda) e CPA/COGS/fulfillment. Subtrai
//   refund_loss = soma de originalGrossUsd das vendas refundadas
//   dentro de 60d. Se profit no momento da venda era positivo mas
//   D60 é negativo, afiliado traz cliente que não fica.
// ============================================================
async function insightAffD60Cohort(): Promise<Insight[]> {
  const ninetyAgo = new Date(Date.now() - 90 * 24 * 3600 * 1000);
  const sixtyAgo = new Date(Date.now() - 60 * 24 * 3600 * 1000);

  const rows = await db.$queryRaw<Array<{
    affiliateId: string;
    externalId: string;
    nickname: string | null;
    grossAtSale: Prisma.Decimal;
    cpa: Prisma.Decimal;
    cogs: Prisma.Decimal;
    fulfillment: Prisma.Decimal;
    sales: bigint;
    refundLoss: Prisma.Decimal;
    refunds: bigint;
  }>>(Prisma.sql`
    WITH cohort AS (
      SELECT o."affiliateId" AS aff_id,
             o."originalGrossUsd" AS gross,
             o."cpaPaidUsd" AS cpa,
             o."cogsUsd" AS cogs,
             o."fulfillmentUsd" AS ff,
             o.status AS status,
             o."refundedAt" AS refunded_at,
             o."orderedAt" AS ordered_at
      FROM "Order" o
      WHERE o."orderedAt" >= ${ninetyAgo}
        AND o."orderedAt" < ${sixtyAgo}
        AND o."affiliateId" IS NOT NULL
        AND o."originalGrossUsd" IS NOT NULL
    )
    SELECT c.aff_id AS "affiliateId",
           a."externalId" AS "externalId",
           a.nickname AS nickname,
           COALESCE(SUM(c.gross), 0)::numeric(14,2) AS "grossAtSale",
           COALESCE(SUM(c.cpa), 0)::numeric(14,2) AS cpa,
           COALESCE(SUM(c.cogs), 0)::numeric(14,2) AS cogs,
           COALESCE(SUM(c.ff), 0)::numeric(14,2) AS fulfillment,
           COUNT(*)::bigint AS sales,
           COALESCE(SUM(c.gross) FILTER (
             WHERE c.status='REFUNDED'
               AND c.refunded_at IS NOT NULL
               AND (c.refunded_at - c.ordered_at) <= INTERVAL '60 days'
           ), 0)::numeric(14,2) AS "refundLoss",
           COUNT(*) FILTER (
             WHERE c.status='REFUNDED'
               AND c.refunded_at IS NOT NULL
               AND (c.refunded_at - c.ordered_at) <= INTERVAL '60 days'
           )::bigint AS refunds
    FROM cohort c
    JOIN "Affiliate" a ON a.id = c.aff_id
    GROUP BY c.aff_id, a."externalId", a.nickname
    HAVING COUNT(*) >= 10
  `);

  const items = rows.map((r) => {
    const gross = Number(r.grossAtSale);
    const cpa = Number(r.cpa);
    const cogs = Number(r.cogs);
    const ff = Number(r.fulfillment);
    const refundLoss = Math.abs(Number(r.refundLoss));
    // Estimativa: profit_at_sale ≈ gross - cogs - fulfillment - cpa
    // (simplificação: ignora fees/tax que ficam ~5-10% do gross).
    const profitAtSale = gross - cogs - ff - cpa;
    const d60Profit = profitAtSale - refundLoss;
    return {
      ...r,
      sales: Number(r.sales),
      refunds: Number(r.refunds),
      gross, cpa, cogs, ff, refundLoss,
      profitAtSale, d60Profit,
      flip: profitAtSale > 0 && d60Profit < 0,
    };
  }).filter((r) => r.flip)
    .sort((a, b) => a.d60Profit - b.d60Profit);

  if (items.length === 0) return [];
  const out: Insight[] = [];
  for (const i of items.slice(0, 3)) {
    out.push({
      id: `q-aff-d60-${i.affiliateId}`,
      category: 'affiliates',
      severity: 'alert',
      headline: `${i.nickname || i.externalId}: ROAS positivo na venda, prejuízo no D60`,
      body: `Vendas há 60-90d: ${i.sales} pedidos, ${fmt(i.gross)} em revenue. Profit no momento da venda: ${fmt(i.profitAtSale)}. Refunds nas mesmas vendas dentro de 60d: ${i.refunds} casos, ${fmt(i.refundLoss)} de loss. D60 verdadeiro: ${fmt(i.d60Profit)}. Cliente desse afiliado não fica — qualidade do tráfego ou copy não match com produto.`,
      metrics: [
        { label: 'Profit na venda → D60', value: `${fmt(i.profitAtSale)} → ${fmt(i.d60Profit)}` },
        { label: 'Refund loss / vendas', value: `${i.refunds} / ${i.sales}` },
      ],
      cta: { label: 'Abrir afiliado', href: `/all-affiliates?aff=${encodeURIComponent(i.externalId)}` },
    });
  }
  return out;
}

// ============================================================
// Q-AFF-BAD-QUALITY-RANK — Top 5 afiliados por refund + CB rate
//   Diferente do A-REFUND-FINGERPRINT (alerta por outliers >2× média),
//   este dá ranking ordenado pra revisão sistemática mensal — quem está
//   no topo da fila pra ser auditado.
// ============================================================
function insightAffBadQualityRank(aff: AffiliatesResponse): Insight[] {
  const ranked = aff.affiliates
    .filter((a) => a.allOrders >= 10)
    .map((a) => ({ ...a, badRate: a.refundRate + a.cbRate }))
    .sort((a, b) => b.badRate - a.badRate);

  if (ranked.length < 3) return [];
  const top5 = ranked.slice(0, 5);
  // Se nenhum no top 5 está com taxa minimamente preocupante, não emite.
  if (top5[0].badRate < 0.05) return [];

  const lines = top5.map((a, i) =>
    `${i + 1}. ${a.nickname || a.externalId}: ${pct(a.badRate)} (refund ${pct(a.refundRate)} + CB ${pct(a.cbRate)})`,
  );

  return [{
    id: 'q-aff-bad-quality-rank',
    category: 'affiliates',
    severity: 'insight',
    headline: `Top 5 afiliados com pior qualidade de lead (refund + CB)`,
    body: `Ranking pra revisão sistemática. Estar nessa lista não significa fraude — significa que o tráfego trazido por eles tem maior taxa de devolução/contestação que o restante da rede. Boa rotina mensal: olhar essa lista e decidir audit/educação/pause.`,
    metrics: lines.map((l) => {
      const idx = l.indexOf('. ');
      return { label: l.slice(0, idx), value: l.slice(idx + 2) };
    }),
    cta: { label: 'Abrir Ranking', href: '/leaderboard?sortBy=refundRate' },
  }];
}

// ============================================================
// Q-VSL-QUALITY — Variante (VSL) com refund/CB anormal
//   Compara variantes da mesma família (vs2, vsnova, etc — Product.variant).
//   Se uma variante tem (refund_rate + cb_rate) ≥ 1.5× as outras da família,
//   sinaliza. VSL pode converter mais mas trazer cliente pior.
// ============================================================
async function insightVslQuality(): Promise<Insight[]> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000);
  const rows = await db.$queryRaw<Array<{
    family: string; variant: string; name: string;
    refundRate: number; cbRate: number; total: bigint;
  }>>(Prisma.sql`
    SELECT p.family AS family,
           p.variant AS variant,
           p.name AS name,
           COUNT(*) FILTER (WHERE o.status='REFUNDED')::float / NULLIF(COUNT(*),0) AS "refundRate",
           COUNT(*) FILTER (WHERE o.status='CHARGEBACK')::float / NULLIF(COUNT(*),0) AS "cbRate",
           COUNT(*)::bigint AS total
    FROM "Order" o JOIN "Product" p ON p.id = o."productId"
    WHERE o."orderedAt" >= ${since}
      AND p.family IS NOT NULL
      AND p.variant IS NOT NULL
    GROUP BY p.family, p.variant, p.name
    HAVING COUNT(*) >= 20
  `);

  // Group by family, find outliers per family.
  const byFamily = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byFamily.get(r.family) ?? [];
    arr.push(r);
    byFamily.set(r.family, arr);
  }

  const insights: Insight[] = [];
  for (const [family, variants] of byFamily) {
    if (variants.length < 2) continue;
    const withScore = variants.map((v) => ({ ...v, badRate: v.refundRate + v.cbRate }));
    const avgOthers = (target: typeof withScore[number]) => {
      const others = withScore.filter((v) => v.variant !== target.variant);
      if (others.length === 0) return 0;
      return others.reduce((s, v) => s + v.badRate, 0) / others.length;
    };
    const sorted = [...withScore].sort((a, b) => b.badRate - a.badRate);
    const worst = sorted[0];
    const baseline = avgOthers(worst);
    if (baseline === 0 || worst.badRate < baseline * 1.5) continue;
    if (worst.badRate < 0.05) continue; // sem materialidade

    insights.push({
      id: `q-vsl-${family.toLowerCase()}-${worst.variant.toLowerCase()}`,
      category: 'funnel',
      severity: 'alert',
      headline: `${family} variante ${worst.variant}: refund+CB ${(worst.badRate / baseline).toFixed(1)}× maior que outras variantes`,
      body: `Variantes da mesma família costumam ter qualidade comparável. ${worst.variant} (${worst.name}) tem refund ${pct(worst.refundRate)} + CB ${pct(worst.cbRate)} = ${pct(worst.badRate)}. Outras variantes da família: ${pct(baseline)} médio. Possível: VSL/copy promete coisa que produto não entrega, ou audiência atraída pela vs específica é diferente.`,
      metrics: [
        { label: 'Variante com problema', value: `${worst.variant} · ${pct(worst.badRate)}` },
        { label: 'Média das outras variantes', value: pct(baseline) },
      ],
      cta: { label: 'Abrir Produtos', href: '/products' },
    });
  }
  return insights;
}

// ============================================================
// helpers
// ============================================================
function fmt(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}
function fmtDateAgo(d: Date): string {
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / (24 * 3600 * 1000));
  if (days === 0) return 'hoje';
  if (days === 1) return 'ontem';
  if (days < 30) return `${days}d atrás`;
  const months = Math.floor(days / 30);
  return `${months}mo atrás`;
}
