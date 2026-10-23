// GET /api/metrics/overview-panels — painéis da Visão geral que não vêm da
// daily_metrics (lib/services/overviewPanels.ts): receita por estágio de
// captação, reembolso dos últimos 60 dias (régua da aba Reembolsos) e as
// séries diárias de reembolso, Net after CPA e AOV por sessão.
// Mesmos filtros e mesma permissão do /api/metrics/overview.

import { NextResponse } from 'next/server';
import { getOverviewPanels } from '@/lib/services/overviewPanels';
import { requireTab } from '@/lib/auth/guard';
import { logger } from '@/lib/logger';
import { affiliateIdsParam, csvParam, stagesParam } from '@/lib/shared/queryParams';
import { respondCached } from '@/lib/shared/metricsResponse';
import { resolveAffiliateFilter } from '@/lib/shared/affiliateFilter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireTab('overview');
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(req.url);

  const startDate = new Date(searchParams.get('start_date') ?? '');
  const endDate = new Date(searchParams.get('end_date') ?? '');
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return NextResponse.json({ error: 'start_date and end_date are required (ISO 8601)' }, { status: 400 });
  }
  if (startDate > endDate) {
    return NextResponse.json({ error: 'start_date must be <= end_date' }, { status: 400 });
  }

  try {
    const affiliateIds = await resolveAffiliateFilter(searchParams.get('aff'));
    return await respondCached('overview-panels', searchParams, () => getOverviewPanels({
      startDate,
      endDate,
      platformSlugs: csvParam(searchParams.get('platforms')),
      countries: csvParam(searchParams.get('countries')),
      productExternalIds: csvParam(searchParams.get('products')),
      productFamilies: csvParam(searchParams.get('families')),
      productTypes: stagesParam(searchParams.get('stages')),
      mappedAffiliateIds: affiliateIdsParam(searchParams.get('affiliate_id')),
      affiliateIds,
    }));
  } catch (err) {
    logger.error({ err }, 'metrics/overview-panels failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
