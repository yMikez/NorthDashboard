import { NextResponse } from 'next/server';
import { getFilterOptions } from '@/lib/services/filterOptions';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await getFilterOptions();
    return NextResponse.json(data);
  } catch (err) {
    logger.error({ err }, 'metrics/filters failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
