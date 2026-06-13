// GET|POST /api/ingest/cartpanda
//
// Recebe o POSTBACK da Cartpanda (proxied via N8N). Diferente das outras
// plataformas (IPN com JSON/form), aqui os campos chegam como query string
// (GET) ou no body (form-urlencoded ou JSON, conforme o n8n repassar). O
// handler aceita os dois métodos e todas as formas de body — extrai a união
// dos params da URL + body.
//
// Auth: x-ingest-secret (header, caminho n8n) OU ?secret= na query (caso o
// postback aponte direto pro endpoint, sem n8n). Qualquer um serve.
//
// O canal só dispara pra venda aprovada (front + upsell) — sem refund/CB.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { parseCartpandaIngest } from '@/lib/connectors/cartpanda/ingest';
import type { CartpandaPostback } from '@/lib/connectors/cartpanda/types';
import { upsertOrder } from '@/lib/services/upsertOrder';
import { logger, maskEmail } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}

async function handle(req: Request) {
  const url = new URL(req.url);
  // Auth: header (n8n) OU ?secret= (postback direto). `secret` na query é
  // descartado do payload logado logo abaixo.
  const headerSecret = req.headers.get('x-ingest-secret');
  const querySecret = url.searchParams.get('secret');
  if (!checkIngestSecret(headerSecret) && !checkIngestSecret(querySecret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const params = await extractParams(req, url);
  delete params.secret; // não persistir o segredo no IngestLog

  const eventType = (params.order_type ?? 'sale').toLowerCase();

  const log = await db.ingestLog.create({
    data: {
      source: 'n8n-cartpanda',
      platformSlug: 'cartpanda',
      eventType,
      externalId: params.order_id ?? null,
      payload: params as unknown as object,
      // Cartpanda postback não assina (SHA) — auth é via shared secret.
      signatureOk: null,
    },
    select: { id: true },
  });

  // Test ping (botão de teste do painel Cartpanda ou do n8n).
  if (params.is_test === '1' || eventType === 'test' || eventType === 'connection_test') {
    await db.ingestLog.update({
      where: { id: log.id },
      data: { processedOk: true, processedAt: new Date() },
    });
    logger.info({ platform: 'cartpanda', orderId: params.order_id }, 'cartpanda test/connection received');
    return NextResponse.json({ ok: true, event: eventType, test: true });
  }

  try {
    const normalized = parseCartpandaIngest(params);
    const result = await upsertOrder(normalized);

    await db.ingestLog.update({
      where: { id: log.id },
      data: { processedOk: true, processedAt: new Date() },
    });

    logger.info(
      {
        platform: 'cartpanda',
        externalId: normalized.externalId,
        status: normalized.status,
        productType: normalized.productType,
        gross: normalized.grossAmountUsd,
        cpa: normalized.cpaPaidUsd,
        created: result.created,
        customerEmail: maskEmail(normalized.customerEmail),
      },
      'cartpanda ingest ok',
    );

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.ingestLog.update({
      where: { id: log.id },
      data: { error: message, processedAt: new Date() },
    });
    logger.error({ err, logId: log.id }, 'cartpanda ingest failed');
    return NextResponse.json({ error: 'processing failed' }, { status: 500 });
  }
}

/**
 * Extrai params da query (GET/postback direto) E do body (POST via n8n —
 * form-urlencoded ou JSON), com o body sobrescrevendo a query em conflito.
 */
async function extractParams(req: Request, url: URL): Promise<CartpandaPostback> {
  const out: CartpandaPostback = {};
  for (const [k, v] of url.searchParams.entries()) out[k] = v;

  if (req.method === 'POST') {
    const ct = (req.headers.get('content-type') ?? '').toLowerCase();
    try {
      if (ct.includes('application/json')) {
        const body = (await req.json()) as Record<string, unknown>;
        for (const [k, v] of Object.entries(body)) {
          if (v != null) out[k] = String(v);
        }
      } else {
        // form-urlencoded (default) ou text — parse como query string.
        const raw = await req.text();
        if (raw) {
          for (const [k, v] of new URLSearchParams(raw).entries()) out[k] = v;
        }
      }
    } catch {
      /* body vazio/ilegível — segue só com a query */
    }
  }
  return out;
}
