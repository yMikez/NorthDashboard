// GET /api/metrics/recovery — seção Recuperação. Vendas trazidas por afiliados
// de recuperação no período + comissão devida. Tab-gated (recovery).

import { NextResponse } from 'next/server';
import { requireTab } from '@/lib/auth/guard';
import { getRecovery } from '@/lib/services/recovery';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireTab('recovery');
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
    const data = await getRecovery({ startDate, endDate });
    return NextResponse.json(data);
  } catch (err) {
    logger.error({ err }, 'metrics/recovery failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
