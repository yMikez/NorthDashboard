// Admin (bearer INGEST_SECRET): reconcilia os estornos da Digistore contra
// o export do painel. Idempotente — rodar de novo com um export novo só
// pega o que faltar.
//
//   POST /api/admin/reconcile-digistore-refunds        → dry-run (só lê)
//   POST /api/admin/reconcile-digistore-refunds?apply=1 → cria o que falta
//
//   body: { "rows": [ { transactionId, orderId, date, time, ... }, ... ] }
//
// O cliente é scripts/reconcileDigistoreRefunds.mjs, que fatia o CSV em
// lotes. Ver lib/services/reconcileDigistoreRefunds.ts pro diagnóstico que
// motivou isso (estornos executados pelas contas Tauk* não disparam IPN).

import { NextResponse } from 'next/server';
import {
  reconcileDigistoreRefunds,
  type DigistoreRefundCsvRow,
} from '@/lib/services/reconcileDigistoreRefunds';
import { refreshDailyMetricsNow } from '@/lib/services/dailyMetrics';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_ROWS_PER_CALL = 1000;

export async function POST(req: Request) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  if (!checkIngestSecret(token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const apply = new URL(req.url).searchParams.get('apply') === '1';

  let rows: DigistoreRefundCsvRow[];
  try {
    const body = (await req.json()) as { rows?: unknown };
    if (!Array.isArray(body.rows)) throw new Error('body.rows precisa ser um array');
    if (body.rows.length > MAX_ROWS_PER_CALL) {
      throw new Error(`lote grande demais (${body.rows.length}); máximo ${MAX_ROWS_PER_CALL}`);
    }
    rows = body.rows as DigistoreRefundCsvRow[];
  } catch (err) {
    return NextResponse.json(
      { error: 'bad request', message: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  try {
    const stats = await reconcileDigistoreRefunds(rows, apply);
    // Linhas novas mudam contagem/valor de estorno por dia → MV stale.
    if (stats.created > 0) await refreshDailyMetricsNow();
    logger.info({ apply, ...stats, sampleMissing: undefined, errors: undefined },
      'admin/reconcile-digistore-refunds');
    return NextResponse.json({ apply, ...stats });
  } catch (err) {
    logger.error({ err }, 'admin/reconcile-digistore-refunds failed');
    return NextResponse.json(
      { error: 'failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
