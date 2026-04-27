// Admin endpoint to backfill Digistore Order.parentExternalId values that
// were set per-step (wrong) before the deriveBaseOrderId fix landed.
// Idempotent — safe to call multiple times. Triggers MV refresh after.

import { NextResponse } from 'next/server';
import { backfillDigistoreParents } from '@/lib/services/backfillDigistoreParents';
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
    const stats = await backfillDigistoreParents();
    // parentExternalId doesn't appear in daily_metrics directly, but
    // refreshing keeps any cross-cutting metrics current.
    await refreshDailyMetricsNow();
    return NextResponse.json(stats);
  } catch (err) {
    logger.error({ err }, 'admin/backfill-digistore-parents failed');
    return NextResponse.json(
      { error: 'failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
