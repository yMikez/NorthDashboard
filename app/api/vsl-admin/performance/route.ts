// GET /api/vsl-admin/performance — desempenho das VSLs no período do filtro
// global (start_date/end_date, platforms, families) + etapa/página locais.
// Os resultados dos testes A/B ignoram o período: valem do início ao fim
// de cada teste.

import { NextResponse } from 'next/server';
import { requireTab } from '@/lib/auth/guard';
import { getVslPerformance } from '@/lib/services/vslPerformance';
import { isVslStage } from '@/lib/vsl/catalog';
import { respondCached } from '@/lib/shared/metricsResponse';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const list = (v: string | null) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined);

export async function GET(req: Request) {
  const auth = await requireTab('vsl');
  if (!auth.ok) return auth.response;
  const sp = new URL(req.url).searchParams;
  const start = new Date(sp.get('start_date') ?? '');
  const end = new Date(sp.get('end_date') ?? '');
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return NextResponse.json({ error: 'start_date e end_date são obrigatórios' }, { status: 400 });
  }
  const stage = sp.get('stage');
  try {
    return await respondCached('vsl-performance', sp, () =>
      getVslPerformance({
        start,
        end,
        platforms: list(sp.get('platforms')),
        families: list(sp.get('families')),
        stage: stage && isVslStage(stage) ? stage : null,
        pageId: sp.get('page') || null,
      }),
    );
  } catch (err) {
    logger.error({ err }, 'vsl performance failed');
    return NextResponse.json({ error: 'falha ao calcular' }, { status: 500 });
  }
}
