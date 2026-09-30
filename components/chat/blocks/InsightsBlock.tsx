'use client';

import * as React from 'react';
import { cn } from '@/lib/ui-utils';
import { NsIcon, type NsIconName } from '../NsIcon';
import type { InsightsBlock as InsightsBlockData } from '@/types/chat';

// Tons de feedback do DS1 via tokens HSL do chat (--cx-success/-warning/
// -danger por trás de success/warning/danger no Tailwind).
const SEVERITY_CFG: Record<
  InsightsBlockData['insights'][number]['severity'],
  { icon: NsIconName; label: string; border: string; bg: string; text: string }
> = {
  positive: {
    icon: 'trending-up',
    label: 'Positivo',
    border: 'border-success/30',
    bg: 'bg-success/5',
    text: 'text-success',
  },
  negative: {
    icon: 'trending-down',
    label: 'Negativo',
    border: 'border-danger/30',
    bg: 'bg-danger/5',
    text: 'text-danger',
  },
  warning: {
    icon: 'alert-triangle',
    label: 'Atenção',
    border: 'border-warning/30',
    bg: 'bg-warning/5',
    text: 'text-warning',
  },
  neutral: {
    icon: 'info',
    label: 'Informativo',
    border: 'border-border',
    bg: 'bg-card',
    text: 'text-muted-foreground',
  },
};

export function InsightsBlock({ block }: { block: InsightsBlockData }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      {block.insights.map((ins, i) => {
        const cfg = SEVERITY_CFG[ins.severity] ?? SEVERITY_CFG.neutral;
        return (
          <div
            key={ins.id ?? i}
            className={cn(
              'nx-glass-card rounded-lg border p-3 flex items-start gap-3',
              cfg.border,
              cfg.bg,
            )}
          >
            <div className={cn('mt-0.5 shrink-0', cfg.text)}>
              <NsIcon name={cfg.icon} size={16} label={cfg.label} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-sm font-semibold text-foreground truncate">{ins.title}</div>
                <div className={cn('text-sm font-semibold font-mono tabular-nums shrink-0', cfg.text)}>
                  {ins.value}
                </div>
              </div>
              <p className="text-xs leading-[18px] text-muted-foreground mt-1 mb-0">
                {ins.description}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
