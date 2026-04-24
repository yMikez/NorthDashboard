import { Prisma } from '@prisma/client';
import { db } from '../db';

export interface MetricsFilters {
  startDate: Date;
  endDate: Date;
  platformSlugs?: string[];
  countries?: string[];
  productExternalIds?: string[];
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

export interface FunnelResponse {
  stages: Array<{
    id: string;
    label: string;
    volume: number;
    revenue: number;
    takeRate: number;
  }>;
  summary: {
    feGroups: number;
    totalGroups: number;
    totalRevenue: number;
    aov: number;
    aovFEOnly: number;
    aovWithUpsell: number;
    revenueLiftFromUpsells: number;
  };
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
  const orders = await fetchOrders(filters);

  const kpis = computeKPIs(orders);
  const daily = computeDaily(orders, filters.startDate, filters.endDate);
  const byCountry = computeByCountry(orders);
  const byProductType = computeByProductType(orders);
  const topAffiliates = computeTopAffiliates(orders, 5);
  const platformHealth = await computePlatformHealth(orders);

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
  };

  if (compare) {
    const span = filters.endDate.getTime() - filters.startDate.getTime();
    const prevEnd = new Date(filters.startDate.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - span);
    const prevOrders = await fetchOrders({
      ...filters,
      startDate: prevStart,
      endDate: prevEnd,
    });
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
  }

  const groups = new Map<string, Group>();

  for (const o of orders) {
    const groupKey = `${o.platform.slug}:${o.parentExternalId ?? o.externalId}`;
    let g = groups.get(groupKey);
    if (!g) {
      g = {
        hasFE: false,
        hasBump: false,
        hasU1: false,
        hasU2: false,
        hasDown: false,
        feRevenue: 0,
        bumpRevenue: 0,
        u1Revenue: 0,
        u2Revenue: 0,
        downRevenue: 0,
      };
      groups.set(groupKey, g);
    }
    const gross = toNumber(o.grossAmountUsd);
    const t = o.productType;
    const step = o.funnelStep ?? 0;
    if (t === 'FRONTEND') {
      g.hasFE = true;
      g.feRevenue += gross;
    } else if (t === 'BUMP') {
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

  for (const g of groups.values()) {
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
      totalGroups: groups.size,
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
        select: { externalId: true, name: true, productType: true, id: true },
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
  const platforms = await db.platform.findMany({
    select: { id: true, slug: true, displayName: true, isActive: true, lastSyncAt: true },
  });

  const where: Prisma.OrderWhereInput = {
    orderedAt: { gte: filters.startDate, lte: filters.endDate },
  };
  if (filters.countries?.length) {
    where.country = { in: filters.countries };
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
  if (filters.productExternalIds?.length) {
    whereInCoverage.product = { externalId: { in: filters.productExternalIds } };
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
  if (filters.productExternalIds?.length) {
    where.product = { externalId: { in: filters.productExternalIds } };
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
  if (filters.productExternalIds?.length) {
    where.product = { externalId: { in: filters.productExternalIds } };
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

  return {
    gross: round2(gross),
    net: round2(net),
    cpa: round2(cpa),
    netProfit: round2(net - cpa),
    approvalRate: round4(approvedCount / denominator),
    refundRate: round4(refundedCount / denominator),
    cbRate: round4(chargebackCount / denominator),
    aov: round2(approvedCount ? gross / approvedCount : 0),
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
