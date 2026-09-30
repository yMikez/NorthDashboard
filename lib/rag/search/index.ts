// Busca híbrida da base de conhecimento (search_knowledge e "Testar busca").
//
//   consultas (1–4, do modelo) → + sinônimos do dash (≤ 6)
//   → por consulta: FTS ns_pt (OR de lexemas) · ns_simple · "todos os termos"
//     + trigram no rótulo (se o pg_trgm existir) + denso (se houver Voyage)
//   → RRF (k=60) × multiplicador de tipo → 24 candidatos
//   → rerank do modelo rápido (≥ 7 candidatos) → nota ≥ 2
//   → ≤ 3 por documento → funde vizinhos → max_results
//
// Escopo: GLOBAL (ligado, READY, versão atual) + anexos da conversa DO
// TURNO (nunca de outra). Número vem das tools de dados; daqui saem
// definição, regra, metodologia e ressalva — com citação.

import { db } from '../../db';
import { logger } from '../../logger';
import { isDenseEnabled } from '../embed';
import { rerankCandidates } from '../rerank';
import { expandQueries, mentionsDate } from '../synonyms';
import { denseSearch, type DenseHits } from './dense';
import { kindMultiplier, RANKER_WEIGHT, rrfFuse, type RankedList } from './fuse';
import { capPerDocument, mergeNeighbours, type Candidate } from './select';
import { hitTrackingSql, knowledgeEntryHitSql, lexicalSql, trigramSql, wantsTrigram, type ScopeFilter } from './sql';
import { getKbVersion, hasTrigram } from './state';
import type { Passage, SearchInput, SearchResult, SearchScope } from './types';

export type { Passage, PassageRanks, SearchDebug, SearchInput, SearchResult, SearchScope } from './types';
export { bumpKbVersion, hasTrigram } from './state';

export const DEFAULT_MAX_RESULTS = 6;
export const MAX_RESULTS = 10;
const MAX_QUERIES = 4;
const QUERY_MAX_CHARS = 300;
const LIST_TOP = 40;
const FUSED_POOL = 60;
const RERANK_POOL = 24;
const LOW_CONFIDENCE_KEEP = 3;
const DENSE_CONFIDENT = 0.5;

interface LexRow {
  id: string;
  documentId: string;
  r_pt: number;
  r_simple: number;
  all_terms: boolean;
}

interface TrigramRow {
  id: string;
  documentId: string;
  sim: number;
}

/** Consultas do modelo: strings não vazias, cortadas, sem duplicata, ≤ 4. */
export function sanitizeQueries(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  const out: string[] = [];
  for (const q of list) {
    if (typeof q !== 'string') continue;
    const t = q.replace(/\s+/g, ' ').trim().slice(0, QUERY_MAX_CHARS);
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out.slice(0, MAX_QUERIES);
}

export function isSearchScope(v: unknown): v is SearchScope {
  return v === 'all' || v === 'knowledge' || v === 'attachments';
}

function sortedIds<T extends { id: string }>(rows: T[], score: (r: T) => number): string[] {
  return rows
    .filter((r) => score(r) > 0)
    .sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))
    .slice(0, LIST_TOP)
    .map((r) => r.id);
}

async function trackHits(passages: Passage[]): Promise<void> {
  const docIds = [...new Set(passages.map((p) => p.documentId))];
  if (!docIds.length) return;
  await db.$executeRaw(hitTrackingSql(docIds));
  // Entradas do admin e memórias espelhadas: o hitCount da KnowledgeEntry é
  // a base da expulsão de memória (menos usada sai primeiro).
  const mirrored = await db.kbDocument.findMany({
    where: { id: { in: docIds }, sourceType: { in: ['knowledge_entry', 'chat_memory'] }, sourceRef: { not: null } },
    select: { sourceRef: true },
  });
  const entryIds = mirrored.map((d) => d.sourceRef).filter((x): x is string => !!x);
  if (entryIds.length) await db.$executeRaw(knowledgeEntryHitSql(entryIds));
}

