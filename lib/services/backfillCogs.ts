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
import { calcCogs, invalidateCogsCache, type ComboComponentInput } from './cogs';
import { invalidateFamilyDictionary } from './familyDictionary';
import { backfillSessionFulfillment } from './sessionFulfillment';
import { Prisma } from '@prisma/client';

export interface CogsBackfillStats {
  scanned: number;
  cogsUpdated: number;
  skippedNoFamily: number;
  sessionsRebalanced: number;
}

// sinceDays: limita o recompute a orders de N dias pra cá (cutover de
// fornecedor sem reescrever histórico antigo). undefined = tudo.
function parseComboJson(json: unknown): ComboComponentInput[] | null {
  if (!Array.isArray(json)) return null;
  const out: ComboComponentInput[] = [];
  for (const item of json) {
    if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).family === 'string'
      && typeof (item as Record<string, unknown>).bottles === 'number') {
      out.push(item as unknown as ComboComponentInput);
    }
  }
  return out.length >= 2 ? out : null;
}

export async function backfillCogs(sinceDays?: number): Promise<CogsBackfillStats> {
  invalidateCogsCache();
  invalidateFamilyDictionary();
  const stats: CogsBackfillStats = {
    scanned: 0,
    cogsUpdated: 0,
    skippedNoFamily: 0,
    sessionsRebalanced: 0,
  };

  // Pass 1 — per-order COGS (each order's own bottles × per-bottle cost) +
  // refresh do snapshot bottlesShipped (reclassificação de catálogo só
  // chega ao histórico por aqui — o ingest congela o valor da época).
  const orders = await db.order.findMany({
    where: sinceDays != null
      ? { orderedAt: { gte: new Date(Date.now() - sinceDays * 86_400_000) } }
      : undefined,
    select: {
      id: true,
      cogsUsd: true,
      bottlesShipped: true,
      classificationPending: true,
      product: {
        select: {
          family: true, bottles: true, bonusBottles: true,
          fulfillmentSupplier: true, comboComponents: true,
        },
      },
    },
  });
  stats.scanned = orders.length;

  for (const o of orders) {
    const combo = parseComboJson(o.product.comboComponents);
    const cogs = await calcCogs(
      o.product.family,
      o.product.bottles,
      o.product.bonusBottles,
      o.product.fulfillmentSupplier,
      combo,
    );
    const totalBottles = cogs.totalBottles > 0 ? cogs.totalBottles : null;
    const bottlesChanged = o.bottlesShipped !== totalBottles;

    if (!cogs.resolved) {
      // Custo IRRESOLVÍVEL → NULL + flag (nunca $0 falso). O pedido volta a
      // ser recomputado aqui quando o humano confirmar o SKU/custo.
      stats.skippedNoFamily++;
      if (o.cogsUsd !== null || bottlesChanged || !o.classificationPending) {
        await db.order.update({
          where: { id: o.id },
          data: { cogsUsd: null, bottlesShipped: totalBottles, classificationPending: true },
        });
      }
      continue;
    }
    const currentCogs = o.cogsUsd ? Number(o.cogsUsd) : null;
    if (currentCogs === cogs.cogsUsd && !bottlesChanged && !o.classificationPending) continue;
    await db.order.update({
      where: { id: o.id },
      data: {
        cogsUsd: new Prisma.Decimal(cogs.cogsUsd),
        bottlesShipped: totalBottles,
        classificationPending: false,
      },
    });
    stats.cogsUpdated++;
  }

  // Pass 2 — rebalance fulfillment per session so the sum across orders =
  // real shipping cost (not N × per-item shipping). Assigns the bracket
  // for total session bottles to one designated primary order; zeros the
  // rest. See lib/services/sessionFulfillment.ts.
  const fulfillStats = await backfillSessionFulfillment(sinceDays);
  stats.sessionsRebalanced = fulfillStats.sessionsScanned;

  return stats;
}
