// GET /api/metrics/tauk — aba Tauk (vendas recuperadas pela Tauk Solutions).
// Tab-gated ('tauk'). Mesmo contrato de datas dos demais /api/metrics/*.

import { NextResponse } from 'next/server';
import { requireTab } from '@/lib/auth/guard';
import { getTauk } from '@/lib/services/tauk';
import { logger } from '@/lib/logger';
import { respondCached } from '@/lib/shared/metricsResponse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireTab('tauk');
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const startRaw = searchParams.get('start_date');
  const endRaw = searchParams.get('end_date');
  if (!startRaw || !endRaw) {
    return NextResponse.json({ error: 'start_date and end_date are required' }, { status: 400 });
  }
  const startDate = new Date(startRaw);
  const endDate = new Date(endRaw);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return NextResponse.json({ error: 'invalid date format' }, { status: 400 });
  }

  try {
    return await respondCached('tauk', searchParams, () => getTauk({ startDate, endDate }));
  } catch (err) {
    logger.error({ err }, 'metrics/tauk failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
