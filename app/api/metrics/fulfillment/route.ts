// GET /api/metrics/fulfillment — aba Fulfillment reformulada (enviado /
// gasto / mix de brackets / projeções). Tab-gated ('costs'). Mesmo contrato
// de datas + filtros de dimensão dos demais /api/metrics/*.

import { NextResponse } from 'next/server';
import { requireTab } from '@/lib/auth/guard';
import { getFulfillment } from '@/lib/services/fulfillment';
import { logger } from '@/lib/logger';
import { csvParam } from '@/lib/shared/queryParams';
import { respondCached } from '@/lib/shared/metricsResponse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireTab('costs');
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

  const platformSlugs = csvParam(searchParams.get('platforms'));
  const countries = csvParam(searchParams.get('countries'));
  const productFamilies = csvParam(searchParams.get('families'));

  try {
    return await respondCached('fulfillment', searchParams, () =>
      getFulfillment({ startDate, endDate, platformSlugs, countries, productFamilies }));
  } catch (err) {
    logger.error({ err }, 'metrics/fulfillment failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
