// GET /api/integrations/affiliates/products?days=180
// O que cada afiliado do NorthScale Afiliados já vende, por conta e produto,
// com o CPA da última venda front-end — alimenta a afiliação automática de lá
// (contrato docs/integracoes/northscale-afiliados.md §7b). Auth: X-Api-Key
// (mesma chave do webhook e das métricas). Cache de 5 min por janela.

import { NextResponse } from 'next/server';
import { handleAffiliateProducts } from '@/lib/services/affiliateIntegrationHandlers';
import { affiliateProductsCache, computeAffiliateProducts } from '@/lib/services/affiliateProductsExport';
import { getAffiliatesInboundKey } from '@/lib/services/integrationSettings';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const t0 = Date.now();
  try {
    const res = await handleAffiliateProducts(
      new URL(req.url),
      { header: (n) => req.headers.get(n) },
      { inboundKey: getAffiliatesInboundKey, compute: computeAffiliateProducts, cache: affiliateProductsCache },
    );
    if (res.status === 200) {
      logger.info({ endpoint: 'integrations/affiliates/products', ms: Date.now() - t0, cache: res.headers?.['X-Cache'], days: res.headers?.['X-Days'] }, 'products.timing');
    }
    return NextResponse.json(res.body, { status: res.status, headers: res.headers });
  } catch (err) {
    logger.error({ err }, 'integrations/affiliates/products failed');
    return NextResponse.json({ statusCode: 500, message: 'query failed', error: 'Internal Server Error' }, { status: 500 });
  }
}
