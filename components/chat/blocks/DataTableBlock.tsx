'use client';

import * as React from 'react';
import { cn } from '@/lib/ui-utils';
import { formatCell } from '@/lib/chat/format';
import { NsIcon } from '../NsIcon';
import type { DataTableBlock as TableData } from '@/types/chat';

type Column = TableData['columns'][number];

// formatCell é a MESMA função do servidor (histórico/eval): percent = pontos
// percentuais, fraction = 0–1. A heurística antiga (v ≤ 1 → ×100) mostrava
// um chargeback de 0.8% como "80.0%".
const NUMERIC_FORMATS = new Set<Column['format']>(['currency', 'percent', 'fraction', 'number']);

/** DS1: texto à esquerda, números à direita — a menos que o bloco diga outra coisa. */
function alignOf(c: Column): 'left' | 'right' | 'center' {
  return c.align ?? (NUMERIC_FORMATS.has(c.format) ? 'right' : 'left');
}

export function DataTableBlock({ block }: { block: TableData }) {
  const [sortKey, setSortKey] = React.useState<string | null>(null);
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('desc');

  const rows = React.useMemo(() => {
    if (!sortKey) return block.rows;
    const copy = [...block.rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const num = typeof av === 'number' && typeof bv === 'number';
      if (num) return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
      const sa = String(av ?? '');
      const sb = String(bv ?? '');
      return sortDir === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });
    return copy;
  }, [block.rows, sortKey, sortDir]);

  function clickSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  function exportCsv() {
    const header = block.columns.map((c) => csvEscape(c.label)).join(',');
    const lines = rows.map((r) =>
      block.columns.map((c) => csvEscape(formatCell(r[c.key], c.format))).join(','),
    );
    const csv = [header, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (block.title ?? 'tabela').replace(/\s+/g, '-').toLowerCase() + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="nx-glass-card rounded-lg">
      {(block.title || block.exportable) && (
        <header className="px-4 py-2 min-h-[52px] border-b border-border flex items-center justify-between gap-3">
          {block.title && <h3 className="text-sm font-semibold text-foreground">{block.title}</h3>}
          {block.exportable && (
            // Mesmo botão "Exportar CSV" das tabelas da SPA (.btn.btn-ghost).
            <button type="button" className="btn btn-ghost ml-auto shrink-0" onClick={exportCsv}>
              <NsIcon name="download" size={12} /> Exportar CSV
            </button>
          )}
        </header>
      )}
      <div className="overflow-x-auto">
        {/* DS1 (.tbl da SPA): cabeçalho 12 px medium no tom secundário,
            linha 44 px, corpo 14/22, números à direita em Inter tabular. */}
        <table className="w-full border-collapse text-sm tabular-nums">
          <thead>
            <tr className="border-b border-border">
              {block.columns.map((c) => {
                const align = alignOf(c);
                const active = sortKey === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cn(
                      'p-0 text-xs font-medium text-muted-foreground whitespace-nowrap',
                      align === 'right' && 'text-right',
                      align === 'center' && 'text-center',
                      align === 'left' && 'text-left',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => clickSort(c.key)}
                      className={cn(
                        'w-full inline-flex items-center gap-1 px-3 py-2.5 font-medium hover:text-foreground select-none transition-colors',
                        align === 'right' && 'justify-end',
                        align === 'center' && 'justify-center',
                        active && 'text-foreground',
                      )}
                    >
                      {c.label}
                      {active && (
                        <NsIcon name={sortDir === 'asc' ? 'arrow-up' : 'arrow-down'} size={12} />
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={i}
                className={cn(
                  'border-b border-border last:border-0 hover:bg-accent transition-colors',
                  r._highlight === 'success' && 'bg-success/5',
                  r._highlight === 'warning' && 'bg-warning/5',
                  r._highlight === 'danger' && 'bg-danger/5',
                )}
              >
                {block.columns.map((c) => {
                  const align = alignOf(c);
                  const numeric = NUMERIC_FORMATS.has(c.format) || typeof r[c.key] === 'number';
                  return (
                    <td
                      key={c.key}
                      className={cn(
                        'h-11 px-3 py-[11px] leading-[22px] text-foreground',
                        align === 'right' && 'text-right',
                        align === 'center' && 'text-center',
                        numeric && 'font-mono font-medium whitespace-nowrap',
                        // DS1 (decisão do produto): dinheiro sempre verde.
                        c.format === 'currency' && typeof r[c.key] === 'number' && 'text-[color:var(--money)]',
                      )}
                    >
                      {formatCell(r[c.key], c.format)}
                    </td>
                  );
                })}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={block.columns.length} className="px-3 py-6 text-center text-muted-foreground">
                  Nenhuma linha
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
