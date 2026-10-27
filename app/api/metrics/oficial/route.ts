// GET /api/metrics/oficial — resultado oficial por plataforma (painel de dados
// do Douglas, lib/services/oficial.ts): JVZoo, Logicall, Tauk e SalesBound,
// cada uma no dia da sua fonte, filtradas pelo dia-rótulo do período.
// Com filtro de plataforma, só as plataformas oficiais escolhidas (os call
// centers não são plataforma e saem do recorte, como na Visão geral).

import { NextResponse } from 'next/server';
import { getOficialResultado, type OficialChave } from '@/lib/services/oficial';
import { requireTab } from '@/lib/auth/guard';
import { logger } from '@/lib/logger';
import { csvParam } from '@/lib/shared/queryParams';
import { respondCached } from '@/lib/shared/metricsResponse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PLATAFORMA_OFICIAL = new Set<OficialChave>(['jvzoo']);

export async function GET(req: Request) {
  const auth = await requireTab('overview');
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(req.url);

  const startDate = new Date(searchParams.get('start_date') ?? '');
  const endDate = new Date(searchParams.get('end_date') ?? '');
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return NextResponse.json({ error: 'start_date and end_date are required (ISO 8601)' }, { status: 400 });
  }
  if (startDate > endDate) {
    return NextResponse.json({ error: 'start_date must be <= end_date' }, { status: 400 });
  }

  const platforms = csvParam(searchParams.get('platforms'));
  const chaves = platforms?.length
    ? platforms.filter((p): p is OficialChave => PLATAFORMA_OFICIAL.has(p as OficialChave))
    : undefined;

  try {
    return await respondCached('oficial', searchParams, () => getOficialResultado(startDate, endDate, { chaves }));
  } catch (err) {
    logger.error({ err }, 'metrics/oficial failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
