// Extração de arquivo (anexo do chat e upload da base global): bytes →
// texto por página / markdown / tabela tipada / dimensões de imagem.
//
// O tipo vem SEMPRE dos bytes (sniff): extensão e MIME do browser só
// desempatam entre leituras de TEXTO (.md não vira CSV) e geram aviso quando
// contradizem o conteúdo. Todo erro sai como ExtractError com mensagem PT-BR
// que diz como resolver.

import { ExtractError } from './errors';
import { EXTRACT_LIMITS, type ExtractLimits } from './limits';
import { sniff, DOCX_MIME, XLSX_MIME } from './sniff';
import { assertSafeZip } from './zip';
import { decodeText } from './decode';
import { detectDelimiter, isTabular, parseDelimited } from './csv';
import { readXlsxSheets } from './xlsx';
import { docxToMarkdown } from './docx';
import { htmlToMarkdown } from './markdown';
import { extractPdf } from './pdf';
import { inspectImage } from './image';
import { buildParsedTable, schemaCardText, type ParsedTable, type RawCell, type RawSheet } from '../tables';
import { normalizeText } from '../normalize';

export { ExtractError, isExtractError } from './errors';
export { EXTRACT_LIMITS } from './limits';
export { sniff } from './sniff';

export type ExtractedKind = 'pdf' | 'image' | 'table' | 'text' | 'docx';

export interface Extracted {
  kind: ExtractedKind;
  /** MIME DETECTADO (nunca o declarado pelo browser). */
  mimeType: string;
  pageCount?: number;
  /** Texto completo (markdown pra docx/html; páginas unidas no PDF; cartão de esquema na tabela). */
  text?: string;
  pages?: Array<{ page: number; text: string }>;
  table?: ParsedTable;
  image?: { width: number; height: number };
  /** PDF com dicionário de criptografia (abre sem senha, mas não vai como documento). */
  encrypted?: boolean;
  /** PDF quase sem texto (digitalizado). */
  scanned?: boolean;
  warnings: string[];
}

function extensionOf(fileName: string): string {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(fileName.trim());
  return m ? m[1].toLowerCase() : '';
}

function capText(text: string, limits: ExtractLimits, warnings: string[]): string {
  if (text.length <= limits.textMaxChars) return text;
  warnings.push(`Texto muito longo: só os primeiros ${limits.textMaxChars.toLocaleString('en-US')} caracteres foram guardados.`);
  return text.slice(0, limits.textMaxChars);
}

function tableOptions(limits: ExtractLimits) {
  return { maxCells: limits.tableMaxCells, maxRows: limits.tableMaxRows, maxColumns: limits.tableMaxColumns };
}

