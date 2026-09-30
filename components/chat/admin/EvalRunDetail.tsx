// Detalhe de uma execução da avaliação: métricas do resumo (taxa com
// intervalo de Wilson 95%, lente trocada, unidade, falsa negativa,
// fidelidade aos dados, por categoria), e o resultado por caso e repetição
// com cada check do grader e a resposta do modelo. Taxa só sobre respostas
// avaliadas (passou/parcial/falhou): erro de API, corte, recusa e
// inconclusivo (dado ao vivo mudou no meio) ficam à parte — nunca como 0.
// Com ~30 casos × 3 repetições o intervalo tem ±10 pp: diferença menor
// entre duas execuções é ruído.

'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/ui-utils';
import { NsIcon } from '../NsIcon';
import {
  durationMs,
  evalConfigText,
  evalResultStatus,
  evalRunStatus,
  evalSummaryView,
  fmtDateTime,
  fmtFraction,
  fmtInt,
  fmtMs,
  fmtRateCi,
  fmtUsd,
  normalizeChecks,
  passRateFromResults,
  type EvalResultDTO,
  type EvalRunDTO,
  type EvalSummaryView,
} from './adminCore';
import { ReadOnlyAnswer } from './ReadOnlyAnswer';
import { Panel, ReadState, Segmented, TOUCH_TEXT, ToneBadge, useAdminResource, usePaged } from './ui';

type Filter = 'all' | 'problems';
const FILTER_OPTIONS: ReadonlyArray<{ id: Filter; label: string }> = [
  { id: 'all', label: 'Todos os casos' },
  { id: 'problems', label: 'Só problemas' },
];

interface Detail {
  run: EvalRunDTO;
  results: EvalResultDTO[];
}

const resultKey = (r: EvalResultDTO) => r.id;
const isRunning = (d: Detail) => d.run?.status === 'running';

function fmtScore(v: number | null): string {
  return v == null || !Number.isFinite(v) ? '—' : v.toFixed(2);
}

export function EvalRunDetail({ runId, active, onBack }: { runId: string; active: boolean; onBack: () => void }) {
  const res = useAdminResource<Detail>(`/api/admin/chat-eval/${encodeURIComponent(runId)}`, {
    active,
    pollMs: 5000,
    pollWhile: isRunning,
  });
  const [filter, setFilter] = React.useState<Filter>('all');
  const run = res.data?.run ?? null;
  const results = React.useMemo(
    () =>
      [...(res.data?.results ?? [])].sort(
        (a, b) => a.caseSlug.localeCompare(b.caseSlug, 'en', { numeric: true }) || a.rep - b.rep,
      ),
    [res.data],
  );
  const visible = React.useMemo(
    () => (filter === 'all' ? results : results.filter((r) => r.status !== 'pass')),
    [results, filter],
  );
  const { pageItems, pager } = usePaged(visible, { keyOf: resultKey, label: 'resultados', resetKey: filter });

  const fromResults = passRateFromResults(results);
  const summary = React.useMemo(() => evalSummaryView(run?.summary), [run?.summary]);
  // Execução rodando ainda não tem resumo: a taxa parcial vem dos resultados.
  const rate = summary.passRate?.rate ?? fromResults.rate;
  const passed = summary.passRate?.pass ?? fromResults.pass;
  const graded = summary.passRate?.n ?? fromResults.graded;
  const counts = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const r of results) m.set(r.status, (m.get(r.status) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [results]);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack} className={cn('-ml-2', TOUCH_TEXT)}>
          <NsIcon name="chevron-left" /> Voltar para as execuções
        </Button>
      </div>

      {res.status === 'loading' && <ReadState kind="carregando">Carregando a execução…</ReadState>}
      {res.status === 'error' && (
        <ReadState kind="falha" title="Não foi possível carregar a execução" action="Tentar de novo" onAction={res.reload}>
          {res.error}
        </ReadState>
      )}

      {run && (
        <>
          <section className="nx-glass-card rounded-lg p-4" aria-label="Resumo da execução">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-foreground">Execução de {fmtDateTime(run.startedAt)}</h3>
              <ToneBadge
                tone={evalRunStatus(run.status).tone}
                icon={run.status === 'running' ? 'loader' : undefined}
                spin={run.status === 'running'}
              >
                {evalRunStatus(run.status).label}
              </ToneBadge>
            </div>
            <p className="mt-1 text-xs leading-[18px] text-muted-foreground">{evalConfigText(run.config)}</p>
            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label="Aprovação"
                value={fmtFraction(rate)}
                hint={
                  summary.passRate?.ci
                    ? `${fmtInt(passed)} de ${fmtInt(graded)} · IC 95% ${fmtFraction(summary.passRate.ci[0])}–${fmtFraction(summary.passRate.ci[1])}`
                    : `${fmtInt(passed)} de ${fmtInt(graded)} avaliados`
                }
              />
              <Stat label="Custo" value={fmtUsd(run.costUsd)} money />
              <Stat
                label="Duração"
                value={run.status === 'running' ? 'rodando' : fmtMs(durationMs(run.startedAt, run.finishedAt))}
              />
              <Stat label="Resultados" value={fmtInt(results.length)} />
            </dl>
            {counts.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Resultados por status">
                {counts.map(([status, n]) => {
                  const st = evalResultStatus(status);
                  return (
                    <ToneBadge key={status} tone={st.tone}>
                      {st.label} <span className="font-mono tabular-nums">{fmtInt(n)}</span>
                    </ToneBadge>
                  );
                })}
              </div>
            )}
            <SummaryMetrics summary={summary} />
          </section>

          {summary.byCategory.length > 0 && <CategoryTable rows={summary.byCategory} />}

          <Panel
            title="Casos"
            actions={<Segmented label="Filtrar casos" value={filter} options={FILTER_OPTIONS} onChange={setFilter} />}
          >
            {visible.length === 0 ? (
              <div className="p-3">
                <ReadState
                  kind="vazio"
                  title={
                    results.length === 0
                      ? run.status === 'running'
                        ? 'Nenhum caso terminou ainda.'
                        : 'Execução sem resultados.'
                      : 'Nenhum problema nesta execução.'
                  }
                />
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {pageItems.map((r) => (
                  <ResultRow key={r.id} result={r} />
                ))}
              </ul>
            )}
            {pager}
          </Panel>
        </>
      )}
    </div>
  );
}

