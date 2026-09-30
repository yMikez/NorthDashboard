// PATCH  /api/admin/kb/documents/[id] {enabled?, title?, description?, kind?, effectiveDate?} → { document }
// DELETE /api/admin/kb/documents/[id]                                                     → 204
//
// Só documentos GLOBAL. Cada origem tem seu dono do conteúdo:
//   - upload: tudo editável e excluível aqui;
//   - repo (docs/kb): só liga/desliga — o texto é do repositório, e o seed
//     recriaria um documento excluído no próximo boot;
//   - espelho de entrada do admin/memória: edita-se na própria entrada (o
//     próximo sync sobrescreveria).
// Mudança de título/tipo reindexa (o título vai no rótulo de cada trecho).

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { logger } from '@/lib/logger';
import { indexDocument } from '@/lib/rag/indexer';
import { bumpKbVersion } from '@/lib/rag/search';
import { KB_DOC_KINDS } from '@/lib/rag/seedManifest';
import { invalidateKnowledgeCache, KB_DOCUMENT_SELECT, kbDocumentOrigin, toKbDocumentDTO } from '@/lib/services/knowledge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

const ORIGIN_MESSAGE = {
  mirror: 'Este documento espelha uma entrada/memória da base — edite pela entrada.',
  repo: 'Documento do repositório (docs/kb): só dá pra ligar/desligar aqui; o texto muda no arquivo.',
} as const;

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const doc = await db.kbDocument.findUnique({ where: { id }, select: { id: true, scope: true, sourceType: true } });
  if (!doc || doc.scope !== 'GLOBAL') return NextResponse.json({ error: 'documento não encontrado' }, { status: 404 });
  const origin = kbDocumentOrigin(doc.sourceType);

  const data: { enabled?: boolean; title?: string; description?: string | null; kind?: string; effectiveDate?: Date | null } = {};
  if (typeof body.enabled === 'boolean') data.enabled = body.enabled;
  if (typeof body.title === 'string') {
    const t = body.title.trim().slice(0, 200);
    if (!t) return NextResponse.json({ error: 'title não pode ficar vazio' }, { status: 400 });
    data.title = t;
  }
  if (body.description === null || typeof body.description === 'string') {
    data.description = typeof body.description === 'string' ? body.description.trim().slice(0, 300) || null : null;
  }
  if (typeof body.kind === 'string') {
    if (!(KB_DOC_KINDS as readonly string[]).includes(body.kind)) {
      return NextResponse.json({ error: `kind deve ser ${KB_DOC_KINDS.join(' | ')}` }, { status: 400 });
    }
    data.kind = body.kind;
  }
  if (body.effectiveDate === null) data.effectiveDate = null;
  else if (typeof body.effectiveDate === 'string') {
    if (!YMD.test(body.effectiveDate) || Number.isNaN(Date.parse(body.effectiveDate))) {
      return NextResponse.json({ error: 'effectiveDate deve ser YYYY-MM-DD ou null' }, { status: 400 });
    }
    data.effectiveDate = new Date(`${body.effectiveDate}T12:00:00.000Z`);
  }
  if (!Object.keys(data).length) return NextResponse.json({ error: 'no changes' }, { status: 400 });

  const contentFields = Object.keys(data).filter((k) => k !== 'enabled');
  if (origin !== 'upload' && contentFields.length) {
    return NextResponse.json({ error: ORIGIN_MESSAGE[origin] }, { status: 409 });
  }
  const relabel = data.title !== undefined || data.kind !== undefined;
  const updated = await db.kbDocument.update({
    where: { id },
    data: { ...data, ...(relabel ? { version: { increment: 1 }, status: 'PROCESSING' as const } : {}) },
    select: KB_DOCUMENT_SELECT,
  });
  bumpKbVersion();
  invalidateKnowledgeCache();
  if (relabel) {
    void indexDocument(id)
      .then(() => invalidateKnowledgeCache())
      .catch((err) => logger.error({ err, documentId: id }, '[kb] reindexação após edição falhou'));
  }
  return NextResponse.json({ document: toKbDocumentDTO(updated) });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const doc = await db.kbDocument.findUnique({ where: { id }, select: { scope: true, sourceType: true } });
  if (!doc || doc.scope !== 'GLOBAL') return NextResponse.json({ error: 'documento não encontrado' }, { status: 404 });
  const origin = kbDocumentOrigin(doc.sourceType);
  if (origin !== 'upload') {
    const message = origin === 'repo' ? 'Documento do repositório: desligue em vez de excluir (o seed o recriaria).' : ORIGIN_MESSAGE.mirror;
    return NextResponse.json({ error: message }, { status: 409 });
  }
  // Trechos, arquivo original e tabela saem em cascata.
  await db.kbDocument.delete({ where: { id } });
  bumpKbVersion();
  invalidateKnowledgeCache();
  return new NextResponse(null, { status: 204 });
}
