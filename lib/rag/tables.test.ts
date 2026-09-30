import { describe, expect, it } from 'vitest';
import {
  buildParsedTable,
  decodeTableData,
  detectHeader,
  detectKnownExport,
  encodeTableData,
  hydrateSheets,
  inferNumberLocale,
  maskValue,
  parseDateValue,
  parseNumberish,
  piiFromHeader,
  schemaCardText,
  storedSheets,
  type BuildTableOptions,
  type RawCell,
} from './tables';
import { parseDelimited } from './extract/csv';

const OPTS: BuildTableOptions = { format: 'csv', delimiter: ',', maxCells: 1_000_000, maxRows: 100_000, maxColumns: 500 };

// Export SINTÉTICO no formato do "Transaction Details" da SalesBound:
// 4 linhas de preâmbulo + linha vazia, cabeçalho, transações e rodapé "Total".
// Nomes/e-mails inventados (example.com) — nunca o CSV real do repositório.
const SALESBOUND_LIKE = [
  'Transaction Details',
  'Date Range (by transactionDate): 2026-09-01 00:00:00 - 2026-09-15 23:59:59',
  'Campaign Id: 99',
  'Campaign Name: Teste - Phone Team',
  '',
  'date,orderId,orderAgentName,emailAddress,firstName,type,amount,result,custom3',
  '"2026-09-15 22:52:29",AB12CD,Agente.Um,ana.silva@example.com,Ana,Refund,"-2,970.00",Success,"BuyGoods Order"',
  '"2026-09-15 21:13:06",EF34GH,Agente.Dois,bruno@example.com,Bruno,Sale,348.00,"Hard Decline","JVZoo Order"',
  '"2026-09-14 10:00:00",AB12CD,Agente.Um,ana.silva@example.com,Ana,Sale,"2,970.00",Success,"BuyGoods Order"',
  '"2026-09-13 09:30:00",IJ56KL,Agente.Um,carla@example.com,Carla,Void,"1,000.50",Success,"Digistore24 Order"',
  'Total,,,,,,"178,911.78",,',
].join('\n');

function salesbound() {
  const { rows } = parseDelimited(SALESBOUND_LIKE, ',');
  return buildParsedTable([{ name: 'dados', rows }], OPTS);
}

describe('parseNumberish / inferNumberLocale', () => {
  it('en-US e pt-BR com milhar, moeda, parênteses, sinal no fim e %', () => {
    expect(parseNumberish('1,234.56', 'en-US')?.value).toBe(1234.56);
    expect(parseNumberish('1.234,56', 'pt-BR')?.value).toBe(1234.56);
    expect(parseNumberish('R$ 1.234,56', 'pt-BR')).toEqual({ value: 1234.56, currency: 'BRL', percent: false });
    expect(parseNumberish('US$ 12.00', 'en-US')).toEqual({ value: 12, currency: 'USD', percent: false });
    expect(parseNumberish('(12,00)', 'pt-BR')?.value).toBe(-12);
    expect(parseNumberish('-$2,970.00', 'en-US')?.value).toBe(-2970);
    expect(parseNumberish('45-', 'en-US')?.value).toBe(-45);
    expect(parseNumberish('12,5%', 'pt-BR')).toEqual({ value: 12.5, currency: null, percent: true });
    expect(parseNumberish('1,234.56 EUR', 'en-US')?.currency).toBe('EUR');
  });

  it('recusa o que não é número no locale (sem chute)', () => {
    expect(parseNumberish('1.234,56', 'en-US')).toBeNull();
    expect(parseNumberish('12 potes', 'en-US')).toBeNull();
    expect(parseNumberish('AB12', 'pt-BR')).toBeNull();
  });

  it('locale pela maioria da COLUNA: "1,234" sozinho é ambíguo', () => {
    expect(inferNumberLocale(['1,234', '12,50', '3,10'], 'en-US')).toBe('pt-BR');
    expect(inferNumberLocale(['1,234', '12.50', '2,970.00'], 'pt-BR')).toBe('en-US');
    expect(inferNumberLocale(['1,234', '5,678'], 'pt-BR')).toBe('pt-BR');
  });
});

