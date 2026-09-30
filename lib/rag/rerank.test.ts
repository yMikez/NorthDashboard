import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.hoisted(() => vi.fn());
vi.mock('../services/ai', () => ({
  ANTHROPIC_FAST_MODEL: 'claude-haiku-4-5-20251001',
  getAnthropicClient: () => ({ messages: { create } }),
}));

import { contextualizeChunks } from './contextualize';
import { buildRerankPrompt, rerankCandidates } from './rerank';

const cands = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `chunk${i}`, label: `Doc › Seção "${i}"`, text: `texto ${i} `.repeat(200) }));
const reply = (obj: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] });

describe('rerank', () => {
  const key = process.env.ANTHROPIC_API_KEY;
  beforeEach(() => {
    create.mockReset();
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });
  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = key;
  });

  it('prompt com ids curtos, rótulo sem aspas quebrando o atributo e trecho cortado em 900', () => {
    const p = buildRerankPrompt(['estorno D24'], cands(2));
    expect(p).toContain('<trecho id="t1" rotulo="Doc › Seção \'0\'">');
    expect(p).toContain('- estorno D24');
    const first = p.split('</trecho>')[0];
    expect(first.length).toBeLessThan(1100);
  });

  it('pula com 6 candidatos ou menos e sem chave', async () => {
    expect(await rerankCandidates(['q'], cands(6), 'v1')).toBeNull();
    delete process.env.ANTHROPIC_API_KEY;
    expect(await rerankCandidates(['q'], cands(8), 'v1')).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('mapeia t1..tN de volta pros ids, limita a nota e usa cache', async () => {
    create.mockResolvedValue(reply({ scores: [{ id: 't1', score: 3 }, { id: 't2', score: 9 }, { id: 'x', score: 2 }] }));
    const s = await rerankCandidates(['q cache'], cands(7), 'v1');
    expect(s?.get('chunk0')).toBe(3);
    expect(s?.get('chunk1')).toBe(3);
    expect(s?.size).toBe(2);
    const req = create.mock.calls[0][0];
    expect(req.output_config.format.type).toBe('json_schema');
    await rerankCandidates(['q cache'], cands(7), 'v1');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('falha do modelo ou JSON inválido → null (fica a ordem da fusão)', async () => {
    create.mockRejectedValueOnce(new Error('overloaded'));
    expect(await rerankCandidates(['q erro'], cands(7), 'v2')).toBeNull();
    create.mockResolvedValueOnce({ content: [{ type: 'text', text: 'não é json' }] });
    expect(await rerankCandidates(['q json'], cands(7), 'v2')).toBeNull();
  });
});

describe('contextualização', () => {
  const key = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = key;
  });
  const chunks = [
    { label: 'Doc › A', headingPath: 'A', content: 'conteúdo A' },
    { label: 'Doc › B', headingPath: 'B', content: 'conteúdo B' },
  ];

  it('sem chave = breadcrumb, sem chamar o modelo', async () => {
    create.mockReset();
    delete process.env.ANTHROPIC_API_KEY;
    expect(await contextualizeChunks({ title: 'Doc', text: 'texto' }, chunks)).toEqual(['Doc › A', 'Doc › B']);
    expect(create).not.toHaveBeenCalled();
  });

  it('documento em cache_control e falha por trecho vira breadcrumb', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    create.mockReset();
    create
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Trecho A trata do reembolso da D24.' }] })
      .mockRejectedValueOnce(new Error('timeout'));
    const out = await contextualizeChunks({ title: 'Doc', text: 'texto do documento' }, chunks);
    expect(out).toEqual(['Trecho A trata do reembolso da D24.', 'Doc › B']);
    const first = create.mock.calls[0][0];
    expect(first.messages[0].content[0].cache_control).toEqual({ type: 'ephemeral' });
  });
});
