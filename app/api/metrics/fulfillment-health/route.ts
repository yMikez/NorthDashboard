// GET /api/metrics/fulfillment-health — saúde do custo (aba Fulfillment).
// Tab-gated ('costs'). SÓ período — de propósito não aceita filtros de
// dimensão: os problemas são de CADASTRO (catálogo/custos/tarifas) e
// filtrar por plataforma/família esconderia exatamente o que precisa
// aparecer.

import { NextResponse } from 'next/server';
import { requireTab } from '@/lib/auth/guard';
import { getFulfillmentHealth } from '@/lib/services/fulfillmentHealth';
import { logger } from '@/lib/logger';
import { respondCached } from '@/lib/shared/metricsResponse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireTab('costs');
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const startRaw = searchParams.get('start_date');
  const endRaw = searchParams.get('end_date');
  if (!startRaw || !endRaw) {
    return NextResponse.json({ error: 'start_date and end_date are required' }, { status: 400 });
  }
  const startDate = new Date(startRaw);
  const endDate = new Date(endRaw);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return NextResponse.json({ error: 'invalid date format' }, { status: 400 });
  }

  try {
    return await respondCached('fulfillment-health', searchParams, () =>
      getFulfillmentHealth({ startDate, endDate }));
  } catch (err) {
    logger.error({ err }, 'metrics/fulfillment-health failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
