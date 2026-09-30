// GET  /api/admin/kb/documents?scope=GLOBAL → { documents: KbDocumentDTO[] }
// POST /api/admin/kb/documents (multipart: file, title?, kind?, description?, effectiveDate?)
//      → 201 { document, warnings }
//
// Base GLOBAL da IA (admin only). O upload extrai o texto (PDF por página,
// DOCX/HTML → markdown, planilha → estrutura + linhas sem dado pessoal),
// guarda o original em KbFile e indexa em SEGUNDO PLANO (contextualização
// do modelo rápido pode levar ~1 min num documento grande) — a lista mostra
// o status PROCESSING → READY/FAILED. Anexo de conversa NÃO passa por aqui
// (é do dono, /api/chat/attachments).

import path from 'node:path';
import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { logger } from '@/lib/logger';
import { extractFile, isExtractError, EXTRACT_LIMITS, type Extracted } from '@/lib/rag/extract';
import { indexDocument } from '@/lib/rag/indexer';
import { sha256Hex } from '@/lib/rag/normalize';
import { sheetRowsToMarkdown } from '@/lib/rag/chunk/sheet';
import { KB_DOC_KINDS } from '@/lib/rag/seedManifest';
import { invalidateKnowledgeCache, KB_DOCUMENT_SELECT, toKbDocumentDTO } from '@/lib/services/knowledge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const scope = new URL(req.url).searchParams.get('scope') ?? 'GLOBAL';
  // Anexos de conversa são do dono — nem o admin lista por aqui.
  if (scope !== 'GLOBAL') return NextResponse.json({ error: 'scope suportado: GLOBAL' }, { status: 400 });
  const docs = await db.kbDocument.findMany({
    where: { scope: 'GLOBAL' },
    orderBy: [{ kind: 'asc' }, { title: 'asc' }],
    select: KB_DOCUMENT_SELECT,
  });
  return NextResponse.json({ documents: docs.map(toKbDocumentDTO) });
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function formString(form: FormData, key: string, max: number): string {
  const v = form.get(key);
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** Texto indexável do que o extrator devolveu (planilha ganha as linhas). */
function indexableText(ex: Extracted): string {
  if (ex.kind === 'table' && ex.table) {
    const rows = sheetRowsToMarkdown(
      ex.table.sheets.map((s) => ({ name: s.name, columns: s.columns.map((c) => ({ label: c.label, pii: c.pii })), rows: s.rows })),
    );
    return `${ex.text ?? ''}\n\n${rows}`.trim();
  }
  return ex.text ?? '';
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > EXTRACT_LIMITS.maxFileBytes + 64 * 1024) {
    return NextResponse.json({ error: `Arquivo maior que ${Math.round(EXTRACT_LIMITS.maxFileBytes / (1024 * 1024))} MB.` }, { status: 413 });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'envie multipart/form-data com o campo file' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'campo file obrigatório' }, { status: 400 });

  const kindRaw = formString(form, 'kind', 20) || 'reference';
  if (!(KB_DOC_KINDS as readonly string[]).includes(kindRaw)) {
    return NextResponse.json({ error: `kind deve ser ${KB_DOC_KINDS.join(' | ')}` }, { status: 400 });
  }
  const effectiveRaw = formString(form, 'effectiveDate', 10);
  if (effectiveRaw && (!YMD.test(effectiveRaw) || Number.isNaN(Date.parse(effectiveRaw)))) {
    return NextResponse.json({ error: 'effectiveDate deve ser YYYY-MM-DD' }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const sha = sha256Hex(bytes);
  const dup = await db.kbFile.findFirst({ where: { sha256: sha, document: { scope: 'GLOBAL' } }, select: { document: { select: KB_DOCUMENT_SELECT } } });
  if (dup) return NextResponse.json({ error: 'Este arquivo já está na base.', document: toKbDocumentDTO(dup.document) }, { status: 409 });

  let ex: Extracted;
  try {
    ex = await extractFile(bytes, file.name, file.type || undefined);
  } catch (err) {
    if (isExtractError(err)) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    logger.error({ err, fileName: file.name }, '[kb] extração falhou');
    return NextResponse.json({ error: 'Não foi possível ler o arquivo.' }, { status: 422 });
  }
  if (ex.kind === 'image') {
    return NextResponse.json({ error: 'Imagem não tem texto pesquisável — envie PDF, DOCX, MD, TXT, HTML, CSV ou XLSX.' }, { status: 415 });
  }
  const text = indexableText(ex);
  if (!text.trim() && !ex.pages?.length) return NextResponse.json({ error: 'Arquivo sem texto extraível.' }, { status: 422 });

  const baseName = path.basename(file.name).slice(0, 200);
  const title = formString(form, 'title', 200) || baseName.replace(/\.[A-Za-z0-9]{1,10}$/, '') || 'documento';
  const meta: Prisma.InputJsonObject = {
    ...(ex.pages?.length ? { pages: ex.pages } : {}),
    ...(ex.scanned ? { scanned: true } : {}),
    ...(ex.warnings.length ? { warnings: ex.warnings } : {}),
  };

  const doc = await db.kbDocument.create({
    data: {
      scope: 'GLOBAL',
      userId: auth.user.id,
      kind: kindRaw,
      sourceType: 'upload',
      sourceRef: null,
      title,
      description: formString(form, 'description', 300) || null,
      mimeType: ex.mimeType,
      fileName: baseName,
      byteSize: bytes.length,
      pageCount: ex.pageCount ?? null,
      contentHash: sha256Hex(text),
      text,
      meta,
      effectiveDate: effectiveRaw ? new Date(`${effectiveRaw}T12:00:00.000Z`) : null,
      status: 'PROCESSING',
      deliveryMode: 'indexed',
      file: { create: { data: bytes, sha256: sha } },
    },
    select: KB_DOCUMENT_SELECT,
  });

  void indexDocument(doc.id)
    .then((r) => {
      invalidateKnowledgeCache();
      logger.info({ documentId: doc.id, chunks: r.chunks, error: r.error }, '[kb] upload indexado');
    })
    .catch((err) => logger.error({ err, documentId: doc.id }, '[kb] indexação do upload falhou'));

  return NextResponse.json({ document: toKbDocumentDTO(doc), warnings: ex.warnings }, { status: 201 });
}
