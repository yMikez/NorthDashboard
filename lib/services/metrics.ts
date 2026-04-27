import { Prisma } from '@prisma/client';
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
}

export interface OverviewKPIs {
  gross: number;
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
}

export interface DailyBucket {
  date: string; // YYYY-MM-DD
  gross: number;
  net: number;
  cpa: number;
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
    aov: number;
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
    netMargin: number;
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
  total: number;
  limit: number;
  offset: number;
}

export interface OrdersOptions {
  status?: string;
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

type OrderWithJoins = Prisma.OrderGetPayload<{
  include: {
    platform: { select: { slug: true; displayName: true } };
    product: { select: { externalId: true; name: true; productType: true } };
    affiliate: { select: { externalId: true; nickname: true } };
  };
}>;

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

  await refreshDailyMetricsIfStale();
  const rows = await queryDailyMetrics(filters);

  const kpis = await kpisFromRows(rows, filters);
  const daily = dailyFromRows(rows, filters.startDate, filters.endDate);
  const byCountry = byCountryFromRows(rows);
  const byProductType = byProductTypeFromRows(rows);
  const platformHealth = await platformHealthFromRows(rows);
  const topAffiliates = await topAffiliatesQuery(filters, 5);
  const hourlyHeatmap = await hourlyHeatmapQuery(filters);

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
    const prevRows = await queryDailyMetrics(prevFilters);
    response.previous = await kpisFromRows(prevRows, prevFilters);
  }

  return response;
}

// ---------- MV-backed helpers for getOverview ----------
// Each takes pre-fetched DailyMetricsRow[] (already filtered by date range
// + dimensions) and reduces them to the response field. No DB I/O except
// where catalog joins are needed (platformHealth → Platform.lastSyncAt,
// topAffiliates → Affiliate table).

async function kpisFromRows(
  rows: DailyMetricsRow[],
  filters: MetricsFilters,
): Promise<OverviewKPIs> {
  let gross = 0, net = 0, cpa = 0;
  let approvedCount = 0, refundedCount = 0, chargebackCount = 0;
  for (const r of rows) {
    gross += r.gross;
    net += r.net;
    cpa += r.cpa;
    approvedCount += r.approved_count;
    refundedCount += r.refunded_count;
    chargebackCount += r.chargeback_count;
  }
  const totalCount = rows.reduce((s, r) => s + r.total_count, 0);
  const denom = totalCount || 1;
  // orderGroups (distinct buyer sessions) doesn't aggregate from MV cleanly
  // because the same parent_external_id can appear in multiple rows (FE +
  // upsell). Run a focused COUNT DISTINCT on the base table instead — fast
  // because we only project two columns.
  const orderGroups = await orderGroupsCount(filters);

  return {
    gross: round2(gross),
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
  };
}

