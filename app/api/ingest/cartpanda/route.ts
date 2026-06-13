// POST /api/ingest/cartpanda
//
// Recebe o WEBHOOK da Cartpanda (proxied via N8N). Body é JSON com a estrutura
// { event, order: { ..., line_items: [...] }, webhook }. Um pedido pode ter
// vários line items (FE + upsells) — geramos uma Order por item.
//
// Eventos: order.paid, order.upsell (→ APPROVED), order.refunded (→ REFUNDED),
// order.chargeback (→ CHARGEBACK).
//
// Auth: x-ingest-secret (header, caminho n8n) OU ?secret= na query.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { parseCartpandaWebhook } from '@/lib/connectors/cartpanda/ingest';
import type { CartpandaWebhook } from '@/lib/connectors/cartpanda/types';
import { upsertOrder } from '@/lib/services/upsertOrder';
import { logger, maskEmail } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET serve só pra ping no navegador / teste de conectividade.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ok = checkIngestSecret(req.headers.get('x-ingest-secret'))
    || checkIngestSecret(url.searchParams.get('secret'));
  if (!ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ ok: true, ready: true });
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  if (!checkIngestSecret(req.headers.get('x-ingest-secret'))
    && !checkIngestSecret(url.searchParams.get('secret'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: CartpandaWebhook;
  try {
    body = (await req.json()) as CartpandaWebhook;
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  const event = (body?.event ?? 'unknown').toLowerCase();
  const order = body?.order;
  const orderId = order?.id != null ? String(order.id) : null;

  const log = await db.ingestLog.create({
    data: {
      source: 'n8n-cartpanda',
      platformSlug: 'cartpanda',
      eventType: event,
      externalId: orderId,
      payload: body as unknown as object,
      signatureOk: null,
    },
    select: { id: true },
  });

  // Pedido de teste explícito da Cartpanda (order.test=1): registra e ignora.
  // Pedidos de sandbox (is_cartx_test=1) seguem o fluxo normal pra permitir
  // verificação ponta-a-ponta.
  if (Number(order?.test) === 1 || event === 'test' || event === 'connection_test') {
    await db.ingestLog.update({
      where: { id: log.id },
      data: { processedOk: true, processedAt: new Date() },
    });
    logger.info({ platform: 'cartpanda', event, orderId }, 'cartpanda test received');
    return NextResponse.json({ ok: true, event, test: true });
  }

  try {
    const normalizedOrders = parseCartpandaWebhook(body);
    const results = [];
    for (const normalized of normalizedOrders) {
      results.push(await upsertOrder(normalized));
    }

    await db.ingestLog.update({
      where: { id: log.id },
      data: { processedOk: true, processedAt: new Date() },
    });

    logger.info(
      {
        platform: 'cartpanda',
        event,
        orderId,
        lineItems: normalizedOrders.length,
        created: results.filter((r) => r.created).length,
        status: normalizedOrders[0]?.status,
        customerEmail: maskEmail(normalizedOrders[0]?.customerEmail ?? null),
      },
      'cartpanda ingest ok',
    );

    return NextResponse.json({ ok: true, event, lineItems: results.length });
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
