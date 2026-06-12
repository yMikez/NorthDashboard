import { NextResponse } from 'next/server';
import { getFilterOptions } from '@/lib/services/filterOptions';
import { requireAuth } from '@/lib/auth/guard';
import { logger } from '@/lib/logger';
import { respondCached } from '@/lib/shared/metricsResponse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // Filtros globais ficam acessíveis pra qualquer logado — popula filterbar
  // que é compartilhado entre as tabs.
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  try {
    return await respondCached('filters', new URL(req.url).searchParams, () =>
      getFilterOptions(),
    );
  } catch (err) {
    logger.error({ err }, 'metrics/filters failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
