// Limpeza de texto antes de fatiar/indexar, hash de conteúdo e máscara de
// dado pessoal. Tudo puro (testável sem banco).
//
// Por que limpar: PDF extraído chega com hifenização de quebra de linha
// ("reem-\nbolso"), espaços duplicados, zero-width e cabeçalho/rodapé
// repetido em toda página — tudo isso vira ruído no tsvector e no trecho
// citado. Markdown é tratado com mais cuidado: indentação e espaços dentro
// de bloco de código têm significado.

import { createHash } from 'node:crypto';

const ZERO_WIDTH_RE = /[​-‍⁠﻿]/g;
const BULLET_RE = /^([ \t]*)[•·▪●◦‣∙][ \t]*/gm;

export interface NormalizeOptions {
  /** Texto de PDF/extração: junta hifenização de fim de linha e colapsa espaços. */
  prose?: boolean;
}

export function normalizeText(raw: string, opts: NormalizeOptions = {}): string {
  let t = (raw ?? '').normalize('NFC').replace(ZERO_WIDTH_RE, '').replace(/\r\n?/g, '\n');
  t = t.replace(/ /g, ' ');
  t = t.replace(BULLET_RE, '$1- ');
  if (opts.prose) {
    // "reem-\nbolso" → "reembolso" (só letra minúscula depois da quebra:
    // "Pós-\nVenda" é composto de verdade e fica).
    t = t.replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2');
    t = t.replace(/(\S)[ \t]{2,}/g, '$1 ');
  }
  t = t
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n');
  // 3+ linhas em branco viram 1 parágrafo — preserva a estrutura sem inflar.
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

const PAGE_NUMBER_RE = /^(?:p[aá]gina|page|p[aá]g\.?|p\.)?\s*\d{1,4}(?:\s*(?:de|of|\/)\s*\d{1,4})?$/i;

/**
 * Remove das BORDAS de cada página (3 primeiras/3 últimas linhas não vazias)
 * o que é cabeçalho/rodapé: linha curta idêntica em ≥ 50% das páginas, ou
 * só o número da página ("Página 3 de 10", "- 3 -"). A mesma frase no meio
 * do texto é conteúdo e fica.
 */
export function stripRepeatedPageLines<T extends { page: number; text: string }>(pages: T[]): T[] {
  const key = (l: string) => l.trim().toLowerCase();
  const isPageNumber = (l: string) => PAGE_NUMBER_RE.test(l.trim().replace(/^[-–—\s]+|[-–—\s]+$/g, ''));
  const edgeIdx = pages.map((p) => {
    const lines = p.text.split('\n');
    const nonEmpty = lines.map((x, j) => (x.trim() ? j : -1)).filter((j) => j >= 0);
    return { lines, edges: new Set([...nonEmpty.slice(0, 3), ...nonEmpty.slice(-3)]) };
  });
  const counts = new Map<string, number>();
  for (const { lines, edges } of edgeIdx) {
    const seen = new Set<string>();
    for (const j of edges) {
      const l = lines[j];
      if (l.trim().length >= 3 && l.trim().length <= 120) seen.add(key(l));
    }
    for (const k of seen) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const threshold = Math.max(2, Math.ceil(pages.length * 0.5));
  const repeated = pages.length >= 3 ? new Set([...counts].filter(([, n]) => n >= threshold).map(([k]) => k)) : new Set<string>();
  return pages.map((p, i) => {
    const { lines, edges } = edgeIdx[i];
    const keep = lines.filter((l, j) => !(edges.has(j) && (repeated.has(key(l)) || isPageNumber(l))));
    return { ...p, text: keep.join('\n').trim() };
  });
}

export function sha256Hex(s: string | Buffer): string {
  return createHash('sha256').update(s).digest('hex');
}

/**
 * Forma "dobrada" pra comparar texto de gente: minúsculas, sem acento,
 * aspas/traços unificados, espaços colapsados. Usada na checagem de
 * evidência literal da memória (o usuário escreve "estorno", o extrator
 * cita "Estorno" — é a mesma evidência).
 */
export function foldForMatch(s: string): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[“”«»„"']/g, '"')
    .replace(/[‘’`´]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
// Candidato a telefone: dígitos com separadores de telefone (espaço, ponto,
// hífen, parênteses, +). Vírgula NÃO entra — "12,345,678.90" é dinheiro.
// ":" nas bordas: pedaço de horário ("00:00:00 - 2026…") não é telefone.
const PHONE_CANDIDATE_RE = /(?<![\w.,/:])\+?\(?\d[\d\s().-]{8,20}\d(?![\w/:])/g;
const DATE_LIKE_RE = /^\d{4}-\d{2}-\d{2}|^\d{2}[./-]\d{2}[./-]\d{2,4}/;

function looksLikePhone(s: string): boolean {
  const digits = s.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return false;
  if (DATE_LIKE_RE.test(s.trim())) return false;
  // Intervalo de datas ("… - 2026-09-15 23") tem a data no MEIO do candidato.
  if (/\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{2,4}/.test(s)) return false;
  // Sequência sem separador nenhum só conta como telefone se vier com "+"
  // (id numérico de pedido/afiliado costuma ser só dígitos).
  if (/^\d+$/.test(s)) return false;
  return true;
}

/** Mascara e-mail, telefone e IP — texto indexado de anexo nunca guarda PII crua. */
export function maskPii(text: string): string {
  return (text ?? '')
    .replace(EMAIL_RE, '[email]')
    .replace(IPV4_RE, '[ip]')
    .replace(PHONE_CANDIDATE_RE, (m) => (looksLikePhone(m) ? '[telefone]' : m));
}

/** Há dado pessoal detectável (e-mail, telefone, IP)? Usado pra recusar memória. */
export function containsPii(text: string): boolean {
  return maskPii(text) !== (text ?? '');
}
