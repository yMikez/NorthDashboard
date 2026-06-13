import { Prisma } from '@prisma/client';
import type { ProductType } from '@prisma/client';
import { db } from '../db';
import {
  refreshDailyMetricsIfStale,
  queryDailyMetrics,
  type DailyMetricsRow,
} from './dailyMetrics';

export interface MetricsFilters {
  startDate: Date;
  endDate: Date;
  platformSlugs?: string[];
  countries?: string[];
  productExternalIds?: string[];
  // Filter by ProductFamily (e.g., 'NeuroMindPro'). For most services this
  // is an order-level filter via Product.family. For getFunnel it's applied
  // at the GROUP level (group whose FE belongs to a selected family) — see
  // the specific implementation in that function.
  productFamilies?: string[];
  // Filter by Order.productType — corresponde ao filtro "Etapa" na UI:
  // FRONTEND='Front', UPSELL='Upsell', DOWNSELL='Downsell',
  // SMS_RECOVERY='Recuperação'. Vazio = todas as etapas (inclui BUMP).
  // Em getFunnel é IGNORADO (o funil É a quebra por etapa).
  productTypes?: ProductType[];
}

export interface OverviewKPIs {
  gross: number;          // gross "ativo": só APPROVED (refunds removidos do total)
  grossOriginal: number;  // gross "Date of Event" (CB-style): valor original
                          // de toda venda no dia, mesmo que depois refundada.
                          // Bate com o "Gross Sale Amount" do CB Reporting.
  net: number;
  cpa: number;
  netProfit: number;
  approvalRate: number;
  refundRate: number;
  cbRate: number;
  aov: number;
  approvedCount: number;
  totalCount: number;
  orderGroups: number;
  // EPO (Earnings Per Order) — vendor lens: Net Sales / Conversions.
  // Conversions aqui = orderGroups (DISTINCT funnelSessionId APPROVED FE),
  // que é nosso proxy de "unique visitors who converted" — não temos
  // visitor_id upstream nos IPNs (ver KnowledgeEntry "Limitação visitor").
  // EPC (Net Sales / Visitors) NÃO é computado pelo mesmo motivo.
  epo: number;
  // Real-cost lens: COGS + shipping spent across all orders (incl. refunds
  // — we ate the cost). Profit is net (approved revenue) minus CPA minus
  // these. Margin = profit / gross.
  cogs: number;
  fulfillment: number;
  estimatedProfit: number;
  estimatedMarginPct: number;
}

export interface DailyBucket {
  date: string; // YYYY-MM-DD
  gross: number;
  grossOriginal: number; // gross "Date of Event" (CB-style)
  net: number;
  cpa: number;
  cogs: number;
  fulfillment: number;
  profit: number; // net - cpa - cogs - fulfillment
  orders: number;
  approvedOrders: number;
  allOrders: number;
}

export interface FunnelStage {
  id: string;
  label: string;
  volume: number;
  revenue: number;
  takeRate: number;
}

export interface FunnelSummary {
  feGroups: number;
  totalGroups: number;
  totalRevenue: number;
  aov: number;
  aovFEOnly: number;
  aovWithUpsell: number;
  revenueLiftFromUpsells: number;
}

export interface FunnelResponse {
  stages: FunnelStage[];
  summary: FunnelSummary;
  // Per-ProductFamily breakdown. One entry per family (NeuroMindPro,
  // GlycoPulse, etc.). Each has the same shape as the global stages/summary
  // but scoped to groups whose FE belongs to that family. Groups whose FE
  // can't be classified (family=null) are excluded.
  byFamily: Array<{
    family: string;
    stages: FunnelStage[];
    summary: FunnelSummary;
  }>;
  // Cross-sell: when a session entered via family A's FE but bought a
  // backend offer from family B (e.g., NeuroMindPro vendor selling a
  // GlycoPulse-UP2 in the same checkout). Backend orders whose family
  // ≠ session's FE family are excluded from the per-family stages above
  // (so take rates aren't inflated by foreign products) and aggregated
  // here instead.
  crossSell: Array<{
    fromFamily: string;
    toFamily: string;
    sessions: number;   // distinct groups where this cross-sell happened
    revenue: number;    // total gross revenue of the cross-sell orders
  }>;
}

export interface ProductsResponse {
  byType: Array<{
    productType: string;
    revenue: number;
    orders: number;
    net: number;
    cpa: number;
    productCount: number;
  }>;
  products: Array<{
    externalId: string;
    name: string;
    productType: string;
    family: string | null;
    variant: string | null;
    bottles: number | null;
    catalogPriceUsd: number | null;
    salesPageUrl: string | null;
    checkoutUrl: string | null;
    thanksPageUrl: string | null;
    driveUrl: string | null;
    catalogStatus: string | null;
    platformSlug: string;
    vendorAccount: string | null;
    revenue: number;
    orders: number;
    allOrders: number;
    refunds: number;
    chargebacks: number;
    net: number;
    cpa: number;
    cogs: number;
    fulfillment: number;
    estimatedProfit: number;
    estimatedMarginPct: number;
    // Session-attribution: only meaningful for FE SKUs. Aggregates the
    // entire session (FE + bumps + UPs + DWs) brought in by this FE and
    // attributes the full economics to it. Captures the lead's complete
    // economic value — high-CPA FE products that look unprofitable
    // standalone often turn positive once upsells are counted.
    // For non-FE SKUs (UPs, DWs, RC, BUMP), these fields stay 0.
    attributedSessions: number;
    attributedOrders: number;
    attributedRevenue: number;
    attributedNet: number;
    attributedCpa: number;
    attributedCogs: number;
    attributedFulfillment: number;
    attributedProfit: number;
    attributedMarginPct: number;
    approvalRate: number;
    firstSoldAt: string | null;
    lastSoldAt: string | null;
  }>;
}

export interface PlatformsResponse {
  platforms: Array<{
    slug: string;
    displayName: string;
    isActive: boolean;
    lastSyncAt: string | null;
    totalRevenue: number;
    totalOrders: number;
    allOrders: number;
    approvalRate: number;
    refundRate: number;
    cbRate: number;
    affiliatesTotal: number;
    affiliatesActive: number;
    topProduct: { externalId: string; name: string; revenue: number; orders: number } | null;
    feeRatePct: number | null;
    allowancePct: number | null;
    feesUpdatedAt: string | null;
    taxesPaid: number | null;
    allowanceReserved: number | null;
    grossBruto: number;
    grossRefunded: number;
    cpaPaidTotal: number;
    vendorEarnings: number | null;
  }>;
}

export interface CostsOverviewResponse {
  range: { start: string; end: string };
  kpis: {
    grossUsd: number;            // APPROVED gross (active revenue)
    refundsUsd: number;          // |gross| of REFUNDED + CHARGEBACK (positive)
    refundsCount: number;
    fulfillmentUsd: number;      // sum across APPROVED orders (positive)
    cogsUsd: number;             // sum across APPROVED orders
    platformFeesUsd: number;     // real (fees+tax) if available else feeRatePct estimate
    cpaUsd: number;              // sum across APPROVED orders
    allowanceReservedUsd: number; // rolling 60d snapshot — separate from period
    profitUsd: number;           // gross - fees - cpa - cogs - fulfillment (all APPROVED-scoped)
    marginPct: number;           // profit / gross × 100
  };
  daily: Array<{
    date: string;                // YYYY-MM-DD (UTC)
    grossUsd: number;
    fulfillmentUsd: number;
    cogsUsd: number;
    platformFeesUsd: number;
    cpaUsd: number;
    profitUsd: number;
  }>;
  byPlatform: Array<{
    slug: string;
    displayName: string;
    grossUsd: number;
    platformFeesUsd: number;
    feeRatePctEffective: number; // platformFeesUsd / grossUsd × 100 (or 0)
    cogsUsd: number;
    fulfillmentUsd: number;
    cpaUsd: number;
    profitUsd: number;
    marginPct: number;
  }>;
  byFamily: Array<{
    family: string;              // 'NeuroMindPro' etc; '_unknown' if null
    grossUsd: number;
    cogsUsd: number;
    fulfillmentUsd: number;
    profitUsd: number;           // gross - cogs - fulfillment (sem fees/cpa pra simplificar)
    marginPct: number;
    isCataloged: boolean;        // true se há entry em ProductFamilyCost
  }>;
  allowance: {
    reservedTodayUsd: number;            // rolling 60d × allowancePct
    releasingNext7DaysUsd: number;       // janela 53-60d atrás (libera nesta semana)
    releasingNext30DaysUsd: number;      // janela 30-60d atrás
    byPlatform: Array<{
      slug: string;
      displayName: string;
      allowancePct: number;
      reservedUsd: number;
    }>;
  };
}

// Fulfillment overview: distribuição de pedidos entre RedRock e ShipOffers.
// Computa o supplier on-the-fly (resolve por SKU → família → default), pra
// refletir reconfigurações no painel sem precisar re-snapshotar orders.
// "orderCount" = APPROVED only (refunds não contam como pedido entregue;
// o frete já foi pago, mas a métrica é "quantos pacotes estão saindo").
export interface FulfillmentOverviewResponse {
  range: { start: string; end: string };
  kpis: {
    totalOrders: number;
    redRockOrders: number;
    shipOffersOrders: number;
    redRockPct: number;
    shipOffersPct: number;
    // Soma de Order.fulfillmentUsd por supplier — útil pra ver onde o $ vai.
    redRockFulfillmentUsd: number;
    shipOffersFulfillmentUsd: number;
  };
  bySupplier: Array<{
    supplier: 'redrock' | 'shipoffers';
    orderCount: number;
    fulfillmentUsd: number;
    pct: number;
  }>;
  daily: Array<{
    date: string;             // YYYY-MM-DD (UTC)
    redRockOrders: number;
    shipOffersOrders: number;
  }>;
}

export interface AffiliateDetailResponse {
  affiliate: {
    externalId: string;
    nickname: string | null;
    platformSlug: string;
    firstSeenAt: string;
    lastOrderAt: string | null;
  };
  kpis: {
    revenue: number;
    orders: number;
    allOrders: number;
    refunds: number;
    chargebacks: number;
    approvalRate: number;
    refundRate: number;
    cbRate: number;
    cpa: number;
    netMargin: number;
    // AOV direto = revenue / feApprovedCount. Receita do próprio
    // afiliado dividida por FEs aprovadas dele. Não conta cross-sells.
    aov: number;
    feApprovedCount: number;
    // Session lens (mantida pra outras views): receita total da sessão
    // (com cross-sells) ÷ sessões. Lente "valor econômico do lead".
    attributedSessions: number;
    attributedRevenue: number;
    // Affiliate EPO = Commissions Net / Conversions. Glossário padrão usa
    // Visitors no denominador; aqui usamos feApprovedCount (sessões FE
    // aprovadas do afiliado) — proxy de "conversões atribuídas a ele".
    // Affiliate EPC (Commissions Net / Visitors) NÃO é computado — sem
    // visitor tracking upstream. Para o afiliado, "Commissions Net" é o
    // CPA pago neste recorte (já líquido — refunds zeram a CPA na IPN).
    epo: number;
  };
  ltv: {
    revenue: number;
    orders: number;
  };
  daily: Array<{ date: string; revenue: number; orders: number; allOrders: number }>;
  byProduct: Array<{
    externalId: string;
    name: string;
    productType: string;
    orders: number;
    revenue: number;
  }>;
  byCountry: Array<{ code: string; orders: number; revenue: number }>;
  flags: Array<{ kind: 'bad' | 'warn'; title: string; desc: string }>;
}

export interface AffiliatesResponse {
  summary: {
    activeNow: number;
    activePrev: number;
    concentration: number;
    newAff: number;
    churnedAff: number;
    totalRevenue: number;
  };
  affiliates: Array<{
    externalId: string;
    platformSlug: string;
    nickname: string | null;
    revenue: number;
    orders: number;
    allOrders: number;
    refunds: number;
    chargebacks: number;
    approvalRate: number;
    refundRate: number;
    cbRate: number;
    cpa: number;
    feApprovedCount: number;       // FE+APPROVED no período (qualquer cpa)
    feCpaPaidCount: number;        // FE+APPROVED+cpa>0 (sales que pagaram CPA)
    cpaPerFe: number;              // CPA negociado (mode dos cpa>0)
    cpaPerFeApproved: number;      // mean ponderada (deflaciona com cpa=0)
    netMargin: number;
    cogs: number;
    fulfillment: number;
    estimatedProfit: number;
    // Session-attribution lens: every order in a funnel session is credited
    // to the affiliate who brought the FE lead. Captures the full economic
    // value an affiliate generates — high-volume affiliates whose leads
    // also convert in upsells look very different here vs the per-order
    // estimatedProfit above.
    attributedSessions: number;
    attributedOrders: number;
    attributedRevenue: number;
    attributedNet: number;
    attributedCpa: number;
    attributedCogs: number;
    attributedFulfillment: number;
    attributedProfit: number;       // = net − cogs − fulfillment (attributed)
    attributedMarginPct: number;
    topCountry: string | null;
    ltvRevenue: number;
    ltvOrders: number;
    firstSeenAt: string | null;
    lastOrderAt: string | null;
    sparkline: number[];
  }>;
}

export interface OrdersResponse {
  orders: Array<{
    externalId: string;
    parentExternalId: string | null;
    platformSlug: string;
    productExternalId: string;
    productName: string;
    productType: string;
    affiliateExternalId: string | null;
    affiliateNickname: string | null;
    country: string | null;
    paymentMethod: string | null;
    grossAmountUsd: number;
    fees: number;
    netAmountUsd: number;
    cpaPaidUsd: number;
    status: string;
    orderedAt: string;
  }>;
  statusCounts: Record<string, number>;
  // Contagem por etapa do funil (productType), nas demais condições do
  // filtro (ignora a própria seleção de etapa) — espelha statusCounts.
  typeCounts: Record<string, number>;
  total: number;
  limit: number;
  offset: number;
}

