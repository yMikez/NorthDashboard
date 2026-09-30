// HTML → markdown (turndown), usado pelo DOCX (mammoth gera HTML) e por
// anexo .html. Markdown preserva títulos (seções pro read_attachment e pro
// chunker) e tabelas, que o texto cru perderia.
//
// Script/estilo/mídia são descartados: o conteúdo do anexo é dado, e nada
// dele pode virar <img> que o navegador busque (canal de exfiltração).

import TurndownService from 'turndown';

function cellText(node: Node): string {
  return (node.textContent ?? '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
}

/** Linhas <tr> da tabela, sem descer em tabela aninhada. */
function tableRows(node: Node): Node[][] {
  const rows: Node[][] = [];
  const walk = (n: Node) => {
    for (const child of Array.from(n.childNodes)) {
      if (child.nodeName === 'TR') {
        rows.push(Array.from(child.childNodes).filter((c) => c.nodeName === 'TD' || c.nodeName === 'TH'));
      } else if (child.nodeName !== 'TABLE') {
        walk(child);
      }
    }
  };
  walk(node);
  return rows;
}

let service: TurndownService | null = null;

function turndown(): TurndownService {
  if (service) return service;
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '_' });
  // O parser do turndown descarta <html>/<head>/<body> de documento inteiro:
  // <title> e <script> chegam soltos — por isso vão pela tag.
  td.remove(['script', 'style', 'noscript', 'iframe', 'object', 'embed', 'canvas', 'video', 'audio', 'head', 'title']);
  // Imagem tem regra própria no CommonMark (que vence o remove): regra
  // adicionada tem precedência. <svg> não está no mapa de tags HTML do tipo.
  td.addRule('dropMedia', {
    filter: (node) => ['img', 'picture', 'svg'].includes(node.nodeName.toLowerCase()),
    replacement: () => '',
  });
  // Tabela → pipe table (o turndown puro achataria as células num parágrafo).
  td.addRule('table', {
    filter: 'table',
    replacement: (_content, node) => {
      const rows = tableRows(node).filter((r) => r.length > 0);
      if (!rows.length) return '';
      const width = Math.max(...rows.map((r) => r.length));
      const line = (cells: string[]) => `| ${[...cells, ...Array(width - cells.length).fill('')].join(' | ')} |`;
      const [head, ...body] = rows.map((r) => r.map(cellText));
      return `\n\n${[line(head), line(Array(width).fill('---')), ...body.map(line)].join('\n')}\n\n`;
    },
  });
  service = td;
  return td;
}

/**
 * Acima disso o turndown fica QUADRÁTICO: o join dele indexa a string de
 * saída a cada nó irmão, o que achata a concatenação inteira (1 MB de HTML
 * ≈ 7 s, 2 MB ≈ 26 s de event loop travado; DOCX grande vira HTML maior
 * ainda). HTML maior vai por uma limpeza LINEAR: mantém títulos (#),
 * parágrafos, itens e células; perde negrito/links/pipe table — é dado pra
 * busca e leitura, não pra exibir.
 */
const TURNDOWN_MAX_CHARS = 300_000;
const DROP_BLOCKS = ['script', 'style', 'noscript', 'iframe', 'object', 'embed', 'canvas', 'video', 'audio', 'head', 'title', 'svg'];
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };

/** Remove <tag …>…</tag> por indexOf (regex com [\s\S]*? seria quadrática sem fechamento). */
function dropBlock(html: string, tag: string): string {
  const lower = html.toLowerCase();
  let out = '';
  let pos = 0;
  for (;;) {
    const start = lower.indexOf(`<${tag}`, pos);
    if (start < 0) break;
    out += html.slice(pos, start);
    const end = lower.indexOf(`</${tag}`, start + tag.length + 1);
    const close = end < 0 ? -1 : lower.indexOf('>', end);
    pos = close < 0 ? html.length : close + 1;
  }
  return out + html.slice(pos);
}

/** [^<>]* para no próximo < ou >: cada tentativa custa só até ali (linear). */
function htmlToPlainMarkdown(html: string): string {
  let s = html;
  for (const tag of DROP_BLOCKS) s = dropBlock(s, tag);
  return s
    .replace(/<h([1-6])\b[^<>]*>/gi, (_m, level: string) => `\n\n${'#'.repeat(Number(level))} `)
    .replace(/<li\b[^<>]*>/gi, '\n- ')
    .replace(/<br\b[^<>]*>/gi, '\n')
    .replace(/<\/(?:p|div|h[1-6]|li|tr|table|ul|ol|blockquote|section|article|pre)\s*>/gi, '\n\n')
    .replace(/<\/(?:td|th)\s*>/gi, ' | ')
    .replace(/<[A-Za-z!/?][^<>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_m, e: string) => ENTITIES[e])
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function htmlToMarkdown(html: string): string {
  if (html.length > TURNDOWN_MAX_CHARS) return htmlToPlainMarkdown(html);
  return turndown()
    .turndown(html)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
