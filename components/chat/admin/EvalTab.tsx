// Aba "Avaliação" — roda o conjunto de casos-ouro contra o motor real do
// chat (mesmo código do /api/chat) e mostra a taxa de aprovação por
// execução. Serve pra A/B de modelo e esforço (Opus 5 × Opus 5.5 × Sonnet 5;
// medium × high × xhigh) com número em vez de impressão. O servidor roda
// uma execução por vez, em segundo plano; a lista se acompanha a cada 5 s
// enquanto houver execução rodando e a aba estiver visível.

'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/ui-utils';
import { NsIcon } from '../NsIcon';
import { AdminApiError, adminFetch, errorText } from './adminApi';
import {
  EVAL_EFFORTS,
  EVAL_MAX_REPS,
  EVAL_MODELS,
  durationMs,
  evalConfig,
  evalConfigText,
  evalRunStatus,
  evalSummaryView,
  fmtDateTime,
  fmtFraction,
  fmtMs,
  fmtUsd,
  parseCaseList,
  type EvalRunDTO,
} from './adminCore';
import { EvalRunDetail } from './EvalRunDetail';
import {
  FIELD,
  Field,
  FlashMessage,
  ListStates,
  NativeSelect,
  Panel,
  TOUCH_TEXT,
  ToneBadge,
  useAdminResource,
  useFlash,
  usePaged,
} from './ui';

const runKey = (r: EvalRunDTO) => r.id;
const anyRunning = (d: { runs: EvalRunDTO[] }) => d.runs.some((r) => r.status === 'running');

