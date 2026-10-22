// GET /api/metrics/networks — aba Afiliados › Networks (lib/services/networkMetrics.ts).
// Tab-gated (networks).
//
//   ?start_date&end_date              → venda (sold_at) no período (ISO 8601)
//   ?network&member&product           → rede, integrante, jvzoo_product_id
//   ?utm_source&utm_campaign&sub1     → origem do tráfego (checkouts só pelos eventos)
//   ?tests=1                          → inclui compras-teste
//   ?page=1                           → página das vendas recentes

import { NextResponse } from 'next/server';
import { requireTab } from '@/lib/auth/guard';
import { getNetworksDashboard } from '@/lib/services/networkMetrics';
import { respondCached } from '@/lib/shared/metricsResponse';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireTab('networks');
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(req.url);

  const start = new Date(searchParams.get('start_date') ?? '');
  const end = new Date(searchParams.get('end_date') ?? '');
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return NextResponse.json({ error: 'start_date and end_date are required (ISO 8601)' }, { status: 400 });
  }
  const p = (k: string) => searchParams.get(k)?.trim().slice(0, 200) || null;

  try {
    return await respondCached('networks', searchParams, () => getNetworksDashboard({
      start,
      end,
      networkId: p('network'),
      memberId: p('member'),
      productId: p('product'),
      utmSource: p('utm_source'),
      utmCampaign: p('utm_campaign'),
      sub1: p('sub1'),
      includeTests: searchParams.get('tests') === '1',
    }, { page: Number.parseInt(searchParams.get('page') ?? '1', 10) || 1 }));
  } catch (err) {
    logger.error({ err }, 'metrics/networks failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
