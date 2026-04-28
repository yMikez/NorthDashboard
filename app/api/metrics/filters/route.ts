import { NextResponse } from 'next/server';
import { getFilterOptions } from '@/lib/services/filterOptions';
import { requireAuth } from '@/lib/auth/guard';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  // Filtros globais ficam acessíveis pra qualquer logado — popula filterbar
  // que é compartilhado entre as tabs.
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  try {
    const data = await getFilterOptions();
    return NextResponse.json(data);
  } catch (err) {
    logger.error({ err }, 'metrics/filters failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
