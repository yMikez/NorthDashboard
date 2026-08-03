// GET  /api/chat/folders — pastas/projetos do usuário logado.
// POST — cria pasta { name }.
//
// Pastas são POR USUÁRIO (cada um organiza os próprios chats). Qualquer
// usuário autenticado.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FOLDERS = 50;
const MAX_NAME = 60;

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const folders = await db.chatFolder.findMany({
    where: { userId: auth.user.id },
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { conversations: true } } },
  });

  return NextResponse.json({
    folders: folders.map((f) => ({
      id: f.id,
      name: f.name,
      createdAt: f.createdAt.toISOString(),
      conversationCount: f._count.conversations,
    })),
  });
}

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  let body: { name?: string };
  try {
    body = (await req.json()) as { name?: string };
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const name = (body.name ?? '').trim().slice(0, MAX_NAME);
  if (!name) {
    return NextResponse.json({ error: 'nome vazio' }, { status: 400 });
  }

  const count = await db.chatFolder.count({ where: { userId: auth.user.id } });
  if (count >= MAX_FOLDERS) {
    return NextResponse.json({ error: `limite de ${MAX_FOLDERS} pastas` }, { status: 400 });
  }

  const folder = await db.chatFolder.create({
    data: { userId: auth.user.id, name },
    select: { id: true, name: true },
  });
  return NextResponse.json({ folder });
}
