// Regras de anexo do LADO DO CLIENTE (composer do chat). Puro: sem DOM,
// testável no vitest.
//
// O servidor é a autoridade (magic bytes, tamanho, cotas) — aqui só se
// recusa cedo o que certamente vai falhar, com mensagem PT-BR que diz o que
// fazer, e se decide como redimensionar imagem antes do upload (decisão do
// dono: o servidor NUNCA decodifica imagem; quem reduz é o browser).

import type { AttachmentDTO, AttachmentKind } from '../../types/chat';

export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
export const ATTACHMENTS_PER_MESSAGE = 5;
export const ATTACHMENTS_PER_CONVERSATION = 20;
/** Lado maior da imagem enviada ao modelo (acima disso a API recusa em lote). */
export const IMAGE_MAX_EDGE = 2000;
/** PNG (print de tela) só fica PNG se couber nisso; senão vira JPEG. */
export const PNG_KEEP_MAX_BYTES = 1.5 * 1024 * 1024;
export const JPEG_QUALITY = 0.88;

/** Extensões aceitas → família. .xls/.doc/HEIC/PPTX ficam fora de propósito (ver REJECT_HINTS). */
const EXTENSION_KIND: Record<string, AttachmentKind> = {
  pdf: 'pdf',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  gif: 'image',
  csv: 'table',
  tsv: 'table',
  xlsx: 'table',
  docx: 'docx',
  txt: 'text',
  md: 'text',
  json: 'text',
};

/** `accept` do <input type=file> — mesma lista do mapa acima. */
export const ATTACHMENT_ACCEPT = Object.keys(EXTENSION_KIND)
  .map((e) => `.${e}`)
  .join(',');

// Formatos comuns que o servidor não lê: a mensagem diz como converter.
const REJECT_HINTS: Record<string, string> = {
  xls: 'Planilha .xls antiga: salve como .xlsx ou .csv.',
  doc: 'Documento .doc antigo: salve como .docx ou PDF.',
  heic: 'Foto HEIC: exporte como JPG.',
  heif: 'Foto HEIF: exporte como JPG.',
  pptx: 'Apresentação: exporte como PDF.',
  ppt: 'Apresentação: exporte como PDF.',
};

export const UNSUPPORTED_TYPE_MESSAGE =
  'Tipo não suportado — use PDF, imagem (PNG, JPG, WebP, GIF), CSV/TSV/XLSX, DOCX, TXT/MD ou JSON.';

function extensionOf(name: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(name.trim());
  return m ? m[1].toLowerCase() : '';
}