export interface OrdersOptions {
  status?: string;
  // Filtro por etapa do funil (Order.productType): FRONTEND | UPSELL |
  // DOWNSELL | BUMP | SMS_RECOVERY. 'all'/undefined = sem filtro.
  productType?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface OrderDetailResponse {
  order: {
    externalId: string;
    parentExternalId: string | null;
    platformSlug: string;
    platformDisplayName: string;
    vendorAccount: string | null;
    productType: string;
    funnelStep: number | null;
    status: string;
    eventType: string;
    billingType: string;
    paySequenceNo: number | null;
    numberOfInstallments: number | null;
    paymentMethod: string | null;
    country: string | null;
    state: string | null;
    city: string | null;
    currencyOriginal: string;
    grossAmountOrig: number;
    grossAmountUsd: number;
    taxAmount: number;
    fees: number;
    netAmountUsd: number;
    cpaPaidUsd: number;
    // Computed: residual the platform actually keeps =
    //   gross - net (vendor) - cpa (affiliate) - tax (gov't pass-through)
    // Approximate; may diverge slightly from platform's internal accounting
    // when fee tiers compound differently. Negative values flagged in UI.
    platformRetention: number;
    // Computed: company keeps gross - tax - fees - cpa (= netAmountUsd in
    // theory, exposed separately for clarity).
    companyKept: number;
    // Snapshot at ingest. Null for orders before the COGS feature shipped
    // (until backfill runs).
    cogsUsd: number | null;
    fulfillmentUsd: number | null;
    // Computed: estimated profit. For APPROVED: companyKept - cogs - fulfillment.
    // For REFUNDED/CHARGEBACK: 0 - cogs - fulfillment (we still paid both).
    estimatedProfit: number | null;
    estimatedMarginPct: number | null;
    clickId: string | null;
    trackingId: string | null;
    campaignKey: string | null;
    trafficSource: string | null;
    deviceType: string | null;
    browser: string | null;
    detailsUrl: string | null;
    orderedAt: string;
    approvedAt: string | null;
    refundedAt: string | null;
    chargebackAt: string | null;
  };
  product: {
    externalId: string;
    name: string;
    productType: string;
    family: string | null;
    variant: string | null;
    bottles: number | null;
    catalogPriceUsd: number | null;
    salesPageUrl: string | null;
    checkoutUrl: string | null;
  };
  affiliate: {
    externalId: string;
    nickname: string | null;
  } | null;
  customer: {
    externalId: string | null;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    country: string | null;
    language: string | null;
  } | null;
  // Other orders from the same buyer's session (parent_external_id match).
  // Sorted by orderedAt ASC. The current order is included for context.
  session: Array<{
    externalId: string;
    productType: string;
    productName: string;
    productFamily: string | null;
    funnelStep: number | null;
    grossAmountUsd: number;
    status: string;
    orderedAt: string;
    isSelf: boolean;
    isCrossSell: boolean;
  }>;
  // Convenience flag: this order's family ≠ session FE's family.
  isCrossSell: boolean;
}

export interface OverviewResponse {
  range: { start: string; end: string };
  kpis: OverviewKPIs;
  previous?: OverviewKPIs;
  daily: DailyBucket[];
  byCountry: Array<{ code: string; value: number; orders: number }>;
  byProductType: Array<{ label: string; value: number }>;
  topAffiliates: Array<{
    externalId: string;
    nickname: string | null;
    platformSlug: string;
    revenue: number;
    orders: number;
    approvalRate: number;
    netMargin: number;
  }>;
  platformHealth: Array<{
    slug: string;
    displayName: string;
    lastSyncAt: string | null;
    totalOrders: number;
    totalRevenue: number;
  }>;
  // Hour-of-day × day-of-week heatmap, in UTC. Only cells with activity are
  // returned; the UI fills missing (dow, hour) combinations with zeros.
  // dow: Postgres convention — 0=Sunday, 6=Saturday. The UI relabels to
  // Mon-first for business presentation.
  hourlyHeatmap: Array<{
    dow: number;     // 0..6
    hour: number;    // 0..23
    orders: number;  // approved order count
    gross: number;   // approved gross revenue USD
  }>;
}

// União exata dos campos que os compute* legacy consomem. select explícito
// em vez de include: o include trazia TODAS as colunas escalares da Order —
// inclusive rawMetadata (Json do IPN inteiro), que inflava o payload DB→Node
// no caminho legacy (filtro por SKU) sem nenhum uso.
const ORDER_COMPUTE_SELECT = {
  externalId: true,
  parentExternalId: true,
  status: true,
  productType: true,
  orderedAt: true,
  country: true,
  grossAmountUsd: true,
  originalGrossUsd: true,
  netAmountUsd: true,
  cpaPaidUsd: true,
  cogsUsd: true,
  fulfillmentUsd: true,
  platform: { select: { slug: true, displayName: true } },
  product: { select: { externalId: true, name: true, productType: true } },
  affiliate: { select: { externalId: true, nickname: true } },
} satisfies Prisma.OrderSelect;

type OrderWithJoins = Prisma.OrderGetPayload<{ select: typeof ORDER_COMPUTE_SELECT }>;

export async function getOverview(
  filters: MetricsFilters,
  compare = false,
): Promise<OverviewResponse> {
  // SKU-level filtering isn't supported by the MV (keyed on family). Fall
  // back to the legacy path on those filter combinations — accuracy wins
  // over speed when the user explicitly picks SKUs.
  if (filters.productExternalIds?.length) {
    return getOverviewLegacy(filters, compare);
  }

  // Stale-while-revalidate: dispara o refresh em background quando a MV
  // está velha e responde já com o que ela tem (até ~60s de atraso, mesmo
  // regime de antes — só que agora ninguém paga o REFRESH na latência).
  void refreshDailyMetricsIfStale().catch(() => { /* logado em doRefresh */ });

  const [rows, orderGroups, topAffiliates, hourlyHeatmap, platforms] = await Promise.all([
    queryDailyMetrics(filters),
    orderGroupsCount(filters),
    topAffiliatesQuery(filters, 5),
    hourlyHeatmapQuery(filters),
    db.platform.findMany({
      select: { slug: true, displayName: true, lastSyncAt: true },
    }),
  ]);

  const kpis = kpisFromRows(rows, orderGroups);
  const daily = dailyFromRows(rows, filters.startDate, filters.endDate);
  const byCountry = byCountryFromRows(rows);
  const byProductType = byProductTypeFromRows(rows);
  const platformHealth = platformHealthFromRows(rows, platforms);

  const response: OverviewResponse = {
    range: {
      start: filters.startDate.toISOString(),
      end: filters.endDate.toISOString(),
    },
    kpis,
    daily,
    byCountry,
    byProductType,
    topAffiliates,
    platformHealth,
    hourlyHeatmap,
  };

  if (compare) {
    const span = filters.endDate.getTime() - filters.startDate.getTime();
    const prevEnd = new Date(filters.startDate.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - span);
    const prevFilters = { ...filters, startDate: prevStart, endDate: prevEnd };
    const [prevRows, prevGroups] = await Promise.all([
      queryDailyMetrics(prevFilters),
      orderGroupsCount(prevFilters),
    ]);
    response.previous = kpisFromRows(prevRows, prevGroups);
  }

  return response;
}

// ---------- MV-backed helpers for getOverview ----------
// Each takes pre-fetched DailyMetricsRow[] (already filtered by date range
// + dimensions) and reduces them to the response field. No DB I/O except
// where catalog joins are needed (platformHealth → Platform.lastSyncAt,
// topAffiliates → Affiliate table).

function kpisFromRows(
  rows: DailyMetricsRow[],
  orderGroups: number,
): OverviewKPIs {
  let gross = 0, grossOriginal = 0, net = 0, cpa = 0, cogs = 0, fulfillment = 0;
  let approvedCount = 0, refundedCount = 0, chargebackCount = 0;
  for (const r of rows) {
    gross += r.gross;
    grossOriginal += r.gross_original;
    net += r.net;
    cpa += r.cpa;
    cogs += r.cogs;
    fulfillment += r.fulfillment;
    approvedCount += r.approved_count;
    refundedCount += r.refunded_count;
    chargebackCount += r.chargeback_count;
  }
  const totalCount = rows.reduce((s, r) => s + r.total_count, 0);
  const denom = totalCount || 1;

  // Profit = vendor revenue − COGS − shipping.
  // CPA is NOT subtracted again — it's already excluded from `net`. Both
  // platforms pay the affiliate first and then credit the vendor account
  // with the residual: ClickBank totalAccountAmount and Digistore
  // amount_vendor are both post-CPA. The order-detail drawer uses the
  // same formula (companyKept - cogs - fulfillment, no CPA term).
  const estimatedProfit = round2(net - cogs - fulfillment);
  const estimatedMarginPct = gross > 0
    ? Math.round((estimatedProfit / gross) * 10000) / 100
    : 0;

  return {
    gross: round2(gross),
    grossOriginal: round2(grossOriginal),
    net: round2(net),
    cpa: round2(cpa),
    netProfit: round2(net - cpa),
    approvalRate: round4(approvedCount / denom),
    refundRate: round4(refundedCount / denom),
    cbRate: round4(chargebackCount / denom),
    aov: round2(orderGroups ? gross / orderGroups : 0),
    approvedCount,
    totalCount,
    orderGroups,
    // EPO = Net Sales / Conversions (proxy: sessões FE APPROVED).
    epo: round2(orderGroups ? net / orderGroups : 0),
    cogs: round2(cogs),
    fulfillment: round2(fulfillment),
    estimatedProfit,
    estimatedMarginPct,
  };
}

async function orderGroupsCount(filters: MetricsFilters): Promise<number> {
  // Counts distinct sessions (parent_external_id) that have at least one
  // APPROVED FRONTEND order — same definition as Funnel's `feGroups`. This
  // is the canonical denominator for AOV ("revenue per buyer who entered
  // the funnel"), so Overview AOV matches Funnel AOV.
  const conds: Prisma.Sql[] = [
    Prisma.sql`o."orderedAt" >= ${filters.startDate}`,
    Prisma.sql`o."orderedAt" <= ${filters.endDate}`,
    Prisma.sql`o."status" = 'APPROVED'`,
    Prisma.sql`o."productType" = 'FRONTEND'`,
  ];
  if (filters.platformSlugs?.length) {
    conds.push(Prisma.sql`pl."slug" = ANY(${filters.platformSlugs})`);
  }
  if (filters.countries?.length) {
    conds.push(Prisma.sql`o."country" = ANY(${filters.countries})`);
  }
  if (filters.productFamilies?.length) {
    conds.push(Prisma.sql`pr."family" = ANY(${filters.productFamilies})`);
  }
  const whereSql = Prisma.join(conds, ' AND ');
  const [{ count }] = await db.$queryRaw<{ count: bigint }[]>(Prisma.sql`
    SELECT COUNT(DISTINCT COALESCE(o."parentExternalId", o."externalId"))::bigint AS count
    FROM "Order" o
    JOIN "Platform" pl ON o."platformId" = pl.id
    JOIN "Product" pr ON o."productId" = pr.id
    WHERE ${whereSql}
  `);
  return Number(count);
}

export function dailyFromRows(
  rows: DailyMetricsRow[],
  startDate: Date,
  endDate: Date,
): DailyBucket[] {
  const buckets = new Map<string, DailyBucket>();
  // Iteração por DIA BRT (não UTC). MV.day já vem em America/Sao_Paulo, e
  // o frontend manda start/end como BRT day boundaries em UTC. Pra gerar
  // os keys '2026-04-XX' BRT, deslocamos -3h e iteramos UTC dates do
  // resultado — equivale a iterar dias BRT.
  const TZ_SHIFT_MS = 3 * 60 * 60 * 1000; // BRT = UTC-3 (sem DST)
  const startBrt = new Date(startDate.getTime() - TZ_SHIFT_MS);
  const endBrt = new Date(endDate.getTime() - TZ_SHIFT_MS);
  for (let d = startOfDay(startBrt); d <= endBrt; d = addDays(d, 1)) {
    const key = isoDate(d);
    buckets.set(key, {
      date: key, gross: 0, grossOriginal: 0, net: 0, cpa: 0, cogs: 0, fulfillment: 0, profit: 0,
      orders: 0, approvedOrders: 0, allOrders: 0,
    });
  }
  for (const r of rows) {
    const key = isoDate(r.day);
    const b = buckets.get(key);
    if (!b) continue;
    b.gross = round2(b.gross + r.gross);
    b.grossOriginal = round2(b.grossOriginal + r.gross_original);
    b.net = round2(b.net + r.net);
    b.cpa = round2(b.cpa + r.cpa);
    b.cogs = round2(b.cogs + r.cogs);
    b.fulfillment = round2(b.fulfillment + r.fulfillment);
    b.allOrders += r.total_count;
    b.approvedOrders += r.approved_count;
    b.orders = b.approvedOrders;
  }
  // Compute profit after all rows aggregated. Net is the vendor's actual
  // payout (already post-CPA); we subtract only the costs we incur on
  // top of the platform deduction: COGS + shipping.
  for (const b of buckets.values()) {
    b.profit = round2(b.net - b.cogs - b.fulfillment);
  }
  return Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export function byCountryFromRows(
  rows: DailyMetricsRow[],
): Array<{ code: string; value: number; orders: number }> {
  const map = new Map<string, { code: string; value: number; orders: number }>();
  for (const r of rows) {
    if (r.country === '_unknown') continue;
    const e = map.get(r.country) ?? { code: r.country, value: 0, orders: 0 };
    e.value += r.gross;
    e.orders += r.approved_count;
    map.set(r.country, e);
  }
  // Top 25 — frontend renderiza top 10 e agrupa os 15+ restantes em
  // "Outros (N países)" com expansão opcional. 25 é cap razoável pra
  // não inchar o payload (vendor opera majoritariamente Tier 1, ~10
  // países cobrem 95% do volume).
  return Array.from(map.values())
    .map((e) => ({ ...e, value: round2(e.value) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 25);
}

export function byProductTypeFromRows(
  rows: DailyMetricsRow[],
): Array<{ label: string; value: number }> {
  const totals: Record<string, number> = {
    FRONTEND: 0, UPSELL: 0, DOWNSELL: 0, BUMP: 0, SMS_RECOVERY: 0,
  };
  for (const r of rows) {
    totals[r.product_type] = (totals[r.product_type] ?? 0) + r.gross;
  }
  return Object.entries(totals)
    .filter(([, v]) => v > 0)
    .map(([label, value]) => ({ label, value: round2(value) }));
}

function platformHealthFromRows(
  rows: DailyMetricsRow[],
  platforms: Array<{ slug: string; displayName: string; lastSyncAt: Date | null }>,
): OverviewResponse['platformHealth'] {
  const bySlug = new Map<string, { totalOrders: number; totalRevenue: number }>();
  for (const r of rows) {
    const e = bySlug.get(r.platform) ?? { totalOrders: 0, totalRevenue: 0 };
    e.totalOrders += r.approved_count;
    e.totalRevenue += r.gross;
    bySlug.set(r.platform, e);
  }
  return platforms.map((p) => {
    const agg = bySlug.get(p.slug) ?? { totalOrders: 0, totalRevenue: 0 };
    return {
      slug: p.slug,
      displayName: p.displayName,
      lastSyncAt: p.lastSyncAt?.toISOString() ?? null,
      totalOrders: agg.totalOrders,
      totalRevenue: round2(agg.totalRevenue),
    };
  });
}

async function hourlyHeatmapQuery(
  filters: MetricsFilters,
): Promise<OverviewResponse['hourlyHeatmap']> {
  // Single aggregate query against base Order table — DOW/HOUR extraction
  // can't go through daily_metrics MV (granularity mismatch). Cheap because
  // it's a one-shot scan; for large data volumes we could add an
  // hourly_metrics MV later, but at current scale this is sub-100ms.
  const conds: Prisma.Sql[] = [
    Prisma.sql`o."orderedAt" >= ${filters.startDate}`,
    Prisma.sql`o."orderedAt" <= ${filters.endDate}`,
  ];
  if (filters.platformSlugs?.length) {
    conds.push(Prisma.sql`pl."slug" = ANY(${filters.platformSlugs})`);
  }
  if (filters.countries?.length) {
    conds.push(Prisma.sql`o."country" = ANY(${filters.countries})`);
  }
  if (filters.productFamilies?.length) {
    conds.push(Prisma.sql`pr."family" = ANY(${filters.productFamilies})`);
  }
  if (filters.productTypes?.length) {
    conds.push(Prisma.sql`o."productType" = ANY(${filters.productTypes}::"ProductType"[])`);
  }
  const whereSql = Prisma.join(conds, ' AND ');
  // DOW/HOUR extraídos em BRT (não UTC): o usuário opera em horário de
  // Brasília — em UTC o padrão de horário de venda aparecia deslocado 3h
  // (e vendas de fim de noite caíam no dia seguinte). Mesmo idioma de
  // conversão da MV daily_metrics.
  const rows = await db.$queryRaw<Array<{
    dow: number;
    hour: number;
    orders: bigint;
    gross: Prisma.Decimal;
  }>>(Prisma.sql`
    SELECT
      EXTRACT(DOW FROM ((o."orderedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo'))::int AS dow,
      EXTRACT(HOUR FROM ((o."orderedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo'))::int AS hour,
      COUNT(*) FILTER (WHERE o."status" = 'APPROVED')::bigint AS orders,
      COALESCE(SUM(o."grossAmountUsd") FILTER (WHERE o."status"='APPROVED'), 0)::numeric(14,2) AS gross
    FROM "Order" o
    JOIN "Platform" pl ON o."platformId" = pl.id
    JOIN "Product" pr ON o."productId" = pr.id
    WHERE ${whereSql}
    GROUP BY 1, 2
    HAVING COUNT(*) FILTER (WHERE o."status" = 'APPROVED') > 0
    ORDER BY 1, 2
  `);
  return rows.map((r) => ({
    dow: r.dow,
    hour: r.hour,
    orders: Number(r.orders),
    gross: round2(Number(r.gross)),
  }));
}

async function topAffiliatesQuery(
  filters: MetricsFilters,
  limit: number,
): Promise<OverviewResponse['topAffiliates']> {
  // Single GROUP BY query with the same filter shape — no full Order rows.
  const conds: Prisma.Sql[] = [
    Prisma.sql`o."orderedAt" >= ${filters.startDate}`,
    Prisma.sql`o."orderedAt" <= ${filters.endDate}`,
    Prisma.sql`o."affiliateId" IS NOT NULL`,
  ];
  if (filters.platformSlugs?.length) {
    conds.push(Prisma.sql`pl."slug" = ANY(${filters.platformSlugs})`);
  }
  if (filters.countries?.length) {
    conds.push(Prisma.sql`o."country" = ANY(${filters.countries})`);
  }
  if (filters.productFamilies?.length) {
    conds.push(Prisma.sql`pr."family" = ANY(${filters.productFamilies})`);
  }
  if (filters.productTypes?.length) {
    conds.push(Prisma.sql`o."productType" = ANY(${filters.productTypes}::"ProductType"[])`);
  }
  const whereSql = Prisma.join(conds, ' AND ');
  const aggRows = await db.$queryRaw<Array<{
    affiliate_id: string;
    external_id: string;
    nickname: string | null;
    platform_slug: string;
    revenue: Prisma.Decimal;
    net: Prisma.Decimal;
    cpa: Prisma.Decimal;
    orders: bigint;
    approved_orders: bigint;
  }>>(Prisma.sql`
    SELECT
      a."id"             AS affiliate_id,
      a."externalId"     AS external_id,
      a."nickname"       AS nickname,
      pl."slug"          AS platform_slug,
      COALESCE(SUM(o."grossAmountUsd") FILTER (WHERE o."status"='APPROVED'), 0)::numeric(14,2) AS revenue,
      COALESCE(SUM(o."netAmountUsd")   FILTER (WHERE o."status"='APPROVED'), 0)::numeric(14,2) AS net,
      COALESCE(SUM(o."cpaPaidUsd"), 0)::numeric(14,2)                                       AS cpa,
      COUNT(*)::bigint                                                                       AS orders,
      COUNT(*) FILTER (WHERE o."status"='APPROVED')::bigint                                  AS approved_orders
    FROM "Order" o
    JOIN "Platform"  pl ON o."platformId"  = pl.id
    JOIN "Product"   pr ON o."productId"   = pr.id
    JOIN "Affiliate" a  ON o."affiliateId" = a.id
    WHERE ${whereSql}
    GROUP BY a."id", a."externalId", a."nickname", pl."slug"
    ORDER BY revenue DESC
    LIMIT ${limit}
  `);
  return aggRows.map((r) => {
    const orders = Number(r.orders);
    const approved = Number(r.approved_orders);
    const net = Number(r.net);
    const cpa = Number(r.cpa);
    return {
      externalId: r.external_id,
      nickname: r.nickname,
      platformSlug: r.platform_slug,
      revenue: round2(Number(r.revenue)),
      orders,
      approvalRate: round4(orders ? approved / orders : 0),
      netMargin: round2(net - cpa),
    };
  });
}

// Legacy path — used only when productExternalIds filter is set, since the
// daily_metrics MV is grouped by family, not SKU. Slower but more flexible.
async function getOverviewLegacy(
  filters: MetricsFilters,
  compare: boolean,
): Promise<OverviewResponse> {
  const span = filters.endDate.getTime() - filters.startDate.getTime();
  const prevEnd = new Date(filters.startDate.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - span);

  const [orders, hourlyHeatmap, prevOrders] = await Promise.all([
    fetchOrders(filters),
    hourlyHeatmapQuery(filters),
    compare
      ? fetchOrders({ ...filters, startDate: prevStart, endDate: prevEnd })
      : Promise.resolve(null),
  ]);
  const kpis = computeKPIs(orders);
  const daily = computeDaily(orders, filters.startDate, filters.endDate);
  const byCountry = computeByCountry(orders);
  const byProductType = computeByProductType(orders);
  const topAffiliates = computeTopAffiliates(orders, 5);
  const platformHealth = await computePlatformHealth(orders);
  const response: OverviewResponse = {
    range: { start: filters.startDate.toISOString(), end: filters.endDate.toISOString() },
    kpis, daily, byCountry, byProductType, topAffiliates, platformHealth, hourlyHeatmap,
  };
  if (prevOrders) {
    response.previous = computeKPIs(prevOrders);
  }
  return response;
}

export async function getFunnel(
  filters: MetricsFilters,
): Promise<FunnelResponse> {
  const where: Prisma.OrderWhereInput = {
    orderedAt: { gte: filters.startDate, lte: filters.endDate },
    status: 'APPROVED',
  };
  if (filters.platformSlugs?.length) {
    where.platform = { slug: { in: filters.platformSlugs } };
  }
  if (filters.countries?.length) {
    where.country = { in: filters.countries };
  }

  const orders = await db.order.findMany({
    where,
    select: {
      externalId: true,
      parentExternalId: true,
      funnelSessionId: true,
      grossAmountUsd: true,
      funnelStep: true,
      productType: true,
      platform: { select: { slug: true } },
      product: { select: { externalId: true, name: true, family: true } },
    },
  });

  // Chave de sessão por plataforma. BuyGoods (sessid2) e Cartpanda (cid): o ID
  // de transação é por-transação/se repete, então a sessão real é o
  // funnelSessionId. Demais plataformas: parentExternalId é o anchor da sessão
  // (FE sem upsells = própria externalId).
  const sessionKeyOf = (o: (typeof orders)[number]): string =>
    o.platform.slug === 'buygoods' || o.platform.slug === 'cartpanda'
      ? (o.funnelSessionId ?? o.parentExternalId ?? o.externalId)
      : (o.parentExternalId ?? o.externalId);

  // A "group" represents a single buyer's funnel session. Group key:
  //   parentExternalId when present (digistore order_id, clickbank upsellOriginalReceipt),
  //   otherwise the order's own externalId (a frontend with no upsells).
  // We scope keys per platform to avoid ID collisions between sources.
  // upsellsByStep / downsellsByStep are keyed by funnelStep (UP1 → step 2,
  // UP2 → step 3, ...) so the funnel can fan out arbitrarily without
  // hardcoding stage slots.
  interface Group {
    hasFE: boolean;
    hasBump: boolean;
    feRevenue: number;
    bumpRevenue: number;
    upsellsByStep: Map<number, number>;
    downsellsByStep: Map<number, number>;
    feProductExternalId: string | null;
    feProductName: string | null;
    feProductFamily: string | null;
    fePlatformSlug: string | null;
  }

  const groups = new Map<string, Group>();

  // Two-pass: first identify the FE family per group, then classify each
  // backend order as either a same-family upsell (counts toward stage) or a
  // cross-sell (tracked separately, doesn't inflate take rates).
  // Single-pass would be wrong because IPN ordering doesn't guarantee the FE
  // arrives before its upsells.
  function getOrInit(key: string, slug: string): Group {
    let g = groups.get(key);
    if (!g) {
      g = {
        hasFE: false, hasBump: false,
        feRevenue: 0, bumpRevenue: 0,
        upsellsByStep: new Map(),
        downsellsByStep: new Map(),
        feProductExternalId: null, feProductName: null, feProductFamily: null,
        fePlatformSlug: slug,
      };
      groups.set(key, g);
    }
    return g;
  }

  // Pass 1: FE orders only — establish each group's funnel identity.
  for (const o of orders) {
    if (o.productType !== 'FRONTEND') continue;
    const groupKey = `${o.platform.slug}:${sessionKeyOf(o)}`;
    const g = getOrInit(groupKey, o.platform.slug);
    g.hasFE = true;
    g.feRevenue += toNumber(o.grossAmountUsd);
    if (!g.feProductExternalId) {
      g.feProductExternalId = o.product.externalId;
      g.feProductName = o.product.name;
      g.feProductFamily = o.product.family;
      g.fePlatformSlug = o.platform.slug;
    }
  }

  // Pass 1.5: orphan-FE recovery. If a group has no FE in this period (FE
  // happened earlier, was refunded/canceled, or for any reason isn't in the
  // filtered dataset), we still see its UP/DW/RC orders here. Without a
  // family hint, those orders never get bucketed under any family in
  // byFamily. To surface them in the right family's funnel, infer the
  // family from the first non-FE order's product.family. Pass 2 then
  // classifies same-family vs cross-sell against this inferred family.
  // hasFE stays false so feGroups/AOV calc isn't polluted — only the
  // upsell/downsell volume + revenue land in the family bucket.
  for (const o of orders) {
    if (o.productType === 'FRONTEND') continue;
    const groupKey = `${o.platform.slug}:${sessionKeyOf(o)}`;
    const g = getOrInit(groupKey, o.platform.slug);
    if (g.feProductFamily == null && o.product.family) {
      g.feProductFamily = o.product.family;
    }
  }

  // Cross-sell flow tracking: groups whose backend order family ≠ FE family.
  // Sessions counts distinct groups (not orders) per (fromFamily → toFamily)
  // pair so a session with two cross-sells to the same family doesn't double-
  // count.
  const crossSellMap = new Map<
    string,
    { fromFamily: string; toFamily: string; sessions: Set<string>; revenue: number }
  >();

  // Pass 2: non-FE orders. CADA order contabiliza no funil da família FE
  // da sessão — incluindo cross-sells. Decisão de produto: o "funil de X"
  // é tudo que aconteceu nas sessões iniciadas com X, independente de
  // qual produto foi vendido em cada etapa. Se sessão começou em
  // NeuroMind FE e o UP3 foi NightCalm, esse UP3 é parte do funil de
  // NeuroMind.
  //
  // Cross-sells continuam sendo TRACKEADOS separadamente (crossSellMap)
  // como metadata complementar — útil pra aba "pra onde costumamos
  // cross-sellar" — mas NÃO são mais excluídos das stages.
  for (const o of orders) {
    if (o.productType === 'FRONTEND') continue;
    const groupKey = `${o.platform.slug}:${sessionKeyOf(o)}`;
    const g = getOrInit(groupKey, o.platform.slug);
    const gross = toNumber(o.grossAmountUsd);
    const t = o.productType;
    const step = o.funnelStep ?? 0;
    const orderFamily = o.product.family;
    const cls = classifyOrderInGroup(t, g.feProductFamily, orderFamily);

    // Track cross-sell metadata pra reporting separado (não afeta stages).
    if (cls === 'CROSS_SELL') {
      const fromFamily = g.feProductFamily as string;
      const toFamily = orderFamily as string;
      const key = `${fromFamily}→${toFamily}`;
      const existing = crossSellMap.get(key);
      const entry = existing ?? {
        fromFamily,
        toFamily,
        sessions: new Set<string>(),
        revenue: 0,
      };
      if (!existing) crossSellMap.set(key, entry);
      entry.sessions.add(groupKey);
      entry.revenue += gross;
      // NÃO faz continue — orders cross-sell CONTAM no funil da família FE.
    }

    if (t === 'BUMP') {
      g.hasBump = true;
      g.bumpRevenue += gross;
    } else if (t === 'UPSELL') {
      // step missing or 0 (legacy data) falls back to step=2 (UP1) so the
      // order still appears somewhere in the funnel rather than being lost.
      const s = step >= 2 ? step : 2;
      g.upsellsByStep.set(s, (g.upsellsByStep.get(s) ?? 0) + gross);
    } else if (t === 'DOWNSELL') {
      const s = step >= 2 ? step : 2;
      g.downsellsByStep.set(s, (g.downsellsByStep.get(s) ?? 0) + gross);
    }
  }

  // When the user picks specific FE products or families, keep only groups
  // whose FE matches. Group-level filter — applying productExternalIds/family
  // to the raw orders query would drop upsell rows (different SKU/family) and
  // collapse the funnel. Both filters AND together when both present.
  const productFilter = filters.productExternalIds?.length
    ? new Set(filters.productExternalIds)
    : null;
  const familyFilter = filters.productFamilies?.length
    ? new Set(filters.productFamilies)
    : null;
  const allGroups = Array.from(groups.values()).filter((g) => {
    if (!productFilter && !familyFilter) return true;
    // productFilter is FE-specific (a SKU is the entry point), so it
    // implicitly requires an FE in the period. familyFilter doesn't —
    // orphan-FE groups (UP/DW only) still belong to a family if Pass 1.5
    // could infer it.
    if (productFilter) {
      if (!g.hasFE) return false;
      if (!g.feProductExternalId || !productFilter.has(g.feProductExternalId)) return false;
    }
    if (familyFilter) {
      if (!g.feProductFamily || !familyFilter.has(g.feProductFamily)) return false;
    }
    return true;
  });
  const global = aggregateGroups(allGroups, allGroups.length);

  // Bucket groups by family. Pass 1 sets feProductFamily from the FE order
  // when available; Pass 1.5 falls back to the family of any non-FE order
  // for orphan-FE groups (UP/DW arriving without their FE in the dataset,
  // e.g. cross-period sessions). Groups whose family is still unknown
  // (unclassified SKUs across the board) are excluded — there's no funnel
  // to attribute them to.
  interface FamilyBucket {
    family: string;
    groups: Group[];
  }
  const buckets = new Map<string, FamilyBucket>();
  for (const g of allGroups) {
    if (!g.feProductFamily) continue;
    let b = buckets.get(g.feProductFamily);
    if (!b) {
      b = { family: g.feProductFamily, groups: [] };
      buckets.set(g.feProductFamily, b);
    }
    b.groups.push(g);
  }

  const byFamily = Array.from(buckets.values())
    .map((b) => {
      const agg = aggregateGroups(b.groups, b.groups.length);
      return {
        family: b.family,
        stages: agg.stages,
        summary: agg.summary,
      };
    })
    .sort((a, b) => b.summary.totalRevenue - a.summary.totalRevenue);

  // Build cross-sell flow list, sorted by sessions desc.
  const crossSell = Array.from(crossSellMap.values())
    .map((e) => ({
      fromFamily: e.fromFamily,
      toFamily: e.toFamily,
      sessions: e.sessions.size,
      revenue: round2(e.revenue),
    }))
    .sort((a, b) => b.sessions - a.sessions);

  return {
    stages: global.stages,
    summary: global.summary,
    byFamily,
    crossSell,
  };
}

/**
 * Classify an order's relationship to its session's FE family. Pure helper
 * — pulled out so the funnel cross-sell rule has a single source of truth
 * (and is unit-testable without spinning up a DB).
 *
 *   SAME_FAMILY  → counts toward the FE family's funnel stage.
 *   CROSS_SELL   → tracked separately in FunnelResponse.crossSell.
 *   UNKNOWN      → either side missing classification; backend conservatively
 *                  treats UNKNOWN as same-family (legacy behavior) so we
 *                  don't lose orders to unclassified SKUs.
 */
export function classifyOrderInGroup(
  productType: string,
  feFamily: string | null,
  orderFamily: string | null,
): 'SAME_FAMILY' | 'CROSS_SELL' | 'UNKNOWN' {
  if (productType === 'FRONTEND') return 'SAME_FAMILY';
  if (feFamily == null || orderFamily == null) return 'UNKNOWN';
  return feFamily === orderFamily ? 'SAME_FAMILY' : 'CROSS_SELL';
}

export interface FunnelGroupAgg {
  hasFE: boolean;
  hasBump: boolean;
  feRevenue: number;
  bumpRevenue: number;
  // Map keys are funnelStep values (UP1 → 2, UP2 → 3, UP3 → 4, ...). Values
  // are revenue summed across orders at that step inside this single group.
  upsellsByStep: Map<number, number>;
  downsellsByStep: Map<number, number>;
}

export function aggregateGroups(
  groupList: FunnelGroupAgg[],
  totalGroups: number,
): { stages: FunnelStage[]; summary: FunnelSummary } {
  let feGroups = 0;
  let bumpGroups = 0;
  let feRevenue = 0;
  let bumpRevenue = 0;
  let revenueFEOnly = 0;
  let revenueWithUpsell = 0;
  let groupsFEOnly = 0;
  let groupsWithUpsell = 0;

  // Per-step accumulators. We discover which steps actually appeared in the
  // dataset rather than declaring them up front, so UP3/DW3 only show up
  // when there's data for them and we don't keep dead "Upsell N" stages for
  // steps that never existed.
  const upStepGroups = new Map<number, number>();
  const upStepRevenue = new Map<number, number>();
  const dwStepGroups = new Map<number, number>();
  const dwStepRevenue = new Map<number, number>();

  for (const g of groupList) {
    if (g.hasFE) feGroups++;
    if (g.hasBump) bumpGroups++;
    feRevenue += g.feRevenue;
    bumpRevenue += g.bumpRevenue;

    let groupUpsellRevenue = 0;
    let groupDownsellRevenue = 0;
    for (const [step, rev] of g.upsellsByStep) {
      upStepGroups.set(step, (upStepGroups.get(step) ?? 0) + 1);
      upStepRevenue.set(step, (upStepRevenue.get(step) ?? 0) + rev);
      groupUpsellRevenue += rev;
    }
    for (const [step, rev] of g.downsellsByStep) {
      dwStepGroups.set(step, (dwStepGroups.get(step) ?? 0) + 1);
      dwStepRevenue.set(step, (dwStepRevenue.get(step) ?? 0) + rev);
      groupDownsellRevenue += rev;
    }

    if (g.hasFE) {
      const groupRev =
        g.feRevenue + g.bumpRevenue + groupUpsellRevenue + groupDownsellRevenue;
      const takesUpsell =
        g.hasBump || g.upsellsByStep.size > 0 || g.downsellsByStep.size > 0;
      if (takesUpsell) {
        groupsWithUpsell++;
        revenueWithUpsell += groupRev;
      } else {
        groupsFEOnly++;
        revenueFEOnly += groupRev;
      }
    }
  }

  const totalUpsellRevenue = Array.from(upStepRevenue.values()).reduce((a, b) => a + b, 0);
  const totalDownsellRevenue = Array.from(dwStepRevenue.values()).reduce((a, b) => a + b, 0);
  const totalRevenue = feRevenue + bumpRevenue + totalUpsellRevenue + totalDownsellRevenue;
  const aov = feGroups ? totalRevenue / feGroups : 0;
  const aovFEOnly = groupsFEOnly ? revenueFEOnly / groupsFEOnly : 0;
  const aovWithUpsell = groupsWithUpsell ? revenueWithUpsell / groupsWithUpsell : 0;
  const revenueLiftFromUpsells =
    aovFEOnly > 0 ? (aovWithUpsell - aovFEOnly) / aovFEOnly : 0;

  // Empty-group case: still emit the canonical UP1/DW1 stages so the UI has
  // something to render (matches old behavior where these slots existed
  // unconditionally). When there's actual data, the loop discovers them.
  const upStepsSorted = [...upStepGroups.keys()].sort((a, b) => a - b);
  const dwStepsSorted = [...dwStepGroups.keys()].sort((a, b) => a - b);
  if (upStepsSorted.length === 0) upStepsSorted.push(2);
  if (dwStepsSorted.length === 0) dwStepsSorted.push(2);

  // Bump fica fora da visualização do funil (decisão de produto: bump é
  // um add-on do checkout, não um estágio de conversão sequencial).
  // bumpRevenue e bumpGroups continuam sendo usados pra cálculo de AOV
  // total e revenueLiftFromUpsells — só não aparecem como stage.
  const stages: FunnelStage[] = [
    {
      id: 'frontend',
      label: 'Frontend',
      volume: feGroups,
      revenue: round2(feRevenue),
      takeRate: 1.0,
    },
  ];
  for (const step of upStepsSorted) {
    const n = step - 1;
    const volume = upStepGroups.get(step) ?? 0;
    const revenue = upStepRevenue.get(step) ?? 0;
    stages.push({
      id: `upsell${n}`,
      label: `Upsell ${n}`,
      volume,
      revenue: round2(revenue),
      takeRate: feGroups ? round4(volume / feGroups) : 0,
    });
  }
  for (const step of dwStepsSorted) {
    const n = step - 1;
    const volume = dwStepGroups.get(step) ?? 0;
    const revenue = dwStepRevenue.get(step) ?? 0;
    stages.push({
      id: `downsell${n}`,
      label: `Downsell ${n}`,
      volume,
      revenue: round2(revenue),
      takeRate: feGroups ? round4(volume / feGroups) : 0,
    });
  }

  return {
    stages,
    summary: {
      feGroups,
      totalGroups,
      totalRevenue: round2(totalRevenue),
      aov: round2(aov),
      aovFEOnly: round2(aovFEOnly),
      aovWithUpsell: round2(aovWithUpsell),
      revenueLiftFromUpsells: round4(revenueLiftFromUpsells),
    },
  };
}

export async function getProducts(
  filters: MetricsFilters,
): Promise<ProductsResponse> {
  return USE_SQL_ATTRIBUTION ? getProductsSql(filters) : getProductsLegacy(filters);
}

// Implementação legacy: findMany O(orders) + agregação em JS. Mantida
// SOMENTE pra prova de paridade e rollback — ver getProductsSql abaixo.
export async function getProductsLegacy(
  filters: MetricsFilters,
): Promise<ProductsResponse> {
  const where: Prisma.OrderWhereInput = {
    orderedAt: { gte: filters.startDate, lte: filters.endDate },
  };
  if (filters.platformSlugs?.length) {
    where.platform = { slug: { in: filters.platformSlugs } };
  }
  if (filters.countries?.length) {
    where.country = { in: filters.countries };
  }
  if (filters.productExternalIds?.length || filters.productFamilies?.length) {
    where.product = {
      ...(filters.productExternalIds?.length ? { externalId: { in: filters.productExternalIds } } : {}),
      ...(filters.productFamilies?.length ? { family: { in: filters.productFamilies } } : {}),
    };
  }
  if (filters.productTypes?.length) {
    where.productType = { in: filters.productTypes };
  }

  const orders = await db.order.findMany({
    where,
    select: {
      status: true,
      grossAmountUsd: true,
      netAmountUsd: true,
      cpaPaidUsd: true,
      cogsUsd: true,
      fulfillmentUsd: true,
      vendorAccount: true,
      orderedAt: true,
      productType: true,
      // Chaves de sessão pro attribution pass abaixo — mesma findMany
      // alimenta os dois loops (antes eram 2 queries idênticas).
      parentExternalId: true,
      externalId: true,
      product: {
        select: {
          externalId: true, name: true, productType: true, id: true,
          family: true, variant: true, bottles: true, catalogPriceUsd: true,
          salesPageUrl: true, checkoutUrl: true, thanksPageUrl: true, driveUrl: true,
          catalogStatus: true,
        },
      },
      platform: { select: { slug: true } },
    },
  });

  interface ProductAgg {
    externalId: string;
    name: string;
    // Most-common per-order productType observed for this SKU. Falls back to
    // catalog Product.productType if no orders. The same SKU may appear as
    // FRONTEND in some orders and UPSELL in others — the dominant role wins.
    productType: string;
    typeCounts: Record<string, number>;
    family: string | null;
    variant: string | null;
    bottles: number | null;
    catalogPriceUsd: number | null;
    salesPageUrl: string | null;
    checkoutUrl: string | null;
    thanksPageUrl: string | null;
    driveUrl: string | null;
    catalogStatus: string | null;
    platformSlug: string;
    vendorAccount: string | null;
    revenue: number;
    orders: number;
    allOrders: number;
    refunds: number;
    chargebacks: number;
    net: number;
    cpa: number;
    cogs: number;
    fulfillment: number;
    firstSoldAt: Date | null;
    lastSoldAt: Date | null;
  }

  const byProduct = new Map<string, ProductAgg>();

  for (const o of orders) {
    const key = `${o.platform.slug}:${o.product.externalId}`;
    let p = byProduct.get(key);
    if (!p) {
      p = {
        externalId: o.product.externalId,
        name: o.product.name,
        productType: o.product.productType,
        typeCounts: {},
        family: o.product.family,
        variant: o.product.variant,
        bottles: o.product.bottles,
        catalogPriceUsd: o.product.catalogPriceUsd ? Number(o.product.catalogPriceUsd) : null,
        salesPageUrl: o.product.salesPageUrl,
        checkoutUrl: o.product.checkoutUrl,
        thanksPageUrl: o.product.thanksPageUrl,
        driveUrl: o.product.driveUrl,
        catalogStatus: o.product.catalogStatus,
        platformSlug: o.platform.slug,
        vendorAccount: o.vendorAccount,
        revenue: 0,
        orders: 0,
        allOrders: 0,
        refunds: 0,
        chargebacks: 0,
        net: 0,
        cpa: 0,
        cogs: 0,
        fulfillment: 0,
        firstSoldAt: null,
        lastSoldAt: null,
      };
      byProduct.set(key, p);
    }
    p.allOrders++;
    p.typeCounts[o.productType] = (p.typeCounts[o.productType] ?? 0) + 1;
    p.net += toNumber(o.netAmountUsd);
    p.cpa += toNumber(o.cpaPaidUsd);
    p.cogs += toNumber(o.cogsUsd ?? 0);
    p.fulfillment += toNumber(o.fulfillmentUsd ?? 0);
    if (o.status === 'APPROVED') {
      p.orders++;
      p.revenue += toNumber(o.grossAmountUsd);
      if (!p.firstSoldAt || o.orderedAt < p.firstSoldAt) p.firstSoldAt = o.orderedAt;
      if (!p.lastSoldAt || o.orderedAt > p.lastSoldAt) p.lastSoldAt = o.orderedAt;
    } else if (o.status === 'REFUNDED') {
      p.refunds++;
    } else if (o.status === 'CHARGEBACK') {
      p.chargebacks++;
    }
  }

  // ---------- Session attribution to FE SKU ----------
  // For each session (parent_external_id), find the FE order's SKU and
  // attribute the full session (FE + bumps + UPs + DWs) to it. Captures
  // the FE's "real" profit including the upsells brought by its lead —
  // FE SKUs with high CPA often look unprofitable standalone but recover
  // margin via the funnel.
  interface SkuAttAgg {
    sessions: number;
    orders: number;
    revenue: number;
    net: number;
    cpa: number;
    cogs: number;
    fulfillment: number;
  }
  const attBySku = new Map<string, SkuAttAgg>();
  // Group by session — reusa as rows da findMany de cima (mesmo where).
  const sessionGroups = new Map<string, typeof orders>();
  for (const o of orders) {
    const key = `${o.platform.slug}:${o.parentExternalId ?? o.externalId}`;
    let arr = sessionGroups.get(key);
    if (!arr) { arr = []; sessionGroups.set(key, arr); }
    arr.push(o);
  }
  // Attribute each session to its FE SKU
  for (const sessOrders of sessionGroups.values()) {
    const fe = sessOrders.find((o) => o.productType === 'FRONTEND');
    if (!fe) continue;
    const skuKey = `${fe.platform.slug}:${fe.product.externalId}`;
    let agg = attBySku.get(skuKey);
    if (!agg) {
      agg = { sessions: 0, orders: 0, revenue: 0, net: 0, cpa: 0, cogs: 0, fulfillment: 0 };
      attBySku.set(skuKey, agg);
    }
    agg.sessions++;
    for (const o of sessOrders) {
      agg.orders++;
      if (o.status === 'APPROVED') {
        agg.revenue += toNumber(o.grossAmountUsd);
        agg.net += toNumber(o.netAmountUsd);
      }
      agg.cpa += toNumber(o.cpaPaidUsd);
      agg.cogs += toNumber(o.cogsUsd ?? 0);
      agg.fulfillment += toNumber(o.fulfillmentUsd ?? 0);
    }
  }
  // ---------- /attribution ----------

  // Resolve per-SKU display productType: pick the most-frequent per-order
  // classification. Catalog Product.productType is fallback when no orders.
  for (const p of byProduct.values()) {
    let topType = p.productType;
    let topCount = 0;
    for (const [type, count] of Object.entries(p.typeCounts)) {
      if (count > topCount) {
        topCount = count;
        topType = type;
      }
    }
    p.productType = topType;
  }

  const products = Array.from(byProduct.values())
    .map((p) => {
      const skuKey = `${p.platformSlug}:${p.externalId}`;
      const att = attBySku.get(skuKey);
      const attRevenue = att?.revenue ?? 0;
      const attProfit = (att?.net ?? 0) - (att?.cogs ?? 0) - (att?.fulfillment ?? 0);
      return {
      externalId: p.externalId,
      name: p.name,
      productType: p.productType,
      family: p.family,
      variant: p.variant,
      bottles: p.bottles,
      catalogPriceUsd: p.catalogPriceUsd,
      salesPageUrl: p.salesPageUrl,
      checkoutUrl: p.checkoutUrl,
      thanksPageUrl: p.thanksPageUrl,
      driveUrl: p.driveUrl,
      catalogStatus: p.catalogStatus,
      platformSlug: p.platformSlug,
      vendorAccount: p.vendorAccount,
      revenue: round2(p.revenue),
      orders: p.orders,
      allOrders: p.allOrders,
      refunds: p.refunds,
      chargebacks: p.chargebacks,
      net: round2(p.net),
      cpa: round2(p.cpa),
      cogs: round2(p.cogs),
      fulfillment: round2(p.fulfillment),
      // Profit = net − COGS − fulfillment. CPA already excluded from net.
      estimatedProfit: round2(p.net - p.cogs - p.fulfillment),
      estimatedMarginPct: p.revenue > 0
        ? Math.round(((p.net - p.cogs - p.fulfillment) / p.revenue) * 10000) / 100
        : 0,
      approvalRate: p.allOrders ? round4(p.orders / p.allOrders) : 0,
      firstSoldAt: p.firstSoldAt?.toISOString() ?? null,
      lastSoldAt: p.lastSoldAt?.toISOString() ?? null,
      attributedSessions: att?.sessions ?? 0,
      attributedOrders: att?.orders ?? 0,
      attributedRevenue: round2(attRevenue),
      attributedNet: round2(att?.net ?? 0),
      attributedCpa: round2(att?.cpa ?? 0),
      attributedCogs: round2(att?.cogs ?? 0),
      attributedFulfillment: round2(att?.fulfillment ?? 0),
      attributedProfit: round2(attProfit),
      attributedMarginPct: attRevenue > 0
        ? Math.round((attProfit / attRevenue) * 10000) / 100
        : 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  // byType bucket aggregates from per-ORDER productType (not per-SKU display),
  // so revenue lands in the right bucket even when a SKU is sold in multiple
  // roles.
  const typeBucket = new Map<
    string,
    { revenue: number; orders: number; net: number; cpa: number; productSet: Set<string> }
  >();
  for (const o of orders) {
    const t = o.productType;
    const entry =
      typeBucket.get(t) ?? { revenue: 0, orders: 0, net: 0, cpa: 0, productSet: new Set<string>() };
    const skuKey = `${o.platform.slug}:${o.product.externalId}`;
    entry.productSet.add(skuKey);
    entry.net += toNumber(o.netAmountUsd);
    entry.cpa += toNumber(o.cpaPaidUsd);
    if (o.status === 'APPROVED') {
      entry.orders++;
      entry.revenue += toNumber(o.grossAmountUsd);
    }
    typeBucket.set(t, entry);
  }
  const TYPE_ORDER = ['FRONTEND', 'UPSELL', 'BUMP', 'DOWNSELL'];
  const byType = TYPE_ORDER.map((productType) => {
    const e = typeBucket.get(productType);
    return {
      productType,
      revenue: round2(e?.revenue ?? 0),
      orders: e?.orders ?? 0,
      net: round2(e?.net ?? 0),
      cpa: round2(e?.cpa ?? 0),
      productCount: e?.productSet.size ?? 0,
    };
  });

  return { byType, products };
}

// ============================================================
// getProducts — pushdown SQL (Fase B). Mesma resposta da legacy com as
// agregações no Postgres (O(SKUs) rows em vez de O(orders)). Divergências
// documentadas vs legacy (todas eram não-determinísticas na legacy por
// iteração sem orderBy):
//   1. FE da sessão: legacy pegava o primeiro FRONTEND na ordem do heap;
//      SQL pega o mais cedo (orderedAt ASC, id ASC).
//   2. vendorAccount do SKU: legacy pegava o da primeira order processada;
//      SQL usa MIN() — determinístico.
//   3. productType de exibição em empate de contagem: SQL desempata por
//      nome do tipo ASC.
// ============================================================
export async function getProductsSql(
  filters: MetricsFilters,
): Promise<ProductsResponse> {
  const conds: Prisma.Sql[] = [
    Prisma.sql`o."orderedAt" >= ${filters.startDate}`,
    Prisma.sql`o."orderedAt" <= ${filters.endDate}`,
  ];
  if (filters.platformSlugs?.length) {
    conds.push(Prisma.sql`pl."slug" = ANY(${filters.platformSlugs})`);
  }
  if (filters.countries?.length) {
    conds.push(Prisma.sql`o."country" = ANY(${filters.countries})`);
  }
  if (filters.productExternalIds?.length) {
    conds.push(Prisma.sql`pr."externalId" = ANY(${filters.productExternalIds})`);
  }
  if (filters.productFamilies?.length) {
    conds.push(Prisma.sql`pr."family" = ANY(${filters.productFamilies})`);
  }
  if (filters.productTypes?.length) {
    conds.push(Prisma.sql`o."productType" = ANY(${filters.productTypes}::"ProductType"[])`);
  }
  const where = Prisma.join(conds, ' AND ');

  const [skuRows, typeCountRows, byTypeRows, attRows] = await Promise.all([
    // (A) Agregados + catálogo por SKU (só SKUs com order no período).
    db.$queryRaw<Array<{
      product_id: string;
      external_id: string;
      name: string;
      catalog_type: string;
      family: string | null;
      variant: string | null;
      bottles: number | null;
      catalog_price_usd: Prisma.Decimal | null;
      sales_page_url: string | null;
      checkout_url: string | null;
      thanks_page_url: string | null;
      drive_url: string | null;
      catalog_status: string | null;
      platform_slug: string;
      vendor_account: string | null;
      all_orders: bigint;
      approved_orders: bigint;
      refunds: bigint;
      chargebacks: bigint;
      revenue: Prisma.Decimal;
      net: Prisma.Decimal;
      cpa: Prisma.Decimal;
      cogs: Prisma.Decimal;
      fulfillment: Prisma.Decimal;
      first_sold_at: Date | null;
      last_sold_at: Date | null;
    }>>(Prisma.sql`
      SELECT
        pr.id AS product_id,
        pr."externalId" AS external_id,
        pr."name" AS name,
        pr."productType"::text AS catalog_type,
        pr."family" AS family,
        pr."variant" AS variant,
        pr."bottles" AS bottles,
        pr."catalogPriceUsd" AS catalog_price_usd,
        pr."salesPageUrl" AS sales_page_url,
        pr."checkoutUrl" AS checkout_url,
        pr."thanksPageUrl" AS thanks_page_url,
        pr."driveUrl" AS drive_url,
        pr."catalogStatus" AS catalog_status,
        pl."slug" AS platform_slug,
        MIN(o."vendorAccount") AS vendor_account,
        COUNT(*)::bigint AS all_orders,
        COUNT(*) FILTER (WHERE o."status" = 'APPROVED')::bigint AS approved_orders,
        COUNT(*) FILTER (WHERE o."status" = 'REFUNDED')::bigint AS refunds,
        COUNT(*) FILTER (WHERE o."status" = 'CHARGEBACK')::bigint AS chargebacks,
        COALESCE(SUM(o."grossAmountUsd") FILTER (WHERE o."status" = 'APPROVED'), 0) AS revenue,
        COALESCE(SUM(o."netAmountUsd"), 0) AS net,
        COALESCE(SUM(o."cpaPaidUsd"), 0) AS cpa,
        COALESCE(SUM(o."cogsUsd"), 0) AS cogs,
        COALESCE(SUM(o."fulfillmentUsd"), 0) AS fulfillment,
        MIN(o."orderedAt") FILTER (WHERE o."status" = 'APPROVED') AS first_sold_at,
        MAX(o."orderedAt") FILTER (WHERE o."status" = 'APPROVED') AS last_sold_at
      FROM "Order" o
      JOIN "Platform" pl ON o."platformId" = pl.id
      JOIN "Product" pr ON o."productId" = pr.id
      WHERE ${where}
      GROUP BY pr.id, pl."slug"
    `),
    // (B) Contagem por tipo de order por SKU → productType de exibição
    // (tipo dominante; catálogo é fallback quando empate em zero não rola).
    db.$queryRaw<Array<{ product_id: string; t: string; cnt: bigint }>>(Prisma.sql`
      SELECT pr.id AS product_id, o."productType"::text AS t, COUNT(*)::bigint AS cnt
      FROM "Order" o
      JOIN "Platform" pl ON o."platformId" = pl.id
      JOIN "Product" pr ON o."productId" = pr.id
      WHERE ${where}
      GROUP BY 1, 2
      ORDER BY cnt DESC, t ASC
    `),
    // (C) Buckets byType (productType POR ORDER, não por SKU).
    db.$queryRaw<Array<{
      t: string;
      orders: bigint;
      revenue: Prisma.Decimal;
      net: Prisma.Decimal;
      cpa: Prisma.Decimal;
      product_count: bigint;
    }>>(Prisma.sql`
      SELECT
        o."productType"::text AS t,
        COUNT(*) FILTER (WHERE o."status" = 'APPROVED')::bigint AS orders,
        COALESCE(SUM(o."grossAmountUsd") FILTER (WHERE o."status" = 'APPROVED'), 0) AS revenue,
        COALESCE(SUM(o."netAmountUsd"), 0) AS net,
        COALESCE(SUM(o."cpaPaidUsd"), 0) AS cpa,
        COUNT(DISTINCT pr.id)::bigint AS product_count
      FROM "Order" o
      JOIN "Platform" pl ON o."platformId" = pl.id
      JOIN "Product" pr ON o."productId" = pr.id
      WHERE ${where}
      GROUP BY 1
    `),
    // (D) Session attribution: sessão inteira creditada ao SKU da FE mais
    // cedo da sessão. Mesmo WHERE das lentes diretas (igual à legacy, que
    // re-consultava com o mesmo where).
    db.$queryRaw<Array<{
      product_id: string;
      sessions: bigint;
      orders: bigint;
      revenue: Prisma.Decimal;
      net: Prisma.Decimal;
      cpa: Prisma.Decimal;
      cogs: Prisma.Decimal;
      fulfillment: Prisma.Decimal;
    }>>(Prisma.sql`
      WITH base AS (
        SELECT o.id, o."productType", o."status", o."orderedAt",
               o."grossAmountUsd", o."netAmountUsd", o."cpaPaidUsd", o."cogsUsd", o."fulfillmentUsd",
               pr.id AS product_id,
               pl."slug" || ':' || COALESCE(o."parentExternalId", o."externalId") AS skey
        FROM "Order" o
        JOIN "Platform" pl ON o."platformId" = pl.id
        JOIN "Product" pr ON o."productId" = pr.id
        WHERE ${where}
      ),
      fe AS (
        SELECT DISTINCT ON (skey) skey, product_id
        FROM base
        WHERE "productType" = 'FRONTEND'
        ORDER BY skey, "orderedAt" ASC, id ASC
      )
      SELECT
        fe.product_id,
        COUNT(DISTINCT b.skey)::bigint AS sessions,
        COUNT(*)::bigint AS orders,
        COALESCE(SUM(b."grossAmountUsd") FILTER (WHERE b."status" = 'APPROVED'), 0) AS revenue,
        COALESCE(SUM(b."netAmountUsd") FILTER (WHERE b."status" = 'APPROVED'), 0) AS net,
        COALESCE(SUM(b."cpaPaidUsd"), 0) AS cpa,
        COALESCE(SUM(b."cogsUsd"), 0) AS cogs,
        COALESCE(SUM(b."fulfillmentUsd"), 0) AS fulfillment
      FROM base b
      JOIN fe ON fe.skey = b.skey
      GROUP BY fe.product_id
    `),
  ]);

  // Tipo dominante: rows vêm ORDER BY cnt DESC, t ASC — primeiro row por
  // SKU é o tipo de exibição.
  const displayTypeById = new Map<string, string>();
  for (const r of typeCountRows) {
    if (!displayTypeById.has(r.product_id)) displayTypeById.set(r.product_id, r.t);
  }

  const attById = new Map(attRows.map((r) => [r.product_id, r]));

  const products = skuRows
    .map((p) => {
      const att = attById.get(p.product_id);
      const net = toNumber(p.net);
      const cogs = toNumber(p.cogs);
      const fulfillment = toNumber(p.fulfillment);
      const revenue = toNumber(p.revenue);
      const allOrders = Number(p.all_orders);
      const orders = Number(p.approved_orders);
      const attRevenue = att ? toNumber(att.revenue) : 0;
      const attNet = att ? toNumber(att.net) : 0;
      const attProfit = attNet - (att ? toNumber(att.cogs) : 0) - (att ? toNumber(att.fulfillment) : 0);
      return {
        externalId: p.external_id,
        name: p.name,
        productType: displayTypeById.get(p.product_id) ?? p.catalog_type,
        family: p.family,
        variant: p.variant,
        bottles: p.bottles,
        catalogPriceUsd: p.catalog_price_usd != null ? Number(p.catalog_price_usd) : null,
        salesPageUrl: p.sales_page_url,
        checkoutUrl: p.checkout_url,
        thanksPageUrl: p.thanks_page_url,
        driveUrl: p.drive_url,
        catalogStatus: p.catalog_status,
        platformSlug: p.platform_slug,
        vendorAccount: p.vendor_account,
        revenue: round2(revenue),
        orders,
        allOrders,
        refunds: Number(p.refunds),
        chargebacks: Number(p.chargebacks),
        net: round2(net),
        cpa: round2(toNumber(p.cpa)),
        cogs: round2(cogs),
        fulfillment: round2(fulfillment),
        estimatedProfit: round2(net - cogs - fulfillment),
        estimatedMarginPct: revenue > 0
          ? Math.round(((net - cogs - fulfillment) / revenue) * 10000) / 100
          : 0,
        approvalRate: allOrders ? round4(orders / allOrders) : 0,
        firstSoldAt: p.first_sold_at?.toISOString() ?? null,
        lastSoldAt: p.last_sold_at?.toISOString() ?? null,
        attributedSessions: att ? Number(att.sessions) : 0,
        attributedOrders: att ? Number(att.orders) : 0,
        attributedRevenue: round2(attRevenue),
        attributedNet: round2(attNet),
        attributedCpa: round2(att ? toNumber(att.cpa) : 0),
        attributedCogs: round2(att ? toNumber(att.cogs) : 0),
        attributedFulfillment: round2(att ? toNumber(att.fulfillment) : 0),
        attributedProfit: round2(attProfit),
        attributedMarginPct: attRevenue > 0
          ? Math.round((attProfit / attRevenue) * 10000) / 100
          : 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  const byTypeMap = new Map(byTypeRows.map((r) => [r.t, r]));
  const TYPE_ORDER = ['FRONTEND', 'UPSELL', 'BUMP', 'DOWNSELL'];
  const byType = TYPE_ORDER.map((productType) => {
    const e = byTypeMap.get(productType);
    return {
      productType,
      revenue: round2(e ? toNumber(e.revenue) : 0),
      orders: e ? Number(e.orders) : 0,
      net: round2(e ? toNumber(e.net) : 0),
      cpa: round2(e ? toNumber(e.cpa) : 0),
      productCount: e ? Number(e.product_count) : 0,
    };
  });

  return { byType, products };
}

export async function getPlatforms(
  filters: MetricsFilters,
): Promise<PlatformsResponse> {
  // When the user filters by platform, drop the others from the page entirely
  // (cards for unfiltered platforms would just show zeros and add noise).
  const where: Prisma.OrderWhereInput = {
    orderedAt: { gte: filters.startDate, lte: filters.endDate },
  };
  if (filters.platformSlugs?.length) {
    where.platform = { slug: { in: filters.platformSlugs } };
  }
  if (filters.countries?.length) {
    where.country = { in: filters.countries };
  }
  if (filters.productExternalIds?.length || filters.productFamilies?.length) {
    where.product = {
      ...(filters.productExternalIds?.length ? { externalId: { in: filters.productExternalIds } } : {}),
      ...(filters.productFamilies?.length ? { family: { in: filters.productFamilies } } : {}),
    };
  }
  if (filters.productTypes?.length) {
    where.productType = { in: filters.productTypes };
  }

  const [platforms, orders, affiliatesTotalByPlatform] = await Promise.all([
    db.platform.findMany({
      where: filters.platformSlugs?.length
        ? { slug: { in: filters.platformSlugs } }
        : undefined,
      select: {
        id: true,
        slug: true,
        displayName: true,
        isActive: true,
        lastSyncAt: true,
        feeRatePct: true,
        allowancePct: true,
        feesUpdatedAt: true,
      },
    }),
    db.order.findMany({
      where,
      select: {
        status: true,
        grossAmountUsd: true,
        cpaPaidUsd: true,
        affiliateId: true,
        platform: { select: { id: true, slug: true } },
        product: { select: { externalId: true, name: true } },
      },
    }),
    db.affiliate.groupBy({
      by: ['platformId'],
      _count: { _all: true },
    }),
  ]);
  const affTotalMap = new Map<string, number>();
  for (const row of affiliatesTotalByPlatform) {
    affTotalMap.set(row.platformId, row._count._all);
  }

  interface PlatformAgg {
    id: string;
    slug: string;
    displayName: string;
    isActive: boolean;
    lastSyncAt: string | null;
    feeRatePct: number | null;
    allowancePct: number | null;
    feesUpdatedAt: string | null;
    revenue: number;
    orders: number;
    allOrders: number;
    refunds: number;
    chargebacks: number;
    // Gross das orders REFUNDED+CHARGEBACK (sinal positivo do valor original).
    // Digistore desconta o allowance de cima do gross bruto (que inclui o
    // que depois virou refund). Diferença sobre gross líquido = pequena, mas
    // contribui pra precisão do número final.
    grossRefunded: number;
    // Sum de cpaPaidUsd de todas as orders. Comissões pagas a afiliados
    // saem do bolso do vendor — entra no waterfall "Your earnings".
    cpaPaidTotal: number;
    activeAffIds: Set<string>;
    byProduct: Map<string, { externalId: string; name: string; revenue: number; orders: number }>;
  }

  const byPlatform = new Map<string, PlatformAgg>();
  for (const p of platforms) {
    byPlatform.set(p.id, {
      id: p.id,
      slug: p.slug,
      displayName: p.displayName,
      isActive: p.isActive,
      lastSyncAt: p.lastSyncAt?.toISOString() ?? null,
      feeRatePct: p.feeRatePct ? toNumber(p.feeRatePct) : null,
      allowancePct: p.allowancePct ? toNumber(p.allowancePct) : null,
      feesUpdatedAt: p.feesUpdatedAt?.toISOString() ?? null,
      revenue: 0,
      orders: 0,
      allOrders: 0,
      refunds: 0,
      chargebacks: 0,
      grossRefunded: 0,
      cpaPaidTotal: 0,
      activeAffIds: new Set(),
      byProduct: new Map(),
    });
  }

  for (const o of orders) {
    const p = byPlatform.get(o.platform.id);
    if (!p) continue;
    p.allOrders++;
    if (o.affiliateId) p.activeAffIds.add(o.affiliateId);
    // CPA é pago independentemente do status final (refund às vezes clawback,
    // às vezes não — depende da plataforma). Pra fim de waterfall do vendor,
    // somar o que realmente saiu via IPN. Quando o refund clawback acontece,
    // o IPN seguinte zera o cpaPaidUsd da row REFUNDED, então sum funciona.
    p.cpaPaidTotal += toNumber(o.cpaPaidUsd);
    if (o.status === 'APPROVED') {
      const gross = toNumber(o.grossAmountUsd);
      p.orders++;
      p.revenue += gross;
      const key = o.product.externalId;
      const prod = p.byProduct.get(key) ?? {
        externalId: key,
        name: o.product.name,
        revenue: 0,
        orders: 0,
      };
      prod.revenue += gross;
      prod.orders++;
      p.byProduct.set(key, prod);
    } else if (o.status === 'REFUNDED') {
      p.refunds++;
      // grossAmountUsd em refund row é o valor original (positivo) na
      // nossa convenção de ingest. Se vier negativo (algumas IPNs),
      // usar abs pra normalizar.
      p.grossRefunded += Math.abs(toNumber(o.grossAmountUsd));
    } else if (o.status === 'CHARGEBACK') {
      p.chargebacks++;
      p.grossRefunded += Math.abs(toNumber(o.grossAmountUsd));
    }
  }

  return {
    platforms: Array.from(byPlatform.values())
      .map((p) => {
        const denom = p.allOrders || 1;
        let topProduct:
          | { externalId: string; name: string; revenue: number; orders: number }
          | null = null;
        for (const prod of p.byProduct.values()) {
          if (!topProduct || prod.revenue > topProduct.revenue) {
            topProduct = {
              externalId: prod.externalId,
              name: prod.name,
              revenue: round2(prod.revenue),
              orders: prod.orders,
            };
          }
        }
        // Taxas e allowance vivem como % flat por plataforma (cadastrado
        // pelo admin). Aplicados sobre gross BRUTO (incluindo refunds/CBs
        // — Digistore desconta da venda original) pra casar com o CSV oficial
        // que o vendor exporta na plataforma. Null quando não cadastrado.
        const grossBruto = p.revenue + p.grossRefunded;
        const taxesPaid = p.feeRatePct != null
          ? round2((grossBruto * p.feeRatePct) / 100)
          : null;
        const allowanceReserved = p.allowancePct != null
          ? round2((grossBruto * p.allowancePct) / 100)
          : null;
        // Your earnings estimado = gross líquido − taxa − comissões.
        // Aproxima o "Your earnings líquido após refunds" do relatório
        // Digistore. Não inclui custos operacionais (COGS, fulfillment).
        const vendorEarnings = taxesPaid != null
          ? round2(p.revenue - taxesPaid - p.cpaPaidTotal)
          : null;
        return {
          slug: p.slug,
          displayName: p.displayName,
          isActive: p.isActive,
          lastSyncAt: p.lastSyncAt,
          totalRevenue: round2(p.revenue),
          totalOrders: p.orders,
          allOrders: p.allOrders,
          approvalRate: p.allOrders ? round4(p.orders / denom) : 0,
          refundRate: p.allOrders ? round4(p.refunds / denom) : 0,
          cbRate: p.allOrders ? round4(p.chargebacks / denom) : 0,
          affiliatesTotal: affTotalMap.get(p.id) ?? 0,
          affiliatesActive: p.activeAffIds.size,
          topProduct,
          feeRatePct: p.feeRatePct,
          allowancePct: p.allowancePct,
          feesUpdatedAt: p.feesUpdatedAt,
          taxesPaid,
          allowanceReserved,
          // Detalhamento financeiro pro waterfall do card de plataforma.
          // Permite o usuário reconciliar com o CSV de relatório Digistore.
          grossBruto: round2(grossBruto),
          grossRefunded: round2(p.grossRefunded),
          cpaPaidTotal: round2(p.cpaPaidTotal),
          vendorEarnings,
        };
      })
      .sort((a, b) => b.totalRevenue - a.totalRevenue),
  };
}

/**
 * Fulfillment overview: distribuição APPROVED orders entre RedRock e
 * ShipOffers. Resolve o supplier on-the-fly seguindo a cadeia:
 *   Product.fulfillmentSupplier (override por SKU)
 *   → ProductFamilyCost.fulfillmentSupplier (default da família)
 *   → 'shipoffers' (default do sistema)
 *
 * Não usa snapshot — reconfigurações no painel refletem imediatamente nas
 * métricas (sem precisar rodar backfill). Snapshot só existe pro valor $$
 * de Order.fulfillmentUsd, que é o que foi efetivamente pago.
 */
export async function getFulfillmentOverview(
  filters: MetricsFilters,
): Promise<FulfillmentOverviewResponse> {
  const where: Prisma.OrderWhereInput = {
    orderedAt: { gte: filters.startDate, lte: filters.endDate },
    status: 'APPROVED',  // refunds/CBs não contam como pacote saindo
  };
  if (filters.platformSlugs?.length) {
    where.platform = { slug: { in: filters.platformSlugs } };
  }
  if (filters.countries?.length) {
    where.country = { in: filters.countries };
  }
  if (filters.productExternalIds?.length || filters.productFamilies?.length) {
    where.product = {
      ...(filters.productExternalIds?.length ? { externalId: { in: filters.productExternalIds } } : {}),
      ...(filters.productFamilies?.length ? { family: { in: filters.productFamilies } } : {}),
    };
  }
  if (filters.productTypes?.length) {
    where.productType = { in: filters.productTypes };
  }

  const [orders, familyCosts] = await Promise.all([
    db.order.findMany({
      where,
      select: {
        orderedAt: true,
        fulfillmentUsd: true,
        product: { select: { family: true, fulfillmentSupplier: true } },
      },
    }),
    db.productFamilyCost.findMany({
      select: { family: true, fulfillmentSupplier: true },
    }),
  ]);

  const familyDefault = new Map<string, string>();
  for (const f of familyCosts) familyDefault.set(f.family, f.fulfillmentSupplier);

  const resolveSupplierLocal = (
    family: string | null,
    productOverride: string | null,
  ): 'redrock' | 'shipoffers' => {
    const raw = productOverride
      ?? (family ? familyDefault.get(family) : null)
      ?? 'shipoffers';
    return raw === 'redrock' ? 'redrock' : 'shipoffers';
  };

  let redRockOrders = 0;
  let shipOffersOrders = 0;
  let redRockUsd = 0;
  let shipOffersUsd = 0;
  // Bucket por dia (UTC date key, idem ao costs-overview).
  const dailyMap = new Map<string, { redRockOrders: number; shipOffersOrders: number }>();

  for (const o of orders) {
    const supplier = resolveSupplierLocal(
      o.product.family,
      o.product.fulfillmentSupplier,
    );
    const usd = Number(o.fulfillmentUsd);
    const dayKey = o.orderedAt.toISOString().slice(0, 10);
    let day = dailyMap.get(dayKey);
    if (!day) {
      day = { redRockOrders: 0, shipOffersOrders: 0 };
      dailyMap.set(dayKey, day);
    }
    if (supplier === 'redrock') {
      redRockOrders++;
      redRockUsd += usd;
      day.redRockOrders++;
    } else {
      shipOffersOrders++;
      shipOffersUsd += usd;
      day.shipOffersOrders++;
    }
  }

  const total = redRockOrders + shipOffersOrders;
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  const daily = Array.from(dailyMap.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, d]) => ({ date, ...d }));

  return {
    range: {
      start: filters.startDate.toISOString(),
      end: filters.endDate.toISOString(),
    },
    kpis: {
      totalOrders: total,
      redRockOrders,
      shipOffersOrders,
      redRockPct: pct(redRockOrders),
      shipOffersPct: pct(shipOffersOrders),
      redRockFulfillmentUsd: redRockUsd,
      shipOffersFulfillmentUsd: shipOffersUsd,
    },
    bySupplier: [
      {
        supplier: 'redrock',
        orderCount: redRockOrders,
        fulfillmentUsd: redRockUsd,
        pct: pct(redRockOrders),
      },
      {
        supplier: 'shipoffers',
        orderCount: shipOffersOrders,
        fulfillmentUsd: shipOffersUsd,
        pct: pct(shipOffersOrders),
      },
    ],
    daily,
  };
}

/**
 * Costs overview: vendor margin lens. Aggregates APPROVED orders in the period
 * into the 4 cost buckets (fulfillment, COGS, platform fees, CPA) plus a
 * snapshot of allowance reserved (rolling 60d — independent of period filter).
 *
 * Platform fees: prefer real Order.fees + Order.taxAmount when present (Digistore
 * sends breakdown in IPN). Fall back to Platform.feeRatePct × gross for
 * platforms that don't (ClickBank).
 */
export async function getCostsOverview(
  filters: MetricsFilters,
): Promise<CostsOverviewResponse> {
  const where: Prisma.OrderWhereInput = {
    orderedAt: { gte: filters.startDate, lte: filters.endDate },
  };
  if (filters.platformSlugs?.length) {
    where.platform = { slug: { in: filters.platformSlugs } };
  }
  if (filters.countries?.length) {
    where.country = { in: filters.countries };
  }
  if (filters.productExternalIds?.length || filters.productFamilies?.length) {
    where.product = {
      ...(filters.productExternalIds?.length ? { externalId: { in: filters.productExternalIds } } : {}),
      ...(filters.productFamilies?.length ? { family: { in: filters.productFamilies } } : {}),
    };
  }
  if (filters.productTypes?.length) {
    where.productType = { in: filters.productTypes };
  }

  const orders = await db.order.findMany({
    where,
    select: {
      status: true,
      orderedAt: true,
      grossAmountUsd: true,
      netAmountUsd: true,
      fees: true,
      taxAmount: true,
      cpaPaidUsd: true,
      cogsUsd: true,
      fulfillmentUsd: true,
      platform: {
        select: { slug: true, displayName: true, feeRatePct: true, allowancePct: true },
      },
      product: { select: { family: true } },
    },
  });

  // Catalogued families: used to flag rows in byFamily when ProductFamilyCost
  // doesn't have an entry yet ("PLACEHOLDER" badge in UI).
  const catalogedRows = await db.productFamilyCost.findMany({ select: { family: true } });
  const catalogedFamilies = new Set(catalogedRows.map((r) => r.family));

  interface DailyAgg {
    grossUsd: number;
    fulfillmentUsd: number;
    cogsUsd: number;
    platformFeesUsd: number;
    cpaUsd: number;
  }
  interface PlatformAgg {
    slug: string;
    displayName: string;
    grossUsd: number;
    platformFeesUsd: number;
    cogsUsd: number;
    fulfillmentUsd: number;
    cpaUsd: number;
  }
  interface FamilyAgg {
    family: string;
    grossUsd: number;
    cogsUsd: number;
    fulfillmentUsd: number;
  }

  const dailyMap = new Map<string, DailyAgg>();
  const platformMap = new Map<string, PlatformAgg>();
  const familyMap = new Map<string, FamilyAgg>();

  let grossApproved = 0;
  let fulfillApproved = 0;
  let cogsApproved = 0;
  let cpaApproved = 0;
  let feesApproved = 0;
  let refundsGross = 0;
  let refundsCount = 0;

  for (const o of orders) {
    const gross = toNumber(o.grossAmountUsd);
    const fees = toNumber(o.fees);
    const tax = toNumber(o.taxAmount);
    const cpa = toNumber(o.cpaPaidUsd);
    const cogs = toNumber(o.cogsUsd);
    const fulfill = toNumber(o.fulfillmentUsd);
    const feeRatePct = o.platform.feeRatePct ? toNumber(o.platform.feeRatePct) : 0;
    const isRefundLike = o.status === 'REFUNDED' || o.status === 'CHARGEBACK';
    const isApproved = o.status === 'APPROVED';

    // COGS + frete: somamos em TODOS os pedidos onde o supplier já produziu
    // e enviou (APPROVED + REFUNDED + CHARGEBACK). O refund/CB devolve a
    // venda mas o produto já saiu — o custo continua nosso.
    // Convenção alinhada com a /overview ("incl. refunds — we ate the cost").
    const includeCostsForThisOrder = isApproved || isRefundLike;

    if (isRefundLike) {
      refundsGross += Math.abs(gross);
      refundsCount++;
    }

    if (!isApproved && !isRefundLike) continue; // PENDING, CANCELED — sem custo nosso

    // Platform fee per order: real breakdown if present, else feeRatePct estimate.
    // Aplicado SÓ em APPROVED — em refund o IPN devolve a fee, então não
    // adicionamos retroativamente (e gross dele é negativo, viraria desconto).
    const realFee = fees + tax;
    const feeForOrder = isApproved
      ? (realFee > 0 ? realFee : feeRatePct > 0 ? (gross * feeRatePct) / 100 : 0)
      : 0;

    if (isApproved) {
      grossApproved += gross;
      feesApproved += feeForOrder;
      cpaApproved += cpa;
    }
    if (includeCostsForThisOrder) {
      cogsApproved += cogs;
      fulfillApproved += fulfill;
    }

    // Daily bucket (UTC day key). Inclui APPROVED gross/fees/cpa do dia +
    // COGS/frete dos refunds do dia. Se quisermos isolar puro-aprovado no
    // gráfico, basta usar a métrica gross/fees/cpa que ignoram refunds.
    const dayKey = isoDate(o.orderedAt);
    const d = dailyMap.get(dayKey) ?? {
      grossUsd: 0, fulfillmentUsd: 0, cogsUsd: 0, platformFeesUsd: 0, cpaUsd: 0,
    };
    if (isApproved) {
      d.grossUsd += gross;
      d.platformFeesUsd += feeForOrder;
      d.cpaUsd += cpa;
    }
    if (includeCostsForThisOrder) {
      d.fulfillmentUsd += fulfill;
      d.cogsUsd += cogs;
    }
    dailyMap.set(dayKey, d);

    // Platform bucket.
    const slug = o.platform.slug;
    const p = platformMap.get(slug) ?? {
      slug,
      displayName: o.platform.displayName,
      grossUsd: 0, platformFeesUsd: 0, cogsUsd: 0, fulfillmentUsd: 0, cpaUsd: 0,
    };
    if (isApproved) {
      p.grossUsd += gross;
      p.platformFeesUsd += feeForOrder;
      p.cpaUsd += cpa;
    }
    if (includeCostsForThisOrder) {
      p.cogsUsd += cogs;
      p.fulfillmentUsd += fulfill;
    }
    platformMap.set(slug, p);

    // Family bucket. '_unknown' for orders whose product isn't classified.
    const fam = o.product.family || '_unknown';
    const f = familyMap.get(fam) ?? {
      family: fam, grossUsd: 0, cogsUsd: 0, fulfillmentUsd: 0,
    };
    if (isApproved) f.grossUsd += gross;
    if (includeCostsForThisOrder) {
      f.cogsUsd += cogs;
      f.fulfillmentUsd += fulfill;
    }
    familyMap.set(fam, f);
  }

  // Fill missing days in range so the chart line is continuous.
  const daily: CostsOverviewResponse['daily'] = [];
  for (
    let d = startOfDay(filters.startDate);
    d <= filters.endDate;
    d = addDays(d, 1)
  ) {
    const key = isoDate(d);
    const agg = dailyMap.get(key);
    if (agg) {
      const profit = agg.grossUsd - agg.platformFeesUsd - agg.cpaUsd - agg.cogsUsd - agg.fulfillmentUsd;
      daily.push({
        date: key,
        grossUsd: round2(agg.grossUsd),
        fulfillmentUsd: round2(agg.fulfillmentUsd),
        cogsUsd: round2(agg.cogsUsd),
        platformFeesUsd: round2(agg.platformFeesUsd),
        cpaUsd: round2(agg.cpaUsd),
        profitUsd: round2(profit),
      });
    } else {
      daily.push({
        date: key,
        grossUsd: 0, fulfillmentUsd: 0, cogsUsd: 0,
        platformFeesUsd: 0, cpaUsd: 0, profitUsd: 0,
      });
    }
  }

  const byPlatform: CostsOverviewResponse['byPlatform'] = Array.from(platformMap.values())
    .map((p) => {
      const profit = p.grossUsd - p.platformFeesUsd - p.cpaUsd - p.cogsUsd - p.fulfillmentUsd;
      return {
        slug: p.slug,
        displayName: p.displayName,
        grossUsd: round2(p.grossUsd),
        platformFeesUsd: round2(p.platformFeesUsd),
        feeRatePctEffective: p.grossUsd > 0 ? round4((p.platformFeesUsd / p.grossUsd) * 100) : 0,
        cogsUsd: round2(p.cogsUsd),
        fulfillmentUsd: round2(p.fulfillmentUsd),
        cpaUsd: round2(p.cpaUsd),
        profitUsd: round2(profit),
        marginPct: p.grossUsd > 0 ? round4((profit / p.grossUsd) * 100) : 0,
      };
    })
    .sort((a, b) => b.grossUsd - a.grossUsd);

  const byFamily: CostsOverviewResponse['byFamily'] = Array.from(familyMap.values())
    .map((f) => {
      const profit = f.grossUsd - f.cogsUsd - f.fulfillmentUsd;
      return {
        family: f.family,
        grossUsd: round2(f.grossUsd),
        cogsUsd: round2(f.cogsUsd),
        fulfillmentUsd: round2(f.fulfillmentUsd),
        profitUsd: round2(profit),
        marginPct: f.grossUsd > 0 ? round4((profit / f.grossUsd) * 100) : 0,
        isCataloged: catalogedFamilies.has(f.family),
      };
    })
    .sort((a, b) => b.grossUsd - a.grossUsd);

  const allowance = await computeAllowanceRolling60d();

  const profitUsd = grossApproved - feesApproved - cpaApproved - cogsApproved - fulfillApproved;

  return {
    range: {
      start: filters.startDate.toISOString(),
      end: filters.endDate.toISOString(),
    },
    kpis: {
      grossUsd: round2(grossApproved),
      refundsUsd: round2(refundsGross),
      refundsCount,
      fulfillmentUsd: round2(fulfillApproved),
      cogsUsd: round2(cogsApproved),
      platformFeesUsd: round2(feesApproved),
      cpaUsd: round2(cpaApproved),
      allowanceReservedUsd: allowance.reservedTodayUsd,
      profitUsd: round2(profitUsd),
      marginPct: grossApproved > 0 ? round4((profitUsd / grossApproved) * 100) : 0,
    },
    daily,
    byPlatform,
    byFamily,
    allowance,
  };
}

/**
 * Snapshot do allowance reservado pelas plataformas (rolling 60d). Para cada
 * plataforma com allowancePct configurado, soma o gross bruto (APPROVED +
 * |refunds|) das últimas 60 dias e multiplica pelo %. As janelas releasingNext*
 * usam orderedAt > 60d atrás − Nd, ou seja, vendas que completam 60 dias nas
 * próximas N. Independente do date range do request — sempre "now-relative".
 */
async function computeAllowanceRolling60d(): Promise<CostsOverviewResponse['allowance']> {
  const platforms = await db.platform.findMany({
    where: { allowancePct: { not: null, gt: 0 } },
    select: { slug: true, displayName: true, allowancePct: true },
  });
  if (platforms.length === 0) {
    return {
      reservedTodayUsd: 0,
      releasingNext7DaysUsd: 0,
      releasingNext30DaysUsd: 0,
      byPlatform: [],
    };
  }

  const now = new Date();
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const thirtyThreeDaysAgo = new Date(now.getTime() - 53 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  let reservedTotal = 0;
  let next7Total = 0;
  let next30Total = 0;
  const byPlatform: CostsOverviewResponse['allowance']['byPlatform'] = [];

  for (const p of platforms) {
    const rate = toNumber(p.allowancePct) / 100;

    // Reservado hoje: vendas (gross bruto signed: APPROVED+|refunds|) nos
    // últimos 60d. Usar abs(grossAmountUsd) capta tanto APPROVED quanto refund
    // como contribuição positiva ao gross original.
    const aggReserved = await db.order.aggregate({
      where: {
        platform: { slug: p.slug },
        orderedAt: { gte: sixtyDaysAgo, lte: now },
        status: { in: ['APPROVED', 'REFUNDED', 'CHARGEBACK'] },
      },
      _sum: { grossAmountUsd: true },
    });
    // Soma simples: refunds têm gross negativo, então isso já é o "net 60d"
    // que aproxima o que a Digistore reserva (Reserve % flutua diariamente
    // com o saldo). Não usar abs pq não queremos duplicar refunds.
    const gross60d = Math.max(0, toNumber(aggReserved._sum.grossAmountUsd));
    const reserved = gross60d * rate;

    // Libera próximos 7 dias: vendas com orderedAt entre [now-60d, now-53d].
    const agg7 = await db.order.aggregate({
      where: {
        platform: { slug: p.slug },
        orderedAt: { gte: sixtyDaysAgo, lte: thirtyThreeDaysAgo },
        status: { in: ['APPROVED', 'REFUNDED', 'CHARGEBACK'] },
      },
      _sum: { grossAmountUsd: true },
    });
    const gross7 = Math.max(0, toNumber(agg7._sum.grossAmountUsd));
    const releasing7 = gross7 * rate;

    // Libera próximos 30 dias: [now-60d, now-30d].
    const agg30 = await db.order.aggregate({
      where: {
        platform: { slug: p.slug },
        orderedAt: { gte: sixtyDaysAgo, lte: thirtyDaysAgo },
        status: { in: ['APPROVED', 'REFUNDED', 'CHARGEBACK'] },
      },
      _sum: { grossAmountUsd: true },
    });
    const gross30 = Math.max(0, toNumber(agg30._sum.grossAmountUsd));
    const releasing30 = gross30 * rate;

    reservedTotal += reserved;
    next7Total += releasing7;
    next30Total += releasing30;
    byPlatform.push({
      slug: p.slug,
      displayName: p.displayName,
      allowancePct: round4(toNumber(p.allowancePct)),
      reservedUsd: round2(reserved),
    });
  }

  return {
    reservedTodayUsd: round2(reservedTotal),
    releasingNext7DaysUsd: round2(next7Total),
    releasingNext30DaysUsd: round2(next30Total),
    byPlatform: byPlatform.sort((a, b) => b.reservedUsd - a.reservedUsd),
  };
}

/**
 * Affiliate drill-down. Lookups by externalId — if the same externalId exists
 * across platforms (rare but possible), can be disambiguated via optional
 * platformSlug.
 */
export async function getAffiliateDetail(
  externalId: string,
  filters: MetricsFilters,
  platformSlugHint?: string,
): Promise<AffiliateDetailResponse | null> {
  const affiliates = await db.affiliate.findMany({
    where: {
      externalId,
      ...(platformSlugHint ? { platform: { slug: platformSlugHint } } : {}),
    },
    select: {
      id: true,
      externalId: true,
      nickname: true,
      firstSeenAt: true,
      lastOrderAt: true,
      platform: { select: { slug: true } },
    },
  });
  if (affiliates.length === 0) return null;
  // Pick the most-recently-active match if multiple platforms have same externalId.
  const aff = affiliates.sort((a, b) => {
    const al = a.lastOrderAt?.getTime() ?? 0;
    const bl = b.lastOrderAt?.getTime() ?? 0;
    return bl - al;
  })[0];

  // All orders for this affiliate within the period (for KPIs + daily + breakdowns)
  const periodWhere: Prisma.OrderWhereInput = {
    affiliateId: aff.id,
    orderedAt: { gte: filters.startDate, lte: filters.endDate },
  };
  if (filters.platformSlugs?.length) {
    periodWhere.platform = { slug: { in: filters.platformSlugs } };
  }
  if (filters.countries?.length) {
    periodWhere.country = { in: filters.countries };
  }
  if (filters.productExternalIds?.length || filters.productFamilies?.length) {
    periodWhere.product = {
      ...(filters.productExternalIds?.length ? { externalId: { in: filters.productExternalIds } } : {}),
      ...(filters.productFamilies?.length ? { family: { in: filters.productFamilies } } : {}),
    };
  }
  if (filters.productTypes?.length) {
    periodWhere.productType = { in: filters.productTypes };
  }

  const [periodOrders, ltvAgg, feSessionKeys] = await Promise.all([
    db.order.findMany({
      where: periodWhere,
      select: {
        status: true,
        grossAmountUsd: true,
        netAmountUsd: true,
        cpaPaidUsd: true,
        country: true,
        orderedAt: true,
        productType: true,
        product: { select: { externalId: true, name: true } },
      },
      orderBy: { orderedAt: 'asc' },
    }),
    // LTV (all-time, all platforms — represents total business with this affiliate)
    db.order.aggregate({
      where: { affiliateId: aff.id, status: 'APPROVED' },
      _sum: { grossAmountUsd: true },
      _count: { _all: true },
    }),
    // Chaves de sessão das FEs do afiliado no período (pro session-AOV abaixo).
    db.order.findMany({
      where: {
        affiliateId: aff.id,
        productType: 'FRONTEND',
        orderedAt: { gte: filters.startDate, lte: filters.endDate },
      },
      select: { parentExternalId: true, externalId: true, platformId: true },
    }),
  ]);

  // KPIs
  let revenue = 0;
  let net = 0;
  let cpa = 0;
  let orders = 0;
  let refunds = 0;
  let chargebacks = 0;
  let feApprovedCount = 0; // FE+APPROVED — denom do AOV direto
  for (const o of periodOrders) {
    net += toNumber(o.netAmountUsd);
    cpa += toNumber(o.cpaPaidUsd);
    if (o.status === 'APPROVED') {
      orders++;
      revenue += toNumber(o.grossAmountUsd);
      if (o.productType === 'FRONTEND') feApprovedCount++;
    } else if (o.status === 'REFUNDED') refunds++;
    else if (o.status === 'CHARGEBACK') chargebacks++;
  }
  const allOrders = periodOrders.length;
  const denom = allOrders || 1;

  // Session-AOV: pull all orders sharing parent_external_ids of this
  // affiliate's FE orders, sum APPROVED gross, divide by FE-session count.
  // Matches the Overview/Funnel "AOV global per buyer" definition — captures
  // upsells/downsells/bumps the same buyer purchased after entering via
  // this affiliate's FE.
  let attributedRevenue = 0;
  let attributedSessions = 0;
  if (feSessionKeys.length > 0) {
    const keysByPlatform = new Map<string, Set<string>>();
    for (const r of feSessionKeys) {
      const set = keysByPlatform.get(r.platformId) ?? new Set<string>();
      set.add(r.parentExternalId ?? r.externalId);
      keysByPlatform.set(r.platformId, set);
    }
    attributedSessions = Array.from(keysByPlatform.values())
      .reduce((sum, s) => sum + s.size, 0);
    // Soma no banco (não em JS) e em paralelo por plataforma. Mantém o OR
    // exato do código antigo — COALESCE não é equivalente quando uma FE tem
    // parentExternalId próprio setado.
    const sums = await Promise.all(
      Array.from(keysByPlatform.entries()).map(([platformId, keys]) => {
        const keysArr = Array.from(keys);
        return db.order.aggregate({
          where: {
            platformId,
            status: 'APPROVED',
            OR: [
              { parentExternalId: { in: keysArr } },
              { externalId: { in: keysArr } },
            ],
          },
          _sum: { grossAmountUsd: true },
        });
      }),
    );
    for (const s of sums) {
      attributedRevenue += toNumber(s._sum.grossAmountUsd ?? 0);
    }
  }

  const kpis = {
    revenue: round2(revenue),
    orders,
    allOrders,
    refunds,
    chargebacks,
    approvalRate: round4(orders / denom),
    refundRate: round4(refunds / denom),
    cbRate: round4(chargebacks / denom),
    cpa: round2(cpa),
    netMargin: round2(net - cpa),
    // AOV direto = receita PRÓPRIA do afiliado / FEs aprovadas dele.
    // Lente direta (orders onde affiliateId = afiliado), NÃO conta
    // cross-sells da sessão creditadas a outros via last-click.
    // Fallback pra AOV por pedido quando não há FE no período.
    aov: round2(
      feApprovedCount > 0
        ? revenue / feApprovedCount
        : orders ? revenue / orders : 0,
    ),
    feApprovedCount,
    attributedSessions,
    attributedRevenue: round2(attributedRevenue),
    // Affiliate EPO = "Commissions Net" / "Conversions". Para o afiliado,
    // commissions net ≈ cpa pago neste período (refunds já zeram o cpa na
    // IPN; sem voids separados a tratar). Conversions = feApprovedCount,
    // nosso proxy de "FEs convertidas atribuídas a ele".
    epo: round2(feApprovedCount > 0 ? cpa / feApprovedCount : 0),
  };

  // Daily series (only days within range)
  const daily = computeDaily(
    periodOrders.map((o) => ({
      orderedAt: o.orderedAt,
      status: o.status,
      grossAmountUsd: o.grossAmountUsd,
      netAmountUsd: o.netAmountUsd,
      cpaPaidUsd: o.cpaPaidUsd,
    })) as unknown as OrderWithJoins[],
    filters.startDate,
    filters.endDate,
  ).map((b) => ({
    date: b.date,
    revenue: b.gross,
    orders: b.approvedOrders,
    allOrders: b.allOrders,
  }));

  // By product
  const productMap = new Map<
    string,
    { externalId: string; name: string; productType: string; orders: number; revenue: number }
  >();
  for (const o of periodOrders) {
    if (o.status !== 'APPROVED') continue;
    const key = o.product.externalId;
    const entry = productMap.get(key) ?? {
      externalId: o.product.externalId,
      name: o.product.name,
      productType: o.productType,
      orders: 0,
      revenue: 0,
    };
    entry.orders++;
    entry.revenue += toNumber(o.grossAmountUsd);
    productMap.set(key, entry);
  }
  const byProduct = Array.from(productMap.values())
    .map((p) => ({ ...p, revenue: round2(p.revenue) }))
    .sort((a, b) => b.revenue - a.revenue);

  // By country
  const countryMap = new Map<string, { code: string; orders: number; revenue: number }>();
  for (const o of periodOrders) {
    if (o.status !== 'APPROVED' || !o.country) continue;
    const entry = countryMap.get(o.country) ?? { code: o.country, orders: 0, revenue: 0 };
    entry.orders++;
    entry.revenue += toNumber(o.grossAmountUsd);
    countryMap.set(o.country, entry);
  }
  const byCountry = Array.from(countryMap.values())
    .map((c) => ({ ...c, revenue: round2(c.revenue) }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);

  // Auto-flags (same heuristics as the legacy mock-based drawer)
  const flags: AffiliateDetailResponse['flags'] = [];
  if (allOrders >= 10) {
    if (kpis.cbRate > 0.01) {
      flags.push({
        kind: 'bad',
        title: 'Chargeback rate elevado',
        desc: `${(kpis.cbRate * 100).toFixed(2)}% de chargebacks — acima do limite MCC de 1.0%. Reveja qualidade do tráfego e mix de pagamento.`,
      });
    }
    if (kpis.refundRate > 0.12) {
      flags.push({
        kind: 'warn',
        title: 'Refund rate elevado',
        desc: `${(kpis.refundRate * 100).toFixed(1)}% de reembolsos vs benchmark de 6%. Cheque promessas pós-compra nas landing pages.`,
      });
    }
    if (kpis.approvalRate < 0.55) {
      flags.push({
        kind: 'bad',
        title: 'Approval rate baixo',
        desc: `Apenas ${(kpis.approvalRate * 100).toFixed(1)}% dos checkouts aprovados. Comum em tráfego frio ou retargeting agressivo.`,
      });
    }
  }

  return {
    affiliate: {
      externalId: aff.externalId,
      nickname: aff.nickname,
      platformSlug: aff.platform.slug,
      firstSeenAt: aff.firstSeenAt.toISOString(),
      lastOrderAt: aff.lastOrderAt?.toISOString() ?? null,
    },
    kpis,
    ltv: {
      revenue: round2(toNumber(ltvAgg._sum.grossAmountUsd)),
      orders: ltvAgg._count._all,
    },
    daily,
    byProduct,
    byCountry,
    flags,
  };
}

// Flag de rollback do pushdown SQL (Fase B). Default ON; setar
// METRICS_SQL_ATTRIBUTION=0 volta pras implementações legacy (agregação em
// JS sobre findMany) sem deploy. Remover legacy+flag após 1-2 semanas
// estáveis em prod.
const USE_SQL_ATTRIBUTION = process.env.METRICS_SQL_ATTRIBUTION !== '0';

export async function getAffiliates(
  filters: MetricsFilters,
): Promise<AffiliatesResponse> {
  return USE_SQL_ATTRIBUTION ? getAffiliatesSql(filters) : getAffiliatesLegacy(filters);
}

// Implementação legacy: 2 findMany O(orders) + agregação em JS. Mantida
// SOMENTE pra prova de paridade e rollback — ver getAffiliatesSql abaixo.
export async function getAffiliatesLegacy(
  filters: MetricsFilters,
): Promise<AffiliatesResponse> {
  const span = filters.endDate.getTime() - filters.startDate.getTime();
  const prevEnd = new Date(filters.startDate.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - span);
  const sparkStart = new Date(filters.endDate.getTime() - 30 * 24 * 3600 * 1000);
  const coverageStart = new Date(Math.min(prevStart.getTime(), sparkStart.getTime()));

  const whereInCoverage: Prisma.OrderWhereInput = {
    orderedAt: { gte: coverageStart, lte: filters.endDate },
    affiliateId: { not: null },
  };
  if (filters.platformSlugs?.length) {
    whereInCoverage.platform = { slug: { in: filters.platformSlugs } };
  }
  if (filters.countries?.length) {
    whereInCoverage.country = { in: filters.countries };
  }
  if (filters.productExternalIds?.length || filters.productFamilies?.length) {
    whereInCoverage.product = {
      ...(filters.productExternalIds?.length ? { externalId: { in: filters.productExternalIds } } : {}),
      ...(filters.productFamilies?.length ? { family: { in: filters.productFamilies } } : {}),
    };
  }
  if (filters.productTypes?.length) {
    whereInCoverage.productType = { in: filters.productTypes };
  }

  // WHERE da session attribution: TODAS as orders do período (sem filtro de
  // afiliado) pra montar irmãos de sessão mesmo quando o upsell tem
  // affiliateId = null. productFamilies NÃO entra aqui de propósito — a
  // sessão inteira (FE + cross-sells de outras famílias) é atribuída ao
  // afiliado da FE; filtrar por família dropava sessões com upsell
  // cross-family e quebrava a matemática de atribuição.
  const periodWhere: Prisma.OrderWhereInput = {
    orderedAt: { gte: filters.startDate, lte: filters.endDate },
  };
  if (filters.platformSlugs?.length) periodWhere.platform = { slug: { in: filters.platformSlugs } };
  if (filters.countries?.length) periodWhere.country = { in: filters.countries };

  const [orders, periodOrders, ltvByAff, affiliatesAll] = await Promise.all([
    db.order.findMany({
      where: whereInCoverage,
      select: {
        status: true,
        grossAmountUsd: true,
        netAmountUsd: true,
        cpaPaidUsd: true,
        cogsUsd: true,
        fulfillmentUsd: true,
        country: true,
        orderedAt: true,
        productType: true,
        affiliate: { select: { externalId: true, nickname: true, platformId: true } },
        platform: { select: { slug: true } },
      },
    }),
    db.order.findMany({
      where: periodWhere,
      select: {
        status: true,
        grossAmountUsd: true,
        netAmountUsd: true,
        cpaPaidUsd: true,
        cogsUsd: true,
        fulfillmentUsd: true,
        productType: true,
        parentExternalId: true,
        externalId: true,
        orderedAt: true,
        affiliate: { select: { externalId: true, nickname: true } },
        platform: { select: { slug: true } },
      },
    }),
    db.order.groupBy({
      by: ['affiliateId'],
      where: { affiliateId: { not: null }, status: 'APPROVED' },
      _sum: { grossAmountUsd: true },
      _count: { _all: true },
    }),
    db.affiliate.findMany({
      select: {
        externalId: true,
        nickname: true,
        firstSeenAt: true,
        lastOrderAt: true,
        platform: { select: { slug: true } },
        id: true,
      },
    }),
  ]);

  // ---------------- Session attribution pass ----------------

  interface SessAtt {
    feAffKey: string | null;
    feAffData: { externalId: string; nickname: string | null; platformSlug: string } | null;
    feSeenAtMs: number;
    orders: typeof periodOrders;
  }
  const sessions = new Map<string, SessAtt>();
  for (const o of periodOrders) {
    const key = `${o.platform.slug}:${o.parentExternalId ?? o.externalId}`;
    let s = sessions.get(key);
    if (!s) {
      s = { feAffKey: null, feAffData: null, feSeenAtMs: Number.POSITIVE_INFINITY, orders: [] };
      sessions.set(key, s);
    }
    s.orders.push(o);
    if (o.productType === 'FRONTEND' && o.affiliate && o.orderedAt.getTime() < s.feSeenAtMs) {
      s.feAffKey = `${o.platform.slug}:${o.affiliate.externalId}`;
      s.feAffData = {
        externalId: o.affiliate.externalId,
        nickname: o.affiliate.nickname,
        platformSlug: o.platform.slug,
      };
      s.feSeenAtMs = o.orderedAt.getTime();
    }
  }

  interface AttAgg {
    externalId: string;
    nickname: string | null;
    platformSlug: string;
    sessions: number;
    orders: number;
    revenue: number;
    net: number;
    cpa: number;
    cogs: number;
    fulfillment: number;
  }
  const attByAff = new Map<string, AttAgg>();
  for (const s of sessions.values()) {
    if (!s.feAffKey || !s.feAffData) continue;
    let a = attByAff.get(s.feAffKey);
    if (!a) {
      a = {
        ...s.feAffData,
        sessions: 0, orders: 0,
        revenue: 0, net: 0, cpa: 0, cogs: 0, fulfillment: 0,
      };
      attByAff.set(s.feAffKey, a);
    }
    a.sessions++;
    for (const o of s.orders) {
      a.orders++;
      if (o.status === 'APPROVED') {
        a.revenue += toNumber(o.grossAmountUsd);
        a.net += toNumber(o.netAmountUsd);
      }
      a.cpa += toNumber(o.cpaPaidUsd);
      a.cogs += toNumber(o.cogsUsd ?? 0);
      a.fulfillment += toNumber(o.fulfillmentUsd ?? 0);
    }
  }
  // ---------------- /attribution pass ----------------

  const ltvMap = new Map<string, { revenue: number; orders: number }>();
  for (const row of ltvByAff) {
    if (!row.affiliateId) continue;
    ltvMap.set(row.affiliateId, {
      revenue: toNumber(row._sum.grossAmountUsd),
      orders: row._count._all,
    });
  }
  const affMetaById = new Map<string, (typeof affiliatesAll)[number]>();
  for (const a of affiliatesAll) affMetaById.set(a.id, a);

  interface Agg {
    externalId: string;
    platformSlug: string;
    nickname: string | null;
    revenue: number;
    orders: number;
    allOrders: number;
    refunds: number;
    chargebacks: number;
    cpa: number;
    // CPA negociado do afiliado: descoberto via MODE (valor mais
    // frequente) de cpaPaidUsd nas vendas FE+APPROVED+cpa>0.
    // Em direct response cada afiliado tem 1 CPA fixo por produto
    // enrolled — esses valores formam um pico claro nos dados.
    // Mean ponderada deflaciona porque vendas sem CPA contratado
    // (cpa=0) e refunds (cpa zerado pelo IPN) puxam pra baixo.
    feApprovedCount: number;       // total FE+APPROVED (qualquer cpa)
    feCpaPaidCount: number;        // só FE+APPROVED com cpa > 0
    cpaCounts: Map<number, number>; // distinct cpa value -> count, p/ mode
    net: number;
    cogs: number;
    fulfillment: number;
    byCountry: Map<string, number>;
    sparkline: number[];
  }

  function modeOf(counts: Map<number, number>): number {
    // Tie-break: valor MAIOR ganha (proxy de "tier mais alto" se
    // afiliado tem 2 CPAs com volumes equivalentes).
    let modeVal = 0, modeCount = 0;
    for (const [v, c] of counts) {
      if (c > modeCount || (c === modeCount && v > modeVal)) {
        modeCount = c;
        modeVal = v;
      }
    }
    return modeVal;
  }

  const SPARK_DAYS = 30;
  const dayMs = 24 * 3600 * 1000;
  const sparkStartMs = sparkStart.getTime();
  const periodStartMs = filters.startDate.getTime();
  const periodEndMs = filters.endDate.getTime();
  const prevStartMs = prevStart.getTime();
  const prevEndMs = prevEnd.getTime();

  const inPeriod = new Map<string, Agg>();
  const prevSeen = new Set<string>();

  for (const o of orders) {
    if (!o.affiliate) continue;
    const aff = o.affiliate;
    const t = o.orderedAt.getTime();
    const key = `${o.platform.slug}:${aff.externalId}`;

    if (t >= prevStartMs && t <= prevEndMs) prevSeen.add(key);

    if (t >= periodStartMs && t <= periodEndMs) {
      let a = inPeriod.get(key);
      if (!a) {
        a = {
          externalId: aff.externalId,
          platformSlug: o.platform.slug,
          nickname: aff.nickname,
          revenue: 0,
          orders: 0,
          allOrders: 0,
          refunds: 0,
          chargebacks: 0,
          cpa: 0,
          feApprovedCount: 0,
          feCpaPaidCount: 0,
          cpaCounts: new Map(),
          net: 0,
          cogs: 0,
          fulfillment: 0,
          byCountry: new Map(),
          sparkline: new Array(SPARK_DAYS).fill(0),
        };
        inPeriod.set(key, a);
      }
      a.allOrders++;
      a.cpa += toNumber(o.cpaPaidUsd);
      a.net += toNumber(o.netAmountUsd);
      a.cogs += toNumber(o.cogsUsd ?? 0);
      a.fulfillment += toNumber(o.fulfillmentUsd ?? 0);
      if (o.status === 'APPROVED') {
        a.revenue += toNumber(o.grossAmountUsd);
        a.orders++;
        // Captura CPA negociado: só FE+APPROVED+cpa>0.
        // Cada valor distinto de cpaPaidUsd vira um bucket no
        // cpaCounts → mode disso = CPA real do afiliado.
        if (o.productType === 'FRONTEND') {
          a.feApprovedCount++;
          const cpaVal = toNumber(o.cpaPaidUsd);
          if (cpaVal > 0) {
            a.feCpaPaidCount++;
            // Round to 2 decimals pra agrupar valores quase iguais
            // (ex: $220.00 e $220 do Decimal vs Number).
            const key = Math.round(cpaVal * 100) / 100;
            a.cpaCounts.set(key, (a.cpaCounts.get(key) ?? 0) + 1);
          }
        }
      } else if (o.status === 'REFUNDED') {
        a.refunds++;
      } else if (o.status === 'CHARGEBACK') {
        a.chargebacks++;
      }
      if (o.country) {
        a.byCountry.set(o.country, (a.byCountry.get(o.country) ?? 0) + 1);
      }
    }

    if (t >= sparkStartMs && t <= periodEndMs && o.status === 'APPROVED') {
      const idx = Math.min(SPARK_DAYS - 1, Math.floor((t - sparkStartMs) / dayMs));
      let a = inPeriod.get(key);
      if (a) {
        a.sparkline[idx] += toNumber(o.grossAmountUsd);
      }
    }
  }

  const totalRevenue = Array.from(inPeriod.values()).reduce((s, a) => s + a.revenue, 0);
  const sortedByRev = Array.from(inPeriod.values()).sort((a, b) => b.revenue - a.revenue);
  const top5Revenue = sortedByRev.slice(0, 5).reduce((s, a) => s + a.revenue, 0);
  const concentration = totalRevenue > 0 ? top5Revenue / totalRevenue : 0;

  const nowKeys = new Set(inPeriod.keys());
  const newAff = Array.from(nowKeys).filter((k) => !prevSeen.has(k)).length;
  const churnedAff = Array.from(prevSeen).filter((k) => !nowKeys.has(k)).length;

  const affiliates = affiliatesAll.map((aff) => {
    const key = `${aff.platform.slug}:${aff.externalId}`;
    const a = inPeriod.get(key);
    const att = attByAff.get(key);
    const ltv = ltvMap.get(aff.id);
    let topCountry: string | null = null;
    if (a) {
      let topCount = 0;
      for (const [code, count] of a.byCountry) {
        if (count > topCount) {
          topCount = count;
          topCountry = code;
        }
      }
    }
    const allOrders = a?.allOrders ?? 0;
    const orders = a?.orders ?? 0;
    const refunds = a?.refunds ?? 0;
    const chargebacks = a?.chargebacks ?? 0;
    const denom = allOrders || 1;
    return {
      externalId: aff.externalId,
      platformSlug: aff.platform.slug,
      nickname: aff.nickname,
      revenue: round2(a?.revenue ?? 0),
      orders,
      allOrders,
      refunds,
      chargebacks,
      approvalRate: allOrders ? round4(orders / denom) : 0,
      refundRate: allOrders ? round4(refunds / denom) : 0,
      cbRate: allOrders ? round4(chargebacks / denom) : 0,
      cpa: round2(a?.cpa ?? 0),
      // CPA negociado do afiliado descoberto via MODE de cpaPaidUsd
      // em FE+APPROVED+cpa>0. Imune a refund (status filter) e a
      // sales sem CPA contratado (cpa=0 filter). Ver modeOf() acima.
      feApprovedCount: a?.feApprovedCount ?? 0,
      feCpaPaidCount: a?.feCpaPaidCount ?? 0,
      cpaPerFe: a ? round2(modeOf(a.cpaCounts)) : 0,
      // Mantido pra retrocompat: ainda mean/count, deflaciona com
      // sales cpa=0 mas algumas views podem querer essa lente.
      cpaPerFeApproved: (a?.feApprovedCount ?? 0) > 0
        ? round2((a!.cpa) / (a!.feApprovedCount))
        : 0,
      netMargin: round2((a?.net ?? 0) - (a?.cpa ?? 0)),
      cogs: round2(a?.cogs ?? 0),
      fulfillment: round2(a?.fulfillment ?? 0),
      // Per-order profit: only counts orders where this affiliate is on the
      // affiliateId (direct platform credit). Misses upsells from their leads
      // when the platform attributes UP to a different affiliate or null.
      estimatedProfit: round2(
        (a?.net ?? 0) - (a?.cogs ?? 0) - (a?.fulfillment ?? 0),
      ),
      // Session-attributed profit: includes the full funnel from this
      // affiliate's leads (FE + bumps + UPs + DWs), regardless of who
      // platform credited on backend orders. The "real economic value"
      // their traffic generated.
      attributedSessions: att?.sessions ?? 0,
      attributedOrders: att?.orders ?? 0,
      attributedRevenue: round2(att?.revenue ?? 0),
      attributedNet: round2(att?.net ?? 0),
      attributedCpa: round2(att?.cpa ?? 0),
      attributedCogs: round2(att?.cogs ?? 0),
      attributedFulfillment: round2(att?.fulfillment ?? 0),
      attributedProfit: round2(
        (att?.net ?? 0) - (att?.cogs ?? 0) - (att?.fulfillment ?? 0),
      ),
      attributedMarginPct: (att?.revenue ?? 0) > 0
        ? Math.round(
            (((att!.net) - (att!.cogs) - (att!.fulfillment)) / att!.revenue) * 10000,
          ) / 100
        : 0,
      topCountry,
      ltvRevenue: round2(ltv?.revenue ?? 0),
      ltvOrders: ltv?.orders ?? 0,
      firstSeenAt: aff.firstSeenAt.toISOString(),
      lastOrderAt: aff.lastOrderAt?.toISOString() ?? null,
      sparkline: (a?.sparkline ?? new Array(SPARK_DAYS).fill(0)).map((v) => round2(v)),
    };
  }).sort((a, b) => b.revenue - a.revenue);

  return {
    summary: {
      activeNow: inPeriod.size,
      activePrev: prevSeen.size,
      concentration: round4(concentration),
      newAff,
      churnedAff,
      totalRevenue: round2(totalRevenue),
    },
    affiliates,
  };
}

// ============================================================
// getAffiliates — pushdown SQL (Fase B). Mesma resposta da legacy, mas as
// agregações rodam no Postgres e voltam O(afiliados) rows em vez de
// O(orders). Divergências documentadas vs legacy (ambas eram NÃO
// determinísticas na legacy por iteração sem orderBy):
//   1. FE da sessão em empate de orderedAt: SQL desempata por id ASC.
//   2. Sparkline: contribuições pré-período agora sempre contam quando o
//      afiliado tem atividade no período (na legacy dependia da ordem do
//      heap do Postgres).
//   3. topCountry em empate de contagem: SQL desempata por código ASC.
// ============================================================
export async function getAffiliatesSql(
  filters: MetricsFilters,
): Promise<AffiliatesResponse> {
  const span = filters.endDate.getTime() - filters.startDate.getTime();
  const prevEnd = new Date(filters.startDate.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - span);
  const SPARK_DAYS = 30;
  const sparkStart = new Date(filters.endDate.getTime() - SPARK_DAYS * 24 * 3600 * 1000);
  const coverageStart = new Date(Math.min(prevStart.getTime(), sparkStart.getTime()));

  // WHERE compartilhado das lentes diretas (espelha whereInCoverage da
  // legacy): janela de cobertura + todos os filtros do dashboard.
  const directConds: Prisma.Sql[] = [
    Prisma.sql`o."affiliateId" IS NOT NULL`,
    Prisma.sql`o."orderedAt" >= ${coverageStart}`,
    Prisma.sql`o."orderedAt" <= ${filters.endDate}`,
  ];
  if (filters.platformSlugs?.length) {
    directConds.push(Prisma.sql`pl."slug" = ANY(${filters.platformSlugs})`);
  }
  if (filters.countries?.length) {
    directConds.push(Prisma.sql`o."country" = ANY(${filters.countries})`);
  }
  if (filters.productExternalIds?.length) {
    directConds.push(Prisma.sql`pr."externalId" = ANY(${filters.productExternalIds})`);
  }
  if (filters.productFamilies?.length) {
    directConds.push(Prisma.sql`pr."family" = ANY(${filters.productFamilies})`);
  }
  if (filters.productTypes?.length) {
    directConds.push(Prisma.sql`o."productType" = ANY(${filters.productTypes}::"ProductType"[])`);
  }
  const directWhere = Prisma.join(directConds, ' AND ');
  const inPeriod = Prisma.sql`(o."orderedAt" >= ${filters.startDate} AND o."orderedAt" <= ${filters.endDate})`;

  // WHERE da session attribution (espelha periodWhere da legacy): período +
  // platforms/countries APENAS. Famílias/SKUs/etapas ficam de fora de
  // propósito — a sessão inteira (incl. cross-sells) vai pro afiliado da FE.
  const sessConds: Prisma.Sql[] = [
    Prisma.sql`o."orderedAt" >= ${filters.startDate}`,
    Prisma.sql`o."orderedAt" <= ${filters.endDate}`,
  ];
  if (filters.platformSlugs?.length) {
    sessConds.push(Prisma.sql`pl."slug" = ANY(${filters.platformSlugs})`);
  }
  if (filters.countries?.length) {
    sessConds.push(Prisma.sql`o."country" = ANY(${filters.countries})`);
  }
  const sessWhere = Prisma.join(sessConds, ' AND ');

  const [aggRows, sparkRows, countryRows, cpaModeRows, attRows, ltvByAff, affiliatesAll] =
    await Promise.all([
      // (A) Agregados diretos por afiliado, janelas período+prev via FILTER.
      db.$queryRaw<Array<{
        affiliate_id: string;
        all_orders: bigint;
        approved_orders: bigint;
        refunds: bigint;
        chargebacks: bigint;
        cpa: Prisma.Decimal;
        net: Prisma.Decimal;
        cogs: Prisma.Decimal;
        fulfillment: Prisma.Decimal;
        revenue: Prisma.Decimal;
        fe_approved_count: bigint;
        fe_cpa_paid_count: bigint;
        seen_prev: boolean;
      }>>(Prisma.sql`
        SELECT
          o."affiliateId" AS affiliate_id,
          COUNT(*) FILTER (WHERE ${inPeriod})::bigint AS all_orders,
          COUNT(*) FILTER (WHERE ${inPeriod} AND o."status" = 'APPROVED')::bigint AS approved_orders,
          COUNT(*) FILTER (WHERE ${inPeriod} AND o."status" = 'REFUNDED')::bigint AS refunds,
          COUNT(*) FILTER (WHERE ${inPeriod} AND o."status" = 'CHARGEBACK')::bigint AS chargebacks,
          COALESCE(SUM(o."cpaPaidUsd") FILTER (WHERE ${inPeriod}), 0) AS cpa,
          COALESCE(SUM(o."netAmountUsd") FILTER (WHERE ${inPeriod}), 0) AS net,
          COALESCE(SUM(o."cogsUsd") FILTER (WHERE ${inPeriod}), 0) AS cogs,
          COALESCE(SUM(o."fulfillmentUsd") FILTER (WHERE ${inPeriod}), 0) AS fulfillment,
          COALESCE(SUM(o."grossAmountUsd") FILTER (WHERE ${inPeriod} AND o."status" = 'APPROVED'), 0) AS revenue,
          COUNT(*) FILTER (WHERE ${inPeriod} AND o."status" = 'APPROVED' AND o."productType" = 'FRONTEND')::bigint AS fe_approved_count,
          COUNT(*) FILTER (WHERE ${inPeriod} AND o."status" = 'APPROVED' AND o."productType" = 'FRONTEND' AND o."cpaPaidUsd" > 0)::bigint AS fe_cpa_paid_count,
          BOOL_OR(o."orderedAt" >= ${prevStart} AND o."orderedAt" <= ${prevEnd}) AS seen_prev
        FROM "Order" o
        JOIN "Platform" pl ON o."platformId" = pl.id
        JOIN "Product" pr ON o."productId" = pr.id
        WHERE ${directWhere}
        GROUP BY o."affiliateId"
      `),
      // (B) Sparkline: gross APPROVED por bucket de dia da janela de 30d.
      db.$queryRaw<Array<{ affiliate_id: string; idx: number; gross: Prisma.Decimal }>>(Prisma.sql`
        SELECT
          o."affiliateId" AS affiliate_id,
          LEAST(${SPARK_DAYS - 1}, FLOOR(EXTRACT(EPOCH FROM (o."orderedAt" - ${sparkStart})) / 86400))::int AS idx,
          SUM(o."grossAmountUsd") AS gross
        FROM "Order" o
        JOIN "Platform" pl ON o."platformId" = pl.id
        JOIN "Product" pr ON o."productId" = pr.id
        WHERE ${directWhere}
          AND o."orderedAt" >= ${sparkStart}
          AND o."status" = 'APPROVED'
        GROUP BY 1, 2
      `),
      // (C) Contagem por país no período (todas as statuses) → topCountry.
      db.$queryRaw<Array<{ affiliate_id: string; country: string; cnt: bigint }>>(Prisma.sql`
        SELECT o."affiliateId" AS affiliate_id, o."country" AS country, COUNT(*)::bigint AS cnt
        FROM "Order" o
        JOIN "Platform" pl ON o."platformId" = pl.id
        JOIN "Product" pr ON o."productId" = pr.id
        WHERE ${directWhere} AND ${inPeriod} AND o."country" IS NOT NULL
        GROUP BY 1, 2
        ORDER BY cnt DESC, country ASC
      `),
      // (D) Buckets de CPA (FE+APPROVED+cpa>0) → modeOf em JS, mesmo
      // tie-break da legacy (não usar mode() WITHIN GROUP do Postgres).
      db.$queryRaw<Array<{ affiliate_id: string; cpa_val: Prisma.Decimal; cnt: bigint }>>(Prisma.sql`
        SELECT o."affiliateId" AS affiliate_id, ROUND(o."cpaPaidUsd", 2) AS cpa_val, COUNT(*)::bigint AS cnt
        FROM "Order" o
        JOIN "Platform" pl ON o."platformId" = pl.id
        JOIN "Product" pr ON o."productId" = pr.id
        WHERE ${directWhere} AND ${inPeriod}
          AND o."status" = 'APPROVED' AND o."productType" = 'FRONTEND' AND o."cpaPaidUsd" > 0
        GROUP BY 1, 2
      `),
      // (E) Session attribution: sessão inteira creditada ao afiliado da FE
      // mais cedo (DISTINCT ON com desempate por id — determinístico).
      db.$queryRaw<Array<{
        affiliate_id: string;
        sessions: bigint;
        orders: bigint;
        revenue: Prisma.Decimal;
        net: Prisma.Decimal;
        cpa: Prisma.Decimal;
        cogs: Prisma.Decimal;
        fulfillment: Prisma.Decimal;
      }>>(Prisma.sql`
        WITH base AS (
          SELECT o.id, o."affiliateId", o."productType", o."status", o."orderedAt",
                 o."grossAmountUsd", o."netAmountUsd", o."cpaPaidUsd", o."cogsUsd", o."fulfillmentUsd",
                 pl."slug" || ':' || COALESCE(o."parentExternalId", o."externalId") AS skey
          FROM "Order" o
          JOIN "Platform" pl ON o."platformId" = pl.id
          WHERE ${sessWhere}
        ),
        fe AS (
          SELECT DISTINCT ON (skey) skey, "affiliateId"
          FROM base
          WHERE "productType" = 'FRONTEND' AND "affiliateId" IS NOT NULL
          ORDER BY skey, "orderedAt" ASC, id ASC
        )
        SELECT
          fe."affiliateId" AS affiliate_id,
          COUNT(DISTINCT b.skey)::bigint AS sessions,
          COUNT(*)::bigint AS orders,
          COALESCE(SUM(b."grossAmountUsd") FILTER (WHERE b."status" = 'APPROVED'), 0) AS revenue,
          COALESCE(SUM(b."netAmountUsd") FILTER (WHERE b."status" = 'APPROVED'), 0) AS net,
          COALESCE(SUM(b."cpaPaidUsd"), 0) AS cpa,
          COALESCE(SUM(b."cogsUsd"), 0) AS cogs,
          COALESCE(SUM(b."fulfillmentUsd"), 0) AS fulfillment
        FROM base b
        JOIN fe ON fe.skey = b.skey
        GROUP BY fe."affiliateId"
      `),
      db.order.groupBy({
        by: ['affiliateId'],
        where: { affiliateId: { not: null }, status: 'APPROVED' },
        _sum: { grossAmountUsd: true },
        _count: { _all: true },
      }),
      db.affiliate.findMany({
        select: {
          externalId: true,
          nickname: true,
          firstSeenAt: true,
          lastOrderAt: true,
          platform: { select: { slug: true } },
          id: true,
        },
      }),
    ]);

  const aggById = new Map(aggRows.map((r) => [r.affiliate_id, r]));
  const attById = new Map(attRows.map((r) => [r.affiliate_id, r]));

  const sparkById = new Map<string, number[]>();
  for (const r of sparkRows) {
    let arr = sparkById.get(r.affiliate_id);
    if (!arr) { arr = new Array(SPARK_DAYS).fill(0); sparkById.set(r.affiliate_id, arr); }
    arr[r.idx] += toNumber(r.gross);
  }

  // Rows já vêm ORDER BY cnt DESC, country ASC — primeiro row por afiliado
  // é o topCountry com desempate determinístico.
  const topCountryById = new Map<string, string>();
  for (const r of countryRows) {
    if (!topCountryById.has(r.affiliate_id)) topCountryById.set(r.affiliate_id, r.country);
  }

  const cpaCountsById = new Map<string, Map<number, number>>();
  for (const r of cpaModeRows) {
    let m = cpaCountsById.get(r.affiliate_id);
    if (!m) { m = new Map(); cpaCountsById.set(r.affiliate_id, m); }
    const key = Math.round(toNumber(r.cpa_val) * 100) / 100;
    m.set(key, (m.get(key) ?? 0) + Number(r.cnt));
  }

  // Mesmo tie-break da legacy: empate de contagem → valor MAIOR ganha.
  function modeOf(counts: Map<number, number>): number {
    let modeVal = 0, modeCount = 0;
    for (const [v, c] of counts) {
      if (c > modeCount || (c === modeCount && v > modeVal)) {
        modeCount = c;
        modeVal = v;
      }
    }
    return modeVal;
  }

  const ltvMap = new Map<string, { revenue: number; orders: number }>();
  for (const row of ltvByAff) {
    if (!row.affiliateId) continue;
    ltvMap.set(row.affiliateId, {
      revenue: toNumber(row._sum.grossAmountUsd),
      orders: row._count._all,
    });
  }

  // Summary — mesmas definições da legacy, derivadas das rows agregadas.
  let activeNow = 0, activePrev = 0, newAff = 0, churnedAff = 0, totalRevenue = 0;
  const revenues: number[] = [];
  for (const r of aggRows) {
    const hasPeriod = Number(r.all_orders) > 0;
    const rev = toNumber(r.revenue);
    if (hasPeriod) {
      activeNow++;
      totalRevenue += rev;
      revenues.push(rev);
    }
    if (r.seen_prev) {
      activePrev++;
      if (!hasPeriod) churnedAff++;
    } else if (hasPeriod) {
      newAff++;
    }
  }
  revenues.sort((a, b) => b - a);
  const top5Revenue = revenues.slice(0, 5).reduce((s, v) => s + v, 0);
  const concentration = totalRevenue > 0 ? top5Revenue / totalRevenue : 0;

  const emptySpark = new Array(SPARK_DAYS).fill(0);
  const affiliates = affiliatesAll.map((aff) => {
    const a = aggById.get(aff.id);
    const hasPeriod = a ? Number(a.all_orders) > 0 : false;
    const att = attById.get(aff.id);
    const ltv = ltvMap.get(aff.id);

    const allOrders = a ? Number(a.all_orders) : 0;
    const orders = a ? Number(a.approved_orders) : 0;
    const refunds = a ? Number(a.refunds) : 0;
    const chargebacks = a ? Number(a.chargebacks) : 0;
    const denom = allOrders || 1;
    const cpa = a ? toNumber(a.cpa) : 0;
    const net = a ? toNumber(a.net) : 0;
    const cogs = a ? toNumber(a.cogs) : 0;
    const fulfillment = a ? toNumber(a.fulfillment) : 0;
    const feApprovedCount = a ? Number(a.fe_approved_count) : 0;
    const attNet = att ? toNumber(att.net) : 0;
    const attCogs = att ? toNumber(att.cogs) : 0;
    const attFulfillment = att ? toNumber(att.fulfillment) : 0;
    const attRevenue = att ? toNumber(att.revenue) : 0;
    const cpaCounts = hasPeriod ? cpaCountsById.get(aff.id) : undefined;

    return {
      externalId: aff.externalId,
      platformSlug: aff.platform.slug,
      nickname: aff.nickname,
      revenue: round2(a ? toNumber(a.revenue) : 0),
      orders,
      allOrders,
      refunds,
      chargebacks,
      approvalRate: allOrders ? round4(orders / denom) : 0,
      refundRate: allOrders ? round4(refunds / denom) : 0,
      cbRate: allOrders ? round4(chargebacks / denom) : 0,
      cpa: round2(cpa),
      feApprovedCount,
      feCpaPaidCount: a ? Number(a.fe_cpa_paid_count) : 0,
      cpaPerFe: cpaCounts ? round2(modeOf(cpaCounts)) : 0,
      cpaPerFeApproved: feApprovedCount > 0 ? round2(cpa / feApprovedCount) : 0,
      netMargin: round2(net - cpa),
      cogs: round2(cogs),
      fulfillment: round2(fulfillment),
      estimatedProfit: round2(net - cogs - fulfillment),
      attributedSessions: att ? Number(att.sessions) : 0,
      attributedOrders: att ? Number(att.orders) : 0,
      attributedRevenue: round2(attRevenue),
      attributedNet: round2(attNet),
      attributedCpa: round2(att ? toNumber(att.cpa) : 0),
      attributedCogs: round2(attCogs),
      attributedFulfillment: round2(attFulfillment),
      attributedProfit: round2(attNet - attCogs - attFulfillment),
      attributedMarginPct: attRevenue > 0
        ? Math.round(((attNet - attCogs - attFulfillment) / attRevenue) * 10000) / 100
        : 0,
      topCountry: hasPeriod ? (topCountryById.get(aff.id) ?? null) : null,
      ltvRevenue: round2(ltv?.revenue ?? 0),
      ltvOrders: ltv?.orders ?? 0,
      firstSeenAt: aff.firstSeenAt.toISOString(),
      lastOrderAt: aff.lastOrderAt?.toISOString() ?? null,
      sparkline: (hasPeriod ? (sparkById.get(aff.id) ?? emptySpark) : emptySpark).map((v) => round2(v)),
    };
  }).sort((a, b) => b.revenue - a.revenue);

  return {
    summary: {
      activeNow,
      activePrev,
      concentration: round4(concentration),
      newAff,
      churnedAff,
      totalRevenue: round2(totalRevenue),
    },
    affiliates,
  };
}

export async function getOrderDetail(
  externalId: string,
  platformSlug?: string,
): Promise<OrderDetailResponse | null> {
  const candidates = await db.order.findMany({
    where: {
      externalId,
      ...(platformSlug ? { platform: { slug: platformSlug } } : {}),
    },
    include: {
      platform: { select: { slug: true, displayName: true } },
      product: {
        select: {
          externalId: true, name: true, productType: true,
          family: true, variant: true, bottles: true,
          catalogPriceUsd: true, salesPageUrl: true, checkoutUrl: true,
        },
      },
      affiliate: { select: { externalId: true, nickname: true } },
      customer: {
        select: {
          externalId: true, email: true, firstName: true, lastName: true,
          country: true, language: true,
        },
      },
    },
  });
  if (candidates.length === 0) return null;
  // If externalId collides across platforms (rare — both CB and D24 IDs
  // happen to match), pick the most recent.
  const o = candidates.sort((a, b) => b.orderedAt.getTime() - a.orderedAt.getTime())[0];

  // Session: all orders sharing the same parent_external_id, scoped to
  // platform (parent ids aren't globally unique). For a FE order whose
  // parent_external_id equals its own external_id (Digistore) this still
  // works. For ClickBank legacy where FE parent_external_id is null, fall
  // back to grouping by external_id of FE.
  const sessionKey = o.parentExternalId ?? o.externalId;
  const sessionOrders = await db.order.findMany({
    where: {
      platformId: o.platformId,
      OR: [
        { parentExternalId: sessionKey },
        { externalId: sessionKey },
      ],
    },
    include: {
      product: { select: { name: true, family: true } },
    },
    orderBy: { orderedAt: 'asc' },
  });

  const feFamily =
    sessionOrders.find((s) => s.productType === 'FRONTEND')?.product.family ?? null;

  // Financial breakdown:
  //   gross  = total customer paid
  //   tax    = pass-through to government
  //   net    = vendor (we) received
  //   cpa    = paid to affiliate
  //   fees   = stored field (platform processor fees, may be partial)
  //
  // platformRetention = what platform itself kept (residual). Computed as
  // gross - net - cpa - tax. This is the *true* platform take — `fees`
  // alone often understates it for CB/D24. Negative values are unusual and
  // surfaced as warnings.
  const grossUsd = toNumber(o.grossAmountUsd);
  const netUsd = toNumber(o.netAmountUsd);
  const taxUsd = toNumber(o.taxAmount);
  const cpaUsd = toNumber(o.cpaPaidUsd);
  const feesUsd = toNumber(o.fees);
  const platformRetention = round2(grossUsd - netUsd - cpaUsd - taxUsd);
  const companyKept = round2(netUsd);

  // Profit calc: refunded/chargeback orders eat the COGS+fulfillment we paid.
  const cogsUsd = o.cogsUsd != null ? Number(o.cogsUsd) : null;
  const fulfillmentUsd = o.fulfillmentUsd != null ? Number(o.fulfillmentUsd) : null;
  let estimatedProfit: number | null = null;
  let estimatedMarginPct: number | null = null;
  if (cogsUsd != null && fulfillmentUsd != null) {
    const revenueAfterRefund = o.status === 'APPROVED' ? companyKept : 0;
    estimatedProfit = round2(revenueAfterRefund - cogsUsd - fulfillmentUsd);
    estimatedMarginPct = grossUsd > 0
      ? Math.round((estimatedProfit / grossUsd) * 10000) / 100
      : null;
  }

  return {
    order: {
      externalId: o.externalId,
      parentExternalId: o.parentExternalId,
      platformSlug: o.platform.slug,
      platformDisplayName: o.platform.displayName,
      vendorAccount: o.vendorAccount,
      productType: o.productType,
      funnelStep: o.funnelStep,
      status: o.status,
      eventType: o.eventType,
      billingType: o.billingType,
      paySequenceNo: o.paySequenceNo,
      numberOfInstallments: o.numberOfInstallments,
      paymentMethod: o.paymentMethod,
      country: o.country,
      state: o.state,
      city: o.city,
      currencyOriginal: o.currencyOriginal,
      grossAmountOrig: round2(toNumber(o.grossAmountOrig)),
      grossAmountUsd: round2(grossUsd),
      taxAmount: round2(taxUsd),
      fees: round2(feesUsd),
      netAmountUsd: round2(netUsd),
      cpaPaidUsd: round2(cpaUsd),
      platformRetention,
      companyKept,
      cogsUsd,
      fulfillmentUsd,
      estimatedProfit,
      estimatedMarginPct,
      clickId: o.clickId,
      trackingId: o.trackingId,
      campaignKey: o.campaignKey,
      trafficSource: o.trafficSource,
      deviceType: o.deviceType,
      browser: o.browser,
      detailsUrl: o.detailsUrl,
      orderedAt: o.orderedAt.toISOString(),
      approvedAt: o.approvedAt?.toISOString() ?? null,
      refundedAt: o.refundedAt?.toISOString() ?? null,
      chargebackAt: o.chargebackAt?.toISOString() ?? null,
    },
    product: {
      externalId: o.product.externalId,
      name: o.product.name,
      productType: o.product.productType,
      family: o.product.family,
      variant: o.product.variant,
      bottles: o.product.bottles,
      catalogPriceUsd: o.product.catalogPriceUsd ? Number(o.product.catalogPriceUsd) : null,
      salesPageUrl: o.product.salesPageUrl,
      checkoutUrl: o.product.checkoutUrl,
    },
    affiliate: o.affiliate
      ? { externalId: o.affiliate.externalId, nickname: o.affiliate.nickname }
      : null,
    customer: o.customer
      ? {
          externalId: o.customer.externalId,
          email: o.customer.email,
          firstName: o.customer.firstName,
          lastName: o.customer.lastName,
          country: o.customer.country,
          language: o.customer.language,
        }
      : null,
    session: sessionOrders.map((s) => ({
      externalId: s.externalId,
      productType: s.productType,
      productName: s.product.name,
      productFamily: s.product.family,
      funnelStep: s.funnelStep,
      grossAmountUsd: round2(toNumber(s.grossAmountUsd)),
      status: s.status,
      orderedAt: s.orderedAt.toISOString(),
      isSelf: s.externalId === o.externalId,
      isCrossSell: feFamily != null && s.product.family != null && s.product.family !== feFamily,
    })),
    isCrossSell:
      feFamily != null && o.product.family != null && o.product.family !== feFamily,
  };
}

export async function getOrders(
  filters: MetricsFilters,
  options: OrdersOptions = {},
): Promise<OrdersResponse> {
  const where: Prisma.OrderWhereInput = {
    orderedAt: { gte: filters.startDate, lte: filters.endDate },
  };
  if (filters.platformSlugs?.length) {
    where.platform = { slug: { in: filters.platformSlugs } };
  }
  if (filters.countries?.length) {
    where.country = { in: filters.countries };
  }
  if (filters.productExternalIds?.length || filters.productFamilies?.length) {
    where.product = {
      ...(filters.productExternalIds?.length ? { externalId: { in: filters.productExternalIds } } : {}),
      ...(filters.productFamilies?.length ? { family: { in: filters.productFamilies } } : {}),
    };
  }
  if (filters.productTypes?.length) {
    where.productType = { in: filters.productTypes };
  }
  if (options.search) {
    const q = options.search.trim();
    if (q) {
      where.OR = [
        { externalId: { contains: q, mode: 'insensitive' } },
        { parentExternalId: { contains: q, mode: 'insensitive' } },
        { affiliate: { externalId: { contains: q, mode: 'insensitive' } } },
        { affiliate: { nickname: { contains: q, mode: 'insensitive' } } },
      ];
    }
  }

  const filteredWhere: Prisma.OrderWhereInput = { ...where };
  if (options.status && options.status !== 'all') {
    filteredWhere.status = options.status.toUpperCase() as Prisma.OrderWhereInput['status'];
  }
  if (options.productType && options.productType !== 'all') {
    filteredWhere.productType =
      options.productType.toUpperCase() as Prisma.OrderWhereInput['productType'];
  }

  const limit = Math.min(Math.max(options.limit ?? 500, 1), 1000);
  const offset = Math.max(options.offset ?? 0, 0);

  // Um groupBy só por (status, productType) alimenta os dois breakdowns —
  // somar as partições por eixo dá exatamente os mesmos totais das duas
  // queries antigas. count + findMany rodam em paralelo junto.
  const [countsRaw, total, rows] = await Promise.all([
    db.order.groupBy({
      by: ['status', 'productType'],
      where,
      _count: { _all: true },
    }),
    db.order.count({ where: filteredWhere }),
    db.order.findMany({
      where: filteredWhere,
      include: {
        platform: { select: { slug: true, displayName: true } },
        product: { select: { externalId: true, name: true, productType: true } },
        affiliate: { select: { externalId: true, nickname: true } },
      },
      orderBy: { orderedAt: 'desc' },
      take: limit,
      skip: offset,
    }),
  ]);

  const statusCounts: Record<string, number> = {
    all: 0,
    approved: 0,
    pending: 0,
    refunded: 0,
    chargeback: 0,
    canceled: 0,
  };
  const typeCounts: Record<string, number> = {
    all: 0, FRONTEND: 0, UPSELL: 0, DOWNSELL: 0, BUMP: 0, SMS_RECOVERY: 0,
  };
  for (const row of countsRaw) {
    const n = row._count._all;
    statusCounts[row.status.toLowerCase()] = (statusCounts[row.status.toLowerCase()] ?? 0) + n;
    statusCounts.all += n;
    typeCounts[row.productType] = (typeCounts[row.productType] ?? 0) + n;
    typeCounts.all += n;
  }

  return {
    orders: rows.map((o) => ({
      externalId: o.externalId,
      parentExternalId: o.parentExternalId,
      platformSlug: o.platform.slug,
      productExternalId: o.product.externalId,
      productName: o.product.name,
      productType: o.productType,
      affiliateExternalId: o.affiliate?.externalId ?? null,
      affiliateNickname: o.affiliate?.nickname ?? null,
      country: o.country,
      paymentMethod: o.paymentMethod,
      grossAmountUsd: toNumber(o.grossAmountUsd),
      fees: toNumber(o.fees),
      netAmountUsd: toNumber(o.netAmountUsd),
      cpaPaidUsd: toNumber(o.cpaPaidUsd),
      status: o.status,
      orderedAt: o.orderedAt.toISOString(),
    })),
    statusCounts,
    typeCounts,
    total,
    limit,
    offset,
  };
}

async function fetchOrders(filters: MetricsFilters): Promise<OrderWithJoins[]> {
  const where: Prisma.OrderWhereInput = {
    orderedAt: { gte: filters.startDate, lte: filters.endDate },
  };

  if (filters.platformSlugs?.length) {
    where.platform = { slug: { in: filters.platformSlugs } };
  }
  if (filters.countries?.length) {
    where.country = { in: filters.countries };
  }
  if (filters.productExternalIds?.length || filters.productFamilies?.length) {
    where.product = {
      ...(filters.productExternalIds?.length ? { externalId: { in: filters.productExternalIds } } : {}),
      ...(filters.productFamilies?.length ? { family: { in: filters.productFamilies } } : {}),
    };
  }
  if (filters.productTypes?.length) {
    where.productType = { in: filters.productTypes };
  }

  return db.order.findMany({
    where,
    select: ORDER_COMPUTE_SELECT,
    orderBy: { orderedAt: 'asc' },
  });
}

function computeKPIs(orders: OrderWithJoins[]): OverviewKPIs {
  let gross = 0, grossOriginal = 0, net = 0, cpa = 0, cogs = 0, fulfillment = 0;
  let approvedCount = 0;
  let refundedCount = 0;
  let chargebackCount = 0;
  const groups = new Set<string>();

  for (const o of orders) {
    // grossOriginal: valor da venda no momento da criação. Fallback ABS pra
    // orders antigos pré-backfill onde originalGrossUsd ainda é null.
    grossOriginal += toNumber(o.originalGrossUsd ?? Math.abs(toNumber(o.grossAmountUsd)));
    if (o.status === 'APPROVED') {
      gross += toNumber(o.grossAmountUsd);
      net += toNumber(o.netAmountUsd);
      approvedCount++;
    } else if (o.status === 'REFUNDED') refundedCount++;
    else if (o.status === 'CHARGEBACK') chargebackCount++;

    // CPA + COGS + fulfillment counted across ALL statuses — we paid these
    // upfront regardless of whether the customer later refunded.
    cpa += toNumber(o.cpaPaidUsd);
    cogs += toNumber(o.cogsUsd ?? 0);
    fulfillment += toNumber(o.fulfillmentUsd ?? 0);
    groups.add(o.parentExternalId ?? o.externalId);
  }

  const totalCount = orders.length;
  const denominator = totalCount || 1;
  // Profit = net − COGS − fulfillment. CPA already excluded from net.
  const estimatedProfit = round2(net - cogs - fulfillment);
  const estimatedMarginPct = gross > 0
    ? Math.round((estimatedProfit / gross) * 10000) / 100
    : 0;

  return {
    gross: round2(gross),
    grossOriginal: round2(grossOriginal),
    net: round2(net),
    cpa: round2(cpa),
    netProfit: round2(net - cpa),
    approvalRate: round4(approvedCount / denominator),
    refundRate: round4(refundedCount / denominator),
    cbRate: round4(chargebackCount / denominator),
    aov: round2(groups.size ? gross / groups.size : 0),
    approvedCount,
    totalCount,
    orderGroups: groups.size,
    // EPO = Net Sales / Conversions. Mesma definição do kpisFromRows.
    epo: round2(groups.size ? net / groups.size : 0),
    cogs: round2(cogs),
    fulfillment: round2(fulfillment),
    estimatedProfit,
    estimatedMarginPct,
  };
}

function computeDaily(
  orders: OrderWithJoins[],
  startDate: Date,
  endDate: Date,
): DailyBucket[] {
  const buckets = new Map<string, DailyBucket>();
  // Iteração por dia BRT (espelha dailyFromRows). orders.orderedAt é UTC;
  // shift -3h pra cair no dia BRT correto antes de gerar a key.
  const TZ_SHIFT_MS = 3 * 60 * 60 * 1000;
  const startBrt = new Date(startDate.getTime() - TZ_SHIFT_MS);
  const endBrt = new Date(endDate.getTime() - TZ_SHIFT_MS);
  for (let d = startOfDay(startBrt); d <= endBrt; d = addDays(d, 1)) {
    const key = isoDate(d);
    buckets.set(key, {
      date: key,
      gross: 0, grossOriginal: 0, net: 0, cpa: 0, cogs: 0, fulfillment: 0, profit: 0,
      orders: 0, approvedOrders: 0, allOrders: 0,
    });
  }

  for (const o of orders) {
    const key = isoDate(new Date(o.orderedAt.getTime() - TZ_SHIFT_MS));
    const b = buckets.get(key);
    if (!b) continue;
    b.allOrders++;
    b.grossOriginal += toNumber(o.originalGrossUsd ?? Math.abs(toNumber(o.grossAmountUsd)));
    if (o.status === 'APPROVED') {
      b.gross += toNumber(o.grossAmountUsd);
      b.net += toNumber(o.netAmountUsd);
      b.approvedOrders++;
      b.orders++;
    }
    // CPA + COGS + fulfillment counted across all statuses (we paid them).
    b.cpa += toNumber(o.cpaPaidUsd);
    b.cogs += toNumber(o.cogsUsd ?? 0);
    b.fulfillment += toNumber(o.fulfillmentUsd ?? 0);
  }

  for (const b of buckets.values()) {
    b.gross = round2(b.gross);
    b.grossOriginal = round2(b.grossOriginal);
    b.net = round2(b.net);
    b.cpa = round2(b.cpa);
    b.cogs = round2(b.cogs);
    b.fulfillment = round2(b.fulfillment);
    b.profit = round2(b.net - b.cogs - b.fulfillment);
  }

  return Array.from(buckets.values());
}

function computeByCountry(
  orders: OrderWithJoins[],
): Array<{ code: string; value: number; orders: number }> {
  const map = new Map<string, { code: string; value: number; orders: number }>();
  for (const o of orders) {
    if (o.status !== 'APPROVED' || !o.country) continue;
    const entry = map.get(o.country) ?? { code: o.country, value: 0, orders: 0 };
    entry.value += toNumber(o.grossAmountUsd);
    entry.orders += 1;
    map.set(o.country, entry);
  }
  return Array.from(map.values())
    .map((e) => ({ ...e, value: round2(e.value) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
}

function computeByProductType(
  orders: OrderWithJoins[],
): Array<{ label: string; value: number }> {
  const totals: Record<string, number> = {
    FRONTEND: 0,
    UPSELL: 0,
    DOWNSELL: 0,
    BUMP: 0,
  };
  for (const o of orders) {
    if (o.status !== 'APPROVED') continue;
    const t = o.productType;
    totals[t] = (totals[t] ?? 0) + toNumber(o.grossAmountUsd);
  }
  return Object.entries(totals)
    .filter(([, v]) => v > 0)
    .map(([label, value]) => ({ label, value: round2(value) }));
}

function computeTopAffiliates(orders: OrderWithJoins[], limit: number) {
  const map = new Map<
    string,
    {
      externalId: string;
      nickname: string | null;
      platformSlug: string;
      revenue: number;
      net: number;
      cpa: number;
      orders: number;
      approvedOrders: number;
    }
  >();

  for (const o of orders) {
    if (!o.affiliate) continue;
    const key = `${o.platform.slug}:${o.affiliate.externalId}`;
    const entry =
      map.get(key) ??
      {
        externalId: o.affiliate.externalId,
        nickname: o.affiliate.nickname,
        platformSlug: o.platform.slug,
        revenue: 0,
        net: 0,
        cpa: 0,
        orders: 0,
        approvedOrders: 0,
      };
    entry.orders++;
    if (o.status === 'APPROVED') {
      entry.approvedOrders++;
      entry.revenue += toNumber(o.grossAmountUsd);
      entry.net += toNumber(o.netAmountUsd);
      entry.cpa += toNumber(o.cpaPaidUsd);
    }
    map.set(key, entry);
  }

  return Array.from(map.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit)
    .map((e) => ({
      externalId: e.externalId,
      nickname: e.nickname,
      platformSlug: e.platformSlug,
      revenue: round2(e.revenue),
      orders: e.orders,
      approvalRate: round4(e.orders ? e.approvedOrders / e.orders : 0),
      netMargin: round2(e.net - e.cpa),
    }));
}

async function computePlatformHealth(
  orders: OrderWithJoins[],
): Promise<OverviewResponse['platformHealth']> {
  const platforms = await db.platform.findMany({
    select: { slug: true, displayName: true, lastSyncAt: true },
  });
  const bySlug = new Map<string, { totalOrders: number; totalRevenue: number }>();
  for (const o of orders) {
    if (o.status !== 'APPROVED') continue;
    const slug = o.platform.slug;
    const entry = bySlug.get(slug) ?? { totalOrders: 0, totalRevenue: 0 };
    entry.totalOrders++;
    entry.totalRevenue += toNumber(o.grossAmountUsd);
    bySlug.set(slug, entry);
  }
  return platforms.map((p) => {
    const agg = bySlug.get(p.slug) ?? { totalOrders: 0, totalRevenue: 0 };
    return {
      slug: p.slug,
      displayName: p.displayName,
      lastSyncAt: p.lastSyncAt?.toISOString() ?? null,
      totalOrders: agg.totalOrders,
      totalRevenue: round2(agg.totalRevenue),
    };
  });
}

function toNumber(v: Prisma.Decimal | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  return v.toNumber();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
