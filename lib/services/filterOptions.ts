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
  // Filtro "Afiliado" da barra global (SPA e /chat): a PESSOA (contas
  // unificadas na Análise de afiliados, chave p:<partnerId>) ou a CONTA de
  // plataforma solta (a:<Affiliate.id>). O servidor resolve pra Affiliate.id
  // e filtra Order.affiliateId (lib/shared/affiliateFilter). Ordem: receita
  // aprovada dos últimos 30 dias, depois a venda mais recente.
  affiliates: Array<{
    id: string;          // 'p:<partnerId>' | 'a:<affiliateId>'
    label: string;       // nome
    kind: 'partner' | 'account';
    platforms: string[]; // slugs
    /** "JVZoo 3552295" (conta) · "JVZoo + BuyGoods · 3 contas" (pessoa) */
    meta: string;
    revenue30d: number;
    internal: boolean;
  }>;
}

const PLATFORM_SHORT: Record<string, string> = {
  jvzoo: 'JVZoo', buygoods: 'BuyGoods', digistore24: 'Digistore', clickbank: 'ClickBank', cartpanda: 'Cartpanda',
};

/** Opções do filtro "Afiliado": pessoa unificada ou conta solta, com venda. */
async function affiliateFilterOptions(
  platforms: Array<{ slug: string; displayName: string }>,
): Promise<FilterOptionsResponse['affiliates']> {
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const [accounts, rev] = await Promise.all([
    db.affiliate.findMany({
      where: { lastOrderAt: { not: null } },
      select: {
        id: true, externalId: true, nickname: true, isInternal: true, lastOrderAt: true,
        platform: { select: { slug: true } },
        partner: { select: { id: true, displayName: true } },
      },
    }),
    db.order.groupBy({
      by: ['affiliateId'],
      where: { status: 'APPROVED', orderedAt: { gte: since30 }, affiliateId: { not: null } },
      _sum: { grossAmountUsd: true },
    }),
  ]);
  const revById = new Map(rev.map((r) => [r.affiliateId as string, Number(r._sum.grossAmountUsd ?? 0)]));
  const nameOf = (slug: string) => PLATFORM_SHORT[slug] ?? platforms.find((p) => p.slug === slug)?.displayName ?? slug;
  type Acc = { id: string; label: string; kind: 'partner' | 'account'; platforms: Set<string>; accounts: number; revenue30d: number; last: number; internal: boolean; ext: string };
  const byKey = new Map<string, Acc>();
  for (const a of accounts) {
    const key = a.partner ? `p:${a.partner.id}` : `a:${a.id}`;
    let o = byKey.get(key);
    if (!o) {
      o = {
        id: key,
        label: a.partner ? a.partner.displayName : (a.nickname?.trim() || a.externalId),
        kind: a.partner ? 'partner' : 'account',
        platforms: new Set(), accounts: 0, revenue30d: 0, last: 0, internal: a.isInternal === true, ext: a.externalId,
      };
      byKey.set(key, o);
    }
    o.platforms.add(a.platform.slug);
    o.accounts += 1;
    o.revenue30d += revById.get(a.id) ?? 0;
    o.last = Math.max(o.last, a.lastOrderAt?.getTime() ?? 0);
    if (a.isInternal !== true) o.internal = false;
  }
  return [...byKey.values()]
    .sort((x, y) => y.revenue30d - x.revenue30d || y.last - x.last || x.label.localeCompare(y.label))
    .map((o) => {
      const plats = [...o.platforms];
      const meta = o.kind === 'partner'
        ? `${plats.map(nameOf).join(' + ')} · ${o.accounts} conta${o.accounts === 1 ? '' : 's'}`
        : `${nameOf(plats[0])} ${o.ext}`;
      return {
        id: o.id, label: o.label, kind: o.kind, platforms: plats,
        meta: o.internal ? `${meta} · interno` : meta,
        revenue30d: Math.round(o.revenue30d), internal: o.internal,
      };
    });
}

export async function getFilterOptions(): Promise<FilterOptionsResponse> {
  const platforms = await db.platform.findMany({
    select: { slug: true, displayName: true, isActive: true },
    orderBy: { displayName: 'asc' },
  });

  const affiliates = await affiliateFilterOptions(platforms);

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
  // Chave case-insensitive: defesa contra grafias divergentes da MESMA
  // família ("LumiCept" × "Lumicept", "Mindtrex" × "MindTrex") aparecerem
  // como duplicatas no dropdown. A correção de verdade é a normalização no
  // classifier + backfill; aqui é o cinto de segurança pra próxima grafia
  // nova que escapar. Label = a grafia com mais SKUs.
  const byFamily = new Map<string, FamilyAcc & { labels: Map<string, number> }>();
  for (const row of familyRows) {
    if (!row.family) continue;
    const key = row.family.trim().toLowerCase();
    let acc = byFamily.get(key);
    if (!acc) {
      acc = { feSkuCount: 0, totalSkuCount: 0, niches: new Set(), labels: new Map() };
      byFamily.set(key, acc);
    }
    acc.totalSkuCount++;
    acc.labels.set(row.family, (acc.labels.get(row.family) ?? 0) + 1);
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

  const families = Array.from(byFamily.values())
    .map((acc) => {
      // Grafia vencedora = a com mais SKUs (id continua sendo o valor real
      // gravado em Product.family, então o filtro segue casando no backend).
      let label = '';
      let best = -1;
      for (const [spelling, count] of acc.labels) {
        if (count > best) { best = count; label = spelling; }
      }
      return {
        id: label,
        label,
        feSkuCount: acc.feSkuCount,
        totalSkuCount: acc.totalSkuCount,
        niches: Array.from(acc.niches).sort(),
      };
    })
    .filter((f) => isMainFamily(f.id))
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
    affiliates,
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
