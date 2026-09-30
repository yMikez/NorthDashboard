'use client';

import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { MarkdownBlock as MarkdownData } from '@/types/chat';

// Texto corrido, listas, tabelas e negrito herdam a cor da resposta (a
// bolha define --foreground); só título h3, ênfase e cabeçalho de tabela
// usam o tom secundário. Link fica no acento (text-ring passa 4,5:1 nos
// dois temas) e só ganha sublinhado no hover — sem troca de cor.
//
// react-markdown 10 passa `node` (hast) pra todo componente: tirar antes de
// espalhar as props, senão vira atributo node="[object Object]" no DOM.
export function MarkdownBlock({
  block,
  streaming,
}: {
  block: MarkdownData | { content: string };
  streaming?: boolean;
}) {
  return (
    <div className="text-sm leading-[22px] text-inherit break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-base leading-6 font-semibold text-inherit mt-3 mb-1.5 first:mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-sm font-semibold text-inherit mt-3 mb-1.5 first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-xs leading-[18px] font-semibold text-muted-foreground mt-2 mb-1 first:mt-0">{children}</h3>
          ),
          p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0 text-inherit">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-inherit">{children}</strong>,
          em: ({ children }) => <em className="not-italic text-muted-foreground">{children}</em>,
          ul: ({ children }) => (
            <ul className="my-2 first:mt-0 last:mb-0 ml-4 list-disc space-y-1 text-inherit">{children}</ul>
          ),
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
          a: ({ children, node: _node, ...props }) => (
            <a
              {...props}
              className="text-ring underline-offset-2 hover:underline hover:text-ring"
              target="_blank"
              rel="noreferrer"
            >
              {children}
            </a>
          ),
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
        }}
      >
        {block.content}
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
