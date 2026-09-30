// PATCH /api/admin/kb/memories/[id] {status: 'active'|'rejected', title?, content?} → { memory }
//
// Aprovar = a memória vira documento pesquisável de menor autoridade
// (kind 'memory', nunca fixa no prompt); rejeitar = sai da busca e fica no
// histórico como rejeitada. Dá pra corrigir título/conteúdo na aprovação.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { logger } from '@/lib/logger';
import { MemoryReviewError, reviewMemory } from '@/lib/services/chatMemory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  let body: { status?: unknown; title?: unknown; content?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (body.status !== 'active' && body.status !== 'rejected') {
    return NextResponse.json({ error: "status deve ser 'active' ou 'rejected'" }, { status: 400 });
  }
  try {
    const memory = await reviewMemory(id, {
      status: body.status,
      title: typeof body.title === 'string' ? body.title.slice(0, 120) : undefined,
      content: typeof body.content === 'string' ? body.content.slice(0, 2000) : undefined,
    });
    return NextResponse.json({ memory });
  } catch (err) {
    if (err instanceof MemoryReviewError) return NextResponse.json({ error: err.message }, { status: err.status });
    logger.error({ err, id }, '[kb] revisão de memória falhou');
    return NextResponse.json({ error: 'review failed' }, { status: 500 });
  }
}
