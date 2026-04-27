// Session-level fulfillment cost rebalancing.
//
// A funnel session (FE + bumps + upsells + downsells from one buyer)
// ships in a single package. The supplier charges shipping based on the
// total package weight, not per item. So summing per-order shipping
// overcounts: a session with FE (6 bottles) + UP (2 bottles) ships once
// with bracket(8), not bracket(6) + bracket(2).
//
// We compute the session's total shipping cost once and distribute it
// PRO-RATA across orders by bottle count. So an order's fulfillmentUsd
// is its fair share of the session's actual shipping spend:
//   order.fulfillmentUsd = session_shipping × order_bottles / session_bottles
//
// Sum across orders = real shipping cost (modulo penny rounding) ✓
// AND the drawer for any single order shows a meaningful non-zero number
// representing what that order "cost" to ship as part of the package.
//
// COGS is per-order (each order's bottles × per-bottle cost) and stays
// untouched by this rebalance.

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { calcCogs } from './cogs';

/**
 * Recompute and assign fulfillment for the session that owns `sessionKey`
 * on `platformId`. Idempotent — re-running yields the same final state.
 */
export async function rebalanceSessionFulfillment(
  platformId: string,
  sessionKey: string,
): Promise<void> {
  // Session = all orders whose parentExternalId matches OR whose externalId
  // is the parent (the FE itself in CB legacy where parent is null and the
  // FE acts as its own session anchor).
  const sessionOrders = await db.order.findMany({
    where: {
      platformId,
      OR: [{ parentExternalId: sessionKey }, { externalId: sessionKey }],
    },
    include: {
      product: { select: { family: true, bottles: true, bonusBottles: true } },
    },
    orderBy: { orderedAt: 'asc' },
  });
  if (sessionOrders.length === 0) return;

  // Total bottles across the whole session (incl. bonus). Family for the
  // bracket lookup is the FE family; calcCogs only uses family to validate
  // the family exists — fulfillment doesn't actually depend on family,
  // just total bottle count.
  let totalBottles = 0;
  let primaryFamily: string | null = null;
  for (const o of sessionOrders) {
    totalBottles += (o.product.bottles ?? 0) + (o.product.bonusBottles ?? 0);
    if (o.product.family && !primaryFamily) primaryFamily = o.product.family;
  }

  // calcCogs returns shipping for the whole package; we ignore the cogs
  // value here since each order keeps its own.
  const { fulfillmentUsd: totalFulfillment } = await calcCogs(
    primaryFamily,
    totalBottles,
    0,
  );

  // Distribute pro-rata by bottle count. Penny rounding is absorbed by the
  // last order so the sum equals totalFulfillment exactly.
  if (totalBottles <= 0) {
    // Nothing to distribute (orders without bottles classified yet).
    for (const o of sessionOrders) {
      if (o.fulfillmentUsd && Number(o.fulfillmentUsd) !== 0) {
        await db.order.update({
          where: { id: o.id },
          data: { fulfillmentUsd: new Prisma.Decimal(0) },
        });
      }
    }
    return;
  }

  let allocated = 0;
  for (let i = 0; i < sessionOrders.length; i++) {
    const o = sessionOrders[i];
    const orderBottles = (o.product.bottles ?? 0) + (o.product.bonusBottles ?? 0);
    const isLast = i === sessionOrders.length - 1;
    const share = isLast
      ? Math.round((totalFulfillment - allocated) * 100) / 100
      : Math.round((totalFulfillment * orderBottles / totalBottles) * 100) / 100;
    allocated += share;
    const current = o.fulfillmentUsd ? Number(o.fulfillmentUsd) : null;
    if (current === share) continue;
    await db.order.update({
      where: { id: o.id },
      data: { fulfillmentUsd: new Prisma.Decimal(share) },
    });
  }
}

/**
 * Backfill rebalance: recompute session fulfillment for every distinct
 * session in the database. Callers typically run this after backfillCogs
 * so cogsUsd is fresh on every order before fulfillment is consolidated.
 */
export async function backfillSessionFulfillment(): Promise<{
  sessionsScanned: number;
  ordersTouched: number;
}> {
  // Distinct (platformId, sessionKey) — sessionKey = parentExternalId or
  // externalId. Build the unique set in JS since SQL DISTINCT on a COALESCE
  // expression is awkward via Prisma.
  const orders = await db.order.findMany({
    select: { platformId: true, parentExternalId: true, externalId: true },
  });
  const sessionKeys = new Set<string>();
  for (const o of orders) {
    sessionKeys.add(`${o.platformId}|${o.parentExternalId ?? o.externalId}`);
  }
  let ordersTouched = 0;
  for (const key of sessionKeys) {
    const [platformId, sessionKey] = key.split('|');
    const before = await db.order.count({
      where: {
        platformId,
        OR: [{ parentExternalId: sessionKey }, { externalId: sessionKey }],
      },
    });
    await rebalanceSessionFulfillment(platformId, sessionKey);
    ordersTouched += before;
  }
  return { sessionsScanned: sessionKeys.size, ordersTouched };
}
