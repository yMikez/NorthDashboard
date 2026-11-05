// GET /api/metrics/affiliate-ranking — aba Afiliados › Ranking
// (lib/services/affiliateRanking.ts). Tab-gated (Ranking, Visão Geral ou Reembolso Prev.).
//
// Devolve o agregado afiliado × dia do FE + o cadastro de parceiros; a nota de
// cada afiliado é calculada na página (safra, filtros e premissas mudam sem
// voltar ao servidor). Regras: docs/kb/ranking-afiliados.md.

import { NextResponse } from 'next/server';
import { requireAnyTab } from '@/lib/auth/guard';
import { AFFILIATE_SCORE_TABS } from '@/lib/auth/tabs';
import { getAffiliateRankingData } from '@/lib/services/affiliateRanking';
import { respondCached } from '@/lib/shared/metricsResponse';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireAnyTab(AFFILIATE_SCORE_TABS);
  if (!auth.ok) return auth.response;
  try {
    return await respondCached('affiliate-ranking', new URL(req.url).searchParams, () => getAffiliateRankingData());
  } catch (err) {
    logger.error({ err }, 'metrics/affiliate-ranking failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
