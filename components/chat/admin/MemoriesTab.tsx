// Aba "Memórias sugeridas" — fila de revisão da memória automática v2.
// O extrator lê SÓ o texto do usuário e salva a sugestão como pendente;
// nada entra na base sem o admin aprovar vendo a evidência (o trecho
// literal que sustenta o fato). Aprovada vira documento pesquisável
// (kind 'memory'), nunca fixa — decisão do dono, pra um erro do modelo não
// virar "fato autoritativo" em toda conversa.

'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/ui-utils';
import { NsIcon } from '../NsIcon';
import { adminFetch, errorText } from './adminApi';
import { fmtDateTime, fmtFraction, plural, type MemoryDTO, type MemoryStatus } from './adminCore';
import {
  FIELD,
  Field,
  FlashMessage,
  ListStates,
  ReadState,
  Segmented,
  TOUCH_TEXT,
  ToneBadge,
  useAdminResource,
  useFlash,
  usePaged,
} from './ui';

const STATUS_OPTIONS: ReadonlyArray<{ id: MemoryStatus; label: string }> = [
  { id: 'pending', label: 'Pendentes' },
  { id: 'active', label: 'Aprovadas' },
  { id: 'rejected', label: 'Rejeitadas' },
];

const EMPTY_TEXT: Record<MemoryStatus, string> = {
  pending: 'Nenhuma memória esperando revisão.',
  active: 'Nenhuma memória aprovada.',
  rejected: 'Nenhuma memória rejeitada.',
};

const memoryKey = (m: MemoryDTO) => m.id;

