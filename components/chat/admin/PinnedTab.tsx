// Aba "Fixas" — entradas de conhecimento do admin (KnowledgeEntry).
// Fixa (pinned) vai inteira no system prompt de toda conversa, até o teto
// do bloco fixo; não fixa entra só quando a busca (search_knowledge) acha.
// O medidor mostra quanto do teto já foi usado: bloco cheio demais corta
// entradas e encarece todo turno.
//
// Memórias pendentes/rejeitadas não aparecem aqui (aba "Memórias
// sugeridas"); memória aprovada aparece, mas nunca pode ser fixada
// (decisão do dono: memória só entra pela busca).

'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/ui-utils';
import { NsIcon } from '../NsIcon';
import { adminFetch, errorText } from './adminApi';
import {
  canPin,
  fmtDateTime,
  fmtFraction,
  fmtInt,
  isActiveEntry,
  meterState,
  plural,
  projectedPinnedChars,
  type KbStats,
  type KnowledgeEntryDTO,
} from './adminCore';
import {
  FIELD,
  FlashMessage,
  ListStates,
  ReadState,
  Segmented,
  Switch,
  TOUCH_ICON,
  TOUCH_TEXT,
  ToneBadge,
  useAdminResource,
  useFlash,
  usePaged,
} from './ui';

type ViewFilter = 'all' | 'pinned' | 'search';

const VIEW_OPTIONS: ReadonlyArray<{ id: ViewFilter; label: string }> = [
  { id: 'all', label: 'Todas' },
  { id: 'pinned', label: 'Fixas no prompt' },
  { id: 'search', label: 'Só pela busca' },
];

interface Draft {
  title: string;
  content: string;
  enabled: boolean;
  pinned: boolean;
}

const EMPTY_DRAFT: Draft = { title: '', content: '', enabled: true, pinned: true };

const entryKey = (e: KnowledgeEntryDTO) => e.id;

function isPinned(e: KnowledgeEntryDTO): boolean {
  // Linha sem o campo (antes da migração) nasceu no modelo antigo, em que
  // toda entrada ligada ia pro prompt.
  return e.pinned ?? true;
}

