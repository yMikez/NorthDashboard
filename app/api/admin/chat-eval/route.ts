// POST /api/admin/chat-eval — dispara uma rodada do eval em segundo plano.
//   Body: { model?, effort?, cases?: string[], categories?: string[], reps?: 1..5, knowledge?: 'on'|'off' }
//   → 202 { runId }  ·  409 se já há rodada rodando  ·  400 config inválida
// GET  /api/admin/chat-eval — últimas rodadas (sem os resultados por caso).
//   → { runs: [{ id, status, trigger, createdBy, config, summary, costUsd, startedAt, finishedAt }] }
//
// Custo: cada caso chama o modelo de verdade (ordem de $0,1–1 por caso no
// Opus). O teto CHAT_EVAL_MAX_USD corta a rodada; o GET mostra o custo das
// anteriores pra quem vai clicar "Rodar agora".

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { logger } from '@/lib/logger';
import { EvalBusyError, EvalConfigError, EvalWindowError, startEvalRun, type EvalConfigInput } from '@/lib/services/chatEval';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown> = {};
  try {
    const text = await req.text();
    if (text.trim()) body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'body inválido' }, { status: 400 });

  // Só o que o painel pode escolher (teto de custo e concorrência ficam no
  // servidor); tipos e faixas são validados em normalizeEvalConfig.
  const input: EvalConfigInput = {
    model: body.model as EvalConfigInput['model'],
    effort: body.effort as EvalConfigInput['effort'],
    cases: body.cases as EvalConfigInput['cases'],
    categories: body.categories as EvalConfigInput['categories'],
    reps: body.reps as EvalConfigInput['reps'],
    knowledge: body.knowledge as EvalConfigInput['knowledge'],
  };
  try {
    const { runId } = await startEvalRun(input, { trigger: 'admin', createdBy: auth.user.id });
    return NextResponse.json({ runId }, { status: 202 });
  } catch (err) {
    if (err instanceof EvalConfigError || err instanceof EvalWindowError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof EvalBusyError) return NextResponse.json({ error: 'já existe uma rodada em andamento', runId: err.message }, { status: 409 });
    logger.error({ err }, '[chat-eval] falha ao iniciar rodada');
    return NextResponse.json({ error: err instanceof Error ? err.message : 'falha ao iniciar' }, { status: 500 });
  }
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  // Rodada órfã (container reiniciou/deploy no meio) ficava 'running' pra
  // sempre: a tela desabilita "Rodar avaliação" enquanto houver uma e o POST
  // era o único lugar que chamava markStaleRuns.
  const { markStaleRuns } = await import('@/lib/services/chatEval');
  await markStaleRuns().catch((err) => logger.warn({ err }, '[chat-eval] limpeza de rodadas órfãs falhou'));
  const runs = await db.chatEvalRun.findMany({
    orderBy: { startedAt: 'desc' },
    take: 30,
    select: { id: true, status: true, trigger: true, createdBy: true, config: true, summary: true, costUsd: true, startedAt: true, finishedAt: true },
  });
  return NextResponse.json({ runs });
}
