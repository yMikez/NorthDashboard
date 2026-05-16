'use client';

import * as React from 'react';
import {
  Plus,
  Search,
  MoreHorizontal,
  Pin,
  PinOff,
  Pencil,
  Download,
  Trash2,
  Sparkles,
  PanelLeftClose,
  PanelLeft,
  BookOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/ui-utils';
import { groupByDate, relativeTime } from '@/lib/chat/client';
import type { Conversation } from '@/types/chat';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string) => void;
  onExport: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenKnowledge: () => void;
}

export function Sidebar({
  collapsed,
  onToggleCollapsed,
  conversations,
  selectedId,
  onSelect,
  onNew,
  onRename,
  onTogglePin,
  onExport,
  onDelete,
  onOpenKnowledge,
}: SidebarProps) {
  const [search, setSearch] = React.useState('');
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState('');

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => (c.title || '').toLowerCase().includes(q));
  }, [conversations, search]);

  const groups = React.useMemo(() => groupByDate(filtered), [filtered]);

  function commitRename(id: string) {
    const next = renameValue.trim();
    if (next && next !== (conversations.find((c) => c.id === id)?.title ?? '')) {
      onRename(id, next);
    }
    setRenamingId(null);
    setRenameValue('');
  }

  if (collapsed) {
    return (
      <aside className="w-16 nx-glass-panel relative z-[1] flex flex-col items-center py-3 gap-2">
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={onToggleCollapsed} aria-label="Expandir sidebar">
                <PanelLeft className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Expandir sidebar</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={onNew} aria-label="Nova conversa">
                <Plus className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Nova conversa <kbd className="ml-2 text-[10px] opacity-70">⌘J</kbd></TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={onOpenKnowledge} aria-label="Base de conhecimento">
                <BookOpen className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Base de conhecimento</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <div className="flex-1" />
      </aside>
    );
  }

  return (
    <aside className="w-[260px] nx-glass-panel relative z-[1] flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-border flex items-center gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-8 h-8 rounded-md bg-muted/60 border border-border flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-primary/80" />
          </div>
          <span className="font-semibold text-sm truncate">Análise IA</span>
        </div>
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={onToggleCollapsed} aria-label="Colapsar sidebar">
                <PanelLeftClose className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Colapsar sidebar</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div className="p-3 space-y-2">
        <Button variant="outline" onClick={onNew} className="w-full justify-start">
          <Plus className="w-4 h-4" /> Nova conversa
        </Button>
        <Button variant="ghost" onClick={onOpenKnowledge} className="w-full justify-start text-xs text-muted-foreground hover:text-foreground">
          <BookOpen className="w-3.5 h-3.5" /> Base de conhecimento
        </Button>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            data-chat-search
            placeholder="Buscar conversas..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>
      </div>

      <ScrollArea className="flex-1 px-2">
        {groups.length === 0 && (
          <div className="text-xs text-muted-foreground px-3 py-6 text-center leading-relaxed">
            Nenhuma conversa ainda. Faça uma pergunta pra começar.
          </div>
        )}
        {groups.map((g) => (
          <div key={g.label} className="mb-3">
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
              {g.label}
            </div>
            <div className="space-y-0.5">
              {g.items.map((c) => (
                <ConversationItem
                  key={c.id}
                  conv={c}
                  selected={c.id === selectedId}
                  renaming={renamingId === c.id}
                  renameValue={renameValue}
                  onSelect={() => onSelect(c.id)}
                  onStartRename={() => {
                    setRenamingId(c.id);
                    setRenameValue(c.title ?? '');
                  }}
                  onChangeRename={setRenameValue}
                  onCommitRename={() => commitRename(c.id)}
                  onCancelRename={() => {
                    setRenamingId(null);
                    setRenameValue('');
                  }}
                  onTogglePin={() => onTogglePin(c.id)}
                  onExport={() => onExport(c.id)}
                  onDelete={() => onDelete(c.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </ScrollArea>
    </aside>
  );
}

interface ConvItemProps {
  conv: Conversation;
  selected: boolean;
  renaming: boolean;
  renameValue: string;
  onSelect: () => void;
  onStartRename: () => void;
  onChangeRename: (v: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onTogglePin: () => void;
  onExport: () => void;
  onDelete: () => void;
}

function ConversationItem({
  conv,
  selected,
  renaming,
  renameValue,
  onSelect,
  onStartRename,
  onChangeRename,
  onCommitRename,
  onCancelRename,
  onTogglePin,
  onExport,
  onDelete,
}: ConvItemProps) {
  return (
    <div
      onClick={renaming ? undefined : onSelect}
      className={cn(
        'group flex items-start gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors',
        selected
          ? 'bg-accent/60 text-accent-foreground border-l-2 border-primary/70 pl-[10px]'
          : 'hover:bg-accent/30',
      )}
    >
      <div className="flex-1 min-w-0 overflow-hidden">
        {renaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => onChangeRename(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={onCommitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onCommitRename();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onCancelRename();
              }
            }}
            className="w-full bg-transparent border-b border-muted-foreground text-xs py-0.5 outline-none"
          />
        ) : (
          // Flex com min-w-0 + filho truncate flex-1 min-w-0 — necessário pra
          // truncar em flex containers (truncate puro no flex parent não corta
          // o filho span, ele cresce além do container e some na borda).
          <div className="text-xs flex items-center gap-1 min-w-0">
            {conv.pinned && <Pin className="w-3 h-3 shrink-0 text-primary" />}
            <span className="truncate flex-1 min-w-0 block">
              {conv.title || '(sem título)'}
            </span>
          </div>
        )}
        <div className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate">
          {conv.messageCount} msg · {relativeTime(conv.updatedAt)}
        </div>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        {/* Lixeira SEMPRE visível — delete é a ação mais pedida e estava
            escondida dentro do dropdown. Click direto + confirm no handler. */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          aria-label={`Deletar conversa "${conv.title || 'sem título'}"`}
          title="Deletar conversa"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
        {/* Demais ações (renomear, fixar, exportar) no menu. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={(e) => e.stopPropagation()}
              className="shrink-0 text-muted-foreground hover:text-foreground hover:bg-accent"
              aria-label="Mais opções (renomear, fixar, exportar)"
              title="Mais opções"
            >
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onSelect={() => onStartRename()}>
              <Pencil className="w-3.5 h-3.5" /> Renomear
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onTogglePin()}>
              {conv.pinned ? (
                <>
                  <PinOff className="w-3.5 h-3.5" /> Desafixar
                </>
              ) : (
                <>
                  <Pin className="w-3.5 h-3.5" /> Fixar
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onExport()}>
              <Download className="w-3.5 h-3.5" /> Exportar
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => onDelete()}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="w-3.5 h-3.5" /> Deletar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
