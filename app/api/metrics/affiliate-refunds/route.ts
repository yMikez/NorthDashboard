// GET /api/metrics/affiliate-refunds?keys=jvzoo:123,buygoods:456@1
// Reembolso das vendas dos últimos 60 dias por conta de afiliado, na régua da
// aba Reembolsos (lib/services/overviewPanels.ts). Usado no Top 5 da Visão
// geral. Até 50 contas por chamada. Permissão da Visão geral.

import { NextResponse } from 'next/server';
import { getAffiliateRefunds60d } from '@/lib/services/overviewPanels';
import { requireTab } from '@/lib/auth/guard';
import { logger } from '@/lib/logger';
import { respondCached } from '@/lib/shared/metricsResponse';
import { isPortfolioScoped, portfolioAffiliateIds } from '@/lib/portfolio/scope';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireTab('overview');
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(req.url);
  let keys = (searchParams.get('keys') ?? '').split(',').filter(Boolean);
  if (!keys.length) return NextResponse.json({ error: 'keys obrigatório (plataforma:externalId, separados por vírgula)' }, { status: 400 });
  // Carteira: só as contas dela (as outras somem da resposta).
  if (isPortfolioScoped(auth.user)) {
    const ids = await portfolioAffiliateIds(auth.user);
    const mine = new Set((await db.affiliate.findMany({
      where: { id: { in: ids } },
      select: { externalId: true, platform: { select: { slug: true } } },
    })).map((a) => `${a.platform.slug}:${a.externalId}`));
    keys = keys.filter((k) => mine.has(k));
    if (!keys.length) return NextResponse.json({ windowDays: 60, start: null, affiliates: [] });
  }
  try {
    return await respondCached('affiliate-refunds', searchParams, () => getAffiliateRefunds60d(keys));
  } catch (err) {
    logger.error({ err }, 'metrics/affiliate-refunds failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
