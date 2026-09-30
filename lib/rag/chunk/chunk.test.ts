import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { estimateTokens } from '../tokens';
import { chunkDocument, pagesFromMeta } from './index';
import { chunkMarkdown, parseMarkdownBlocks } from './markdown';
import { chunkPages } from './pages';
import { chunkSheets } from './sheet';
import { CHUNK_MAX_TOKENS } from './types';

const para = (n: number, word = 'reembolso') =>
  Array.from({ length: n }, (_, i) => `Frase ${i + 1} sobre ${word} da operação com detalhes suficientes para ocupar espaço.`).join(' ');

function table(rows: number): string {
  const lines = ['| Plataforma | Fee | Reserva |', '|---|---|---|'];
  for (let i = 0; i < rows; i++) lines.push(`| plataforma-${i} | ${i}% | ${i * 2}% |`);
  return lines.join('\n');
}

describe('parseMarkdownBlocks', () => {
  it('reconhece título, tabela, lista (com linha em branco entre itens) e código', () => {
    const md = [
      '## Seção',
      '',
      'Texto do parágrafo.',
      '',
      '- item 1',
      '',
      '- item 2',
      '',
      '```ts',
      'const a = 1;',
      '',
      'const b = 2;',
      '```',
      '',
      table(2),
    ].join('\n');
    const kinds = parseMarkdownBlocks(md).map((b) => b.kind);
    expect(kinds).toEqual(['heading', 'paragraph', 'list', 'code', 'table']);
    const code = parseMarkdownBlocks(md).find((b) => b.kind === 'code')!;
    expect(code.text).toContain('const b = 2;');
  });
});

