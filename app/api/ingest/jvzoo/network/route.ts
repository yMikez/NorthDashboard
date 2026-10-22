// POST /api/ingest/jvzoo/network — eventos de REDE vindos do n8n
// ("JVZoo Redes (postbacks S2S)"). Contrato: docs/integracoes/redes.md §3/§5.2.
//
// Um evento por chamada: `purchase` (marca a venda de rede pelo
// transaction_id) ou `initiated` (checkout iniciado pelo link da rede).
// O pedido em si continua vindo da IPN de vendedor (/api/ingest/jvzoo); aqui
// só se grava a marca e se classifica o pedido, se ele já existir — a marca
// pode chegar antes do pedido, e o upsertOrder liga quando ele chegar.
//
// Auth: x-ingest-secret (a mesma credencial do /api/ingest/jvzoo). 2xx =
// recebido; 5xx = o n8n tenta de novo (3 vezes). status "ignored" só é
// registrado; "duplicate" é tratado como "accepted" (idempotente).

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { parseNetworkCheckout, parseNetworkSale, str } from '@/lib/services/networksCore';
import { applyNetworkCheckout, applyNetworkSale, markNetworkOrders, upsertMemberRef, upsertNetworkRef } from '@/lib/services/networks';
import { clearResponseCache } from '@/lib/cache/responseCache';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!checkIngestSecret(req.headers.get('x-ingest-secret'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const event = (str(body.event) ?? 'unknown').toLowerCase();
  const status = (str(body.status) ?? 'accepted').toLowerCase();
  const sale = body.sale as Record<string, unknown> | undefined;
  const checkout = body.checkout as Record<string, unknown> | undefined;
  const externalId = str(sale?.transaction_id) ?? str(checkout?.session_id);

  const log = await db.ingestLog.create({
    data: {
      source: 'n8n-jvzoo-redes',
      platformSlug: 'jvzoo',
      eventType: event,
      externalId,
      payload: body as object,
      signatureOk: null,
    },
    select: { id: true },
  });
  const done = (error?: string) =>
    db.ingestLog.update({ where: { id: log.id }, data: { processedOk: !error, processedAt: new Date(), error: error ?? null } });

  if (status === 'ignored') {
    await done();
    return NextResponse.json({ ok: true, event, action: 'ignored' });
  }

  try {
    if (event === 'purchase') {
      const parsed = parseNetworkSale(body);
      if ('error' in parsed) {
        await done(parsed.error);
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      await upsertNetworkRef(parsed.network);
      if (parsed.member) await upsertMemberRef(parsed.member);
      const action = await applyNetworkSale(parsed, 'event', body);
      // Pedido que já chegou (e o funil dele) passa a ser de rede agora.
      const marked = await markNetworkOrders([parsed.transactionId]);
      await done();
      clearResponseCache();
      logger.info({ event, transactionId: parsed.transactionId, network: parsed.network.name, attribution: parsed.fields.attributionStatus, action, marked }, 'jvzoo network ingest ok');
      return NextResponse.json({ ok: true, event, action, transactionId: parsed.transactionId });
    }
    if (event === 'initiated') {
      const parsed = parseNetworkCheckout(body);
      if ('error' in parsed) {
        await done(parsed.error);
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      await upsertNetworkRef(parsed.network);
      if (parsed.member) await upsertMemberRef(parsed.member);
      const action = await applyNetworkCheckout(parsed, body);
      await done();
      return NextResponse.json({ ok: true, event, action, sessionId: parsed.sessionId });
    }
    await done(`evento desconhecido: ${event}`);
    return NextResponse.json({ ok: true, event, action: 'logged' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await done(message);
    logger.error({ err, logId: log.id }, 'jvzoo network ingest failed');
    return NextResponse.json({ error: 'processing failed' }, { status: 500 });
  }
}
