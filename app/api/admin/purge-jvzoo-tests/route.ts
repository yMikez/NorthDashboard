// POST /api/admin/purge-jvzoo-tests  (Bearer INGEST_SECRET)
//   Body opcional: { "dryRun": true }
//
// Remove as compras-TESTE do vendor na JVZoo: funil inteiro a exatamente
// $1 (|grossAmountUsd| == 1). O ingest passou a pular essas linhas na
// entrada (2026-08-07) — este endpoint limpa o legado. IngestLogs ficam
// (auditoria). Depois do delete: refresh da MV + cache limpo, pra tirar
// os testes das métricas na hora.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { refreshDailyMetricsNow } from '@/lib/services/dailyMetrics';
import { clearResponseCache } from '@/lib/cache/responseCache';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  if (!checkIngestSecret(token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let dryRun = false;
  try {
    const body = (await req.json()) as { dryRun?: boolean };
    dryRun = body?.dryRun === true;
  } catch {
    // sem body = execução real
  }

  const platform = await db.platform.findUnique({ where: { slug: 'jvzoo' }, select: { id: true } });
  if (!platform) {
    return NextResponse.json({ error: 'plataforma jvzoo não existe' }, { status: 404 });
  }

  const where = {
    platformId: platform.id,
    grossAmountUsd: { in: [1, -1] },
  };

  const rows = await db.order.findMany({
    where,
    select: { externalId: true, productType: true, status: true, orderedAt: true, funnelSessionId: true },
    orderBy: { orderedAt: 'asc' },
  });

  let deleted = 0;
  if (!dryRun && rows.length > 0) {
    const res = await db.order.deleteMany({ where });
    deleted = res.count;
    await refreshDailyMetricsNow();
    clearResponseCache();
  }

  const summary = {
    ok: true,
    dryRun,
    matched: rows.length,
    deleted,
    sessions: new Set(rows.map((r) => r.funnelSessionId)).size,
    sample: rows.slice(0, 10).map((r) => ({
      externalId: r.externalId,
      type: r.productType,
      status: r.status,
      day: r.orderedAt.toISOString().slice(0, 10),
    })),
  };
  logger.info(summary, 'purge-jvzoo-tests done');
  return NextResponse.json(summary);
}
