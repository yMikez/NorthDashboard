// GET /api/metrics/funnel/sequence?window=7&count=3&anchor=YYYY-MM-DD&today=0&platforms=&countries=&products=&families=
//
// Funil por janelas (Janela 1..K de N dias), com transições explicadas
// (volume de FEs × AOV de sessão, estágio que mais mexeu na take rate).

import { NextResponse } from 'next/server';
import { requireTab } from '@/lib/auth/guard';
import { respondCached } from '@/lib/shared/metricsResponse';
import { csvParam } from '@/lib/shared/queryParams';
import { parseAnalysisParams } from '@/lib/shared/affiliateAnalysisParams';
import { getFunnelSequence } from '@/lib/services/funnelSequence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: Request) {
  const auth = await requireTab('funnel');
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(req.url);
  const p = parseAnalysisParams(searchParams);
  if (!p.window) return NextResponse.json({ error: 'window deve ser um inteiro de 1 a 90' }, { status: 400 });
  return respondCached('funnel/sequence', searchParams, () =>
    getFunnelSequence({
      window: p.window!, count: p.count, anchor: p.anchor, includeToday: p.includeToday,
      platformSlugs: p.platformSlugs, productFamilies: p.families,
      countries: csvParam(searchParams.get('countries')),
      productExternalIds: csvParam(searchParams.get('products')),
    }),
  );
}
