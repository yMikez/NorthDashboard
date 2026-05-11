'use client';

import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/ui-utils';
import type { MarkdownBlock as MarkdownData } from '@/types/chat';

export function MarkdownBlock({
  block,
  streaming,
}: {
  block: MarkdownData | { content: string };
  streaming?: boolean;
}) {
  return (
    <div className="prose-chat text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="text-base font-semibold mt-3 mb-1.5">{children}</h1>,
          h2: ({ children }) => <h2 className="text-sm font-semibold mt-3 mb-1.5">{children}</h2>,
          h3: ({ children }) => <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-2 mb-1">{children}</h3>,
          p: ({ children }) => <p className="my-2">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          em: ({ children }) => <em className="italic text-muted-foreground">{children}</em>,
          ul: ({ children }) => <ul className="my-2 ml-4 list-disc space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 ml-4 list-decimal space-y-1">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          code: ({ children, className, ...props }) => {
            const isBlock = (className ?? '').includes('language-');
            return isBlock ? (
              <code className="block rounded-md bg-popover/60 p-3 text-[11px] font-mono overflow-x-auto" {...props}>
                {children}
              </code>
            ) : (
              <code className="rounded bg-popover px-1 py-0.5 text-[11px] font-mono text-primary" {...props}>
                {children}
              </code>
            );
          },
          a: ({ children, ...props }) => (
            <a className="text-primary underline-offset-2 hover:underline" target="_blank" rel="noreferrer" {...props}>
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto rounded-md border border-border">
              <table className="w-full text-xs">{children}</table>
            </div>
          ),
          th: ({ children, ...props }) => (
            <th className="border-b border-border bg-popover/40 px-3 py-1.5 text-left text-[10px] uppercase tracking-wider font-mono text-muted-foreground" {...props}>
              {children}
            </th>
          ),
          td: ({ children, ...props }) => (
            <td className="border-b border-border px-3 py-1.5 tabular-nums" {...props}>
              {children}
            </td>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-primary/40 pl-3 my-2 text-muted-foreground italic">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-3 border-border" />,
        }}
      >
        {block.content}
      </ReactMarkdown>
      {streaming && <span className={cn('inline-block w-1.5 h-4 bg-primary animate-pulse ml-0.5 -mb-0.5')} />}
    </div>
  );
}
