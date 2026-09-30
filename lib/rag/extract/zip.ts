// Leitor mínimo do diretório central de ZIP (docx/xlsx são ZIPs) + guarda
// contra zip-bomb, sem dependência nova.
//
// Por que não confiar só no parser da planilha/docx: um arquivo de 25 MB
// pode declarar (ou esconder) gigabytes descompactados e derrubar o processo
// antes de qualquer teto de células. Aqui:
//   1. o diretório central dá nomes e tamanhos DECLARADOS → classifica o
//      formato (word/ × xl/ × ppt/) e barra total/razão/entradas acima do teto;
//   2. cada entrada é descompactada em streaming SÓ CONTANDO bytes (memória
//      constante) — tamanho declarado falso é recusado antes do parser real.
// ZIP64 (arquivos > 4 GB) e entradas criptografadas não existem em export de
// planilha/documento normal: recusados com mensagem.

import { createInflateRaw } from 'node:zlib';
import { ExtractError } from './errors';
import { EXTRACT_LIMITS, type ExtractLimits } from './limits';

export interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const U32_MAX = 0xffffffff;

const corrupt = () => new ExtractError('corrupt', 'Arquivo compactado corrompido (docx/xlsx ilegível) — abra e salve de novo.');
const unsafe = (why: string) =>
  new ExtractError('unsafe_archive', `Arquivo recusado por segurança: ${why}. Salve de novo (ou exporte como CSV/PDF) e reenvie.`);

/** Entradas do diretório central (lança ExtractError se o ZIP for inválido). */
export function readZipDirectory(buf: Buffer, limits: ExtractLimits = EXTRACT_LIMITS): ZipEntry[] {
  if (buf.length < 22) throw corrupt();
  // End of central directory: 22 bytes + comentário de até 64 KB no fim.
  const minPos = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw corrupt();

  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdSize === U32_MAX || cdOffset === U32_MAX) throw unsafe('formato ZIP64 não suportado');
  if (total > limits.zipMaxEntries) throw unsafe(`mais de ${limits.zipMaxEntries} arquivos internos`);
  if (cdOffset + cdSize > eocd) throw corrupt();

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let n = 0; n < total; n++) {
    if (p + 46 > eocd || buf.readUInt32LE(p) !== CENTRAL_SIG) throw corrupt();
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localHeaderOffset = buf.readUInt32LE(p + 42);
    const nameEnd = p + 46 + nameLen;
    if (nameEnd > eocd) throw corrupt();
    if (compressedSize === U32_MAX || uncompressedSize === U32_MAX || localHeaderOffset === U32_MAX) {
      throw unsafe('formato ZIP64 não suportado');
    }
    // Bit 11 = nome em UTF-8; senão CP437 — os nomes que importam (word/, xl/) são ASCII.
    const name = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, nameEnd);
    entries.push({ name, method, flags, compressedSize, uncompressedSize, localHeaderOffset });
    p = nameEnd + extraLen + commentLen;
  }
  return entries;
}

/** Checa os tamanhos DECLARADOS (rápido, antes de descompactar qualquer coisa). */
export function checkZipBudget(entries: ZipEntry[], limits: ExtractLimits = EXTRACT_LIMITS): void {
  let total = 0;
  for (const e of entries) {
    if (e.flags & 0x1) throw unsafe('o arquivo interno está protegido por senha');
    if (e.method !== 0 && e.method !== 8) throw unsafe('método de compressão desconhecido');
    total += e.uncompressedSize;
    if (e.uncompressedSize > 1024 * 1024 && e.uncompressedSize / Math.max(1, e.compressedSize) > limits.zipMaxRatio) {
      throw unsafe('taxa de compressão anormal (possível zip-bomb)');
    }
  }
  if (total > limits.zipMaxUncompressedBytes) {
    throw unsafe(`conteúdo descompactado passa de ${Math.round(limits.zipMaxUncompressedBytes / (1024 * 1024))} MB`);
  }
}

/** Bytes que `data` (deflate cru) produz, parando assim que passar de `limit`. */
function inflatedSize(data: Buffer, limit: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const inflate = createInflateRaw();
    let total = 0;
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    inflate.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) {
        finish(() => resolve(total));
        inflate.destroy();
      }
    });
    inflate.on('end', () => finish(() => resolve(total)));
    inflate.on('error', (err) => finish(() => reject(err)));
    inflate.end(data);
  });
}

/**
 * Descompacta cada entrada contando bytes: tamanho real maior que o
 * declarado (header forjado pra passar no teto) ou stream inválido → recusa.
 */
export async function verifyZipEntries(buf: Buffer, entries: ZipEntry[]): Promise<void> {
  for (const e of entries) {
    if (e.uncompressedSize === 0 && e.compressedSize <= 2) continue; // diretório / vazio
    const off = e.localHeaderOffset;
    if (off + 30 > buf.length || buf.readUInt32LE(off) !== LOCAL_SIG) throw corrupt();
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const end = start + e.compressedSize;
    if (end > buf.length) throw corrupt();
    if (e.method === 0) {
      if (e.compressedSize !== e.uncompressedSize) throw corrupt();
      continue;
    }
    let real: number;
    try {
      real = await inflatedSize(buf.subarray(start, end), e.uncompressedSize);
    } catch {
      throw corrupt();
    }
    if (real > e.uncompressedSize) throw unsafe('tamanho interno declarado não confere (possível zip-bomb)');
  }
}

/** Diretório + tetos declarados + verificação real. */
export async function assertSafeZip(buf: Buffer, entries: ZipEntry[], limits: ExtractLimits = EXTRACT_LIMITS): Promise<void> {
  checkZipBudget(entries, limits);
  await verifyZipEntries(buf, entries);
}
