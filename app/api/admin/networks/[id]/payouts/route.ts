// /api/admin/networks/[id]/payouts
//   GET  → lista paginada de payouts da network.
//   POST → gera novo payout snapshot com todas as commissões ACCRUED.
//          Status nasce PENDING; admin marca como PAID via PATCH em
//          /payouts/[payoutId]. Idempotência: se não há accrued, retorna
//          200 com payoutId=null + reason.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { audit } from '@/lib/services/networkAuditLog';
import { createPayout } from '@/lib/services/payoutCalc';
import { parsePagination, paginatedResponse } from '@/lib/pagination';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id: networkId } = await params;

  const url = new URL(req.url);
  const pagination = parsePagination(url);

  const [items, total] = await Promise.all([
    db.networkPayout.findMany({
      where: { networkId },
      orderBy: { createdAt: 'desc' },
      skip: pagination.skip,
      take: pagination.take,
      include: {
        paidBy: { select: { id: true, name: true, email: true } },
        _count: { select: { commissions: true } },
      },
    }),
    db.networkPayout.count({ where: { networkId } }),
  ]);

  const mapped = items.map((p) => ({
    id: p.id,
    totalUsd: p.totalUsd.toString(),
    commissionsCount: p.commissionsCount,
    periodStart: p.periodStart.toISOString(),
    periodEnd: p.periodEnd.toISOString(),
    status: p.status,
    paidAt: p.paidAt?.toISOString() ?? null,
    paidByName: p.paidBy?.name ?? p.paidBy?.email ?? null,
    paymentMethod: p.paymentMethod,
    notes: p.notes,
    createdAt: p.createdAt.toISOString(),
  }));

  return NextResponse.json(paginatedResponse(mapped, total, pagination));
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id: networkId } = await params;

  const network = await db.network.findUnique({ where: { id: networkId }, select: { id: true } });
  if (!network) return NextResponse.json({ error: 'network not found' }, { status: 404 });

  const result = await createPayout(networkId);

  if (result.payoutId) {
    await audit({
      actorUserId: auth.user.id,
      entityType: 'NETWORK_PAYOUT',
      entityId: result.payoutId,
      action: 'create',
      after: {
        networkId,
        totalUsd: result.totalUsd,
        commissionsCount: result.commissionsCount,
      },
    });
    logger.info(
      { actorId: auth.user.id, networkId, payoutId: result.payoutId, total: result.totalUsd },
      'admin.networks.payouts.create',
    );
  }

  return NextResponse.json(result);
}
