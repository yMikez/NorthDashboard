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
      productType: o.product.productType,
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
    const t = o.product.productType;
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
