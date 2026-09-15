// Projeções salvas do Lucro real (admin-only).
//   GET    /api/admin/net-profit/scenarios            → { scenarios }
//   POST   /api/admin/net-profit/scenarios            { name, note?, params, start_date, end_date }
//          → calcula com os inputs do período, guarda params + resumo → { id, scenario }
//   DELETE /api/admin/net-profit/scenarios?id=<id>    → { ok }

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { deleteNetProfitScenario, evaluateNetProfit, listNetProfitScenarios, saveNetProfitScenario, summarize } from '@/lib/services/netProfit';
import { normalizeParams } from '@/lib/services/netProfitCore';
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
  return NextResponse.json({ scenarios: await listNetProfitScenarios() });
}

export async function POST(req: Request) {
  const auth = await authorized(req);
  if (!auth.ok) return auth.response;
  let body: { name?: unknown; note?: unknown; params?: unknown; start_date?: string; end_date?: string };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: 'invalid body' }, { status: 400 }); }
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
  if (!name) return NextResponse.json({ error: 'name obrigatório' }, { status: 400 });
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 2000) : null;
  const start = new Date(body.start_date ?? ''); const end = new Date(body.end_date ?? '');
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return NextResponse.json({ error: 'invalid date range' }, { status: 400 });
  try {
    const params = normalizeParams(body.params);
    const { result } = await evaluateNetProfit(start, end, params);
    const id = await saveNetProfitScenario({ name, note, params, start, end, result, userId: auth.userId });
    logger.info({ id, name, userId: auth.userId }, '[netProfit] projeção salva');
    return NextResponse.json({ ok: true, id, summary: summarize(result) });
  } catch (err) {
    logger.error({ err }, 'admin/net-profit/scenarios save failed');
    return NextResponse.json({ error: 'save failed' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const auth = await authorized(req);
  if (!auth.ok) return auth.response;
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 });
  const ok = await deleteNetProfitScenario(id);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
