// POST /api/ingest/vupim
//
// Webhook da Vupim (docs: docs/integracoes/vupim.md), normalmente repassado
// pelo n8n com o CORPO CRU (a assinatura só vale sobre os bytes exatos).
//
// Auth: X-Ingest-Secret (caminho n8n) OU assinatura válida da Vupim
// (X-Webhook-Signature, HMAC-SHA256 com VUPIM_WEBHOOK_SECRET, formato com data
// "t=,v1=" ou o antigo "sha256=") — com a assinatura configurada, a Vupim pode
// apontar direto pra cá. Assinatura configurada e INVÁLIDA ou com t a mais de
// 5 min do relógio = 401 mesmo com a chave de operação certa.
//
// Entrega "pelo menos uma vez" e fora de ordem (doc da Vupim):
//   - mesmo evento (eventId; envelope.id no webhook antigo) já processado →
//     200 sem refazer (cobre retry, Resend e Send past sales);
//   - evento com `version` menor ou igual à gravada na venda → ignorado (sem
//     versão: aprovação antiga depois de estorno/chargeback é ignorada);
//   - estorno chegando antes da venda → grava a venda e aplica o estorno.
// livemode=false (Send test, venda-teste do checkout) nunca vira pedido.
// Eventos que não viram pedido (sale.created, declined, shipped,
// subscription.* fora renewed, checkout.*) ficam só no IngestLog e respondem 200.
// Toda entrega com subscriptionId (cobrança, renovação, falha de pagamento,
// cancelamento) também entra no histórico da assinatura (aba Recorrências).

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { parseVupimOrder, vupimEventKey, vupimShouldApply, VupimCurrencyError, VUPIM_ORDER_EVENTS } from '@/lib/connectors/vupim/ingest';
import { verifyVupimSignature, vupimSecrets } from '@/lib/connectors/vupim/signature';
import type { VupimEnvelope } from '@/lib/connectors/vupim/types';
import { upsertOrder } from '@/lib/services/upsertOrder';
import { trackVupimSubscription } from '@/lib/services/subscriptions';
import { logger, maskEmail } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = verifyVupimSignature(rawBody, req.headers.get('x-webhook-signature'), vupimSecrets(process.env.VUPIM_WEBHOOK_SECRET));
  const ingestOk = checkIngestSecret(req.headers.get('x-ingest-secret'));
  if (signature === 'INVALID' || signature === 'EXPIRED' || (!ingestOk && signature !== 'VALID')) {
    const error = signature === 'INVALID' ? 'invalid signature' : signature === 'EXPIRED' ? 'signature expired' : 'unauthorized';
    return NextResponse.json({ error }, { status: 401 });
  }

  let env: VupimEnvelope;
  try {
    env = JSON.parse(rawBody) as VupimEnvelope;
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }
  if (!env || typeof env !== 'object' || !env.event) {
    return NextResponse.json({ error: 'missing event' }, { status: 400 });
  }
  const event = vupimEventKey(env.event);
  const deliveryId = typeof env.id === 'string' ? env.id : null;
  const eventId = typeof env.eventId === 'string' && env.eventId ? env.eventId : null;

  // Mesmo evento já processado (retry/Resend/Send past sales): 200 sem refazer.
  if (eventId || deliveryId) {
    const dup = await db.ingestLog.findFirst({
      where: {
        platformSlug: 'vupim',
        processedOk: true,
        payload: eventId ? { path: ['eventId'], equals: eventId } : { path: ['id'], equals: deliveryId! },
      },
      select: { id: true },
    });
    if (dup) return NextResponse.json({ ok: true, event, duplicate: true });
  }

  const data = env.data ?? {};
  const log = await db.ingestLog.create({
    data: {
      source: 'n8n-vupim',
      platformSlug: 'vupim',
      eventType: event,
      externalId: (data.transactionId as string | undefined) ?? (data.checkoutSessionId as string | undefined) ?? deliveryId,
      payload: env as unknown as object,
      signatureOk: signature === 'VALID' ? true : null,
    },
    select: { id: true },
  });
  const done = (extra: { error?: string } = {}) =>
    db.ingestLog.update({ where: { id: log.id }, data: { processedOk: !extra.error, processedAt: new Date(), error: extra.error ?? null } });

  // Assinatura: entra antes do pedido porque falha de pagamento e
  // cancelamento não viram pedido. Erro aqui não derruba a venda.
  await trackVupimSubscription(env, event).catch((err) => logger.error({ err, logId: log.id }, 'vupim assinatura falhou'));

  const status = VUPIM_ORDER_EVENTS[event];
  // Teste (Send test, venda-teste do checkout): só registra, não conta.
  if (!status || env.livemode === false) {
    await done();
    return NextResponse.json({ ok: true, event, action: event === 'webhook.test' || env.livemode === false ? 'test' : 'logged', signature });
  }

  try {
    const order = parseVupimOrder(env);
    const existing = await db.order.findFirst({
      where: { externalId: order.externalId, platform: { slug: 'vupim' } },
      select: { status: true, grossAmountUsd: true, rawMetadata: true },
    });
    const reversed = Math.abs(order.grossAmountUsd);
    const storedVersion = (existing?.rawMetadata as { vupimVersion?: unknown } | null)?.vupimVersion;
    const apply = vupimShouldApply(
      status as 'APPROVED' | 'REFUNDED' | 'CHARGEBACK',
      existing && { status: existing.status, grossAmountUsd: Number(existing.grossAmountUsd), version: typeof storedVersion === 'number' ? storedVersion : null },
      reversed,
      { version: typeof data.version === 'number' ? data.version : null, chargebackWon: event === 'sale.chargeback_won' },
    );
    if (!apply) {
      await done();
      logger.info({ platform: 'vupim', event, externalId: order.externalId, existing: existing?.status }, 'vupim evento antigo ignorado');
      return NextResponse.json({ ok: true, event, action: 'stale' });
    }
    // Estorno/chargeback de venda que ainda não chegou: grava a venda primeiro
    // (valor original certo) e aplica o evento em cima.
    if (!existing && status !== 'APPROVED') await upsertOrder(parseVupimOrder(env, { asSale: true }));
    const result = await upsertOrder(order);
    await done();
    logger.info(
      { platform: 'vupim', event, externalId: order.externalId, status: order.status, created: result.created, signature, customerEmail: maskEmail(order.customerEmail) },
      'vupim ingest ok',
    );
    return NextResponse.json({ ok: true, event, action: result.created ? 'created' : 'updated', signature });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await done({ error: message });
    // Moeda sem conversão: não adianta a Vupim tentar de novo — fica no log
    // pra reprocessar quando o câmbio existir.
    if (err instanceof VupimCurrencyError) {
      logger.warn({ logId: log.id, currency: err.currency }, 'vupim moeda sem conversão');
      return NextResponse.json({ ok: false, event, error: message });
    }
    logger.error({ err, logId: log.id }, 'vupim ingest failed');
    return NextResponse.json({ error: 'processing failed' }, { status: 500 });
  }
}
