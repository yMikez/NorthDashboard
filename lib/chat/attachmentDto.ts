// KbDocument (anexo de conversa) → AttachmentDTO, o formato que a UI do chat
// consome (GET da conversa, chips da mensagem). Puro: recebe a linha já
// selecionada com ATTACHMENT_DTO_SELECT, sem tocar no banco.
//
// Só metadados: bytes (KbFile), texto extraído e linhas da planilha
// (KbTable.data) nunca saem por aqui.

import type { Prisma } from '@prisma/client';
import type {
  AttachmentDTO,
  AttachmentDeliveryMode,
  AttachmentKind,
  AttachmentStatus,
} from '../../types/chat';

export const ATTACHMENT_DTO_SELECT = {
  id: true,
  title: true,
  fileName: true,
  mimeType: true,
  byteSize: true,
  pageCount: true,
  status: true,
  error: true,
  deliveryMode: true,
  conversationId: true,
  messageId: true,
  createdAt: true,
  // meta NÃO entra: em PDF ele guarda o texto de todas as páginas (MBs). O
  // meta leve (sem 'pages') vem de attachmentLiteMeta (lib/rag/attachments).
  // Esquema das abas (nome, linhas, colunas) — pequeno; os dados ficam de fora.
  table: { select: { sheets: true } },
} satisfies Prisma.KbDocumentSelect;

export type AttachmentDocRow = Prisma.KbDocumentGetPayload<{ select: typeof ATTACHMENT_DTO_SELECT }>;

const KINDS: readonly AttachmentKind[] = ['pdf', 'image', 'table', 'text', 'docx'];
const MODES: readonly AttachmentDeliveryMode[] = ['inline', 'indexed', 'table'];
const STATUSES: readonly AttachmentStatus[] = ['PENDING', 'PROCESSING', 'READY', 'FAILED', 'EXPIRED'];

const TABLE_MIMES = new Set([
  'text/csv',
  'text/tab-separated-values',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

type Json = Record<string, unknown>;

function asObject(v: unknown): Json | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function strings(v: unknown, max = 60): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === 'string').slice(0, max);
  return out.length ? out : undefined;
}

/**
 * Família do anexo. KbDocument.kind é 'attachment' pra todos os anexos, então
 * a família vem do que a extração gravou em meta.kind; sem isso, do MIME
 * detectado no upload (magic bytes, não o do browser).
 */
export function attachmentKindOf(mimeType: string, deliveryMode: string, meta: unknown): AttachmentKind {
  const declared = asObject(meta)?.kind;
  if (typeof declared === 'string' && (KINDS as readonly string[]).includes(declared)) return declared as AttachmentKind;
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('image/')) return 'image';
  if (deliveryMode === 'table' || TABLE_MIMES.has(mimeType)) return 'table';
  if (mimeType === DOCX_MIME) return 'docx';
  return 'text';
}

/**
 * Metadados do chip. Aceita o que a extração pôs em meta (rows/sheets/
 * columns/width/height, ou image:{width,height}) e completa pela KbTable
 * (sheets: [{name, rowCount, columns:[{key,label}]}]) quando faltar.
 */
function metaOf(row: AttachmentDocRow, rawMeta: unknown): AttachmentDTO['meta'] | undefined {
  const m = asObject(rawMeta) ?? {};
  const image = asObject(m.image);
  const out: NonNullable<AttachmentDTO['meta']> = {};

  const rows = num(m.rows);
  const sheets = strings(m.sheets);
  const columns = strings(m.columns);
  const width = num(m.width) ?? num(image?.width);
  const height = num(m.height) ?? num(image?.height);

  if (rows !== undefined) out.rows = rows;
  if (sheets) out.sheets = sheets;
  if (columns) out.columns = columns;
  if (width !== undefined) out.width = width;
  if (height !== undefined) out.height = height;

  const rawSheets: unknown = row.table?.sheets;
  const tableSheets = Array.isArray(rawSheets)
    ? rawSheets.map(asObject).filter((s): s is Json => s !== null)
    : [];
  if (tableSheets.length) {
    if (out.rows === undefined) out.rows = tableSheets.reduce((n, s) => n + (num(s.rowCount) ?? 0), 0);
    if (!out.sheets) {
      const names = tableSheets.map((s) => s.name).filter((x): x is string => typeof x === 'string');
      if (names.length) out.sheets = names;
    }
    if (!out.columns && Array.isArray(tableSheets[0].columns)) {
      const cols = (tableSheets[0].columns as unknown[])
        .map((c) => {
          const o = asObject(c);
          const label = o?.label ?? o?.key;
          return typeof label === 'string' ? label : null;
        })
        .filter((x): x is string => !!x)
        .slice(0, 60);
      if (cols.length) out.columns = cols;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * `meta` = meta LEVE do documento (sem 'pages'); aceita também row.meta pra
 * linhas montadas à mão (testes).
 */
export function toAttachmentDTO(row: AttachmentDocRow & { meta?: unknown }, meta?: unknown): AttachmentDTO {
  const rawMeta = meta !== undefined ? meta : row.meta;
  const status = (STATUSES as readonly string[]).includes(row.status) ? (row.status as AttachmentStatus) : 'PENDING';
  const deliveryMode = (MODES as readonly string[]).includes(row.deliveryMode)
    ? (row.deliveryMode as AttachmentDeliveryMode)
    : 'indexed';
  const dto: AttachmentDTO = {
    id: row.id,
    fileName: row.fileName || row.title,
    mimeType: row.mimeType,
    byteSize: row.byteSize ?? 0,
    pageCount: row.pageCount ?? null,
    status,
    error: row.error ?? null,
    kind: attachmentKindOf(row.mimeType, row.deliveryMode, rawMeta),
    deliveryMode,
    conversationId: row.conversationId ?? null,
    messageId: row.messageId ?? null,
    createdAt: row.createdAt.toISOString(),
  };
  const lite = metaOf(row, rawMeta);
  if (lite) dto.meta = lite;
  return dto;
}
