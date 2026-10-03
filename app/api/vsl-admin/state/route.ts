// GET /api/vsl-admin/state — tudo que a aba VSLs precisa pra desenhar:
// biblioteca, páginas (com o snippet pronto), testes, histórico e opções.

import { NextResponse } from 'next/server';
import { requireTab } from '@/lib/auth/guard';
import { getVslState } from '@/lib/services/vsl';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireTab('vsl');
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await getVslState());
  } catch (err) {
    logger.error({ err }, 'vsl state failed');
    return NextResponse.json({ error: 'falha ao carregar' }, { status: 500 });
  }
}
