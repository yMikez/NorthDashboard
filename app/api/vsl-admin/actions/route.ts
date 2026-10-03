// POST /api/vsl-admin/actions — toda edição da aba VSLs ({ action, ... }).
// Quem tem a aba edita (permissão por aba, como o resto do dash); toda ação
// vai pro histórico com o nome de quem fez.

import { NextResponse } from 'next/server';
import { requireTab } from '@/lib/auth/guard';
import { vslAction, VslActionError } from '@/lib/services/vsl';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await requireTab('vsl');
  if (!auth.ok) return auth.response;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'corpo inválido' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'corpo inválido' }, { status: 400 });
  }
  try {
    const res = await vslAction(body, { id: auth.user.id, name: auth.user.name || auth.user.email });
    return NextResponse.json(res);
  } catch (err) {
    if (err instanceof VslActionError) return NextResponse.json({ error: err.message }, { status: err.status });
    logger.error({ err, action: body.action }, 'vsl action failed');
    return NextResponse.json({ error: 'falha ao salvar' }, { status: 500 });
  }
}
