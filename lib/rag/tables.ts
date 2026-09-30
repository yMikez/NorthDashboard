// Planilha/CSV anexada → tabela TIPADA (ParsedTable), cartão de esquema pro
// modelo e armazenamento compacto (KbTable.data = gzip do JSON das linhas).
// Puro: sem banco, testável no vitest.
//
// Por que tipar no servidor: todo número de planilha sai de uma consulta
// determinística (query_attachment_table). Pra "soma de amount" dar certo,
// "1.234,56" (pt-BR), "1,234.56" (en-US), "R$ 12,00", "(12.00)" e o
// `="-144.00"` da Digistore precisam virar o MESMO tipo de número — e isso
// se decide por COLUNA (o "1,234" sozinho é ambíguo; a coluna inteira não).
//
// O cartão de esquema é o que o modelo vê do arquivo: colunas, tipos, perfil
// (mín/máx/soma, valores mais comuns) e 5 linhas de amostra com dado pessoal
// MASCARADO. Ele NÃO substitui a consulta — só orienta qual consulta fazer.

import { gzipSync, gunzipSync } from 'node:zlib';
import { SALESBOUND_CSV_TIMEZONE } from '../connectors/salesbound/transactionsCsv';
import { maskPii } from './normalize';

// ─── Tipos ───────────────────────────────────────────────────────────────

/** Célula como sai do leitor (CSV = string; XLSX pode trazer número). */
export type RawCell = string | number | null;

export interface RawSheet {
  name: string;
  /** Todas as linhas, inclusive preâmbulo antes do cabeçalho. */
  rows: RawCell[][];
}

export type ColumnType = 'number' | 'currency' | 'percent' | 'date' | 'text';
export type PiiKind = 'email' | 'phone' | 'name' | 'address' | 'ip' | 'document';
export type NumberLocale = 'en-US' | 'pt-BR';
export type DateOrder = 'MDY' | 'DMY';

/** Célula tipada: número (number/currency/percent), data canônica ou texto. */
export type Cell = string | number | null;

export interface ColumnStats {
  nonNull: number;
  /** Valores fora do tipo da coluna (ficam como texto e não entram em soma). */
  invalid: number;
  distinct: number;
  /** distinct parou de contar no teto. */
  distinctCapped: boolean;
  min?: number | string;
  max?: number | string;
  sum?: number;
  top?: Array<{ value: string; count: number }>;
}

export interface TableColumn {
  /** Chave estável (c0, c1…) — o rótulo pode repetir no arquivo. */
  key: string;
  label: string;
  type: ColumnType;
  pii: PiiKind | null;
  numberLocale?: NumberLocale;
  /** Moeda (USD, BRL…) quando o valor traz símbolo ou o export é conhecido. */
  currency?: string | null;
  dateOrder?: DateOrder;
  /** Ordem dia/mês não pôde ser provada pelos dados (nenhum dia > 12). */
  dateAmbiguous?: boolean;
  hasTime?: boolean;
  /** Datas vieram com fuso explícito (Z/±hh:mm) e foram convertidas pra UTC. */
  utc?: boolean;
  /** Coluna de identificador (id, sku, receipt…) — sem soma no perfil. */
  identifier?: boolean;
  stats: ColumnStats;
}

export interface ParsedSheet {
  name: string;
  /** Linha (1-based, na aba/arquivo) do cabeçalho; 0 = sem cabeçalho (rótulos gerados). */
  headerRow: number;
  preamble: string[];
  footer: string[];
  columns: TableColumn[];
  rows: Cell[][];
  rowCount: number;
  /** Linhas que ficaram de fora pelo teto de células. */
  droppedRows: number;
}

export type KnownExportId =
  | 'salesbound_transactions'
  | 'jvzoo_transactions'
  | 'digistore_transactions'
  | 'clickbank_transactions';

export interface KnownExport {
  id: KnownExportId;
  label: string;
  /** Fuso IANA do relógio das datas do arquivo. */
  timezone: string;
  notes: string[];
}

export type TableFormat = 'csv' | 'tsv' | 'xlsx' | 'json';

export interface ParsedTable {
  format: TableFormat;
  encoding?: string;
  delimiter?: string;
  sheets: ParsedSheet[];
  knownExport: KnownExport | null;
  warnings: string[];
}

export interface BuildTableOptions {
  format: TableFormat;
  encoding?: string;
  delimiter?: string;
  maxCells: number;
  maxRows: number;
  maxColumns: number;
}

// ─── Fusos dos exports conhecidos ────────────────────────────────────────
// SalesBound: constante do parser do export (fonte da verdade no repo).
// Digistore: mesmo valor de CSV_TIMEZONE em services/reconcileDigistoreRefunds
// (validado casando transaction_ids do export com o IngestLog) — lá não é
// exportado e o módulo puxa o banco, então fica espelhado aqui.
// JVZoo: Eastern (connectors/jvzoo/ingest). ClickBank: horário do Pacífico.
const DIGISTORE_EXPORT_TIMEZONE = 'America/New_York';
const JVZOO_TIMEZONE = 'America/New_York';
const CLICKBANK_TIMEZONE = 'America/Los_Angeles';

// ─── Utilidades de texto ─────────────────────────────────────────────────

