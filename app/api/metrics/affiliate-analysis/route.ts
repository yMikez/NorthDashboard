// GET /api/metrics/affiliate-analysis?window=7&view=partner&internal=0&today=0&platforms=a,b&families=x
//
// Ranking + comparativo de janelas (3/7/15/30/60 dias, cada uma vs a
// anterior). Por padrão as janelas fecham ONTEM (último dia completo) —
// comparar "hoje parcial" com dias cheios viciava todos os Δ; `today=1`
// inclui hoje. Não usa o período global do dashboard.

import { NextResponse } from 'next/server';
import { requireTab } from '@/lib/auth/guard';
import { respondCached } from '@/lib/shared/metricsResponse';
import { parseAnalysisParams } from '@/lib/shared/affiliateAnalysisParams';
import { getAffiliateAnalysis } from '@/lib/services/affiliateAnalysis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireTab('affiliate-analysis');
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(req.url);
  const p = parseAnalysisParams(searchParams);
  if (!p.window) return NextResponse.json({ error: 'window deve ser um inteiro de 1 a 90' }, { status: 400 });
  const includeContact = auth.user.role === 'ADMIN';
  // Contato/e-mail só pra admin → a chave de cache precisa distinguir.
  const cacheParams = new URLSearchParams(searchParams);
  cacheParams.set('_contact', includeContact ? '1' : '0');
  return respondCached('affiliate-analysis', cacheParams, () =>
    getAffiliateAnalysis({ ...p, window: p.window!, includeContact }),
  );
}
