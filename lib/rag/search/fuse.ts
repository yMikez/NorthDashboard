// Fusão das listas ranqueadas por RRF (Reciprocal Rank Fusion) e
// multiplicadores por tipo de documento. Puro.
//
// RRF porque as notas dos ranqueadores não são comparáveis entre si
// (ts_rank_cd ≠ word_similarity ≠ cosseno): só a POSIÇÃO é. k=60 é o valor
// do artigo original e amortece a diferença entre 1º e 5º lugar.

import type { KbScopeName, RankerName } from './types';

export const RRF_K = 60;

/** Peso de cada ranqueador (rag.md §4) — multiplicado pelo peso da consulta. */
export const RANKER_WEIGHT: Record<RankerName, number> = {
  pt: 1.0,
  simple: 0.6,
  allTerms: 0.5,
  trigram: 0.3,
  dense: 1.0,
};

export interface RankedList {
  ranker: RankerName;
  weight: number;
  /** Ids em ordem (melhor primeiro). */
  ids: string[];
}

export interface Fused {
  score: number;
  ranks: Partial<Record<RankerName, number>>;
}

export function rrfFuse(lists: RankedList[], k = RRF_K): Map<string, Fused> {
  const out = new Map<string, Fused>();
  for (const list of lists) {
    list.ids.forEach((id, i) => {
      const rank = i + 1;
      const cur = out.get(id) ?? { score: 0, ranks: {} };
      cur.score += list.weight / (k + rank);
      const prev = cur.ranks[list.ranker];
      if (prev == null || rank < prev) cur.ranks[list.ranker] = rank;
      out.set(id, cur);
    });
  }
  return out;
}

export interface MultiplierContext {
  /** A consulta cita data/período (snapshot datado deixa de ser rebaixado). */
  mentionsDate: boolean;
}

/**
 * Autoridade relativa: memória automática é a fonte mais fraca (×0.85);
 * retrato datado (snapshot) perde pra regra vigente salvo quando a pergunta
 * é sobre uma data (×0.8); anexo da conversa atual é o que a pessoa acabou
 * de mandar e tende a ser o assunto (×1.15).
 */
export function kindMultiplier(kind: string, scope: KbScopeName, ctx: MultiplierContext): number {
  if (scope === 'CONVERSATION') return 1.15;
  if (kind === 'memory') return 0.85;
  if (kind === 'snapshot' && !ctx.mentionsDate) return 0.8;
  return 1;
}
