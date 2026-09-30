import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_TOOL_MODULE,
  citationChunks,
  contiguousRuns,
  findSection,
  markdownSections,
  pagesLabel,
  parsePageSpec,
  parseTableQuery,
  runTableQuery,
  type TableQuery,
} from './attachmentTools';
import { buildParsedTable, type ParsedSheet } from './tables';
import { parseDelimited } from './extract/csv';
import type { AttachmentRef, ToolContext } from '../ai/toolTypes';

// Planilha SINTÉTICA (formato do export da SalesBound, fuso Central).
const CSV = [
  'Transaction Details',
  'Date Range (by transactionDate): 2026-09-01 00:00:00 - 2026-09-30 23:59:59',
  '',
  'date,orderId,orderAgentName,type,amount,qty,result,note',
  '"2026-09-15 22:52:29",A1,Agente.Um,Refund,"-100.00",1,Success,',
  '"2026-09-15 21:13:06",B2,Agente.Dois,Sale,300.00,2,Success,cliente voltou',
  '"2026-09-14 10:00:00",A1,Agente.Um,Sale,100.00,1,Success,',
  '"2026-09-14 09:00:00",C3,Agente.Dois,Sale,50.50,1,"Hard Decline",',
  '"2026-09-07 23:30:00",D4,Agente.Um,Void,200.00,3,Success,',
].join('\n');

function sheet(): ParsedSheet[] {
  const { rows } = parseDelimited(CSV, ',');
  const t = buildParsedTable([{ name: 'dados', rows }], { format: 'csv', delimiter: ',', maxCells: 1e6, maxRows: 1e5, maxColumns: 100 });
  expect(t.knownExport?.timezone).toBe('America/Chicago');
  return t.sheets;
}

const run = (q: TableQuery) => runTableQuery(sheet(), q, { sourceTz: 'America/Chicago' });

describe('read_attachment: páginas e seções', () => {
  it('parsePageSpec: intervalos, lista, travessão e teto por chamada', () => {
    expect(parsePageSpec('3-7', 10).pages).toEqual([3, 4, 5, 6, 7]);
    expect(parsePageSpec('1-3,8, 2', 10).pages).toEqual([1, 2, 3, 8]);
    expect(parsePageSpec('4–5', 10).pages).toEqual([4, 5]);
    expect(parsePageSpec('1-40', 100)).toEqual({ pages: Array.from({ length: 20 }, (_, i) => i + 1), truncated: true });
    expect(parsePageSpec('9-12', 10).pages).toEqual([9, 10]);
    expect(() => parsePageSpec('11', 10)).toThrow(/10 páginas/);
    expect(() => parsePageSpec('abc', 10)).toThrow(/pages inválido/);
  });

  it('contiguousRuns agrupa páginas seguidas num recorte só; rótulo não inventa intervalo', () => {
    expect(contiguousRuns([3, 4, 5, 9, 11, 12])).toEqual([[3, 4, 5], [9], [11, 12]]);
    expect(pagesLabel([1, 2, 3, 8])).toBe('p. 1–3, 8');
    expect(pagesLabel([7])).toBe('p. 7');
  });

  it('citationChunks divide por parágrafo sem passar do teto', () => {
    const chunks = citationChunks(`${'a'.repeat(700)}\n\n${'b'.repeat(700)}\n\n${'c'.repeat(3000)}`, 1200);
    expect(chunks.map((c) => c.length)).toEqual([700, 700, 1200, 1200, 600]);
    expect(citationChunks('  \n\n ')).toEqual([]);
  });

  it('seções markdown: acha por título sem acento e ignora # dentro de código', () => {
    const md = '# Política\nIntro\n## Reembolso\nPrazo de 60 dias.\n```\n# não é título\n```\n## Chargeback\nDisputa.\n# Anexos\nx';
    expect(markdownSections(md).map((s) => s.heading)).toEqual(['Política', 'Reembolso', 'Chargeback', 'Anexos']);
    const hit = findSection(md, 'reembolso');
    expect(hit?.body).toBe('## Reembolso\nPrazo de 60 dias.\n```\n# não é título\n```');
    expect(findSection(md, 'politica')?.body).toContain('Disputa.');
    expect(findSection(md, 'inexistente')).toBeNull();
  });
});

