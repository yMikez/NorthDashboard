'use client';

import * as React from 'react';
import { cn } from '@/lib/ui-utils';
import { NsIcon } from '../NsIcon';
import type { SummaryBlock as SummaryBlockData } from '@/types/chat';

export function SummaryBlock({ block }: { block: SummaryBlockData }) {
  return (
    <section className="nx-glass-card rounded-lg">
      <header className="px-4 py-2.5 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">{block.title}</h3>
      </header>
      <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-border">
        {block.kpis.map((k, i) => (
          <Kpi key={i} {...k} />
        ))}
      </div>
    </section>
  );
}

const TREND_LABEL = { up: 'Alta', down: 'Queda', neutral: 'Estável' } as const;

function Kpi({
  label,
  value,
  delta,
  hint,
}: SummaryBlockData['kpis'][number]) {
  return (
    <div className="p-4 min-w-0">
      {/* DS1: rótulo 12 px em caixa normal, tom secundário; métrica em
          Montserrat semibold com algarismos tabulares. 20 px (não 24) porque
          a coluna do bloco tem ~140 px; quebra em vez de cortar o número. */}
      <div className="text-xs leading-[18px] text-muted-foreground">{label}</div>
      <div className="text-xl leading-7 font-semibold font-mono tabular-nums text-foreground mt-1 break-words">{value}</div>
      {delta && (
        <div
          className={cn(
            'inline-flex items-center gap-0.5 text-xs font-mono tabular-nums mt-1.5',
            delta.trend === 'up' && 'text-success',
            delta.trend === 'down' && 'text-danger',
            delta.trend === 'neutral' && 'text-muted-foreground',
          )}
        >
          {delta.trend === 'up' && <NsIcon name="arrow-up-right" size={12} label={TREND_LABEL.up} />}
          {delta.trend === 'down' && <NsIcon name="arrow-down-right" size={12} label={TREND_LABEL.down} />}
          {delta.trend === 'neutral' && <NsIcon name="minus" size={12} label={TREND_LABEL.neutral} />}
          {delta.value}
        </div>
      )}
      {hint && <div className="text-xs leading-[18px] text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}
