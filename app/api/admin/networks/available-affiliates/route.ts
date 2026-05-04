// /api/admin/networks/available-affiliates
//   GET → lista afiliados que ainda NÃO estão vinculados a nenhuma
//         network (NetworkAffiliate.affiliateId é unique, então só pode
//         ter 1 link). Usado pelo UI de attach pra não mostrar
//         afiliados já alocados em outra network.
//
// Suporta ?q=substring pra search por nickname/externalId.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim();

  const where = q
    ? {
        networkLink: null,
        OR: [
          { externalId: { contains: q, mode: 'insensitive' as const } },
          { nickname: { contains: q, mode: 'insensitive' as const } },
        ],
      }
    : { networkLink: null };

  const affiliates = await db.affiliate.findMany({
    where,
    take: 50,
    orderBy: { lastOrderAt: 'desc' },
    include: {
      platform: { select: { slug: true, displayName: true } },
      _count: { select: { orders: true } },
    },
  });

  return NextResponse.json({
    affiliates: affiliates.map((a) => ({
      id: a.id,
      externalId: a.externalId,
      nickname: a.nickname,
      platformSlug: a.platform.slug,
      platformName: a.platform.displayName,
      ordersCount: a._count.orders,
      lastOrderAt: a.lastOrderAt?.toISOString() ?? null,
    })),
  });
}
