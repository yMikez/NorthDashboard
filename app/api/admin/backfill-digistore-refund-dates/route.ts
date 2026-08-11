// Admin (bearer INGEST_SECRET): reconstrói refundedAt/chargebackAt das
// linhas de estorno da Digistore a partir do rawMetadata. Idempotente.
//
//   POST /api/admin/backfill-digistore-refund-dates
//
// Ver lib/services/backfillDigistoreRefundDates.ts pro porquê.

import { NextResponse } from 'next/server';
import { backfillDigistoreRefundDates } from '@/lib/services/backfillDigistoreRefundDates';
import { clearResponseCache } from '@/lib/cache/responseCache';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  if (!checkIngestSecret(token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const stats = await backfillDigistoreRefundDates();
    // refundedAt/chargebackAt não entram na MV (que bucketiza por orderedAt),
    // mas os cards de reembolso leem por esse eixo e passam pelo cache de
    // resposta — invalidar pra mudança aparecer na hora.
    clearResponseCache();
    return NextResponse.json(stats);
  } catch (err) {
    logger.error({ err }, 'admin/backfill-digistore-refund-dates failed');
    return NextResponse.json(
      { error: 'failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
