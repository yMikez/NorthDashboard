// GET /api/metrics/refund-cohorts — matriz de coorte de reembolso + curva
// de maturação (spec: Cohort.md). Auth pela tab 'refund-cohorts'.
//
//   ?start_date&end_date  → intervalo dos DIAS DE VENDA (linhas da matriz)
//   ?horizon=30           → colunas 0..N dias desde a venda (7..180)
//   ?platforms&families&countries → mesmos filtros do resto do dash

import { NextResponse } from 'next/server';
import { getRefundCohorts } from '@/lib/services/refundCohorts';
import { requireTab } from '@/lib/auth/guard';
import { logger } from '@/lib/logger';
import { csvParam, stagesParam } from '@/lib/shared/queryParams';
import { respondCached } from '@/lib/shared/metricsResponse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireTab('refund-cohorts');
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(req.url);

  const startRaw = searchParams.get('start_date');
  const endRaw = searchParams.get('end_date');
  if (!startRaw || !endRaw) {
    return NextResponse.json(
      { error: 'start_date and end_date are required (ISO 8601)' },
      { status: 400 },
    );
  }
  const startDate = new Date(startRaw);
  const endDate = new Date(endRaw);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return NextResponse.json({ error: 'invalid date format' }, { status: 400 });
  }

  const horizon = Number.parseInt(searchParams.get('horizon') ?? '30', 10) || 30;

  try {
    return await respondCached('refund-cohorts', searchParams, () =>
      getRefundCohorts(
        {
          startDate,
          endDate,
          platformSlugs: csvParam(searchParams.get('platforms')),
          productFamilies: csvParam(searchParams.get('families')),
          productExternalIds: csvParam(searchParams.get('products')),
          productTypes: stagesParam(searchParams.get('stages')),
          countries: csvParam(searchParams.get('countries')),
        },
        horizon,
      ),
    );
  } catch (err) {
    logger.error({ err }, 'metrics/refund-cohorts failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