export function foldText(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/** "orderAgentName" / "Customer E-mail" → palavras sem acento, minúsculas. */
export function headerWords(label: string): string[] {
  return foldText(label.replace(/([a-z0-9])([A-Z])/g, '$1 $2'))
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function cellString(v: RawCell): string {
  if (v == null) return '';
  return typeof v === 'number' ? String(v) : v.trim();
}

// ─── Números ─────────────────────────────────────────────────────────────

const CURRENCY_PATTERNS: Array<[RegExp, string]> = [
  [/US\$/i, 'USD'],
  [/R\$/, 'BRL'],
  [/€/, 'EUR'],
  [/£/, 'GBP'],
  [/\b(USD|BRL|EUR|GBP|CAD|AUD)\b/i, ''],
  [/\$/, 'USD'],
];

export interface ParsedNumber {
  value: number;
  currency: string | null;
  percent: boolean;
}

/**
 * "1,234.56" (en-US) / "1.234,56" (pt-BR), com símbolo de moeda, sinal
 * antes/depois, parênteses contábeis e %. null = não é número nesse locale.
 */
export function parseNumberish(raw: string, locale: NumberLocale): ParsedNumber | null {
  let s = raw.trim();
  if (!s || s.length > 40) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1).trim();
  }
  let currency: string | null = null;
  for (const [re, code] of CURRENCY_PATTERNS) {
    const m = s.match(re);
    if (m) {
      currency = code || m[1].toUpperCase();
      s = s.replace(re, '');
      break;
    }
  }
  s = s.replace(/[\s\u00a0\u202f]/g, '');
  let percent = false;
  if (s.endsWith('%')) {
    percent = true;
    s = s.slice(0, -1);
  }
  if (/^[-+\u2212]/.test(s)) {
    if (s[0] !== '+') neg = !neg;
    s = s.slice(1);
  } else if (s.endsWith('-')) {
    neg = !neg;
    s = s.slice(0, -1);
  }
  let n: number;
  if (locale === 'en-US') {
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s) || /^\d+(\.\d+)?$/.test(s) || /^\.\d+$/.test(s)) n = Number(s.replace(/,/g, ''));
    else if (/^\d+(\.\d+)?e[+-]?\d+$/i.test(s)) n = Number(s);
    else return null;
  } else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || /^\d+(,\d+)?$/.test(s) || /^,\d+$/.test(s)) {
    n = Number(s.replace(/\./g, '').replace(',', '.'));
  } else {
    return null;
  }
  if (!Number.isFinite(n)) return null;
  return { value: neg && n !== 0 ? -n : n, currency, percent };
}

/** Voto de UM valor: qual separador é o decimal? null = ambíguo ("1,234"). */
function localeVote(s: string): NumberLocale | null {
  const t = s.replace(/[^\d.,]/g, '');
  const dot = t.includes('.');
  const comma = t.includes(',');
  if (dot && comma) return t.lastIndexOf('.') > t.lastIndexOf(',') ? 'en-US' : 'pt-BR';
  if (comma) {
    const parts = t.split(',');
    if (parts.length > 2) return 'en-US';
    return parts[1].length === 3 ? null : 'pt-BR';
  }
  if (dot) {
    const parts = t.split('.');
    if (parts.length > 2) return 'pt-BR';
    return parts[1].length === 3 ? null : 'en-US';
  }
  return null;
}

/** Locale da COLUNA pela maioria dos valores não ambíguos; empate → dica. */
export function inferNumberLocale(values: string[], hint: NumberLocale): NumberLocale {
  let en = 0;
  let pt = 0;
  for (const v of values.slice(0, 5000)) {
    const vote = localeVote(v);
    if (vote === 'en-US') en++;
    else if (vote === 'pt-BR') pt++;
  }
  if (en > pt) return 'en-US';
  if (pt > en) return 'pt-BR';
  return hint;
}

// ─── Datas ───────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, fev: 2, mar: 3, apr: 4, abr: 4, may: 5, mai: 5, jun: 6, jul: 7,
  aug: 8, ago: 8, sep: 9, set: 9, oct: 10, out: 10, nov: 11, dec: 12, dez: 12,
};
const TIME = String.raw`(?:[ T,]+(?:at\s+|as\s+|às\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?(?:[.,]\d+)?\s*([AaPp][Mm])?)?`;
const ISO_RE = new RegExp(String.raw`^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:[.,]\d+)?)?\s*(Z|UTC|GMT|[+-]\d{2}(?::?\d{2})?)?$`, 'i');
const YMD_SLASH_RE = new RegExp(String.raw`^(\d{4})[/.](\d{1,2})[/.](\d{1,2})${TIME}$`);
const NUMERIC_RE = new RegExp(String.raw`^(\d{1,2})([/.-])(\d{1,2})\2(\d{4}|\d{2})${TIME}$`);
const NAMED_MDY_RE = new RegExp(String.raw`^([A-Za-zçÇ]{3,10})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})${TIME}$`);
const NAMED_DMY_RE = new RegExp(String.raw`^(\d{1,2})(?:\s+de)?[\s-]+([A-Za-zçÇ]{3,10})\.?(?:\s+de)?[\s-]+(\d{4})${TIME}$`);

