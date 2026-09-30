// Fatiador de markdown (docs/kb, entradas do admin, DOCX convertido, TXT).
//
// Regras (rag.md §3.2):
//   - corta SEMPRE em H1/H2; em H3 só quando a seção passa do máximo;
//   - seção menor que o mínimo é juntada à vizinha do mesmo pai;
//   - tabela e bloco de código nunca são partidos no meio; tabela maior que o
//     máximo é dividida por LINHAS repetindo o cabeçalho; itens de lista
//     ficam juntos;
//   - sobreposição (~60 tokens) só entre trechos da MESMA seção partida;
//   - label = "Título › H2 › H3" (o H1 único do topo é o próprio título).
//
// Máquina de estados por linha que acompanha fences e tabelas — um parser
// markdown completo seria dependência nova pra ganho nenhum aqui.

import { estimateTokens, tokensToChars } from '../tokens';
import {
  CHUNK_MAX_TOKENS, CHUNK_MIN_TOKENS, CHUNK_OVERLAP_TOKENS, CHUNK_TARGET_TOKENS, labelFor, type ChunkDraft,
} from './types';

export type MdBlockKind = 'heading' | 'paragraph' | 'list' | 'table' | 'code';

export interface MdBlock {
  kind: MdBlockKind;
  text: string;
  /** Nível do título (1–6), só em heading. */
  level?: number;
  /** Texto do título sem os '#'. */
  heading?: string;
  /** Trecho repetido do fim do chunk anterior (sobreposição). */
  overlap?: boolean;
}

const FENCE_OPEN_RE = /^\s{0,3}(`{3,}|~{3,})/;
// Linear de propósito: o conteúdo do título termina em \S, então o rabo
// (?:\s+#+)?\s*$ só é testado uma vez por trecho de espaço. A versão
// `(.+?)\s*#*\s*$` (dois \s* em volta de #*) era CÚBICA numa linha
// "# a" + milhares de espaços + "x": um .txt de 20 KB travava o event loop
// do servidor inteiro por meia hora na indexação do anexo.
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(\S(?:.*?\S)??)(?:\s+#+)?\s*$/;
const LIST_ITEM_RE = /^\s*(?:[-*+]|\d+[.)])\s+/;
// Mesma linguagem de antes, sem dois \s* separados por \|? (quadrático numa
// linha longa de espaços depois de uma linha com "|").
const TABLE_SEP_RE = /^\s*(?:\|\s*)?:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*(?:\|\s*)?$/;

function isTableStart(lines: string[], i: number): boolean {
  const l = lines[i];
  if (l.trim().startsWith('|')) return true;
  return l.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]);
}

function isBlockStart(lines: string[], i: number): boolean {
  const l = lines[i];
  return FENCE_OPEN_RE.test(l) || HEADING_RE.test(l) || LIST_ITEM_RE.test(l) || isTableStart(lines, i);
}

export function parseMarkdownBlocks(text: string): MdBlock[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = line.match(FENCE_OPEN_RE);
    if (fence) {
      const ch = fence[1][0] === '`' ? '`' : '~';
      const close = new RegExp(`^\\s{0,3}\\${ch}{${fence[1].length},}\\s*$`);
      const buf = [line];
      i++;
      while (i < lines.length) {
        buf.push(lines[i]);
        i++;
        if (close.test(buf[buf.length - 1])) break;
      }
      blocks.push({ kind: 'code', text: buf.join('\n') });
      continue;
    }
    const h = line.match(HEADING_RE);
    if (h) {
      blocks.push({ kind: 'heading', text: line.trim(), level: h[1].length, heading: h[2].trim() });
      i++;
      continue;
    }
    if (isTableStart(lines, i)) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) buf.push(lines[i++]);
      blocks.push({ kind: 'table', text: buf.join('\n') });
      continue;
    }
    if (LIST_ITEM_RE.test(line)) {
      const buf: string[] = [];
      while (i < lines.length) {
        const l = lines[i];
        if (l.trim()) {
          if (buf.length && (HEADING_RE.test(l) || FENCE_OPEN_RE.test(l) || isTableStart(lines, i))) break;
          buf.push(l);
          i++;
          continue;
        }
        // Linha em branco: a lista continua se o próximo não-vazio for item
        // ou continuação indentada ("itens de lista ficam juntos").
        let j = i;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j < lines.length && (LIST_ITEM_RE.test(lines[j]) || /^\s{2,}\S/.test(lines[j]))) {
          buf.push('');
          i = j;
          continue;
        }
        break;
      }
      blocks.push({ kind: 'list', text: buf.join('\n').trim() });
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !(buf.length && isBlockStart(lines, i))) buf.push(lines[i++]);
    blocks.push({ kind: 'paragraph', text: buf.join('\n') });
  }
  return blocks;
}