describe('parseDateValue', () => {
  it('ISO com e sem hora; offset explícito vira UTC', () => {
    expect(parseDateValue('2026-09-15', 'MDY')).toEqual({ canonical: '2026-09-15', hasTime: false, utc: false });
    expect(parseDateValue('2026-09-15 22:52:29', 'MDY')?.canonical).toBe('2026-09-15 22:52:29');
    expect(parseDateValue('2026-09-15T22:00:00-03:00', 'MDY')).toEqual({ canonical: '2026-09-16 01:00:00', hasTime: true, utc: true });
  });

  it('barra obedece a ordem da coluna; AM/PM e nome de mês', () => {
    expect(parseDateValue('03/04/2026', 'MDY')?.canonical).toBe('2026-03-04');
    expect(parseDateValue('03/04/2026', 'DMY')?.canonical).toBe('2026-04-03');
    expect(parseDateValue('09/15/2026 10:05 PM', 'MDY')?.canonical).toBe('2026-09-15 22:05:00');
    expect(parseDateValue('Sep 15, 2026', 'MDY')?.canonical).toBe('2026-09-15');
    expect(parseDateValue('15 de set de 2026', 'DMY')?.canonical).toBe('2026-09-15');
    expect(parseDateValue('31/02/2026', 'DMY')).toBeNull();
  });

  it('coluna com dia > 12 prova DMY', () => {
    const t = buildParsedTable([{ name: 'd', rows: [['data', 'v'], ['15/09/2026', '1'], ['03/09/2026', '2']] }], OPTS);
    const col = t.sheets[0].columns[0];
    expect(col).toMatchObject({ type: 'date', dateOrder: 'DMY', dateAmbiguous: false });
    expect(t.sheets[0].rows.map((r) => r[0])).toEqual(['2026-09-15', '2026-09-03']);
  });
});

describe('cabeçalho, preâmbulo e rodapé', () => {
  it('pula o preâmbulo do export estilo SalesBound e tira o rodapé Total das contas', () => {
    const t = salesbound();
    const s = t.sheets[0];
    expect(s.headerRow).toBe(6);
    expect(s.preamble[0]).toBe('Transaction Details');
    expect(s.footer).toHaveLength(1);
    expect(s.rowCount).toBe(4);
    const amount = s.columns.find((c) => c.label === 'amount')!;
    expect(amount).toMatchObject({ type: 'currency', currency: 'USD', numberLocale: 'en-US' });
    // -2970 + 348 + 2970 + 1000.5 — o "Total" do rodapé NÃO entra.
    expect(amount.stats.sum).toBe(1348.5);
    expect(s.columns.find((c) => c.label === 'date')).toMatchObject({ type: 'date', hasTime: true });
    expect(s.columns.find((c) => c.label === 'orderId')?.type).toBe('text');
  });

  it('tabela sem cabeçalho ganha "Coluna N"', () => {
    const rows: RawCell[][] = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
    expect(detectHeader(rows)).toEqual({ index: 0, synthetic: true });
    const t = buildParsedTable([{ name: 'n', rows }], OPTS);
    expect(t.sheets[0].columns.map((c) => c.label)).toEqual(['Coluna 1', 'Coluna 2', 'Coluna 3']);
    expect(t.sheets[0].rowCount).toBe(3);
  });

  it('rótulo repetido vira "X (2)" e célula a mais vira aviso', () => {
    const t = buildParsedTable([{ name: 'r', rows: [['Created by', 'Created by', 'v'], ['a', 'b', '1', 'extra']] }], { ...OPTS, maxColumns: 3 });
    expect(t.sheets[0].columns.map((c) => c.label)).toEqual(['Created by', 'Created by (2)', 'v']);
    expect(t.warnings.join(' ')).toMatch(/mais campos que o cabeçalho/);
  });

  it('teto de células corta linhas com aviso', () => {
    const rows: RawCell[][] = [['a', 'b'], ...Array.from({ length: 10 }, (_, i) => [String(i), String(i)])];
    const t = buildParsedTable([{ name: 'x', rows }], { ...OPTS, maxCells: 8 });
    expect(t.sheets[0]).toMatchObject({ rowCount: 4, droppedRows: 6 });
    expect(t.warnings[0]).toMatch(/só as primeiras 4 linhas/);
  });
});