export interface ParsedDate {
  /** "YYYY-MM-DD" ou "YYYY-MM-DD HH:mm:ss" (relógio do arquivo, ou UTC se `utc`). */
  canonical: string;
  hasTime: boolean;
  utc: boolean;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function monthOf(word: string): number | null {
  return MONTHS[foldText(word).slice(0, 3)] ?? null;
}

function buildDate(
  y: number, mo: number, d: number,
  time: { h?: string; mi?: string; s?: string; ampm?: string },
  offsetMin: number | null,
): ParsedDate | null {
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1) return null;
  if (d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return null;
  const hasTime = time.h !== undefined;
  let h = hasTime ? Number(time.h) : 0;
  const mi = hasTime ? Number(time.mi) : 0;
  const s = time.s ? Number(time.s) : 0;
  if (time.ampm) {
    if (h < 1 || h > 12) return null;
    const pm = time.ampm.toLowerCase() === 'pm';
    h = (h % 12) + (pm ? 12 : 0);
  }
  if (h > 23 || mi > 59 || s > 59) return null;
  if (offsetMin != null) {
    const t = new Date(Date.UTC(y, mo - 1, d, h, mi, s) - offsetMin * 60_000);
    return {
      canonical: `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())} ${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())}:${pad2(t.getUTCSeconds())}`,
      hasTime: true,
      utc: true,
    };
  }
  const day = `${y}-${pad2(mo)}-${pad2(d)}`;
  return { canonical: hasTime ? `${day} ${pad2(h)}:${pad2(mi)}:${pad2(s)}` : day, hasTime, utc: false };
}

function offsetMinutes(tz: string | undefined): number | null {
  if (!tz) return null;
  if (/^(z|utc|gmt)$/i.test(tz)) return 0;
  const m = tz.match(/^([+-])(\d{2}):?(\d{2})?$/);
  if (!m) return null;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

function fullYear(y: string): number {
  const n = Number(y);
  return y.length === 2 ? (n < 70 ? 2000 + n : 1900 + n) : n;
}

/** Data/hora em qualquer formato comum de export. `order` resolve "03/04/2026". */
export function parseDateValue(raw: string, order: DateOrder): ParsedDate | null {
  const s = raw.trim();
  if (s.length < 6 || s.length > 40) return null;
  let m = s.match(ISO_RE);
  if (m) {
    return buildDate(Number(m[1]), Number(m[2]), Number(m[3]), { h: m[4], mi: m[5], s: m[6] }, offsetMinutes(m[7]));
  }
  m = s.match(YMD_SLASH_RE);
  if (m) return buildDate(Number(m[1]), Number(m[2]), Number(m[3]), { h: m[4], mi: m[5], s: m[6], ampm: m[7] }, null);
  m = s.match(NUMERIC_RE);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[3]);
    const [mo, d] = order === 'MDY' ? [a, b] : [b, a];
    return buildDate(fullYear(m[4]), mo, d, { h: m[5], mi: m[6], s: m[7], ampm: m[8] }, null);
  }
  m = s.match(NAMED_MDY_RE);
  if (m) {
    const mo = monthOf(m[1]);
    return mo ? buildDate(Number(m[3]), mo, Number(m[2]), { h: m[4], mi: m[5], s: m[6], ampm: m[7] }, null) : null;
  }
  m = s.match(NAMED_DMY_RE);
  if (m) {
    const mo = monthOf(m[2]);
    return mo ? buildDate(Number(m[3]), mo, Number(m[1]), { h: m[4], mi: m[5], s: m[6], ampm: m[7] }, null) : null;
  }
  return null;
}

/**
 * Ordem dia/mês da COLUNA: um valor com primeiro campo > 12 prova DMY; com o
 * segundo > 12 prova MDY. As duas provas juntas = coluna inconsistente.
 */
function inferDateOrder(values: string[], hint: DateOrder): { order: DateOrder; ambiguous: boolean } | null {
  let dmy = false;
  let mdy = false;
  let numeric = 0;
  for (const v of values) {
    const m = v.trim().match(NUMERIC_RE);
    if (!m) continue;
    numeric++;
    const a = Number(m[1]);
    const b = Number(m[3]);
    if (a > 12 && b <= 12) dmy = true;
    else if (b > 12 && a <= 12) mdy = true;
  }
  if (dmy && mdy) return null;
  if (dmy) return { order: 'DMY', ambiguous: false };
  if (mdy) return { order: 'MDY', ambiguous: false };
  return { order: hint, ambiguous: numeric > 0 };
}

// ─── Cabeçalho, preâmbulo e rodapé ───────────────────────────────────────

function rowWidth(row: RawCell[]): number {
  let n = row.length;
  while (n > 0 && cellString(row[n - 1]) === '') n--;
  return n;
}

function looksLikeValue(s: string): boolean {
  return parseNumberish(s, 'en-US') !== null || parseNumberish(s, 'pt-BR') !== null || parseDateValue(s, 'MDY') !== null;
}

function isHeaderLike(row: RawCell[], width: number): boolean {
  const filled = row.slice(0, width).map(cellString).filter(Boolean);
  if (filled.length < Math.max(2, Math.ceil(width * 0.5))) return false;
  const textual = filled.filter((c) => c.length <= 80 && !looksLikeValue(c)).length;
  if (textual / filled.length < 0.8) return false;
  // Rótulos quase todos únicos — tolera 1 repetido (a Digistore exporta
  // "Created by" duas vezes) ou até 10% em tabela larga.
  const duplicates = filled.length - new Set(filled.map((c) => c.toLowerCase())).size;
  return duplicates <= Math.max(1, Math.floor(filled.length * 0.1));
}

/**
 * Linha do cabeçalho: a primeira (nas 60 iniciais) com largura próxima da
 * modal E cara de rótulo (texto, único). Tudo antes é preâmbulo — o export
 * da SalesBound tem 5 linhas ("Transaction Details", "Date Range…") antes.
 * Nenhuma candidata = tabela sem cabeçalho (rótulos "Coluna N").
 */
export function detectHeader(rows: RawCell[][]): { index: number; synthetic: boolean } {
  const widths = rows.map(rowWidth);
  // Largura modal entre as linhas com ≥ 2 campos (preâmbulo tem 1); empate → a maior.
  const freq = new Map<number, number>();
  for (const w of widths) if (w >= 2) freq.set(w, (freq.get(w) ?? 0) + 1);
  let modal = 0;
  let best = 0;
  for (const [w, c] of freq) if (c > best || (c === best && w > modal)) [modal, best] = [w, c];
  if (!modal) {
    const first = widths.findIndex((w) => w > 0);
    return { index: Math.max(0, first), synthetic: false };
  }
  const minWidth = Math.max(2, Math.ceil(modal * 0.6));
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    if (widths[i] >= minWidth && isHeaderLike(rows[i], widths[i])) return { index: i, synthetic: false };
  }
  const first = widths.findIndex((w) => w >= minWidth);
  return { index: Math.max(0, first), synthetic: true };
}

