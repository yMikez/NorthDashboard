// PATCH /api/admin/chat-quality/feedback/[id] — triagem do admin.
//   Body: { status?: open|triaged|golden|fixed|wontfix, adminNote?: string | null }
//   → { feedback: { id, status, adminNote, updatedAt } }
// Só mexe em voto compartilhado (shared=true): o que o admin não pode ler,
// também não triagem.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { parseFeedbackPatch } from '@/lib/services/chatTelemetry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const parsed = parseFeedbackPatch(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { count } = await db.chatFeedback.updateMany({ where: { id, shared: true }, data: parsed.value });
  if (!count) return NextResponse.json({ error: 'feedback não encontrado' }, { status: 404 });
  const feedback = await db.chatFeedback.findUnique({ where: { id }, select: { id: true, status: true, adminNote: true, updatedAt: true } });
  return NextResponse.json({ feedback });
}
