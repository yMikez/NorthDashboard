// POST   /api/chat/messages/[id]/feedback — grava (ou troca) o voto 👍/👎 do
//        usuário atual numa resposta.
//        Body: { rating: 1 | -1, reasons?: string[], comment?, expected?, shared? }
//        → { feedback: { rating, reasons, comment, expected, shared } }
// DELETE — retira o voto (clicar de novo no mesmo botão) → 204.
//
// Só o DONO da conversa vota (mesma regra de privacidade do GET da conversa:
// nem admin lê chat alheio). `shared` (default true, checkbox visível no 👎)
// é o consentimento pro admin ler pergunta + resposta na aba de qualidade.
// Um voto por (mensagem, usuário): trocar de 👍 pra 👎 atualiza a linha.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth/guard';
import { logger } from '@/lib/logger';
import { parseFeedbackInput } from '@/lib/services/chatTelemetry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ID_RE = /^[A-Za-z0-9_-]{8,40}$/;

/** A mensagem existe, é uma resposta do assistente e a conversa é do usuário? */
async function ownedAssistantMessage(messageId: string, userId: string): Promise<boolean> {
  const msg = await db.message.findUnique({
    where: { id: messageId },
    select: { role: true, conversation: { select: { userId: true } } },
  });
  return !!msg && msg.role === 'assistant' && msg.conversation.userId === userId;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!ID_RE.test(id)) return NextResponse.json({ error: 'mensagem não encontrada' }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const parsed = parseFeedbackInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  // 404 (não 403) pra mensagem de outro usuário: não confirma que ela existe.
  if (!(await ownedAssistantMessage(id, auth.user.id))) {
    return NextResponse.json({ error: 'mensagem não encontrada' }, { status: 404 });
  }

  const v = parsed.value;
  try {
    const existing = await db.chatFeedback.findUnique({
      where: { messageId_userId: { messageId: id, userId: auth.user.id } },
      select: { rating: true },
    });
    const saved = await db.chatFeedback.upsert({
      where: { messageId_userId: { messageId: id, userId: auth.user.id } },
      create: { messageId: id, userId: auth.user.id, ...v },
      // Voto que muda de lado volta pra triagem: a análise anterior do admin
      // era sobre outra avaliação.
      update: { ...v, ...(existing && existing.rating !== v.rating ? { status: 'open', adminNote: null } : {}) },
      select: { rating: true, reasons: true, comment: true, expected: true, shared: true },
    });
    return NextResponse.json({ feedback: saved });
  } catch (err) {
    logger.error({ err, messageId: id }, '[chat] feedback: falha ao gravar');
    return NextResponse.json({ error: 'falha ao gravar o feedback' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!ID_RE.test(id)) return NextResponse.json({ error: 'mensagem não encontrada' }, { status: 404 });
  if (!(await ownedAssistantMessage(id, auth.user.id))) {
    return NextResponse.json({ error: 'mensagem não encontrada' }, { status: 404 });
  }
  await db.chatFeedback.deleteMany({ where: { messageId: id, userId: auth.user.id } });
  return new NextResponse(null, { status: 204 });
}
