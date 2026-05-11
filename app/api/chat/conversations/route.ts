// GET /api/chat/conversations — lista conversas do user logado (admin)
//
// Retorna: { conversations: [{ id, title, createdAt, updatedAt, messageCount }] }
// Ordenado por updatedAt desc.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const items = await db.conversation.findMany({
    where: { userId: auth.user.id },
    orderBy: { updatedAt: 'desc' },
    take: 100,
    include: { _count: { select: { messages: true } } },
  });

  return NextResponse.json({
    conversations: items.map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      messageCount: c._count.messages,
    })),
  });
}
