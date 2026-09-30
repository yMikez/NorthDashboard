'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/ui-utils';
import { NsIcon } from './NsIcon';
import { BlockRenderer } from './blocks/BlockRenderer';
import { MarkdownBlock } from './blocks/MarkdownBlock';
import type { Block, ToolUseRecord } from '@/types/chat';

interface AssistantMessageProps {
  content: string;
  toolUses?: ToolUseRecord[] | null;
  blocks?: Block[];
  streaming?: boolean;
  truncated?: boolean;
  onRegenerate?: () => void;
  onFeedback?: (kind: 'up' | 'down') => void;
}

// Ações da resposta: 32 px como o .icon-btn da SPA, 44 px em toque.
const ACTION_BTN =
  'h-8 w-8 text-muted-foreground hover:text-foreground [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11';

/**
 * O ChatShell grava falhas como mensagens locais com prefixo emoji:
 * `⚠️ Erro: …` (erro do stream) e `🚫 …` (limite de uso). Aqui o emoji
 * vira o ícone do DS1 e a mensagem ganha o tom de feedback; o texto
 * ("Erro: …") fica como veio.
 */
type Notice = { tone: 'danger' | 'warning'; text: string };
const ERROR_PREFIX = /^⚠️?\s*(?=Erro:)/u;
const RATE_LIMIT_PREFIX = /^\u{1F6AB}\s*/u;

function parseNotice(content: string): Notice | null {
  if (ERROR_PREFIX.test(content)) return { tone: 'danger', text: content.replace(ERROR_PREFIX, '') };
  if (RATE_LIMIT_PREFIX.test(content)) return { tone: 'warning', text: content.replace(RATE_LIMIT_PREFIX, '') };
  return null;
}

export function AssistantMessage({
  content,
  toolUses,
  blocks,
  streaming,
  truncated,
  onRegenerate,
  onFeedback,
}: AssistantMessageProps) {
  const [copied, setCopied] = React.useState(false);
  const [feedback, setFeedback] = React.useState<'up' | 'down' | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  }

  function vote(kind: 'up' | 'down') {
    setFeedback(kind);
    onFeedback?.(kind);
  }

  const hasBlocks = !!blocks && blocks.length > 0;
  const hasTools = !!toolUses && toolUses.length > 0;
  const notice = !streaming && !hasBlocks && !hasTools && content ? parseNotice(content) : null;

  return (
    <div className="group px-4 sm:px-6 py-4 flex gap-3" aria-busy={streaming || undefined}>
      <div className="w-7 h-7 rounded-md bg-primary text-primary-foreground flex items-center justify-center shrink-0">
        <NsIcon name="ns-insights" size={16} />
      </div>

      <div className="flex-1 min-w-0 space-y-3">
        {hasTools && <ToolUsesStrip uses={toolUses!} streaming={streaming} />}

        {notice ? (
          <div
            role="alert"
            className={cn(
              'nx-bubble-assistant rounded-lg rounded-tl-sm px-4 py-2.5 flex items-start gap-2',
              notice.tone === 'danger' ? 'border-danger/50' : 'border-warning/50',
            )}
          >
            <NsIcon
              name="alert-triangle"
              size={16}
              className={cn('mt-[3px] shrink-0', notice.tone === 'danger' ? 'text-danger' : 'text-warning')}
            />
            <div className="min-w-0 flex-1">
              <MarkdownBlock block={{ content: notice.text }} />
            </div>
          </div>
        ) : (
          content && (
            <div className="nx-bubble-assistant rounded-lg rounded-tl-sm px-4 py-2.5">
              <MarkdownBlock block={{ content }} streaming={streaming && !hasBlocks} />
            </div>
          )
        )}
        {hasBlocks && <BlockRenderer blocks={blocks!} />}
        {!content && !hasBlocks && streaming && (
          <div role="status" className="text-xs text-muted-foreground">
            <span className="sr-only">Gerando resposta</span>
            <span
              aria-hidden
              className="inline-block w-1.5 h-4 bg-ring animate-pulse motion-reduce:animate-none ml-0.5 -mb-0.5"
            />
          </div>
        )}

        {truncated && !streaming && (
          <div className="flex items-start gap-1.5 text-xs leading-[18px] text-warning">
            <NsIcon name="alert-triangle" size={14} className="mt-0.5 shrink-0" />
            <span>Resposta cortada pelo limite de tamanho. Peça para continuar.</span>
          </div>
        )}

        {!streaming && (
          // Visível no hover, no foco por teclado e sempre em tela de toque.
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void copy()}
              aria-label={copied ? 'Copiado' : 'Copiar resposta'}
              title={copied ? 'Copiado' : 'Copiar resposta'}
              className={ACTION_BTN}
            >
              {copied ? <NsIcon name="check" className="text-success" /> : <NsIcon name="copy" />}
            </Button>
            {onRegenerate && (
              // O ChatShell devolve a última pergunta ao campo (não reenvia
              // sozinho) — o rótulo diz isso.
              <Button
                variant="ghost"
                size="icon"
                onClick={onRegenerate}
                aria-label="Repetir a pergunta"
                title="Repetir a pergunta"
                className={ACTION_BTN}
              >
                <NsIcon name="refresh" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => vote('up')}
              aria-label="Resposta útil"
              aria-pressed={feedback === 'up'}
              title="Resposta útil"
              className={cn(ACTION_BTN, feedback === 'up' && 'text-success hover:text-success')}
            >
              <NsIcon name="thumbs-up" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => vote('down')}
              aria-label="Resposta ruim"
              aria-pressed={feedback === 'down'}
              title="Resposta ruim"
              className={cn(ACTION_BTN, feedback === 'down' && 'text-danger hover:text-danger')}
            >
              <NsIcon name="thumbs-down" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolUsesStrip({ uses, streaming }: { uses: ToolUseRecord[]; streaming?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {uses.map((u, i) => {
        const running = streaming && i === uses.length - 1;
        return (
          <span key={i} className={cn('nx-tool-chip', !running && 'is-done')}>
            {running ? (
              <NsIcon name="loader" size={12} className="animate-spin motion-reduce:animate-none" />
            ) : (
              <NsIcon name="wrench" size={12} />
            )}
            {u.name}
          </span>
        );
      })}
    </div>
  );
}
