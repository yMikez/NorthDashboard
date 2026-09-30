// GET  /api/admin/chat-eval/cases — casos do eval: goldens do código + os do
//      banco (promovidos de feedback ou criados pelo admin).
//   → { cases: [{ id, category, source: 'code'|'db', enabled, sourceFeedbackId, spec }] }
// POST /api/admin/chat-eval/cases — cria/atualiza um caso ("Virar caso de teste").
//   Body: { slug, category, spec: GoldenCase sem id/category, enabled?, feedbackId?, override? }
//   → { case }
//   Com feedbackId (voto compartilhado), o voto vai pra status 'golden'.
//   Slug igual a um golden do código só com override=true (substitui o do código).

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { GOLDEN_CASES } from '@/lib/chat/eval/goldens';
import { validateGoldenCase } from '@/lib/chat/eval/spec';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const rows = await db.chatEvalCase.findMany({ orderBy: { createdAt: 'asc' } });
  const dbSlugs = new Set(rows.map((r) => r.slug));
  const cases = [
    ...GOLDEN_CASES.filter((c) => !dbSlugs.has(c.id)).map((c) => ({ id: c.id, category: c.category, source: 'code' as const, enabled: true, sourceFeedbackId: null, spec: c })),
    ...rows.map((r) => ({ id: r.slug, category: r.category, source: 'db' as const, enabled: r.enabled, sourceFeedbackId: r.sourceFeedbackId, spec: r.spec })),
  ];
  return NextResponse.json({ cases });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: { slug?: unknown; category?: unknown; spec?: unknown; enabled?: unknown; feedbackId?: unknown; override?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!body.spec || typeof body.spec !== 'object' || Array.isArray(body.spec)) return NextResponse.json({ error: 'spec obrigatório' }, { status: 400 });
  const checked = validateGoldenCase({ ...(body.spec as Record<string, unknown>), id: body.slug, category: body.category });
  if (!checked.ok) return NextResponse.json({ error: 'caso inválido', details: checked.errors }, { status: 400 });
  const spec = checked.value;
  if (GOLDEN_CASES.some((c) => c.id === spec.id) && body.override !== true) {
    return NextResponse.json({ error: `"${spec.id}" é um golden do código — use outro slug ou override=true` }, { status: 409 });
  }
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'enabled deve ser booleano' }, { status: 400 });

  let sourceFeedbackId: string | null = null;
  if (body.feedbackId !== undefined) {
    if (typeof body.feedbackId !== 'string') return NextResponse.json({ error: 'feedbackId inválido' }, { status: 400 });
    const fb = await db.chatFeedback.findFirst({ where: { id: body.feedbackId, shared: true }, select: { id: true } });
    if (!fb) return NextResponse.json({ error: 'feedback não encontrado' }, { status: 404 });
    sourceFeedbackId = fb.id;
  }

  // id/category vivem nas colunas; o spec guardado é o resto do caso.
  const { id: slug, category, ...rest } = spec;
  const data = { category, spec: rest as unknown as Prisma.InputJsonValue, enabled: (body.enabled as boolean | undefined) ?? true, ...(sourceFeedbackId ? { sourceFeedbackId } : {}) };
  const saved = await db.$transaction(async (tx) => {
    const row = await tx.chatEvalCase.upsert({ where: { slug }, create: { slug, ...data }, update: data });
    if (sourceFeedbackId) await tx.chatFeedback.update({ where: { id: sourceFeedbackId }, data: { status: 'golden' } });
    return row;
  });
  return NextResponse.json({ case: saved });
}
