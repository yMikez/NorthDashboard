// Base de conhecimento — sheet lateral acessada pelo botão "Base de
// conhecimento" no sidebar do chat. CRUD inline simples: lista as entries,
// permite criar/editar/excluir/toggle on-off. Entries `enabled` são
// injetadas no system prompt do AI a cada conversa (cache 60s no service).
//
// Apenas ADMIN tem acesso aos endpoints `/api/admin/knowledge` — o gatilho
// só aparece pra admin (ChatShell/Sidebar). Erro da API vira estado de
// falha (ns-readstate da SPA).

'use client';

import * as React from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/ui-utils';
import { NsIcon } from './NsIcon';

interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  enabled: boolean;
  source: 'manual' | 'auto';
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface DraftEntry {
  title: string;
  content: string;
  enabled: boolean;
}

const EMPTY_DRAFT: DraftEntry = { title: '', content: '', enabled: true };

// DS1: controle 36px, 44px em toque (botão de ícone: 40px, como a SPA).
const TOUCH_TEXT = '[@media(pointer:coarse)]:min-h-11';
const TOUCH_ICON = '[@media(pointer:coarse)]:min-h-10 [@media(pointer:coarse)]:min-w-10';
// Campo do DS1: superfície, limite de controle (--input = border-strong) e
// foco de 2px (1px de borda no acento + 1px de anel).
const FIELD = 'bg-card text-sm shadow-none focus-visible:ring-1 focus-visible:border-ring';

