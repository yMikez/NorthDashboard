// Detecção do tipo REAL do arquivo pelos primeiros bytes (magic bytes).
// Extensão e MIME do browser nunca decidem: um .pdf que é HTML, ou um .csv
// que é executável, caem no tipo verdadeiro (ou são recusados).
//
// Formatos que o usuário costuma mandar e não lemos recebem mensagem com o
// caminho de conversão (.xls/.doc antigos, HEIC do iPhone, PowerPoint…).

import { ExtractError, UNSUPPORTED_MESSAGE } from './errors';
import { looksLikeText } from './decode';
import { readZipDirectory, type ZipEntry } from './zip';
import { EXTRACT_LIMITS, type ExtractLimits } from './limits';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export type Sniffed =
  | { type: 'pdf'; mimeType: 'application/pdf' }
  | { type: 'image'; mimeType: ImageMime }
  | { type: 'docx'; mimeType: typeof DOCX_MIME; entries: ZipEntry[] }
  | { type: 'xlsx'; mimeType: typeof XLSX_MIME; entries: ZipEntry[] }
  | { type: 'text' };

function startsWith(b: Uint8Array, sig: number[], at = 0): boolean {
  if (b.length < at + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (b[at + i] !== sig[i]) return false;
  return true;
}

function ascii(b: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...b.subarray(from, Math.min(to, b.length)));
}

const reject = (message: string) => new ExtractError('unsupported_type', message);

/**
 * "%PDF-" no byte 0 — ou depois de lixo nos primeiros 1024 bytes (a spec
 * permite), aí exigindo versão válida e "%%EOF" no fim: um .md que só CITA
 * "%PDF-" no começo não vira PDF.
 */
function isPdf(b: Buffer): boolean {
  const idx = b.subarray(0, 1024).indexOf('%PDF-');
  if (idx === 0) return true;
  if (idx < 0) return false;
  return /^%PDF-[12]\.\d/.test(b.toString('latin1', idx, idx + 8)) && b.subarray(Math.max(0, b.length - 2048)).indexOf('%%EOF') >= 0;
}

function classifyZip(entries: ZipEntry[]): 'docx' | 'xlsx' {
  const names = new Set(entries.map((e) => e.name));
  const has = (prefix: string) => entries.some((e) => e.name.startsWith(prefix));
  if (names.has('word/document.xml')) return 'docx';
  if (names.has('xl/workbook.xml')) return 'xlsx';
  if (has('ppt/')) throw reject('Apresentação PowerPoint ainda não é suportada: exporte como PDF e envie de novo.');
  if (names.has('mimetype') || names.has('content.xml')) {
    throw reject('Arquivo OpenDocument (LibreOffice): salve como .xlsx/.docx ou exporte como PDF.');
  }
  throw reject('Arquivo ZIP não suportado: envie os arquivos de dentro dele separadamente.');
}

export function sniff(bytes: Buffer, limits: ExtractLimits = EXTRACT_LIMITS): Sniffed {
  if (bytes.length === 0) throw new ExtractError('empty', 'Arquivo vazio.');
  if (isPdf(bytes)) return { type: 'pdf', mimeType: 'application/pdf' };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { type: 'image', mimeType: 'image/png' };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { type: 'image', mimeType: 'image/jpeg' };
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return { type: 'image', mimeType: 'image/gif' };
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return { type: 'image', mimeType: 'image/webp' };

  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) {
    const entries = readZipDirectory(bytes, limits);
    const kind = classifyZip(entries);
    return kind === 'docx'
      ? { type: 'docx', mimeType: DOCX_MIME, entries }
      : { type: 'xlsx', mimeType: XLSX_MIME, entries };
  }
  // OLE2: .xls/.doc antigos — e também .xlsx/.docx COM SENHA (o Office
  // criptografa o pacote dentro de um contêiner OLE).
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    throw reject('Arquivo do Office antigo (.xls/.doc) ou protegido por senha: salve como .xlsx/.docx sem senha (ou exporte CSV/PDF).');
  }
  if (ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12).toLowerCase();
    if (/^(heic|heix|hevc|heim|heis|mif1|msf1|avif|avis)$/.test(brand)) {
      throw reject('Foto HEIC/AVIF não é suportada: exporte como JPG ou PNG.');
    }
    throw reject('Vídeo/áudio não é suportado: envie um print (PNG/JPG) ou o documento em PDF.');
  }
  if (startsWith(bytes, [0x1f, 0x8b]) || ascii(bytes, 0, 4) === 'Rar!' || startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf])) {
    throw reject('Arquivo compactado não é suportado: descompacte e envie os arquivos separadamente.');
  }
  if (looksLikeText(bytes)) return { type: 'text' };
  throw reject(UNSUPPORTED_MESSAGE);
}
