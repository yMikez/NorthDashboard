// Admin (bearer INGEST_SECRET): listar e APAGAR estados de página do beacon
// (FunnelPageState). Útil pra limpar beacons de teste antes de medir pra valer
// — o endpoint público /api/page-state só faz upsert, não tem delete.
//
//   GET    /api/admin/page-states                     → lista todos
//   DELETE /api/admin/page-states?all=1               → apaga TODOS
//   DELETE /api/admin/page-states?platform=X&product=Y → apaga um (platform+product)
//   DELETE /api/admin/page-states?platform=X          → apaga todos de uma plataforma
//
// Sem nenhum filtro (e sem all=1) o DELETE recusa (evita zerar sem querer).

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authed(req: Request): boolean {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  return checkIngestSecret(token);
}

export async function GET(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const rows = await db.funnelPageState.findMany({
    orderBy: { reportedAt: 'desc' },
    select: { platformSlug: true, productKey: true, state: true, pageUrl: true, reportedAt: true },
  });
  return NextResponse.json({ count: rows.length, states: rows });
}

export async function DELETE(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const all = searchParams.get('all') === '1';
  const platform = searchParams.get('platform')?.trim().toLowerCase() || null;
  const product = searchParams.get('product')?.trim() || null;

  let where: { platformSlug?: string; productKey?: string } | undefined;
  if (all) {
    where = undefined; // apaga tudo
  } else if (platform || product) {
    where = {};
    if (platform) where.platformSlug = platform;
    if (product) where.productKey = product;
  } else {
    return NextResponse.json(
      { error: 'especifique ?all=1, ?platform=, e/ou ?product=' },
      { status: 400 },
    );
  }

  try {
    const res = await db.funnelPageState.deleteMany(where ? { where } : undefined);
    logger.info({ deleted: res.count, all, platform, product }, 'admin/page-states delete');
    return NextResponse.json({ ok: true, deleted: res.count });
  } catch (err) {
    logger.error({ err }, 'admin/page-states delete failed');
    return NextResponse.json(
      { error: 'delete failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
