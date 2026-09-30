// GET /api/admin/chat-eval/[id] — uma rodada do eval com os resultados por
// (caso, repetição): status, nota, checagens, resposta avaliada, trace
// (rodadas, chamadas com filtros aplicados e digest, valores esperados antes
// e depois) e uso/custo.
//   → { run, results: [{ id, caseSlug, rep, status, score, checks, answer, trace, usage, latencyMs, createdAt }] }

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const run = await db.chatEvalRun.findUnique({ where: { id } });
  if (!run) return NextResponse.json({ error: 'rodada não encontrada' }, { status: 404 });
  const results = await db.chatEvalResult.findMany({
    where: { runId: id },
    orderBy: [{ caseSlug: 'asc' }, { rep: 'asc' }],
  });
  return NextResponse.json({ run, results });
}
