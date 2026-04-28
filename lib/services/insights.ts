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
