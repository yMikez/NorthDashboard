// POST /api/ingest/jvzoo
//
// Recebe o webhook JVZoo proxied via n8n (workflow northscale-jvzoo):
// o n8n re-encoda o body como form-urlencoded e manda com x-ingest-secret.
// A validação do cverify (SHA-1 + secret JVZoo) fica upstream por decisão —
// mesmo modelo ClickBank/BuyGoods: aqui só o shared secret conta.
//
// transaction_type suportados: SALE, BILL (rebill), RFND, CGBK, INSF,
// CANCEL-REBILL, UNCANCEL-REBILL (+ TEST do botão do painel, que só loga).

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { parseJvzooIngest } from '@/lib/connectors/jvzoo/ingest';
import type { JvzooPayload } from '@/lib/connectors/jvzoo/types';
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

  const action = (params.transaction_type ?? 'unknown').toLowerCase();

  const log = await db.ingestLog.create({
    data: {
      source: 'n8n-jvzoo',
      platformSlug: 'jvzoo',
      eventType: action,
      externalId: params.transaction_id ?? null,
      payload: params as unknown as object,
      // cverify não é validado aqui (upstream trust) — null em vez de bool.
      signatureOk: null,
    },
    select: { id: true },
  });

  // Botão de teste do painel JVZoo (ou ping manual): registra, MATERIALIZA
  // a plataforma no dashboard (card em Plataformas + filtros — feedback
  // imediato de "conectado", sem esperar a 1ª venda real) e responde OK.
  // Sem criar pedido: só o registro da Platform.
  if (action === 'test' || action === 'connection_test') {
    await db.platform.upsert({
      where: { slug: 'jvzoo' },
      create: { slug: 'jvzoo', displayName: 'JVZoo' },
      update: {},
    });
    await db.ingestLog.update({
      where: { id: log.id },
      data: { processedOk: true, processedAt: new Date() },
    });
    logger.info({ platform: 'jvzoo', transactionId: params.transaction_id }, 'jvzoo test received');
    return NextResponse.json({ ok: true, event: action, test: true });
  }

  try {
    const normalized = parseJvzooIngest(params);
    const result = await upsertOrder(normalized);

    await db.ingestLog.update({
      where: { id: log.id },
      data: { processedOk: true, processedAt: new Date() },
    });

    logger.info(
      {
        platform: 'jvzoo',
        externalId: normalized.externalId,
        status: normalized.status,
        productType: normalized.productType,
        gross: normalized.grossAmountUsd,
        cpa: normalized.cpaPaidUsd,
        created: result.created,
        customerEmail: maskEmail(normalized.customerEmail),
      },
      'jvzoo ingest ok',
    );

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.ingestLog.update({
      where: { id: log.id },
      data: { error: message, processedAt: new Date() },
    });
    logger.error({ err, logId: log.id }, 'jvzoo ingest failed');
    return NextResponse.json({ error: 'processing failed' }, { status: 500 });
  }
}

function parseFormUrlEncoded(body: string): JvzooPayload {
  const params = new URLSearchParams(body);
  const out: JvzooPayload = {};
  for (const [key, value] of params.entries()) {
    out[key] = value;
  }
  return out;
}
