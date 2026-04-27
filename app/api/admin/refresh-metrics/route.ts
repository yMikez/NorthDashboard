// Force-refresh the daily_metrics materialized view. Useful after bulk
// backfills (Order.productType, Product.family) or when investigating
// stale numbers in the dashboard. Gated by INGEST_SECRET like other admin
// endpoints.

import { NextResponse } from 'next/server';
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
    const t0 = Date.now();
    await refreshDailyMetricsNow();
    return NextResponse.json({ ok: true, durationMs: Date.now() - t0 });
  } catch (err) {
    logger.error({ err }, 'admin/refresh-metrics failed');
    return NextResponse.json(
      { error: 'refresh failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
