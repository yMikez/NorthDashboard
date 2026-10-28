// Teste A/B das pesquisas (aba Pesquisas → "Testes A/B"). Só ADMIN.
//
//   GET   /api/admin/surveys/experiments?variant=neurorecall   → testes da pesquisa (com a config de cada versão)
//   POST  /api/admin/surveys/experiments  { variant, name, arms: [{ name, weight }, { name, weight, config }, …] }
//         começa um teste (um por vez no ar); a 1ª versão é a pesquisa como está
//   PATCH /api/admin/surveys/experiments  { id, name?, arms? }            edita o teste no ar
//   PATCH /api/admin/surveys/experiments  { id, action: "stop", winner? } encerra; winner B/C/D publica a versão
//
// Regras em lib/surveys/experiments.ts e lib/services/surveys.ts.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { createSurveyExperiment, listSurveyExperiments, updateSurveyExperiment } from '@/lib/services/surveys';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function bodyOf(req: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const experiments = await listSurveyExperiments(new URL(req.url).searchParams.get('variant') ?? '');
  if (!experiments) return NextResponse.json({ error: 'pesquisa não encontrada' }, { status: 404 });
  return NextResponse.json({ experiments });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = await bodyOf(req);
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  const res = await createSurveyExperiment(String(body.variant ?? ''), { name: body.name, arms: body.arms }, auth.user.email);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  logger.info({ id: res.experiment.id, variant: body.variant, by: auth.user.email }, 'survey experiment started');
  return NextResponse.json({ experiment: res.experiment });
}

export async function PATCH(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = await bodyOf(req);
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  const res = await updateSurveyExperiment(String(body.id ?? ''), {
    name: body.name, arms: body.arms, action: body.action, winner: body.winner,
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  logger.info({ id: res.experiment.id, action: body.action ?? 'edit', winner: res.experiment.winner, by: auth.user.email }, 'survey experiment updated');
  return NextResponse.json({ experiment: res.experiment });
}
