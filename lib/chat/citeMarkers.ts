// Marcadores de citação no texto da resposta.
//
// O motor escreve ` [[cite:n]]` no fim de cada trecho citado (e manda a
// fonte n num evento `citation` ANTES do marcador). A UI troca o marcador por
// um link markdown com href reservado — o renderer `a` do MarkdownBlock
// reconhece o href e desenha o CitationChip. Só vira chip o n que existe em
// message.citations: marcador forjado pelo modelo (ou sem fonte) some.

import type { Citation } from '../../types/chat';

// Só espaço/tab antes do marcador: comer uma quebra de linha juntaria a
// citação à linha de cima (ex.: a última linha de uma tabela).
const MARKER_RE = /[ \t]?\[\[cite:(\d+)\]\]/g;
/** Prefixo do href reservado — nenhum link real do modelo começa assim. */
export const CITE_HREF_PREFIX = '#ns-cite-';
const HREF_RE = /^#ns-cite-(\d+)$/;

function linkMarkers(text: string, known: ReadonlySet<number>): string {
  let out = '';
  let last = 0;
  let chipEnd = -1; // fim (no texto original) do último chip emitido
  for (const m of text.matchAll(MARKER_RE)) {
    const start = m.index ?? 0;
    out += text.slice(last, start);
    const n = Number(m[1]);
    if (known.has(n)) {
      // Sequência de fontes vira [1][2] (sem espaço no meio); a primeira
      // ganha um espaço pra não grudar na palavra.
      const lead = start === chipEnd ? '' : ' ';
      out += `${lead}[${n}](${CITE_HREF_PREFIX}${n})`;
      chipEnd = start + m[0].length;
    } else if (start === chipEnd) {
      // Desconhecido no meio de uma sequência: some sem quebrar a sequência.
      chipEnd = start + m[0].length;
    }
    last = start + m[0].length;
  }
  return out + text.slice(last);
}

/**
 * ` [[cite:1]] [[cite:2]]` → ` [1](#ns-cite-1)[2](#ns-cite-2)`. Marcador de
 * fonte desconhecida é removido. Blocos de código cercados (```) ficam de
 * fora: lá o link não seria interpretado e apareceria cru.
 */
export function citeMarkersToLinks(markdown: string, known: ReadonlySet<number>): string {
  if (!markdown.includes('[[cite:')) return markdown;
  // Índices ímpares do split = blocos de código (grupo capturado); bloco
  // ainda aberto no streaming vai até o fim do texto.
  return markdown
    .split(/(```[\s\S]*?(?:```|$))/)
    .map((part, i) => (i % 2 === 1 ? part.replace(MARKER_RE, '') : linkMarkers(part, known)))
    .join('');
}

/** href do renderer `a` → número da citação (null = link comum). */
export function citationNumberFromHref(href: string | undefined): number | null {
  if (!href) return null;
  const m = HREF_RE.exec(href);
  return m ? Number(m[1]) : null;
}

/**
 * Texto pro "Copiar resposta": marcadores viram "[n]" e as fontes vão no fim
 * — quem cola num doc/WhatsApp leva a referência junto.
 */
export function textForCopy(content: string, citations: Citation[] | null | undefined): string {
  const list = citations ?? [];
  const known = new Set(list.map((c) => c.n));
  const body = content.replace(MARKER_RE, (_m, digits: string) => (known.has(Number(digits)) ? ` [${digits}]` : ''));
  if (!list.length) return body;
  const lines = [...list]
    .sort((a, b) => a.n - b.n)
    .map((c) => `[${c.n}] ${citationLabel(c)}${c.page ? `, p. ${c.page}` : ''}`);
  return `${body}\n\nFontes:\n${lines.join('\n')}`;
}

/** Rótulo da fonte: o curto (label) quando houver, senão o título sem o sufixo técnico do anexo. */
export function citationLabel(c: Pick<Citation, 'label' | 'title'>): string {
  const raw = (c.label || c.title || 'Fonte').trim();
  // "extrato.pdf — anexo ckx123" → "extrato.pdf" (o id não diz nada ao usuário).
  return raw.replace(/\s+—\s+anexo\s+[A-Za-z0-9_-]+$/, '');
}

/** Insere/atualiza uma citação (o mesmo n pode chegar de novo com mais trecho). */
export function upsertCitation(list: Citation[], c: Citation): Citation[] {
  const i = list.findIndex((x) => x.n === c.n);
  if (i === -1) return [...list, c].sort((a, b) => a.n - b.n);
  const next = list.slice();
  next[i] = c;
  return next;
}