describe('query_attachment_table: executor determinístico', () => {
  it('filtros de texto (sem caixa/acento), número, lista e vazio', () => {
    expect(run({ filters: [{ column: 'type', op: 'eq', value: 'sale' }] }).total_matched).toBe(3);
    expect(run({ filters: [{ column: 'TYPE', op: 'neq', value: 'Sale' }] }).total_matched).toBe(2);
    expect(run({ filters: [{ column: 'amount', op: 'gt', value: 0 }] }).total_matched).toBe(4);
    expect(run({ filters: [{ column: 'amount', op: 'between', value: ['50', 200] }] }).total_matched).toBe(3);
    expect(run({ filters: [{ column: 'orderId', op: 'in', value: ['A1', 'D4'] }] }).total_matched).toBe(3);
    expect(run({ filters: [{ column: 'result', op: 'contains', value: 'decline' }] }).total_matched).toBe(1);
    expect(run({ filters: [{ column: 'note', op: 'is_null' }] }).total_matched).toBe(4);
    expect(run({ filters: [{ column: 'note', op: 'not_null' }] }).total_matched).toBe(1);
  });

  it('agrupa, soma e ordena; totals cobrem TODAS as linhas filtradas', () => {
    const r = run({ groupBy: [{ column: 'type' }], metrics: [{ op: 'count' }, { op: 'sum', column: 'amount' }] });
    expect(r.columns).toEqual(['type', 'count', 'sum(amount)']);
    expect(r.rows).toEqual([
      { type: 'Sale', count: 3, 'sum(amount)': 450.5 },
      { type: 'Refund', count: 1, 'sum(amount)': -100 },
      { type: 'Void', count: 1, 'sum(amount)': 200 },
    ]);
    expect(r.totals).toEqual({ count: 5, 'sum(amount)': 550.5 });
    expect(r.groups).toBe(3);
    expect(r.profile.amount).toMatchObject({ type: 'currency', non_null: 5, sum: 550.5, min: -100, max: 300 });
  });

  it('razão de somas, share (pontos percentuais), média, mediana e distintos', () => {
    const r = run({
      filters: [{ column: 'type', op: 'eq', value: 'Sale' }],
      metrics: [
        { op: 'ratio_of_sums', column: 'amount', den: 'qty', as: 'preco_medio_unit' },
        { op: 'avg', column: 'amount' },
        { op: 'median', column: 'amount' },
        { op: 'count_distinct', column: 'orderAgentName' },
      ],
    });
    expect(r.rows).toEqual([{ preco_medio_unit: 112.625, 'avg(amount)': 150.166667, 'median(amount)': 100, 'count_distinct(orderAgentName)': 2 }]);
    const share = run({ groupBy: [{ column: 'orderAgentName' }], metrics: [{ op: 'share' }], sort: [{ key: 'orderAgentName', dir: 'asc' }] });
    expect(share.rows).toEqual([
      { orderAgentName: 'Agente.Dois', share_pct: 40 },
      { orderAgentName: 'Agente.Um', share_pct: 60 },
    ]);
  });

  it('data: filtro por dia; agrupamento no fuso do dashboard (Central → BRT vira o dia)', () => {
    expect(run({ filters: [{ column: 'date', op: 'eq', value: '2026-09-15' }] }).total_matched).toBe(2);
    expect(run({ filters: [{ column: 'date', op: 'lte', value: '2026-09-14' }] }).total_matched).toBe(3);
    // 22:52 de 15/09 em Chicago (CDT, UTC-5) = 00:52 de 16/09 em São Paulo (UTC-3).
    const brt = run({ groupBy: [{ column: 'date', dateTrunc: 'day', tz: 'America/Sao_Paulo' }], sort: [{ key: 'date (day, America/Sao_Paulo)', dir: 'asc' }] });
    expect(brt.rows).toEqual([
      { 'date (day, America/Sao_Paulo)': '2026-09-08', count: 1 },
      { 'date (day, America/Sao_Paulo)': '2026-09-14', count: 2 },
      { 'date (day, America/Sao_Paulo)': '2026-09-15', count: 1 },
      { 'date (day, America/Sao_Paulo)': '2026-09-16', count: 1 },
    ]);
    const onBrtDay = run({ filters: [{ column: 'date', op: 'eq', value: '2026-09-16', tz: 'America/Sao_Paulo' }] });
    expect(onBrtDay.total_matched).toBe(1);
  });

  it('semana de segunda a domingo', () => {
    const r = run({ groupBy: [{ column: 'date', dateTrunc: 'week' }], metrics: [{ op: 'count' }], sort: [{ key: 'date (week)', dir: 'asc' }] });
    expect(r.rows).toEqual([
      { 'date (week)': '2026-09-07', count: 1 },
      { 'date (week)': '2026-09-14', count: 4 },
    ]);
  });

  it('listagem: _row = linha de dados, select, ordenação e paginação', () => {
    const r = run({ select: ['orderId', 'amount'], sort: [{ key: 'amount', dir: 'desc' }], limit: 2, offset: 1 });
    expect(r.columns).toEqual(['_row', 'orderId', 'amount']);
    expect(r.rows).toEqual([
      { _row: 5, orderId: 'D4', amount: 200 },
      { _row: 3, orderId: 'A1', amount: 100 },
    ]);
    expect(r).toMatchObject({ total_matched: 5, returned: 2, offset: 1, has_more: true });
  });

  it('erros dizem como corrigir', () => {
    expect(() => run({ filters: [{ column: 'valor', op: 'eq', value: 1 }] })).toThrow(/coluna "valor" não existe[\s\S]*Colunas: date, orderId/);
    expect(() => run({ metrics: [{ op: 'sum', column: 'type' }] })).toThrow(/sum exige coluna numérica/);
    expect(() => run({ groupBy: [{ column: 'type', dateTrunc: 'day' }] })).toThrow(/date_trunc só vale/);
    expect(() => run({ filters: [{ column: 'date', op: 'eq', value: '2026-09-15', tz: 'Marte/Base' }] })).toThrow(/fuso inválido/);
    expect(() => run({ groupBy: [{ column: 'type' }], sort: [{ key: 'xyz' }] })).toThrow(/sort.key "xyz"/);
  });

  it('parseTableQuery valida op e aceita group_by como texto', () => {
    expect(parseTableQuery({ attachment_id: 'x', group_by: ['type'], metrics: [{ op: 'count' }] }).groupBy).toEqual([{ column: 'type', dateTrunc: undefined, tz: undefined }]);
    expect(() => parseTableQuery({ filters: [{ column: 'a', op: 'like' }] })).toThrow(/filters.op inválido/);
  });
});

