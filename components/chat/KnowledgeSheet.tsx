// Base de conhecimento — sheet lateral acessada pelo botão "Base de
// conhecimento" no sidebar do chat. CRUD inline simples: lista as entries,
// permite criar/editar/excluir/toggle on-off. Entries `enabled` são
// injetadas no system prompt do AI a cada conversa (cache 60s no service).
//
// Apenas ADMIN tem acesso aos endpoints `/api/admin/knowledge` — não-admin
// vê o botão mas recebe 403 ao tentar abrir. UI mostra mensagem de erro.

'use client';

import * as React from 'react';
import { Plus, Trash2, Save, X, FileText } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';

interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  enabled: boolean;
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[520px] sm:max-w-[520px] flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" /> Base de conhecimento
          </SheetTitle>
          <SheetDescription className="text-xs leading-relaxed">
            Cada entrada ligada vira parte do system prompt do AI em todas as conversas.
            Use pra ensinar regras de negócio, glossários, padrões específicos da operação.
          </SheetDescription>
        </SheetHeader>

        {error && (
          <div className="bg-destructive/10 border border-destructive/40 text-destructive text-xs rounded-md p-2 mt-2">
            {error}
          </div>
        )}

        {editing ? (
          <div className="flex-1 flex flex-col gap-3 mt-2 overflow-hidden">
            <Input
              autoFocus
              placeholder="Título (ex: Glossário Digistore)"
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            />
            <Textarea
              placeholder="Conteúdo em markdown. Vai literal pro system prompt da IA."
              value={draft.content}
              onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
              className="flex-1 resize-none font-mono text-xs"
              rows={20}
            />
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
                className="accent-primary"
              />
              Ativa (será injetada no system prompt)
            </label>
            <div className="flex justify-end gap-2 mt-1">
              <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={saving}>
                <X className="w-3.5 h-3.5" /> Cancelar
              </Button>
              <Button size="sm" onClick={save} disabled={saving}>
                <Save className="w-3.5 h-3.5" /> {saving ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mt-2 mb-1">
              <span className="text-xs text-muted-foreground">
                {entries.length} {entries.length === 1 ? 'entrada' : 'entradas'}
                {entries.filter((e) => e.enabled).length !== entries.length && (
                  <> · {entries.filter((e) => e.enabled).length} ativas</>
                )}
              </span>
              <Button size="sm" onClick={startNew}>
                <Plus className="w-3.5 h-3.5" /> Nova entrada
              </Button>
            </div>

            <ScrollArea className="flex-1 -mx-2 px-2">
              {status === 'loading' && (
                <div className="text-xs text-muted-foreground p-4 text-center">Carregando...</div>
              )}
              {status === 'idle' && entries.length === 0 && (
                <div className="text-xs text-muted-foreground p-6 text-center leading-relaxed">
                  Nenhuma entrada ainda.<br />
                  Clique "Nova entrada" pra adicionar um bloco de conhecimento.
                </div>
              )}
              <div className="space-y-2 pb-3">
                {entries.map((entry) => (
                  <div
                    key={entry.id}
                    className="border border-border rounded-md p-3 hover:bg-accent/30 transition-colors"
                  >
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        onClick={() => toggleEnabled(entry)}
                        className={
                          'shrink-0 w-3 h-3 rounded-full border mt-1.5 ' +
                          (entry.enabled
                            ? 'bg-primary border-primary'
                            : 'bg-transparent border-muted-foreground')
                        }
                        aria-label={entry.enabled ? 'Desativar' : 'Ativar'}
                        title={entry.enabled ? 'Ativa — clique pra desligar' : 'Inativa — clique pra ligar'}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{entry.title}</div>
                        <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                          {entry.content}
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="icon-sm" onClick={() => startEdit(entry)} aria-label="Editar">
                          <FileText className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => deleteEntry(entry)}
                          aria-label="Excluir"
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
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
