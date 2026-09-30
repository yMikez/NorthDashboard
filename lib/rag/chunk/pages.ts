// Fatiador de texto paginado (PDF: KbDocument.meta.pages = [{page, text}]).
//
// Junta parágrafos até o alvo DENTRO da página — a citação aponta página, e
// um trecho que atravessa página cita pior. Só atravessa quando a sobra da
// página é menor que o mínimo (vira pageStart..pageEnd). Título heurístico
// (linha curta em CAIXA ALTA ou "3.2 Algo") vira o caminho do label.
// Sem sobreposição: em PDF a página já é a unidade de contexto.

import { normalizeText, stripRepeatedPageLines } from '../normalize';
import { estimateTokens } from '../tokens';
import { CHUNK_MAX_TOKENS, CHUNK_MIN_TOKENS, CHUNK_TARGET_TOKENS, labelFor, type ChunkDraft } from './types';

export interface PageText {
  page: number;
  text: string;
}

const NUMBERED_HEADING_RE = /^\d+(?:\.\d+)*\.?\s+\S.{0,78}$/;

function headingOf(paragraph: string): string | null {
  const first = paragraph.split('\n')[0].trim();
  if (!first || first.length > 80) return null;
  if (NUMBERED_HEADING_RE.test(first) && !/[.:;]$/.test(first)) return first;
  const letters = first.replace(/[^\p{L}]/gu, '');
  if (letters.length >= 4 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) return first;
  return null;
}

function paragraphsOf(text: string): string[] {
  const byBlank = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (byBlank.length > 1) return byBlank;
  // PDF sem linha em branco entre parágrafos: agrupa linhas até ~alvo/3
  // (parágrafo "sintético"), senão a página inteira viraria um bloco só.
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const out: string[] = [];
  let cur: string[] = [];
  for (const l of lines) {
    cur.push(l);
    if (estimateTokens(cur.join(' ')) >= CHUNK_TARGET_TOKENS / 3 && /[.!?:]$/.test(l)) {
      out.push(cur.join('\n'));
      cur = [];
    }
  }
  if (cur.length) out.push(cur.join('\n'));
  return out;
}

function splitLong(p: string): string[] {
  if (estimateTokens(p) <= CHUNK_MAX_TOKENS) return [p];
  const sentences = p.split(/(?<=[.!?;])\s+(?=\S)/);
  const out: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && estimateTokens(`${cur} ${s}`) > CHUNK_TARGET_TOKENS) {
      out.push(cur);
      cur = s;
    } else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push(cur);
  return out;
}

export function chunkPages(pages: PageText[], opts: { title: string }): ChunkDraft[] {
  const clean = stripRepeatedPageLines(
    pages
      .filter((p) => Number.isFinite(p.page))
      .map((p) => ({ page: p.page, text: normalizeText(p.text ?? '', { prose: true }) })),
  );
  const drafts: ChunkDraft[] = [];
  let heading = '';
  let cur: string[] = [];
  let curStart: number | null = null;
  let curEnd: number | null = null;
  let curHeading = '';

  const flush = () => {
    const content = cur.join('\n\n').trim();
    if (content) {
      drafts.push({
        label: labelFor(opts.title, curHeading),
        headingPath: curHeading,
        content,
        tokenCount: estimateTokens(content),
        pageStart: curStart,
        pageEnd: curEnd,
      });
    }
    cur = [];
    curStart = null;
    curEnd = null;
  };

  clean.forEach((pg, idx) => {
    for (const para of paragraphsOf(pg.text).flatMap(splitLong)) {
      const h = headingOf(para);
      if (h) {
        // Título novo fecha o trecho em curso (se já tem corpo suficiente).
        if (cur.length && estimateTokens(cur.join('\n\n')) >= CHUNK_MIN_TOKENS) flush();
        heading = h;
      }
      const t = estimateTokens(para);
      if (cur.length && estimateTokens(cur.join('\n\n')) + t > CHUNK_TARGET_TOKENS) flush();
      if (!cur.length) {
        curStart = pg.page;
        curHeading = heading;
      }
      cur.push(para);
      curEnd = pg.page;
    }
    // Fim da página: fecha, salvo sobra pequena que ainda cabe na próxima.
    const isLast = idx === clean.length - 1;
    if (cur.length && (isLast || estimateTokens(cur.join('\n\n')) >= CHUNK_MIN_TOKENS)) flush();
  });
  if (cur.length) flush();
  return drafts;
}
