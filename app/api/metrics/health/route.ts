import { NextResponse } from 'next/server';
import { getHealth } from '@/lib/services/health';
import { requireTab } from '@/lib/auth/guard';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireTab('health');
  if (!auth.ok) return auth.response;
  try {
    const data = await getHealth();
    return NextResponse.json(data);
  } catch (err) {
    logger.error({ err }, 'metrics/health failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
