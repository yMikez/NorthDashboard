// Admin (bearer INGEST_SECRET): separa VENDA × ESTORNO nas linhas
// estornadas das plataformas in-place (CB/JVZoo/Cartpanda) a partir dos
// IngestLogs. Pré-requisito do cohort de reembolso. Idempotente.
//
//   POST /api/admin/backfill-refund-event-dates
//
// Ver lib/services/backfillRefundEventDates.ts pro racional completo.
// ATENÇÃO: move linhas estornadas do dia do ESTORNO pro dia da VENDA no
// eixo orderedAt (CB/JVZoo) — as séries diárias históricas dessas
// plataformas mudam de propósito, ficando consistentes com a Digistore.

import { NextResponse } from 'next/server';
import { backfillRefundEventDates } from '@/lib/services/backfillRefundEventDates';
import { refreshDailyMetricsNow } from '@/lib/services/dailyMetrics';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: Request) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  if (!checkIngestSecret(token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const stats = await backfillRefundEventDates();
    // orderedAt mudou em linhas estornadas → MV (bucket diário) stale.
    if (stats.updated > 0) await refreshDailyMetricsNow();
    logger.info(stats, 'admin/backfill-refund-event-dates done');
    return NextResponse.json(stats);
  } catch (err) {
    logger.error({ err }, 'admin/backfill-refund-event-dates failed');
    return NextResponse.json(
      { error: 'failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
