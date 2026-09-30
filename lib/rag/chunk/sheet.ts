// "Cartão de esquema" de planilha/CSV (KbTable.sheets) como trecho
// pesquisável: nome da aba, linhas, colunas com tipo e resumo, e uma amostra
// com dado pessoal MASCARADO. As linhas em si NÃO são indexadas: número de
// planilha vem de query_attachment_table (cálculo determinístico sobre todas
// as linhas), nunca de trecho recuperado por busca.
//
// O formato de KbTable.sheets é do parser de anexos; aqui a leitura é
// tolerante (campos ausentes só somem do cartão).

import { maskPii } from '../normalize';
import { estimateTokens } from '../tokens';
import { CHUNK_MAX_TOKENS, labelFor, type ChunkDraft } from './types';

interface ColumnLike {
  key?: unknown;
  label?: unknown;
  name?: unknown;
  type?: unknown;
  pii?: unknown;
  stats?: unknown;
}

interface SheetLike {
  name?: unknown;
  headerRow?: unknown;
  rowCount?: unknown;
  columns?: unknown;
  sample?: unknown;
  sampleRows?: unknown;
}

const TYPE_LABEL: Record<string, string> = {
  number: 'número',
  integer: 'número',
  currency: 'moeda',
  money: 'moeda',
  percent: 'percentual',
  date: 'data',
  datetime: 'data/hora',
  boolean: 'sim/não',
  text: 'texto',
  string: 'texto',
};

const str = (v: unknown): string => (v == null ? '' : String(v));
const cell = (v: unknown) => str(v).replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

function fmtNum(v: unknown): string {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return cell(v);
  return Math.abs(n) >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(Math.round(n * 100) / 100);
}

function statsSummary(stats: unknown, pii: boolean): string {
  if (!stats || typeof stats !== 'object' || pii) return pii ? 'dado pessoal (não exibido)' : '';
  const s = stats as Record<string, unknown>;
  const parts: string[] = [];
  if (s.min != null || s.max != null) parts.push(`${cell(s.min != null ? fmtNum(s.min) : '?')} → ${cell(s.max != null ? fmtNum(s.max) : '?')}`);
  if (s.sum != null) parts.push(`soma ${fmtNum(s.sum)}`);
  if (s.distinct != null) parts.push(`${fmtNum(s.distinct)} distintos`);
  if (s.nulls != null && Number(s.nulls) > 0) parts.push(`${fmtNum(s.nulls)} vazios`);
  const top = Array.isArray(s.top) ? s.top : Array.isArray(s.topValues) ? s.topValues : null;
  if (top?.length) {
    const vals = top.slice(0, 5).map((t) => {
      if (t && typeof t === 'object') {
        const o = t as Record<string, unknown>;
        return `${cell(o.value)}${o.count != null ? ` (${fmtNum(o.count)})` : ''}`;
      }
      return cell(t);
    });
    parts.push(`mais comuns: ${vals.join(', ')}`);
  }
  return parts.join(' · ');
}

function columnsOf(sheet: SheetLike): Array<{ name: string; key: string; type: string; pii: boolean; summary: string }> {
  const cols = Array.isArray(sheet.columns) ? (sheet.columns as ColumnLike[]) : [];
  return cols.map((c, i) => {
    const name = cell(c.label ?? c.name ?? c.key ?? `coluna ${i + 1}`);
    const pii = c.pii === true || (typeof c.pii === 'string' && c.pii.length > 0);
    const type = TYPE_LABEL[str(c.type).toLowerCase()] ?? (str(c.type) || 'texto');
    return { name, key: str(c.key ?? c.label ?? c.name), type, pii, summary: statsSummary(c.stats, pii) };
  });
}

function sampleTable(sheet: SheetLike, cols: ReturnType<typeof columnsOf>): string {
  const rows = (Array.isArray(sheet.sample) ? sheet.sample : Array.isArray(sheet.sampleRows) ? sheet.sampleRows : []).slice(0, 5);
  if (!rows.length || !cols.length) return '';
  // Amostra larga demais vira ruído: mostra no máximo 12 colunas não pessoais.
  const shown = cols.filter((c) => !c.pii).slice(0, 12);
  if (!shown.length) return '';
  const header = `| ${shown.map((c) => c.name).join(' | ')} |\n|${shown.map(() => '---').join('|')}|`;
  const body = rows.map((r) => {
    const get = (c: (typeof shown)[number], idx: number) => {
      if (Array.isArray(r)) return r[cols.indexOf(c)] ?? r[idx];
      if (r && typeof r === 'object') return (r as Record<string, unknown>)[c.key] ?? (r as Record<string, unknown>)[c.name];
      return '';
    };
    return `| ${shown.map((c, idx) => maskPii(cell(get(c, idx)))).join(' | ')} |`;
  });
  return `Amostra (${rows.length} linhas; dados pessoais omitidos ou mascarados):\n\n${header}\n${body.join('\n')}`;
}

