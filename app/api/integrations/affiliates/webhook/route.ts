// POST /api/integrations/affiliates/webhook — evento affiliate.updated do
// NorthScale Afiliados (contrato integration-dashboard.md §6).
//
// Auth: X-Api-Key == DASHBOARD_API_KEY (env) ou setting
// affiliates.dashboardApiKey — comparação em tempo constante; 503 sem
// chave configurada, 401 chave errada. Corpo = estado COMPLETO do afiliado
// → substituição idempotente por occurred_at (lib/services/affiliateMapping).
// Sempre 2xx quando processado ou ignorado de propósito; 500 só em erro de
// banco (eles fazem retry com backoff, 8 tentativas).
//
// Cada entrega vira um IngestLog (platformSlug 'affiliates') pra auditoria
// e pro painel mostrar "último webhook".

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleAffiliateWebhook } from '@/lib/services/affiliateIntegrationHandlers';
import { applyAffiliateState } from '@/lib/services/affiliateMapping';
import { getAffiliatesInboundKey } from '@/lib/services/integrationSettings';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const res = await handleAffiliateWebhook(
    { header: (n) => req.headers.get(n), json: () => req.json() },
    {
      inboundKey: getAffiliatesInboundKey,
      applyState: (state) => applyAffiliateState(state),
      log: async (entry) => {
        await db.ingestLog.create({
          data: {
            source: 'webhook-affiliates',
            platformSlug: 'affiliates',
            eventType: 'affiliate.updated',
            externalId: entry.eventId,
            payload: { attempt: entry.attempt, note: entry.note, body: entry.body } as object,
            signatureOk: true,
            processedOk: entry.ok,
            processedAt: new Date(),
            error: entry.ok ? null : entry.note,
          },
        });
        logger.info({ eventId: entry.eventId, attempt: entry.attempt, ok: entry.ok, note: entry.note }, 'affiliates webhook');
      },
    },
  );
  return NextResponse.json(res.body, { status: res.status, headers: res.headers });
}