/** Métricas do grader que dizem ONDE a resposta erra (lente, unidade, negativa falsa…). */
function SummaryMetrics({ summary }: { summary: EvalSummaryView }) {
  const items: Array<[string, string, string]> = [
    ['Aceitáveis', fmtRateCi(summary.acceptableRate?.rate ?? null, summary.acceptableRate?.ci ?? null), 'Número certo, com algum defeito de forma'],
    ['Nota média', summary.meanScore != null ? summary.meanScore.toFixed(2) : '—', 'Média das notas dos casos avaliados'],
    ['Lente trocada', fmtFraction(summary.lensMismatchRate), 'Número de outra definição (ex.: bruto no lugar de líquido)'],
    ['Erro de unidade', fmtFraction(summary.unitFailRate), 'Fração mostrada como percentual e afins'],
    ['Falsa negativa', fmtFraction(summary.falseDenialRate), 'Disse não ter o dado quando tinha'],
    ['Fidelidade', fmtFraction(summary.faithfulness), 'Números da resposta achados nos resultados das tools'],
    ['Resposta direta', fmtFraction(summary.directness), 'Primeiro fato certo nos primeiros 300 caracteres'],
    ['Custo por acerto', fmtUsd(summary.costPerPass), 'Custo total ÷ casos que passaram'],
    ['Latência p50 / p95', `${fmtMs(summary.latencyP50)} / ${fmtMs(summary.latencyP95)}`, 'Por caso, sem erros de API'],
  ];
  const shown = items.filter(([, v]) => v !== '—' && v !== '— / —');
  if (!shown.length && !summary.flaky.length) return null;
  return (
    <div className="mt-3 border-t border-border pt-3">
      {shown.length > 0 && (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-3">
          {shown.map(([label, value, hint]) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs leading-[18px] text-muted-foreground" title={hint}>
                {label}
              </dt>
              <dd className="font-mono text-sm tabular-nums text-foreground">{value}</dd>
              <dd className="text-xs leading-[18px] text-muted-foreground">{hint}</dd>
            </div>
          ))}
        </dl>
      )}
      {summary.flaky.length > 0 && (
        <p className="mt-2 text-xs leading-[18px] text-warning">
          Instáveis (passam em algumas repetições e não em outras): {summary.flaky.join(', ')}
        </p>
      )}
    </div>
  );
}

