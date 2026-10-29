// Formatação simples nos textos da pesquisa (editados na aba Pesquisas):
//   **negrito**   *itálico*   __sublinhado__   ~~riscado~~   Enter = nova linha
// Roda DEPOIS de escapar o HTML: o texto do usuário nunca vira tag, só as
// marcações acima viram <strong>/<em>/<u>/<s>.

const ITALIC = /(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g;

/** Texto já escapado → HTML com a formatação. Título não tem quebra de linha. */
export function richText(escaped: string, opts: { singleLine?: boolean } = {}): string {
  const html = escaped
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)([\s\S]*?\S)__/g, '<u>$1</u>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<s>$1</s>')
    .replace(ITALIC, '$1<em>$2</em>');
  return opts.singleLine ? html.replace(/\s*\r?\n\s*/g, ' ') : html.replace(/\r?\n/g, '<br>');
}

/** Sem as marcações (título da aba do navegador, contagem de caracteres). */
export function plainText(text: string): string {
  return text.replace(/\*\*|__|~~/g, '').replace(ITALIC, '$1$2').replace(/\s*\r?\n\s*/g, ' ');
}

/**
 * Até quantos caracteres um título cabe em 1 linha no celular (≈ 343 px úteis
 * a 18 px). Acima disso a página encolhe a fonte até 17 px e, se ainda não
 * couber, quebra em 2 linhas no tamanho normal.
 */
export const TITLE_ONE_LINE_CHARS = 34;
