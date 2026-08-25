// GET /api/metrics/affiliate-analysis/sequence?window=7&count=3&anchor=YYYY-MM-DD&view=partner&internal=0&today=0&platforms=&families=
//
// K janelas consecutivas de N dias (Janela 1..K, a última terminando em
// `anchor` — ou ontem/hoje): tabela por janela, transições retidos/novos/
// churn, Evolução · Comentários (narrativa por regras) e Saúde da empresa.

import { NextResponse } from 'next/server';
import { requireTab } from '@/lib/auth/guard';
import { respondCached } from '@/lib/shared/metricsResponse';
import { parseAnalysisParams } from '@/lib/shared/affiliateAnalysisParams';
import { getAffiliateSequence } from '@/lib/services/affiliateAnalysis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: Request) {
  const auth = await requireTab('affiliate-analysis');
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(req.url);
  const p = parseAnalysisParams(searchParams);
  if (!p.window) return NextResponse.json({ error: 'window deve ser um inteiro de 1 a 90' }, { status: 400 });
  return respondCached('affiliate-analysis/sequence', searchParams, () =>
    getAffiliateSequence({ ...p, window: p.window!, includeContact: false }),
  );
}
