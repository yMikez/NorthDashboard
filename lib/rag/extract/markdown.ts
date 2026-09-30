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

export function htmlToMarkdown(html: string): string {
  return turndown()
    .turndown(html)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
