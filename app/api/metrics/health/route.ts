import { NextResponse } from 'next/server';
import { getHealth } from '@/lib/services/health';
import { requireTab } from '@/lib/auth/guard';
import { logger } from '@/lib/logger';
import { respondCached } from '@/lib/shared/metricsResponse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireTab('health');
  if (!auth.ok) return auth.response;
  try {
    return await respondCached('health', new URL(req.url).searchParams, () =>
      getHealth(),
    );
  } catch (err) {
    logger.error({ err }, 'metrics/health failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
