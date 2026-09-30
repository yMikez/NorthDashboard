// Série diária do painel de qualidade (turnos, custo ou avaliações
// negativas por dia). Uma métrica por vez, escolhida no seletor: medidas de
// escala diferente nunca dividem o eixo (sem eixo duplo). Barras com a cor
// de série do DS1 (--chart-1), grade discreta, tooltip por barra e tabela
// equivalente pra leitor de tela.

'use client';

import * as React from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { DAY_METRICS, fmtDay, fmtDayMetric, fmtDayShort, type DayMetric, type QualitySummary } from './adminCore';
import { Panel, ReadState, Segmented } from './ui';

// Eixos: rótulo auxiliar em Montserrat (fonte de dados do DS1), tom secundário.
const TICK = { fontSize: 11, fill: 'hsl(var(--muted-foreground))', fontFamily: 'var(--f-mono)' };

interface Point {
  day: string;
  label: string;
  value: number;
}

export function DailyChart({ days }: { days: QualitySummary['byDay'] }) {
  const [metric, setMetric] = React.useState<DayMetric>('turns');
  const data = React.useMemo<Point[]>(
    () =>
      [...days]
        .sort((a, b) => a.day.localeCompare(b.day))
        .map((d) => ({ day: d.day, label: fmtDayShort(d.day), value: Number(d[metric] ?? 0) || 0 })),
    [days, metric],
  );
  const metricLabel = DAY_METRICS.find((m) => m.id === metric)?.label ?? '';
  const hasData = data.some((d) => d.value !== 0);

  return (
    <Panel
      title="Por dia"
      actions={<Segmented label="Métrica do gráfico" value={metric} options={DAY_METRICS} onChange={setMetric} />}
    >
      {!hasData ? (
        <div className="p-3">
          <ReadState kind="vazio" title="Sem dados no período.">
            Nenhum turno registrado com esta métrica.
          </ReadState>
        </div>
      ) : (
        <>
          <div className="h-[220px] p-3" aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="hsl(var(--cx-border))" />
                <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={{ stroke: 'hsl(var(--cx-border))' }} minTickGap={12} />
                <YAxis
                  tick={TICK}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  allowDecimals={metric === 'costUsd'}
                  tickFormatter={(v: number) => fmtDayMetric(metric, v)}
                />
                <Tooltip
                  cursor={{ fill: 'hsl(var(--cx-accent))' }}
                  content={({ active, payload }) => {
                    const p = active && payload?.[0] ? (payload[0].payload as Point) : null;
                    if (!p) return null;
                    return (
                      <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
                        <div className="text-muted-foreground">{fmtDay(p.day)}</div>
                        <div className="mt-0.5 text-foreground">
                          {metricLabel}:{' '}
                          <span className={metric === 'costUsd' ? 'font-mono font-semibold tabular-nums text-[color:var(--money)]' : 'font-mono font-semibold tabular-nums'}>
                            {fmtDayMetric(metric, p.value)}
                          </span>
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="value" name={metricLabel} fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <table className="sr-only">
            <caption>{metricLabel} por dia</caption>
            <thead>
              <tr>
                <th scope="col">Dia</th>
                <th scope="col">{metricLabel}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.day}>
                  <td>{fmtDay(d.day)}</td>
                  <td>{fmtDayMetric(metric, d.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Panel>
  );
}
