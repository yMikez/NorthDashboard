// Seleção final dos trechos: teto por documento (diversidade) e fusão de
// vizinhos (trechos consecutivos do mesmo documento viram UMA passagem —
// o modelo lê a seção contínua em vez de dois pedaços). Puro.

import { estimateTokens } from '../tokens';
import type { KbScopeName, Passage, PassageRanks } from './types';

export const MAX_PER_DOCUMENT = 3;
export const MERGED_MAX_TOKENS = 1200;

export interface Candidate {
  id: string;
  documentId: string;
  ordinal: number;
  docVersion: number;
  content: string;
  headingPath: string;
  label: string;
  pageStart: number | null;
  pageEnd: number | null;
  docTitle: string;
  kind: string;
  scope: KbScopeName;
  updatedAt: string;
  effectiveDate: string | null;
  fileName: string | null;
  /** Nota final de ordenação (RRF × multiplicador; rerank desempata acima). */
  score: number;
  ranks: PassageRanks;
}

/** No máximo N trechos por documento, mantendo a ordem de relevância. */
export function capPerDocument<T extends { documentId: string }>(items: T[], max = MAX_PER_DOCUMENT): T[] {
  const seen = new Map<string, number>();
  return items.filter((c) => {
    const n = seen.get(c.documentId) ?? 0;
    if (n >= max) return false;
    seen.set(c.documentId, n + 1);
    return true;
  });
}

/**
 * Remove do começo de `b` o que repete o fim de `a` (a sobreposição que o
 * fatiador põe entre trechos da mesma seção) — senão a passagem fundida
 * repetiria a frase.
 */
export function stripOverlap(a: string, b: string): string {
  const max = Math.min(a.length, b.length, 600);
  for (let k = max; k >= 20; k--) {
    const head = b.slice(0, k);
    if (a.endsWith(head)) return b.slice(k).replace(/^\s+/, '');
  }
  // Sobreposição com reticências ("…frase") gerada no corte por caracteres.
  if (b.startsWith('…')) {
    const para = b.indexOf('\n\n');
    const first = para >= 0 ? b.slice(1, para) : '';
    if (first && a.includes(first.trim())) return b.slice(para + 2);
  }
  return b;
}

function mergeRanks(a: PassageRanks, b: PassageRanks): PassageRanks {
  const pick = (x?: number, y?: number) => (x == null ? y : y == null ? x : Math.min(x, y));
  return {
    pt: pick(a.pt, b.pt),
    simple: pick(a.simple, b.simple),
    allTerms: pick(a.allTerms, b.allTerms),
    trigram: pick(a.trigram, b.trigram),
    dense: pick(a.dense, b.dense),
    rrf: Math.max(a.rrf, b.rrf),
    rerank: a.rerank == null ? b.rerank : b.rerank == null ? a.rerank : Math.max(a.rerank, b.rerank),
  };
}

function toPassage(c: Candidate): Passage {
  return {
    documentId: c.documentId,
    chunkIds: [c.id],
    docTitle: c.docTitle,
    headingPath: c.headingPath,
    label: c.label,
    text: c.content,
    page: c.pageStart,
    pageEnd: c.pageEnd,
    kind: c.kind,
    scope: c.scope,
    updatedAt: c.updatedAt,
    effectiveDate: c.effectiveDate,
    docVersion: c.docVersion,
    ordinal: c.ordinal,
    fileName: c.fileName,
    score: c.score,
    ranks: c.ranks,
  };
}

/**
 * Funde trechos mantidos com ordinal consecutivo do mesmo documento (teto
 * de 1.200 tokens por passagem). A passagem fica na posição do seu melhor
 * membro; o texto segue a ordem do documento.
 */
export function mergeNeighbours(items: Candidate[], maxTokens = MERGED_MAX_TOKENS): Passage[] {
  const groups: Candidate[][] = [];
  for (const c of items) {
    // Procura um grupo do mesmo documento que encoste neste trecho.
    const siblings = groups.filter((g) => g[0].documentId === c.documentId && g[0].docVersion === c.docVersion);
    const target = siblings.find((g) => {
      const ords = g.map((x) => x.ordinal);
      const touches = ords.includes(c.ordinal - 1) || ords.includes(c.ordinal + 1);
      const tokens = g.reduce((s, x) => s + estimateTokens(x.content), 0) + estimateTokens(c.content);
      return touches && tokens <= maxTokens;
    });
    if (target) target.push(c);
    else groups.push([c]);
  }
  return groups.map((g) => {
    const byOrd = [...g].sort((a, b) => a.ordinal - b.ordinal);
    const best = g[0]; // primeiro inserido = mais relevante
    const passage = toPassage(best);
    if (byOrd.length === 1) return passage;
    let text = byOrd[0].content;
    for (let i = 1; i < byOrd.length; i++) text = `${text}\n\n${stripOverlap(text, byOrd[i].content)}`;
    const headings = [...new Set(byOrd.map((x) => x.headingPath).filter(Boolean))];
    const pages = byOrd.flatMap((x) => [x.pageStart, x.pageEnd]).filter((p): p is number => p != null);
    return {
      ...passage,
      chunkIds: byOrd.map((x) => x.id),
      ordinal: byOrd[0].ordinal,
      text,
      headingPath: headings.join(' · '),
      label: byOrd[0].label,
      page: pages.length ? Math.min(...pages) : null,
      pageEnd: pages.length ? Math.max(...pages) : null,
      score: Math.max(...g.map((x) => x.score)),
      ranks: g.map((x) => x.ranks).reduce(mergeRanks),
    };
  });
}
