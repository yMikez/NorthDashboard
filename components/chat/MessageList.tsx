'use client';

import * as React from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
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
    <ScrollArea className="flex-1">
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

export function EmptyState({ onPickPrompt }: { onPickPrompt?: (q: string) => void } = {}) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 pt-20 pb-8 text-center">
        <div
          className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-5 relative"
          style={{
            background: 'linear-gradient(135deg, #5BC8FF 0%, #9B7BFF 100%)',
            boxShadow:
              '0 12px 36px -8px rgba(91,200,255,0.55), 0 0 60px -10px rgba(155,123,255,0.4), inset 0 1px 0 rgba(255,255,255,0.55), inset 0 -1px 0 rgba(0,0,0,0.12)',
          }}
        >
          <Sparkles className="w-8 h-8 text-[#0A1638]" />
        </div>
        <h1 className="text-3xl font-semibold mb-2 tracking-tight">
          Análise <em className="not-italic text-[color:var(--glow-cyan)] italic font-medium" style={{ textShadow: '0 0 40px rgba(91,200,255,0.45)' }}>com IA</em>
        </h1>
        <p className="text-sm text-muted-foreground mb-8 max-w-md mx-auto leading-relaxed">
          Pergunte qualquer coisa sobre seus dados de afiliados, vendas, funil e
          performance por plataforma. Respostas tipadas e sempre derivadas dos
          dados reais do dashboard.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-6">
          {SUGGESTED_PROMPTS.map((p) => (
            <button
              key={p}
              onClick={() => onPickPrompt?.(p)}
              className="nx-glass-card rounded-lg py-3 px-4 text-left text-xs leading-relaxed text-foreground hover:border-[color:rgba(91,200,255,0.40)] transition-all hover:-translate-y-0.5"
            >
              {p}
            </button>
          ))}
        </div>

        <p className="nx-eyebrow mt-10 opacity-70">
          Cmd+J nova conversa · Cmd+K buscar · Cmd+Enter enviar · Esc fechar
        </p>
      </div>
    </div>
  );
}
