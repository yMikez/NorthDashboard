import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { parseClickBankIngest } from '@/lib/connectors/clickbank/ingest';
import type { ClickBankIngestPayload } from '@/lib/connectors/clickbank/types';
import { upsertOrder } from '@/lib/services/upsertOrder';
import { logger, maskEmail } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!checkIngestSecret(req.headers.get('x-ingest-secret'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const rawBody = await req.text();
  let payload: ClickBankIngestPayload;
  try {
    payload = JSON.parse(rawBody) as ClickBankIngestPayload;
  } catch (err) {
    logger.warn({ err }, 'clickbank ingest: invalid JSON');
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const log = await db.ingestLog.create({
    data: {
      source: 'n8n-clickbank',
      platformSlug: 'clickbank',
      eventType: payload.transactionType ?? 'unknown',
      externalId: payload.receipt ?? null,
      payload: payload as unknown as object,
      signatureOk: null,
    },
    select: { id: true },
  });

  try {
    const normalized = parseClickBankIngest(payload);
    const result = await upsertOrder(normalized);

    await db.ingestLog.update({
      where: { id: log.id },
      data: { processedOk: true, processedAt: new Date() },
    });

    logger.info(
      {
        platform: 'clickbank',
        externalId: normalized.externalId,
        status: normalized.status,
        created: result.created,
        customerEmail: maskEmail(normalized.customerEmail),
      },
      'clickbank ingest ok',
    );

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.ingestLog.update({
      where: { id: log.id },
      data: { error: message, processedAt: new Date() },
    });
    logger.error({ err, logId: log.id }, 'clickbank ingest failed');
    return NextResponse.json({ error: 'processing failed' }, { status: 500 });
  }
}
