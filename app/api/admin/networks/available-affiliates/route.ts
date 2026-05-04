// /api/admin/networks/available-affiliates
//   GET → lista afiliados que ainda NÃO estão vinculados a nenhuma
//         network (NetworkAffiliate.affiliateId é unique, então só pode
//         ter 1 link). Usado pelo UI de attach pra não mostrar
//         afiliados já alocados em outra network.
//
// Suporta ?q=substring pra search por nickname/externalId.

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { parsePagination, paginatedResponse } from '@/lib/pagination';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  const pagination = parsePagination(url, { defaultPageSize: 25, maxPageSize: 100 });

  const where: Prisma.AffiliateWhereInput = q
    ? {
        networkLink: null,
        OR: [
          { externalId: { contains: q, mode: 'insensitive' } },
          { nickname: { contains: q, mode: 'insensitive' } },
        ],
      }
    : { networkLink: null };

  const [affiliates, total] = await Promise.all([
    db.affiliate.findMany({
      where,
      orderBy: { lastOrderAt: 'desc' },
      skip: pagination.skip,
      take: pagination.take,
      include: {
        platform: { select: { slug: true, displayName: true } },
        _count: { select: { orders: true } },
      },
    }),
    db.affiliate.count({ where }),
  ]);

  const items = affiliates.map((a) => ({
    id: a.id,
    externalId: a.externalId,
    nickname: a.nickname,
    platformSlug: a.platform.slug,
    platformName: a.platform.displayName,
    ordersCount: a._count.orders,
    lastOrderAt: a.lastOrderAt?.toISOString() ?? null,
  }));

  // Backward-compat: top-level `affiliates` (UI antigo) + envelope `pagination`.
  const paged = paginatedResponse(items, total, pagination);
  return NextResponse.json({
    affiliates: paged.items,
    pagination: { page: paged.page, pageSize: paged.pageSize, total: paged.total, hasMore: paged.hasMore },
  });
}