// ── Seções ──────────────────────────────────────────────────────────────

interface Section {
  /** 0 = conteúdo antes do primeiro título. */
  level: number;
  path: string[];
  blocks: MdBlock[];
}

interface Unit {
  paths: string[][];
  blocks: MdBlock[];
}

const tok = (b: MdBlock) => estimateTokens(b.text) + 1;
const unitTokens = (blocks: MdBlock[]) => blocks.reduce((s, b) => s + tok(b), 0);

function toSections(blocks: MdBlock[]): Section[] {
  // O H1 único no topo é o título do documento — sai do caminho (o label já
  // começa pelo título) e do conteúdo. Os níveis NÃO são deslocados: o corte
  // obrigatório continua em H1/H2 do markdown original.
  const h1s = blocks.filter((b) => b.kind === 'heading' && b.level === 1);
  const firstHeading = blocks.find((b) => b.kind === 'heading');
  const titleH1 = h1s.length === 1 && firstHeading === h1s[0] ? h1s[0] : null;

  const sections: Section[] = [{ level: 0, path: [], blocks: [] }];
  const stack: string[] = [];
  for (const b of blocks) {
    if (b === titleH1) continue;
    if (b.kind === 'heading') {
      const level = b.level ?? 1;
      stack.length = level - 1;
      stack[level - 1] = b.heading ?? b.text;
      sections.push({ level, path: stack.filter(Boolean), blocks: [b] });
      continue;
    }
    sections[sections.length - 1].blocks.push(b);
  }
  return sections.filter((s) => s.blocks.length);
}

/** Agrupa por "corte maior" (H1/H2 efetivos): cada grupo leva as subseções H3+. */
function toMajors(sections: Section[]): Section[][] {
  const majors: Section[][] = [];
  for (const s of sections) {
    if (s.level <= 2 || !majors.length) majors.push([s]);
    else majors[majors.length - 1].push(s);
  }
  return majors;
}

const parentKey = (path: string[]) => path.slice(0, -1).join('\u0000');

function combinePaths(paths: string[][]): string {
  // Caminho que é prefixo de outro (a seção-mãe fundida com a filha) não
  // soma nada ao rótulo: fica só o mais específico.
  const isPrefixOf = (a: string[], b: string[]) => a.length < b.length && a.every((s, i) => s === b[i]);
  const nonEmpty = paths.filter((p, i) => p.length && !paths.some((q, j) => j !== i && isPrefixOf(p, q)));
  if (!nonEmpty.length) return '';
  if (nonEmpty.length === 1) return nonEmpty[0].join(' › ');
  let prefix = nonEmpty[0].slice(0, -1);
  for (const p of nonEmpty) {
    let k = 0;
    while (k < prefix.length && k < p.length - 1 && prefix[k] === p[k]) k++;
    prefix = prefix.slice(0, k);
  }
  const tails = nonEmpty.map((p) => p.slice(prefix.length).join(' › '));
  return [...prefix, tails.join(' · ')].join(' › ');
}

/**
 * Junta unidades menores que o mínimo à vizinha seguinte (mesmo pai, cabe no
 * máximo). `packable`: a vizinha grande vai ser empacotada por blocos de
 * qualquer jeito, então a pequena entra nela mesmo sem caber inteira (senão
 * um título de seção sozinho viraria um trecho de 5 tokens).
 */
