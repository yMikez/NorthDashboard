import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SourceRegistry } from './citations';
import { passageSource, passageTitle, splitParagraphs, toSearchResultBlocks } from './present';
import type { Passage } from './search/types';

const searchMock = vi.hoisted(() => vi.fn());
vi.mock('./search', async (orig) => {
  const actual = await orig<typeof import('./search')>();
  return { ...actual, searchKnowledge: searchMock };
});

import { RAG_TOOL_MODULE } from './ragTools';

const kbPassage: Passage = {
  documentId: 'doc1',
  chunkIds: ['c1', 'c2'],
  docTitle: 'Ressalvas de dados',
  headingPath: 'Digistore24 · estornos sem IPN',
  label: 'Ressalvas de dados › Digistore24',
  text: 'Parágrafo um sobre estorno.\n\nParágrafo dois com a ressalva.',
  page: null,
  pageEnd: null,
  kind: 'policy',
  scope: 'GLOBAL',
  updatedAt: '2026-09-30T12:00:00.000Z',
  effectiveDate: '2026-09-30T12:00:00.000Z',
  docVersion: 3,
  ordinal: 4,
  fileName: 'ressalvas-de-dados.md',
  score: 0.05,
  ranks: { pt: 1, rrf: 0.05 },
};

const attPassage: Passage = {
  ...kbPassage,
  documentId: 'att9',
  chunkIds: ['a1'],
  docTitle: 'extrato',
  fileName: 'extrato.pdf',
  kind: 'attachment',
  scope: 'CONVERSATION',
  page: 3,
  pageEnd: 4,
  effectiveDate: null,
};

describe('present', () => {
  it('source estável por versão/ordinal (base) e por página (anexo)', () => {
    expect(passageSource(kbPassage)).toBe('kb:doc1@v3#4');
    expect(passageSource(attPassage)).toBe('anexo:att9#p3');
    expect(passageSource({ ...attPassage, page: null })).toBe('anexo:att9#t4');
  });

  it('título diz onde, que tipo e de quando', () => {
    expect(passageTitle(kbPassage)).toBe(
      'Ressalvas de dados › Digistore24 · estornos sem IPN · política · atualizado 2026-09-30 · vigente em 2026-09-30',
    );
    expect(passageTitle(attPassage)).toBe('extrato.pdf, pp. 3–4 · anexo desta conversa · enviado 2026-09-30');
  });

  it('parágrafos agrupados até ~500 caracteres; tabela grande fica inteira', () => {
    const table = `| a | b |\n|---|---|\n${Array.from({ length: 60 }, (_, i) => `| ${i} | x |`).join('\n')}`;
    const parts = splitParagraphs(`curto um\n\ncurto dois\n\n${table}`);
    expect(parts[0]).toBe('curto um\n\ncurto dois');
    expect(parts[1]).toBe(table);
  });

  it('blocos search_result com citação ligada, registrados no SourceRegistry', () => {
    const sources = new SourceRegistry();
    const blocks = toSearchResultBlocks([kbPassage, attPassage], sources);
    expect(blocks).toHaveLength(2);
    for (const b of blocks) {
      expect(b.type).toBe('search_result');
      expect(b.citations).toEqual({ enabled: true });
      expect(b.content.every((c) => c.type === 'text' && c.text.length > 0)).toBe(true);
    }
    expect(sources.knownSources()).toEqual(['kb:doc1@v3#4', 'anexo:att9#p3']);
    const cit = sources.resolve({
      type: 'search_result_location',
      source: 'kb:doc1@v3#4',
      title: blocks[0].title,
      cited_text: 'Parágrafo dois com a ressalva.',
      search_result_index: 0,
      start_block_index: 0,
      end_block_index: 0,
    });
    expect(cit).toMatchObject({ n: 1, kind: 'kb', documentId: 'doc1', chunkId: 'c1', docVersion: 3, label: 'Ressalvas de dados › Digistore24 · estornos sem IPN' });
    const att = sources.resolve({
      type: 'search_result_location',
      source: 'anexo:att9#p3',
      title: blocks[1].title,
      cited_text: 'x',
      search_result_index: 1,
      start_block_index: 0,
      end_block_index: 0,
    });
    expect(att).toMatchObject({ n: 2, kind: 'attachment', page: 3, label: 'extrato.pdf, pp. 3–4' });
  });
});

describe('search_knowledge (handler)', () => {
  const handler = RAG_TOOL_MODULE.handlers.search_knowledge;
  beforeEach(() => searchMock.mockReset());

  it('declara uma tool com o schema do contrato', () => {
    const tool = RAG_TOOL_MODULE.tools[0];
    expect(tool.name).toBe('search_knowledge');
    expect(tool.input_schema.required).toEqual(['queries']);
    expect(Object.keys(tool.input_schema.properties ?? {})).toEqual(['queries', 'scope', 'document_ids', 'max_results']);
  });

  it('devolve texto curto + search_result e passa a conversa do turno', async () => {
    searchMock.mockResolvedValue({ passages: [kbPassage], lowConfidence: false });
    const sources = new SourceRegistry();
    const out = (await handler({ queries: ['estorno D24', ' '], max_results: 3 }, { conversationId: 'conv1', sources })) as {
      __content: Array<{ type: string; text?: string }>;
      summary: { sources: string[] };
    };
    expect(searchMock).toHaveBeenCalledWith(expect.objectContaining({ queries: ['estorno D24'], scope: 'all', conversationId: 'conv1', maxResults: 3 }));
    expect(out.__content[0].type).toBe('text');
    expect(JSON.parse(out.__content[0].text!)).toEqual({ queries: ['estorno D24'], results: 1, low_confidence: false });
    expect(out.__content[1].type).toBe('search_result');
    expect(out.summary.sources).toEqual(['kb:doc1@v3#4']);
    expect(sources.has('kb:doc1@v3#4')).toBe(true);
  });

  it('sem resultado: low_confidence e nota pra não supor', async () => {
    searchMock.mockResolvedValue({ passages: [], lowConfidence: true });
    const out = (await handler({ queries: ['algo fora da base'] }, {})) as { __content: Array<{ text?: string }> };
    const header = JSON.parse(out.__content[0].text!);
    expect(header.low_confidence).toBe(true);
    expect(header.note).toMatch(/não cobre/);
    expect(out.__content).toHaveLength(1);
  });

  it('valida entrada (queries vazias, scope, anexos fora de conversa, max_results)', async () => {
    expect(await handler({ queries: [] }, {})).toMatchObject({ error: 'invalid_input' });
    expect(await handler({ queries: ['x'], scope: 'tudo' }, {})).toMatchObject({ error: 'invalid_input' });
    expect(await handler({ queries: ['x'], scope: 'attachments' }, {})).toMatchObject({ error: 'invalid_input' });
    expect(await handler({ queries: ['x'], max_results: 50 }, {})).toMatchObject({ error: 'invalid_input' });
    expect(searchMock).not.toHaveBeenCalled();
  });
});