/** Família do arquivo pelo nome/MIME do browser — só pra ícone e pré-validação. */
export function guessAttachmentKind(name: string, mime = ''): AttachmentKind | null {
  const byExt = EXTENSION_KIND[extensionOf(name)];
  if (byExt) return byExt;
  // Colado da área de transferência: às vezes sem extensão, mas com MIME.
  if (/^image\/(png|jpeg|webp|gif)$/.test(mime)) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  return null;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

const INT = new Intl.NumberFormat('en-US');

/** Linha de metadados do chip pronto: "12 págs · 2.3 MB", "11,354 linhas · 42 colunas". */
export function attachmentMetaLabel(a: Pick<AttachmentDTO, 'kind' | 'byteSize' | 'pageCount' | 'meta'>): string {
  const parts: string[] = [];
  if (a.kind === 'pdf' && a.pageCount) parts.push(`${INT.format(a.pageCount)} ${a.pageCount === 1 ? 'pág.' : 'págs'}`);
  if (a.kind === 'table') {
    const rows = a.meta?.rows;
    if (typeof rows === 'number') parts.push(`${INT.format(rows)} ${rows === 1 ? 'linha' : 'linhas'}`);
    const cols = a.meta?.columns?.length;
    if (cols) parts.push(`${INT.format(cols)} ${cols === 1 ? 'coluna' : 'colunas'}`);
    const sheets = a.meta?.sheets?.length;
    if (sheets && sheets > 1) parts.push(`${sheets} abas`);
  }
  if (a.kind === 'image' && a.meta?.width && a.meta?.height) parts.push(`${a.meta.width}×${a.meta.height}`);
  parts.push(formatBytes(a.byteSize));
  return parts.join(' · ');
}

export interface FileCandidate {
  name: string;
  size: number;
  type: string;
}

export interface FileRejection {
  name: string;
  reason: string;
}

export interface SelectionResult<T extends FileCandidate> {
  accepted: T[];
  rejected: FileRejection[];
}

/**
 * Pré-validação de uma seleção (clipe, colar ou arrastar). Tipo e contagem
 * são checados aqui; o TAMANHO de imagem só depois do redimensionamento (uma
 * foto de 30 MB costuma virar 1–2 MB), então `checkSize` vem separado.
 *
 * @param inComposer anexos já no composer (qualquer estado — todos contam pro envio)
 * @param inConversation anexos já enviados nesta conversa
 */
export function selectAttachments<T extends FileCandidate>(
  files: T[],
  inComposer: number,
  inConversation: number,
): SelectionResult<T> {
  const accepted: T[] = [];
  const rejected: FileRejection[] = [];
  for (const f of files) {
    const kind = guessAttachmentKind(f.name, f.type);
    if (!kind) {
      rejected.push({ name: f.name, reason: REJECT_HINTS[extensionOf(f.name)] ?? UNSUPPORTED_TYPE_MESSAGE });
      continue;
    }
    if (f.size === 0) {
      rejected.push({ name: f.name, reason: 'Arquivo vazio.' });
      continue;
    }
    if (kind !== 'image') {
      const sizeError = checkSize(f.size);
      if (sizeError) {
        rejected.push({ name: f.name, reason: sizeError });
        continue;
      }
    }
    if (inComposer + accepted.length >= ATTACHMENTS_PER_MESSAGE) {
      rejected.push({ name: f.name, reason: `No máximo ${ATTACHMENTS_PER_MESSAGE} anexos por mensagem.` });
      continue;
    }
    if (inConversation + inComposer + accepted.length >= ATTACHMENTS_PER_CONVERSATION) {
      rejected.push({ name: f.name, reason: `Limite de ${ATTACHMENTS_PER_CONVERSATION} anexos por conversa — comece uma nova conversa.` });
      continue;
    }
    accepted.push(f);
  }
  return { accepted, rejected };
}

/** null = cabe; senão a mensagem PT-BR. */
export function checkSize(bytes: number): string | null {
  return bytes > ATTACHMENT_MAX_BYTES ? `Arquivo maior que ${ATTACHMENT_MAX_BYTES / (1024 * 1024)} MB.` : null;
}

/** Junta as recusas numa frase só pro aviso do composer. */
export function rejectionNotice(rejected: FileRejection[]): string | null {
  if (!rejected.length) return null;
  if (rejected.length === 1) return `${rejected[0].name}: ${rejected[0].reason}`;
  const shown = rejected.slice(0, 3).map((r) => `${r.name}: ${r.reason}`);
  const more = rejected.length - shown.length;
  return shown.join(' · ') + (more > 0 ? ` · +${more} arquivo(s) recusado(s)` : '');
}

// ---------------- Imagem: plano de redimensionamento ----------------

export type ImagePlan =
  | { action: 'keep' }
  | {
      action: 'encode';
      width: number;
      height: number;
      /** Formatos na ordem de tentativa: PNG só pra print de tela pequeno. */
      formats: Array<'image/png' | 'image/jpeg'>;
    };

/**
 * Decide o que fazer com a imagem antes do upload:
 * - GIF segue intacto (canvas perderia a animação; o servidor valida a dimensão);
 * - PNG ≤ 2000 px e ≤ 1,5 MB (print de tela) segue intacto — texto nítido;
 * - PNG maior: redesenha; tenta PNG e cai pra JPEG se passar de 1,5 MB;
 * - JPEG/WebP: SEMPRE redesenha em JPEG q0.88 — aplica a rotação do EXIF e
 *   descarta os metadados (GPS da foto não sai do navegador).
 */
export function planImageResize(input: { width: number; height: number; type: string; size: number }): ImagePlan {
  const { width, height, type, size } = input;
  if (type === 'image/gif') return { action: 'keep' };
  if (!(width > 0 && height > 0)) return { action: 'keep' };
  const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  if (type === 'image/png') {
    if (scale === 1 && size <= PNG_KEEP_MAX_BYTES) return { action: 'keep' };
    return { action: 'encode', width: w, height: h, formats: ['image/png', 'image/jpeg'] };
  }
  return { action: 'encode', width: w, height: h, formats: ['image/jpeg'] };
}

const IMAGE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/**
 * Print colado chega como "image.png" (ou sem nome) — todos iguais no chip e
 * no histórico. Ganha data/hora local: "captura-20260930-142501.png".
 */
export function pastedFileName(name: string, type: string, now: Date, index = 0): string {
  if (name && !/^image\.(png|jpe?g|gif|webp)$/i.test(name)) return name;
  const ext = IMAGE_EXT[type] ?? (extensionOf(name) || 'png');
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `captura-${stamp}${index > 0 ? `-${index + 1}` : ''}.${ext}`;
}

/** Nome do arquivo depois da conversão (foto.webp → foto.jpg). */
export function renameForFormat(name: string, format: 'image/png' | 'image/jpeg'): string {
  const ext = format === 'image/png' ? 'png' : 'jpg';
  const base = name.replace(/\.[A-Za-z0-9]+$/, '') || 'imagem';
  return `${base}.${ext}`;
}

// ---------------- Upload: mensagens de erro ----------------

/**
 * Mensagem PT-BR pra falha de upload. A do servidor (já PT-BR) vence; o
 * mapa por status cobre proxy/timeout e servidor antigo sem corpo JSON.
 */
export function uploadErrorMessage(status: number, serverMessage?: string | null): string {
  const s = (serverMessage ?? '').trim();
  if (s) return s;
  switch (status) {
    case 0:
      return 'Falha de rede no envio — tente de novo.';
    case 401:
      return 'Sessão expirada — entre de novo.';
    case 409:
      return `Limite de ${ATTACHMENTS_PER_CONVERSATION} anexos por conversa.`;
    case 413:
      return `Arquivo maior que ${ATTACHMENT_MAX_BYTES / (1024 * 1024)} MB.`;
    case 415:
      return UNSUPPORTED_TYPE_MESSAGE;
    case 422:
      return 'Não foi possível ler o arquivo (PDF protegido por senha ou arquivo corrompido).';
    case 429:
      return 'Cota de anexos atingida — tente mais tarde.';
    case 507:
      return 'Armazenamento de anexos cheio — avise o admin.';
    default:
      return `Falha no envio (HTTP ${status}).`;
  }
}
