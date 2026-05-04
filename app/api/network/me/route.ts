// /api/network/me
//   GET → dados da própria network do partner logado: KPIs (afiliados,
//         AOV, accrued, paid, próximo payout), histórico de commissões
//         e payouts, status do contrato (versão + signed).

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireNetworkPartner } from '@/lib/auth/guard';
import { estimateNextPayout } from '@/lib/services/payoutCalc';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireNetworkPartner();
  if (!auth.ok) return auth.response;
  const networkId = auth.user.networkId;

  const network = await db.network.findUnique({
    where: { id: networkId },
    include: {
      contracts: { orderBy: { version: 'desc' }, take: 1 },
      affiliates: {
        include: {
          affiliate: {
            include: {
              platform: { select: { slug: true, displayName: true } },
            },
          },
        },
        orderBy: { attachedAt: 'desc' },
      },
    },
  });
  if (!network) return NextResponse.json({ error: 'network not found' }, { status: 404 });

  // Preview de comissões/payouts (últimos 10). Lista completa paginada via
  // /api/network/me/commissions e /api/network/me/payouts.
  const PREVIEW_TAKE = 10;
  const [commissions, commissionsTotal, payouts, payoutsTotal] = await Promise.all([
    db.networkCommission.findMany({
      where: { networkId },
      orderBy: { createdAt: 'desc' },
      take: PREVIEW_TAKE,
      include: {
        order: { select: { externalId: true, grossAmountUsd: true, orderedAt: true, country: true } },
        affiliate: { select: { externalId: true, nickname: true } },
      },
    }),
    db.networkCommission.count({ where: { networkId } }),
    db.networkPayout.findMany({
      where: { networkId },
      orderBy: { createdAt: 'desc' },
      take: PREVIEW_TAKE,
    }),
    db.networkPayout.count({ where: { networkId } }),
  ]);

  const next = await estimateNextPayout(network);

  // AOV agregado (mesma lógica do admin endpoint).
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const affiliateIds = network.affiliates.map((a) => a.affiliateId);
  let networkAovUsd = '0';
  if (affiliateIds.length > 0) {
    const agg = await db.order.aggregate({
      where: {
        affiliateId: { in: affiliateIds },
        productType: 'FRONTEND',
        status: 'APPROVED',
        orderedAt: { gte: since },
      },
      _sum: { grossAmountUsd: true },
      _count: { id: true },
    });
    const totalRev = Number(agg._sum.grossAmountUsd ?? 0);
    const totalOrders = agg._count.id;
    networkAovUsd = totalOrders > 0 ? (totalRev / totalOrders).toFixed(2) : '0';
  }

  const lastContract = network.contracts[0];

  return NextResponse.json({
    network: {
      id: network.id,
      name: network.name,
      status: network.status,
      commissionType: network.commissionType,
      commissionValue: network.commissionValue.toString(),
      paymentPeriodValue: network.paymentPeriodValue,
      paymentPeriodUnit: network.paymentPeriodUnit,
      contractStart: network.contractStart.toISOString(),
      billingEmail: network.billingEmail,
      networkAovUsd,
      currentContract: lastContract ? {
        id: lastContract.id,
        version: lastContract.version,
        signedAt: lastContract.signedAt?.toISOString() ?? null,
        needsSignature: !lastContract.signedAt,
      } : null,
      nextPayout: {
        at: next.nextPayoutAt.toISOString(),
        accruedUsd: next.accruedTotalUsd,
        accruedCount: next.accruedCommissionsCount,
        lastPayoutAt: next.lastPayoutAt?.toISOString() ?? null,
      },
    },
    commissionsTotal,
    payoutsTotal,
    affiliates: network.affiliates.map((a) => ({
      attachedAt: a.attachedAt.toISOString(),
      externalId: a.affiliate.externalId,
      nickname: a.affiliate.nickname,
      platformSlug: a.affiliate.platform.slug,
      platformName: a.affiliate.platform.displayName,
      lastOrderAt: a.affiliate.lastOrderAt?.toISOString() ?? null,
    })),
    commissions: commissions.map((c) => ({
      id: c.id,
      amountUsd: c.amountUsd.toString(),
      status: c.status,
      createdAt: c.createdAt.toISOString(),
      paidAt: c.paidAt?.toISOString() ?? null,
      payoutId: c.payoutId,
      orderExternalId: c.order.externalId,
      orderGrossUsd: c.order.grossAmountUsd.toString(),
      orderedAt: c.order.orderedAt.toISOString(),
      country: c.order.country,
      affiliateExternalId: c.affiliate.externalId,
      affiliateNickname: c.affiliate.nickname,
    })),
    payouts: payouts.map((p) => ({
      id: p.id,
      totalUsd: p.totalUsd.toString(),
      commissionsCount: p.commissionsCount,
      periodStart: p.periodStart.toISOString(),
      periodEnd: p.periodEnd.toISOString(),
      status: p.status,
      paidAt: p.paidAt?.toISOString() ?? null,
      paymentMethod: p.paymentMethod,
      createdAt: p.createdAt.toISOString(),
    })),
  });
}
