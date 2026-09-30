// Aba "Documentos" — base GLOBAL pesquisável (KbDocument): docs do
// repositório (seed), uploads do admin, espelhos das entradas fixas e
// memórias aprovadas. Aqui o admin envia, liga/desliga, corrige metadados,
// reindexa e exclui. Documento desligado sai da busca na hora.
//
// Indexação é assíncrona (PENDING → PROCESSING → READY/FAILED): a lista se
// acompanha sozinha a cada 4 s enquanto houver documento em andamento e a
// aba estiver visível.

'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/ui-utils';
import { NsIcon } from '../NsIcon';
import { adminFetch, errorText, isAbortError, uploadWithProgress } from './adminApi';
import {
  DOC_STATUS,
  KB_UPLOAD_ACCEPT,
  KB_UPLOAD_MAX_BYTES,
  SOURCE_TYPE_LABEL,
  UPLOAD_KINDS,
  docManagedElsewhere,
  fmtBytes,
  fmtDateTime,
  fmtDay,
  fmtFraction,
  fmtInt,
  isDocInFlight,
  isUploadKind,
  isoToDateInput,
  kindLabel,
  matchesText,
  plural,
  summarizeSeedResult,
  titleFromFileName,
  type KbDocStatus,
  type KbDocumentDTO,
  type KbStats,
} from './adminCore';
import {
  FIELD,
  Field,
  FlashMessage,
  ListStates,
  NativeSelect,
  ReadState,
  Switch,
  TOUCH_ICON,
  TOUCH_TEXT,
  ToneBadge,
  useAdminResource,
  useFlash,
  usePaged,
} from './ui';

const DOCS_URL = '/api/admin/kb/documents?scope=GLOBAL';
const docKey = (d: KbDocumentDTO) => d.id;
const hasInFlight = (d: { documents: KbDocumentDTO[] }) => d.documents.some((x) => isDocInFlight(x.status));

const STATUS_FILTERS: ReadonlyArray<{ id: 'all' | KbDocStatus; label: string }> = [
  { id: 'all', label: 'Todos os status' },
  { id: 'READY', label: DOC_STATUS.READY.label },
  { id: 'PROCESSING', label: DOC_STATUS.PROCESSING.label },
  { id: 'PENDING', label: DOC_STATUS.PENDING.label },
  { id: 'FAILED', label: DOC_STATUS.FAILED.label },
  { id: 'EXPIRED', label: DOC_STATUS.EXPIRED.label },
];

