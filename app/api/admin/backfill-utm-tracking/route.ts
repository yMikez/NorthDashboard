// Admin endpoint: backfill de Order.trafficSource/campaignKey a partir do
// rawMetadata das orders Digistore que chegaram ANTES do conector mapear
// utm_source/utm_campaign (o IPN sempre mandou os UTMs; a gente só não
// persistia em coluna). Idempotente — só toca linha com a coluna vazia e
// UTM não-vazio no raw. Não mexe na daily_metrics MV (trafficSource não
// participa dela).
//
//   POST /api/admin/backfill-utm-tracking   (Bearer INGEST_SECRET)
//   → { trafficSourceFilled, campaignKeyFilled, smsbrdcstTotal }

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { SMS_UTM_SOURCE } from '@/lib/connectors/sms/config';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = req.headers.get('authorization');
  const token = auth?.replace(/^Bearer\s+/i, '') ?? null;
  if (!checkIngestSecret(token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const trafficSourceFilled = await db.$executeRaw`
      UPDATE "Order"
      SET "trafficSource" = NULLIF("rawMetadata"->>'utm_source', '')
      WHERE "trafficSource" IS NULL
        AND NULLIF("rawMetadata"->>'utm_source', '') IS NOT NULL
    `;
    const campaignKeyFilled = await db.$executeRaw`
      UPDATE "Order"
      SET "campaignKey" = NULLIF("rawMetadata"->>'utm_campaign', '')
      WHERE ("campaignKey" IS NULL OR "campaignKey" = '')
        AND NULLIF("rawMetadata"->>'utm_campaign', '') IS NOT NULL
    `;
    const smsbrdcstTotal = await db.order.count({
      where: { trafficSource: { equals: SMS_UTM_SOURCE, mode: 'insensitive' } },
    });

    logger.info({ trafficSourceFilled, campaignKeyFilled, smsbrdcstTotal }, 'backfill utm tracking done');
    return NextResponse.json({ trafficSourceFilled, campaignKeyFilled, smsbrdcstTotal });
  } catch (err) {
    logger.error({ err }, 'admin/backfill-utm-tracking failed');
    return NextResponse.json(
      { error: 'failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
