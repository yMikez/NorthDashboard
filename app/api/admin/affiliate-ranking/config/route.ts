// /api/admin/affiliate-ranking/config — premissas do Ranking de afiliados
// (pesos, metas, bônus e penalidades), compartilhadas por todos.
//
//   GET → quem tem Ranking, Visão Geral ou Reembolso Prev. (as telas precisam delas para a nota)
//   PUT → só admin; grava e guarda o histórico (AffiliateScoreConfigLog)

import { NextResponse } from 'next/server';
import { requireAdmin, requireAnyTab } from '@/lib/auth/guard';
import { AFFILIATE_SCORE_TABS } from '@/lib/auth/tabs';
import { getAffiliateScoreConfig, saveAffiliateScoreConfig } from '@/lib/services/affiliateRanking';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAnyTab(AFFILIATE_SCORE_TABS);
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await getAffiliateScoreConfig());
  } catch (err) {
    logger.error({ err }, 'affiliate-ranking/config GET failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'corpo JSON obrigatório' }, { status: 400 });
  try {
    const premissas = await saveAffiliateScoreConfig((body as { premissas?: unknown }).premissas ?? body, auth.user.email);
    return NextResponse.json({ premissas });
  } catch (err) {
    logger.error({ err }, 'affiliate-ranking/config PUT failed');
    return NextResponse.json({ error: 'save failed' }, { status: 500 });
  }
}
