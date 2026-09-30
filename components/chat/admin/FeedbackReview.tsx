// Revisão de feedback (parte da aba Qualidade): respostas avaliadas pelos
// usuários que consentiram compartilhar. Cada item traz a pergunta, a
// resposta como o usuário viu, os motivos/comentário/"o certo era" e o
// trace do turno (tools, bytes, erros, truncamentos) — o bastante pra saber
// se o erro foi de dado, de filtro ou do modelo. O admin tria (status) e
// anota; item triado sai da fila filtrada sem jogar a página pro começo.

'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/ui-utils';
import { NsIcon } from '../NsIcon';
import { adminFetch, errorText } from './adminApi';
import {
  FEEDBACK_STATUSES,
  feedbackAnswer,
  feedbackStatus,
  fmtBytes,
  fmtDateTime,
  fmtInt,
  fmtMs,
  fmtUsd,
  reasonLabel,
  summarizeTrace,
  type FeedbackItem,
  type TraceSummary,
} from './adminCore';
import { ReadOnlyAnswer } from './ReadOnlyAnswer';
import {
  FIELD,
  FlashMessage,
  ListStates,
  NativeSelect,
  Panel,
  Segmented,
  TOUCH_TEXT,
  ToneBadge,
  useAdminResource,
  useFlash,
  usePaged,
} from './ui';

type RatingFilter = '-1' | '1' | 'all';
const RATING_OPTIONS: ReadonlyArray<{ id: RatingFilter; label: string }> = [
  { id: '-1', label: 'Negativas' },
  { id: '1', label: 'Positivas' },
  { id: 'all', label: 'Todas' },
];

const feedbackKey = (f: FeedbackItem) => f.id;

function feedbackUrl(rating: RatingFilter, status: string): string {
  const q = new URLSearchParams();
  // 'all' vai explícito: sem o parâmetro a rota aplica o default (👎 em aberto).
  q.set('rating', rating);
  q.set('status', status);
  const qs = q.toString();
  return `/api/admin/chat-quality/feedback${qs ? `?${qs}` : ''}`;
}

