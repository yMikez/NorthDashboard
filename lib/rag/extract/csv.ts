// CSV/TSV → linhas cruas. O cabeçalho (e o preâmbulo antes dele) é
// resolvido depois, em tables.ts, igual pra CSV e XLSX.
//
// Delimitador: testa , ; TAB | numa amostra e fica com o que dá largura
// CONSISTENTE — contando só a partir da primeira linha com essa largura,
// porque exports como o "Transaction Details" da SalesBound abrem com 5
// linhas de preâmbulo sem delimitador nenhum. `;` é o padrão do Excel pt-BR
// (e da Digistore), onde a vírgula é decimal: aí `,` também dá colunas
// "consistentes", mas bem menos — a pontuação favorece a largura maior.

import Papa from 'papaparse';

export const DELIMITERS = [',', ';', '\t', '|'] as const;
export type Delimiter = (typeof DELIMITERS)[number];

export interface DelimiterGuess {
  delimiter: Delimiter;
  /** Largura modal (nº de campos) das linhas da tabela. */
  width: number;
  /** Fração das linhas (a partir do início da tabela) com a largura modal. */
  share: number;
  /** Linhas da amostra consideradas. */
  lines: number;
}

const SAMPLE_CHARS = 128 * 1024;

function fieldCount(row: string[]): number {
  let n = row.length;
  while (n > 0 && row[n - 1].trim() === '') n--;
  return n;
}

function guessFor(sample: string, delimiter: Delimiter, truncated: boolean): DelimiterGuess | null {
  const parsed = Papa.parse<string[]>(sample, { delimiter, skipEmptyLines: 'greedy' });
  const rows = truncated ? parsed.data.slice(0, -1) : parsed.data;
  if (rows.length === 0) return null;
  const widths = rows.map(fieldCount);
  const freq = new Map<number, number>();
  for (const w of widths) if (w >= 2) freq.set(w, (freq.get(w) ?? 0) + 1);
  if (!freq.size) return null;
  // Moda; empate → a maior largura (cabeçalho completo costuma ser a maior).
  let width = 0;
  let best = 0;
  for (const [w, c] of freq) if (c > best || (c === best && w > width)) [width, best] = [w, c];
  const start = widths.findIndex((w) => w === width);
  const body = widths.slice(start);
  const share = body.filter((w) => w === width).length / body.length;
  return { delimiter, width, share, lines: body.length };
}

/** Melhor delimitador, ou null quando o texto não tem cara de tabela. */
export function detectDelimiter(text: string): DelimiterGuess | null {
  let sample = text.slice(0, SAMPLE_CHARS);
  const truncated = text.length > SAMPLE_CHARS;
  if (truncated) sample = sample.slice(0, Math.max(0, sample.lastIndexOf('\n')));
  let winner: DelimiterGuess | null = null;
  let winnerScore = 0;
  for (const d of DELIMITERS) {
    const g = guessFor(sample, d, truncated);
    if (!g) continue;
    const score = g.share * Math.sqrt(g.width);
    if (score > winnerScore) {
      winner = g;
      winnerScore = score;
    }
  }
  return winner;
}

/**
 * O texto é uma tabela? Forte sem ajuda da extensão (≥ 90% das linhas com a
 * mesma largura), ou mais frouxo quando o arquivo se diz .csv/.tsv — a
 * extensão só desempata entre interpretações de TEXTO, nunca de binário.
 */
export function isTabular(g: DelimiterGuess | null, extension: string): boolean {
  if (!g) return false;
  if (extension === 'md' || extension === 'markdown') return false;
  if (extension === 'csv' || extension === 'tsv') return g.share >= 0.5;
  return g.share >= 0.9 && g.lines >= 2;
}

export interface DelimitedParse {
  rows: string[][];
  /** Erros de sintaxe (aspas sem fechar etc.) — viram aviso, não recusa. */
  errors: number;
}

/**
 * Parse completo com o delimitador escolhido. Célula no formato de fórmula
 * do Excel `="-144.00"` (export da Digistore) vira o valor de dentro.
 */
export function parseDelimited(text: string, delimiter: Delimiter): DelimitedParse {
  const parsed = Papa.parse<string[]>(text, { delimiter, skipEmptyLines: false });
  const rows = parsed.data.map((row) =>
    row.map((cell) => (cell.length >= 3 && cell.startsWith('="') && cell.endsWith('"') ? cell.slice(2, -1) : cell)),
  );
  return { rows, errors: parsed.errors.length };
}
