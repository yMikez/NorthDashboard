// GET /api/metrics/callcenter — monitor de call center da aba Produtos:
// vendas/dia dos produtos vigiados + alertas Tauk (≥30/dia) e SalesBound
// (≥100/dia). Tab-gated ('products'). Janela é now-relative (últimos 7
// dias BRT) — sem parâmetros de data de propósito.

import { NextResponse } from 'next/server';
import { requireTab } from '@/lib/auth/guard';
import { getCallCenter } from '@/lib/services/callCenter';
import { logger } from '@/lib/logger';
import { respondCached } from '@/lib/shared/metricsResponse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireTab('products');
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  try {
    return await respondCached('callcenter', searchParams, () => getCallCenter());
  } catch (err) {
    logger.error({ err }, 'metrics/callcenter failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
