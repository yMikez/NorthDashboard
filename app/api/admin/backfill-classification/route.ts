// Admin endpoint to manually trigger product classification backfill.
// Useful when the startup backfill (Dockerfile CMD) failed silently or
// when adding new SKU patterns to the classifier and needing to re-run.
//
// Gated by INGEST_SECRET (same secret as N8N → /api/ingest/*) — pass via
// Authorization: Bearer <secret> header.

import { NextResponse } from 'next/server';
import { classifyExistingProducts } from '@/lib/services/classifyExistingProducts';
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
    const stats = await classifyExistingProducts();
    // Backfill mutated Product.family / Order.productType, which feeds the
    // MV — invalidate immediately so the next dashboard request sees fresh
    // numbers instead of waiting for the in-process staleness window.
    await refreshDailyMetricsNow();
    return NextResponse.json(stats);
  } catch (err) {
    logger.error({ err }, 'admin/backfill-classification failed');
    return NextResponse.json(
      { error: 'backfill failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
