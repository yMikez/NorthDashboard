// GET /api/metrics/sms — aba SMS (saúde da stack Mautic → n8n → Twilio).
// Tab-gated ('sms'). Mesmo contrato de datas dos demais /api/metrics/*,
// mais filtros opcionais `brand` e `campaign` (slug).

import { NextResponse } from 'next/server';
import { requireTab } from '@/lib/auth/guard';
import { getSms } from '@/lib/services/sms';
import { logger } from '@/lib/logger';
import { respondCached } from '@/lib/shared/metricsResponse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireTab('sms');
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
  const brand = searchParams.get('brand');
  const campaign = searchParams.get('campaign');

  try {
    return await respondCached('sms', searchParams, () => getSms({ startDate, endDate, brand, campaign }));
  } catch (err) {
    logger.error({ err }, 'metrics/sms failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
