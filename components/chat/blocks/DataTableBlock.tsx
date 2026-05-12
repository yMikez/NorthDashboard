'use client';

import * as React from 'react';
import { Download, ArrowUp, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/ui-utils';
import type { DataTableBlock as TableData } from '@/types/chat';

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
    <section className="nx-glass-card rounded-xl">
      {(block.title || block.exportable) && (
        <header className="px-4 py-2 border-b border-[color:var(--glass-border)] flex items-center justify-between">
          {block.title && <h3 className="text-sm font-semibold">{block.title}</h3>}
          {block.exportable && (
            <Button variant="outline" size="sm" onClick={exportCsv} className="h-7 gap-1.5 text-xs">
              <Download className="w-3 h-3" /> CSV
            </Button>
          )}
        </header>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono border-b border-border">
              {block.columns.map((c) => (
                <th
                  key={c.key}
                  onClick={() => clickSort(c.key)}
                  className={cn(
                    'px-3 py-2 font-medium cursor-pointer hover:text-foreground select-none',
                    c.align === 'right' && 'text-right',
                    c.align === 'center' && 'text-center',
                    !c.align && 'text-left',
                  )}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    {sortKey === c.key &&
                      (sortDir === 'asc' ? (
                        <ArrowUp className="w-3 h-3" />
                      ) : (
                        <ArrowDown className="w-3 h-3" />
                      ))}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={i}
                className={cn(
                  'border-b border-border last:border-0 hover:bg-accent/30 transition-colors',
                  r._highlight === 'success' && 'bg-emerald-500/5',
                  r._highlight === 'warning' && 'bg-amber-500/5',
                  r._highlight === 'danger' && 'bg-rose-500/5',
                )}
              >
                {block.columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      'px-3 py-2 tabular-nums',
                      c.align === 'right' && 'text-right',
                      c.align === 'center' && 'text-center',
                    )}
                  >
                    {formatCell(r[c.key], c.format)}
                  </td>
                ))}
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

function formatCell(v: unknown, format?: 'currency' | 'percent' | 'number' | 'text'): string {
  if (v == null) return '—';
  if (typeof v === 'number') {
    if (format === 'currency') return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
    if (format === 'percent') return (v <= 1 ? v * 100 : v).toFixed(1) + '%';
    if (format === 'number') return v.toLocaleString('pt-BR');
    return String(v);
  }
  return String(v);
}

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
