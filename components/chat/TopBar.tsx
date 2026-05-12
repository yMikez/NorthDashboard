'use client';

import * as React from 'react';
import {
  ChevronDown,
  Database,
  Pencil,
  RefreshCw,
  Share2,
  Sparkles,
  Sun,
  Moon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/ui-utils';
import { FilterChips } from './FilterChips';
import type { FilterState } from '@/types/chat';

export type SyncStatus = 'live' | 'stale' | 'syncing' | 'error';
export type ThemeMode = 'dark' | 'light';

interface TopBarProps {
  title: string | null;
  onRenameTitle: (next: string) => void;
  filters: FilterState;
  onChangeFilters: (next: FilterState) => void;
  syncStatus: SyncStatus;
  syncLabel?: string;
  onRefresh: () => void;
  onExport: () => void;
  onShare: () => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
}

export function TopBar({
  title,
  onRenameTitle,
  filters,
  onChangeFilters,
  syncStatus,
  syncLabel,
  onRefresh,
  onExport,
  onShare,
  theme,
  onToggleTheme,
}: TopBarProps) {
  const [renaming, setRenaming] = React.useState(false);
  const [draft, setDraft] = React.useState(title ?? '');
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (renaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renaming]);

  React.useEffect(() => {
    setDraft(title ?? '');
  }, [title]);

  function commit() {
    const next = draft.trim();
    if (next && next !== title) onRenameTitle(next);
    setRenaming(false);
  }

  return (
    <header className="nx-strip-eyebrow px-4 py-2.5 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <Sparkles className="w-4 h-4 text-[color:var(--glow-cyan)] shrink-0" />
          <div className="min-w-0 flex flex-col -my-0.5">
            <span className="nx-eyebrow">ANÁLISE COM IA</span>
            {renaming ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setDraft(title ?? '');
                  setRenaming(false);
                }
              }}
              className="bg-transparent border-b border-primary text-sm font-medium outline-none min-w-0 flex-1 max-w-md"
            />
          ) : (
            <button
              type="button"
              onClick={() => setRenaming(true)}
              className="group flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-[color:var(--glow-cyan)] min-w-0 truncate transition-colors text-left"
              title="Clique pra renomear"
            >
              <span className="truncate">{title || 'Nova conversa'}</span>
              <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-60 shrink-0" />
            </button>
          )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <SyncIndicator status={syncStatus} label={syncLabel} onRefresh={onRefresh} />
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" onClick={onToggleTheme} aria-label="Alternar tema">
                  {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Tema {theme === 'dark' ? 'claro' : 'escuro'}</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                Ações <ChevronDown className="w-3 h-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Conversa</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onShare}>
                <Share2 className="w-3.5 h-3.5" /> Compartilhar
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onExport}>
                <Database className="w-3.5 h-3.5" /> Exportar JSON
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <FilterChips filters={filters} onChange={onChangeFilters} />
    </header>
  );
}

function SyncIndicator({
  status,
  label,
  onRefresh,
}: {
  status: SyncStatus;
  label?: string;
  onRefresh: () => void;
}) {
  const cfg: Record<SyncStatus, { dot: string; text: string; default: string }> = {
    live: { dot: 'bg-emerald-500', text: 'text-emerald-500', default: 'Ao vivo' },
    stale: { dot: 'bg-amber-500', text: 'text-amber-500', default: 'Dados defasados' },
    syncing: { dot: 'bg-sky-500 animate-pulse', text: 'text-sky-500', default: 'Sincronizando…' },
    error: { dot: 'bg-rose-500', text: 'text-rose-500', default: 'Erro de sync' },
  };
  const c = cfg[status];
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onRefresh}
            className={cn(
              'inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-mono border border-border hover:bg-accent transition-colors',
              c.text,
            )}
          >
            <span className={cn('w-1.5 h-1.5 rounded-full', c.dot)} />
            <span>{label ?? c.default}</span>
            <RefreshCw className={cn('w-3 h-3', status === 'syncing' && 'animate-spin')} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Forçar sincronização (Cmd+R)</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