const FOOTER_RE = /^(grand\s+total|total(\s+geral)?|totals|totais|subtotal|soma|sum)\s*:?$/i;

function makeLabels(cells: string[], n: number): string[] {
  const seen = new Map<string, number>();
  return Array.from({ length: n }, (_, i) => {
    const base = (cells[i] ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || `Coluna ${i + 1}`;
    const k = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), k);
    return k === 1 ? base : `${base} (${k})`;
  });
}

// ─── Exports conhecidos ──────────────────────────────────────────────────

/** Reconhece exports das plataformas pelo cabeçalho (e preâmbulo). */
export function detectKnownExport(labels: string[], preamble: string[]): KnownExport | null {
  const set = new Set(labels.map((l) => foldText(l)));
  const has = (...names: string[]) => names.every((n) => set.has(n));
  if (/^transaction details/i.test(preamble[0] ?? '') || has('orderid', 'orderagentname', 'custom3')) {
    return {
      id: 'salesbound_transactions',
      label: 'SalesBound — Transaction Details',
      timezone: SALESBOUND_CSV_TIMEZONE,
      notes: [
        'A coluna date está em Central (America/Chicago): 1h ATRÁS do webhook da SalesBound (Eastern). O dashboard agrupa por dia em BRT (America/Sao_Paulo).',
        'Uma linha por TRANSAÇÃO: Sale (inclui recusadas — result diferente de Success), Refund (valor negativo; pode ser parcial e repetir no mesmo pedido) e Void (anula a venda).',
        'custom3 = de onde veio o cliente (BuyGoods/JVZoo/Digistore24/Cartpanda). A linha de "Total" do rodapé não entra nas contas.',
      ],
    };
  }
  if (has('pay key', 'pre key')) {
    return {
      id: 'jvzoo_transactions',
      label: 'JVZoo — Transactions',
      timezone: JVZOO_TIMEZONE,
      notes: [
        'Created traz só a DATA (sem hora), no relógio Eastern (America/New_York).',
        'Status Refunded/Disputed = estorno/contestação; a data do estorno está em Refunded Date. Sessão de compra na JVZoo = e-mail + dia.',
      ],
    };
  }
  if (has('transaction type', 'your earnings') || has('transaction id', 'gross amount', 'created by')) {
    return {
      id: 'digistore_transactions',
      label: 'Digistore24 — Transações (painel)',
      timezone: DIGISTORE_EXPORT_TIMEZONE,
      notes: [
        'O export do painel está em Eastern (America/New_York) — diferente do IPN, que chega no horário de Berlim.',
        'Transaction type "refund" = estorno executado; "refund request" é só pedido. Valores de estorno vêm negativos.',
      ],
    };
  }
  if (set.has('receipt') && (set.has('transaction type') || set.has('txn type') || set.has('type')) && (set.has('vendor') || set.has('affiliate') || set.has('publisher') || set.has('item'))) {
    return {
      id: 'clickbank_transactions',
      label: 'ClickBank — Transactions',
      timezone: CLICKBANK_TIMEZONE,
      notes: ['O ClickBank reporta no horário do Pacífico (America/Los_Angeles).'],
    };
  }
  return null;
}

// ─── Tipagem de coluna ───────────────────────────────────────────────────

const ID_WORDS = new Set(['id', 'ids', 'code', 'codigo', 'sku', 'zip', 'zipcode', 'cep', 'receipt', 'key', 'number', 'no', 'nr', 'num', 'numero', 'phone', 'telefone', 'cpf', 'cnpj', 'tid', 'vtid', 'ip', 'uuid', 'hash']);
const MONEY_WORDS = new Set(['amount', 'total', 'price', 'gross', 'net', 'payout', 'fee', 'fees', 'commission', 'earnings', 'revenue', 'valor', 'preco', 'receita', 'comissao', 'custo', 'cost', 'tax', 'vat', 'subtotal', 'paid', 'pago', 'frete', 'refunded', 'chargeback', 'cpa', 'aov', 'usd', 'brl']);

function isIdentifierHeader(label: string): boolean {
  const words = headerWords(label);
  return words.length > 0 && ID_WORDS.has(words[words.length - 1]);
}

function isMoneyHeader(label: string): boolean {
  return headerWords(label).some((w) => MONEY_WORDS.has(w));
}

interface TypingHints {
  numberLocale: NumberLocale;
  dateOrder: DateOrder;
  currency: string | null;
}

type ColumnSpec = Omit<TableColumn, 'key' | 'label' | 'pii' | 'stats'>;

const PROBE = 200;

