'use client';

import * as React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { NsIcon } from './NsIcon';
import { UserMessage } from './UserMessage';
import { AssistantMessage } from './AssistantMessage';
import type { Message } from '@/types/chat';

interface MessageListProps {
  messages: Message[];
  streaming?: boolean;
  streamingPartial?: { content: string; tools: { name: string; id: string }[] } | null;
  onRegenerate?: () => void;
  onEditUser?: (id: string, next: string) => void;
  emptyState?: React.ReactNode;
}

const SUGGESTED_PROMPTS = [
  'Quais afiliados cresceram mais nos últimos 30 dias?',
  'Compara performance da NeuroMindPro vs GlycoPulse esta semana.',
  'Mostra distribuição de receita por plataforma e país hoje.',
  'Quais SKUs estão com take-rate de upsell abaixo de 15%?',
];

export function MessageList({
  messages,
  streaming,
  streamingPartial,
  onRegenerate,
  onEditUser,
  emptyState,
}: MessageListProps) {
  const endRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, streamingPartial?.content]);

  if (messages.length === 0 && !streaming) {
    return emptyState ?? <EmptyState />;
  }

  return (
    // min-h-0 obrigatório: sem isso o flex-1 usa min-content (altura
    // intrínseca das mensagens), o container expande além do main e
    // empurra o composer pra fora da viewport.
    <ScrollArea className="flex-1 min-h-0">
      <div className="max-w-3xl mx-auto py-4">
        {messages.map((m, idx) =>
          m.role === 'user' ? (
            <UserMessage
              key={m.id}
              content={m.content}
              onEdit={onEditUser ? (next) => onEditUser(m.id, next) : undefined}
            />
          ) : (
            <AssistantMessage
              key={m.id}
              content={m.content}
              toolUses={m.toolUses}
              blocks={m.blocks}
              truncated={m.truncated}
              onRegenerate={idx === messages.length - 1 ? onRegenerate : undefined}
            />
          ),
        )}
        {streaming && streamingPartial && (
          <AssistantMessage
            content={streamingPartial.content}
            toolUses={streamingPartial.tools.map((t) => ({ name: t.name }))}
            streaming
          />
        )}
        <div ref={endRef} />
      </div>
    </ScrollArea>
  );
}

/**
 * Tecla modificadora do sistema: ⌘ no Mac, Ctrl no resto. O servidor não
 * sabe o SO, então o primeiro render (SSR e hidratação) sai sempre com
 * "Ctrl" e só depois da montagem troca pra ⌘ — markup igual nos dois lados.
 */
function useModKeyLabel(): (key: string) => string {
  const [isMac, setIsMac] = React.useState(false);
  React.useEffect(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent || '';
    setIsMac(/mac|iphone|ipad|ipod/i.test(platform));
  }, []);
  return React.useCallback((key: string) => (isMac ? `⌘${key}` : `Ctrl+${key}`), [isMac]);
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center rounded-sm border border-border bg-card px-1.5 text-[11px] leading-[18px] font-medium text-foreground font-[family-name:var(--f-body)]">
      {children}
    </kbd>
  );
}

export function EmptyState({ onPickPrompt }: { onPickPrompt?: (q: string) => void } = {}) {
  const mod = useModKeyLabel();

  return (
    // min-h-0 garante que o flex-1 respeita o limite do main flex column.
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-10 sm:pt-20 pb-8 text-center">
        <div className="w-14 h-14 mx-auto rounded-lg flex items-center justify-center mb-5 bg-card border border-border">
          <NsIcon name="ns-insights" size={28} className="text-ring" />
        </div>
        {/* DS1: título de página 28/36 bold, tracking -0.01em; complemento
            em tom secundário, sem itálico (igual ao .top-h1 em da SPA). */}
        <h2 className="text-[28px] leading-9 font-bold tracking-[-0.01em] text-foreground mb-2">
          Análise <em className="not-italic text-muted-foreground font-medium">com IA</em>
        </h2>
        <p className="text-sm leading-[22px] text-muted-foreground mb-8 max-w-md mx-auto">
          Pergunte sobre afiliados, vendas, funil e desempenho por plataforma.
          As respostas usam os mesmos dados do dashboard.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-6">
          {SUGGESTED_PROMPTS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onPickPrompt?.(p)}
              className="nx-glass-card rounded-lg min-h-11 py-3 px-4 text-left text-sm leading-[22px] text-foreground hover:border-ring transition-colors"
            >
              {p}
            </button>
          ))}
        </div>

        {/* Atalhos de teclado: some em tela de toque (não há Ctrl/⌘ lá). */}
        <p className="text-xs leading-[18px] text-muted-foreground mt-10 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 [@media(pointer:coarse)]:hidden">
          <span><Kbd>{mod('J')}</Kbd> nova conversa</span>
          <span><Kbd>{mod('K')}</Kbd> buscar conversas</span>
          <span><Kbd>Enter</Kbd> enviar</span>
          <span><Kbd>Shift+Enter</Kbd> nova linha</span>
        </p>
      </div>
    </div>
  );
}
