// GET /api/integrations/catalog — de-para de produto entre as plataformas.
//
// `productId`/`productName` no dump vêm CRUS da plataforma: o mesmo produto
// tem SKU diferente em cada uma, e o mesmo codinome às vezes aparece em
// produtos diferentes (ver memória da colisão BuyGoods). Quem agrupa é
// `family` — a família do catálogo, a mesma dimensão que o dashboard usa em
// todas as abas. Este endpoint entrega a tabela inteira pra um sistema
// parceiro usar os MESMOS códigos, em vez de montar um de-para paralelo.
//
//   ?family=NeuroMindPro   (opcional, filtra)
//   ?platform=jvzoo        (opcional, filtra)
//   ?verified=1            só SKUs com identidade confirmada por humano
//
// Auth: X-Api-Key de parceiro · bearer INGEST_SECRET · sessão ADMIN.

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requirePartnerRead } from '@/lib/auth/partnerKey';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requirePartnerRead(req);
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(req.url);
  const family = searchParams.get('family')?.trim();
  const platform = searchParams.get('platform')?.trim();
  const verifiedOnly = searchParams.get('verified') === '1';
  try {
    const where: Prisma.ProductWhereInput = {};
    if (family) where.family = family;
    if (platform) where.platform = { slug: platform };
    if (verifiedOnly) where.verified = true;
    const rows = await db.product.findMany({
      where,
      select: {
        externalId: true, name: true, family: true, variant: true, bottles: true, bonusBottles: true,
        productType: true, funnelPosition: true, verified: true, vendorAccount: true, niche: true,
        platform: { select: { slug: true } },
      },
      orderBy: [{ family: 'asc' }, { name: 'asc' }],
      take: 5000,
    });
    const produtos = rows.map((p) => ({
      plataforma: p.platform.slug,
      productId: p.externalId,
      productName: p.name,
      family: p.family,
      variante: p.variant,
      potes: p.bottles,
      potes_bonus: p.bonusBottles,
      etapa: p.productType,
      posicao_funil: p.funnelPosition,
      conta_vendedora: p.vendorAccount,
      nicho: p.niche,
      // false = família inferida pelo classificador, ainda não confirmada por
      // humano na fila do catálogo. Trate como provisória.
      verificado: p.verified,
    }));
    const familias = [...new Set(produtos.map((p) => p.family).filter(Boolean))].sort();
    return NextResponse.json({ count: produtos.length, familias, produtos });
  } catch (err) {
    logger.error({ err }, 'integrations/catalog failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
