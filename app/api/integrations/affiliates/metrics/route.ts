// GET /api/integrations/affiliates/metrics?period=7d|30d|mtd|custom&from=&to=
// Métricas agregadas por affiliate_id pro ranking do NorthScale Afiliados
// (contrato integration-dashboard.md §7). Auth: X-Api-Key (mesma chave do
// webhook). Resposta: lista JSON [{affiliate_id, gross_sales, refunds,
// net_sales, orders_count, refund_rate}] — cache de 5 min por período.

import { NextResponse } from 'next/server';
import { handleAffiliateMetrics } from '@/lib/services/affiliateIntegrationHandlers';
import { computeAffiliateMetrics, affiliateMetricsCache } from '@/lib/services/affiliateMetricsExport';
import { getAffiliatesInboundKey } from '@/lib/services/integrationSettings';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const t0 = Date.now();
  try {
    const res = await handleAffiliateMetrics(
      new URL(req.url),
      { header: (n) => req.headers.get(n) },
      { inboundKey: getAffiliatesInboundKey, compute: computeAffiliateMetrics, cache: affiliateMetricsCache },
    );
    if (res.status === 200) {
      logger.info({ endpoint: 'integrations/affiliates/metrics', ms: Date.now() - t0, cache: res.headers?.['X-Cache'], period: res.headers?.['X-Period'] }, 'metrics.timing');
    }
    return NextResponse.json(res.body, { status: res.status, headers: res.headers });
  } catch (err) {
    logger.error({ err }, 'integrations/affiliates/metrics failed');
    return NextResponse.json({ statusCode: 500, message: 'query failed', error: 'Internal Server Error' }, { status: 500 });
  }
}
