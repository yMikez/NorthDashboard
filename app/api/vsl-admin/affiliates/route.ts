// GET /api/vsl-admin/affiliates?page=<id>&q=<busca> — candidatos a regra por
// afiliado numa página: quem já passou por ela (com visitas) e a busca nas
// contas da plataforma. Permissão da aba VSLs.

import { NextResponse } from 'next/server';
import { requireTab } from '@/lib/auth/guard';
import { affiliateCandidates, VslActionError } from '@/lib/services/vsl';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireTab('vsl');
  if (!auth.ok) return auth.response;
  const sp = new URL(req.url).searchParams;
  const pageId = sp.get('page');
  if (!pageId) return NextResponse.json({ error: 'page é obrigatório' }, { status: 400 });
  try {
    return NextResponse.json(await affiliateCandidates(pageId, sp.get('q') ?? ''));
  } catch (err) {
    if (err instanceof VslActionError) return NextResponse.json({ error: err.message }, { status: err.status });
    logger.error({ err }, 'vsl affiliates failed');
    return NextResponse.json({ error: 'falha ao buscar' }, { status: 500 });
  }
}
