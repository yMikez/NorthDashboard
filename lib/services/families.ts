// Per-ProductFamily aggregates for the FamilyGrid page. Returns one entry
// per family known to the catalog (Product.family) with metrics computed
// from orders in the period. Families with zero orders still appear so the
// user sees the full catalog.

import type { Prisma } from '@prisma/client';
import { db } from '../db';
import type { MetricsFilters } from './metrics';

export interface FamilyAggregate {
  family: string;
  niches: string[];
  // Catalog counts (independent of period)
  feSkuCount: number;
  upSkuCount: number;
  dwSkuCount: number;
  rcSkuCount: number;
  // Period metrics (respect filters)
  feOrders: number;            // FE-only count = "topo do funil"
  totalOrders: number;         // FE + UP + DW + RC
  grossRevenue: number;
  netRevenue: number;
  cpaPaid: number;
  aov: number;                 // grossRevenue / feOrders (matches Funnel chart definition)
  uniqueCustomers: number;
  upsellLiftPct: number | null; // (aovWithUpsell - aovFEOnly) / aovFEOnly
  topVendorAccount: string | null;
}

export interface FamiliesResponse {
  families: FamilyAggregate[];
}

export async function getFamilies(
  filters: MetricsFilters,
): Promise<FamiliesResponse> {
  // 1. Catalog-level info: every family + SKU counts by type + niches.
  const catalog = await db.product.findMany({
    where: { family: { not: null } },
    select: {
      family: true,
      productType: true,
      niche: true,
      vendorAccount: true,
    },
  });
  interface CatalogAcc {
    niches: Set<string>;
    feSkuCount: number;
    upSkuCount: number;
    dwSkuCount: number;
    rcSkuCount: number;
    vendorAccounts: Map<string, number>;
  }
  const catalogByFamily = new Map<string, CatalogAcc>();
  for (const p of catalog) {
    if (!p.family) continue;
    let acc = catalogByFamily.get(p.family);
    if (!acc) {
      acc = {
        niches: new Set(),
        feSkuCount: 0, upSkuCount: 0, dwSkuCount: 0, rcSkuCount: 0,
        vendorAccounts: new Map(),
      };
      catalogByFamily.set(p.family, acc);
    }
    if (p.niche) acc.niches.add(p.niche);
    if (p.vendorAccount) {
      acc.vendorAccounts.set(p.vendorAccount, (acc.vendorAccounts.get(p.vendorAccount) || 0) + 1);
    }
    switch (p.productType) {
      case 'FRONTEND': acc.feSkuCount++; break;
      case 'UPSELL':   acc.upSkuCount++; break;
      case 'DOWNSELL': acc.dwSkuCount++; break;
      case 'SMS_RECOVERY': acc.rcSkuCount++; break;
    }
  }

  // 2. Period orders constrained by filters (re-uses MetricsFilters shape).
  const where: Prisma.OrderWhereInput = {
    orderedAt: { gte: filters.startDate, lte: filters.endDate },
    status: 'APPROVED',
    product: { family: { not: null } },
  };
  if (filters.platformSlugs?.length) where.platform = { slug: { in: filters.platformSlugs } };
  if (filters.countries?.length) where.country = { in: filters.countries };
  if (filters.productFamilies?.length) {
    where.product = {
      family: { in: filters.productFamilies },
    };
  }

  const orders = await db.order.findMany({
    where,
    select: {
      grossAmountUsd: true,
      netAmountUsd: true,
      cpaPaidUsd: true,
      productType: true,
      customerId: true,
      parentExternalId: true,
      externalId: true,
      product: { select: { family: true } },
      platform: { select: { slug: true } },
    },
  });

  interface PeriodAcc {
    feOrders: number;
    totalOrders: number;
    grossRevenue: number;
    netRevenue: number;
    cpaPaid: number;
    customers: Set<string>;
    // For lift calculation we need group-level aggregation: revenue of FE-only
    // vs revenue of groups with at least one upsell.
    groupsFEOnly: { count: number; revenue: number };
    groupsWithUp: { count: number; revenue: number };
    // Track each group's signature so we can split FE-only vs FE+upsell.
    groupRoles: Map<string, { hasFE: boolean; hasUp: boolean; revenue: number }>;
  }
  const periodByFamily = new Map<string, PeriodAcc>();
  function getPeriod(family: string): PeriodAcc {
    let p = periodByFamily.get(family);
    if (!p) {
      p = {
        feOrders: 0,
        totalOrders: 0,
        grossRevenue: 0,
        netRevenue: 0,
        cpaPaid: 0,
        customers: new Set(),
        groupsFEOnly: { count: 0, revenue: 0 },
        groupsWithUp: { count: 0, revenue: 0 },
        groupRoles: new Map(),
      };
      periodByFamily.set(family, p);
    }
    return p;
  }

  for (const o of orders) {
    const fam = o.product.family;
    if (!fam) continue;
    const p = getPeriod(fam);
    const gross = Number(o.grossAmountUsd) || 0;
    p.totalOrders++;
    p.grossRevenue += gross;
    p.netRevenue += Number(o.netAmountUsd) || 0;
    p.cpaPaid += Number(o.cpaPaidUsd) || 0;
    if (o.customerId) p.customers.add(o.customerId);
    if (o.productType === 'FRONTEND') p.feOrders++;

    // Group-level aggregation for lift calc.
    const groupKey = `${o.platform.slug}:${o.parentExternalId ?? o.externalId}`;
    let role = p.groupRoles.get(groupKey);
    if (!role) {
      role = { hasFE: false, hasUp: false, revenue: 0 };
      p.groupRoles.set(groupKey, role);
    }
    role.revenue += gross;
    if (o.productType === 'FRONTEND') role.hasFE = true;
    if (o.productType === 'UPSELL' || o.productType === 'DOWNSELL') role.hasUp = true;
  }

  // Resolve groups → buckets
  for (const p of periodByFamily.values()) {
    for (const role of p.groupRoles.values()) {
      if (!role.hasFE) continue; // groups without FE don't count toward lift
      if (role.hasUp) {
        p.groupsWithUp.count++;
        p.groupsWithUp.revenue += role.revenue;
      } else {
        p.groupsFEOnly.count++;
        p.groupsFEOnly.revenue += role.revenue;
      }
    }
  }

  // 3. Compose final list. Show every catalog family even if zero orders.
  const allFamilyNames = new Set<string>([
    ...catalogByFamily.keys(),
    ...periodByFamily.keys(),
  ]);

  const families: FamilyAggregate[] = Array.from(allFamilyNames).map((family) => {
    const cat = catalogByFamily.get(family);
    const per = periodByFamily.get(family);
    const aovFE = per && per.groupsFEOnly.count
      ? per.groupsFEOnly.revenue / per.groupsFEOnly.count
      : 0;
    const aovUp = per && per.groupsWithUp.count
      ? per.groupsWithUp.revenue / per.groupsWithUp.count
      : 0;
    const upsellLiftPct = aovFE > 0 ? (aovUp - aovFE) / aovFE : null;
    const topVendor = cat
      ? Array.from(cat.vendorAccounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
      : null;
    return {
      family,
      niches: cat ? Array.from(cat.niches).sort() : [],
      feSkuCount: cat?.feSkuCount ?? 0,
      upSkuCount: cat?.upSkuCount ?? 0,
      dwSkuCount: cat?.dwSkuCount ?? 0,
      rcSkuCount: cat?.rcSkuCount ?? 0,
      feOrders: per?.feOrders ?? 0,
      totalOrders: per?.totalOrders ?? 0,
      grossRevenue: round2(per?.grossRevenue ?? 0),
      netRevenue: round2(per?.netRevenue ?? 0),
      cpaPaid: round2(per?.cpaPaid ?? 0),
      aov: round2(per && per.feOrders ? per.grossRevenue / per.feOrders : 0),
      uniqueCustomers: per?.customers.size ?? 0,
      upsellLiftPct: upsellLiftPct == null ? null : Math.round(upsellLiftPct * 10000) / 10000,
      topVendorAccount: topVendor,
    };
  })
  .sort((a, b) => b.grossRevenue - a.grossRevenue);

  return { families };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
