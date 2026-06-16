// POST /api/admin/backfill-cartpanda-fx
//
// Re-processa os webhooks Cartpanda gravados no IngestLog com o parser atual,
// corrigindo pedidos que entraram com valor em BRL exibido como USD (antes do
// fix de conversão de moeda). Idempotente: upsertOrder casa pelo externalId
// estável e só ATUALIZA os valores. Bearer INGEST_SECRET.
//
// Dispara refresh da MV ao fim pra os números corrigidos aparecerem já.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { parseCartpandaWebhook } from '@/lib/connectors/cartpanda/ingest';
import type { CartpandaWebhook } from '@/lib/connectors/cartpanda/types';
import { upsertOrder } from '@/lib/services/upsertOrder';
import { refreshDailyMetricsNow } from '@/lib/services/dailyMetrics';
import { clearResponseCache } from '@/lib/cache/responseCache';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = req.headers.get('authorization');
  const token = auth?.replace(/^Bearer\s+/i, '') ?? null;
  if (!checkIngestSecret(token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const logs = await db.ingestLog.findMany({
      where: { platformSlug: 'cartpanda', processedOk: true },
      select: { id: true, payload: true },
      orderBy: { receivedAt: 'asc' },
    });

    let webhooks = 0;
    let orders = 0;
    let skipped = 0;
    let errors = 0;

    for (const log of logs) {
      const wh = log.payload as unknown as CartpandaWebhook;
      // Só re-processa o formato webhook ({ event, order, line_items }).
      // Pings de teste / payloads antigos do postback flat são pulados.
      if (!wh || typeof wh !== 'object' || !wh.order || wh.order.id == null || Number(wh.order.test) === 1) {
        skipped++;
        continue;
      }
      try {
        const normalized = parseCartpandaWebhook(wh);
        for (const n of normalized) {
          await upsertOrder(n);
          orders++;
        }
        webhooks++;
      } catch (err) {
        errors++;
        logger.warn({ err, logId: log.id }, 'backfill-cartpanda-fx: skip log');
      }
    }

    clearResponseCache();
    await refreshDailyMetricsNow();

    logger.info({ webhooks, orders, skipped, errors }, 'backfill-cartpanda-fx done');
    return NextResponse.json({ ok: true, scanned: logs.length, webhooks, orders, skipped, errors });
  } catch (err) {
    logger.error({ err }, 'admin/backfill-cartpanda-fx failed');
    return NextResponse.json(
      { error: 'failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
