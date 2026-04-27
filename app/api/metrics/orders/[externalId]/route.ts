import { NextResponse } from 'next/server';
import { getOrderDetail } from '@/lib/services/metrics';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ externalId: string }> },
) {
  const { externalId } = await params;
  if (!externalId) {
    return NextResponse.json({ error: 'externalId is required' }, { status: 400 });
  }
  const { searchParams } = new URL(req.url);
  // Optional disambiguation when the same externalId exists on both
  // platforms (rare but possible — CB receipts and D24 transaction_ids
  // are independent ID spaces).
  const platformSlug = searchParams.get('platform') ?? undefined;

  try {
    const data = await getOrderDetail(decodeURIComponent(externalId), platformSlug);
    if (!data) {
      return NextResponse.json({ error: 'order not found' }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (err) {
    logger.error({ err }, 'metrics/orders/[externalId] failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
