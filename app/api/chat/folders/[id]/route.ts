// PATCH  /api/chat/folders/[id] — renomeia { name }.
// DELETE — remove a pasta; as conversas dela voltam pra RAIZ (FK SetNull),
//          nada é apagado.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function ownFolder(userId: string, id: string) {
  const folder = await db.chatFolder.findUnique({
    where: { id },
    select: { userId: true },
  });
  if (!folder) return 'not_found' as const;
  if (folder.userId !== userId) return 'forbidden' as const;
  return 'ok' as const;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const own = await ownFolder(auth.user.id, id);
  if (own === 'not_found') return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (own === 'forbidden') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  let body: { name?: string };
  try {
    body = (await req.json()) as { name?: string };
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const name = (body.name ?? '').trim().slice(0, 60);
  if (!name) return NextResponse.json({ error: 'nome vazio' }, { status: 400 });

  await db.chatFolder.update({ where: { id }, data: { name } });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const own = await ownFolder(auth.user.id, id);
  if (own === 'not_found') return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (own === 'forbidden') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  await db.chatFolder.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
