import { db } from '../db';

export interface FilterOptionsResponse {
  platforms: Array<{
    id: string;
    label: string;
    isActive: boolean;
  }>;
  // ProductFamily is the canonical "offer" dimension — derived from the
  // catalog (CSV seed). Cards/funnel filters group by family rather than by
  // individual SKU because users think in terms of "NeuroMindPro" not
  // "NeuroMindPro-6-FE-vs2".
  families: Array<{
    id: string;        // family name as canonical key (e.g. 'NeuroMindPro')
    label: string;     // currently same as id; kept separate for future i18n
    feSkuCount: number;
    totalSkuCount: number;
    niches: string[];
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
    family: string | null;
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
          family: true,
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
        family: p.family,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.orderCount - a.orderCount);

  // Families come from the catalog (all known families) regardless of whether
  // they have orders in any specific period — this lets the UI surface
  // newly-added families before the first sale lands.
  const familyRows = await db.product.findMany({
    where: { family: { not: null } },
    select: { family: true, productType: true, niche: true },
  });
  interface FamilyAcc {
    feSkuCount: number;
    totalSkuCount: number;
    niches: Set<string>;
  }
  const byFamily = new Map<string, FamilyAcc>();
  for (const row of familyRows) {
    if (!row.family) continue;
    let acc = byFamily.get(row.family);
    if (!acc) {
      acc = { feSkuCount: 0, totalSkuCount: 0, niches: new Set() };
      byFamily.set(row.family, acc);
    }
    acc.totalSkuCount++;
    if (row.productType === 'FRONTEND') acc.feSkuCount++;
    if (row.niche) acc.niches.add(row.niche);
  }
  // Filtra famílias "garbage" — resíduos de classificação onde a regex falhou
  // e o nome inteiro do produto virou a família. Padrões observados em prod:
  //   - "UP3 - Digest Flow + NeuroMind Pro (3 + 3 Bottles)" (D24 fallback)
  //   - "DW3 - Night Calm + Flex Guard (1 + 1 Bottles)"
  //   - "V1 Thermo Burn Pro" (variant prefix CB que não foi stripped)
  //   - "Night Calm + Flex Guard" (combo BG sem normalização canônica)
  // Esses NÃO são famílias reais — são SKUs específicos de upsell/downsell
  // que ficaram com o nome cru porque o regex não pegou. O filtro do dropdown
  // mostra só famílias "principais" — produtos canonicamente classificáveis.
  //
  // Heurística: rejeita nomes que (a) começam com prefixo de slot D24/CB
  // (UP\d, DW\d, M\d, DS, RC, V\d), (b) contêm " - " ou " + ", ou (c) são
  // o sentinel 'no-family' / vazios.
  function isMainFamily(name: string): boolean {
    if (!name || name === 'no-family') return false;
    if (/\s[-+]\s/.test(name)) return false;
    if (/^(UP\d|DW\d|M\d|DS\d*|RC|V\d)\b/i.test(name)) return false;
    return true;
  }

  const families = Array.from(byFamily.entries())
    .filter(([name]) => isMainFamily(name))
    .map(([name, acc]) => ({
      id: name,
      label: name,
      feSkuCount: acc.feSkuCount,
      totalSkuCount: acc.totalSkuCount,
      niches: Array.from(acc.niches).sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

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
    families,
    platforms: platforms.map((p) => ({
      id: p.slug,
      label: p.displayName,
      isActive: p.isActive,
    })),
    funnels,
    countries,
  };
}
