// Dump bruto das ordens pra reconciliação com exports do painel
// (JVZoo/Digistore/etc.) feita fora do dashboard.
//
//   GET /api/admin/orders-dump?platform=jvzoo&start=YYYY-MM-DD&end=YYYY-MM-DD
//   GET /api/admin/orders-dump?platform=all&updated_since=<ISO 8601>
//   Auth: bearer INGEST_SECRET (curl) OU sessão ADMIN.
//
// Mesma resposta de GET /api/integrations/orders (a lógica vive em
// lib/services/ordersDump.ts) — aquela rota é a que os parceiros usam, com
// chave de escopo de leitura. Datas em BRT (dia inteiro), limite de 50k linhas.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { ordersDump } from '@/lib/services/ordersDump';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: Request) {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  if (!(bearer && checkIngestSecret(bearer))) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
  }
  const { searchParams } = new URL(req.url);
  try {
    const res = await ordersDump({
      platform: searchParams.get('platform'),
      start: searchParams.get('start'),
      end: searchParams.get('end'),
      updatedSince: searchParams.get('updated_since'),
      limit: searchParams.get('limit') ? Number(searchParams.get('limit')) : null,
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    return NextResponse.json(res);
  } catch (err) {
    logger.error({ err }, 'admin/orders-dump failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
