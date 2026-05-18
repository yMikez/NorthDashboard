// Admin endpoint: pipeline COMPLETO de recálculo de custos por pedido.
//
//   1) classifyExistingProducts() — reclassifica TODOS os produtos com o
//      classifier atual (família/potes/bonus/tipo/funnelStep). Necessário
//      pra BuyGoods e qualquer SKU que entrou antes do padrão existir —
//      sem isso, Product.family fica null e o passo 2 não tem o que somar.
//   2) backfillCogs() — reescreve Order.cogsUsd + fulfillmentUsd a partir
//      do Product (agora classificado) + ProductFamilyCost/FulfillmentRate
//      por fornecedor.
//
// Rodar os dois em ordem aqui elimina o footgun de "recalcular sem
// reclassificar" (que deixava BuyGoods em $0). Idempotente.
//
// Gated by INGEST_SECRET like other admin endpoints.

import { NextResponse } from 'next/server';
import { backfillCogs } from '@/lib/services/backfillCogs';
import { classifyExistingProducts } from '@/lib/services/classifyExistingProducts';
import { refreshDailyMetricsNow } from '@/lib/services/dailyMetrics';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = req.headers.get('authorization');
  const token = auth?.replace(/^Bearer\s+/i, '') ?? null;
  if (!checkIngestSecret(token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    // 1) Reclassifica produtos (preenche family/bottles/bonus pros BuyGoods
    //    e corrige tipo/funnelStep onde o IPN errou).
    const classification = await classifyExistingProducts();
    // 2) Reescreve os snapshots de custo a partir do catálogo atualizado.
    const cogs = await backfillCogs();
    await refreshDailyMetricsNow();
    // Campos de cogs no topo (retrocompat com a UI) + bloco de
    // classificação pra mostrar quantos produtos foram (re)classificados.
    return NextResponse.json({
      ...cogs,
      reclassified: classification.classified,
      ordersFixed: classification.ordersFixed,
      funnelStepFixed: classification.funnelStepFixed,
      unrecognizedCount: classification.unrecognized.length,
      classification,
    });
  } catch (err) {
    logger.error({ err }, 'admin/backfill-cogs failed');
    return NextResponse.json(
      { error: 'failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
