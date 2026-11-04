// GET /api/metrics/affiliate-ranking/orders — pedidos de um afiliado na safra
// (página do afiliado, aba Afiliados › Ranking). Tab-gated (affiliate-ranking).
//
//   ?contas=JVZoo 123,Vupim abc   → contas do afiliado (o parceiro manda todas)
//   ?de=AAAA-MM-DD&ate=AAAA-MM-DD → dia do FE de origem (a safra)
//
// Sem dado de cliente: só ids de venda, produto e valores.

import { NextResponse } from 'next/server';
import { requireTab } from '@/lib/auth/guard';
import { getAffiliateOrders } from '@/lib/services/affiliateRanking';
import { isDiaIso, parseContas } from '@/lib/services/affiliateRankingCore';
import { respondCached } from '@/lib/shared/metricsResponse';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireTab('affiliate-ranking');
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(req.url);
  const contas = parseContas(searchParams.get('contas'));
  const de = searchParams.get('de');
  const ate = searchParams.get('ate');
  if (!contas.length || !isDiaIso(de) || !isDiaIso(ate)) {
    return NextResponse.json({ error: 'contas, de e ate (AAAA-MM-DD) são obrigatórios' }, { status: 400 });
  }
  try {
    return await respondCached('affiliate-ranking/orders', searchParams, () => getAffiliateOrders(contas, de, ate));
  } catch (err) {
    logger.error({ err }, 'metrics/affiliate-ranking/orders failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