export async function searchKnowledge(input: SearchInput): Promise<SearchResult> {
  const startedAt = Date.now();
  const originals = sanitizeQueries(input.queries);
  const maxResults = Math.min(Math.max(Math.trunc(input.maxResults ?? DEFAULT_MAX_RESULTS) || DEFAULT_MAX_RESULTS, 1), MAX_RESULTS);
  const filter: ScopeFilter = {
    scope: input.scope ?? 'all',
    conversationId: input.conversationId ?? null,
    documentIds: (input.documentIds ?? []).filter((id) => typeof id === 'string' && id.trim()).slice(0, 50),
  };
  const expanded = expandQueries(originals);
  const [kbVersion, trigramOn] = await Promise.all([getKbVersion(), hasTrigram()]);
  const denseOn = isDenseEnabled();
  const debugBase = { queries: expanded, trigram: trigramOn, dense: denseOn };
  if (!originals.length) {
    return { passages: [], lowConfidence: true, debug: input.debug ? { ...debugBase, candidates: 0, reranked: false, ms: Date.now() - startedAt } : undefined };
  }

  const [lexical, trigram, dense] = await Promise.all([
    Promise.all(expanded.map((q) => db.$queryRaw<LexRow[]>(lexicalSql(q.text, filter)))),
    trigramOn
      ? Promise.all(originals.filter(wantsTrigram).map((q) => db.$queryRaw<TrigramRow[]>(trigramSql(q, filter))))
      : Promise.resolve([] as TrigramRow[][]),
    denseOn
      ? denseSearch(originals, filter, kbVersion, input.signal).catch((err) => {
          logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[rag] busca densa falhou — seguindo sem');
          return [] as DenseHits[];
        })
      : Promise.resolve([] as DenseHits[]),
  ]);

  const lists: RankedList[] = [];
  expanded.forEach((q, i) => {
    const rows = lexical[i];
    lists.push({ ranker: 'pt', weight: RANKER_WEIGHT.pt * q.weight, ids: sortedIds(rows, (r) => Number(r.r_pt)) });
    lists.push({ ranker: 'simple', weight: RANKER_WEIGHT.simple * q.weight, ids: sortedIds(rows, (r) => Number(r.r_simple)) });
    if (q.original) {
      lists.push({ ranker: 'allTerms', weight: RANKER_WEIGHT.allTerms, ids: sortedIds(rows.filter((r) => r.all_terms), (r) => Number(r.r_pt) + 1e-9) });
    }
  });
  for (const rows of trigram) lists.push({ ranker: 'trigram', weight: RANKER_WEIGHT.trigram, ids: sortedIds(rows, (r) => Number(r.sim)) });
  const denseBest = new Map<string, number>();
  for (const hits of dense) {
    lists.push({ ranker: 'dense', weight: RANKER_WEIGHT.dense, ids: hits.ids });
    for (const [id, s] of hits.scores) denseBest.set(id, Math.max(denseBest.get(id) ?? 0, s));
  }

  const fused = rrfFuse(lists);
  const pool = [...fused].sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0])).slice(0, FUSED_POOL);
  const rows = pool.length
    ? await db.kbChunk.findMany({
        where: { id: { in: pool.map(([id]) => id) } },
        select: {
          id: true, documentId: true, ordinal: true, docVersion: true, content: true, headingPath: true, label: true,
          pageStart: true, pageEnd: true,
          document: { select: { title: true, kind: true, scope: true, updatedAt: true, effectiveDate: true, fileName: true } },
        },
      })
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const dated = originals.some(mentionsDate);

  const candidates: Candidate[] = pool
    .flatMap(([id, f]) => {
      const r = byId.get(id);
      if (!r) return [];
      const score = f.score * kindMultiplier(r.document.kind, r.document.scope, { mentionsDate: dated });
      return [{
        id: r.id,
        documentId: r.documentId,
        ordinal: r.ordinal,
        docVersion: r.docVersion,
        content: r.content,
        headingPath: r.headingPath,
        label: r.label,
        pageStart: r.pageStart,
        pageEnd: r.pageEnd,
        docTitle: r.document.title,
        kind: r.document.kind,
        scope: r.document.scope,
        updatedAt: r.document.updatedAt.toISOString(),
        effectiveDate: r.document.effectiveDate?.toISOString() ?? null,
        fileName: r.document.fileName,
        score,
        ranks: { ...f.ranks, rrf: score },
      }];
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, RERANK_POOL);

  const rerank = await rerankCandidates(
    originals,
    candidates.map((c) => ({ id: c.id, label: c.label, text: c.content })),
    kbVersion,
    input.signal,
  );

  let ordered: Candidate[];
  let lowConfidence: boolean;
  if (rerank) {
    for (const c of candidates) c.ranks.rerank = rerank.get(c.id) ?? 0;
    const relevant = candidates
      .filter((c) => (c.ranks.rerank ?? 0) >= 2)
      .sort((a, b) => (b.ranks.rerank ?? 0) - (a.ranks.rerank ?? 0) || b.score - a.score);
    lowConfidence = relevant.length === 0;
    ordered = lowConfidence ? candidates.slice(0, LOW_CONFIDENCE_KEEP) : relevant;
  } else {
    // Sem rerank (poucos candidatos, sem chave ou falha): confiança vem de
    // algum trecho casar TODOS os termos de uma consulta ou de similaridade
    // densa alta — OR de lexemas sozinho casa trecho de passagem.
    ordered = candidates;
    lowConfidence = !candidates.some((c) => c.ranks.allTerms != null || (denseBest.get(c.id) ?? 0) >= DENSE_CONFIDENT);
  }

  const capped = filter.documentIds?.length ? ordered : capPerDocument(ordered);
  const passages = mergeNeighbours(capped).slice(0, maxResults);

  if (input.trackHits !== false && passages.length) {
    void trackHits(passages).catch((err) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[rag] contagem de uso falhou'));
  }
  return {
    passages,
    lowConfidence: lowConfidence || passages.length === 0,
    debug: input.debug ? { ...debugBase, candidates: candidates.length, reranked: !!rerank, ms: Date.now() - startedAt } : undefined,
  };
}
