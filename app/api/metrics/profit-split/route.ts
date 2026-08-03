// GET /api/metrics/profit-split — lucro FRONT (funil, modelo CPA) × BACK
// (recuperação/Tauk/SMS/SalesBound/email) na Visão Geral. Tab 'overview'.

import { NextResponse } from 'next/server';
import { requireTab } from '@/lib/auth/guard';
import { getProfitSplit } from '@/lib/services/profitSplit';
import { logger } from '@/lib/logger';
import { respondCached } from '@/lib/shared/metricsResponse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireTab('overview');
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

  // Filtros de ordem da UI (CSV) — mesmos nomes dos demais /api/metrics/*.
  const csv = (key: string) =>
    (searchParams.get(key) ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  const platformSlugs = csv('platforms');
  const productFamilies = csv('families');
  const countries = csv('countries');

  try {
    return await respondCached('profit-split', searchParams, () =>
      getProfitSplit({ startDate, endDate, platformSlugs, productFamilies, countries }));
  } catch (err) {
    logger.error({ err }, 'metrics/profit-split failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
