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
import type { NormalizedProductType } from '@/lib/shared/types';
import { upsertOrder } from '@/lib/services/upsertOrder';
import { reconcileJvzooSession } from '@/lib/services/jvzooSessions';
import { rebalanceSessionFulfillment } from '@/lib/services/sessionFulfillment';
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

    // Compras-TESTE do próprio vendor: funil inteiro a ~$1 (na prática
    // $1,02–$1,07 — os centavos variam por step; sonda 2026-08-07, todas
    // com e-mail @thenorthscale.com). Regra: 0 < |gross| < $2. Não viram
    // Order (poluíam contagens, AOV, funil e fulfillment) — ficam só no
    // IngestLog pra auditoria. Limpeza do legado:
    // POST /api/admin/purge-jvzoo-tests.
    const absGross = Math.abs(normalized.grossAmountUsd);
    if (absGross > 0 && absGross < 2) {
      await db.ingestLog.update({
        where: { id: log.id },
        data: { processedOk: true, processedAt: new Date(), error: 'skip: compra-teste $1' },
      });
      logger.info(
        { platform: 'jvzoo', externalId: normalized.externalId, gross: normalized.grossAmountUsd },
        'jvzoo test purchase ($1) skipped',
      );
      return NextResponse.json({ ok: true, skipped: 'test-purchase-1usd' });
    }

    // Eventos NÃO-venda (RFND/CGBK/INSF/CANCEL-REBILL) chegam com payload
    // do EVENTO (other_params às vezes ausente; o `date` é o da VENDA
    // original — a JVZoo não manda o instante do estorno, ver connector) —
    // a âncora recomputada sairia errada e o update arrancaria o pedido
    // da sessão de compra. Preserva sessão e papel já gravados.
    const isSaleLike = ['sale', 'bill', 'uncancel-rebill'].includes(normalized.eventType);
    if (!isSaleLike) {
      const platform = await db.platform.findUnique({ where: { slug: 'jvzoo' }, select: { id: true } });
      const prev = platform
        ? await db.order.findUnique({
            where: { platformId_externalId: { platformId: platform.id, externalId: normalized.externalId } },
            select: { funnelSessionId: true, productType: true, parentExternalId: true },
          })
        : null;
      if (prev) {
        normalized.funnelSessionId = prev.funnelSessionId;
        normalized.productType = prev.productType as NormalizedProductType;
        normalized.parentExternalId = prev.parentExternalId ?? normalized.parentExternalId;
      }
    }

    const result = await upsertOrder(normalized);

    // Papel FE/UPSELL sai da ordem dentro da sessão (mais antiga = FE).
    // Roda depois de TODO upsert: corrige upsell recém-chegado, FE
    // atrasada (rebaixa o upsell) e o clobber de productType em updates.
    const reclassified = await reconcileJvzooSession(normalized.funnelSessionId);
    if (reclassified > 0) {
      // Papel mudou → o pacote (frete ancora na FE) precisa reagrupar.
      const platform = await db.platform.findUnique({ where: { slug: 'jvzoo' }, select: { id: true } });
      if (platform && normalized.funnelSessionId) {
        await rebalanceSessionFulfillment(platform.id, normalized.funnelSessionId, 'session');
      }
    }

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
