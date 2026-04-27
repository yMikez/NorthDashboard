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
  cache = {
    unitCostByFamily: new Map(
      families.map((f) => [f.family, Number(f.unitCostUsd)]),
    ),
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
  const unitCost = c.unitCostByFamily.get(family);
  if (unitCost == null) {
    // Family not in cost table — log warning at caller. Treat as zero so
    // we don't block ingestion; admin can fix and rerun backfill.
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