function ensureRows(table: ParsedTable): ParsedTable {
  if (!table.sheets.length) throw new ExtractError('empty', 'Planilha sem linhas de dados.');
  return table;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function jsonCell(v: unknown): RawCell {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return JSON.stringify(v).slice(0, 2000);
}

/** Lista de objetos → aba (chaves na ordem em que aparecem nos primeiros 1.000). */
function jsonSheet(items: Array<Record<string, unknown>>, maxColumns: number): RawSheet {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const item of items.slice(0, 1000)) {
    for (const k of Object.keys(item)) {
      if (!seen.has(k) && keys.length < maxColumns) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  return { name: 'dados', rows: [keys, ...items.map((item) => keys.map((k) => jsonCell(item[k])))] };
}

/** Família do MIME declarado — só pra avisar quando contradiz os bytes. */
function declaredFamily(mime: string | undefined): string | null {
  if (!mime) return null;
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime.includes('spreadsheetml') || mime === 'text/csv' || mime === 'text/tab-separated-values') return 'table';
  if (mime.includes('wordprocessingml')) return 'docx';
  return null;
}

async function extractText(bytes: Buffer, fileName: string, limits: ExtractLimits): Promise<Extracted> {
  const ext = extensionOf(fileName);
  const { text, encoding } = decodeText(bytes);
  const head = text.trimStart();
  if (!head) throw new ExtractError('empty', 'Arquivo de texto vazio.');
  if (/^<svg[\s>]/i.test(head) || (/^<\?xml/i.test(head) && /<svg[\s>]/i.test(head.slice(0, 2000)))) {
    throw new ExtractError('unsupported_type', 'SVG não é suportado: exporte como PNG e envie de novo.');
  }
  const warnings: string[] = [];

  if (head[0] === '{' || head[0] === '[') {
    let value: unknown;
    let parsed = false;
    try {
      value = JSON.parse(text);
      parsed = true;
    } catch {
      // Não é JSON válido (ex.: log que começa com "["): segue como texto.
    }
    if (parsed) {
      if (Array.isArray(value) && value.length > 0 && value.filter(isPlainObject).length / value.length >= 0.9) {
        const items = value.filter(isPlainObject);
        const table = ensureRows(buildParsedTable([jsonSheet(items, limits.tableMaxColumns)], { format: 'json', encoding, ...tableOptions(limits) }));
        return { kind: 'table', mimeType: 'application/json', table, text: schemaCardText(table, fileName), warnings: table.warnings };
      }
      return { kind: 'text', mimeType: 'application/json', text: capText(JSON.stringify(value, null, 2), limits, warnings), warnings };
    }
  }

  const htmlByContent = /^(<!doctype html|<html[\s>]|<head[\s>]|<body[\s>])/i.test(head);
  if (htmlByContent || ((ext === 'html' || ext === 'htm') && /<[a-z][^>]*>/i.test(head))) {
    const markdown = htmlToMarkdown(text);
    if (!markdown) throw new ExtractError('empty', 'Página HTML sem texto legível.');
    return { kind: 'text', mimeType: 'text/html', text: capText(markdown, limits, warnings), warnings };
  }

  const guess = detectDelimiter(text);
  if (guess && isTabular(guess, ext)) {
    const { rows, errors } = parseDelimited(text, guess.delimiter);
    const table = ensureRows(
      buildParsedTable([{ name: 'dados', rows }], {
        format: guess.delimiter === '\t' ? 'tsv' : 'csv',
        encoding,
        delimiter: guess.delimiter,
        ...tableOptions(limits),
      }),
    );
    if (errors) table.warnings.push(`${errors.toLocaleString('en-US')} trecho(s) com aspas malformadas — confira as linhas afetadas.`);
    const mimeType = guess.delimiter === '\t' ? 'text/tab-separated-values' : 'text/csv';
    return { kind: 'table', mimeType, table, text: schemaCardText(table, fileName), warnings: table.warnings };
  }

  const markdown = ext === 'md' || ext === 'markdown' || /^#{1,6}\s/m.test(text);
  const clean = normalizeText(text);
  return { kind: 'text', mimeType: markdown ? 'text/markdown' : 'text/plain', text: capText(clean, limits, warnings), warnings };
}

/**
 * Lê o arquivo. `declaredMime` (do browser) só gera aviso quando contradiz
 * o conteúdo — a decisão é sempre dos bytes.
 */
export async function extractFile(
  bytes: Buffer,
  fileName: string,
  declaredMime?: string,
  limits: ExtractLimits = EXTRACT_LIMITS,
): Promise<Extracted> {
  if (bytes.length > limits.maxFileBytes) {
    throw new ExtractError('too_large', `Arquivo maior que ${Math.round(limits.maxFileBytes / (1024 * 1024))} MB.`);
  }
  const sniffed = sniff(bytes, limits);
  let out: Extracted;
  switch (sniffed.type) {
    case 'pdf': {
      const pdf = await extractPdf(bytes, limits.pdfMaxPages);
      const warnings = [...pdf.warnings];
      const text = capText(pdf.pages.map((p) => p.text).join('\n\n'), limits, warnings);
      out = {
        kind: 'pdf',
        mimeType: sniffed.mimeType,
        pageCount: pdf.pageCount,
        pages: pdf.pages,
        text,
        encrypted: pdf.encrypted,
        scanned: pdf.scanned,
        warnings,
      };
      break;
    }
    case 'image':
      out = { kind: 'image', mimeType: sniffed.mimeType, image: inspectImage(bytes, sniffed.mimeType, limits), warnings: [] };
      break;
    case 'docx': {
      await assertSafeZip(bytes, sniffed.entries, limits);
      const { markdown, warnings } = await docxToMarkdown(bytes);
      if (!markdown.trim()) throw new ExtractError('empty', 'DOCX sem texto (só imagens?) — exporte como PDF e envie de novo.');
      out = { kind: 'docx', mimeType: DOCX_MIME, text: capText(markdown, limits, warnings), warnings };
      break;
    }
    case 'xlsx': {
      await assertSafeZip(bytes, sniffed.entries, limits);
      let raw: RawSheet[];
      try {
        raw = await readXlsxSheets(bytes, limits.tableMaxSheets);
      } catch {
        throw new ExtractError('corrupt', 'Não foi possível ler esta planilha XLSX — abra no Excel/Sheets, salve de novo (ou exporte CSV) e reenvie.');
      }
      const table = ensureRows(buildParsedTable(raw, { format: 'xlsx', ...tableOptions(limits) }));
      out = { kind: 'table', mimeType: XLSX_MIME, table, text: schemaCardText(table, fileName), warnings: table.warnings };
      break;
    }
    case 'text':
      out = await extractText(bytes, fileName, limits);
      break;
  }
  const declared = declaredFamily(declaredMime);
  if (declared && declared !== out.kind) {
    out.warnings.push(`O arquivo se apresentou como ${declaredMime}, mas o conteúdo é ${out.mimeType} — lido pelo conteúdo.`);
  }
  return out;
}
