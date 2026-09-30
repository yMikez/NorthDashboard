// POST /api/admin/kb/documents/[id]/reindex → 202 { document }
//
// Refaz os trechos (e o contexto/denso) de um documento GLOBAL a partir do
// texto guardado — útil depois de mudar o fatiador/contextualização ou
// quando a indexação anterior falhou. Roda em segundo plano; a lista da aba
// mostra PROCESSING → READY/FAILED.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { logger } from '@/lib/logger';
import { indexDocument } from '@/lib/rag/indexer';
import { invalidateKnowledgeCache, KB_DOCUMENT_SELECT, toKbDocumentDTO } from '@/lib/services/knowledge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const doc = await db.kbDocument.findUnique({ where: { id }, select: { scope: true } });
  if (!doc || doc.scope !== 'GLOBAL') return NextResponse.json({ error: 'documento não encontrado' }, { status: 404 });

  const updated = await db.kbDocument.update({ where: { id }, data: { status: 'PROCESSING', error: null }, select: KB_DOCUMENT_SELECT });
  void indexDocument(id)
    .then((r) => {
      invalidateKnowledgeCache();
      logger.info({ documentId: id, chunks: r.chunks, error: r.error }, '[kb] reindexado');
    })
    .catch((err) => logger.error({ err, documentId: id }, '[kb] reindexação falhou'));
  return NextResponse.json({ document: toKbDocumentDTO(updated) }, { status: 202 });
}