function inferColumn(values: RawCell[], label: string, hints: TypingHints): ColumnSpec {
  const strs: string[] = [];
  const nums: number[] = [];
  for (const v of values) {
    if (v == null) continue;
    if (typeof v === 'number') nums.push(v);
    else if (v.trim()) strs.push(v.trim());
  }
  const total = strs.length + nums.length;
  if (!total) return { type: 'text' };
  const identifier = isIdentifierHeader(label);
  // Código só de dígitos com zero à esquerda (CEP, SKU) e dígito demais pra
  // double: texto — "03/09/2026" e "0,50" não são código.
  if (strs.some((s) => /^0\d+$/.test(s) || /^\d{16,}$/.test(s))) return { type: 'text', identifier };

  if (!nums.length) {
    // Amostra primeiro: coluna que claramente não é data não paga o passe inteiro.
    const probe = strs.slice(0, PROBE);
    const probeOrder = inferDateOrder(probe, hints.dateOrder);
    const order =
      probeOrder && probe.filter((s) => parseDateValue(s, probeOrder.order)).length / probe.length >= 0.8
        ? inferDateOrder(strs, hints.dateOrder)
        : null;
    if (order) {
      let ok = 0;
      let hasTime = false;
      let utc = false;
      for (const s of strs) {
        const d = parseDateValue(s, order.order);
        if (!d) continue;
        ok++;
        hasTime ||= d.hasTime;
        utc ||= d.utc;
      }
      if (ok / total >= 0.9) return { type: 'date', dateOrder: order.order, dateAmbiguous: order.ambiguous, hasTime, utc };
    }
  }

  const numberLocale = inferNumberLocale(strs, hints.numberLocale);
  let ok = nums.length;
  let pct = 0;
  let withSymbol = 0;
  let integers = nums.every(Number.isInteger);
  const codes = new Map<string, number>();
  for (const s of strs) {
    const r = parseNumberish(s, numberLocale);
    if (!r) continue;
    ok++;
    if (r.percent) pct++;
    if (r.currency) {
      withSymbol++;
      codes.set(r.currency, (codes.get(r.currency) ?? 0) + 1);
    }
    if (!Number.isInteger(r.value)) integers = false;
  }
  if (ok / total < 0.9) return { type: 'text', identifier };
  if (pct / total >= 0.9) return { type: 'percent', numberLocale };
  // Inteiro em coluna "…id/sku/receipt": identificador, não quantidade.
  if (identifier && integers && withSymbol === 0) return { type: 'text', identifier: true };
  if (withSymbol / total >= 0.5) {
    const currency = [...codes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? hints.currency;
    return { type: 'currency', numberLocale, currency };
  }
  if (isMoneyHeader(label)) return { type: 'currency', numberLocale, currency: hints.currency };
  return { type: 'number', numberLocale };
}

function toCell(v: RawCell, spec: ColumnSpec): { cell: Cell; invalid: boolean } {
  if (v == null) return { cell: null, invalid: false };
  if (typeof v === 'number') {
    if (spec.type === 'number' || spec.type === 'currency' || spec.type === 'percent') return { cell: v, invalid: false };
    return { cell: String(v), invalid: spec.type === 'date' };
  }
  const s = v.trim();
  if (!s) return { cell: null, invalid: false };
  switch (spec.type) {
    case 'number':
    case 'currency':
    case 'percent': {
      const r = parseNumberish(s, spec.numberLocale ?? 'en-US');
      return r ? { cell: r.value, invalid: false } : { cell: s, invalid: true };
    }
    case 'date': {
      const d = parseDateValue(s, spec.dateOrder ?? 'MDY');
      return d ? { cell: d.canonical, invalid: false } : { cell: s, invalid: true };
    }
    default:
      return { cell: s, invalid: false };
  }
}

// ─── PII ─────────────────────────────────────────────────────────────────

const PHONE_WORDS = new Set(['phone', 'telefone', 'celular', 'whatsapp', 'mobile', 'tel', 'fone', 'cell', 'cellphone', 'phonenumber']);
const DOCUMENT_WORDS = new Set(['cpf', 'cnpj', 'ssn', 'rg', 'passport', 'passaporte', 'documento', 'document', 'tin', 'nif']);
const ADDRESS_WORDS = new Set(['address', 'address1', 'address2', 'endereco', 'street', 'rua', 'logradouro', 'bairro', 'zip', 'zipcode', 'postal', 'postcode', 'cep', 'addr', 'complemento']);
const NAME_WORDS = new Set(['name', 'nome', 'sobrenome', 'firstname', 'lastname', 'fullname', 'surname']);
const PERSON_WORDS = new Set(['first', 'last', 'full', 'customer', 'buyer', 'client', 'cliente', 'comprador', 'billing', 'shipping', 'contact', 'contato', 'recipient', 'holder', 'titular', 'given', 'family', 'surname', 'sobrenome', 'firstname', 'lastname', 'fullname']);
// "Affiliate Name", "Product Name", "orderAgentName": nome de negócio, não de cliente.
const BUSINESS_WORDS = new Set(['product', 'produto', 'affiliate', 'afiliado', 'campaign', 'campanha', 'agent', 'agente', 'merchant', 'vendor', 'vendedor', 'publisher', 'offer', 'oferta', 'item', 'sku', 'file', 'arquivo', 'company', 'empresa', 'store', 'loja', 'brand', 'marca', 'plan', 'plano', 'gateway', 'bank', 'banco', 'funnel', 'funil', 'page', 'pagina', 'source', 'utm', 'site', 'domain', 'host', 'event', 'evento', 'list', 'tag', 'group', 'grupo', 'category', 'categoria', 'sheet', 'account', 'conta', 'team', 'equipe', 'network', 'rede', 'partner', 'parceiro', 'platform', 'plataforma', 'method', 'metodo', 'payment', 'pagamento', 'processor', 'country', 'pais', 'city', 'cidade', 'state', 'estado']);

const EMAIL_VALUE_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
const IPV4_VALUE_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;

/** PII pelo cabeçalho. `peopleTable` = a tabela tem e-mail/telefone (aí "name" puro é de pessoa). */
export function piiFromHeader(label: string, peopleTable: boolean): PiiKind | null {
  const words = headerWords(label);
  const joined = words.join(' ');
  const set = new Set(words);
  if (set.has('email') || set.has('mail') || /\be mail\b/.test(joined)) return 'email';
  if (words.some((w) => PHONE_WORDS.has(w))) return 'phone';
  if (set.has('ip') || joined.includes('ipaddress')) return 'ip';
  if (words.some((w) => DOCUMENT_WORDS.has(w)) || /\b(tax id|vat id|card number|cc number|last ?4)\b/.test(joined)) return 'document';
  if (words.some((w) => NAME_WORDS.has(w)) && !words.some((w) => BUSINESS_WORDS.has(w))) {
    if (words.some((w) => PERSON_WORDS.has(w)) || peopleTable) return 'name';
  }
  if (words.some((w) => ADDRESS_WORDS.has(w)) || /\baddress line\b/.test(joined)) return 'address';
  return null;
}

function piiFromValues(values: Cell[]): PiiKind | null {
  const sample: string[] = [];
  for (const v of values) {
    if (typeof v === 'string' && v) sample.push(v);
    if (sample.length >= 200) break;
  }
  if (sample.length < 3) return null;
  if (sample.filter((s) => EMAIL_VALUE_RE.test(s)).length / sample.length >= 0.5) return 'email';
  if (sample.filter((s) => IPV4_VALUE_RE.test(s)).length / sample.length >= 0.8) return 'ip';
  return null;
}

/** Máscara de UM valor de coluna PII (amostra do cartão / texto indexado). */
export function maskValue(v: Cell, kind: PiiKind): string {
  if (v == null || v === '') return '';
  const s = String(v);
  switch (kind) {
    case 'email': {
      const at = s.indexOf('@');
      return at > 0 ? `${s[0]}***${s.slice(at)}` : '***';
    }
    case 'phone':
    case 'document': {
      const digits = s.replace(/\D/g, '');
      return digits.length > 2 ? `***${digits.slice(-2)}` : '***';
    }
    case 'name':
      return s
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => `${w[0]}***`)
        .join(' ');
    case 'ip': {
      const parts = s.split('.');
      return parts.length === 4 ? `${parts[0]}.${parts[1]}.x.x` : '***';
    }
    case 'address':
      return '***';
  }
}

