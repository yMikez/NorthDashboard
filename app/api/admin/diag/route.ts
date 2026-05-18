// Diagnóstico read-only (bearer-gated). Por plataforma: amostra de
// produtos com name/externalId/family/bottles + contagem de orders com
// cogsUsd/fulfillmentUsd zerados. Usado pra investigar por que BuyGoods
// fica $0 em COGS+frete sem precisar de acesso direto ao DB de prod.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { classifyProduct } from '@/lib/services/productClassification';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  const token = auth?.replace(/^Bearer\s+/i, '') ?? null;
  if (!checkIngestSecret(token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const platformSlug = searchParams.get('platform') || 'buygoods';

  const products = await db.product.findMany({
    where: { platform: { slug: platformSlug } },
    select: {
      externalId: true,
      name: true,
      family: true,
      bottles: true,
      bonusBottles: true,
      productType: true,
      _count: { select: { orders: true } },
    },
    orderBy: { name: 'asc' },
    take: 60,
  });

  // Reroda o classifier AGORA em cada produto pra ver o que ele devolveria
  // (vs o que está gravado) — revela mismatch nome↔regex.
  const rows = products.map((p) => {
    const c = classifyProduct(p.externalId, p.name);
    return {
      externalId: p.externalId,
      name: p.name,
      stored: {
        family: p.family,
        bottles: p.bottles,
        bonusBottles: p.bonusBottles,
        productType: p.productType,
      },
      classifierNow: {
        family: c.family,
        bottles: c.bottles,
        bonusBottles: c.bonusBottles,
        type: c.type,
        funnelStep: c.funnelStep,
      },
      orders: p._count.orders,
    };
  });

  const [zeroCogs, zeroFulfill, totalOrders] = await Promise.all([
    db.order.count({
      where: { platform: { slug: platformSlug }, cogsUsd: 0 },
    }),
    db.order.count({
      where: { platform: { slug: platformSlug }, fulfillmentUsd: 0 },
    }),
    db.order.count({ where: { platform: { slug: platformSlug } } }),
  ]);

  return NextResponse.json({
    platform: platformSlug,
    productCount: products.length,
    orderCounts: { total: totalOrders, zeroCogs, zeroFulfillment: zeroFulfill },
    products: rows,
  });
}
