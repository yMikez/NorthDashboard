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
  ordersFixed: number;
  funnelStepFixed: number;
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
    ordersFixed: 0,
    funnelStepFixed: 0,
    unrecognized: [],
  };

  // Track SKUs whose role the IPN clearly got wrong, so we can fix the
  // historical Order.productType for them in a second pass below.
  const productsToFixOrders: Array<{ id: string; toType: 'UPSELL' | 'DOWNSELL' | 'SMS_RECOVERY' }> = [];
  // Track funnelStep of every classified product so we can reconcile
  // Order.funnelStep with the catalog (IPN's upsell_no can disagree —
  // notably Digistore DW orders arrive with upsell_no=0, but the SKU
  // pattern says step=3 for DW2).
  const productsToFixFunnelStep: Array<{ id: string; funnelStep: number }> = [];

  for (const p of products) {
    const c = classifyProduct(p.externalId, p.name);
    if (!c.family) {
      // Classifier has no confident opinion — leave the row alone.
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

    // Mark for order-level fix when the catalog says this SKU is non-FE but
    // the IPN historically marked some orders as FRONTEND. We're conservative:
    // only fix the FE→non-FE direction, since the reverse (FE-marked SKU sold
    // as upsell variant in some funnels) is a legitimate ambiguity we don't
    // want to overwrite.
    if (c.type === 'UPSELL' || c.type === 'DOWNSELL' || c.type === 'SMS_RECOVERY') {
      productsToFixOrders.push({ id: p.id, toType: c.type });
    }

    if (c.funnelStep != null) {
      productsToFixFunnelStep.push({ id: p.id, funnelStep: c.funnelStep });
    }
  }

  for (const { id, toType } of productsToFixOrders) {
    const result = await db.order.updateMany({
      where: { productId: id, productType: 'FRONTEND' },
      data: { productType: toType },
    });
    stats.ordersFixed += result.count;
  }

  // Reconcile Order.funnelStep with the classifier's verdict. Idempotent:
  // the `not: funnelStep` filter ensures already-correct rows are skipped.
  for (const { id, funnelStep } of productsToFixFunnelStep) {
    const result = await db.order.updateMany({
      where: { productId: id, funnelStep: { not: funnelStep } },
      data: { funnelStep },
    });
    stats.funnelStepFixed += result.count;
  }

  return stats;
}
