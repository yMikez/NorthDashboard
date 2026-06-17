// GET /api/metrics/page-states — estados atuais de página (Black/White) por
// (plataforma, produto), pro card de Produtos. Auth de sessão (tab products).

import { NextResponse } from 'next/server';
import { listPageStates } from '@/lib/services/pageState';
import { requireTab } from '@/lib/auth/guard';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireTab('products');
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ states: await listPageStates() });
  } catch (err) {
    logger.error({ err }, 'metrics/page-states failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
