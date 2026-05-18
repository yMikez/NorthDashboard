// Admin endpoint: pipeline COMPLETO de recálculo de custos por pedido,
// rodado EM BACKGROUND (não-bloqueante).
//
//   1) classifyExistingProducts() — reclassifica TODOS os produtos com o
//      classifier atual (família/potes/bonus/tipo/funnelStep).
//   2) backfillCogs() — reescreve Order.cogsUsd + fulfillmentUsd a partir
//      do Product (já classificado) + tarifa por fornecedor.
//
// Por que background: o pipeline varre milhares de orders com updates
// sequenciais — passava do timeout HTTP do proxy (a request travava e
// "nada acontecia" na UI). Agora o POST dispara o job e volta na hora;
// a UI faz polling do GET pra ver progresso/resultado. Processo Node
// é long-running na VPS, então o job continua após a resposta.
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

interface BackfillJob {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
}

// Estado em memória do último/atual job. Single-flight: só 1 por vez.
const job: BackfillJob = {
  running: false,
  startedAt: null,
  finishedAt: null,
  result: null,
  error: null,
};

async function runBackfill(): Promise<void> {
  try {
    // 1) Reclassifica produtos (preenche family/bottles/bonus dos BuyGoods
    //    e corrige productType/funnelStep onde o IPN errou).
    const classification = await classifyExistingProducts();
    // 2) Reescreve os snapshots de custo a partir do catálogo atualizado.
    const cogs = await backfillCogs();
    await refreshDailyMetricsNow();
    job.result = {
      ...cogs,
      reclassified: classification.classified,
      ordersFixed: classification.ordersFixed,
      funnelStepFixed: classification.funnelStepFixed,
      unrecognizedCount: classification.unrecognized.length,
      classification,
    };
    job.error = null;
  } catch (err) {
    logger.error({ err }, 'admin/backfill-cogs job failed');
    job.error = err instanceof Error ? err.message : String(err);
  } finally {
    job.running = false;
    job.finishedAt = new Date().toISOString();
  }
}

export async function POST(req: Request) {
  const auth = req.headers.get('authorization');
  const token = auth?.replace(/^Bearer\s+/i, '') ?? null;
  if (!checkIngestSecret(token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (job.running) {
    return NextResponse.json(
      { started: false, running: true, startedAt: job.startedAt, message: 'Já tem um backfill rodando.' },
      { status: 202 },
    );
  }
  job.running = true;
  job.startedAt = new Date().toISOString();
  job.finishedAt = null;
  job.result = null;
  job.error = null;
  // Fire-and-forget: NÃO await. Node long-running continua o job após
  // a resposta. UI acompanha via GET.
  void runBackfill();
  return NextResponse.json(
    { started: true, running: true, startedAt: job.startedAt },
    { status: 202 },
  );
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  const token = auth?.replace(/^Bearer\s+/i, '') ?? null;
  if (!checkIngestSecret(token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.json(job);
}
