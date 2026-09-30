// Escolhe o fatiador pela forma do conteúdo do KbDocument:
//   paginado (meta.pages)     → trechos por página (PDF — o texto unido
//                               também existe, mas a página é a citação);
//   texto (KbDocument.text)   → markdown estruturado (md, docx, txt, html e o
//                               cartão de esquema que o extrator de planilha
//                               grava como texto — o mesmo que vai inline);
//   só planilha (KbTable.sheets, sem texto) → cartão de esquema por aba.

import { normalizeText } from '../normalize';
import { chunkMarkdown } from './markdown';
import { chunkPages, type PageText } from './pages';
import { chunkSheets } from './sheet';
import type { ChunkDraft } from './types';

export type { ChunkDraft } from './types';
export type { PageText } from './pages';

export interface ChunkSource {
  title: string;
  text?: string | null;
  pages?: PageText[] | null;
  sheets?: unknown;
}

/** meta.pages = [{page, text}] (contrato do extrator de PDF). */
export function pagesFromMeta(meta: unknown): PageText[] | null {
  if (!meta || typeof meta !== 'object') return null;
  const raw = (meta as { pages?: unknown }).pages;
  if (!Array.isArray(raw)) return null;
  const pages = raw
    .map((p, i) => {
      const o = (p ?? {}) as { page?: unknown; text?: unknown };
      return { page: Number.isFinite(Number(o.page)) ? Number(o.page) : i + 1, text: typeof o.text === 'string' ? o.text : '' };
    })
    .filter((p) => p.text.trim());
  return pages.length ? pages : null;
}

export function chunkDocument(src: ChunkSource): ChunkDraft[] {
  if (src.pages?.length) return chunkPages(src.pages, { title: src.title });
  if (src.text?.trim()) return chunkMarkdown(normalizeText(src.text), { title: src.title });
  if (Array.isArray(src.sheets) && src.sheets.length) return chunkSheets(src.sheets, { title: src.title });
  return [];
}

/** Texto integral do documento (pra contextualização e estimativa de tokens). */
export function fullTextOf(src: ChunkSource): string {
  if (src.pages?.length) return src.pages.map((p) => `[página ${p.page}]\n${p.text}`).join('\n\n');
  return src.text ?? '';
}
