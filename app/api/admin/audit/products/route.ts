import { NextResponse } from 'next/server';
import { auditProducts } from '@/lib/services/auditProducts';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Admin diagnostic: audit how products are being classified across orders.
 * Gated by INGEST_SECRET (same secret as N8N → /api/ingest/*).
 *
 * Optional query params: start_date, end_date (ISO 8601). If omitted, audits
 * the entire dataset.
 */
export async function GET(req: Request) {
  if (!checkIngestSecret(req.headers.get('x-ingest-secret'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const startRaw = searchParams.get('start_date');
  const endRaw = searchParams.get('end_date');

  let startDate: Date | undefined;
  let endDate: Date | undefined;
  if (startRaw && endRaw) {
    startDate = new Date(startRaw);
    endDate = new Date(endRaw);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return NextResponse.json({ error: 'invalid date format' }, { status: 400 });
    }
  }

  try {
    const data = await auditProducts(startDate, endDate);
    return NextResponse.json(data);
  } catch (err) {
    logger.error({ err }, 'admin/audit/products failed');
    return NextResponse.json({ error: 'audit failed' }, { status: 500 });
  }
}