export function EvalTab({ active }: { active: boolean }) {
  const runs = useAdminResource<{ runs: EvalRunDTO[] }>('/api/admin/chat-eval', {
    active,
    pollMs: 5000,
    pollWhile: anyRunning,
  });
  const [selected, setSelected] = React.useState<string | null>(null);
  const [flash, setFlash] = useFlash();
  const list = React.useMemo(
    () => [...(runs.data?.runs ?? [])].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()),
    [runs.data],
  );
  const { pageItems, pager } = usePaged(list, { keyOf: runKey, label: 'execuções' });
  const running = list.some((r) => r.status === 'running');
  const lastDone = list.find((r) => r.status === 'done' && r.costUsd != null) ?? null;

  if (selected) {
    return (
      <EvalRunDetail
        runId={selected}
        active={active}
        onBack={() => {
          setSelected(null);
          runs.reload();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <RunForm
        running={running}
        lastDone={lastDone}
        onStarted={(runId) => {
          // Abre direto o detalhe da execução nova: ele acompanha o andamento.
          runs.reload();
          setSelected(runId);
        }}
        onError={(text) => setFlash({ tone: 'error', text })}
      />

      <FlashMessage flash={flash} onDismiss={() => setFlash(null)} />

      <Panel title="Execuções" description="Mais recentes primeiro">
        <div className="p-3 empty:hidden">
          <ListStates
            status={runs.status}
            error={runs.error}
            empty={list.length === 0}
            emptyTitle="Nenhuma avaliação rodada ainda."
            emptyBody='Escolha o modelo e o esforço acima e use "Rodar avaliação".'
            onRetry={runs.reload}
          />
        </div>
        {list.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm tabular-nums">
                <caption className="sr-only">Execuções da avaliação</caption>
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th scope="col" className="px-3 py-2.5 text-left font-medium">Início</th>
                    <th scope="col" className="px-3 py-2.5 text-left font-medium">Status</th>
                    <th scope="col" className="px-3 py-2.5 text-left font-medium">Configuração</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">Aprovação</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">Custo</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">Duração</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((r) => {
                    const st = evalRunStatus(r.status);
                    const isRunning = r.status === 'running';
                    const pass = evalSummaryView(r.summary).passRate;
                    return (
                      <tr key={r.id} className="border-b border-border last:border-0 hover:bg-accent">
                        <td className="h-11 whitespace-nowrap px-3 text-muted-foreground">{fmtDateTime(r.startedAt)}</td>
                        <td className="px-3">
                          <ToneBadge tone={st.tone} icon={isRunning ? 'loader' : undefined} spin={isRunning}>
                            {st.label}
                          </ToneBadge>
                        </td>
                        <td className="px-3 text-foreground">{evalConfigText(r.config)}</td>
                        <td className="px-3 text-right font-mono">
                          {fmtFraction(pass?.rate)}
                          {pass?.ci && (
                            <div className="text-xs text-muted-foreground">
                              IC {fmtFraction(pass.ci[0])}–{fmtFraction(pass.ci[1])}
                            </div>
                          )}
                        </td>
                        <td className="px-3 text-right font-mono text-[color:var(--money)]">{fmtUsd(r.costUsd)}</td>
                        <td className="px-3 text-right font-mono">
                          {isRunning ? 'rodando' : fmtMs(durationMs(r.startedAt, r.finishedAt))}
                        </td>
                        <td className="px-2 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelected(r.id)}
                            aria-label={`Ver detalhes da execução de ${fmtDateTime(r.startedAt)}`}
                            className={TOUCH_TEXT}
                          >
                            Detalhes <NsIcon name="chevron-right" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {pager}
          </>
        )}
      </Panel>
    </div>
  );
}

function RunForm({
  running,
  lastDone,
  onStarted,
  onError,
}: {
  running: boolean;
  lastDone: EvalRunDTO | null;
  onStarted: (runId: string) => void;
  onError: (text: string) => void;
}) {
  const [model, setModel] = React.useState<string>(EVAL_MODELS[0].id);
  const [effort, setEffort] = React.useState<string>('high');
  const [reps, setReps] = React.useState('1');
  const [cases, setCases] = React.useState('');
  const [starting, setStarting] = React.useState(false);
  const [repsError, setRepsError] = React.useState<string | null>(null);
  const ids = { model: React.useId(), effort: React.useId(), reps: React.useId(), cases: React.useId(), repsError: React.useId() };

  // Estimativa pelo custo da última execução concluída, por repetição:
  // mesma ordem de grandeza se o conjunto de casos for o mesmo — daí o "≈".
  const estimate = React.useMemo(() => {
    if (!lastDone || lastDone.costUsd == null) return null;
    const lastReps = evalConfig(lastDone.config).reps ?? 1;
    const n = Number(reps);
    if (!Number.isInteger(n) || n < 1 || lastReps < 1) return null;
    return (lastDone.costUsd / lastReps) * n;
  }, [lastDone, reps]);

  async function start() {
    const n = Number(reps);
    if (!Number.isInteger(n) || n < 1 || n > EVAL_MAX_REPS) {
      setRepsError(`Use um número inteiro de 1 a ${EVAL_MAX_REPS}.`);
      return;
    }
    setRepsError(null);
    setStarting(true);
    try {
      const list = parseCaseList(cases);
      const res = await adminFetch<{ runId: string }>('/api/admin/chat-eval', {
        method: 'POST',
        json: { model, effort, reps: n, ...(list.length ? { cases: list } : {}) },
      });
      onStarted(res.runId);
    } catch (err) {
      onError(
        err instanceof AdminApiError && err.status === 409
          ? 'Já existe uma avaliação rodando. Espere ela terminar para iniciar outra.'
          : errorText(err),
      );
    } finally {
      setStarting(false);
    }
  }

  return (
    <Panel
      title="Rodar avaliação"
      description="Cada caso é uma conversa real com o motor do chat: consome tokens e consulta o banco de produção"
    >
      <form
        className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
        noValidate
      >
        <Field label="Modelo" htmlFor={ids.model}>
          <NativeSelect id={ids.model} value={model} onChange={(e) => setModel(e.target.value)}>
            {EVAL_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Esforço" htmlFor={ids.effort}>
          <NativeSelect id={ids.effort} value={effort} onChange={(e) => setEffort(e.target.value)}>
            {EVAL_EFFORTS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          label="Repetições"
          htmlFor={ids.reps}
          hint="3 repetições para comparar configurações (1 tem ruído de ±10 pp)"
          error={repsError}
          errorId={ids.repsError}
        >
          <Input
            id={ids.reps}
            type="number"
            inputMode="numeric"
            min={1}
            max={EVAL_MAX_REPS}
            step={1}
            value={reps}
            onChange={(e) => setReps(e.target.value)}
            aria-invalid={repsError != null || undefined}
            aria-describedby={repsError ? ids.repsError : undefined}
            className={cn(FIELD, 'h-9 font-mono tabular-nums', TOUCH_TEXT)}
          />
        </Field>
        <Field label="Casos (opcional)" htmlFor={ids.cases} hint="Vazio = todos os casos ativos">
          <Input
            id={ids.cases}
            value={cases}
            onChange={(e) => setCases(e.target.value)}
            placeholder="Ex.: G01, G13"
            className={cn(FIELD, 'h-9', TOUCH_TEXT)}
          />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2 lg:col-span-4">
          <p className="text-xs leading-[18px] text-muted-foreground">
            {running
              ? 'Uma avaliação está rodando — o servidor aceita uma por vez.'
              : estimate != null
                ? `Custo estimado ≈ ${fmtUsd(estimate)} (pela última execução concluída, ${evalConfigText(lastDone?.config)}).`
                : 'Sem execução anterior para estimar o custo.'}
          </p>
          <Button
            type="submit"
            disabled={starting || running}
            aria-busy={starting || undefined}
            className={cn('min-w-[160px]', TOUCH_TEXT)}
          >
            <NsIcon name={starting ? 'loader' : 'target'} className={starting ? 'motion-safe:animate-spin' : undefined} />
            {starting ? 'Iniciando…' : 'Rodar avaliação'}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
