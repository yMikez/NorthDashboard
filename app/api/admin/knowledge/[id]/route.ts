// PATCH /api/admin/knowledge/[id] — atualiza campos parciais.
// DELETE                          — remove a entry.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { logger } from '@/lib/logger';
import { invalidateKnowledgeCache } from '@/lib/services/knowledge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  let body: { title?: unknown; content?: unknown; enabled?: unknown; sortOrder?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const data: { title?: string; content?: string; enabled?: boolean; sortOrder?: number } = {};
  if (typeof body.title === 'string') {
    const t = body.title.trim();
    if (!t) return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 });
    data.title = t;
  }
  if (typeof body.content === 'string') {
    if (!body.content.trim()) {
      return NextResponse.json({ error: 'content cannot be empty' }, { status: 400 });
    }
    data.content = body.content;
  }
  if (typeof body.enabled === 'boolean') data.enabled = body.enabled;
  if (typeof body.sortOrder === 'number') data.sortOrder = body.sortOrder;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'no changes' }, { status: 400 });
  }

  try {
    const entry = await db.knowledgeEntry.update({ where: { id }, data });
    invalidateKnowledgeCache();
    return NextResponse.json({ entry });
  } catch (err) {
    logger.error({ err, id }, 'knowledge patch failed');
    return NextResponse.json({ error: 'update failed' }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  try {
    await db.knowledgeEntry.delete({ where: { id } });
    invalidateKnowledgeCache();
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error({ err, id }, 'knowledge delete failed');
    return NextResponse.json({ error: 'delete failed' }, { status: 500 });
  }
}
