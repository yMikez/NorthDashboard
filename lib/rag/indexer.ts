// Indexação de um KbDocument: texto → trechos (KbChunk) + tsvector
// (ns_pt/ns_simple) + contexto (Contextual Retrieval, só GLOBAL) + embedding
// opcional. Usado pelo seed da base, pelo upload do admin, pelo espelho das
// entradas do admin/memórias E pelos anexos do chat.
//
// Contrato: lê KbDocument.text, KbDocument.meta.pages = [{page, text}]
// (PDF/paginado) ou o cartão de esquema da planilha (KbTable.sheets, ou
// meta.sheets), gera os trechos da versão ATUAL (doc.version) numa transação
// que apaga os de qualquer outra versão, marca READY (ou FAILED com o erro)
// e devolve quantos trechos. Nunca lança por falha de conteúdo: o erro vai
// pro documento (status FAILED) e pro retorno.
//
// Chamadas lentas (modelo rápido pro contexto, Voyage pro denso) acontecem
// ANTES da transação — a transação só escreve.

import type { Prisma } from '@prisma/client';
import { db } from '../db';
import { logger } from '../logger';
import { chunkDocument, fullTextOf, pagesFromMeta, type ChunkDraft } from './chunk';
import { breadcrumb, contextualizeChunks } from './contextualize';
import { EMBEDDING_MODEL, embeddingInput, toEmbeddingBytes, tryEmbedDocuments } from './embed';
import { maskPii, normalizeText, sha256Hex } from './normalize';
import { bumpKbVersion } from './search/state';
import { tsvUpdateSql } from './search/sql';
import { estimateTokens } from './tokens';

export interface IndexOptions {
  /** Gera o contexto de cada trecho com o modelo rápido (default: só GLOBAL). */
  contextualize?: boolean;
}

export interface IndexResult {
  chunks: number;
  /** Motivo quando o documento ficou FAILED. */
  error?: string;
}

/** O conteúdo mudou enquanto indexávamos — a indexação mais nova vence. */
class StaleContentError extends Error {}

function sheetsOf(doc: { meta: Prisma.JsonValue | null; table: { sheets: Prisma.JsonValue } | null }): unknown {
  if (doc.table && Array.isArray(doc.table.sheets)) return doc.table.sheets;
  const meta = doc.meta as { sheets?: unknown } | null;
  return Array.isArray(meta?.sheets) ? meta.sheets : null;
}

