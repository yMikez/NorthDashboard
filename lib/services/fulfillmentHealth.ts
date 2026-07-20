// Saúde do custo de fulfillment — detecta onde o cálculo de COGS/frete
// está MENTINDO em silêncio. Sem reconciliação com fatura real (decisão de
// produto), este painel é a única defesa contra contagem de potes errada:
//
//   no_bottles      → SKU sem bottles no catálogo → custo $0 (subestima)
//   no_family       → SKU sem família → custo unitário vira média genérica
//   family_no_cost  → família sem ProductFamilyCost → idem (média)
//   no_rate         → fornecedor+família sem NENHUMA FulfillmentRate
//                     (nem _default) → frete $0
//   placeholder_supplier → Fullstack segue com custos espelhados da
//                     ShipOffers (TEMP) — números não são reais (info,
//                     não bloqueia a cobertura)
//
// Cobertura = pedidos APROVADOS do período sem nenhum problema BLOQUEANTE
// ÷ total de aprovados. É a métrica de confiança da aba inteira.

import { db } from '../db';

const DEFAULT_SUPPLIER = 'shipoffers';
const PLACEHOLDER_SUPPLIERS = new Set(['fullstack']);

export type FulfillmentIssueType =
  | 'no_bottles'
  | 'no_family'
  | 'family_no_cost'
  | 'no_rate'
  | 'placeholder_supplier';

export const ISSUE_LABELS: Record<FulfillmentIssueType, string> = {
  no_bottles: 'SKU sem contagem de potes no catálogo (custo $0)',
  no_family: 'SKU sem família (custo unitário vira média genérica)',
  family_no_cost: 'Família sem custo cadastrado (usa média das outras)',
  no_rate: 'Fornecedor sem tarifa de frete pra família (frete $0)',
  placeholder_supplier: 'Fullstack com custos placeholder (espelho ShipOffers)',
};

// Uma linha por pedido aprovado do período, com o que o classifier precisa.
export interface HealthOrderRow {
  platformSlug: string;
  productExternalId: string;
  productName: string;
  family: string | null;
  totalBottles: number;
  supplierOverride: string | null;
}

export interface FulfillmentHealthIssue {
  type: FulfillmentIssueType;
  label: string;
  // true = compromete o número (entra na cobertura); false = aviso.
  blocking: boolean;
  orders: number;
  skus: Array<{
    platform: string;
    externalId: string;
    name: string;
    family: string | null;
    orders: number;
  }>;
}

export interface FulfillmentHealthResponse {
  range: { start: string; end: string };
  kpis: {
    approvedOrders: number;
    resolvedOrders: number;
    // null quando não há pedidos no período.
    coveragePct: number | null;
  };
  issues: FulfillmentHealthIssue[];
}

export interface HealthCatalogInput {
  // família → supplier default (de ProductFamilyCost).
  familySupplier: Map<string, string>;
  // chaves `${supplier}|${family}` e `${supplier}|_default` que TÊM rate.
  ratedKeys: Set<string>;
}

export function resolveOrderSupplier(
  row: Pick<HealthOrderRow, 'family' | 'supplierOverride'>,
  familySupplier: Map<string, string>,
): string {
  if (row.supplierOverride) return row.supplierOverride;
  if (row.family) return familySupplier.get(row.family) ?? DEFAULT_SUPPLIER;
  return DEFAULT_SUPPLIER;
}

