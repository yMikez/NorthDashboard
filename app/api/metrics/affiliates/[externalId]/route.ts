import { NextResponse } from 'next/server';
import { getAffiliateDetail } from '@/lib/services/metrics';
import { requireAnyTab } from '@/lib/auth/guard';
import { getCachedResponse, setCachedResponse } from '@/lib/cache/responseCache';
import { logger } from '@/lib/logger';
import { csvParam, stagesParam } from '@/lib/shared/queryParams';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ externalId: string }> },
) {
  const auth = await requireAnyTab(['leaderboard', 'all-affiliates']);
  if (!auth.ok) return auth.response;
  const { externalId } = await params;
  if (!externalId) {
    return NextResponse.json({ error: 'externalId is required' }, { status: 400 });
  }

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
  const platformHint = searchParams.get('platform') ?? undefined;

  try {
    // Cache manual (não usa respondCached): o caminho 404 não pode ser
    // cacheado nem virar erro — só respostas 200 entram no cache.
    const cacheKey = `affiliates/${externalId}?${searchParams.toString()}`;
    const cached = getCachedResponse(cacheKey);
    if (cached !== undefined) return NextResponse.json(cached);

    const t0 = Date.now();
    const data = await getAffiliateDetail(
      decodeURIComponent(externalId),
      { startDate, endDate, platformSlugs, countries, productExternalIds, productFamilies, productTypes },
      platformHint,
    );
    if (!data) {
      return NextResponse.json({ error: 'affiliate not found' }, { status: 404 });
    }
    setCachedResponse(cacheKey, data);
    logger.info({ endpoint: 'affiliates/[externalId]', ms: Date.now() - t0 }, 'metrics.timing');
    return NextResponse.json(data);
  } catch (err) {
    logger.error({ err }, 'metrics/affiliates/[externalId] failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
