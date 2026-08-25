// Dump bruto das ordens de uma plataforma num intervalo — pra reconciliação
// com exports do painel (JVZoo/Digistore/etc.) feita fora do dashboard.
//
//   GET /api/admin/orders-dump?platform=jvzoo&start=YYYY-MM-DD&end=YYYY-MM-DD
//   Auth: bearer INGEST_SECRET (curl) OU sessão ADMIN.
//   Datas em BRT (dia inteiro). Limite duro de 50k linhas.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const BRT = 3 * 3600 * 1000;

export async function GET(req: Request) {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  if (!(bearer && checkIngestSecret(bearer))) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
  }
  const { searchParams } = new URL(req.url);
  const platform = (searchParams.get('platform') ?? '').trim();
  const start = searchParams.get('start') ?? '';
  const end = searchParams.get('end') ?? '';
  if (!platform || !YMD.test(start) || !YMD.test(end)) {
    return NextResponse.json({ error: 'platform, start e end (YYYY-MM-DD) obrigatórios' }, { status: 400 });
  }
  const startDate = new Date(new Date(start + 'T00:00:00Z').getTime() + BRT);
  const endDate = new Date(new Date(end + 'T23:59:59.999Z').getTime() + BRT);
  const rows = await db.order.findMany({
    where: { platform: { slug: platform }, orderedAt: { gte: startDate, lte: endDate } },
    orderBy: { orderedAt: 'asc' },
    take: 50_000,
    select: {
      externalId: true, parentExternalId: true, funnelSessionId: true, status: true, productType: true,
      grossAmountUsd: true, netAmountUsd: true, cpaPaidUsd: true, orderedAt: true, refundedAt: true, chargebackAt: true,
      country: true,
      product: { select: { externalId: true, name: true, family: true } },
      affiliate: { select: { externalId: true, nickname: true } },
      customer: { select: { email: true } },
    },
  });
  return NextResponse.json({
    platform, start, end, count: rows.length, truncated: rows.length >= 50_000,
    orders: rows.map((o) => ({
      externalId: o.externalId, parentExternalId: o.parentExternalId, sessionId: o.funnelSessionId,
      status: o.status, productType: o.productType,
      gross: Number(o.grossAmountUsd), net: Number(o.netAmountUsd), cpa: Number(o.cpaPaidUsd),
      orderedAt: o.orderedAt.toISOString(), refundedAt: o.refundedAt?.toISOString() ?? null, chargebackAt: o.chargebackAt?.toISOString() ?? null,
      country: o.country,
      productId: o.product.externalId, productName: o.product.name, family: o.product.family,
      affiliateId: o.affiliate?.externalId ?? null, affiliateName: o.affiliate?.nickname ?? null,
      customerEmail: o.customer?.email ?? null,
    })),
  });
}
