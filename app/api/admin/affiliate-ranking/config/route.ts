// /api/admin/affiliate-ranking/config — premissas do Ranking de afiliados
// (pesos, metas, bônus e penalidades), compartilhadas por todos.
//
//   GET → quem tem a aba affiliate-ranking (a página precisa delas para a nota)
//   PUT → só admin; grava e guarda o histórico (AffiliateScoreConfigLog)

import { NextResponse } from 'next/server';
import { requireAdmin, requireTab } from '@/lib/auth/guard';
import { getAffiliateScoreConfig, saveAffiliateScoreConfig } from '@/lib/services/affiliateRanking';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireTab('affiliate-ranking');
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
