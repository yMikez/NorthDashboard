import { describe, expect, it } from 'vitest';
import type { Citation } from '../../types/chat';
import {
  CITE_HREF_PREFIX,
  citationLabel,
  citationNumberFromHref,
  citeMarkersToLinks,
  textForCopy,
  upsertCitation,
} from './citeMarkers';

const cite = (n: number, extra: Partial<Citation> = {}): Citation => ({
  n,
  source: `kb:doc${n}@v1#0`,
  kind: 'kb',
  title: `Doc ${n}`,
  citedText: [],
  ...extra,
});

describe('citeMarkersToLinks', () => {
  it('troca o marcador por link reservado', () => {
    expect(citeMarkersToLinks('Coorte madura em 60 dias. [[cite:1]]', new Set([1]))).toBe(
      `Coorte madura em 60 dias. [1](${CITE_HREF_PREFIX}1)`,
    );
  });
  it('sequência de fontes fica colada ([1][2])', () => {
    expect(citeMarkersToLinks('Texto [[cite:1]] [[cite:2]] fim', new Set([1, 2]))).toBe(
      'Texto [1](#ns-cite-1)[2](#ns-cite-2) fim',
    );
  });
  it('marcador sem fonte some sem quebrar a sequência', () => {
    expect(citeMarkersToLinks('A [[cite:9]] [[cite:1]]', new Set([1]))).toBe('A [1](#ns-cite-1)');
    expect(citeMarkersToLinks('A [[cite:1]] [[cite:9]] [[cite:2]]', new Set([1, 2]))).toBe(
      'A [1](#ns-cite-1)[2](#ns-cite-2)',
    );
    expect(citeMarkersToLinks('forjado [[cite:3]]', new Set())).toBe('forjado');
  });
  it('não come a quebra de linha antes do marcador', () => {
    expect(citeMarkersToLinks('| a | b |\n [[cite:1]]', new Set([1]))).toBe('| a | b |\n [1](#ns-cite-1)');
  });
  it('dentro de bloco de código o marcador é removido (link não renderizaria)', () => {
    const md = 'Veja:\n```\nSELECT 1 [[cite:1]]\n```\ndepois [[cite:1]]';
    expect(citeMarkersToLinks(md, new Set([1]))).toBe('Veja:\n```\nSELECT 1\n```\ndepois [1](#ns-cite-1)');
  });
  it('bloco de código ainda aberto (streaming) também fica limpo', () => {
    expect(citeMarkersToLinks('```\ncódigo [[cite:1]]', new Set([1]))).toBe('```\ncódigo');
  });
  it('texto sem marcador passa intacto', () => {
    const md = 'Sem citação [link](https://x.com)';
    expect(citeMarkersToLinks(md, new Set([1]))).toBe(md);
  });
});

describe('citationNumberFromHref', () => {
  it('reconhece só o href reservado', () => {
    expect(citationNumberFromHref('#ns-cite-12')).toBe(12);
    expect(citationNumberFromHref('#cite-1')).toBeNull();
    expect(citationNumberFromHref('https://x.com/#ns-cite-1')).toBeNull();
    expect(citationNumberFromHref(undefined)).toBeNull();
  });
});

describe('textForCopy', () => {
  it('marcadores viram [n] e as fontes vão no fim', () => {
    const out = textForCopy('Refund 7.2% [[cite:1]] e CB [[cite:2]]', [
      cite(2, { title: 'extrato.pdf — anexo ckabc123', kind: 'attachment', page: 3 }),
      cite(1, { label: 'Cohort.md › Censura' }),
    ]);
    expect(out).toBe('Refund 7.2% [1] e CB [2]\n\nFontes:\n[1] Cohort.md › Censura\n[2] extrato.pdf, p. 3');
  });
  it('sem citações, remove marcadores soltos', () => {
    expect(textForCopy('Oi [[cite:1]]', null)).toBe('Oi');
  });
});

describe('citationLabel / upsertCitation', () => {
  it('tira o sufixo técnico do título de anexo', () => {
    expect(citationLabel({ title: 'planilha.xlsx — anexo cm123_x-9' })).toBe('planilha.xlsx');
    expect(citationLabel({ title: 'Doc', label: 'Doc › Seção' })).toBe('Doc › Seção');
  });
  it('mesmo n atualiza; n novo entra em ordem', () => {
    const a = [cite(1), cite(3)];
    const b = upsertCitation(a, cite(2));
    expect(b.map((c) => c.n)).toEqual([1, 2, 3]);
    const c = upsertCitation(b, cite(1, { citedText: ['trecho'] }));
    expect(c[0].citedText).toEqual(['trecho']);
    expect(c).toHaveLength(3);
    expect(a).toHaveLength(2); // não muta
  });
});