// ─── Perfil ──────────────────────────────────────────────────────────────

const DISTINCT_CAP = 10_000;
const TOP_MAX_DISTINCT = 200;

function columnStats(values: Cell[], col: Omit<TableColumn, 'stats'>, invalid: number): ColumnStats {
  const stats: ColumnStats = { nonNull: 0, invalid, distinct: 0, distinctCapped: false };
  const counts = new Map<string, number>();
  const numeric = col.type === 'number' || col.type === 'currency' || col.type === 'percent';
  let sum = 0;
  for (const v of values) {
    if (v == null) continue;
    stats.nonNull++;
    const key = String(v);
    if (counts.size < DISTINCT_CAP || counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
    else stats.distinctCapped = true;
    if (numeric && typeof v === 'number') {
      sum += v;
      if (stats.min === undefined || v < (stats.min as number)) stats.min = v;
      if (stats.max === undefined || v > (stats.max as number)) stats.max = v;
    } else if (col.type === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
      if (stats.min === undefined || v < (stats.min as string)) stats.min = v;
      if (stats.max === undefined || v > (stats.max as string)) stats.max = v;
    }
  }
  stats.distinct = counts.size;
  if (numeric && col.type !== 'percent' && !col.identifier && stats.nonNull) stats.sum = Math.round(sum * 1e6) / 1e6;
  // Valores mais comuns só pra coluna CATEGÓRICA (repete valor); id e PII ficam de fora.
  const categorical = counts.size <= 20 || counts.size < stats.nonNull * 0.5;
  if (col.type === 'text' && !col.pii && !col.identifier && categorical && counts.size <= TOP_MAX_DISTINCT && !stats.distinctCapped) {
    stats.top = [...counts]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([value, count]) => ({ value: value.slice(0, 80), count }));
  }
  return stats;
}

// ─── Montagem ────────────────────────────────────────────────────────────

interface SheetDraft {
  name: string;
  headerRow: number;
  preamble: string[];
  footer: string[];
  labels: string[];
  data: RawCell[][];
  droppedRows: number;
  overflowRows: number;
}

function draftSheet(sheet: RawSheet, maxColumns: number): SheetDraft | null {
  const rows = sheet.rows;
  let last = rows.length - 1;
  while (last >= 0 && rowWidth(rows[last]) === 0) last--;
  if (last < 0) return null;
  const trimmed = rows.slice(0, last + 1);
  const { index, synthetic } = detectHeader(trimmed);
  const preamble = trimmed
    .slice(0, index)
    .map((r) => r.map(cellString).filter(Boolean).join(' '))
    .filter(Boolean)
    .map((l) => l.slice(0, 200));
  const headerCells = synthetic ? [] : trimmed[index].map(cellString);
  let body = trimmed.slice(synthetic ? index : index + 1).filter((r) => rowWidth(r) > 0);

  const footer: string[] = [];
  for (let k = 0; k < 3 && body.length; k++) {
    const tail = body[body.length - 1];
    const first = tail.map(cellString).find(Boolean) ?? '';
    if (!FOOTER_RE.test(first)) break;
    footer.unshift(tail.map(cellString).filter(Boolean).join(' ').slice(0, 200));
    body = body.slice(0, -1);
  }

  const widths = body.map(rowWidth);
  const dataWidth = widths.length ? Math.max(...widths.slice(0, 5000)) : 0;
  const width = Math.min(maxColumns, Math.max(rowWidth(headerCells), dataWidth));
  let overflowRows = 0;
  const data = body.map((r) => {
    if (rowWidth(r) > width) overflowRows++;
    const out = r.slice(0, width);
    while (out.length < width) out.push(null);
    return out;
  });
  return {
    name: sheet.name,
    headerRow: synthetic ? 0 : index + 1,
    preamble,
    footer,
    labels: makeLabels(headerCells, width),
    data,
    droppedRows: 0,
    overflowRows,
  };
}

/**
 * Linhas cruas (CSV/XLSX/JSON) → ParsedTable. Lança só por formato vazio;
 * todo o resto (linhas cortadas pelo teto, campos a mais) vira aviso.
 */