export function MemoriesTab({
  active,
  onPendingCount,
}: {
  active: boolean;
  /** Tamanho da fila pendente — o selo da aba acompanha as aprovações. */
  onPendingCount: (n: number) => void;
}) {
  const [status, setStatus] = React.useState<MemoryStatus>('pending');
  const mem = useAdminResource<{ memories: MemoryDTO[] }>(
    `/api/admin/kb/memories?status=${status}`,
    { active },
  );
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [flash, setFlash] = useFlash();
  const memories = React.useMemo(() => mem.data?.memories ?? [], [mem.data]);
  const { pageItems, pager } = usePaged(memories, { keyOf: memoryKey, label: 'memórias', resetKey: status });

  React.useEffect(() => {
    if (status === 'pending' && mem.status === 'ready' && mem.data) onPendingCount(mem.data.memories.length);
  }, [status, mem.status, mem.data, onPendingCount]);

  async function decide(m: MemoryDTO, next: 'active' | 'rejected', edits?: { title: string; content: string }) {
    setBusyId(m.id);
    try {
      await adminFetch<unknown>(`/api/admin/kb/memories/${encodeURIComponent(m.id)}`, {
        method: 'PATCH',
        json: { status: next, ...(edits ?? {}) },
      });
      // Mudou de status = saiu desta lista (a fila encolhe e fica na página).
      mem.mutate((d) => ({ ...d, memories: d.memories.filter((x) => x.id !== m.id) }));
      const title = edits?.title ?? m.title;
      setFlash({
        tone: 'ok',
        text:
          next === 'active'
            ? `"${title}" aprovada: vira documento pesquisável da base.`
            : `"${title}" rejeitada: não entra na base.`,
      });
    } catch (err) {
      setFlash({ tone: 'error', text: errorText(err) });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs leading-[18px] text-muted-foreground">
        Fatos que a IA extraiu do que um administrador escreveu no chat. Nada entra na base sem aprovação; aprovadas
        viram documentos pesquisáveis, nunca entradas fixas.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented label="Status das memórias" value={status} options={STATUS_OPTIONS} onChange={setStatus} />
        {mem.status === 'ready' && memories.length > 0 && (
          <span className="text-xs text-muted-foreground">{plural(memories.length, 'memória', 'memórias')}</span>
        )}
      </div>

      <FlashMessage flash={flash} onDismiss={() => setFlash(null)} />

      <ListStates
        status={mem.status}
        error={mem.error}
        empty={memories.length === 0}
        emptyTitle={EMPTY_TEXT[status]}
        onRetry={mem.reload}
      />

      {memories.length > 0 && (
        <div className="flex flex-col gap-2">
          <ul className="flex flex-col gap-2">
            {pageItems.map((m) => (
              <MemoryCard
                key={m.id}
                memory={m}
                listStatus={status}
                busy={busyId === m.id}
                onApprove={(edits) => void decide(m, 'active', edits)}
                onReject={() => void decide(m, 'rejected')}
              />
            ))}
          </ul>
          {pager && <div className="nx-glass-card rounded-lg">{pager}</div>}
        </div>
      )}
    </div>
  );
}

function MemoryCard({
  memory,
  listStatus,
  busy,
  onApprove,
  onReject,
}: {
  memory: MemoryDTO;
  listStatus: MemoryStatus;
  busy: boolean;
  onApprove: (edits?: { title: string; content: string }) => void;
  onReject: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [title, setTitle] = React.useState(memory.title);
  const [content, setContent] = React.useState(memory.content);
  const [error, setError] = React.useState<string | null>(null);
  const ids = { title: React.useId(), content: React.useId(), error: React.useId() };

  function approveEdited() {
    if (!title.trim() || !content.trim()) {
      setError('Título e conteúdo são obrigatórios.');
      return;
    }
    setError(null);
    onApprove({ title: title.trim(), content: content.trim() });
  }

  return (
    <li className="nx-glass-card rounded-lg p-3">
      {editing ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            approveEdited();
          }}
          noValidate
          aria-label={`Editar a memória "${memory.title}" antes de aprovar`}
        >
          {error && (
            <ReadState kind="falha" id={ids.error}>
              {error}
            </ReadState>
          )}
          <Field label="Título" htmlFor={ids.title}>
            <Input
              id={ids.title}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-invalid={(error != null && !title.trim()) || undefined}
              aria-describedby={error != null && !title.trim() ? ids.error : undefined}
              className={cn(FIELD, 'h-9', TOUCH_TEXT)}
            />
          </Field>
          <Field label="Conteúdo" htmlFor={ids.content}>
            <Textarea
              id={ids.content}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
              aria-invalid={(error != null && !content.trim()) || undefined}
              aria-describedby={error != null && !content.trim() ? ids.error : undefined}
              className={cn(FIELD, 'resize-y')}
            />
          </Field>
          <Evidence memory={memory} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setEditing(false)} disabled={busy} className={TOUCH_TEXT}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy} aria-busy={busy || undefined} className={cn('min-w-[160px]', TOUCH_TEXT)}>
              <NsIcon name={busy ? 'loader' : 'check'} className={busy ? 'motion-safe:animate-spin' : undefined} />
              {busy ? 'Aprovando…' : 'Aprovar com edição'}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="min-w-0 text-sm font-medium text-foreground">{memory.title}</span>
            {memory.confidence != null && (
              <ToneBadge
                tone={memory.confidence < 0.5 ? 'warning' : 'neutral'}
                title="Confiança do extrator (abaixo de 50%, revise com mais cuidado)"
              >
                Confiança {fmtFraction(memory.confidence)}
              </ToneBadge>
            )}
            <span className="text-xs text-muted-foreground">{fmtDateTime(memory.createdAt)}</span>
          </div>
          <p className="whitespace-pre-wrap break-words text-sm leading-[22px] text-foreground">{memory.content}</p>
          <Evidence memory={memory} />
          <div className="flex flex-wrap justify-end gap-2">
            {listStatus !== 'rejected' && (
              <Button variant="ghost" onClick={onReject} disabled={busy} className={cn('text-danger hover:text-danger', TOUCH_TEXT)}>
                <NsIcon name="x" /> {listStatus === 'active' ? 'Tirar da base' : 'Rejeitar'}
              </Button>
            )}
            {listStatus === 'pending' && (
              <Button variant="outline" onClick={() => setEditing(true)} disabled={busy} className={TOUCH_TEXT}>
                <NsIcon name="edit" /> Editar e aprovar
              </Button>
            )}
            {listStatus !== 'active' && (
              <Button onClick={() => onApprove()} disabled={busy} aria-busy={busy || undefined} className={cn('min-w-[112px]', TOUCH_TEXT)}>
                <NsIcon name={busy ? 'loader' : 'check'} className={busy ? 'motion-safe:animate-spin' : undefined} />
                {busy ? 'Salvando…' : 'Aprovar'}
              </Button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function Evidence({ memory }: { memory: MemoryDTO }) {
  if (!memory.evidence) {
    return (
      <p className="text-xs leading-[18px] text-warning">
        Sem evidência registrada — confira com cuidado antes de aprovar.
      </p>
    );
  }
  return (
    <figure className="rounded-md border border-border bg-background px-3 py-2">
      <figcaption className="text-xs font-medium text-muted-foreground">O que o usuário escreveu</figcaption>
      <blockquote className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-5 text-foreground">
        {memory.evidence}
      </blockquote>
    </figure>
  );
}
