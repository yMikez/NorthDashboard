// PUT /api/admin/net-profit/params { params } → grava os parâmetros
// vigentes do Lucro real (singleton). Admin-only. Sanitizado por
// normalizeParams — shape inválido vira default por campo, nunca erro.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { saveNetProfitParams, getNetProfitParams } from '@/lib/services/netProfit';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Auth: sessão ADMIN (aba) OU bearer INGEST_SECRET (curl/ops) — mesmo padrão
// das demais rotas /api/admin/* com operação por linha de comando.
async function authorized(req: Request): Promise<{ ok: true; userId: string | null } | { ok: false; response: NextResponse }> {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  if (bearer && checkIngestSecret(bearer)) return { ok: true, userId: null };
  const auth = await requireAdmin();
  return auth.ok ? { ok: true, userId: auth.user.id } : { ok: false, response: auth.response };
}

export async function GET(req: Request) {
  const auth = await authorized(req);
  if (!auth.ok) return auth.response;
  return NextResponse.json(await getNetProfitParams());
}

export async function PUT(req: Request) {
  const auth = await authorized(req);
  if (!auth.ok) return auth.response;
  let body: { params?: unknown };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: 'invalid body' }, { status: 400 }); }
  try {
    const params = await saveNetProfitParams(body.params ?? body, auth.userId);
    return NextResponse.json({ ok: true, params });
  } catch (err) {
    logger.error({ err }, 'admin/net-profit/params failed');
    return NextResponse.json({ error: 'save failed' }, { status: 500 });
  }
}
