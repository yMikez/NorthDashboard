// Resposta da IA em modo leitura (revisão de feedback e resultado de
// avaliação). Usa os MESMOS renderizadores da conversa (MarkdownBlock +
// BlockRenderer, dentro da bolha do assistente) pra o admin ver exatamente
// o que o usuário viu — sem as ações de copiar/votar/repetir do
// AssistantMessage, que não fazem sentido fora da conversa dele.

'use client';

import * as React from 'react';
import { BlockRenderer } from '../blocks/BlockRenderer';
import { MarkdownBlock } from '../blocks/MarkdownBlock';
import { normalizeAnswer } from './adminCore';

export function ReadOnlyAnswer({ answer }: { answer: unknown }) {
  const { content, blocks } = React.useMemo(() => normalizeAnswer(answer), [answer]);
  if (!content && blocks.length === 0) {
    return <p className="text-xs leading-[18px] text-muted-foreground">Resposta vazia ou indisponível.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {content && (
        <div className="nx-bubble-assistant rounded-lg rounded-tl-sm px-4 py-2.5">
          <MarkdownBlock block={{ content }} />
        </div>
      )}
      {blocks.length > 0 && <BlockRenderer blocks={blocks} />}
    </div>
  );
}
