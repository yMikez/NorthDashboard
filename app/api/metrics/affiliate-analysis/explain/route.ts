// GET /api/metrics/affiliate-analysis/explain?key=partner:<id>|aff:<id>&window=7&internal=0&today=0&platforms=&families=
//
// "Por quê" de UMA entidade: drivers da variação, janelas 3/7/15/30/60,
// série atual × anterior, quebra por família e por conta.

import { NextResponse } from 'next/server';
import { requireTab } from '@/lib/auth/guard';
import { respondCached } from '@/lib/shared/metricsResponse';
import { parseAnalysisParams } from '@/lib/shared/affiliateAnalysisParams';
import { getAffiliateExplain } from '@/lib/services/affiliateAnalysis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireTab('affiliate-analysis');
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(req.url);
  const key = (searchParams.get('key') ?? '').trim();
  if (!/^(partner|aff):[A-Za-z0-9_-]+$/.test(key)) {
    return NextResponse.json({ error: 'key inválida (partner:<id> | aff:<id>)' }, { status: 400 });
  }
  const p = parseAnalysisParams(searchParams);
  if (!p.window) return NextResponse.json({ error: 'window deve ser 3, 7, 15, 30 ou 60' }, { status: 400 });
  const includeContact = auth.user.role === 'ADMIN';
  const cacheParams = new URLSearchParams(searchParams);
  cacheParams.set('_contact', includeContact ? '1' : '0');
  return respondCached('affiliate-analysis/explain', cacheParams, async () => {
    const r = await getAffiliateExplain(key, { ...p, window: p.window!, includeContact });
    return r ?? { error: 'not_found' };
  });
}
