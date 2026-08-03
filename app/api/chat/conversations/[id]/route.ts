// GET    /api/chat/conversations/[id] — detalhes + mensagens da conversa.
// PATCH  — move pra pasta ({folderId} | null) e/ou renomeia ({title}).
// DELETE — remove a conversa (cascade deleta messages).
//
// Aberto a qualquer usuário autenticado (2026-08-03). Privacidade: chats
// são individuais — GET/PATCH exigem ser o DONO (nem admin lê chat alheio).
// DELETE: dono OU admin (admin mantém a limpeza global que já existia).

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
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
      folderId: conv.folderId,
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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  let body: { folderId?: string | null; title?: string };
  try {
    body = (await req.json()) as { folderId?: string | null; title?: string };
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const conv = await db.conversation.findUnique({
    where: { id },
    select: { userId: true },
  });
  if (!conv) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (conv.userId !== auth.user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const data: { folderId?: string | null; title?: string } = {};

  if ('folderId' in body) {
    if (body.folderId === null) {
      data.folderId = null; // volta pra raiz
    } else if (typeof body.folderId === 'string') {
      const folder = await db.chatFolder.findUnique({
        where: { id: body.folderId },
        select: { userId: true },
      });
      if (!folder || folder.userId !== auth.user.id) {
        return NextResponse.json({ error: 'pasta não encontrada' }, { status: 404 });
      }
      data.folderId = body.folderId;
    }
  }

  if (typeof body.title === 'string' && body.title.trim()) {
    data.title = body.title.trim().slice(0, 80);
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'nada pra atualizar' }, { status: 400 });
  }

  await db.conversation.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const conv = await db.conversation.findUnique({
    where: { id },
    select: { userId: true },
  });
  if (!conv) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Dono apaga o próprio chat; admin mantém a limpeza global (decisão
  // antiga: admin é dono do dashboard — pode remover qualquer conversa).
  if (conv.userId !== auth.user.id && auth.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  await db.conversation.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
