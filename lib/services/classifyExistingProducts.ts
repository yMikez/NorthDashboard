// One-shot backfill: classify Products that have family=null using their
// existing externalId/name. Idempotent — safe to run on every container
// startup since it filters family=null first (already-classified rows are
// skipped). The classifier is pure (regex over SKU/name), so this runs in
// O(unclassified products) without touching orders or external services.

import { db } from '../db';
import { classifyProduct } from './productClassification';

export interface BackfillStats {
  scanned: number;
  classified: number;
  unrecognized: string[];
}

export async function classifyExistingProducts(): Promise<BackfillStats> {
  const products = await db.product.findMany({
    where: { family: null },
    select: { id: true, externalId: true, name: true },
  });

  const stats: BackfillStats = { scanned: products.length, classified: 0, unrecognized: [] };

  for (const p of products) {
    const c = classifyProduct(p.externalId, p.name);
    if (!c.family) {
      stats.unrecognized.push(p.externalId);
      continue;
    }
    await db.product.update({
      where: { id: p.id },
      data: {
        family: c.family,
        variant: c.variant,
        bottles: c.bottles,
      },
    });
    stats.classified++;
  }

  return stats;
}
