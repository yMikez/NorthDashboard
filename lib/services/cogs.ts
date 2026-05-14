// Cost-of-goods + fulfillment calculation. Reads ProductFamilyCost +
// FulfillmentRate tables (editable via admin endpoint or seeded by
// migration) and produces the per-order cost a sale incurs.
//
// COGS         = (bottles + bonusBottles) × family unitCostUsd
// Fulfillment  = first FulfillmentRate row whose bottlesMax >= total
//
// Both numbers are snapshotted into Order.cogsUsd / Order.fulfillmentUsd
// at ingest time so historical accuracy is preserved when prices change.
//
// Refunds: company eats the cost (product was already shipped). Caller
// computes profit accordingly — this module just produces the cost.

import { db } from '../db';

// In-memory cache, refreshed on demand. Cost tables change rarely, so
// reading them on every order upsert is wasteful. Refresh whenever the
// admin endpoint mutates the rows (or process restart).
interface CostsCache {
  unitCostByFamily: Map<string, number>;
  // Custo médio entre famílias catalogadas — usado como fallback quando o
  // produto chega de uma família sem entrada em ProductFamilyCost (ex: SKU
  // novo num funil ainda não cadastrado). Garante que cogsUsd não vire 0
  // só porque o admin ainda não preencheu o custo unitário.
  averageUnitCost: number | null;
  fulfillmentBrackets: Array<{ bottlesMax: number; priceUsd: number }>;
  loadedAt: number;
}
let cache: CostsCache | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getCache(): Promise<CostsCache> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache;
  const [families, rates] = await Promise.all([
    db.productFamilyCost.findMany(),
    db.fulfillmentRate.findMany({ orderBy: { bottlesMax: 'asc' } }),
  ]);
  const unitCostByFamily = new Map(
    families.map((f) => [f.family, Number(f.unitCostUsd)]),
  );
  const values = Array.from(unitCostByFamily.values()).filter((v) => v > 0);
  const averageUnitCost = values.length > 0
    ? values.reduce((s, v) => s + v, 0) / values.length
    : null;
  cache = {
    unitCostByFamily,
    averageUnitCost,
    fulfillmentBrackets: rates.map((r) => ({
      bottlesMax: r.bottlesMax,
      priceUsd: Number(r.priceUsd),
    })),
    loadedAt: Date.now(),
  };
  return cache;
}

export function invalidateCogsCache(): void {
  cache = null;
}

export interface CogsResult {
  cogsUsd: number;        // total unit cost (bottles + bonus) × per-bottle price
  fulfillmentUsd: number; // shipping bracket lookup
  totalBottles: number;   // computed bottles + bonusBottles, returned for transparency
}

export async function calcCogs(
  family: string | null,
  bottles: number | null,
  bonusBottles: number | null,
): Promise<CogsResult> {
  const totalBottles = (bottles ?? 0) + (bonusBottles ?? 0);
  if (!family || totalBottles <= 0) {
    return { cogsUsd: 0, fulfillmentUsd: 0, totalBottles };
  }
  const c = await getCache();
  // Fallback pra custo médio quando a família não está catalogada — evita
  // que o KPI de custo fique subestimado por SKUs novos. Quando o admin
  // cadastrar o valor real em /costs e rodar "Recalcular orders existentes",
  // os snapshots são reescritos com o número correto. Se nem média existir
  // (catálogo totalmente vazio), preserva o comportamento antigo (zero).
  const unitCost = c.unitCostByFamily.get(family) ?? c.averageUnitCost;
  if (unitCost == null) {
    return { cogsUsd: 0, fulfillmentUsd: 0, totalBottles };
  }
  const cogsUsd = round2(totalBottles * unitCost);

  // First bracket whose maxBottles >= total. Sorted ASC during cache load.
  const bracket = c.fulfillmentBrackets.find((b) => b.bottlesMax >= totalBottles);
  // Out-of-range (orders > 12 bottles, currently no SKU): use largest bracket
  // as conservative fallback. Surface for review.
  const fulfillmentRate = bracket
    ? bracket.priceUsd
    : (c.fulfillmentBrackets[c.fulfillmentBrackets.length - 1]?.priceUsd ?? 0);

  return { cogsUsd, fulfillmentUsd: round2(fulfillmentRate), totalBottles };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