describe('chunkMarkdown — invariantes', () => {
  const doc = [
    '# Documento de teste',
    '',
    'Introdução curta.',
    '',
    '## Seção pequena',
    '',
    'Só uma linha.',
    '',
    '## Seção longa',
    '',
    para(40),
    '',
    para(40, 'chargeback'),
    '',
    table(8),
    '',
    para(30, 'fee'),
    '',
    '## Outra seção',
    '',
    para(6, 'fuso'),
  ].join('\n');
  const chunks = chunkMarkdown(doc, { title: 'Documento de teste' });

  it('nenhum trecho passa do máximo', () => {
    for (const c of chunks) expect(c.tokenCount).toBeLessThanOrEqual(CHUNK_MAX_TOKENS);
  });

  it('tabela pequena nunca é partida', () => {
    const t = table(8);
    const holders = chunks.filter((c) => c.content.includes('| plataforma-0 |'));
    expect(holders).toHaveLength(1);
    expect(holders[0].content).toContain(t);
  });

  it('label carrega título › seção e o H1 único vira só o título', () => {
    expect(chunks.every((c) => c.label.startsWith('Documento de teste'))).toBe(true);
    expect(chunks.some((c) => c.headingPath === 'Seção longa')).toBe(true);
    expect(chunks.every((c) => !c.content.includes('# Documento de teste'))).toBe(true);
  });

  it('seção menor que o mínimo é juntada à vizinha do mesmo pai', () => {
    const small = chunks.find((c) => c.content.includes('Só uma linha.'))!;
    expect(small.content).toContain('Introdução curta.');
    expect(small.headingPath).toContain('Seção pequena');
  });

  it('sobreposição só dentro da mesma seção', () => {
    const longParts = chunks.filter((c) => c.headingPath === 'Seção longa');
    expect(longParts.length).toBeGreaterThan(1);
    // Algum par consecutivo da seção longa compartilha texto (overlap)…
    const shares = longParts.slice(1).some((c, i) => {
      const prevTail = longParts[i].content.slice(-120);
      return c.content.includes(prevTail.slice(prevTail.indexOf(' ') + 1, prevTail.indexOf(' ') + 60));
    });
    expect(shares).toBe(true);
    // …mas o 1º trecho da seção seguinte começa pelo próprio título.
    const next = chunks.find((c) => c.headingPath === 'Outra seção')!;
    expect(next.content.startsWith('## Outra seção')).toBe(true);
  });

  it('todo conteúdo aparece em algum trecho', () => {
    const all = chunks.map((c) => c.content).join('\n');
    for (const line of doc.split('\n').filter((l) => l.trim() && !l.startsWith('# '))) {
      expect(all).toContain(line.trim().slice(0, 40));
    }
  });

  it('tabela maior que o máximo é partida por linhas repetindo o cabeçalho', () => {
    const big = `## Tabela grande\n\n${table(300)}`;
    const parts = chunkMarkdown(big, { title: 'T' });
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(p.content).toContain('| Plataforma | Fee | Reserva |\n|---|---|---|');
      expect(p.tokenCount).toBeLessThanOrEqual(CHUNK_MAX_TOKENS);
    }
    const rows = parts.flatMap((p) => p.content.split('\n').filter((l) => l.startsWith('| plataforma-')));
    expect(rows).toHaveLength(300);
  });

  it('bloco de código nunca é partido, mesmo grande', () => {
    const code = '```\n' + Array.from({ length: 400 }, (_, i) => `linha_de_codigo_${i} = ${i}`).join('\n') + '\n```';
    const parts = chunkMarkdown(`## Código\n\n${para(5)}\n\n${code}\n\n${para(5)}`, { title: 'C' });
    const holders = parts.filter((p) => p.content.includes('linha_de_codigo_0 '));
    expect(holders).toHaveLength(1);
    expect(holders[0].content).toContain('linha_de_codigo_399');
  });

  it('seção grande parte nos H3', () => {
    const md = `## Grande\n\n### Parte A\n\n${para(25)}\n\n### Parte B\n\n${para(25, 'cpa')}`;
    const parts = chunkMarkdown(md, { title: 'G' });
    expect(parts.map((p) => p.headingPath)).toEqual(expect.arrayContaining(['Grande › Parte A', 'Grande › Parte B']));
  });

  it('documentos reais do repositório fatiam dentro do teto', () => {
    const root = path.resolve(__dirname, '../../..');
    for (const f of ['calculo_margem_northscale.md', 'Cohort.md', 'API.md']) {
      const p = path.join(root, f);
      if (!fs.existsSync(p)) continue;
      const parts = chunkMarkdown(fs.readFileSync(p, 'utf8'), { title: f });
      expect(parts.length).toBeGreaterThan(0);
      for (const c of parts) {
        const isCode = /^```/m.test(c.content);
        if (!isCode) expect(c.tokenCount).toBeLessThanOrEqual(CHUNK_MAX_TOKENS);
      }
    }
  });
});

describe('chunkPages', () => {
  it('guarda página, cruza página só com sobra pequena e remove cabeçalho repetido', () => {
    const pages = [1, 2, 3, 4].map((page) => ({
      page,
      text: `Relatório Mensal NorthScale\n\n${page === 2 ? 'Resto curto.' : para(12, `tema${page}`)}\n\nPágina ${page} de 4`,
    }));
    const parts = chunkPages(pages, { title: 'relatorio.pdf' });
    expect(parts.every((p) => !p.content.includes('Relatório Mensal NorthScale'))).toBe(true);
    expect(parts.every((p) => !/Página \d de 4/.test(p.content))).toBe(true);
    const cross = parts.find((p) => p.content.includes('Resto curto.'))!;
    expect(cross.pageEnd).toBeGreaterThanOrEqual(cross.pageStart!);
    expect(parts[0].pageStart).toBe(1);
  });

  it('título heurístico entra no label', () => {
    const parts = chunkPages([{ page: 1, text: `3.2 Política de estorno\n\n${para(4)}` }], { title: 'doc.pdf' });
    expect(parts[0].label).toBe('doc.pdf › 3.2 Política de estorno');
  });

  it('meta.pages malformado vira null e documento sem texto não gera trecho', () => {
    expect(pagesFromMeta({ pages: [{ page: 1, text: '  ' }] })).toBeNull();
    expect(pagesFromMeta(null)).toBeNull();
    expect(chunkDocument({ title: 'x', text: '   ' })).toEqual([]);
  });
});

describe('chunkSheets', () => {
  const sheets = [
    {
      name: 'Transactions',
      headerRow: 8,
      rowCount: 2377,
      columns: [
        { key: 'date', label: 'Transaction Date', type: 'date', stats: { min: '2026-05-01', max: '2026-09-15' } },
        { key: 'amount', label: 'Amount', type: 'number', stats: { min: 0, max: 499, sum: 1515661.29 } },
        { key: 'email', label: 'Email', type: 'text', pii: true },
        { key: 'status', label: 'Status', type: 'text', stats: { top: [{ value: 'SUCCESS', count: 959 }] } },
      ],
      sample: [{ date: '2026-05-01', amount: 199, email: 'cliente@exemplo.com', status: 'SUCCESS' }],
    },
  ];

  it('cartão com colunas, resumo em formato US e dado pessoal fora da amostra', () => {
    const [card] = chunkSheets(sheets, { title: 'TransactionDetails.csv' });
    expect(card.content).toContain('2,377 linhas × 4 colunas');
    expect(card.content).toContain('soma 1,515,661.29');
    expect(card.content).toContain('Email | texto (dado pessoal)');
    expect(card.content).not.toContain('cliente@exemplo.com');
    expect(card.content).toContain('query_attachment_table');
    expect(card.label).toBe('TransactionDetails.csv › aba Transactions');
  });

  it('planilha com muitas colunas parte o cartão sem passar do máximo', () => {
    const wide = [{ name: 'S', rowCount: 10, columns: Array.from({ length: 300 }, (_, i) => ({ key: `c${i}`, label: `Coluna número ${i}`, type: 'text' })) }];
    const parts = chunkSheets(wide, { title: 'wide.csv' });
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(estimateTokens(p.content)).toBeLessThanOrEqual(CHUNK_MAX_TOKENS);
    expect(parts.map((p) => p.content).join('\n')).toContain('Coluna número 299');
  });
});
