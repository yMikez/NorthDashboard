// GET /api/chat/conversations — lista conversas do user logado.
// Aberto a qualquer usuário autenticado (2026-08-03) — cada um vê SÓ as
// próprias conversas (where userId).
//
// Retorna: { conversations: [{ id, title, folderId, createdAt, updatedAt,
//                              messageCount }] }
// Ordenado por updatedAt desc.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const items = await db.conversation.findMany({
    where: { userId: auth.user.id },
    orderBy: { updatedAt: 'desc' },
    take: 200,
    include: { _count: { select: { messages: true } } },
  });

  return NextResponse.json({
    conversations: items.map((c) => ({
      id: c.id,
      title: c.title,
      folderId: c.folderId,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      messageCount: c._count.messages,
    })),
  });
}