function mergeSmall(units: Unit[], sameParent: (a: Unit, b: Unit) => boolean, packable = false): Unit[] {
  const out: Unit[] = [];
  for (const u of units) {
    const prev = out[out.length - 1];
    if (
      prev &&
      unitTokens(prev.blocks) < CHUNK_MIN_TOKENS &&
      sameParent(prev, u) &&
      (unitTokens(prev.blocks) + unitTokens(u.blocks) <= CHUNK_MAX_TOKENS || (packable && unitTokens(u.blocks) > CHUNK_MAX_TOKENS))
    ) {
      prev.paths.push(...u.paths);
      prev.blocks.push(...u.blocks);
      continue;
    }
    out.push({ paths: [...u.paths], blocks: [...u.blocks] });
  }
  // Última unidade pequena: cola na anterior se couber.
  if (out.length >= 2) {
    const last = out[out.length - 1];
    const prev = out[out.length - 2];
    if (
      unitTokens(last.blocks) < CHUNK_MIN_TOKENS &&
      sameParent(prev, last) &&
      unitTokens(prev.blocks) + unitTokens(last.blocks) <= CHUNK_MAX_TOKENS
    ) {
      prev.paths.push(...last.paths);
      prev.blocks.push(...last.blocks);
      out.pop();
    }
  }
  return out;
}

// ── Partição de blocos grandes ─────────────────────────────────────────

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?;:])\s+(?=\S)/).filter(Boolean);
}

function groupByTokens(parts: string[], joiner: string, budget: number, prefix = ''): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let curTok = estimateTokens(prefix);
  for (const p of parts) {
    const pt = estimateTokens(p);
    if (cur.length && curTok + pt > budget) {
      out.push(prefix + cur.join(joiner));
      cur = [];
      curTok = estimateTokens(prefix);
    }
    cur.push(p);
    curTok += pt;
  }
  if (cur.length) out.push(prefix + cur.join(joiner));
  return out;
}

/** Tabela/lista/parágrafo maior que o máximo → pedaços; código nunca é partido. */
export function splitOversizedBlock(b: MdBlock): MdBlock[] {
  if (b.kind === 'code' || b.kind === 'heading' || tok(b) <= CHUNK_MAX_TOKENS) return [b];
  if (b.kind === 'table') {
    const lines = b.text.split('\n');
    const headerLen = lines.length > 1 && TABLE_SEP_RE.test(lines[1]) ? 2 : 1;
    const header = lines.slice(0, headerLen).join('\n') + '\n';
    return groupByTokens(lines.slice(headerLen), '\n', CHUNK_TARGET_TOKENS, header).map((text) => ({ kind: 'table', text }));
  }
  if (b.kind === 'list') {
    const items: string[] = [];
    for (const line of b.text.split('\n')) {
      if (LIST_ITEM_RE.test(line) && !/^\s{2,}/.test(line)) items.push(line);
      else if (items.length) items[items.length - 1] += `\n${line}`;
      else items.push(line);
    }
    return groupByTokens(items, '\n', CHUNK_TARGET_TOKENS).map((text) => ({ kind: 'list', text }));
  }
  // "Frase" sem pontuação maior que o alvo (TXT de um registro por linha,
  // log, lista de e-mails): parte por linha e, no limite, por caracteres —
  // senão o parágrafo inteiro vira UM trecho de dezenas de milhares de tokens
  // (e o search_result devolve tudo, sem teto).
  const maxChars = tokensToChars(CHUNK_TARGET_TOKENS);
  const parts = splitSentences(b.text).flatMap((s) => {
    if (estimateTokens(s) <= CHUNK_TARGET_TOKENS) return [s];
    return s.split('\n').flatMap((line) => {
      const out: string[] = [];
      for (let i = 0; i < line.length; i += maxChars) out.push(line.slice(i, i + maxChars));
      return out;
    });
  });
  return groupByTokens(parts, ' ', CHUNK_TARGET_TOKENS).map((text) => ({ kind: 'paragraph', text }));
}

/** Rabo (≤ ~60 tokens) do último bloco de texto corrido — nunca de tabela/código. */
function overlapTail(blocks: MdBlock[]): MdBlock | null {
  const last = blocks[blocks.length - 1];
  if (!last || (last.kind !== 'paragraph' && last.kind !== 'list') || last.overlap) return null;
  const maxChars = tokensToChars(CHUNK_OVERLAP_TOKENS);
  if (last.text.length <= maxChars) return { kind: last.kind, text: last.text, overlap: true };
  const sentences = splitSentences(last.text);
  let tail = '';
  for (let k = sentences.length - 1; k >= 0; k--) {
    const next = tail ? `${sentences[k]} ${tail}` : sentences[k];
    if (next.length > maxChars) break;
    tail = next;
  }
  if (!tail) {
    const cut = last.text.slice(-maxChars);
    const sp = cut.indexOf(' ');
    tail = `…${sp >= 0 ? cut.slice(sp + 1) : cut}`;
  }
  return { kind: 'paragraph', text: tail, overlap: true };
}

