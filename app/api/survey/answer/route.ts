// POST /api/survey/answer   (público, autenticado pelo token do convite)
//
//   { t, q, v }                grava uma resposta
//   { t, finish, answers }     conclui e devolve a tela final { outcome, followUp }
//   { preview, slug, answers } pré-visualização: só calcula a tela final

import { NextResponse } from 'next/server';
import { finishSurvey, previewOutcome, saveSurveyAnswer } from '@/lib/services/surveys';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  try {
    if (body.preview === true) {
      const d = await previewOutcome(String(body.slug ?? ''), body.answers, body.bottles);
      return d ? NextResponse.json(d) : NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    const token = String(body.t ?? '');
    if (body.finish === true) {
      const d = await finishSurvey(token, body.answers);
      return d ? NextResponse.json(d) : NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    const res = await saveSurveyAnswer(token, String(body.q ?? ''), body.v);
    return res.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'rejected' }, { status: res.status });
  } catch (err) {
    logger.error({ err }, 'survey answer failed');
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
