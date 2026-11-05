// GET /api/metrics/affiliate-ranking/all-orders — todas as vendas de afiliados, empacotadas
// (Afiliados › Visão Geral e Reembolso Prev.: CPA da safra, curvas por produto e caminho no funil,
// detalhe de cada série). Tab-gated (Ranking, Visão Geral ou Reembolso Prev.).
//
// Sem dado de cliente: só venda, produto, valores e o FE de origem (lib/services/affiliateRanking.ts).

import { NextResponse } from 'next/server';
import { requireAnyTab } from '@/lib/auth/guard';
import { AFFILIATE_SCORE_TABS } from '@/lib/auth/tabs';
import { getAffiliateAllOrders } from '@/lib/services/affiliateRanking';
import { respondCached } from '@/lib/shared/metricsResponse';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireAnyTab(AFFILIATE_SCORE_TABS);
  if (!auth.ok) return auth.response;
  try {
    return await respondCached('affiliate-ranking/all-orders', new URL(req.url).searchParams, () => getAffiliateAllOrders());
  } catch (err) {
    logger.error({ err }, 'metrics/affiliate-ranking/all-orders failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