export function buildParsedTable(raw: RawSheet[], opts: BuildTableOptions): ParsedTable {
  const warnings: string[] = [];
  const drafts = raw.map((s) => draftSheet(s, opts.maxColumns)).filter((d): d is SheetDraft => !!d && d.data.length > 0);

  // Teto de células/linhas somado entre as abas, na ordem do arquivo.
  let cellsLeft = opts.maxCells;
  for (const d of drafts) {
    const width = Math.max(1, d.labels.length);
    const fit = Math.max(0, Math.min(d.data.length, opts.maxRows, Math.floor(cellsLeft / width)));
    if (fit < d.data.length) {
      d.droppedRows = d.data.length - fit;
      d.data = d.data.slice(0, fit);
    }
    cellsLeft -= fit * width;
  }

  const first = drafts[0];
  const knownExport = first ? detectKnownExport(first.labels, first.preamble) : null;
  const hints: TypingHints = knownExport
    ? { numberLocale: 'en-US', dateOrder: 'MDY', currency: 'USD' }
    : opts.delimiter === ';'
      ? { numberLocale: 'pt-BR', dateOrder: 'DMY', currency: null }
      : { numberLocale: 'en-US', dateOrder: 'MDY', currency: null };

  const sheets: ParsedSheet[] = drafts.map((d) => {
    const specs = d.labels.map((label, c) => inferColumn(d.data.map((r) => r[c]), label, hints));
    const invalid = specs.map(() => 0);
    const rows: Cell[][] = d.data.map((r) =>
      r.map((v, c) => {
        const { cell, invalid: bad } = toCell(v, specs[c]);
        if (bad) invalid[c]++;
        return cell;
      }),
    );
    const headerPii = d.labels.map((l) => piiFromHeader(l, false));
    const peopleTable = headerPii.some((p) => p === 'email' || p === 'phone');
    const columns: TableColumn[] = d.labels.map((label, c) => {
      const values = rows.map((r) => r[c]);
      const pii = piiFromHeader(label, peopleTable) ?? (specs[c].type === 'text' ? piiFromValues(values) : null);
      const base = { key: `c${c}`, label, pii, ...specs[c] };
      return { ...base, stats: columnStats(values, base, invalid[c]) };
    });
    if (d.droppedRows) warnings.push(`Aba "${d.name}": só as primeiras ${rows.length.toLocaleString('en-US')} linhas foram carregadas (${d.droppedRows.toLocaleString('en-US')} ficaram de fora pelo limite de tamanho).`);
    if (d.overflowRows) warnings.push(`Aba "${d.name}": ${d.overflowRows.toLocaleString('en-US')} linha(s) com mais campos que o cabeçalho — o excedente foi ignorado.`);
    if (d.headerRow === 0) warnings.push(`Aba "${d.name}": cabeçalho não identificado — colunas nomeadas "Coluna 1…N".`);
    return {
      name: d.name,
      headerRow: d.headerRow,
      preamble: d.preamble,
      footer: d.footer,
      columns,
      rows,
      rowCount: rows.length,
      droppedRows: d.droppedRows,
    };
  });

  return { format: opts.format, encoding: opts.encoding, delimiter: opts.delimiter, sheets, knownExport, warnings };
}

// ─── Cartão de esquema ───────────────────────────────────────────────────

const INT = new Intl.NumberFormat('en-US');
const DEC = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const TYPE_LABEL: Record<ColumnType, string> = {
  number: 'número',
  currency: 'moeda',
  percent: 'percentual (pontos: 12.5 = 12.5%)',
  date: 'data',
  text: 'texto',
};
const PII_LABEL: Record<PiiKind, string> = {
  email: 'e-mail',
  phone: 'telefone',
  name: 'nome',
  address: 'endereço',
  ip: 'IP',
  document: 'documento',
};
const DELIMITER_LABEL: Record<string, string> = { ',': 'vírgula', ';': 'ponto e vírgula', '\t': 'TAB', '|': 'barra vertical' };

const CARD_MAX_CHARS = 24_000;
const SAMPLE_ROWS = 5;

const EMAIL_TEXT_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function formatStat(v: number | string | undefined): string {
  if (v === undefined) return '';
  return typeof v === 'number' ? DEC.format(v) : v;
}

function columnLine(col: TableColumn, timezone: string | null): string {
  const parts: string[] = [];
  let type = TYPE_LABEL[col.type];
  if (col.type === 'currency' && col.currency) type += ` ${col.currency}`;
  if (col.type === 'date') {
    type = col.hasTime ? 'data/hora' : 'data';
    type += col.utc ? ' (UTC)' : timezone ? ` (${timezone})` : '';
    if (col.dateAmbiguous) type += ` · ordem ${col.dateOrder === 'DMY' ? 'dia/mês' : 'mês/dia'} presumida`;
  }
  if ((col.type === 'number' || col.type === 'currency') && col.numberLocale === 'pt-BR') type += ' (formato pt-BR)';
  if (col.identifier) type += ' · identificador';
  parts.push(`- ${col.label} — ${type}`);
  if (col.pii) parts.push(`dado pessoal: ${PII_LABEL[col.pii]} (mascarado aqui)`);
  const s = col.stats;
  parts.push(`${INT.format(s.nonNull)} preenchidas`);
  if (s.invalid) parts.push(`${INT.format(s.invalid)} fora do tipo`);
  if (s.sum !== undefined) parts.push(`soma ${DEC.format(s.sum)}`);
  if (s.min !== undefined) parts.push(col.type === 'date' ? `${formatStat(s.min)} → ${formatStat(s.max)}` : `mín ${formatStat(s.min)} · máx ${formatStat(s.max)}`);
  if (s.top?.length) {
    // Valor de texto livre pode carregar e-mail/telefone mesmo fora de coluna PII.
    parts.push(`${INT.format(s.distinct)} valor(es): ${s.top.map((t) => `${maskPii(t.value)} (${INT.format(t.count)})`).join(' · ')}${s.distinct > s.top.length ? ' · …' : ''}`);
  } else if (col.type === 'text') {
    parts.push(`${s.distinctCapped ? `${INT.format(DISTINCT_CAP)}+` : INT.format(s.distinct)} distintos`);
  }
  return parts.join(' · ');
}