// Classificador puro (testável): recebe as linhas do período + o cadastro e
// devolve cobertura + issues agrupadas por SKU.
export function classifyFulfillmentHealth(
  rows: HealthOrderRow[],
  catalog: HealthCatalogInput,
): Omit<FulfillmentHealthResponse, 'range'> {
  interface SkuAgg {
    platform: string;
    externalId: string;
    name: string;
    family: string | null;
    orders: number;
  }
  const buckets = new Map<FulfillmentIssueType, Map<string, SkuAgg>>();
  const orderCounts = new Map<FulfillmentIssueType, number>();
  const add = (type: FulfillmentIssueType, r: HealthOrderRow) => {
    orderCounts.set(type, (orderCounts.get(type) ?? 0) + 1);
    const key = `${r.platformSlug}|${r.productExternalId}`;
    const bucket = buckets.get(type) ?? new Map<string, SkuAgg>();
    const sku = bucket.get(key) ?? {
      platform: r.platformSlug,
      externalId: r.productExternalId,
      name: r.productName,
      family: r.family,
      orders: 0,
    };
    sku.orders++;
    bucket.set(key, sku);
    buckets.set(type, bucket);
  };

  let resolved = 0;
  for (const r of rows) {
    let blocked = false;
    if (r.totalBottles <= 0) {
      add('no_bottles', r);
      blocked = true;
    }
    if (r.family == null) {
      add('no_family', r);
      blocked = true;
    } else if (!catalog.familySupplier.has(r.family)) {
      add('family_no_cost', r);
      blocked = true;
    }
    const supplier = resolveOrderSupplier(r, catalog.familySupplier);
    const hasRate =
      (r.family != null && catalog.ratedKeys.has(`${supplier}|${r.family}`)) ||
      catalog.ratedKeys.has(`${supplier}|_default`);
    if (!hasRate) {
      add('no_rate', r);
      blocked = true;
    }
    if (PLACEHOLDER_SUPPLIERS.has(supplier)) {
      add('placeholder_supplier', r);
      // info — não bloqueia (o número existe, só não é confiável ainda).
    }
    if (!blocked) resolved++;
  }

  const order: FulfillmentIssueType[] = ['no_bottles', 'no_family', 'family_no_cost', 'no_rate', 'placeholder_supplier'];
  const issues: FulfillmentHealthIssue[] = order
    .filter((t) => (orderCounts.get(t) ?? 0) > 0)
    .map((t) => ({
      type: t,
      label: ISSUE_LABELS[t],
      blocking: t !== 'placeholder_supplier',
      orders: orderCounts.get(t) ?? 0,
      skus: Array.from(buckets.get(t)?.values() ?? [])
        .sort((a, b) => b.orders - a.orders)
        .slice(0, 10),
    }));

  return {
    kpis: {
      approvedOrders: rows.length,
      resolvedOrders: resolved,
      coveragePct: rows.length > 0 ? Math.round((resolved / rows.length) * 1000) / 10 : null,
    },
    issues,
  };
}

export interface FulfillmentHealthFilters {
  startDate: Date;
  endDate: Date;
}

export async function getFulfillmentHealth(
  filters: FulfillmentHealthFilters,
): Promise<FulfillmentHealthResponse> {
  const [orders, familyCosts, rates] = await Promise.all([
    db.order.findMany({
      where: { status: 'APPROVED', orderedAt: { gte: filters.startDate, lte: filters.endDate } },
      select: {
        bottlesShipped: true,
        platform: { select: { slug: true } },
        product: {
          select: {
            externalId: true,
            name: true,
            family: true,
            bottles: true,
            bonusBottles: true,
            fulfillmentSupplier: true,
          },
        },
      },
    }),
    db.productFamilyCost.findMany({ select: { family: true, fulfillmentSupplier: true } }),
    db.fulfillmentRate.findMany({ select: { supplier: true, family: true } }),
  ]);

  const rows: HealthOrderRow[] = orders.map((o) => ({
    platformSlug: o.platform.slug,
    productExternalId: o.product.externalId,
    productName: o.product.name,
    family: o.product.family,
    // Snapshot preferido; fallback pro catálogo atual em rows pré-migration.
    totalBottles: o.bottlesShipped ?? (o.product.bottles ?? 0) + (o.product.bonusBottles ?? 0),
    supplierOverride: o.product.fulfillmentSupplier,
  }));

  const catalog: HealthCatalogInput = {
    familySupplier: new Map(familyCosts.map((f) => [f.family, f.fulfillmentSupplier])),
    ratedKeys: new Set(rates.map((r) => `${r.supplier}|${r.family}`)),
  };

  return {
    range: { start: filters.startDate.toISOString(), end: filters.endDate.toISOString() },
    ...classifyFulfillmentHealth(rows, catalog),
  };
}