export interface RowsSheet {
  name: string;
  columns: Array<{ label: string; pii: string | null }>;
  rows: Array<Array<string | number | null>>;
}

/**
 * Planilha curada pelo admin (base GLOBAL: catálogo, tabela de preços) →
 * markdown pesquisável com as linhas. Colunas de dado pessoal SAEM inteiras
 * (nem mascaradas). Teto de linhas por aba pra base não inchar; o
 * fatiador parte a tabela repetindo o cabeçalho.
 */
export function sheetRowsToMarkdown(sheets: RowsSheet[], maxRowsPerSheet = 2000): string {
  return sheets
    .map((s) => {
      const keep = s.columns.map((c, i) => ({ c, i })).filter(({ c }) => !c.pii);
      if (!keep.length) return `## Aba ${s.name}\n\n(só colunas de dado pessoal — não indexadas)`;
      const header = `| ${keep.map(({ c }) => cell(c.label)).join(' | ')} |\n|${keep.map(() => '---').join('|')}|`;
      const body = s.rows.slice(0, maxRowsPerSheet).map((r) => `| ${keep.map(({ i }) => cell(r[i])).join(' | ')} |`);
      const rest = s.rows.length > maxRowsPerSheet ? `\n\n(+${fmtNum(s.rows.length - maxRowsPerSheet)} linhas não indexadas)` : '';
      return `## Aba ${s.name}\n\n${header}\n${body.join('\n')}${rest}`;
    })
    .join('\n\n');
}

export function chunkSheets(sheets: unknown, opts: { title: string }): ChunkDraft[] {
  const list = (Array.isArray(sheets) ? sheets : []) as SheetLike[];
  const drafts: ChunkDraft[] = [];
  list.forEach((sheet, si) => {
    const name = cell(sheet.name) || `aba ${si + 1}`;
    const cols = columnsOf(sheet);
    const rowCount = Number(sheet.rowCount);
    const headerRow = Number(sheet.headerRow);
    const intro =
      `Planilha "${opts.title}" — aba "${name}": ${Number.isFinite(rowCount) ? fmtNum(rowCount) : '?'} linhas × ${cols.length} colunas` +
      `${Number.isFinite(headerRow) && headerRow > 1 ? ` (cabeçalho na linha ${headerRow})` : ''}.\n` +
      'Descrição da estrutura. Para totais, contagens e filtros exatos use query_attachment_table com este documento.';
    const colLines = cols.map((c) => `| ${c.name} | ${c.type}${c.pii ? ' (dado pessoal)' : ''} | ${c.summary || '—'} |`);
    const colHeader = '| Coluna | Tipo | Resumo |\n|---|---|---|';
    const sample = sampleTable(sheet, cols);

    const assemble = (lines: string[], withSample: boolean) =>
      [intro, lines.length ? `${colHeader}\n${lines.join('\n')}` : '', withSample ? sample : ''].filter(Boolean).join('\n\n');

    // Cartão maior que o máximo (planilha de 100+ colunas): parte a tabela
    // de colunas repetindo o cabeçalho; a amostra vai no primeiro pedaço.
    const pieces: string[][] = [[]];
    for (const l of colLines) {
      const cur = pieces[pieces.length - 1];
      if (cur.length && estimateTokens(assemble([...cur, l], pieces.length === 1)) > CHUNK_MAX_TOKENS) pieces.push([l]);
      else cur.push(l);
    }
    let first = 1;
    pieces.forEach((lines, pi) => {
      const range = pieces.length > 1 ? ` (colunas ${first}–${first + lines.length - 1})` : '';
      first += lines.length;
      const content = assemble(lines, pi === 0);
      const headingPath = `aba ${name}${range}`;
      drafts.push({ label: labelFor(opts.title, headingPath), headingPath, content, tokenCount: estimateTokens(content) });
    });
  });
  return drafts;
}