/** Empacota os blocos de UMA seção grande em trechos perto do alvo, com sobreposição. */
export function packSection(blocks: MdBlock[]): MdBlock[][] {
  const pieces = blocks.flatMap(splitOversizedBlock);
  const chunks: MdBlock[][] = [];
  let cur: MdBlock[] = [];
  let curTok = 0;
  const real = (bs: MdBlock[]) => bs.filter((b) => !b.overlap);
  for (const b of pieces) {
    const bt = tok(b);
    const realTok = unitTokens(real(cur));
    const full = realTok + bt > CHUNK_MAX_TOKENS || realTok >= CHUNK_TARGET_TOKENS || (realTok + bt > CHUNK_TARGET_TOKENS && realTok >= CHUNK_MIN_TOKENS);
    if (real(cur).length && full) {
      // Título não fica órfão no fim do trecho: desce pro próximo.
      const carry: MdBlock[] = [];
      while (cur.length > 1 && cur[cur.length - 1].kind === 'heading') carry.unshift(cur.pop()!);
      chunks.push(cur);
      const ov = carry.length ? null : overlapTail(cur);
      cur = [...(ov ? [ov] : []), ...carry];
      curTok = unitTokens(cur);
    }
    cur.push(b);
    curTok += bt;
  }
  if (real(cur).length) {
    const prev = chunks[chunks.length - 1];
    // Sobra pequena volta pro trecho anterior (sem a sobreposição duplicada).
    if (prev && unitTokens(real(cur)) < CHUNK_MIN_TOKENS && unitTokens(prev) + unitTokens(real(cur)) <= CHUNK_MAX_TOKENS) {
      prev.push(...real(cur));
    } else {
      chunks.push(cur);
    }
  }
  return chunks;
}

// ── API ─────────────────────────────────────────────────────────────────

export interface MarkdownChunkOptions {
  title: string;
}

export function chunkMarkdown(text: string, opts: MarkdownChunkOptions): ChunkDraft[] {
  const sections = toSections(parseMarkdownBlocks(text));
  if (!sections.length) return [];
  const groups = toMajors(sections);
  const majors = groups.map<Unit>((g) => ({ paths: [g[0].path], blocks: g.flatMap((s) => s.blocks) }));
  // Seções maiores pequenas se juntam à seguinte do mesmo pai (H2 irmãos).
  const merged = mergeSmall(majors, (a, b) => parentKey(a.paths[a.paths.length - 1]) === parentKey(b.paths[0]));

  const drafts: ChunkDraft[] = [];
  const emit = (paths: string[][], blocks: MdBlock[]) => {
    const content = blocks.map((b) => b.text).join('\n\n').trim();
    if (!content) return;
    const headingPath = combinePaths(paths);
    drafts.push({ label: labelFor(opts.title, headingPath), headingPath, content, tokenCount: estimateTokens(content) });
  };

  for (const unit of merged) {
    if (unitTokens(unit.blocks) <= CHUNK_MAX_TOKENS) {
      emit(unit.paths, unit.blocks);
      continue;
    }
    // Só uma unidade que NÃO foi fundida pode passar do máximo (a fusão
    // exige caber) — então ela é exatamente um corte maior: parte nas
    // subseções H3 (H4+ ficam dentro da H3), junta as pequenas e empacota
    // por blocos o que ainda passar.
    const group = groups[majors.findIndex((m) => m.paths[0] === unit.paths[0])];
    const subs: Unit[] = [];
    for (const s of group) {
      if (!subs.length || s.level === 3) subs.push({ paths: [s.path], blocks: [...s.blocks] });
      else subs[subs.length - 1].blocks.push(...s.blocks);
    }
    for (const sub of mergeSmall(subs, () => true, true)) {
      if (unitTokens(sub.blocks) <= CHUNK_MAX_TOKENS) emit(sub.paths, sub.blocks);
      else for (const part of packSection(sub.blocks)) emit(sub.paths, part);
    }
  }
  return drafts;
}
