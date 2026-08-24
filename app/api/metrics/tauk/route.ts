// GET /api/metrics/tauk — aba "Call Center" (Tauk + Logicall). O path e o
// id da tab ('tauk') ficaram de propósito: permissões dos usuários já
// apontam pra ele. Mesmo contrato de datas dos demais /api/metrics/*.
//   ?provider=all|tauk|logicall (default all)

import { NextResponse } from 'next/server';
import { requireTab } from '@/lib/auth/guard';
import { getCallCenterSales } from '@/lib/services/callCenterSales';
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
  const providerRaw = searchParams.get('provider') ?? 'all';
  const provider = providerRaw === 'tauk' || providerRaw === 'logicall' ? providerRaw : 'all';

  try {
    return await respondCached('tauk', searchParams, () =>
      getCallCenterSales({ startDate, endDate, provider }),
    );
  } catch (err) {
    logger.error({ err }, 'metrics/tauk (call center) failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
