// /api/network/me/payouts
//   GET → lista paginada de payouts do partner logado.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireNetworkPartner } from '@/lib/auth/guard';
import { parsePagination, paginatedResponse } from '@/lib/pagination';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireNetworkPartner();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const pagination = parsePagination(url);

  const [items, total] = await Promise.all([
    db.networkPayout.findMany({
      where: { networkId: auth.user.networkId },
      orderBy: { createdAt: 'desc' },
      skip: pagination.skip,
      take: pagination.take,
    }),
    db.networkPayout.count({ where: { networkId: auth.user.networkId } }),
  ]);

  const mapped = items.map((p) => ({
    id: p.id,
    totalUsd: p.totalUsd.toString(),
    commissionsCount: p.commissionsCount,
    periodStart: p.periodStart.toISOString(),
    periodEnd: p.periodEnd.toISOString(),
    status: p.status,
    paidAt: p.paidAt?.toISOString() ?? null,
    paymentMethod: p.paymentMethod,
    createdAt: p.createdAt.toISOString(),
  }));

  return NextResponse.json(paginatedResponse(mapped, total, pagination));
}
