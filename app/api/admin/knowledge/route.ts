// GET /api/admin/knowledge  — lista todas as entradas (admin only).
// POST /api/admin/knowledge — cria uma nova entrada.
//
// Tudo gated por requireAdmin: só ADMINs editam a KB. Membros normais
// só veem o efeito via system prompt do chat (que injeta as entries
// ligadas automaticamente).

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { logger } from '@/lib/logger';
import { invalidateKnowledgeCache } from '@/lib/services/knowledge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const entries = await db.knowledgeEntry.findMany({
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });

  return NextResponse.json({ entries });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: { title?: unknown; content?: unknown; enabled?: unknown; sortOrder?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const content = typeof body.content === 'string' ? body.content : '';
  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 });
  if (!content.trim()) return NextResponse.json({ error: 'content required' }, { status: 400 });

  const enabled = typeof body.enabled === 'boolean' ? body.enabled : true;
  const sortOrder = typeof body.sortOrder === 'number' ? body.sortOrder : 0;

  try {
    const entry = await db.knowledgeEntry.create({
      data: { title, content, enabled, sortOrder },
    });
    invalidateKnowledgeCache();
    return NextResponse.json({ entry }, { status: 201 });
  } catch (err) {
    logger.error({ err }, 'knowledge create failed');
    return NextResponse.json({ error: 'create failed' }, { status: 500 });
  }
}
