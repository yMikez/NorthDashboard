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
import { backfillSessionFulfillment } from './sessionFulfillment';
import { Prisma } from '@prisma/client';

export interface CogsBackfillStats {
  scanned: number;
  cogsUpdated: number;
  skippedNoFamily: number;
  sessionsRebalanced: number;
}

export async function backfillCogs(): Promise<CogsBackfillStats> {
  invalidateCogsCache();
  const stats: CogsBackfillStats = {
    scanned: 0,
    cogsUpdated: 0,
    skippedNoFamily: 0,
    sessionsRebalanced: 0,
  };

  // Pass 1 — per-order COGS (each order's own bottles × per-bottle cost).
  const orders = await db.order.findMany({
    select: {
      id: true,
      cogsUsd: true,
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
    if (currentCogs === cogs.cogsUsd) continue;
    await db.order.update({
      where: { id: o.id },
      data: { cogsUsd: new Prisma.Decimal(cogs.cogsUsd) },
    });
    stats.cogsUpdated++;
  }

  // Pass 2 — rebalance fulfillment per session so the sum across orders =
  // real shipping cost (not N × per-item shipping). Assigns the bracket
  // for total session bottles to one designated primary order; zeros the
  // rest. See lib/services/sessionFulfillment.ts.
  const fulfillStats = await backfillSessionFulfillment();
  stats.sessionsRebalanced = fulfillStats.sessionsScanned;

  return stats;
}