export function KnowledgeSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const [entries, setEntries] = React.useState<KnowledgeEntry[]>([]);
  const [status, setStatus] = React.useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<DraftEntry>(EMPTY_DRAFT);
  const [creatingNew, setCreatingNew] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const errorId = React.useId();
  const titleFieldId = React.useId();
  const contentFieldId = React.useId();

  // Load list on open.
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStatus('loading');
    setError(null);
    fetch('/api/admin/knowledge', { headers: { Accept: 'application/json' } })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `${res.status}`);
        }
        return res.json();
      })
      .then((data: { entries: KnowledgeEntry[] }) => {
        if (cancelled) return;
        setEntries(data.entries);
        setStatus('idle');
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setStatus('error');
      });
    return () => { cancelled = true; };
  }, [open]);

  function startEdit(entry: KnowledgeEntry) {
    setEditingId(entry.id);
    setDraft({ title: entry.title, content: entry.content, enabled: entry.enabled });
    setCreatingNew(false);
  }

  function startNew() {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setCreatingNew(true);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setCreatingNew(false);
  }

  async function save() {
    if (!draft.title.trim() || !draft.content.trim()) {
      setError('Título e conteúdo são obrigatórios.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const url = editingId
        ? `/api/admin/knowledge/${encodeURIComponent(editingId)}`
        : '/api/admin/knowledge';
      const method = editingId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          title: draft.title.trim(),
          content: draft.content,
          enabled: draft.enabled,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `${res.status}`);
      }
      const { entry } = (await res.json()) as { entry: KnowledgeEntry };
      setEntries((prev) => {
        const without = prev.filter((e) => e.id !== entry.id);
        return [...without, entry].sort(
          (a, b) => a.sortOrder - b.sortOrder
            || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
      });
      cancelEdit();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'erro desconhecido');
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(entry: KnowledgeEntry) {
    try {
      const res = await fetch(`/api/admin/knowledge/${encodeURIComponent(entry.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ enabled: !entry.enabled }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const { entry: updated } = (await res.json()) as { entry: KnowledgeEntry };
      setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'erro ao atualizar');
    }
  }

  async function deleteEntry(entry: KnowledgeEntry) {
    if (!window.confirm(`Excluir "${entry.title}"?`)) return;
    try {
      const res = await fetch(`/api/admin/knowledge/${encodeURIComponent(entry.id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
      if (editingId === entry.id) cancelEdit();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'erro ao excluir');
    }
  }

  const editing = editingId != null || creatingNew;
  const activeCount = entries.filter((e) => e.enabled).length;
  // Erro de validação aponta pro campo vazio (DS1: erro ligado ao campo).
  const titleInvalid = editing && error != null && !draft.title.trim();
  const contentInvalid = editing && error != null && !draft.content.trim();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:w-[520px] sm:max-w-[520px] flex flex-col">
        <SheetHeader className="pr-8">
          <SheetTitle className="flex items-center gap-2">
            <NsIcon name="book-open" className="shrink-0 text-ring" /> Base de conhecimento
          </SheetTitle>
          <SheetDescription className="leading-relaxed">
            Cada entrada ligada vira parte do system prompt da IA em todas as conversas.
            Use pra ensinar regras de negócio, glossários e padrões da operação. Entradas
            marcadas <span className="text-ring">memória IA</span> foram extraídas
            automaticamente de conversas — desligue ou apague se ficarem ruins.
          </SheetDescription>
        </SheetHeader>

        {error && (
          <div id={errorId} className="ns-readstate is-falha" role="alert">
            <NsIcon name="alert-triangle" />
            <div className="ns-readstate-body">{error}</div>
          </div>
        )}

        {editing ? (
          <div className="flex-1 flex flex-col gap-3 min-h-0">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={titleFieldId} className="text-xs font-medium text-muted-foreground">
                Título
              </label>
              <Input
                id={titleFieldId}
                autoFocus
                placeholder="Ex.: Glossário Digistore"
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                aria-invalid={titleInvalid || undefined}
                aria-describedby={titleInvalid ? errorId : undefined}
                className={cn(FIELD, 'h-9', TOUCH_TEXT)}
              />
            </div>
            <div className="flex-1 flex flex-col gap-1.5 min-h-0">
              <label htmlFor={contentFieldId} className="text-xs font-medium text-muted-foreground">
                Conteúdo (markdown, vai literal pro system prompt)
              </label>
              {/* Editor de código/markdown: monoespaçada do sistema (--f-code),
                  não a Montserrat de dados que o font-mono vira no chat. */}
              <Textarea
                id={contentFieldId}
                placeholder={'Ex.: ## Glossário\n- FE: venda de front-end…'}
                value={draft.content}
                onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
                aria-invalid={contentInvalid || undefined}
                aria-describedby={contentInvalid ? errorId : undefined}
                className={cn(FIELD, 'flex-1 min-h-[240px] resize-none text-[13px] leading-5 font-[family-name:var(--f-code)]')}
                rows={20}
                spellCheck={false}
              />
            </div>
            <label className={cn('flex items-center gap-2 min-h-9 text-sm cursor-pointer select-none', TOUCH_TEXT)}>
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
                className="h-4 w-4 shrink-0 accent-primary"
              />
              Ativa (será injetada no system prompt)
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={cancelEdit} disabled={saving} className={TOUCH_TEXT}>
                <NsIcon name="x" /> Cancelar
              </Button>
              {/* Processando: mantém a largura e bloqueia reenvio (DS1). */}
              <Button onClick={save} disabled={saving} aria-busy={saving || undefined} className={cn('min-w-[112px]', TOUCH_TEXT)}>
                <NsIcon name={saving ? 'loader' : 'save'} className={saving ? 'motion-safe:animate-spin' : undefined} />{' '}
                {saving ? 'Salvando…' : 'Salvar'}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                <span className="font-mono tabular-nums">{entries.length}</span>{' '}
                {entries.length === 1 ? 'entrada' : 'entradas'}
                {activeCount !== entries.length && (
                  <>
                    {' · '}
                    <span className="font-mono tabular-nums">{activeCount}</span>{' '}
                    {activeCount === 1 ? 'ativa' : 'ativas'}
                  </>
                )}
              </span>
              <Button onClick={startNew} className={TOUCH_TEXT}>
                <NsIcon name="plus" /> Nova entrada
              </Button>
            </div>

            <ScrollArea className="flex-1 -mx-2 px-2">
              {status === 'loading' && (
                <div className="ns-readstate is-carregando" role="status">
                  <NsIcon name="loader" />
                  <div className="ns-readstate-body">Carregando…</div>
                </div>
              )}
              {status === 'idle' && entries.length === 0 && (
                <div className="ns-readstate is-vazio" role="status">
                  <NsIcon name="info" />
                  <div>
                    <strong>Nenhuma entrada ainda.</strong>
                    <div className="ns-readstate-body">
                      Use “Nova entrada” pra adicionar um bloco de conhecimento.
                    </div>
                  </div>
                </div>
              )}
              <div className="space-y-2 pb-3">
                {entries.map((entry) => (
                  <div key={entry.id} className="border border-border rounded-lg bg-card p-3">
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={entry.enabled}
                        onClick={() => toggleEnabled(entry)}
                        className={cn(
                          'shrink-0 -ml-1 -mt-0.5 grid h-7 w-7 place-items-center rounded-md transition-colors hover:bg-accent',
                          TOUCH_ICON,
                        )}
                        aria-label={`Entrada "${entry.title}" ativa`}
                        title={entry.enabled ? 'Ativa — clique pra desligar' : 'Inativa — clique pra ligar'}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            'block h-3 w-3 rounded-full border',
                            entry.enabled ? 'bg-ring border-ring' : 'bg-transparent border-input',
                          )}
                        />
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground truncate flex items-center gap-2">
                          <span className="truncate">{entry.title}</span>
                          {entry.source === 'auto' && (
                            <span
                              className="shrink-0 text-xs font-medium px-1.5 py-0.5 rounded-sm bg-accent text-ring border border-ring/30"
                              title="Memória extraída automaticamente de uma conversa"
                            >
                              memória IA
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                          {entry.content}
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => startEdit(entry)}
                          aria-label={`Editar "${entry.title}"`}
                          title="Editar"
                          className={cn('text-muted-foreground hover:text-foreground', TOUCH_ICON)}
                        >
                          <NsIcon name="edit" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => deleteEntry(entry)}
                          aria-label={`Excluir "${entry.title}"`}
                          title="Excluir"
                          className={cn('text-destructive hover:text-destructive hover:bg-destructive/10', TOUCH_ICON)}
                        >
                          <NsIcon name="trash" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
