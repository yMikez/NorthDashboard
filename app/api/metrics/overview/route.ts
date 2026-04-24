import { NextResponse } from 'next/server';
import { getOverview } from '@/lib/services/metrics';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
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
  if (startDate > endDate) {
    return NextResponse.json({ error: 'start_date must be <= end_date' }, { status: 400 });
  }

  const platformSlugs = csvParam(searchParams.get('platforms'));
  const countries = csvParam(searchParams.get('countries'));
  const productExternalIds = csvParam(searchParams.get('products'));
  const compare = searchParams.get('compare') === '1';

  try {
    const data = await getOverview(
      { startDate, endDate, platformSlugs, countries, productExternalIds },
      compare,
    );
    return NextResponse.json(data);
  } catch (err) {
    logger.error({ err }, 'metrics/overview failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}

function csvParam(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}
