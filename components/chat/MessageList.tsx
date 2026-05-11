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
      <div className="max-w-2xl mx-auto px-6 pt-16 pb-8 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-primary to-primary/40 flex items-center justify-center mb-4 shadow-lg shadow-primary/20">
          <Sparkles className="w-7 h-7 text-primary-foreground" />
        </div>
        <h1 className="text-2xl font-semibold mb-2">Análise com IA</h1>
        <p className="text-sm text-muted-foreground mb-8 max-w-md mx-auto">
          Pergunte qualquer coisa sobre seus dados de afiliados, vendas, funil e
          performance por plataforma. Respostas tipadas e sempre derivadas dos
          dados reais do dashboard.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-6">
          {SUGGESTED_PROMPTS.map((p) => (
            <Button
              key={p}
              variant="outline"
              className="h-auto py-3 px-4 text-left justify-start whitespace-normal text-xs leading-relaxed"
              onClick={() => onPickPrompt?.(p)}
            >
              {p}
            </Button>
          ))}
        </div>

        <p className="text-[10px] font-mono text-muted-foreground/60 mt-8">
          Cmd+J nova conversa · Cmd+K buscar · Cmd+Enter enviar · Esc fechar
        </p>
      </div>
    </div>
  );
}