function sampleCell(v: Cell, col: TableColumn): string {
  if (v == null) return '';
  const s = col.pii ? maskValue(v, col.pii) : typeof v === 'string' ? maskPii(v) : String(v);
  return clip(s, 40);
}

/**
 * Texto do cartão (sem o id do anexo — quem monta o bloco acrescenta a linha
 * com nome/id). Determinístico: o mesmo arquivo gera o mesmo cartão (cache).
 */
export function schemaCardText(table: ParsedTable, fileName: string): string {
  const lines: string[] = [];
  let size = 0;
  const push = (...ls: string[]) => {
    for (const l of ls) {
      lines.push(l);
      size += l.length + 1;
    }
  };
  const format =
    table.format === 'xlsx'
      ? 'XLSX'
      : table.format === 'json'
        ? 'JSON (lista de objetos)'
        : `${table.format.toUpperCase()} (separador ${DELIMITER_LABEL[table.delimiter ?? ','] ?? table.delimiter}${table.encoding ? `, ${table.encoding}` : ''})`;
  push(`Planilha "${fileName}" — ${format}`);
  const tz = table.knownExport?.timezone ?? null;
  if (table.knownExport) {
    push(`Export reconhecido: ${table.knownExport.label} · fuso das datas: ${table.knownExport.timezone}`);
    for (const n of table.knownExport.notes) push(`- ${n}`);
  } else {
    push('Fuso das datas: desconhecido (não é um export reconhecido) — pergunte ou informe source_tz nas consultas se for cruzar com o dashboard (BRT).');
  }
  for (const w of table.warnings) push(`Aviso: ${w}`);

  let budgetHit = false;
  for (const sheet of table.sheets) {
    const where = table.format === 'xlsx' ? `Aba "${sheet.name}"` : 'Tabela';
    const header = sheet.headerRow ? ` (cabeçalho na linha ${sheet.headerRow})` : '';
    push('', `${where} — ${INT.format(sheet.rowCount)} linhas de dados × ${INT.format(sheet.columns.length)} colunas${header}`);
    if (sheet.preamble.length) {
      // Preâmbulo é título/período/campanha: só e-mail é mascarado (a máscara
      // de telefone confundiria "00:00:00 - 2026-09-15 23:59" com número).
      push(`Preâmbulo antes do cabeçalho (ignorado): ${sheet.preamble.slice(0, 6).map((p) => `"${clip(p.replace(EMAIL_TEXT_RE, '[email]'), 120)}"`).join(' | ')}`);
    }
    if (sheet.footer.length) push(`Rodapé fora das contas: ${sheet.footer.map((f) => `"${clip(f, 80)}"`).join(' | ')}`);

    const empty = sheet.columns.filter((c) => c.stats.nonNull === 0);
    const filled = sheet.columns.filter((c) => c.stats.nonNull > 0);
    push('Colunas:');
    let shown = 0;
    for (const col of filled) {
      if (size > CARD_MAX_CHARS * 0.7) {
        budgetHit = true;
        break;
      }
      push(columnLine(col, tz));
      shown++;
    }
    if (shown < filled.length) {
      push(`… e mais ${filled.length - shown} colunas preenchidas: ${filled.slice(shown).map((c) => c.label).join(', ').slice(0, 1500)}`);
    }
    if (empty.length) push(`Sempre vazias (${empty.length}): ${empty.map((c) => c.label).join(', ').slice(0, 800)}`);

    if (!budgetHit && sheet.rows.length) {
      push(`Amostra (${Math.min(SAMPLE_ROWS, sheet.rows.length)} primeiras linhas; dado pessoal mascarado — NÃO é o arquivo inteiro):`);
      sheet.rows.slice(0, SAMPLE_ROWS).forEach((row, i) => {
        const cells = sheet.columns
          .map((col, c) => [col, row[c]] as const)
          .filter(([, v]) => v != null && v !== '')
          .map(([col, v]) => `${col.label}=${sampleCell(v, col)}`);
        push(clip(`${i + 1}) ${cells.join(' · ')}`, 700));
      });
    }
  }
  const text = lines.join('\n');
  return clip(text, CARD_MAX_CHARS);
}

// ─── Armazenamento (KbTable) ─────────────────────────────────────────────

/** Metadados de uma aba sem as linhas — vai em KbTable.sheets. */
export type StoredSheet = Omit<ParsedSheet, 'rows'>;

/** O que da tabela vai em KbDocument.meta.table (o resto está em KbTable). */
export type StoredTableInfo = Pick<ParsedTable, 'format' | 'encoding' | 'delimiter' | 'knownExport' | 'warnings'>;

export function storedSheets(table: ParsedTable): StoredSheet[] {
  return table.sheets.map(({ rows: _rows, ...meta }) => meta);
}

export function storedTableInfo(table: ParsedTable): StoredTableInfo {
  const { format, encoding, delimiter, knownExport, warnings } = table;
  return { format, encoding, delimiter, knownExport, warnings };
}

/** gzip(JSON { [aba]: linhas }) — linhas como arrays alinhados às colunas. */
export function encodeTableData(table: ParsedTable): Buffer {
  const data: Record<string, Cell[][]> = {};
  for (const s of table.sheets) data[s.name] = s.rows;
  return gzipSync(Buffer.from(JSON.stringify(data), 'utf8'));
}

export function decodeTableData(buf: Uint8Array): Record<string, Cell[][]> {
  const parsed = JSON.parse(gunzipSync(buf).toString('utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('KbTable.data inválido');
  return parsed as Record<string, Cell[][]>;
}

/** Reidrata abas (metadados + linhas) pra consulta. */
export function hydrateSheets(sheets: StoredSheet[], data: Record<string, Cell[][]>): ParsedSheet[] {
  return sheets.map((s) => ({ ...s, rows: data[s.name] ?? [] }));
}
