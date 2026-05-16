// GET /api/chat/conversations/[id] — detalhes + mensagens da conversa.
// DELETE — remove a conversa (cascade deleta messages).

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const conv = await db.conversation.findUnique({
    where: { id },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!conv) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (conv.userId !== auth.user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  return NextResponse.json({
    conversation: {
      id: conv.id,
      title: conv.title,
      createdAt: conv.createdAt.toISOString(),
      updatedAt: conv.updatedAt.toISOString(),
    },
    messages: conv.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      toolUses: m.toolUses,
      blocks: m.blocks,
      createdAt: m.createdAt.toISOString(),
    })),
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const conv = await db.conversation.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!conv) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // requireAdmin já garante role=ADMIN. Antes havia um check
  // conv.userId === auth.user.id que bloqueava (403 silencioso) deletar
  // conversas criadas sob outro id de usuário (ex: admin re-seedado,
  // sessão antiga) — usuário "não conseguia apagar". Admin é dono do
  // dashboard inteiro; pode deletar qualquer conversa.
  await db.conversation.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
