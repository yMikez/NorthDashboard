import { NextResponse } from 'next/server';
import { getFilterOptions, scopeFilterOptions } from '@/lib/services/filterOptions';
import { requireAuth } from '@/lib/auth/guard';
import { logger } from '@/lib/logger';
import { respondCached } from '@/lib/shared/metricsResponse';
import { isPortfolioScoped, portfolioAffiliateIds, scopeOwnerIds } from '@/lib/portfolio/scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // Filtros globais ficam acessíveis pra qualquer logado — popula filterbar
  // que é compartilhado entre as tabs. Carteira de afiliados: quem tem função
  // recebe só as pessoas dela e os captadores da equipe abaixo dele.
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  try {
    return await respondCached('filters', new URL(req.url).searchParams, async () => {
      const base = await getFilterOptions();
      if (!isPortfolioScoped(auth.user)) return scopeFilterOptions(base, {});
      return scopeFilterOptions(base, {
        ownerIds: await scopeOwnerIds(auth.user),
        allowedAccounts: new Set(await portfolioAffiliateIds(auth.user)),
      });
    });
  } catch (err) {
    logger.error({ err }, 'metrics/filters failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
