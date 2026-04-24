import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { parseDigistoreIngest } from '@/lib/connectors/digistore24/ingest';
import { verifyDigistoreSignature } from '@/lib/connectors/digistore24/signature';
import type { DigistorePayload } from '@/lib/connectors/digistore24/types';
import { upsertOrder } from '@/lib/services/upsertOrder';
import { logger, maskEmail } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!checkIngestSecret(req.headers.get('x-ingest-secret'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const rawBody = await req.text();
  const params = parseFormUrlEncoded(rawBody);

  const event = params.event ?? 'unknown';
  const signature = verifyDigistoreSignature(params, process.env.DIGISTORE24_IPN_PASSPHRASE);

  const signatureOk = signature === 'VALID' ? true : signature === 'INVALID' ? false : null;

  const log = await db.ingestLog.create({
    data: {
      source: 'n8n-digistore24',
      platformSlug: 'digistore24',
      eventType: event,
      externalId: params.transaction_id ?? null,
      payload: params as unknown as object,
      signatureOk,
    },
    select: { id: true },
  });

  if (signature === 'INVALID') {
    await db.ingestLog.update({
      where: { id: log.id },
      data: { error: 'invalid sha_sign', processedAt: new Date() },
    });
    logger.warn(
      { logId: log.id, transactionId: params.transaction_id },
      'digistore24 sha_sign invalid',
    );
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  if (event === 'connection_test') {
    await db.ingestLog.update({
      where: { id: log.id },
      data: { processedOk: true, processedAt: new Date() },
    });
    logger.info({ signature, apiMode: params.api_mode }, 'digistore24 connection_test received');
    return NextResponse.json({ ok: true, event: 'connection_test', signature });
  }

  try {
    const normalized = parseDigistoreIngest(params);
    const result = await upsertOrder(normalized);

    await db.ingestLog.update({
      where: { id: log.id },
      data: { processedOk: true, processedAt: new Date() },
    });

    logger.info(
      {
        platform: 'digistore24',
        externalId: normalized.externalId,
        status: normalized.status,
        created: result.created,
        signature,
        customerEmail: maskEmail(normalized.customerEmail),
      },
      'digistore24 ingest ok',
    );

    return NextResponse.json({ ok: true, ...result, signature });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.ingestLog.update({
      where: { id: log.id },
      data: { error: message, processedAt: new Date() },
    });
    logger.error({ err, logId: log.id }, 'digistore24 ingest failed');
    return NextResponse.json({ error: 'processing failed' }, { status: 500 });
  }
}

function parseFormUrlEncoded(body: string): DigistorePayload {
  const params = new URLSearchParams(body);
  const out: DigistorePayload = {};
  for (const [key, value] of params.entries()) {
    out[key] = value;
  }
  return out;
}
