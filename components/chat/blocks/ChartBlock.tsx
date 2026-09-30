'use client';

import * as React from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import type { ChartBlock as ChartData } from '@/types/chat';

// Séries do DS1: --chart-1..5 de /styles/colors_and_type.css (a layout do
// chat carrega), que trocam de valor com o tema. Referência direta, sem
// hsl(): lá os tokens são hex.
const PALETTE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];

// Eixos: rótulo auxiliar em Montserrat (fonte de dados do DS1), tom secundário.
const TICK = { fontSize: 11, fill: 'hsl(var(--muted-foreground))', fontFamily: 'var(--f-mono)' };

export function ChartBlock({ block }: { block: ChartData }) {
  const merged = React.useMemo(() => mergeSeries(block.series), [block.series]);
  const seriesNames = block.series.map((s) => s.name);

  return (
    <section className="nx-glass-card rounded-lg">
      {block.title && (
        <header className="px-4 py-2.5 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">{block.title}</h3>
        </header>
      )}
      <div className="p-3 h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          {renderChart(block.variant, merged, seriesNames)}
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function renderChart(
  variant: ChartData['variant'],
  data: Array<Record<string, string | number>>,
  names: string[],
): React.ReactElement {
  const common = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--cx-border))" />
      <XAxis dataKey="x" tick={TICK} />
      <YAxis tick={TICK} />
      <Tooltip
        contentStyle={{
          background: 'hsl(var(--popover))',
          color: 'hsl(var(--popover-foreground))',
          border: '1px solid hsl(var(--cx-border))',
          borderRadius: 6,
          fontSize: 12,
        }}
        labelStyle={{ color: 'hsl(var(--muted-foreground))' }}
      />
      <Legend wrapperStyle={{ fontSize: 12 }} />
    </>
  );

  if (variant === 'bar') {
    return (
      <BarChart data={data}>
        {common}
        {names.map((n, i) => (
          <Bar key={n} dataKey={n} fill={PALETTE[i % PALETTE.length]} radius={[4, 4, 0, 0]} />
        ))}
      </BarChart>
    );
  }
  if (variant === 'area') {
    return (
      <AreaChart data={data}>
        {common}
        {names.map((n, i) => {
          const c = PALETTE[i % PALETTE.length];
          return (
            <Area
              key={n}
              type="monotone"
              dataKey={n}
              stroke={c}
              fill={c}
              fillOpacity={0.15}
              strokeWidth={2}
            />
          );
        })}
      </AreaChart>
    );
  }
  return (
    <LineChart data={data}>
      {common}
      {names.map((n, i) => (
        <Line
          key={n}
          type="monotone"
          dataKey={n}
          stroke={PALETTE[i % PALETTE.length]}
          strokeWidth={2}
          dot={false}
        />
      ))}
    </LineChart>
  );
}

function mergeSeries(series: ChartData['series']): Array<Record<string, string | number>> {
  const byX = new Map<string | number, Record<string, string | number>>();
  for (const s of series) {
    for (const pt of s.data) {
      const row = byX.get(pt.x) ?? { x: pt.x };
      row[s.name] = pt.y;
      byX.set(pt.x, row);
    }
  }
  return [...byX.values()].sort((a, b) => {
    const ax = a.x;
    const bx = b.x;
    if (typeof ax === 'number' && typeof bx === 'number') return ax - bx;
    return String(ax).localeCompare(String(bx));
  });
}
