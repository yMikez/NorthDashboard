// Fulfillment overview: distribuição de pedidos APPROVED entre RedRock e
// ShipOffers no período (respeita filtros padrão start/end + platforms +
// countries + products + families). Supplier é resolvido on-the-fly por
// SKU/família, então mudanças no cadastro refletem na hora.

import { NextResponse } from 'next/server';
import { getFulfillmentOverview } from '@/lib/services/metrics';
import { requireTab } from '@/lib/auth/guard';
import { logger } from '@/lib/logger';
import { csvParam, stagesParam } from '@/lib/shared/queryParams';
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
    return await respondCached('fulfillment-overview', searchParams, () => getFulfillmentOverview({
      startDate, endDate, platformSlugs, countries, productExternalIds, productFamilies, productTypes,
    }));
  } catch (err) {
    logger.error({ err }, 'metrics/fulfillment-overview failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
