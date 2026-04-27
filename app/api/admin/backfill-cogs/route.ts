// Admin endpoint to (re)compute Order.cogsUsd + fulfillmentUsd snapshots
// from current ProductFamilyCost / FulfillmentRate. Triggered after schema
// migration ran (initial backfill of historical orders) or after editing
// cost tables when you want history rewritten.
//
// Gated by INGEST_SECRET like other admin endpoints.

import { NextResponse } from 'next/server';
import { backfillCogs } from '@/lib/services/backfillCogs';
import { refreshDailyMetricsNow } from '@/lib/services/dailyMetrics';
import { checkIngestSecret } from '@/lib/ingest/auth';
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
    const stats = await backfillCogs();
    await refreshDailyMetricsNow();
    return NextResponse.json(stats);
  } catch (err) {
    logger.error({ err }, 'admin/backfill-cogs failed');
    return NextResponse.json(
      { error: 'failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