function CategoryTable({ rows }: { rows: EvalSummaryView['byCategory'] }) {
  return (
    <Panel title="Por categoria" description="Taxa de aprovação sobre os casos avaliados de cada categoria">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-sm tabular-nums">
          <caption className="sr-only">Aprovação por categoria</caption>
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th scope="col" className="px-3 py-2.5 text-left font-medium">Categoria</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Avaliados</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Passou</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Parcial</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Falhou</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Aprovação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.category} className="border-b border-border last:border-0 hover:bg-accent">
                <td className="h-11 px-3 text-foreground">{r.category}</td>
                <td className="px-3 text-right font-mono">{fmtInt(r.n)}</td>
                <td className="px-3 text-right font-mono">{fmtInt(r.pass)}</td>
                <td className="px-3 text-right font-mono">{fmtInt(r.partial)}</td>
                <td className={cn('px-3 text-right font-mono', r.fail > 0 && 'text-danger')}>{fmtInt(r.fail)}</td>
                <td className="whitespace-nowrap px-3 text-right font-mono">{fmtRateCi(r.rate, r.ci)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Stat({ label, value, hint, money }: { label: string; value: string; hint?: string; money?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs leading-[18px] text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'break-words font-mono text-xl font-semibold leading-7 tabular-nums text-foreground',
          money && 'text-[color:var(--money)]',
        )}
      >
        {value}
      </dd>
      {hint && <dd className="text-xs leading-[18px] text-muted-foreground">{hint}</dd>}
    </div>
  );
}

function ResultRow({ result }: { result: EvalResultDTO }) {
  const [open, setOpen] = React.useState(false);
  const checks = React.useMemo(() => normalizeChecks(result.checks), [result.checks]);
  const failed = checks.filter((c) => c.pass === false).length;
  const st = evalResultStatus(result.status);
  const panelId = React.useId();
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          'flex min-h-11 w-full flex-wrap items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        )}
      >
        <NsIcon name={open ? 'chevron-down' : 'chevron-right'} className="shrink-0 text-muted-foreground" />
        <span className="font-[family-name:var(--f-code)] text-[13px] text-foreground">{result.caseSlug}</span>
        <span className="text-xs text-muted-foreground">repetição {fmtInt(result.rep + 1)}</span>
        <ToneBadge tone={st.tone}>{st.label}</ToneBadge>
        <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          {checks.length > 0 && (
            <span>
              <span className={cn('font-mono tabular-nums', failed > 0 ? 'text-danger' : 'text-foreground')}>
                {fmtInt(checks.length - failed)}/{fmtInt(checks.length)}
              </span>{' '}
              checks
            </span>
          )}
          <span>
            nota <span className="font-mono tabular-nums text-foreground">{fmtScore(result.score)}</span>
          </span>
          {result.latencyMs != null && <span className="font-mono tabular-nums">{fmtMs(result.latencyMs)}</span>}
        </span>
      </button>
      {open && (
        <div id={panelId} className="flex flex-col gap-3 px-3 pb-3 pl-9">
          {checks.length > 0 ? (
            <ul className="flex flex-col gap-1" aria-label="Checks do grader">
              {checks.map((c, i) => (
                <li key={`${c.name}:${i}`} className="flex items-start gap-2 text-xs leading-[18px]">
                  <NsIcon
                    name={c.pass === true ? 'check' : c.pass === false ? 'x' : 'minus'}
                    size={14}
                    className={cn(
                      'mt-0.5 shrink-0',
                      c.pass === true ? 'text-success' : c.pass === false ? 'text-danger' : 'text-muted-foreground',
                    )}
                    label={c.pass === true ? 'Passou' : c.pass === false ? 'Falhou' : 'Sem veredito'}
                  />
                  <span className="min-w-0">
                    <span className="font-[family-name:var(--f-code)] text-foreground">{c.name}</span>
                    {c.critical && <span className="text-muted-foreground"> (crítico)</span>}
                    {c.note && <span className="text-muted-foreground"> · {c.note}</span>}
                    {c.detail && <span className="text-muted-foreground"> — {c.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">Sem checks registrados.</p>
          )}
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">Resposta do modelo</div>
            <ReadOnlyAnswer answer={result.answer} />
          </div>
        </div>
      )}
    </li>
  );
}
