// Backfill: compute cogsUsd + fulfillmentUsd for every existing Order using
// current ProductFamilyCost / FulfillmentRate values. Idempotent — re-running
// updates with whatever the tables now say (useful after price edits when
// snapshots should be refreshed retroactively).
//
// Note: this overwrites historical snapshots. If we eventually want strict
// price-versioning (orders keep the cost from when they happened), we'd add
// effective_from/to to the cost tables and consult them by orderedAt here.
// For MVP we accept that running backfill = "recompute with current prices".

import { db } from '../db';
import { calcCogs, invalidateCogsCache } from './cogs';
import { Prisma } from '@prisma/client';

export interface CogsBackfillStats {
  scanned: number;
  updated: number;
  skippedNoFamily: number;
}

export async function backfillCogs(): Promise<CogsBackfillStats> {
  invalidateCogsCache();
  const stats: CogsBackfillStats = { scanned: 0, updated: 0, skippedNoFamily: 0 };
  const orders = await db.order.findMany({
    select: {
      id: true,
      cogsUsd: true,
      fulfillmentUsd: true,
      product: {
        select: { family: true, bottles: true, bonusBottles: true },
      },
    },
  });
  stats.scanned = orders.length;

  for (const o of orders) {
    if (!o.product.family) {
      stats.skippedNoFamily++;
      continue;
    }
    const cogs = await calcCogs(
      o.product.family,
      o.product.bottles,
      o.product.bonusBottles,
    );
    const currentCogs = o.cogsUsd ? Number(o.cogsUsd) : null;
    const currentFulfillment = o.fulfillmentUsd ? Number(o.fulfillmentUsd) : null;
    if (currentCogs === cogs.cogsUsd && currentFulfillment === cogs.fulfillmentUsd) {
      continue; // already correct
    }
    await db.order.update({
      where: { id: o.id },
      data: {
        cogsUsd: new Prisma.Decimal(cogs.cogsUsd),
        fulfillmentUsd: new Prisma.Decimal(cogs.fulfillmentUsd),
      },
    });
    stats.updated++;
  }
  return stats;
}