export function PinnedTab({ active }: { active: boolean }) {
  const list = useAdminResource<{ entries: KnowledgeEntryDTO[] }>('/api/admin/knowledge', { active });
  const stats = useAdminResource<KbStats>('/api/admin/kb/stats', { active });
  const [view, setView] = React.useState<ViewFilter>('all');
  const [editing, setEditing] = React.useState<KnowledgeEntryDTO | 'new' | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [flash, setFlash] = useFlash();

  const entries = React.useMemo(
    () => (list.data?.entries ?? []).filter(isActiveEntry),
    [list.data],
  );
  const visible = React.useMemo(
    () =>
      entries.filter((e) =>
        view === 'all' ? true : view === 'pinned' ? isPinned(e) : !isPinned(e),
      ),
    [entries, view],
  );
  const { pageItems, pager } = usePaged(visible, { keyOf: entryKey, label: 'entradas', resetKey: view });

  function applySaved(entry: KnowledgeEntryDTO) {
    list.mutate((d) => {
      const others = d.entries.filter((e) => e.id !== entry.id);
      const merged = [...others, entry].sort(
        (a, b) =>
          a.sortOrder - b.sortOrder || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      return { ...d, entries: merged };
    });
    stats.reload();
  }

  async function patch(entry: KnowledgeEntryDTO, body: Partial<Pick<KnowledgeEntryDTO, 'enabled' | 'pinned'>>, ok: string) {
    setBusyId(entry.id);
    try {
      const res = await adminFetch<{ entry: KnowledgeEntryDTO }>(
        `/api/admin/knowledge/${encodeURIComponent(entry.id)}`,
        { method: 'PATCH', json: body },
      );
      applySaved(res.entry);
      setFlash({ tone: 'ok', text: ok });
    } catch (err) {
      setFlash({ tone: 'error', text: errorText(err) });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(entry: KnowledgeEntryDTO) {
    if (!window.confirm(`Excluir a entrada "${entry.title}"? Ela sai do prompt e da busca.`)) return;
    setBusyId(entry.id);
    try {
      await adminFetch<unknown>(`/api/admin/knowledge/${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
      list.mutate((d) => ({ ...d, entries: d.entries.filter((e) => e.id !== entry.id) }));
      stats.reload();
      setFlash({ tone: 'ok', text: `Entrada "${entry.title}" excluída.` });
    } catch (err) {
      setFlash({ tone: 'error', text: errorText(err) });
    } finally {
      setBusyId(null);
    }
  }

  if (editing) {
    return (
      <EntryEditor
        entry={editing === 'new' ? null : editing}
        stats={stats.data}
        onCancel={() => setEditing(null)}
        onSaved={(entry, created) => {
          applySaved(entry);
          setEditing(null);
          setFlash({ tone: 'ok', text: created ? `Entrada "${entry.title}" criada.` : `Entrada "${entry.title}" salva.` });
        }}
      />
    );
  }

  const pinnedCount = entries.filter((e) => isPinned(e) && e.enabled).length;

  return (
    <div className="flex flex-col gap-3">
      <PinnedMeter stats={stats.data} status={stats.status} error={stats.error} onRetry={stats.reload} />

      <FlashMessage flash={flash} onDismiss={() => setFlash(null)} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented label="Mostrar entradas" value={view} options={VIEW_OPTIONS} onChange={setView} />
        <Button onClick={() => setEditing('new')} className={TOUCH_TEXT}>
          <NsIcon name="plus" /> Nova entrada
        </Button>
      </div>

      {list.status === 'ready' && entries.length > 0 && (
        <p className="text-xs leading-[18px] text-muted-foreground">
          {plural(entries.length, 'entrada', 'entradas')} · {plural(pinnedCount, 'fixa ativa', 'fixas ativas')} ·
          na ordem em que entram no prompt
        </p>
      )}

      <ListStates
        status={list.status}
        error={list.error}
        empty={visible.length === 0}
        emptyTitle={entries.length === 0 ? 'Nenhuma entrada ainda.' : 'Nenhuma entrada neste filtro.'}
        emptyBody={entries.length === 0 ? 'Use "Nova entrada" para ensinar uma regra de negócio, um glossário ou um padrão da operação.' : undefined}
        onRetry={list.reload}
      />

      {visible.length > 0 && (
        <div className="nx-glass-card rounded-lg">
          <ul className="divide-y divide-border">
            {pageItems.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                busy={busyId === entry.id}
                onToggleEnabled={() =>
                  void patch(entry, { enabled: !entry.enabled }, entry.enabled ? `"${entry.title}" desligada.` : `"${entry.title}" ligada.`)
                }
                onTogglePinned={() =>
                  void patch(
                    entry,
                    { pinned: !isPinned(entry) },
                    isPinned(entry) ? `"${entry.title}" agora entra só pela busca.` : `"${entry.title}" agora vai fixa no prompt.`,
                  )
                }
                onEdit={() => setEditing(entry)}
                onDelete={() => void remove(entry)}
              />
            ))}
          </ul>
          {pager}
        </div>
      )}
    </div>
  );
}

function EntryRow({
  entry,
  busy,
  onToggleEnabled,
  onTogglePinned,
  onEdit,
  onDelete,
}: {
  entry: KnowledgeEntryDTO;
  busy: boolean;
  onToggleEnabled: () => void;
  onTogglePinned: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const pinned = isPinned(entry);
  const pinnable = canPin(entry);
  return (
    <li className="flex items-start gap-2 px-3 py-2.5">
      <Switch
        checked={entry.enabled}
        onCheckedChange={onToggleEnabled}
        label={`Entrada "${entry.title}" ativa`}
        busy={busy}
      />
      <div className="min-w-0 flex-1 pt-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="min-w-0 truncate text-sm font-medium text-foreground">{entry.title}</span>
          {pinned ? (
            <ToneBadge tone="accent" icon="pin">Fixa</ToneBadge>
          ) : (
            <ToneBadge tone="neutral" icon="search">Só pela busca</ToneBadge>
          )}
          {entry.source === 'auto' && (
            <ToneBadge tone="neutral" title="Memória extraída de uma conversa e aprovada">memória IA</ToneBadge>
          )}
          {!entry.enabled && <ToneBadge tone="warning">Desligada</ToneBadge>}
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs leading-[18px] text-muted-foreground">{entry.content}</p>
        <p className="mt-0.5 text-xs leading-[18px] text-muted-foreground">
          <span className="font-mono tabular-nums">{fmtInt(entry.content.length)}</span> caracteres · editada{' '}
          {fmtDateTime(entry.updatedAt)}
          {!pinned && (entry.hitCount ?? 0) > 0 && (
            <>
              {' '}· achada pela busca <span className="font-mono tabular-nums">{fmtInt(entry.hitCount)}</span>×
            </>
          )}
        </p>
      </div>
      <div className="flex shrink-0 gap-1 pt-0.5">
        <Button
          variant="ghost"
          size="icon"
          onClick={onTogglePinned}
          disabled={busy || (!pinnable && !pinned)}
          aria-pressed={pinned}
          aria-label={pinned ? `Tirar "${entry.title}" do prompt fixo` : `Fixar "${entry.title}" no prompt`}
          title={
            !pinnable && !pinned
              ? 'Memória aprovada entra só pela busca'
              : pinned
                ? 'Tirar do prompt fixo (fica só pela busca)'
                : 'Fixar no prompt'
          }
          className={cn('text-muted-foreground hover:text-foreground', pinned && 'text-ring hover:text-ring', TOUCH_ICON)}
        >
          <NsIcon name={pinned ? 'pin' : 'pin-off'} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onEdit}
          disabled={busy}
          aria-label={`Editar "${entry.title}"`}
          title="Editar"
          className={cn('text-muted-foreground hover:text-foreground', TOUCH_ICON)}
        >
          <NsIcon name="edit" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onDelete}
          disabled={busy}
          aria-label={`Excluir "${entry.title}"`}
          title="Excluir"
          className={cn('text-destructive hover:bg-destructive/10 hover:text-destructive', TOUCH_ICON)}
        >
          <NsIcon name="trash" />
        </Button>
      </div>
    </li>
  );
}

/** Medidor do bloco fixo (caracteres usados / teto) — role=meter. */
export function PinnedMeter({
  stats,
  status,
  error,
  onRetry,
  projected,
}: {
  stats: KbStats | null;
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  onRetry?: () => void;
  /** Total se o rascunho do editor for salvo. */
  projected?: number;
}) {
  if (!stats) {
    if (status === 'error') {
      return (
        <ReadState kind="parcial" title="Tamanho do bloco fixo indisponível" action={onRetry ? 'Tentar de novo' : undefined} onAction={onRetry}>
          {error}
        </ReadState>
      );
    }
    return <ReadState kind="carregando">Medindo o bloco fixo…</ReadState>;
  }
  const shown = projected ?? stats.pinnedChars;
  const m = meterState(shown, stats.pinnedMaxChars);
  const pct = m.ratio == null ? 0 : Math.min(1, m.ratio);
  const bar = m.level === 'over' ? 'bg-danger' : m.level === 'warn' ? 'bg-warning' : 'bg-primary';
  const text = `${fmtInt(shown)} de ${fmtInt(stats.pinnedMaxChars)} caracteres (${fmtFraction(m.ratio)})`;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-xs font-medium text-muted-foreground">
          {projected != null ? 'Bloco fixo no prompt depois de salvar (≈)' : 'Bloco fixo no prompt'}
        </span>
        <span className="font-mono text-xs tabular-nums text-foreground">{text}</span>
      </div>
      <div
        role="meter"
        aria-label="Uso do bloco fixo do prompt"
        aria-valuemin={0}
        aria-valuemax={stats.pinnedMaxChars}
        aria-valuenow={Math.min(shown, stats.pinnedMaxChars)}
        aria-valuetext={text}
        className="mt-2 h-2 overflow-hidden rounded-full border border-border bg-background"
      >
        <div className={cn('h-full rounded-full', bar)} style={{ width: `${(pct * 100).toFixed(1)}%` }} />
      </div>
      {m.level === 'over' && (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-[18px] text-danger">
          <NsIcon name="alert-triangle" size={14} className="mt-0.5 shrink-0" />
          Acima do teto: o que passar não entra no prompt. Deixe alguma entrada só pela busca.
        </p>
      )}
      {m.level === 'warn' && (
        <p className="mt-1.5 text-xs leading-[18px] text-warning">
          Perto do teto. Regras longas e raras funcionam melhor só pela busca.
        </p>
      )}
    </div>
  );
}

function EntryEditor({
  entry,
  stats,
  onCancel,
  onSaved,
}: {
  entry: KnowledgeEntryDTO | null;
  stats: KbStats | null;
  onCancel: () => void;
  onSaved: (entry: KnowledgeEntryDTO, created: boolean) => void;
}) {
  const [draft, setDraft] = React.useState<Draft>(() =>
    entry
      ? { title: entry.title, content: entry.content, enabled: entry.enabled, pinned: isPinned(entry) }
      : EMPTY_DRAFT,
  );
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [touched, setTouched] = React.useState(false);
  const ids = { title: React.useId(), content: React.useId(), error: React.useId() };
  const pinnable = entry ? canPin(entry) : true;

  const titleInvalid = touched && !draft.title.trim();
  const contentInvalid = touched && !draft.content.trim();
  const projected = stats
    ? projectedPinnedChars(
        stats.pinnedChars,
        entry ? { pinned: isPinned(entry), enabled: entry.enabled, chars: entry.content.length } : null,
        { pinned: draft.pinned, enabled: draft.enabled, chars: draft.content.length },
      )
    : undefined;

  async function save() {
    setTouched(true);
    if (!draft.title.trim() || !draft.content.trim()) {
      setError('Título e conteúdo são obrigatórios.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const url = entry ? `/api/admin/knowledge/${encodeURIComponent(entry.id)}` : '/api/admin/knowledge';
      const res = await adminFetch<{ entry: KnowledgeEntryDTO }>(url, {
        method: entry ? 'PATCH' : 'POST',
        json: {
          title: draft.title.trim(),
          content: draft.content,
          enabled: draft.enabled,
          ...(pinnable ? { pinned: draft.pinned } : {}),
        },
      });
      onSaved(res.entry, !entry);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="flex min-h-0 flex-1 flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      noValidate
    >
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} className={cn('-ml-2', TOUCH_TEXT)}>
          <NsIcon name="chevron-left" /> Voltar para a lista
        </Button>
      </div>
      <h3 className="text-base font-semibold text-foreground">{entry ? 'Editar entrada' : 'Nova entrada'}</h3>

      {stats && <PinnedMeter stats={stats} status="ready" error={null} projected={projected} />}

      {error && (
        <ReadState kind="falha" id={ids.error}>
          {error}
        </ReadState>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.title} className="text-xs font-medium text-muted-foreground">
          Título
        </label>
        <Input
          id={ids.title}
          autoFocus
          placeholder="Ex.: Glossário Digistore"
          value={draft.title}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          aria-invalid={titleInvalid || undefined}
          aria-describedby={titleInvalid ? ids.error : undefined}
          className={cn(FIELD, 'h-9', TOUCH_TEXT)}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={ids.content} className="text-xs font-medium text-muted-foreground">
            Conteúdo (markdown)
          </label>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {fmtInt(draft.content.length)} caracteres
          </span>
        </div>
        {/* Editor de markdown: monoespaçada do sistema (--f-code), não a
            Montserrat de dados que o font-mono vira no chat. */}
        <Textarea
          id={ids.content}
          placeholder={'Ex.: ## Glossário\n- FE: venda de front-end…'}
          value={draft.content}
          onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
          aria-invalid={contentInvalid || undefined}
          aria-describedby={contentInvalid ? ids.error : undefined}
          className={cn(FIELD, 'min-h-[240px] flex-1 resize-y font-[family-name:var(--f-code)] text-[13px] leading-5')}
          rows={16}
          spellCheck={false}
        />
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className="sr-only">Como a entrada chega à IA</legend>
        <label className={cn('flex min-h-9 cursor-pointer select-none items-center gap-2 text-sm', TOUCH_TEXT)}>
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
            className="h-4 w-4 shrink-0 accent-primary"
          />
          Ativa
        </label>
        <label
          className={cn(
            'flex min-h-9 select-none items-center gap-2 text-sm',
            pinnable ? 'cursor-pointer' : 'cursor-not-allowed text-muted-foreground',
            TOUCH_TEXT,
          )}
        >
          <input
            type="checkbox"
            checked={pinnable && draft.pinned}
            disabled={!pinnable}
            onChange={(e) => setDraft((d) => ({ ...d, pinned: e.target.checked }))}
            className="h-4 w-4 shrink-0 accent-primary"
          />
          {pinnable
            ? 'Fixa no prompt (vai inteira em toda conversa; desmarcada, entra só quando a busca achar)'
            : 'Memória aprovada entra só pela busca — não pode ser fixada'}
        </label>
      </fieldset>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving} className={TOUCH_TEXT}>
          <NsIcon name="x" /> Cancelar
        </Button>
        {/* Processando: mantém a largura e bloqueia reenvio (DS1). */}
        <Button type="submit" disabled={saving} aria-busy={saving || undefined} className={cn('min-w-[112px]', TOUCH_TEXT)}>
          <NsIcon name={saving ? 'loader' : 'save'} className={saving ? 'motion-safe:animate-spin' : undefined} />
          {saving ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </form>
  );
}
