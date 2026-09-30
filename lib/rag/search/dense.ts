// Busca densa (só com VOYAGE_API_KEY): cosseno por força bruta no app.
// A base global estimada fica abaixo de 1k trechos (≈4 MB a 1024d) — um
// índice ANN não se paga. Os vetores GLOBAL ficam em memória por versão da
// base (LRU de 2); os da conversa são lidos a cada busca (poucos, e mudam
// quando chega anexo novo).

import type { Prisma } from '@prisma/client';
import { db } from '../../db';
import { dot, embedTexts, EMBEDDING_MODEL, fromEmbeddingBytes } from '../embed';
import type { ScopeFilter } from './sql';

interface Vec {
  id: string;
  documentId: string;
  v: Float32Array;
}

const GLOBAL_CACHE = new Map<string, Vec[]>();
const CACHE_SLOTS = 2;
const TOP_K = 40;
const MIN_SCORE = 0.2;

async function loadVectors(where: Prisma.KbChunkWhereInput): Promise<Vec[]> {
  const rows = await db.kbChunk.findMany({
    where: { ...where, embeddingModel: EMBEDDING_MODEL, embedding: { not: null } },
    select: { id: true, documentId: true, docVersion: true, embedding: true, document: { select: { version: true } } },
  });
  return rows
    .filter((r) => r.embedding && r.docVersion === r.document.version)
    .map((r) => ({ id: r.id, documentId: r.documentId, v: fromEmbeddingBytes(r.embedding as Uint8Array) }));
}

async function globalVectors(kbVersion: string): Promise<Vec[]> {
  const hit = GLOBAL_CACHE.get(kbVersion);
  if (hit) {
    GLOBAL_CACHE.delete(kbVersion);
    GLOBAL_CACHE.set(kbVersion, hit);
    return hit;
  }
  const vecs = await loadVectors({ document: { scope: 'GLOBAL', enabled: true, status: 'READY' } });
  GLOBAL_CACHE.set(kbVersion, vecs);
  while (GLOBAL_CACHE.size > CACHE_SLOTS) GLOBAL_CACHE.delete(GLOBAL_CACHE.keys().next().value as string);
  return vecs;
}

export interface DenseHits {
  ids: string[];
  scores: Map<string, number>;
}

/** Uma lista por consulta original (mesma ordem de `queries`). */
export async function denseSearch(queries: string[], f: ScopeFilter, kbVersion: string, signal?: AbortSignal): Promise<DenseHits[]> {
  const pools: Vec[] = [];
  if (f.scope !== 'attachments') pools.push(...(await globalVectors(kbVersion)));
  if (f.scope !== 'knowledge' && f.conversationId) {
    pools.push(
      ...(await loadVectors({
        document: { scope: 'CONVERSATION', conversationId: f.conversationId, messageId: { not: null }, enabled: true, status: 'READY' },
      })),
    );
  }
  const allowed = f.documentIds?.length ? new Set(f.documentIds) : null;
  const pool = allowed ? pools.filter((p) => allowed.has(p.documentId)) : pools;
  if (!pool.length) return queries.map(() => ({ ids: [], scores: new Map() }));
  const qv = await embedTexts(queries, 'query', signal);
  return qv.map((q) => {
    const scored = pool
      .map((p) => ({ id: p.id, s: dot(q, p.v) }))
      .filter((x) => x.s >= MIN_SCORE)
      .sort((a, b) => b.s - a.s)
      .slice(0, TOP_K);
    return { ids: scored.map((x) => x.id), scores: new Map(scored.map((x) => [x.id, x.s])) };
  });
}
