'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { NsIcon } from './NsIcon';

interface UserMessageProps {
  content: string;
  onEdit?: (next: string) => void;
}

export function UserMessage({ content, onEdit }: UserMessageProps) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(content);

  React.useEffect(() => {
    if (!editing) setDraft(content);
  }, [content, editing]);

  function commit() {
    const next = draft.trim();
    if (next && next !== content) onEdit?.(next);
    setEditing(false);
  }

  function cancel() {
    setEditing(false);
    setDraft(content);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      /* noop */
    }
  }

  return (
    <div className="group flex justify-end px-4 sm:px-6 py-3">
      <div className="max-w-[80%] relative">
        {editing ? (
          // Mesma casca do composer: borda de campo e foco (focus-within)
          // no wrapper .nx-input-field; o textarea não tem caixa própria.
          <div className="nx-input-field rounded-lg rounded-tr-sm px-4 py-3">
            <textarea
              autoFocus
              value={draft}
              aria-label="Editar mensagem"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  commit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  cancel();
                }
              }}
              rows={Math.min(8, Math.max(2, draft.split('\n').length))}
              className="block w-full resize-none border-0 rounded-none bg-transparent shadow-none p-0 text-sm leading-[22px] text-foreground outline-none focus:outline-none focus-visible:outline-none"
            />
            <div className="flex justify-end gap-2 mt-3">
              <button type="button" className="btn btn-ghost" onClick={cancel}>
                Cancelar
              </button>
              <button type="button" className="btn btn-primary" onClick={commit}>
                Salvar e reenviar
              </button>
            </div>
          </div>
        ) : (
          <div className="nx-bubble-user rounded-lg rounded-tr-sm px-4 py-2.5 text-sm leading-[22px] whitespace-pre-wrap break-words">
            {content}
          </div>
        )}

        {!editing && (
          // Visível no hover, no foco por teclado e sempre em tela de toque
          // (sem hover lá, ficaria inalcançável).
          <div className="absolute -left-10 top-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Opções da mensagem"
                  title="Opções da mensagem"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                >
                  <NsIcon name="more-horizontal" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {/* Editar só aparece quando há quem reenvie a mensagem;
                    sem onEdit o "Salvar" não faria nada. */}
                {onEdit && (
                  <DropdownMenuItem onSelect={() => setEditing(true)}>
                    <NsIcon name="edit" size={14} /> Editar
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => void copy()}>
                  <NsIcon name="copy" size={14} /> Copiar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </div>
  );
}