export function FeedbackReview({ active }: { active: boolean }) {
  const [rating, setRating] = React.useState<RatingFilter>('-1');
  const [status, setStatus] = React.useState('open');
  const res = useAdminResource<{ items: FeedbackItem[] }>(feedbackUrl(rating, status), { active });
  const [flash, setFlash] = useFlash();
  const statusId = React.useId();
  const items = React.useMemo(() => res.data?.items ?? [], [res.data]);
  const { pageItems, pager } = usePaged(items, {
    keyOf: feedbackKey,
    label: 'avaliações',
    resetKey: `${rating}|${status}`,
  });

  function onSaved(updated: FeedbackItem) {
    res.mutate((d) => ({
      ...d,
      items:
        status !== 'all' && updated.status !== status
          ? d.items.filter((x) => x.id !== updated.id)
          : d.items.map((x) => (x.id === updated.id ? updated : x)),
    }));
    setFlash({ tone: 'ok', text: `Avaliação marcada como "${feedbackStatus(updated.status).label}".` });
  }

  return (
    <Panel
      title="Respostas avaliadas"
      description="Só as que o usuário aceitou compartilhar com o administrador"
      actions={
        <>
          <Segmented label="Avaliação" value={rating} options={RATING_OPTIONS} onChange={setRating} />
          <label htmlFor={statusId} className="sr-only">
            Status da triagem
          </label>
          <NativeSelect id={statusId} value={status} onChange={(e) => setStatus(e.target.value)}>
            {FEEDBACK_STATUSES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
            <option value="all">Todos os status</option>
          </NativeSelect>
        </>
      }
    >
      <div className="flex flex-col gap-2 p-3">
        <FlashMessage flash={flash} onDismiss={() => setFlash(null)} />
        <ListStates
          status={res.status}
          error={res.error}
          empty={items.length === 0}
          emptyTitle="Nenhuma avaliação neste filtro."
          emptyBody={rating === '-1' && status === 'open' ? 'Nenhuma resposta ruim esperando triagem.' : undefined}
          onRetry={res.reload}
        />
        {items.length > 0 && (
          <ul className="flex flex-col gap-2">
            {pageItems.map((item) => (
              <FeedbackCard key={item.id} item={item} onSaved={onSaved} onError={(text) => setFlash({ tone: 'error', text })} />
            ))}
          </ul>
        )}
      </div>
      {pager}
    </Panel>
  );
}

function FeedbackCard({
  item,
  onSaved,
  onError,
}: {
  item: FeedbackItem;
  onSaved: (item: FeedbackItem) => void;
  onError: (text: string) => void;
}) {
  const [status, setStatus] = React.useState(item.status);
  const [note, setNote] = React.useState(item.adminNote ?? '');
  const [saving, setSaving] = React.useState(false);
  const [showAnswer, setShowAnswer] = React.useState(false);
  const [showTrace, setShowTrace] = React.useState(false);
  const ids = { status: React.useId(), note: React.useId(), answer: React.useId(), trace: React.useId() };
  const trace = React.useMemo(() => summarizeTrace(item.trace), [item.trace]);
  const context = item.questionContext?.trim() || null;
  const hasTrace = !!trace || !!context;
  const dirty = status !== item.status || note.trim() !== (item.adminNote ?? '').trim();
  const st = feedbackStatus(item.status);
  const negative = item.rating < 0;

  async function save() {
    setSaving(true);
    try {
      const body = { status, adminNote: note.trim() || null };
      const res = await adminFetch<{ item?: FeedbackItem; feedback?: Partial<FeedbackItem> }>(
        `/api/admin/chat-quality/feedback/${encodeURIComponent(item.id)}`,
        { method: 'PATCH', json: body },
      );
      // A rota devolve o registro salvo; o que ela não mandar vem do rascunho.
      const saved = res?.item ?? res?.feedback ?? {};
      onSaved({ ...item, ...body, ...saved, question: item.question, answer: item.answer, trace: item.trace });
    } catch (err) {
      onError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="rounded-lg border border-border bg-background/40 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <NsIcon
          name={negative ? 'thumbs-down' : 'thumbs-up'}
          className={negative ? 'text-danger' : 'text-success'}
          label={negative ? 'Avaliação negativa' : 'Avaliação positiva'}
        />
        <span className="text-xs text-muted-foreground">{fmtDateTime(item.createdAt)}</span>
        <ToneBadge tone={st.tone}>{st.label}</ToneBadge>
        {(item.reasons ?? []).map((r) => (
          <ToneBadge key={r} tone="neutral">
            {reasonLabel(r)}
          </ToneBadge>
        ))}
      </div>

      <div className="mt-2 flex flex-col gap-2">
        <div>
          <div className="text-xs font-medium text-muted-foreground">Pergunta</div>
          <p className="nx-bubble-user mt-1 whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm leading-[22px]">
            {item.question?.trim() || 'Pergunta indisponível (mensagem apagada).'}
          </p>
        </div>

        {(item.comment || item.expected) && (
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {item.comment && (
              <div className="rounded-md border border-border bg-card px-3 py-2">
                <dt className="text-xs font-medium text-muted-foreground">Comentário</dt>
                <dd className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-[22px] text-foreground">{item.comment}</dd>
              </div>
            )}
            {item.expected && (
              <div className="rounded-md border border-border bg-card px-3 py-2">
                <dt className="text-xs font-medium text-muted-foreground">O certo era</dt>
                <dd className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-[22px] text-foreground">{item.expected}</dd>
              </div>
            )}
          </dl>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAnswer((v) => !v)}
            aria-expanded={showAnswer}
            aria-controls={ids.answer}
            className={TOUCH_TEXT}
          >
            <NsIcon name={showAnswer ? 'chevron-down' : 'chevron-right'} /> {showAnswer ? 'Esconder resposta' : 'Ver resposta'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowTrace((v) => !v)}
            aria-expanded={showTrace}
            aria-controls={ids.trace}
            disabled={!hasTrace}
            title={hasTrace ? undefined : 'Turno sem telemetria registrada'}
            className={TOUCH_TEXT}
          >
            <NsIcon name={showTrace ? 'chevron-down' : 'chevron-right'} /> {showTrace ? 'Esconder trace' : 'Ver trace'}
          </Button>
          {trace && <TraceLine trace={trace} />}
        </div>

        {showAnswer && (
          <div id={ids.answer}>
            <ReadOnlyAnswer answer={feedbackAnswer(item)} />
          </div>
        )}
        {showTrace && hasTrace && (
          <div id={ids.trace} className="flex flex-col gap-2">
            {trace && <TraceDetail trace={trace} />}
            {context && (
              <div className="rounded-md border border-border bg-card p-3">
                <div className="text-xs font-medium text-muted-foreground">
                  Contexto do turno (data e filtros da tela que a IA recebeu)
                </div>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words font-[family-name:var(--f-code)] text-xs leading-[18px] text-foreground">
                  {context}
                </pre>
              </div>
            )}
          </div>
        )}

        <form
          className="grid grid-cols-1 gap-2 border-t border-border pt-2 sm:grid-cols-[200px_minmax(0,1fr)_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          aria-label="Triagem da avaliação"
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.status} className="text-xs font-medium text-muted-foreground">
              Status
            </label>
            <NativeSelect id={ids.status} value={status} onChange={(e) => setStatus(e.target.value)} disabled={saving}>
              {FEEDBACK_STATUSES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.note} className="text-xs font-medium text-muted-foreground">
              Nota do administrador
            </label>
            <Textarea
              id={ids.note}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={1}
              disabled={saving}
              placeholder="Ex.: filtro de família não aplicado; corrigido no normalizeScope"
              className={cn(FIELD, 'min-h-9 resize-y py-1.5')}
            />
          </div>
          <Button type="submit" disabled={!dirty || saving} aria-busy={saving || undefined} className={cn('min-w-[104px]', TOUCH_TEXT)}>
            <NsIcon name={saving ? 'loader' : 'save'} className={saving ? 'motion-safe:animate-spin' : undefined} />
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </form>
      </div>
    </li>
  );
}

function TraceLine({ trace }: { trace: TraceSummary }) {
  const parts = [
    trace.model,
    trace.rounds != null ? `${fmtInt(trace.rounds)} rodadas` : null,
    `${fmtInt(trace.tools.length)} tools`,
    trace.latencyMs != null ? fmtMs(trace.latencyMs) : null,
    trace.costUsd != null ? fmtUsd(trace.costUsd) : null,
  ].filter(Boolean);
  return <span className="self-center text-xs text-muted-foreground">{parts.join(' · ')}</span>;
}

function TraceDetail({ trace }: { trace: TraceSummary }) {
  const flags: Array<{ text: string; tone: 'warning' | 'danger' }> = [];
  if (trace.status && trace.status !== 'ok') flags.push({ text: `Status ${trace.status}`, tone: 'danger' });
  if (trace.forcedFinal) flags.push({ text: 'Fechamento forçado', tone: 'warning' });
  if ((trace.truncatedResults ?? 0) > 0) flags.push({ text: `${fmtInt(trace.truncatedResults)} resultados cortados`, tone: 'warning' });
  if ((trace.ungrounded ?? 0) > 0) flags.push({ text: `${fmtInt(trace.ungrounded)} números sem fonte`, tone: 'danger' });
  const stats: Array<[string, string]> = [
    ['Modelo', [trace.model, trace.effort].filter(Boolean).join(' · ') || '—'],
    ['Versão do prompt', trace.promptVersion ?? '—'],
    ['Rodadas', fmtInt(trace.rounds)],
    ['Tools (erros)', trace.toolCalls != null ? `${fmtInt(trace.toolCalls)} (${fmtInt(trace.toolErrors ?? 0)})` : '—'],
    ['Latência', fmtMs(trace.latencyMs)],
    ['Primeiro token', fmtMs(trace.ttftMs)],
    ['Custo', fmtUsd(trace.costUsd)],
    ['Tokens (entrada / saída / cache)', `${fmtInt(trace.inputTokens)} / ${fmtInt(trace.outputTokens)} / ${fmtInt(trace.cacheReadTokens)}`],
  ];
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {flags.map((f) => (
            <ToneBadge key={f.text} tone={f.tone} icon="alert-triangle">
              {f.text}
            </ToneBadge>
          ))}
        </div>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
        {stats.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="break-words font-mono tabular-nums text-foreground">{v}</dd>
          </div>
        ))}
      </dl>
      {trace.tools.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-xs tabular-nums">
            <caption className="sr-only">Tools chamadas no turno</caption>
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th scope="col" className="px-2 py-1.5 text-right font-medium">Rodada</th>
                <th scope="col" className="px-2 py-1.5 text-left font-medium">Tool</th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">Tempo</th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">Tamanho</th>
                <th scope="col" className="px-2 py-1.5 text-left font-medium">Ocorrência</th>
              </tr>
            </thead>
            <tbody>
              {trace.tools.map((t, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="px-2 py-1.5 text-right font-mono">{t.round != null ? fmtInt(t.round) : '—'}</td>
                  <td className="px-2 py-1.5 font-[family-name:var(--f-code)] text-foreground">{t.name}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{fmtMs(t.ms)}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{fmtBytes(t.bytes)}</td>
                  <td className={cn('px-2 py-1.5', t.error ? 'text-danger' : t.truncated ? 'text-warning' : 'text-muted-foreground')}>
                    {t.error ? `Erro: ${t.error}` : t.truncated ? 'Resultado cortado' : 'ok'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
