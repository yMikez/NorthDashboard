import { describe, expect, it } from 'vitest';
import { kindMultiplier, RRF_K, rrfFuse } from './fuse';
import { capPerDocument, mergeNeighbours, stripOverlap, type Candidate } from './select';

describe('rrfFuse', () => {
  it('soma w/(k+rank) por lista e guarda a melhor posição de cada ranqueador', () => {
    const fused = rrfFuse([
      { ranker: 'pt', weight: 1, ids: ['a', 'b', 'c'] },
      { ranker: 'simple', weight: 0.6, ids: ['b', 'a'] },
      { ranker: 'pt', weight: 0.7, ids: ['c', 'a'] },
    ]);
    const a = fused.get('a')!;
    expect(a.score).toBeCloseTo(1 / (RRF_K + 1) + 0.6 / (RRF_K + 2) + 0.7 / (RRF_K + 2), 10);
    expect(a.ranks).toEqual({ pt: 1, simple: 2 });
    expect(fused.get('c')!.ranks.pt).toBe(1);
  });

  it('item em várias listas vence item no topo de uma só', () => {
    const fused = rrfFuse([
      { ranker: 'pt', weight: 1, ids: ['solo', 'x', 'multi'] },
      { ranker: 'simple', weight: 0.6, ids: ['multi'] },
      { ranker: 'allTerms', weight: 0.5, ids: ['multi'] },
    ]);
    expect(fused.get('multi')!.score).toBeGreaterThan(fused.get('solo')!.score);
  });
});

describe('kindMultiplier', () => {
  it('memória perde, snapshot só perde sem data na pergunta, anexo da conversa ganha', () => {
    expect(kindMultiplier('memory', 'GLOBAL', { mentionsDate: false })).toBe(0.85);
    expect(kindMultiplier('snapshot', 'GLOBAL', { mentionsDate: false })).toBe(0.8);
    expect(kindMultiplier('snapshot', 'GLOBAL', { mentionsDate: true })).toBe(1);
    expect(kindMultiplier('attachment', 'CONVERSATION', { mentionsDate: false })).toBe(1.15);
    expect(kindMultiplier('policy', 'GLOBAL', { mentionsDate: false })).toBe(1);
  });
});

const cand = (id: string, doc: string, ordinal: number, score: number, content = `conteúdo ${id}`): Candidate => ({
  id,
  documentId: doc,
  ordinal,
  docVersion: 1,
  content,
  headingPath: `Seção ${ordinal}`,
  label: `Doc ${doc} › Seção ${ordinal}`,
  pageStart: null,
  pageEnd: null,
  docTitle: `Doc ${doc}`,
  kind: 'policy',
  scope: 'GLOBAL',
  updatedAt: '2026-09-30T00:00:00.000Z',
  effectiveDate: null,
  fileName: null,
  score,
  ranks: { rrf: score },
});

describe('seleção final', () => {
  it('no máximo 3 trechos por documento, na ordem de relevância', () => {
    const items = [cand('a1', 'A', 1, 9), cand('a2', 'A', 5, 8), cand('b1', 'B', 1, 7), cand('a3', 'A', 9, 6), cand('a4', 'A', 12, 5)];
    expect(capPerDocument(items).map((c) => c.id)).toEqual(['a1', 'a2', 'b1', 'a3']);
  });

  it('funde vizinhos do mesmo documento na posição do melhor, texto na ordem do documento', () => {
    const items = [cand('a3', 'A', 3, 9, 'Parte três.'), cand('b1', 'B', 1, 8), cand('a2', 'A', 2, 7, 'Parte dois.')];
    const passages = mergeNeighbours(items);
    expect(passages.map((p) => p.chunkIds)).toEqual([['a2', 'a3'], ['b1']]);
    expect(passages[0].text).toBe('Parte dois.\n\nParte três.');
    expect(passages[0].ordinal).toBe(2);
    expect(passages[0].score).toBe(9);
    expect(passages[0].headingPath).toBe('Seção 2 · Seção 3');
  });

  it('não funde quando passaria do teto de tokens', () => {
    const big = 'x'.repeat(3000);
    const passages = mergeNeighbours([cand('a1', 'A', 1, 9, big), cand('a2', 'A', 2, 8, big)], 1200);
    expect(passages).toHaveLength(2);
  });

  it('tira a sobreposição repetida entre trechos consecutivos', () => {
    const a = 'Primeira frase longa sobre reembolso da Digistore. Segunda frase que vira sobreposição no próximo.';
    const b = 'Segunda frase que vira sobreposição no próximo.\n\nTerceira frase nova.';
    expect(stripOverlap(a, b)).toBe('Terceira frase nova.');
    expect(stripOverlap('abc', 'sem relação nenhuma com o anterior')).toBe('sem relação nenhuma com o anterior');
  });
});
