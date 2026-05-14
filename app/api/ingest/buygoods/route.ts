// POST /api/ingest/buygoods
//
// Recebe IPN BuyGoods (proxied via N8N). Body é form-urlencoded com ~100
// chaves. Diferente do Digistore, BuyGoods NÃO assina o payload com SHA —
// a doc oficial usa apenas `token_ipn` no body como proof-of-authenticity.
// O N8N valida esse token antes de encaminhar; nosso endpoint só verifica
// `x-ingest-secret` (shared secret entre N8N e nós).
//
// Eventos suportados: neworder, refund, chargeback, cancel, rebill,
// failedrebill, canceledfromrebill (+ ack pra connection_test).

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { parseBuyGoodsIngest } from '@/lib/connectors/buygoods/ingest';
import type { BuyGoodsPayload } from '@/lib/connectors/buygoods/types';
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

  const action = (params.action_type ?? 'unknown').toLowerCase();

  const log = await db.ingestLog.create({
    data: {
      source: 'n8n-buygoods',
      platformSlug: 'buygoods',
      eventType: action,
      externalId: params.order_id ?? null,
      payload: params as unknown as object,
      // BuyGoods não usa SHA-512; deixar null em vez de bool.
      signatureOk: null,
    },
    select: { id: true },
  });

  // Test ping do painel BG ou do nosso N8N: registra e responde OK.
  if (action === 'connection_test' || action === 'test' || params.is_test === '1') {
    await db.ingestLog.update({
      where: { id: log.id },
      data: { processedOk: true, processedAt: new Date() },
    });
    logger.info(
      { platform: 'buygoods', isTest: params.is_test, orderId: params.order_id },
      'buygoods test/connection received',
    );
    return NextResponse.json({ ok: true, event: action, test: true });
  }

  try {
    const normalized = parseBuyGoodsIngest(params);
    const result = await upsertOrder(normalized);

    await db.ingestLog.update({
      where: { id: log.id },
      data: { processedOk: true, processedAt: new Date() },
    });

    logger.info(
      {
        platform: 'buygoods',
        externalId: normalized.externalId,
        status: normalized.status,
        productType: normalized.productType,
        gross: normalized.grossAmountUsd,
        cpa: normalized.cpaPaidUsd,
        created: result.created,
        customerEmail: maskEmail(normalized.customerEmail),
      },
      'buygoods ingest ok',
    );

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.ingestLog.update({
      where: { id: log.id },
      data: { error: message, processedAt: new Date() },
    });
    logger.error({ err, logId: log.id }, 'buygoods ingest failed');
    return NextResponse.json({ error: 'processing failed' }, { status: 500 });
  }
}

function parseFormUrlEncoded(body: string): BuyGoodsPayload {
  const params = new URLSearchParams(body);
  const out: BuyGoodsPayload = {};
  // URLSearchParams pega o ÚLTIMO valor pra chaves duplicadas. BuyGoods
  // duplica vários campos (account_id, product_codename, aff_id) com o
  // mesmo valor — comportamento equivalente. Se um dia BG mandar dois
  // valores diferentes na mesma chave, refatorar pra Array logic.
  for (const [key, value] of params.entries()) {
    out[key] = value;
  }
  return out;
}