describe('exports conhecidos', () => {
  it('SalesBound (Central), JVZoo e Digistore (Eastern), ClickBank (Pacífico)', () => {
    expect(salesbound().knownExport).toMatchObject({ id: 'salesbound_transactions', timezone: 'America/Chicago' });
    expect(detectKnownExport(['Product Id', 'Pay Key', 'Pre Key', 'Created', 'Status'], [])).toMatchObject({ id: 'jvzoo_transactions', timezone: 'America/New_York' });
    expect(detectKnownExport(['Date', 'Time', 'Transaction ID', 'Transaction type', 'Gross amount', 'Your earnings'], [])).toMatchObject({
      id: 'digistore_transactions',
      timezone: 'America/New_York',
    });
    expect(detectKnownExport(['Date', 'Receipt', 'Transaction Type', 'Vendor', 'Amount'], [])).toMatchObject({ id: 'clickbank_transactions', timezone: 'America/Los_Angeles' });
    expect(detectKnownExport(['produto', 'valor'], [])).toBeNull();
  });
});

describe('PII', () => {
  it('detecta pelo cabeçalho sem pegar nome de negócio', () => {
    expect(piiFromHeader('emailAddress', false)).toBe('email');
    expect(piiFromHeader('Customer E-mail', false)).toBe('email');
    expect(piiFromHeader('Phone Number', false)).toBe('phone');
    expect(piiFromHeader('IP', false)).toBe('ip');
    expect(piiFromHeader('CPF', false)).toBe('document');
    expect(piiFromHeader('Shipping Address', false)).toBe('address');
    expect(piiFromHeader('Customer First Name', false)).toBe('name');
    expect(piiFromHeader('Affiliate Name', true)).toBeNull();
    expect(piiFromHeader('Product Name', true)).toBeNull();
    expect(piiFromHeader('orderAgentName', true)).toBeNull();
    // "name" puro só é pessoa quando a tabela tem e-mail/telefone.
    expect(piiFromHeader('name', false)).toBeNull();
    expect(piiFromHeader('name', true)).toBe('name');
  });

  it('máscaras por tipo', () => {
    expect(maskValue('ana.silva@example.com', 'email')).toBe('a***@example.com');
    expect(maskValue('+1 (555) 123-4567', 'phone')).toBe('***67');
    expect(maskValue('Ana Maria Silva', 'name')).toBe('A*** M*** S***');
    expect(maskValue('203.0.113.9', 'ip')).toBe('203.0.x.x');
    expect(maskValue('Rua X, 10', 'address')).toBe('***');
  });

  it('cartão de esquema mascara a amostra e não lista valores de coluna PII', () => {
    const card = schemaCardText(salesbound(), 'TransactionDetails.csv');
    expect(card).not.toContain('ana.silva@example.com');
    expect(card).not.toContain('Bruno');
    expect(card).toContain('a***@example.com');
    expect(card).toMatch(/emailAddress — texto · dado pessoal: e-mail/);
    expect(card).toMatch(/firstName — texto · dado pessoal: nome/);
    expect(card).toContain('Export reconhecido: SalesBound');
    expect(card).toContain('America/Chicago');
    expect(card).toMatch(/type — texto · 4 preenchidas · 3 valor\(es\): Sale \(2\) · Refund \(1\) · Void \(1\)/);
    expect(card).toContain('soma 1,348.5');
    expect(card).toContain('Preâmbulo antes do cabeçalho');
    // O período do preâmbulo não pode ser confundido com telefone.
    expect(card).toContain('2026-09-01 00:00:00 - 2026-09-15 23:59:59');
    // Identificador não ganha "valores mais comuns".
    expect(card).toMatch(/orderId — texto · identificador · 4 preenchidas · 3 distintos/);
  });

  it('e-mail em texto livre de coluna comum também sai mascarado', () => {
    const t = buildParsedTable([{ name: 'n', rows: [['nota', 'v'], ['cliente pediu via ze@example.com', '1']] }], OPTS);
    expect(schemaCardText(t, 'n.csv')).not.toContain('ze@example.com');
  });
});

describe('armazenamento', () => {
  it('gzip ida e volta preserva abas e linhas tipadas', () => {
    const t = salesbound();
    const back = hydrateSheets(storedSheets(t), decodeTableData(encodeTableData(t)));
    expect(back[0].rows).toEqual(t.sheets[0].rows);
    expect(back[0].columns).toEqual(t.sheets[0].columns);
  });
});