export function DocumentsTab({ active }: { active: boolean }) {
  const docs = useAdminResource<{ documents: KbDocumentDTO[] }>(DOCS_URL, {
    active,
    pollMs: 4000,
    pollWhile: hasInFlight,
  });
  const stats = useAdminResource<KbStats>('/api/admin/kb/stats', { active });
  const [query, setQuery] = React.useState('');
  const [kind, setKind] = React.useState('all');
  const [status, setStatus] = React.useState<'all' | KbDocStatus>('all');
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [seeding, setSeeding] = React.useState(false);
  const [flash, setFlash] = useFlash();
  const searchId = React.useId();
  const kindId = React.useId();
  const statusId = React.useId();

  // Indexação terminou (havia documento em andamento e não há mais): o
  // total de trechos do resumo mudou.
  const inFlight = docs.data ? hasInFlight(docs.data) : false;
  const hadInFlight = React.useRef(inFlight);
  const reloadStats = stats.reload;
  React.useEffect(() => {
    if (hadInFlight.current && !inFlight) reloadStats();
    hadInFlight.current = inFlight;
  }, [inFlight, reloadStats]);

  const all = React.useMemo(
    () =>
      [...(docs.data?.documents ?? [])].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      ),
    [docs.data],
  );
  const kinds = React.useMemo(() => [...new Set(all.map((d) => d.kind))].sort(), [all]);
  const visible = React.useMemo(
    () =>
      all.filter(
        (d) =>
          (kind === 'all' || d.kind === kind) &&
          (status === 'all' || d.status === status) &&
          matchesText(query, d.title, d.fileName, d.description, d.sourceRef),
      ),
    [all, kind, status, query],
  );
  const { pageItems, pager } = usePaged(visible, {
    keyOf: docKey,
    label: 'documentos',
    resetKey: `${kind}|${status}|${query}`,
  });

  function upsertDoc(doc: KbDocumentDTO) {
    docs.mutate((d) => {
      const exists = d.documents.some((x) => x.id === doc.id);
      return {
        ...d,
        documents: exists ? d.documents.map((x) => (x.id === doc.id ? doc : x)) : [doc, ...d.documents],
      };
    });
  }

  async function run(doc: KbDocumentDTO, fn: () => Promise<void>) {
    setBusyId(doc.id);
    try {
      await fn();
    } catch (err) {
      setFlash({ tone: 'error', text: errorText(err) });
    } finally {
      setBusyId(null);
    }
  }

  const toggleEnabled = (doc: KbDocumentDTO) =>
    run(doc, async () => {
      const res = await adminFetch<{ document?: KbDocumentDTO }>(
        `/api/admin/kb/documents/${encodeURIComponent(doc.id)}`,
        { method: 'PATCH', json: { enabled: !doc.enabled } },
      );
      upsertDoc(res?.document ?? { ...doc, enabled: !doc.enabled });
      setFlash({
        tone: 'ok',
        text: doc.enabled ? `"${doc.title}" desligado: saiu da busca.` : `"${doc.title}" ligado: volta à busca.`,
      });
    });

  const reindex = (doc: KbDocumentDTO) =>
    run(doc, async () => {
      const res = await adminFetch<{ document?: KbDocumentDTO; chunks?: number }>(
        `/api/admin/kb/documents/${encodeURIComponent(doc.id)}/reindex`,
        { method: 'POST' },
      );
      if (res?.document) upsertDoc(res.document);
      // Sem o documento na resposta, a lista recarrega (e acompanha se ficou em andamento).
      else docs.reload();
      stats.reload();
      setFlash({
        tone: 'ok',
        text:
          typeof res?.chunks === 'number'
            ? `"${doc.title}" reindexado: ${plural(res.chunks, 'trecho', 'trechos')}.`
            : `Reindexação de "${doc.title}" iniciada.`,
      });
    });

  const remove = (doc: KbDocumentDTO) => {
    const warn =
      doc.sourceType === 'repo_md'
        ? `Excluir "${doc.title}"? Ele vem do repositório e volta na próxima recarga — para tirá-lo da busca de vez, desligue.`
        : `Excluir "${doc.title}"? Os trechos indexados saem da busca e não dá para desfazer.`;
    if (!window.confirm(warn)) return;
    void run(doc, async () => {
      await adminFetch<unknown>(`/api/admin/kb/documents/${encodeURIComponent(doc.id)}`, { method: 'DELETE' });
      docs.mutate((d) => ({ ...d, documents: d.documents.filter((x) => x.id !== doc.id) }));
      if (editingId === doc.id) setEditingId(null);
      stats.reload();
      setFlash({ tone: 'ok', text: `"${doc.title}" excluído.` });
    });
  };

  async function seed() {
    setSeeding(true);
    try {
      const res = await adminFetch<unknown>('/api/admin/kb/seed', { method: 'POST' });
      setFlash({ tone: 'ok', text: summarizeSeedResult(res) });
      docs.reload();
      stats.reload();
    } catch (err) {
      setFlash({ tone: 'error', text: errorText(err) });
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <KbOverview stats={stats.data} error={stats.status === 'error' ? stats.error : null} onRetry={stats.reload} />

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => void seed()}
          disabled={seeding}
          aria-busy={seeding || undefined}
          title="Reindexa os documentos de docs/kb que mudaram desde a última carga"
          className={cn('min-w-[200px]', TOUCH_TEXT)}
        >
          <NsIcon name={seeding ? 'loader' : 'refresh'} className={seeding ? 'motion-safe:animate-spin' : undefined} />
          {seeding ? 'Recarregando…' : 'Recarregar do repositório'}
        </Button>
        <Button
          onClick={() => setUploadOpen((o) => !o)}
          aria-expanded={uploadOpen}
          className={TOUCH_TEXT}
        >
          <NsIcon name={uploadOpen ? 'x' : 'plus'} /> {uploadOpen ? 'Fechar envio' : 'Enviar documento'}
        </Button>
      </div>

      {uploadOpen && (
        <UploadForm
          onCancel={() => setUploadOpen(false)}
          onUploaded={(doc) => {
            upsertDoc(doc);
            stats.reload();
            setUploadOpen(false);
            setFlash({
              tone: 'ok',
              text:
                doc.status === 'READY'
                  ? `"${doc.title}" indexado: ${plural(doc.chunks, 'trecho', 'trechos')}.`
                  : `"${doc.title}" enviado. A indexação continua no servidor — a lista acompanha.`,
            });
          }}
        />
      )}

      <FlashMessage flash={flash} onDismiss={() => setFlash(null)} />

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={searchId} className="sr-only">
            Filtrar documentos
          </label>
          <div className="relative">
            <NsIcon name="search" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              id={searchId}
              type="search"
              placeholder="Filtrar por título, arquivo ou descrição"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={cn(FIELD, 'h-9 pl-8', TOUCH_TEXT)}
            />
          </div>
        </div>
        <label htmlFor={kindId} className="sr-only">
          Tipo
        </label>
        <NativeSelect id={kindId} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="all">Todos os tipos</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {kindLabel(k)}
            </option>
          ))}
        </NativeSelect>
        <label htmlFor={statusId} className="sr-only">
          Status
        </label>
        <NativeSelect id={statusId} value={status} onChange={(e) => setStatus(e.target.value as 'all' | KbDocStatus)}>
          {STATUS_FILTERS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </NativeSelect>
      </div>

      <ListStates
        status={docs.status}
        error={docs.error}
        empty={visible.length === 0}
        emptyTitle={all.length === 0 ? 'Nenhum documento na base.' : 'Nenhum documento neste filtro.'}
        emptyBody={
          all.length === 0
            ? 'Use "Recarregar do repositório" para indexar docs/kb ou "Enviar documento" para subir um arquivo.'
            : undefined
        }
        onRetry={docs.reload}
      />

      {visible.length > 0 && (
        <div className="nx-glass-card rounded-lg">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <caption className="sr-only">Documentos da base global</caption>
              <thead>
                <tr className="border-b border-border text-xs font-medium text-muted-foreground">
                  <th scope="col" className="px-3 py-2.5 text-left font-medium">Documento</th>
                  <th scope="col" className="px-3 py-2.5 text-left font-medium">Tipo</th>
                  <th scope="col" className="px-3 py-2.5 text-left font-medium">Status</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Trechos</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Versão</th>
                  <th scope="col" className="px-3 py-2.5 text-left font-medium">Atualizado</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium" title="Vezes que a busca devolveu o documento">
                    Consultas
                  </th>
                  <th scope="col" className="px-1 py-2.5 text-center font-medium">Ativo</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((doc) => (
                  <React.Fragment key={doc.id}>
                    <DocRow
                      doc={doc}
                      busy={busyId === doc.id}
                      editing={editingId === doc.id}
                      onToggleEnabled={() => void toggleEnabled(doc)}
                      onEdit={() => setEditingId((id) => (id === doc.id ? null : doc.id))}
                      onReindex={() => void reindex(doc)}
                      onDelete={() => remove(doc)}
                    />
                    {editingId === doc.id && (
                      <tr className="border-b border-border bg-background/40">
                        <td colSpan={9} className="px-3 py-3">
                          <DocEditForm
                            doc={doc}
                            onCancel={() => setEditingId(null)}
                            onSaved={(saved) => {
                              if (saved) upsertDoc(saved);
                              else docs.reload();
                              setEditingId(null);
                              setFlash({ tone: 'ok', text: `"${saved?.title ?? doc.title}" atualizado.` });
                            }}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {pager}
        </div>
      )}
    </div>
  );
}

function KbOverview({ stats, error, onRetry }: { stats: KbStats | null; error: string | null; onRetry: () => void }) {
  if (!stats) {
    return error ? (
      <ReadState kind="parcial" title="Resumo da base indisponível" action="Tentar de novo" onAction={onRetry}>
        {error}
      </ReadState>
    ) : null;
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border bg-card px-3 py-2.5 text-xs leading-[18px] text-muted-foreground">
        <span>
          <span className="font-mono tabular-nums text-foreground">{fmtInt(stats.documents)}</span> documentos ·{' '}
          <span className="font-mono tabular-nums text-foreground">{fmtInt(stats.chunks)}</span> trechos
        </span>
        <span>Última recarga do repositório: {stats.lastSeedAt ? fmtDateTime(stats.lastSeedAt) : 'nunca'}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          <ToneBadge tone="success" icon="check">Busca textual</ToneBadge>
          <ToneBadge tone={stats.trigram ? 'success' : 'warning'} icon={stats.trigram ? 'check' : 'alert-triangle'}>
            Nomes parecidos {stats.trigram ? 'ligado' : 'desligado'}
          </ToneBadge>
          <ToneBadge tone={stats.dense ? 'success' : 'neutral'} icon={stats.dense ? 'check' : 'minus'}>
            Semântica {stats.dense ? 'ligada' : 'desligada'}
          </ToneBadge>
        </span>
      </div>
      {!stats.trigram && (
        <ReadState kind="parcial" title="Busca parcial">
          A extensão pg_trgm não está instalada no banco: nomes com erro de digitação e rótulos parecidos não são achados.
          A busca textual segue normal.
        </ReadState>
      )}
    </div>
  );
}

function DocRow({
  doc,
  busy,
  editing,
  onToggleEnabled,
  onEdit,
  onReindex,
  onDelete,
}: {
  doc: KbDocumentDTO;
  busy: boolean;
  editing: boolean;
  onToggleEnabled: () => void;
  onEdit: () => void;
  onReindex: () => void;
  onDelete: () => void;
}) {
  const st = DOC_STATUS[doc.status] ?? { label: doc.status, tone: 'neutral' as const };
  const inFlight = isDocInFlight(doc.status);
  const managed = docManagedElsewhere(doc.sourceType);
  const origin = [SOURCE_TYPE_LABEL[doc.sourceType] ?? doc.sourceType, doc.fileName ?? doc.sourceRef]
    .filter(Boolean)
    .join(' · ');
  return (
    <tr className={cn('border-b border-border align-top transition-colors hover:bg-accent', editing && 'bg-accent')}>
      <td className="max-w-[280px] px-3 py-2.5">
        <div className="truncate font-medium text-foreground" title={doc.title}>
          {doc.title}
        </div>
        <div className="truncate text-xs leading-[18px] text-muted-foreground" title={origin}>
          {origin}
        </div>
        {doc.description && (
          <div className="line-clamp-2 text-xs leading-[18px] text-muted-foreground">{doc.description}</div>
        )}
        {doc.effectiveDate && (
          <div className="text-xs leading-[18px] text-muted-foreground">Vigência: {fmtDay(doc.effectiveDate)}</div>
        )}
        {doc.status === 'FAILED' && doc.error && (
          <div className="mt-1 break-words text-xs leading-[18px] text-danger">{doc.error}</div>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{kindLabel(doc.kind)}</td>
      <td className="px-3 py-2.5">
        <ToneBadge tone={st.tone} icon={inFlight ? 'loader' : undefined} spin={inFlight}>
          {st.label}
        </ToneBadge>
      </td>
      <td className="px-3 py-2.5 text-right font-mono tabular-nums">{fmtInt(doc.chunks)}</td>
      <td className="px-3 py-2.5 text-right font-mono tabular-nums">v{fmtInt(doc.version)}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{fmtDateTime(doc.updatedAt)}</td>
      <td className="px-3 py-2.5 text-right font-mono tabular-nums">{fmtInt(doc.hitCount)}</td>
      <td className="px-1 py-1 text-center">
        <Switch checked={doc.enabled} onCheckedChange={onToggleEnabled} label={`"${doc.title}" na busca`} busy={busy} />
      </td>
      <td className="px-2 py-1">
        <div className="flex justify-end gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={onEdit}
            disabled={busy}
            aria-expanded={editing}
            aria-label={`Editar "${doc.title}"`}
            title="Editar título, descrição, tipo e vigência"
            className={cn('text-muted-foreground hover:text-foreground', TOUCH_ICON)}
          >
            <NsIcon name="edit" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onReindex}
            disabled={busy || inFlight}
            aria-label={`Reindexar "${doc.title}"`}
            title={inFlight ? 'Indexação em andamento' : 'Reindexar'}
            className={cn('text-muted-foreground hover:text-foreground', TOUCH_ICON)}
          >
            <NsIcon name="refresh" />
          </Button>
          {managed ? (
            // Espelho de entrada fixa/memória: excluir aqui dessincroniza — o
            // botão explica onde gerir em vez de sumir sem motivo.
            <Button
              variant="ghost"
              size="icon"
              disabled
              aria-label={`"${doc.title}" é gerido na aba ${managed === 'fixas' ? 'Fixas' : 'Memórias sugeridas'}`}
              title={`Gerido na aba ${managed === 'fixas' ? 'Fixas' : 'Memórias sugeridas'}`}
              className={cn('text-muted-foreground', TOUCH_ICON)}
            >
              <NsIcon name="trash" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              onClick={onDelete}
              disabled={busy}
              aria-label={`Excluir "${doc.title}"`}
              title="Excluir"
              className={cn('text-destructive hover:bg-destructive/10 hover:text-destructive', TOUCH_ICON)}
            >
              <NsIcon name="trash" />
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

function DocEditForm({
  doc,
  onCancel,
  onSaved,
}: {
  doc: KbDocumentDTO;
  onCancel: () => void;
  onSaved: (doc: KbDocumentDTO | null) => void;
}) {
  const [title, setTitle] = React.useState(doc.title);
  const [description, setDescription] = React.useState(doc.description ?? '');
  const [kind, setKind] = React.useState(doc.kind);
  const [effectiveDate, setEffectiveDate] = React.useState(isoToDateInput(doc.effectiveDate));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const ids = { title: React.useId(), description: React.useId(), kind: React.useId(), date: React.useId(), error: React.useId() };
  const kindEditable = isUploadKind(doc.kind);
  const titleInvalid = error != null && !title.trim();
  const dateMissing = kind === 'snapshot' && !effectiveDate;

  async function save() {
    if (!title.trim()) {
      setError('O título é obrigatório.');
      return;
    }
    if (dateMissing) {
      setError('Retrato datado precisa da data de vigência.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await adminFetch<{ document?: KbDocumentDTO }>(`/api/admin/kb/documents/${encodeURIComponent(doc.id)}`, {
        method: 'PATCH',
        json: {
          title: title.trim(),
          description: description.trim() || null,
          ...(kindEditable ? { kind } : {}),
          effectiveDate: effectiveDate || null,
        },
      });
      onSaved(res?.document ?? null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      noValidate
      aria-label={`Editar "${doc.title}"`}
    >
      {error && (
        <div className="sm:col-span-2">
          <ReadState kind="falha" id={ids.error}>
            {error}
          </ReadState>
        </div>
      )}
      <Field label="Título" htmlFor={ids.title}>
        <Input
          id={ids.title}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={titleInvalid || undefined}
          aria-describedby={titleInvalid ? ids.error : undefined}
          className={cn(FIELD, 'h-9', TOUCH_TEXT)}
        />
      </Field>
      <Field
        label="Tipo"
        htmlFor={ids.kind}
        hint={kindEditable ? UPLOAD_KINDS.find((k) => k.id === kind)?.hint : 'Definido pela origem do documento'}
      >
        <NativeSelect id={ids.kind} value={kind} onChange={(e) => setKind(e.target.value)} disabled={!kindEditable}>
          {kindEditable ? (
            UPLOAD_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))
          ) : (
            <option value={doc.kind}>{kindLabel(doc.kind)}</option>
          )}
        </NativeSelect>
      </Field>
      <Field
        label="Descrição"
        htmlFor={ids.description}
        hint="Uma linha. Vai para o índice da base que a IA vê no prompt."
        className="sm:col-span-2"
      >
        <Input
          id={ids.description}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Ex.: Como a coorte de reembolso censura meses imaturos"
          className={cn(FIELD, 'h-9', TOUCH_TEXT)}
        />
      </Field>
      <Field
        label="Vigência"
        htmlFor={ids.date}
        hint="Data em que os fatos do documento valem. Retrato datado perde peso na busca conforme envelhece."
      >
        <Input
          id={ids.date}
          type="date"
          value={effectiveDate}
          onChange={(e) => setEffectiveDate(e.target.value)}
          aria-invalid={(error != null && dateMissing) || undefined}
          aria-describedby={error != null && dateMissing ? ids.error : undefined}
          className={cn(FIELD, 'h-9', TOUCH_TEXT)}
        />
      </Field>
      <div className="flex items-end justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving} className={TOUCH_TEXT}>
          Cancelar
        </Button>
        <Button type="submit" disabled={saving} aria-busy={saving || undefined} className={cn('min-w-[112px]', TOUCH_TEXT)}>
          <NsIcon name={saving ? 'loader' : 'save'} className={saving ? 'motion-safe:animate-spin' : undefined} />
          {saving ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </form>
  );
}

function UploadForm({
  onCancel,
  onUploaded,
}: {
  onCancel: () => void;
  onUploaded: (doc: KbDocumentDTO) => void;
}) {
  const [file, setFile] = React.useState<File | null>(null);
  const [title, setTitle] = React.useState('');
  const [kind, setKind] = React.useState<string>('reference');
  const [description, setDescription] = React.useState('');
  const [effectiveDate, setEffectiveDate] = React.useState('');
  const [progress, setProgress] = React.useState<number | null>(null);
  const [error, setError] = React.useState<{ field: 'file' | 'date' | null; text: string } | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);
  const ids = {
    file: React.useId(),
    title: React.useId(),
    kind: React.useId(),
    description: React.useId(),
    date: React.useId(),
    error: React.useId(),
  };
  const uploading = progress != null;

  React.useEffect(() => () => abortRef.current?.abort(), []);

  function pick(f: File | null) {
    setFile(f);
    setError(null);
    if (f && !title.trim()) setTitle(titleFromFileName(f.name));
  }

  async function submit() {
    if (!file) {
      setError({ field: 'file', text: 'Escolha um arquivo.' });
      return;
    }
    if (file.size > KB_UPLOAD_MAX_BYTES) {
      setError({ field: 'file', text: `Arquivo de ${fmtBytes(file.size)}: o limite é ${fmtBytes(KB_UPLOAD_MAX_BYTES)}.` });
      return;
    }
    if (kind === 'snapshot' && !effectiveDate) {
      setError({ field: 'date', text: 'Retrato datado precisa da data de vigência.' });
      return;
    }
    const form = new FormData();
    form.append('file', file);
    if (title.trim()) form.append('title', title.trim());
    form.append('kind', kind);
    if (description.trim()) form.append('description', description.trim());
    if (effectiveDate) form.append('effectiveDate', effectiveDate);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError(null);
    setProgress(0);
    try {
      const res = await uploadWithProgress<{ document: KbDocumentDTO }>('/api/admin/kb/documents', form, setProgress, ctrl.signal);
      onUploaded(res.document);
    } catch (err) {
      if (!isAbortError(err)) setError({ field: null, text: errorText(err) });
    } finally {
      abortRef.current = null;
      setProgress(null);
    }
  }

  const kindHint = UPLOAD_KINDS.find((k) => k.id === kind)?.hint;

  return (
    <form
      className="nx-glass-card grid grid-cols-1 gap-3 rounded-lg p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      noValidate
      aria-label="Enviar documento para a base"
    >
      <div
        className={cn(
          'flex flex-col gap-1.5 rounded-md border border-dashed p-3 sm:col-span-2',
          dragOver ? 'border-ring bg-accent' : 'border-input',
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) pick(f);
        }}
      >
        <label htmlFor={ids.file} className="text-xs font-medium text-muted-foreground">
          Arquivo (arraste aqui ou escolha)
        </label>
        <input
          id={ids.file}
          type="file"
          accept={KB_UPLOAD_ACCEPT}
          disabled={uploading}
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
          aria-invalid={error?.field === 'file' || undefined}
          aria-describedby={error?.field === 'file' ? ids.error : undefined}
          className={cn(
            'text-sm text-foreground file:mr-3 file:h-9 file:cursor-pointer file:rounded-md file:border file:border-input file:bg-card file:px-3 file:text-sm file:font-medium file:text-foreground hover:file:bg-accent',
            'rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        />
        <p className="text-xs leading-[18px] text-muted-foreground">
          {file
            ? `${file.name} · ${fmtBytes(file.size)}`
            : `Markdown, texto, PDF, Word, planilha ou CSV — até ${fmtBytes(KB_UPLOAD_MAX_BYTES)}.`}
        </p>
      </div>

      <Field label="Título" htmlFor={ids.title} hint="Vazio = nome do arquivo.">
        <Input id={ids.title} value={title} onChange={(e) => setTitle(e.target.value)} disabled={uploading} className={cn(FIELD, 'h-9', TOUCH_TEXT)} />
      </Field>
      <Field label="Tipo" htmlFor={ids.kind} hint={kindHint}>
        <NativeSelect id={ids.kind} value={kind} onChange={(e) => setKind(e.target.value)} disabled={uploading}>
          {UPLOAD_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field
        label="Descrição"
        htmlFor={ids.description}
        hint="Uma linha. Vai para o índice da base que a IA vê no prompt."
        className="sm:col-span-2"
      >
        <Input
          id={ids.description}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={uploading}
          placeholder="Ex.: Regras de payout da Digistore24 por tipo de afiliado"
          className={cn(FIELD, 'h-9', TOUCH_TEXT)}
        />
      </Field>
      <Field
        label={kind === 'snapshot' ? 'Vigência (obrigatória)' : 'Vigência (opcional)'}
        htmlFor={ids.date}
        hint="Data em que os fatos do documento valem."
      >
        <Input
          id={ids.date}
          type="date"
          value={effectiveDate}
          onChange={(e) => setEffectiveDate(e.target.value)}
          disabled={uploading}
          aria-invalid={error?.field === 'date' || undefined}
          aria-describedby={error?.field === 'date' ? ids.error : undefined}
          className={cn(FIELD, 'h-9', TOUCH_TEXT)}
        />
      </Field>

      <div className="flex flex-col justify-end gap-2">
        {uploading && (
          <div role="status" className="flex flex-col gap-1">
            <span className="text-xs leading-[18px] text-muted-foreground">
              {progress < 1 ? `Enviando… ${fmtFraction(progress)}` : 'Extraindo e indexando no servidor…'}
            </span>
            <div className="h-1.5 overflow-hidden rounded-full border border-border bg-background">
              <div className="h-full bg-primary" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => (uploading ? abortRef.current?.abort() : onCancel())}
            className={TOUCH_TEXT}
          >
            {uploading ? 'Cancelar envio' : 'Cancelar'}
          </Button>
          <Button type="submit" disabled={uploading} aria-busy={uploading || undefined} className={cn('min-w-[112px]', TOUCH_TEXT)}>
            {/* O desenho "download" do set é a seta saindo da bandeja (a do
                "Exportar CSV") — serve de envio sem girar. */}
            <NsIcon name={uploading ? 'loader' : 'download'} className={uploading ? 'motion-safe:animate-spin' : undefined} />
            {uploading ? 'Enviando…' : 'Enviar'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="sm:col-span-2">
          <ReadState kind="falha" id={ids.error}>
            {error.text}
          </ReadState>
        </div>
      )}
    </form>
  );
}
