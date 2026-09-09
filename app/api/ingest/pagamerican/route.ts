// POST /api/ingest/pagamerican — FASE 1: captura.
//
// Recebe os webhooks da PagAmerican proxied via n8n (workflow PagAmerican):
// o n8n desembrulha o envelope da plataforma (o corpo original é SEMPRE um
// array com um objeto: [{ "event": "...", "body": {...} }]), descarta
// eventos de teste (body.isTest) e manda UM objeto { event, body } por
// request com x-ingest-secret. Defensivo: se chegar o array cru (plataforma
// apontada direto pra cá), desembrulha aqui também.
//
// Eventos (docs.pagamerican.app): order.purchase.created.v1 (venda aprovada,
// upsell/downsell incluídos SEM campo diferenciador), order.status.updated.v1
// (paid | waiting_payment | refused | refunded | chargedback — fora de ordem,
// usar updatedAt), refund.transaction.confirmed.v1, checkout/abandono.
// Valores em CENTS (`commission.totalPriceInCents`, `amounts.*InCents`).
// Entrega at-least-once → dedup por (orderId, event) fica pra fase 2.
//
// FASE 2 (quando for ligado ao funil): connector parseia estes IngestLogs
// (replay, padrão BuyGoods) → NormalizedOrder → upsertOrder. Nada se perde
// enquanto isso: tudo que chega fica gravado aqui.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PagAmericanEnvelope {
  event?: string;
  body?: Record<string, unknown> & { orderId?: string | number; isTest?: boolean };
}

export async function POST(req: Request) {
  if (!checkIngestSecret(req.headers.get('x-ingest-secret'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    // Nunca derruba o webhook por payload torto — loga o erro e responde 200
    // (a PagAmerican faz retry; um 4xx repetido só gera ruído no painel dela).
    logger.warn('[pagamerican] payload não-JSON recebido');
    return NextResponse.json({ ok: false, error: 'invalid json' });
  }

  const envelopes: PagAmericanEnvelope[] = Array.isArray(parsed)
    ? (parsed as PagAmericanEnvelope[])
    : [parsed as PagAmericanEnvelope];

  // Materializa a plataforma no primeiro evento (card em Plataformas +
  // feedback de "conectado" sem esperar a fase 2).
  await db.platform.upsert({
    where: { slug: 'pagamerican' },
    create: { slug: 'pagamerican', displayName: 'PagAmerican' },
    update: {},
  });

  let logged = 0;
  for (const env of envelopes) {
    if (!env || typeof env !== 'object') continue;
    const body = env.body ?? (env as Record<string, unknown>);
    const event = (env.event ?? 'unknown').toString();
    const isTest = (body as { isTest?: boolean }).isTest === true;
    await db.ingestLog.create({
      data: {
        source: 'n8n-pagamerican',
        platformSlug: 'pagamerican',
        eventType: isTest ? `${event}:test` : event,
        externalId: (body as { orderId?: string | number }).orderId != null
          ? String((body as { orderId?: string | number }).orderId)
          : null,
        payload: env as unknown as object,
        signatureOk: null, // PagAmerican não assina; o shared secret do n8n é a autenticação
        processedOk: true, // fase 1 = capturado com sucesso; parse vem na fase 2
        processedAt: new Date(),
      },
    });
    logged++;
  }

  logger.info({ platform: 'pagamerican', logged }, 'pagamerican events captured');
  return NextResponse.json({ ok: true, logged });
}
