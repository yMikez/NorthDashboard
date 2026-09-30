// GET /api/admin/knowledge  — lista todas as entradas (admin only).
// POST /api/admin/knowledge — cria uma nova entrada.
//
// Tudo gated por requireAdmin: só ADMINs editam a KB. Membros normais
// só veem o efeito no chat: entrada `pinned` (default) vai inteira no
// system prompt (até o teto); não fixa entra só pela busca. Toda entrada
// ligada é espelhada na base pesquisável (syncKnowledgeEntry) — é o que
// deixa a IA citar a regra do admin.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { logger } from '@/lib/logger';
import { invalidateKnowledgeCache, syncKnowledgeEntry } from '@/lib/services/knowledge';

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

  let body: { title?: unknown; content?: unknown; enabled?: unknown; sortOrder?: unknown; pinned?: unknown };
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
  const pinned = typeof body.pinned === 'boolean' ? body.pinned : true;

  try {
    const entry = await db.knowledgeEntry.create({
      data: { title, content, enabled, sortOrder, pinned },
    });
    invalidateKnowledgeCache();
    // Espelho na busca: falha aqui não desfaz a entrada (o próximo seed
    // ressincroniza), só fica no log.
    await syncKnowledgeEntry(entry.id).catch((err) => logger.warn({ err, id: entry.id }, 'knowledge sync failed'));
    return NextResponse.json({ entry }, { status: 201 });
  } catch (err) {
    logger.error({ err }, 'knowledge create failed');
    return NextResponse.json({ error: 'create failed' }, { status: 500 });
  }
}
