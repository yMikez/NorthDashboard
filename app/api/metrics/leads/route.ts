// GET /api/metrics/leads — aba Leads (lib/services/leads.ts). Tab-gated (leads).
//
//   ?start_date&end_date             → 1ª compra do lead no período (origem)
//   ?platforms&families&countries&aff → filtros da origem (mesmos do dash)
//   ?segment=all|repeat|single|multichannel|callcenter|salesbound|refunded
//   ?sort=ltv|recent|new|purchases|refunds   ?page=1   ?group=channel|platform|affiliate|family|country
//   ?q=texto                         → busca e-mail/nome em TODOS os leads (ignora filtros)

import { NextResponse } from 'next/server';
import { requireTab } from '@/lib/auth/guard';
import { getLeads, LEAD_GROUPS, LEAD_SEGMENTS, LEAD_SORTS, type LeadGroup, type LeadSegment, type LeadSort } from '@/lib/services/leads';
import { logger } from '@/lib/logger';
import { csvParam } from '@/lib/shared/queryParams';
import { respondCached } from '@/lib/shared/metricsResponse';
import { resolveAffiliateFilter } from '@/lib/shared/affiliateFilter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function oneOf<T extends string>(list: readonly T[], raw: string | null, fallback: T): T {
  return raw && (list as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

export async function GET(req: Request) {
  const auth = await requireTab('leads');
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(req.url);

  const startDate = new Date(searchParams.get('start_date') ?? '');
  const endDate = new Date(searchParams.get('end_date') ?? '');
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return NextResponse.json({ error: 'start_date and end_date are required (ISO 8601)' }, { status: 400 });
  }

  try {
    const affiliateIds = await resolveAffiliateFilter(searchParams.get('aff'));
    return await respondCached('leads', searchParams, () => getLeads({
      startDate,
      endDate,
      platforms: csvParam(searchParams.get('platforms')),
      families: csvParam(searchParams.get('families')),
      countries: csvParam(searchParams.get('countries')),
      affiliateIds,
      segment: oneOf<LeadSegment>(LEAD_SEGMENTS, searchParams.get('segment'), 'all'),
      sort: oneOf<LeadSort>(LEAD_SORTS, searchParams.get('sort'), 'ltv'),
      groupBy: oneOf<LeadGroup>(LEAD_GROUPS, searchParams.get('group'), 'channel'),
      page: Number.parseInt(searchParams.get('page') ?? '1', 10) || 1,
      q: (searchParams.get('q') ?? '').slice(0, 120),
    }));
  } catch (err) {
    logger.error({ err }, 'metrics/leads failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
