// Backfill: re-classify ALL Products (not just family=null) so SKUs whose
// productType was set wrong by the original IPN payload get corrected by
// the catalog-aware classifier. Idempotent (re-running yields same result).
// The classifier is pure (regex over SKU/name), so cost is O(products) with
// no external I/O beyond per-row updates.
//
// Why re-scan all (vs only family=null)?
// Some SKUs have correct family but wrong productType. Example seen in prod:
// Digistore SKU 687054 (UP2 - Glyco Pulse 3 Bottles) was created with
// productType=FRONTEND because the first IPN happened to be misclassified.
// We trust the SKU pattern over the IPN payload for catalog-level role.

import { db } from '../db';
import { classifyProduct } from './productClassification';

export interface BackfillStats {
  scanned: number;
  classified: number;
  productTypeFixed: number;
  unrecognized: string[];
}

export async function classifyExistingProducts(): Promise<BackfillStats> {
  const products = await db.product.findMany({
    select: { id: true, externalId: true, name: true, productType: true, family: true },
  });

  const stats: BackfillStats = {
    scanned: products.length,
    classified: 0,
    productTypeFixed: 0,
    unrecognized: [],
  };

  for (const p of products) {
    const c = classifyProduct(p.externalId, p.name);
    if (!c.family) {
      // Classifier has no confident opinion — leave the row alone. We don't
      // overwrite family with null nor productType with the fallback, so
      // unknown SKUs keep whatever the IPN gave them.
      if (!p.family) stats.unrecognized.push(p.externalId);
      continue;
    }
    const productTypeChanged = p.productType !== c.type;
    await db.product.update({
      where: { id: p.id },
      data: {
        family: c.family,
        variant: c.variant,
        bottles: c.bottles,
        productType: c.type,
      },
    });
    stats.classified++;
    if (productTypeChanged) stats.productTypeFixed++;
  }

  return stats;
}