describe('ATTACHMENT_TOOL_MODULE', () => {
  it('uma tool ↔ um handler', () => {
    expect(ATTACHMENT_TOOL_MODULE.tools.map((t) => t.name).sort()).toEqual(Object.keys(ATTACHMENT_TOOL_MODULE.handlers).sort());
    expect(Object.keys(ATTACHMENT_TOOL_MODULE.handlers).sort()).toEqual(['query_attachment_table', 'read_attachment']);
  });

  it('só aceita ids de anexos desta conversa (antes de tocar no banco)', async () => {
    const empty: ToolContext = { attachments: [] };
    await expect(ATTACHMENT_TOOL_MODULE.handlers.read_attachment({ attachment_id: 'x' }, empty)).resolves.toEqual({
      error: 'invalid_input',
      message: 'Esta conversa não tem anexos.',
    });
    const ref: AttachmentRef = { id: 'att123456', title: 'vendas.csv', fileName: 'vendas.csv', mimeType: 'text/csv', deliveryMode: 'table', pageCount: null, messageId: 'm1' };
    const res = (await ATTACHMENT_TOOL_MODULE.handlers.query_attachment_table({ attachment_id: 'outro-id' }, { attachments: [ref] })) as { error: string; message: string };
    expect(res.error).toBe('invalid_input');
    expect(res.message).toContain('att123456 (vendas.csv)');
  });
});