export async function indexDocument(documentId: string, opts: IndexOptions = {}): Promise<IndexResult> {
  const doc = await db.kbDocument.findUnique({
    where: { id: documentId },
    select: {
      id: true, scope: true, conversationId: true, title: true, fileName: true, text: true, meta: true,
      version: true, contentHash: true, status: true,
      table: { select: { sheets: true } },
    },
  });
  if (!doc) return { chunks: 0, error: 'documento não existe' };
  if (doc.status === 'EXPIRED') return { chunks: 0, error: 'documento expirado' };

  await db.kbDocument.updateMany({ where: { id: documentId }, data: { status: 'PROCESSING', error: null } });
  try {
    const title = doc.title || doc.fileName || 'documento';
    const src = { title, text: doc.text, pages: pagesFromMeta(doc.meta), sheets: sheetsOf(doc) };
    let drafts: ChunkDraft[] = chunkDocument(src);
    if (!drafts.length) throw new Error('documento sem texto extraível');
    // Anexo é dado do usuário (pode ter cliente): o texto INDEXADO nunca
    // guarda e-mail/telefone/IP crus. O original fica só no KbFile do dono.
    if (doc.scope === 'CONVERSATION') {
      drafts = drafts.map((d) => {
        const content = maskPii(d.content);
        // Rótulo e caminho de títulos também: vão pro tsvector (peso A), pro
        // título do search_result e pra citação gravada na mensagem.
        return { ...d, label: maskPii(d.label), headingPath: maskPii(d.headingPath), content, tokenCount: estimateTokens(content) };
      });
    }

    const fullText = normalizeText(fullTextOf(src));
    const wantContext = opts.contextualize ?? doc.scope === 'GLOBAL';
    const contexts = wantContext ? await contextualizeChunks({ title, text: fullText }, drafts) : drafts.map(breadcrumb);
    const vectors = await tryEmbedDocuments(drafts.map((d, i) => embeddingInput(d.label, contexts[i], d.content)));

    await db.$transaction(
      async (tx) => {
        const cur = await tx.kbDocument.findUnique({ where: { id: documentId }, select: { version: true, contentHash: true } });
        if (!cur || cur.version !== doc.version || cur.contentHash !== doc.contentHash) throw new StaleContentError();
        await tx.kbChunk.deleteMany({ where: { documentId } });
        await tx.kbChunk.createMany({
          data: drafts.map((d, i) => ({
            documentId,
            docVersion: doc.version,
            ordinal: i,
            scope: doc.scope,
            conversationId: doc.conversationId,
            label: d.label,
            headingPath: d.headingPath,
            pageStart: d.pageStart ?? null,
            pageEnd: d.pageEnd ?? null,
            content: d.content,
            context: contexts[i] ?? null,
            tokenCount: d.tokenCount,
            embedding: vectors?.[i] ? toEmbeddingBytes(vectors[i]) : null,
            embeddingModel: vectors?.[i] ? EMBEDDING_MODEL : null,
          })),
        });
        await tx.$executeRaw(tsvUpdateSql(documentId, doc.version));
        await tx.kbDocument.update({
          where: { id: documentId },
          // Anexo (CONVERSATION): o custo inline já foi medido no upload (inclui
          // ~1.600 tokens de imagem por página de PDF) — não sobrescrever com a
          // estimativa só de texto, senão o orçamento inline subestima o PDF.
          data: doc.scope === 'CONVERSATION'
            ? { status: 'READY', error: null }
            : { status: 'READY', error: null, tokenEstimate: estimateTokens(fullText) },
        });
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    bumpKbVersion();
    return { chunks: drafts.length };
  } catch (err) {
    if (err instanceof StaleContentError) {
      logger.info({ documentId }, '[rag] conteúdo mudou durante a indexação — a indexação da versão nova assume');
      return { chunks: 0 };
    }
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    logger.warn({ documentId, err: message }, '[rag] indexação falhou');
    await db.kbDocument.updateMany({ where: { id: documentId }, data: { status: 'FAILED', error: message } }).catch(() => undefined);
    bumpKbVersion();
    return { chunks: 0, error: message };
  }
}

// ── Documentos GLOBAL com origem estável (repo, entrada do admin, memória) ──

export interface GlobalDocInput {
  /** repo_md | knowledge_entry | chat_memory */
  sourceType: string;
  /** 'docs/kb/<arquivo>.md' | KnowledgeEntry.id */
  sourceRef: string;
  kind: string;
  title: string;
  description?: string | null;
  text: string;
  mimeType: string;
  fileName?: string | null;
  effectiveDate?: Date | null;
  userId?: string | null;
  /** Ausente = preserva o que o admin escolheu (ligar/desligar na KB). */
  enabled?: boolean;
}

export type UpsertAction = 'created' | 'updated' | 'unchanged' | 'reindexed';

export interface UpsertResult {
  id: string;
  action: UpsertAction;
  chunks: number;
  error?: string;
}

/** Hash do que muda o índice: texto, título (vai no rótulo), tipo, descrição e vigência. */
export function globalDocHash(input: Pick<GlobalDocInput, 'title' | 'kind' | 'description' | 'effectiveDate' | 'text'>): string {
  return sha256Hex(
    JSON.stringify([input.title, input.kind, input.description ?? null, input.effectiveDate?.toISOString() ?? null, normalizeText(input.text)]),
  );
}

/**
 * Cria/atualiza pelo par (sourceType, sourceRef) e reindexa SÓ se o
 * conteúdo mudou (sha256) ou se a indexação anterior não terminou. Mudou →
 * version+1 (as citações antigas guardam a versão e o trecho citado).
 */
export async function upsertGlobalDocument(input: GlobalDocInput, opts: IndexOptions = {}): Promise<UpsertResult> {
  const contentHash = globalDocHash(input);
  const where = { scope_sourceType_sourceRef: { scope: 'GLOBAL' as const, sourceType: input.sourceType, sourceRef: input.sourceRef } };
  const existing = await db.kbDocument.findUnique({ where, select: { id: true, contentHash: true, status: true, enabled: true } });
  const fields = {
    kind: input.kind,
    title: input.title,
    description: input.description ?? null,
    text: normalizeText(input.text),
    mimeType: input.mimeType,
    fileName: input.fileName ?? null,
    effectiveDate: input.effectiveDate ?? null,
    byteSize: Buffer.byteLength(input.text, 'utf8'),
  };

  if (!existing) {
    const created = await db.kbDocument.create({
      data: {
        ...fields,
        scope: 'GLOBAL',
        sourceType: input.sourceType,
        sourceRef: input.sourceRef,
        userId: input.userId ?? null,
        contentHash,
        enabled: input.enabled ?? true,
        deliveryMode: 'indexed',
        status: 'PENDING',
      },
      select: { id: true },
    });
    const r = await indexDocument(created.id, opts);
    return { id: created.id, action: 'created', ...r };
  }

  if (existing.contentHash === contentHash) {
    if (input.enabled !== undefined && input.enabled !== existing.enabled) {
      await db.kbDocument.update({ where: { id: existing.id }, data: { enabled: input.enabled } });
      bumpKbVersion();
    }
    if (existing.status === 'READY') return { id: existing.id, action: 'unchanged', chunks: 0 };
    const r = await indexDocument(existing.id, opts);
    return { id: existing.id, action: 'reindexed', ...r };
  }

  await db.kbDocument.update({
    where: { id: existing.id },
    data: {
      ...fields,
      contentHash,
      version: { increment: 1 },
      status: 'PENDING',
      error: null,
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    },
  });
  const r = await indexDocument(existing.id, opts);
  return { id: existing.id, action: 'updated', ...r };
}

/** Apaga (com trechos, em cascata) o documento espelhado de uma origem. */
export async function deleteGlobalDocument(sourceType: string, sourceRef: string): Promise<number> {
  const { count } = await db.kbDocument.deleteMany({ where: { scope: 'GLOBAL', sourceType, sourceRef } });
  if (count) bumpKbVersion();
  return count;
}
