import { describe, expect, it } from 'vitest';
import { buildKnowledgeBlock, kbDocumentOrigin, mirrorText, type IndexDoc } from './knowledge';

const entry = (id: string, chars: number) => ({ id, title: `Entrada ${id}`, content: 'x'.repeat(chars) });

const docs: IndexDoc[] = [
  { id: 'd1', title: 'Ressalvas de dados', description: 'Buracos conhecidos por plataforma', kind: 'policy', sourceType: 'repo_md', sourceRef: 'docs/kb/ressalvas-de-dados.md' },
  { id: 'd2', title: 'Dicionário de campos', description: 'Unidade de cada campo', kind: 'reference', sourceType: 'repo_md', sourceRef: 'docs/kb/dicionario-campos.md' },
  { id: 'd3', title: 'Entrada a', description: 'fixa', kind: 'knowledge_entry', sourceType: 'knowledge_entry', sourceRef: 'a' },
  { id: 'd4', title: 'Entrada grande', description: 'não coube', kind: 'knowledge_entry', sourceType: 'knowledge_entry', sourceRef: 'big' },
];

describe('bloco fixo da base', () => {
  it('respeita o teto: entrada que não cabe fica fora e é avisada', () => {
    const block = buildKnowledgeBlock([entry('a', 500), entry('big', 5000), entry('c', 300)], docs, { maxPinnedChars: 1200 });
    expect(block.text).toContain('## Entrada a');
    expect(block.text).toContain('## Entrada c');
    expect(block.text).not.toContain('## Entrada big');
    expect(block.overflowIds).toEqual(['big']);
    expect(block.pinnedChars).toBeLessThanOrEqual(1200);
    expect(block.text).toMatch(/passaram do teto.*"Entrada big"/);
  });

  it('índice lista documentos (políticas primeiro), omite a entrada que já está inteira no bloco', () => {
    const block = buildKnowledgeBlock([entry('a', 100)], docs, { maxPinnedChars: 10_000, memoryCount: 4 });
    const index = block.text.slice(block.text.indexOf('# Índice da base pesquisável'));
    expect(index.indexOf('Ressalvas de dados (política)')).toBeLessThan(index.indexOf('Dicionário de campos (referência)'));
    expect(index).not.toContain('- Entrada a');
    expect(index).toContain('- Entrada grande (entrada do admin) — não coube');
    expect(index).toContain('Memórias aprovadas pelo admin: 4');
  });

  it('vazio quando não há nada', () => {
    expect(buildKnowledgeBlock([], []).text).toBe('');
  });

  it('determinístico (mesma entrada → mesmo texto: não quebra o cache do prompt)', () => {
    const a = buildKnowledgeBlock([entry('a', 100)], [...docs].reverse());
    const b = buildKnowledgeBlock([entry('a', 100)], docs);
    expect(a.text).toBe(b.text);
  });
});

describe('espelho da entrada', () => {
  it('memória leva evidência e data; entrada manual é só título + conteúdo', () => {
    const createdAt = new Date('2026-09-20T10:00:00Z');
    expect(mirrorText({ id: '1', title: 'Frete', content: 'Por sessão.', source: 'manual', evidence: null, createdAt })).toBe('# Frete\n\nPor sessão.');
    const mem = mirrorText({ id: '2', title: 'Frete', content: 'Por sessão.', source: 'auto', evidence: 'frete é por sessão', createdAt });
    expect(mem).toContain('# Memória — Frete');
    expect(mem).toContain('> Dito pelo usuário: "frete é por sessão"');
    expect(mem).toContain('2026-09-20');
  });

  it('origem do documento decide o que a aba pode editar', () => {
    expect(kbDocumentOrigin('knowledge_entry')).toBe('mirror');
    expect(kbDocumentOrigin('chat_memory')).toBe('mirror');
    expect(kbDocumentOrigin('repo_md')).toBe('repo');
    expect(kbDocumentOrigin('upload')).toBe('upload');
  });
});
