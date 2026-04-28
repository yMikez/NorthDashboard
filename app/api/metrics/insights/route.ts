// Read-only insights endpoint. No filters — insights are a fixed-window
// (last 30d) daily snapshot. Cached server-side per calendar day.
//
// Pass ?refresh=1 to force a recompute (useful for testing).

import { NextResponse } from 'next/server';
import { getInsights } from '@/lib/services/insights';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const force = searchParams.get('refresh') === '1';
  try {
    const data = await getInsights(force);
    return NextResponse.json(data);
  } catch (err) {
    logger.error({ err }, 'metrics/insights failed');
    return NextResponse.json({ error: 'failed', message: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
