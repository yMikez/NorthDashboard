// GET /api/admin/diag-refunds?platform=digistore24&days=90  (Bearer INGEST_SECRET)
//
// Diagnóstico READ-ONLY da contabilidade de refunds. Responde à pergunta:
// o evento de refund ATUALIZA a venda original ou CRIA uma linha nova?
//
// Digistore manda o refund com transaction_id NOVO + parent_transaction_id
// apontando pra venda. Como o connector usa transaction_id como externalId,
// a suspeita é que cada refund vira uma linha extra (denominador inflado) e
// a venda original fica APPROVED pra sempre.
//
// Retorna, por plataforma: contagem por status, e uma amostra de pedidos
// REFUNDED com o status do "irmão" (a venda apontada por
// rawMetadata.parent_transaction_id).

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { checkIngestSecret } from '@/lib/ingest/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  if (!checkIngestSecret(token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const slug = searchParams.get('platform') || 'digistore24';
  const days = Math.min(Math.max(parseInt(searchParams.get('days') ?? '90', 10) || 90, 1), 400);
  const since = new Date(Date.now() - days * 86_400_000);

  const platform = await db.platform.findUnique({ where: { slug }, select: { id: true } });
  if (!platform) return NextResponse.json({ error: 'plataforma não encontrada' }, { status: 404 });

  const byStatus = await db.order.groupBy({
    by: ['status'],
    where: { platformId: platform.id, orderedAt: { gte: since } },
    _count: { _all: true },
    _sum: { grossAmountUsd: true },
  });

  // Amostra de refunds/chargebacks: o irmão (venda original) ainda está
  // APPROVED? Se sim, o refund virou linha EXTRA em vez de atualizar.
  const refunds = await db.order.findMany({
    where: {
      platformId: platform.id,
      orderedAt: { gte: since },
      status: { in: ['REFUNDED', 'CHARGEBACK'] },
    },
    orderBy: { orderedAt: 'desc' },
    take: 40,
    select: {
      externalId: true, status: true, orderedAt: true,
      grossAmountUsd: true, eventType: true, rawMetadata: true,
    },
  });

  const parentIds = refunds
    .map((r) => (r.rawMetadata as Record<string, unknown> | null)?.parent_transaction_id)
    .filter((v): v is string => typeof v === 'string' && v.length > 0);

  const siblings = parentIds.length
    ? await db.order.findMany({
        where: { platformId: platform.id, externalId: { in: parentIds } },
        select: { externalId: true, status: true, grossAmountUsd: true, orderedAt: true },
      })
    : [];
  const siblingByExt = new Map(siblings.map((s) => [s.externalId, s]));

  let refundIsExtraRow = 0;
  let refundUpdatedInPlace = 0;
  const sample = refunds.map((r) => {
    const raw = r.rawMetadata as Record<string, unknown> | null;
    const parentId = typeof raw?.parent_transaction_id === 'string' ? raw.parent_transaction_id : null;
    const sib = parentId ? siblingByExt.get(parentId) : undefined;
    if (sib) refundIsExtraRow++;
    else refundUpdatedInPlace++;
    return {
      refundExternalId: r.externalId,
      refundStatus: r.status,
      refundEventType: r.eventType,
      refundGross: Number(r.grossAmountUsd),
      refundOrderedAt: r.orderedAt.toISOString().slice(0, 10),
      originalTxFromPayload: parentId,
      siblingExists: Boolean(sib),
      siblingStatus: sib?.status ?? null,
      siblingGross: sib ? Number(sib.grossAmountUsd) : null,
    };
  });

  return NextResponse.json({
    platform: slug,
    windowDays: days,
    byStatus: byStatus.map((s) => ({
      status: s.status,
      count: s._count._all,
      grossSum: s._sum.grossAmountUsd ? Number(s._sum.grossAmountUsd) : 0,
    })),
    verdict: {
      sampled: sample.length,
      // Linha extra = existe uma venda separada (o "irmão") ainda no banco.
      refundIsExtraRow,
      refundUpdatedInPlace,
    },
    sample,
  });
}
