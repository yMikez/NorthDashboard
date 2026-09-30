'use client';

// Rodapé "Fontes" da resposta: toda citação da mensagem, na ordem [n].
// Vale também pra resposta em blocos — lá não há marcador no texto (os
// blocos vêm de tool, sem citação nativa), então o rodapé é o único lugar
// onde a fonte consultada aparece.

import * as React from 'react';
import { citationLabel } from '@/lib/chat/citeMarkers';
import { attachmentFileUrl } from '@/lib/chat/client';
import type { Citation } from '@/types/chat';
import { citationKindLabel, formatCitationDate } from './CitationChip';
import { NsIcon } from './NsIcon';

const QUOTE_MAX = 160;

function firstQuote(c: Citation): string | null {
  const t = c.citedText.find((x) => x.trim());
  if (!t) return null;
  const flat = t.replace(/\s+/g, ' ').trim();
  return flat.length > QUOTE_MAX ? `${flat.slice(0, QUOTE_MAX - 1)}…` : flat;
}

export function SourcesFooter({ citations }: { citations: Citation[] }) {
  const titleId = React.useId();
  if (!citations.length) return null;
  const sorted = [...citations].sort((a, b) => a.n - b.n);
  return (
    <section aria-labelledby={titleId} className="border-t border-border pt-2">
      <h4 id={titleId} className="mb-1 text-xs leading-[18px] font-medium text-muted-foreground">
        Fontes
      </h4>
      <ol className="space-y-1.5">
        {sorted.map((c) => {
          const quote = firstQuote(c);
          const updated = formatCitationDate(c.updatedAt);
          return (
            <li key={c.n} className="flex items-start gap-2 text-xs leading-[18px]">
              <span
                aria-hidden
                className="mt-px inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-sm border border-ring/35 bg-accent px-1 text-[11px] font-medium leading-none text-ring tabular-nums"
              >
                {c.n}
              </span>
              <span className="min-w-0 flex-1 break-words">
                <span className="sr-only">Fonte {c.n}: </span>
                <span className="font-medium text-foreground">{citationLabel(c)}</span>
                {c.page ? <span className="text-muted-foreground">, p. {c.page}</span> : null}
                <span className="text-muted-foreground">
                  {' · '}
                  {citationKindLabel(c)}
                  {updated ? ` · atualizado em ${updated}` : ''}
                </span>
                {quote && <q className="block text-muted-foreground">{quote}</q>}
                {c.kind === 'attachment' && c.documentId && (
                  <a
                    href={attachmentFileUrl(c.documentId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-ring underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <NsIcon name="external-link" size={12} /> Abrir anexo
                    <span className="sr-only"> {citationLabel(c)}</span>
                  </a>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
