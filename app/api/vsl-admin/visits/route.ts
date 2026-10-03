// GET /api/vsl-admin/visits?page=<id> — últimas visitas de uma página (30 dias,
// inclui descartadas): horário, VSL, afiliado, até onde assistiu, clique e se
// a compra da etapa foi confirmada. Serve pra achar e descartar visita de
// teste. Sem dado do comprador. Permissão da aba VSLs.

import { NextResponse } from 'next/server';
import { requireTab } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { listPageVisits } from '@/lib/services/vslPerformance';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireTab('vsl');
  if (!auth.ok) return auth.response;
  const pageId = new URL(req.url).searchParams.get('page');
  if (!pageId) return NextResponse.json({ error: 'page é obrigatório' }, { status: 400 });
  try {
    const page = await db.vslPage.findUnique({ where: { id: pageId }, select: { id: true } });
    if (!page) return NextResponse.json({ error: 'Página não encontrada.' }, { status: 404 });
    return NextResponse.json({ visits: await listPageVisits(pageId) });
  } catch (err) {
    logger.error({ err }, 'vsl visits failed');
    return NextResponse.json({ error: 'falha ao listar as visitas' }, { status: 500 });
  }
}
