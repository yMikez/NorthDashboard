// Network commission accrual. Runs after upsertOrder for each ingest.
// Rule: every FRONTEND order with status=APPROVED whose affiliate is
// linked to a Network generates exactly one NetworkCommission row.
// Refunds NÃO afetam comissão já contabilizada (decisão de produto —
// a comissão vira PAID quando incluída em payout, e fica como histórico
// mesmo que a venda original seja revertida depois).
//
// Idempotência: NetworkCommission.orderId é UNIQUE — re-rodar pro mesmo
// order é no-op (upsert via Prisma).

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { logger } from '../logger';

export interface AccrualResult {
  created: boolean;
  commissionId: string | null;
  reason?: string;
}

/**
 * Compute commission amount in USD given the network's config + the order's gross.
 *
 *   FIXED   → commissionValue (já está em USD)
 *   PERCENT → grossUsd * commissionValue (commissionValue é fração: 0.05 = 5%)
 */
export function computeCommissionAmount(
  type: 'FIXED' | 'PERCENT',
  value: Prisma.Decimal | number,
  grossUsd: Prisma.Decimal | number,
): Prisma.Decimal {
  const v = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
  const g = grossUsd instanceof Prisma.Decimal ? grossUsd : new Prisma.Decimal(grossUsd);
  if (type === 'FIXED') return v;
  return g.mul(v);
}

/**
 * Accrue commission for a single FE order if its affiliate belongs to a Network.
 * Safe to call for any order — checks productType/status/affiliate gates internally.
 */
export async function accrueCommissionForOrder(orderId: string): Promise<AccrualResult> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      productType: true,
      status: true,
      grossAmountUsd: true,
      affiliateId: true,
    },
  });
  if (!order) return { created: false, commissionId: null, reason: 'order_not_found' };
  if (order.productType !== 'FRONTEND') return { created: false, commissionId: null, reason: 'not_frontend' };
  if (order.status !== 'APPROVED') return { created: false, commissionId: null, reason: 'not_approved' };
  if (!order.affiliateId) return { created: false, commissionId: null, reason: 'no_affiliate' };

  const link = await db.networkAffiliate.findUnique({
    where: { affiliateId: order.affiliateId },
    select: {
      networkId: true,
      network: { select: { commissionType: true, commissionValue: true } },
    },
  });
  if (!link) return { created: false, commissionId: null, reason: 'affiliate_not_in_network' };

  const amount = computeCommissionAmount(
    link.network.commissionType,
    link.network.commissionValue,
    order.grossAmountUsd,
  );

  // Upsert by orderId — idempotent. Snapshot the type+value at creation time so
  // subsequent network config changes don't retroactively alter old commissions.
  const existing = await db.networkCommission.findUnique({
    where: { orderId: order.id },
    select: { id: true },
  });
  if (existing) {
    return { created: false, commissionId: existing.id, reason: 'already_accrued' };
  }

  const created = await db.networkCommission.create({
    data: {
      networkId: link.networkId,
      orderId: order.id,
      affiliateId: order.affiliateId,
      amountUsd: amount,
      commissionType: link.network.commissionType,
      commissionValue: link.network.commissionValue,
      status: 'ACCRUED',
    },
    select: { id: true },
  });

  logger.info(
    { orderId, networkId: link.networkId, amount: amount.toString() },
    '[networkAccrual] commission created',
  );

  return { created: true, commissionId: created.id };
}
