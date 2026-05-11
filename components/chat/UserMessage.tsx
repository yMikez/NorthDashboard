'use client';

import * as React from 'react';
import { Pencil, MoreHorizontal, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

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

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      /* noop */
    }
  }

  return (
    <div className="group flex justify-end px-6 py-3">
      <div className="max-w-[80%] relative">
        {editing ? (
          <div className="bg-card border border-border rounded-2xl rounded-tr-sm px-4 py-3">
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  commit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setEditing(false);
                  setDraft(content);
                }
              }}
              rows={Math.min(8, Math.max(2, draft.split('\n').length))}
              className="w-full bg-transparent resize-none outline-none text-sm leading-relaxed"
            />
            <div className="flex justify-end gap-2 mt-2">
              <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setDraft(content); }}>
                Cancelar
              </Button>
              <Button size="sm" onClick={commit}>
                Salvar e re-enviar
              </Button>
            </div>
          </div>
        ) : (
          <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
            {content}
          </div>
        )}

        {!editing && (
          <div className="absolute -left-9 top-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Opções da mensagem">
                  <MoreHorizontal className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => setEditing(true)}>
                  <Pencil className="w-3.5 h-3.5" /> Editar
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void copy()}>
                  <Copy className="w-3.5 h-3.5" /> Copiar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </div>
  );
}
