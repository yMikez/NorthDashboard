// One-shot backfill: re-derive Order.parentExternalId for all Digistore
// orders using the fixed deriveBaseOrderId() logic.
//
// Background: the original parser stored parent_external_id as the per-step
// order_id (e.g., "ABC1231" for an UP1). That meant FE and its upsells got
// different parent ids and never grouped together in the funnel. Fix is to
// strip the upsell_no suffix to recover the session's base id.
//
// This backfill reads each Digistore Order's raw payload (stored in
// Order.rawMetadata at ingest time) to get the upsell_no, recomputes the
// base order_id, and updates the row when it differs from current value.
// Idempotent — re-running yields zero updates.

import { db } from '../db';
import { deriveBaseOrderId } from '../connectors/digistore24/ingest';

export interface DigistoreParentBackfillStats {
  scanned: number;
  updated: number;
  skippedNoMetadata: number;
  alreadyCorrect: number;
}

export async function backfillDigistoreParents(): Promise<DigistoreParentBackfillStats> {
  const stats: DigistoreParentBackfillStats = {
    scanned: 0,
    updated: 0,
    skippedNoMetadata: 0,
    alreadyCorrect: 0,
  };

  const platform = await db.platform.findUnique({
    where: { slug: 'digistore24' },
    select: { id: true },
  });
  if (!platform) return stats;

  // Pull just what we need; rawMetadata is JSON so we project it.
  const orders = await db.order.findMany({
    where: { platformId: platform.id },
    select: { id: true, parentExternalId: true, rawMetadata: true },
  });

  stats.scanned = orders.length;

  for (const o of orders) {
    const meta = o.rawMetadata as { order_id?: string; upsell_no?: string } | null;
    const orderId = meta?.order_id;
    const upsellNoRaw = meta?.upsell_no;
    if (!orderId) {
      stats.skippedNoMetadata++;
      continue;
    }
    const upsellNo = upsellNoRaw ? Number.parseInt(upsellNoRaw, 10) : 0;
    const correctParent = deriveBaseOrderId(orderId, Number.isFinite(upsellNo) ? upsellNo : 0);

    if (o.parentExternalId === correctParent) {
      stats.alreadyCorrect++;
      continue;
    }
    await db.order.update({
      where: { id: o.id },
      data: { parentExternalId: correctParent },
    });
    stats.updated++;
  }

  return stats;
}
