// Aba "Qualidade" — telemetria agregada dos turnos do chat (ChatTurnLog) e
// fila de respostas mal avaliadas. Os agregados não carregam texto de
// ninguém; a pergunta e a resposta só aparecem nos feedbacks em que o
// usuário consentiu compartilhar (shared=true — filtro do servidor).

'use client';

import * as React from 'react';
import { cn } from '@/lib/ui-utils';
import {
  fmtBytes,
  fmtDateTime,
  fmtFraction,
  fmtInt,
  fmtMs,
  fmtUsd,
  qualityCards,
  type QualitySummary,
} from './adminCore';
import { DailyChart } from './DailyChart';
import { FeedbackReview } from './FeedbackReview';
import { ListStates, Panel, ReadState, Segmented, useAdminResource, usePaged } from './ui';

type Days = '7' | '30';
const DAY_OPTIONS: ReadonlyArray<{ id: Days; label: string }> = [
  { id: '7', label: 'Últimos 7 dias' },
  { id: '30', label: 'Últimos 30 dias' },
];

type ToolRow = QualitySummary['byTool'][number];
const toolKey = (t: ToolRow) => t.name;
type VersionRow = NonNullable<QualitySummary['byPromptVersion']>[number];

export function QualityTab({ active }: { active: boolean }) {
  const [days, setDays] = React.useState<Days>('7');
  const summary = useAdminResource<QualitySummary>(`/api/admin/chat-quality/summary?days=${days}`, { active });
  const s = summary.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented label="Período" value={days} options={DAY_OPTIONS} onChange={setDays} />
        {summary.refreshing && <span className="text-xs text-muted-foreground" role="status">Atualizando…</span>}
      </div>

      <ListStates
        status={summary.status}
        error={summary.error}
        empty={!!s && s.turns === 0}
        emptyTitle="Nenhum turno registrado no período."
        emptyBody="Os indicadores aparecem depois das primeiras conversas com a telemetria ligada."
        onRetry={summary.reload}
      />

      {s && s.turns > 0 && (
        <>
          <section aria-label="Resumo do período">
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {qualityCards(s).map((c) => (
                <div key={c.key} className="min-w-0 rounded-lg border border-border bg-card p-3">
                  <dt className="text-xs leading-[18px] text-muted-foreground">{c.label}</dt>
                  <dd
                    className={cn(
                      'mt-1 break-words font-mono text-xl font-semibold leading-7 tabular-nums text-foreground',
                      c.money && 'text-[color:var(--money)]',
                    )}
                  >
                    {c.value}
                  </dd>
                  {c.hint && <dd className="mt-0.5 text-xs leading-[18px] text-muted-foreground">{c.hint}</dd>}
                </div>
              ))}
            </dl>
          </section>

          <DailyChart days={s.byDay ?? []} />
          <ToolsTable tools={s.byTool ?? []} />
          {s.byPromptVersion && s.byPromptVersion.length > 0 && <PromptVersionTable rows={s.byPromptVersion} />}
        </>
      )}

      <FeedbackReview active={active} />
    </div>
  );
}

function ToolsTable({ tools }: { tools: ToolRow[] }) {
  const rows = React.useMemo(() => [...tools].sort((a, b) => b.calls - a.calls), [tools]);
  const { pageItems, pager } = usePaged(rows, { keyOf: toolKey, label: 'tools' });
  return (
    <Panel title="Por tool" description="Chamadas no período, ordenadas por volume">
      {rows.length === 0 ? (
        <div className="p-3">
          <ReadState kind="vazio" title="Nenhuma tool chamada no período." />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm tabular-nums">
              <caption className="sr-only">Uso de tools no período</caption>
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th scope="col" className="px-3 py-2.5 text-left font-medium">Tool</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Chamadas</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Erros</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Taxa de erro</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Tamanho médio</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Tempo médio</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((t) => (
                  <tr key={t.name} className="border-b border-border last:border-0 hover:bg-accent">
                    <td className="h-11 px-3 font-[family-name:var(--f-code)] text-[13px] text-foreground">{t.name}</td>
                    <td className="px-3 text-right font-mono">{fmtInt(t.calls)}</td>
                    <td className={cn('px-3 text-right font-mono', t.errors > 0 && 'text-danger')}>{fmtInt(t.errors)}</td>
                    <td className="px-3 text-right font-mono">{t.calls > 0 ? fmtFraction(t.errors / t.calls) : '—'}</td>
                    <td className="px-3 text-right font-mono">{fmtBytes(t.avgBytes)}</td>
                    <td className="px-3 text-right font-mono">{fmtMs(t.avgMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pager}
        </>
      )}
    </Panel>
  );
}

/**
 * Por versão do prompt (sha do prompt estável + tools): mostra se uma
 * mudança de prompt/tool mexeu na taxa de 👎 e no custo por turno.
 */
function PromptVersionTable({ rows }: { rows: VersionRow[] }) {
  return (
    <Panel title="Por versão do prompt" description="Versões que responderam no período, mais recente primeiro">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm tabular-nums">
          <caption className="sr-only">Qualidade por versão do prompt</caption>
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th scope="col" className="px-3 py-2.5 text-left font-medium">Versão</th>
              <th scope="col" className="px-3 py-2.5 text-left font-medium">Primeiro turno</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Turnos</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Custo por turno</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Negativas por turno</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.promptVersion} className="border-b border-border last:border-0 hover:bg-accent">
                <td className="h-11 px-3 font-[family-name:var(--f-code)] text-[13px] text-foreground">{r.promptVersion}</td>
                <td className="whitespace-nowrap px-3 text-muted-foreground">{fmtDateTime(r.firstSeen)}</td>
                <td className="px-3 text-right font-mono">{fmtInt(r.turns)}</td>
                <td className="px-3 text-right font-mono text-[color:var(--money)]">
                  {r.turns > 0 && r.costUsd != null ? fmtUsd(r.costUsd / r.turns) : '—'}
                </td>
                <td className="px-3 text-right font-mono">{r.turns > 0 ? fmtFraction(r.thumbsDown / r.turns) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
