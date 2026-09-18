// GET|POST /api/ingest/salesbound?token=<TOKEN> — postback da SalesBound
// (parceira de cross-sell). FASE 1: CAPTURA.
//
// A URL vai direto pra eles (sem n8n): GET com macros na querystring ou
// POST JSON/form — tudo é aceito. Auth = `token` na querystring, no header
// X-Postback-Token OU NO CORPO (o CRM deles manda `"token"` dentro do JSON
// e não aceita querystring — pedido deles em 2026-09-17), comparado em
// tempo constante com SALESBOUND_POSTBACK_TOKEN (env) ou o setting
// salesbound.postbackToken (IntegrationSetting, gravado via
// PUT /api/admin/integration-settings).
// Também aceita X-Ingest-Secret (testes manuais internos).
// O token NUNCA é gravado: parseSalesboundPostback tira as chaves de segredo
// do payload antes de salvar.
//
// Grava UM IngestLog por request (platformSlug 'salesbound', eventType e
// externalId extraídos do que der; payload = query + body + _meta) e
// responde 200 sempre que gravou — payload estranho NÃO vira 4xx (postback
// que recebe erro vira re-tentativa/alerta do lado deles sem ganho pra
// gente). 401 só com token errado; 503 sem token configurado; 500 se o
// banco falhar (aí sim queremos que reenviem).
//
// FASE 2 (quando os primeiros eventos reais chegarem): connector lê estes
// logs (replay) → CallCenterSale provider 'salesbound' / lucro BACK / aba.
// Inspeção enquanto isso: GET /api/admin/ingest-logs?platform=salesbound.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { checkIntegrationKey } from '@/lib/services/affiliateIntegrationHandlers';
import { getSalesboundPostbackToken } from '@/lib/services/integrationSettings';
import { parseSalesboundBody, parseSalesboundPostback, tokenFromBody } from '@/lib/connectors/salesbound/ingest';
import { recordSalesboundWebhook } from '@/lib/services/salesboundLedger';
import { clearNetProfitInputsCache } from '@/lib/services/netProfit';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 256 * 1024;

async function capture(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const expected = await getSalesboundPostbackToken();
  if (!expected) {
    return NextResponse.json({ error: 'postback não configurado no servidor' }, { status: 503 });
  }
  // O corpo é lido ANTES da autenticação porque o token pode vir nele.
  let raw = '';
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'payload too large' }, { status: 413 });
    }
  }
  const contentType = req.headers.get('content-type');
  const body = parseSalesboundBody(raw, contentType);

  const token = url.searchParams.get('token') ?? req.headers.get('x-postback-token') ?? tokenFromBody(body);
  const internal = req.headers.get('x-ingest-secret');
  if (!checkIntegrationKey(token, expected) && !(internal && checkIngestSecret(internal))) {
    logger.warn({ platform: 'salesbound', method: req.method, hasToken: Boolean(token), source: url.searchParams.get('token') ? 'query' : req.headers.get('x-postback-token') ? 'header' : tokenFromBody(body) ? 'body' : 'nenhum' }, 'salesbound postback unauthorized');
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const query = Object.fromEntries(url.searchParams);
  const capture = parseSalesboundPostback(query, body, {
    method: req.method,
    contentType,
    userAgent: req.headers.get('user-agent'),
    ip: req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? req.headers.get('x-real-ip'),
  });

  try {
    const log = await db.ingestLog.create({
      data: {
        source: 'postback-salesbound',
        platformSlug: 'salesbound',
        eventType: capture.isTest ? `${capture.eventType}:test` : capture.eventType,
        externalId: capture.externalId,
        payload: capture.payload as object,
        signatureOk: true,
        // Fase 1: "processado" = capturado. A fase 2 reprocessa por replay.
        processedOk: true,
        processedAt: new Date(),
      },
      select: { id: true, receivedAt: true },
    });
    // FASE 2: o evento também vira linha do razão (SalesboundTransaction).
    // Tudo conta como VENDA — o CRM deles não manda tipo de evento (decisão do
    // usuário, 2026-09-17); só valor negativo vira estorno. Se isto falhar, o
    // IngestLog acima já garante o replay, então a resposta continua 200.
    let ledger: Awaited<ReturnType<typeof recordSalesboundWebhook>> | null = null;
    if (!capture.isTest) {
      try {
        ledger = await recordSalesboundWebhook(capture.payload);
        if (ledger.status === 'created' || ledger.status === 'updated') {
          clearNetProfitInputsCache();
          await db.ingestLog.update({ where: { id: log.id }, data: { eventType: `${ledger.type === 'REFUND' ? 'refund' : 'sale'}:assumed` } }).catch(() => undefined);
        }
      } catch (err) {
        logger.error({ err, logId: log.id }, 'salesbound ledger write failed (payload guardado pra replay)');
      }
    }
    logger.info(
      { platform: 'salesbound', logId: log.id, event: capture.eventType, externalId: capture.externalId, test: capture.isTest, method: req.method, ledger: ledger?.status ?? 'none', keys: Object.keys(capture.payload).filter((k) => k !== '_meta') },
      'salesbound postback captured',
    );
    return NextResponse.json({ ok: true, id: log.id, event: capture.eventType, external_id: capture.externalId, ledger: ledger?.status ?? 'none', received_at: log.receivedAt.toISOString() });
  } catch (err) {
    logger.error({ err }, 'salesbound postback capture failed');
    return NextResponse.json({ error: 'processing failed' }, { status: 500 });
  }
}

export async function GET(req: Request) { return capture(req); }
export async function POST(req: Request) { return capture(req); }
