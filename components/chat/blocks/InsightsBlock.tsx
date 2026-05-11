'use client';

import * as React from 'react';
import { TrendingUp, TrendingDown, AlertTriangle, Info } from 'lucide-react';
import { cn } from '@/lib/ui-utils';
import type { InsightsBlock as InsightsBlockData } from '@/types/chat';

const SEVERITY_CFG = {
  positive: {
    icon: TrendingUp,
    border: 'border-emerald-500/30',
    bg: 'bg-emerald-500/5',
    text: 'text-emerald-500',
  },
  negative: {
    icon: TrendingDown,
    border: 'border-rose-500/30',
    bg: 'bg-rose-500/5',
    text: 'text-rose-500',
  },
  warning: {
    icon: AlertTriangle,
    border: 'border-amber-500/30',
    bg: 'bg-amber-500/5',
    text: 'text-amber-500',
  },
  neutral: {
    icon: Info,
    border: 'border-border',
    bg: 'bg-card',
    text: 'text-muted-foreground',
  },
} as const;

export function InsightsBlock({ block }: { block: InsightsBlockData }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      {block.insights.map((ins, i) => {
        const cfg = SEVERITY_CFG[ins.severity];
        const Icon = cfg.icon;
        return (
          <div
            key={ins.id ?? i}
            className={cn(
              'rounded-lg border p-3 flex items-start gap-3',
              cfg.border,
              cfg.bg,
            )}
          >
            <div className={cn('mt-0.5 shrink-0', cfg.text)}>
              <Icon className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-xs font-semibold truncate">{ins.title}</div>
                <div className={cn('text-sm font-semibold tabular-nums shrink-0', cfg.text)}>
                  {ins.value}
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                {ins.description}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
