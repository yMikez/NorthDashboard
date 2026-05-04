// Payout computation for networks. Two pieces:
//
//   1. estimateNextPayout — given a Network, returns the date when the
//      next payout becomes due (last payout periodEnd + period, ou
//      contractStart + period se nunca pagou) plus the current accrued
//      total that would be included.
//
//   2. createPayout — atomically snapshots all ACCRUED commissions of a
//      network into a new NetworkPayout (status PENDING) and flips
//      those commissions' status to PAID + payoutId. Admin then marks
//      the payout itself as PAID via the API endpoint.
//
// Periodicity is defined by Network.paymentPeriodValue +
// paymentPeriodUnit (DAYS|WEEKS|MONTHS).

import type { Network, PaymentPeriodUnit } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { db } from '../db';

export function addPeriod(date: Date, value: number, unit: PaymentPeriodUnit): Date {
  const d = new Date(date);
  if (unit === 'DAYS') d.setUTCDate(d.getUTCDate() + value);
  else if (unit === 'WEEKS') d.setUTCDate(d.getUTCDate() + value * 7);
  else if (unit === 'MONTHS') d.setUTCMonth(d.getUTCMonth() + value);
  return d;
}

export interface NextPayoutEstimate {
  nextPayoutAt: Date;
  accruedTotalUsd: string;       // serialized Decimal
  accruedCommissionsCount: number;
  lastPayoutAt: Date | null;
}

export async function estimateNextPayout(network: Pick<Network,
  'id' | 'paymentPeriodValue' | 'paymentPeriodUnit' | 'contractStart'>,
): Promise<NextPayoutEstimate> {
  const lastPayout = await db.networkPayout.findFirst({
    where: { networkId: network.id },
    orderBy: { periodEnd: 'desc' },
    select: { periodEnd: true, paidAt: true },
  });
  const anchor = lastPayout?.periodEnd ?? network.contractStart;
  const nextPayoutAt = addPeriod(anchor, network.paymentPeriodValue, network.paymentPeriodUnit);

  const agg = await db.networkCommission.aggregate({
    where: { networkId: network.id, status: 'ACCRUED' },
    _sum: { amountUsd: true },
    _count: { id: true },
  });

  return {
    nextPayoutAt,
    accruedTotalUsd: (agg._sum.amountUsd ?? 0).toString(),
    accruedCommissionsCount: agg._count.id,
    lastPayoutAt: lastPayout?.paidAt ?? null,
  };
}

export interface CreatePayoutResult {
  payoutId: string | null;
  totalUsd: string;
  commissionsCount: number;
  reason?: string;
}

/**
 * Snapshot all ACCRUED commissions of a network into a new payout.
 * Returns reason='no_accrued' if there's nothing to pay out.
 *
 * The payout starts in PENDING status. Admin marks it PAID via the
 * separate /payouts/[id]/mark-paid endpoint (which also updates the
 * underlying commissions' paidAt timestamps).
 */
export async function createPayout(networkId: string): Promise<CreatePayoutResult> {
  return db.$transaction(async (tx) => {
    const accrued = await tx.networkCommission.findMany({
      where: { networkId, status: 'ACCRUED' },
      select: { id: true, amountUsd: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    if (accrued.length === 0) {
      return { payoutId: null, totalUsd: '0', commissionsCount: 0, reason: 'no_accrued' };
    }

    const total = accrued.reduce(
      (acc, c) => acc.add(c.amountUsd),
      new Prisma.Decimal(0),
    );

    const periodStart = accrued[0].createdAt;
    const periodEnd = new Date();

    const payout = await tx.networkPayout.create({
      data: {
        networkId,
        totalUsd: total,
        commissionsCount: accrued.length,
        periodStart,
        periodEnd,
        status: 'PENDING',
      },
      select: { id: true },
    });

    await tx.networkCommission.updateMany({
      where: { id: { in: accrued.map((c) => c.id) } },
      data: { payoutId: payout.id, status: 'PAID' },
    });

    return {
      payoutId: payout.id,
      totalUsd: total.toString(),
      commissionsCount: accrued.length,
    };
  });
}

/**
 * Mark an existing PENDING payout as PAID. Sets paidAt on the payout
 * AND on each underlying commission so the partner-facing UI can show
 * "paid on YYYY-MM-DD" per commission too.
 */
export async function markPayoutAsPaid(
  payoutId: string,
  paidByUserId: string,
  paymentMethod?: string | null,
  notes?: string | null,
): Promise<{ ok: boolean; reason?: string }> {
  return db.$transaction(async (tx) => {
    const payout = await tx.networkPayout.findUnique({
      where: { id: payoutId },
      select: { id: true, status: true },
    });
    if (!payout) return { ok: false, reason: 'not_found' };
    if (payout.status === 'PAID') return { ok: false, reason: 'already_paid' };

    const now = new Date();
    await tx.networkPayout.update({
      where: { id: payoutId },
      data: {
        status: 'PAID',
        paidAt: now,
        paidByUserId,
        paymentMethod: paymentMethod ?? null,
        notes: notes ?? null,
      },
    });
    await tx.networkCommission.updateMany({
      where: { payoutId },
      data: { paidAt: now },
    });
    return { ok: true };
  });
}
