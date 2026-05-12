'use client';

import * as React from 'react';
import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { cn } from '@/lib/ui-utils';
import type { SummaryBlock as SummaryBlockData } from '@/types/chat';

export function SummaryBlock({ block }: { block: SummaryBlockData }) {
  return (
    <section className="nx-glass-card rounded-xl">
      <header className="px-4 py-2 border-b border-[color:var(--glass-border)]">
        <h3 className="text-sm font-semibold">{block.title}</h3>
      </header>
      <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-border">
        {block.kpis.map((k, i) => (
          <Kpi key={i} {...k} />
        ))}
      </div>
    </section>
  );
}

function Kpi({
  label,
  value,
  delta,
  hint,
}: SummaryBlockData['kpis'][number]) {
  return (
    <div className="p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
        {label}
      </div>
      <div className="text-xl font-semibold mt-1 tabular-nums">{value}</div>
      {delta && (
        <div
          className={cn(
            'inline-flex items-center gap-0.5 text-[11px] font-mono mt-1.5',
            delta.trend === 'up' && 'text-emerald-500',
            delta.trend === 'down' && 'text-rose-500',
            delta.trend === 'neutral' && 'text-muted-foreground',
          )}
        >
          {delta.trend === 'up' && <ArrowUpRight className="w-3 h-3" />}
          {delta.trend === 'down' && <ArrowDownRight className="w-3 h-3" />}
          {delta.trend === 'neutral' && <Minus className="w-3 h-3" />}
          {delta.value}
        </div>
      )}
      {hint && <div className="text-[10px] text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}
