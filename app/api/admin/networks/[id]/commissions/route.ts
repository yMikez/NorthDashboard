// /api/admin/networks/[id]/commissions
//   GET → lista paginada de comissões da network (filtrável por status).
//
// Query: ?page=1&pageSize=25&status=ACCRUED|PAID
// Response: { items, page, pageSize, total, hasMore }

import { NextResponse } from 'next/server';
import type { CommissionStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { parsePagination, paginatedResponse } from '@/lib/pagination';

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
  const statusParam = url.searchParams.get('status');
  const statusFilter: CommissionStatus | null =
    statusParam === 'ACCRUED' ? 'ACCRUED'
    : statusParam === 'PAID' ? 'PAID'
    : null;

  const where = statusFilter
    ? { networkId, status: statusFilter }
    : { networkId };

  const [items, total] = await Promise.all([
    db.networkCommission.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: pagination.skip,
      take: pagination.take,
      include: {
        order: { select: { externalId: true, grossAmountUsd: true, orderedAt: true, country: true } },
        affiliate: { select: { externalId: true, nickname: true } },
      },
    }),
    db.networkCommission.count({ where }),
  ]);

  const mapped = items.map((c) => ({
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
  }));

  return NextResponse.json(paginatedResponse(mapped, total, pagination));
}