async function orderGroupsCount(filters: MetricsFilters): Promise<number> {
  const where: Prisma.OrderWhereInput = {
    orderedAt: { gte: filters.startDate, lte: filters.endDate },
  };
  if (filters.platformSlugs?.length) where.platform = { slug: { in: filters.platformSlugs } };
  if (filters.countries?.length) where.country = { in: filters.countries };
  if (filters.productFamilies?.length) {
    where.product = { family: { in: filters.productFamilies } };
  }
  // Distinct count via raw query — Prisma doesn't expose distinct + COUNT
  // in a single round-trip otherwise.
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
  for (let d = startOfDay(startDate); d <= endDate; d = addDays(d, 1)) {
    const key = isoDate(d);
    buckets.set(key, {
      date: key, gross: 0, net: 0, cpa: 0, orders: 0, approvedOrders: 0, allOrders: 0,
    });
  }
  for (const r of rows) {
    const key = isoDate(r.day);
    const b = buckets.get(key);
    if (!b) continue;
    b.gross = round2(b.gross + r.gross);
    b.net = round2(b.net + r.net);
    b.cpa = round2(b.cpa + r.cpa);
    b.allOrders += r.total_count;
    b.approvedOrders += r.approved_count;
    b.orders = b.approvedOrders;
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
  return Array.from(map.values())
    .map((e) => ({ ...e, value: round2(e.value) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
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

async function platformHealthFromRows(
  rows: DailyMetricsRow[],
): Promise<OverviewResponse['platformHealth']> {
  const platforms = await db.platform.findMany({
    select: { slug: true, displayName: true, lastSyncAt: true },
  });
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
  const whereSql = Prisma.join(conds, ' AND ');
  const rows = await db.$queryRaw<Array<{
    dow: number;
    hour: number;
    orders: bigint;
    gross: Prisma.Decimal;
  }>>(Prisma.sql`
    SELECT
      EXTRACT(DOW FROM o."orderedAt")::int AS dow,
      EXTRACT(HOUR FROM o."orderedAt")::int AS hour,
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
  const orders = await fetchOrders(filters);
  const kpis = computeKPIs(orders);
  const daily = computeDaily(orders, filters.startDate, filters.endDate);
  const byCountry = computeByCountry(orders);
  const byProductType = computeByProductType(orders);
  const topAffiliates = computeTopAffiliates(orders, 5);
  const platformHealth = await computePlatformHealth(orders);
  const hourlyHeatmap = await hourlyHeatmapQuery(filters);
  const response: OverviewResponse = {
    range: { start: filters.startDate.toISOString(), end: filters.endDate.toISOString() },
    kpis, daily, byCountry, byProductType, topAffiliates, platformHealth, hourlyHeatmap,
  };
  if (compare) {
    const span = filters.endDate.getTime() - filters.startDate.getTime();
    const prevEnd = new Date(filters.startDate.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - span);
    const prevOrders = await fetchOrders({ ...filters, startDate: prevStart, endDate: prevEnd });
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
      grossAmountUsd: true,
      funnelStep: true,
      productType: true,
      platform: { select: { slug: true } },
      product: { select: { externalId: true, name: true, family: true } },
    },
  });

  // A "group" represents a single buyer's funnel session. Group key:
  //   parentExternalId when present (digistore order_id, clickbank upsellOriginalReceipt),
  //   otherwise the order's own externalId (a frontend with no upsells).
  // We scope keys per platform to avoid ID collisions between sources.
  interface Group {
    hasFE: boolean;
    hasBump: boolean;
    hasU1: boolean;
    hasU2: boolean;
    hasDown: boolean;
    feRevenue: number;
    bumpRevenue: number;
    u1Revenue: number;
    u2Revenue: number;
    downRevenue: number;
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
        hasFE: false, hasBump: false, hasU1: false, hasU2: false, hasDown: false,
        feRevenue: 0, bumpRevenue: 0, u1Revenue: 0, u2Revenue: 0, downRevenue: 0,
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
    const groupKey = `${o.platform.slug}:${o.parentExternalId ?? o.externalId}`;
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

  // Cross-sell flow tracking: groups whose backend order family ≠ FE family.
  // Sessions counts distinct groups (not orders) per (fromFamily → toFamily)
  // pair so a session with two cross-sells to the same family doesn't double-
  // count.
  const crossSellMap = new Map<
    string,
    { fromFamily: string; toFamily: string; sessions: Set<string>; revenue: number }
  >();

  // Pass 2: non-FE orders — same-family vs cross-sell.
  for (const o of orders) {
    if (o.productType === 'FRONTEND') continue;
    const groupKey = `${o.platform.slug}:${o.parentExternalId ?? o.externalId}`;
    const g = getOrInit(groupKey, o.platform.slug);
    const gross = toNumber(o.grossAmountUsd);
    const t = o.productType;
    const step = o.funnelStep ?? 0;
    const orderFamily = o.product.family;
    const cls = classifyOrderInGroup(t, g.feProductFamily, orderFamily);

    if (cls === 'CROSS_SELL') {
      // CROSS_SELL implies both families are non-null (per classifier).
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
      // Skip stage accounting — cross-sell doesn't count toward FE family's
      // take rate.
      continue;
    }

    if (t === 'BUMP') {
      g.hasBump = true;
      g.bumpRevenue += gross;
    } else if (t === 'UPSELL') {
      if (step >= 2) {
        g.hasU2 = true;
        g.u2Revenue += gross;
      } else {
        g.hasU1 = true;
        g.u1Revenue += gross;
      }
    } else if (t === 'DOWNSELL') {
      g.hasDown = true;
      g.downRevenue += gross;
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
    if (!g.hasFE) return false;
    if (productFilter && (!g.feProductExternalId || !productFilter.has(g.feProductExternalId))) return false;
    if (familyFilter && (!g.feProductFamily || !familyFilter.has(g.feProductFamily))) return false;
    return true;
  });
  const global = aggregateGroups(allGroups, allGroups.length);

  // Bucket groups by FE family. Groups without an FE order or whose FE
  // belongs to an unclassified SKU (family=null) are excluded — we can't
  // attribute their upsells to a known funnel.
  interface FamilyBucket {
    family: string;
    groups: Group[];
  }
  const buckets = new Map<string, FamilyBucket>();
  for (const g of allGroups) {
    if (!g.hasFE || !g.feProductFamily) continue;
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
  hasU1: boolean;
  hasU2: boolean;
  hasDown: boolean;
  feRevenue: number;
  bumpRevenue: number;
  u1Revenue: number;
  u2Revenue: number;
  downRevenue: number;
}

export function aggregateGroups(
  groupList: FunnelGroupAgg[],
  totalGroups: number,
): { stages: FunnelStage[]; summary: FunnelSummary } {
  let feGroups = 0;
  let bumpGroups = 0;
  let u1Groups = 0;
  let u2Groups = 0;
  let downGroups = 0;
  let feRevenue = 0;
  let bumpRevenue = 0;
  let u1Revenue = 0;
  let u2Revenue = 0;
  let downRevenue = 0;
  let revenueFEOnly = 0;
  let revenueWithUpsell = 0;
  let groupsFEOnly = 0;
  let groupsWithUpsell = 0;

  for (const g of groupList) {
    if (g.hasFE) feGroups++;
    if (g.hasBump) bumpGroups++;
    if (g.hasU1) u1Groups++;
    if (g.hasU2) u2Groups++;
    if (g.hasDown) downGroups++;
    feRevenue += g.feRevenue;
    bumpRevenue += g.bumpRevenue;
    u1Revenue += g.u1Revenue;
    u2Revenue += g.u2Revenue;
    downRevenue += g.downRevenue;

    if (g.hasFE) {
      const groupRev =
        g.feRevenue + g.bumpRevenue + g.u1Revenue + g.u2Revenue + g.downRevenue;
      const takesUpsell = g.hasU1 || g.hasU2 || g.hasBump || g.hasDown;
      if (takesUpsell) {
        groupsWithUpsell++;
        revenueWithUpsell += groupRev;
      } else {
        groupsFEOnly++;
        revenueFEOnly += groupRev;
      }
    }
  }

  const totalRevenue = feRevenue + bumpRevenue + u1Revenue + u2Revenue + downRevenue;
  const aov = feGroups ? totalRevenue / feGroups : 0;
  const aovFEOnly = groupsFEOnly ? revenueFEOnly / groupsFEOnly : 0;
  const aovWithUpsell = groupsWithUpsell ? revenueWithUpsell / groupsWithUpsell : 0;
  const revenueLiftFromUpsells =
    aovFEOnly > 0 ? (aovWithUpsell - aovFEOnly) / aovFEOnly : 0;

  return {
    stages: [
      {
        id: 'frontend',
        label: 'Frontend',
        volume: feGroups,
        revenue: round2(feRevenue),
        takeRate: 1.0,
      },
      {
        id: 'bump',
        label: 'Order Bump',
        volume: bumpGroups,
        revenue: round2(bumpRevenue),
        takeRate: feGroups ? round4(bumpGroups / feGroups) : 0,
      },
      {
        id: 'upsell1',
        label: 'Upsell 1',
        volume: u1Groups,
        revenue: round2(u1Revenue),
        takeRate: feGroups ? round4(u1Groups / feGroups) : 0,
      },
      {
        id: 'upsell2',
        label: 'Upsell 2+',
        volume: u2Groups,
        revenue: round2(u2Revenue),
        takeRate: feGroups ? round4(u2Groups / feGroups) : 0,
      },
      {
        id: 'downsell',
        label: 'Downsell',
        volume: downGroups,
        revenue: round2(downRevenue),
        takeRate: feGroups ? round4(downGroups / feGroups) : 0,
      },
    ],
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

  const orders = await db.order.findMany({
    where,
    select: {
      status: true,
      grossAmountUsd: true,
      netAmountUsd: true,
      cpaPaidUsd: true,
      vendorAccount: true,
      orderedAt: true,
      productType: true,
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
        firstSoldAt: null,
        lastSoldAt: null,
      };
      byProduct.set(key, p);
    }
    p.allOrders++;
    p.typeCounts[o.productType] = (p.typeCounts[o.productType] ?? 0) + 1;
    p.net += toNumber(o.netAmountUsd);
    p.cpa += toNumber(o.cpaPaidUsd);
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
    .map((p) => ({
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
      approvalRate: p.allOrders ? round4(p.orders / p.allOrders) : 0,
      firstSoldAt: p.firstSoldAt?.toISOString() ?? null,
      lastSoldAt: p.lastSoldAt?.toISOString() ?? null,
    }))
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

export async function getPlatforms(
  filters: MetricsFilters,
): Promise<PlatformsResponse> {
  // When the user filters by platform, drop the others from the page entirely
  // (cards for unfiltered platforms would just show zeros and add noise).
  const platforms = await db.platform.findMany({
    where: filters.platformSlugs?.length
      ? { slug: { in: filters.platformSlugs } }
      : undefined,
    select: { id: true, slug: true, displayName: true, isActive: true, lastSyncAt: true },
  });

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

  const orders = await db.order.findMany({
    where,
    select: {
      status: true,
      grossAmountUsd: true,
      affiliateId: true,
      platform: { select: { id: true, slug: true } },
      product: { select: { externalId: true, name: true } },
    },
  });

  const affiliatesTotalByPlatform = await db.affiliate.groupBy({
    by: ['platformId'],
    _count: { _all: true },
  });
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
    revenue: number;
    orders: number;
    allOrders: number;
    refunds: number;
    chargebacks: number;
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
      revenue: 0,
      orders: 0,
      allOrders: 0,
      refunds: 0,
      chargebacks: 0,
      activeAffIds: new Set(),
      byProduct: new Map(),
    });
  }

  for (const o of orders) {
    const p = byPlatform.get(o.platform.id);
    if (!p) continue;
    p.allOrders++;
    if (o.affiliateId) p.activeAffIds.add(o.affiliateId);
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
    } else if (o.status === 'CHARGEBACK') {
      p.chargebacks++;
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
        };
      })
      .sort((a, b) => b.totalRevenue - a.totalRevenue),
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

  const periodOrders = await db.order.findMany({
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
  });

  // LTV (all-time, all platforms — represents total business with this affiliate)
  const ltvAgg = await db.order.aggregate({
    where: { affiliateId: aff.id, status: 'APPROVED' },
    _sum: { grossAmountUsd: true },
    _count: { _all: true },
  });

  // KPIs
  let revenue = 0;
  let net = 0;
  let cpa = 0;
  let orders = 0;
  let refunds = 0;
  let chargebacks = 0;
  for (const o of periodOrders) {
    net += toNumber(o.netAmountUsd);
    cpa += toNumber(o.cpaPaidUsd);
    if (o.status === 'APPROVED') {
      orders++;
      revenue += toNumber(o.grossAmountUsd);
    } else if (o.status === 'REFUNDED') refunds++;
    else if (o.status === 'CHARGEBACK') chargebacks++;
  }
  const allOrders = periodOrders.length;
  const denom = allOrders || 1;
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
    aov: round2(orders ? revenue / orders : 0),
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

export async function getAffiliates(
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

  const orders = await db.order.findMany({
    where: whereInCoverage,
    select: {
      status: true,
      grossAmountUsd: true,
      netAmountUsd: true,
      cpaPaidUsd: true,
      country: true,
      orderedAt: true,
      affiliate: { select: { externalId: true, nickname: true, platformId: true } },
      platform: { select: { slug: true } },
    },
  });

  const ltvByAff = await db.order.groupBy({
    by: ['affiliateId'],
    where: { affiliateId: { not: null }, status: 'APPROVED' },
    _sum: { grossAmountUsd: true },
    _count: { _all: true },
  });
  const affiliatesAll = await db.affiliate.findMany({
    select: {
      externalId: true,
      nickname: true,
      firstSeenAt: true,
      lastOrderAt: true,
      platform: { select: { slug: true } },
      id: true,
    },
  });

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
    net: number;
    byCountry: Map<string, number>;
    sparkline: number[];
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
          net: 0,
          byCountry: new Map(),
          sparkline: new Array(SPARK_DAYS).fill(0),
        };
        inPeriod.set(key, a);
      }
      a.allOrders++;
      a.cpa += toNumber(o.cpaPaidUsd);
      a.net += toNumber(o.netAmountUsd);
      if (o.status === 'APPROVED') {
        a.revenue += toNumber(o.grossAmountUsd);
        a.orders++;
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
      netMargin: round2((a?.net ?? 0) - (a?.cpa ?? 0)),
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

  const countsRaw = await db.order.groupBy({
    by: ['status'],
    where,
    _count: { _all: true },
  });
  const statusCounts: Record<string, number> = {
    all: 0,
    approved: 0,
    pending: 0,
    refunded: 0,
    chargeback: 0,
    canceled: 0,
  };
  for (const row of countsRaw) {
    const key = row.status.toLowerCase();
    statusCounts[key] = row._count._all;
    statusCounts.all += row._count._all;
  }

  const filteredWhere: Prisma.OrderWhereInput = { ...where };
  if (options.status && options.status !== 'all') {
    filteredWhere.status = options.status.toUpperCase() as Prisma.OrderWhereInput['status'];
  }

  const total = await db.order.count({ where: filteredWhere });
  const limit = Math.min(Math.max(options.limit ?? 500, 1), 1000);
  const offset = Math.max(options.offset ?? 0, 0);

  const rows = await db.order.findMany({
    where: filteredWhere,
    include: {
      platform: { select: { slug: true, displayName: true } },
      product: { select: { externalId: true, name: true, productType: true } },
      affiliate: { select: { externalId: true, nickname: true } },
    },
    orderBy: { orderedAt: 'desc' },
    take: limit,
    skip: offset,
  });

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

  return db.order.findMany({
    where,
    include: {
      platform: { select: { slug: true, displayName: true } },
      product: { select: { externalId: true, name: true, productType: true } },
      affiliate: { select: { externalId: true, nickname: true } },
    },
    orderBy: { orderedAt: 'asc' },
  });
}

function computeKPIs(orders: OrderWithJoins[]): OverviewKPIs {
  let gross = 0;
  let net = 0;
  let cpa = 0;
  let approvedCount = 0;
  let refundedCount = 0;
  let chargebackCount = 0;
  const groups = new Set<string>();

  for (const o of orders) {
    gross += toNumber(o.grossAmountUsd);
    net += toNumber(o.netAmountUsd);
    cpa += toNumber(o.cpaPaidUsd);
    groups.add(o.parentExternalId ?? o.externalId);

    if (o.status === 'APPROVED') approvedCount++;
    else if (o.status === 'REFUNDED') refundedCount++;
    else if (o.status === 'CHARGEBACK') chargebackCount++;
  }

  const totalCount = orders.length;
  const denominator = totalCount || 1;

  // AOV é per-buyer (group), não per-order: total gross dividido pelo número
  // de funnel sessions únicas. Cada session inclui FE + bumps + upsells +
  // downsells do mesmo cliente. Métrica de negócio mais útil ("quanto cada
  // cliente novo gastou") do que o AOV per-order que diluía o ticket médio.
  return {
    gross: round2(gross),
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
  };
}

function computeDaily(
  orders: OrderWithJoins[],
  startDate: Date,
  endDate: Date,
): DailyBucket[] {
  const buckets = new Map<string, DailyBucket>();

  for (let d = startOfDay(startDate); d <= endDate; d = addDays(d, 1)) {
    const key = isoDate(d);
    buckets.set(key, {
      date: key,
      gross: 0,
      net: 0,
      cpa: 0,
      orders: 0,
      approvedOrders: 0,
      allOrders: 0,
    });
  }

  for (const o of orders) {
    const key = isoDate(o.orderedAt);
    const b = buckets.get(key);
    if (!b) continue;
    b.gross += toNumber(o.grossAmountUsd);
    b.net += toNumber(o.netAmountUsd);
    b.cpa += toNumber(o.cpaPaidUsd);
    b.allOrders++;
    if (o.status === 'APPROVED') {
      b.approvedOrders++;
      b.orders++;
    }
  }

  for (const b of buckets.values()) {
    b.gross = round2(b.gross);
    b.net = round2(b.net);
    b.cpa = round2(b.cpa);
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
