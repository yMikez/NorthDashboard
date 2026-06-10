import { NextResponse } from 'next/server';
import { getCostsOverview } from '@/lib/services/metrics';
import { requireAnyTab } from '@/lib/auth/guard';
import { logger } from '@/lib/logger';
import { csvParam, stagesParam } from '@/lib/shared/queryParams';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // 'custos' (dashboard agregado) ou 'costs' (aba Fulfillment) — ambas
  // consomem esse endpoint pra ter número de frete consistente.
  const auth = await requireAnyTab(['custos', 'costs']);
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(req.url);

  const startRaw = searchParams.get('start_date');
  const endRaw = searchParams.get('end_date');
  if (!startRaw || !endRaw) {
    return NextResponse.json(
      { error: 'start_date and end_date are required (ISO 8601)' },
      { status: 400 },
    );
  }
  const startDate = new Date(startRaw);
  const endDate = new Date(endRaw);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return NextResponse.json({ error: 'invalid date format' }, { status: 400 });
  }

  const platformSlugs = csvParam(searchParams.get('platforms'));
  const countries = csvParam(searchParams.get('countries'));
  const productExternalIds = csvParam(searchParams.get('products'));
  const productFamilies = csvParam(searchParams.get('families'));
  const productTypes = stagesParam(searchParams.get('stages'));

  try {
    const data = await getCostsOverview({
      startDate, endDate, platformSlugs, countries, productExternalIds, productFamilies, productTypes,
    });
    return NextResponse.json(data);
  } catch (err) {
    logger.error({ err }, 'metrics/costs-overview failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
