import { db } from '../db';

export interface FilterOptionsResponse {
  platforms: Array<{
    id: string;
    label: string;
    isActive: boolean;
  }>;
  // Only FE products — these are the funnel "entry points" the UI exposes as
  // selectable offers. Determined from actual orders (productType=FRONTEND),
  // not from Product.productType catalog hint, which can be stale (see
  // project_product_classification_issue memory).
  funnels: Array<{
    id: string; // product.externalId
    label: string;
    platformSlug: string;
    orderCount: number;
  }>;
  countries: Array<{
    id: string; // ISO code
    label: string;
    orderCount: number;
  }>;
}

export async function getFilterOptions(): Promise<FilterOptionsResponse> {
  const platforms = await db.platform.findMany({
    select: { slug: true, displayName: true, isActive: true },
    orderBy: { displayName: 'asc' },
  });

  // FE products that have at least one FRONTEND-typed order. We aggregate by
  // product to dedupe and rank by activity (most-sold first).
  const feOrderCounts = await db.order.groupBy({
    by: ['productId'],
    where: { productType: 'FRONTEND' },
    _count: { _all: true },
  });
  const productIds = feOrderCounts.map((r) => r.productId);
  const products = productIds.length
    ? await db.product.findMany({
        where: { id: { in: productIds } },
        select: {
          id: true,
          externalId: true,
          name: true,
          platform: { select: { slug: true } },
        },
      })
    : [];
  const productById = new Map(products.map((p) => [p.id, p]));
  const funnels = feOrderCounts
    .map((r) => {
      const p = productById.get(r.productId);
      if (!p) return null;
      return {
        id: p.externalId,
        // Match the convention used elsewhere: drop the " · vendor" tail.
        label: p.name.split(' · ')[0],
        platformSlug: p.platform.slug,
        orderCount: r._count._all,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.orderCount - a.orderCount);

  // Distinct countries that appear in any order. Sort by activity desc so the
  // dropdown surfaces the user's actual top markets first.
  const countryRows = await db.order.groupBy({
    by: ['country'],
    where: { country: { not: null } },
    _count: { _all: true },
  });
  const countries = countryRows
    .map((r) => ({
      id: r.country!,
      label: r.country!,
      orderCount: r._count._all,
    }))
    .sort((a, b) => b.orderCount - a.orderCount);

  return {
    platforms: platforms.map((p) => ({
      id: p.slug,
      label: p.displayName,
      isActive: p.isActive,
    })),
    funnels,
    countries,
  };
}
