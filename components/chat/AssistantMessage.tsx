'use client';

import * as React from 'react';
import {
  Copy,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
  Sparkles,
  Wrench,
  Check,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/ui-utils';
import { BlockRenderer } from './blocks/BlockRenderer';
import { MarkdownBlock } from './blocks/MarkdownBlock';
import type { Block, ToolUseRecord } from '@/types/chat';

interface AssistantMessageProps {
  content: string;
  toolUses?: ToolUseRecord[] | null;
  blocks?: Block[];
  streaming?: boolean;
  onRegenerate?: () => void;
  onFeedback?: (kind: 'up' | 'down') => void;
}

export function AssistantMessage({
  content,
  toolUses,
  blocks,
  streaming,
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

  const hasBlocks = blocks && blocks.length > 0;

  return (
    <div className="group px-6 py-4 flex gap-3">
      <div className="w-7 h-7 rounded-md bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shrink-0">
        <Sparkles className="w-4 h-4 text-primary-foreground" />
      </div>

      <div className="flex-1 min-w-0 space-y-3">
        {toolUses && toolUses.length > 0 && (
          <ToolUsesStrip uses={toolUses} streaming={streaming} />
        )}

        {content && (
          <div className="nx-bubble-assistant rounded-2xl rounded-tl-sm px-4 py-2.5">
            <MarkdownBlock
              block={{ content }}
              streaming={streaming && !hasBlocks}
            />
          </div>
        )}
        {hasBlocks && <BlockRenderer blocks={blocks!} />}
        {!content && !hasBlocks && streaming && (
          <div className="text-xs text-muted-foreground italic">
            <span className="inline-block w-1.5 h-4 bg-primary animate-pulse ml-0.5 -mb-0.5" />
          </div>
        )}

        {!streaming && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button variant="ghost" size="icon-sm" onClick={() => void copy()} aria-label="Copiar">
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            </Button>
            {onRegenerate && (
              <Button variant="ghost" size="icon-sm" onClick={onRegenerate} aria-label="Regenerar">
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => vote('up')}
              aria-label="Resposta útil"
              className={cn(feedback === 'up' && 'text-emerald-500')}
            >
              <ThumbsUp className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => vote('down')}
              aria-label="Resposta ruim"
              className={cn(feedback === 'down' && 'text-rose-500')}
            >
              <ThumbsDown className="w-3.5 h-3.5" />
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
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Wrench className="w-3 h-3" />
            )}
            {u.name}
          </span>
        );
      })}
    </div>
  );
}

