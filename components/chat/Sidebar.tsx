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
  Folder,
  FolderPlus,
  FolderInput,
  ChevronRight,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/ui-utils';
import { groupByDate, relativeTime } from '@/lib/chat/client';
import type { ChatFolder, Conversation } from '@/types/chat';

const COLLAPSED_KEY = 'ns-chat-folders-collapsed';

function loadCollapsed(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  conversations: Conversation[];
  folders: ChatFolder[];
  activeFolderId: string | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onSelectFolder: (id: string | null) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string) => void;
  onExport: (id: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, folderId: string | null) => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  /** Knowledge é admin-only — false esconde o gatilho (member levaria 401). */
  showKnowledge: boolean;
  onOpenKnowledge: () => void;
}

export function Sidebar({
  collapsed,
  onToggleCollapsed,
  conversations,
  folders,
  activeFolderId,
  selectedId,
  onSelect,
  onSelectFolder,
  onNew,
  onRename,
  onTogglePin,
  onExport,
  onDelete,
  onMove,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  showKnowledge,
  onOpenKnowledge,
}: SidebarProps) {
  const [search, setSearch] = React.useState('');
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState('');
  // Pastas colapsadas — persistido em localStorage (array de ids).
  const [collapsedFolders, setCollapsedFolders] = React.useState<string[]>(loadCollapsed);
  const [creatingFolder, setCreatingFolder] = React.useState(false);
  const [newFolderName, setNewFolderName] = React.useState('');
  const [renamingFolderId, setRenamingFolderId] = React.useState<string | null>(null);
  const [folderRenameValue, setFolderRenameValue] = React.useState('');

  React.useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsedFolders));
    } catch {
      /* noop */
    }
  }, [collapsedFolders]);

  const searching = search.trim().length > 0;

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => (c.title || '').toLowerCase().includes(q));
  }, [conversations, search]);

  // Buscando: lista chapada agrupada por data (ignora pastas).
  const searchGroups = React.useMemo(
    () => (searching ? groupByDate(filtered) : []),
    [searching, filtered],
  );

  // Conversas por pasta (mapa) + raiz agrupada por data.
  const byFolder = React.useMemo(() => {
    const map = new Map<string, Conversation[]>();
    for (const c of conversations) {
      if (!c.folderId) continue;
      const arr = map.get(c.folderId) ?? [];
      arr.push(c);
      map.set(c.folderId, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
    }
    return map;
  }, [conversations]);

  const rootGroups = React.useMemo(
    () => groupByDate(conversations.filter((c) => !c.folderId)),
    [conversations],
  );

  function toggleFolderCollapse(id: string) {
    setCollapsedFolders((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function commitRename(id: string) {
    const next = renameValue.trim();
    if (next && next !== (conversations.find((c) => c.id === id)?.title ?? '')) {
      onRename(id, next);
    }
    setRenamingId(null);
    setRenameValue('');
  }

  function commitCreateFolder() {
    const name = newFolderName.trim();
    if (name) onCreateFolder(name);
    setCreatingFolder(false);
    setNewFolderName('');
  }

  function commitRenameFolder(id: string) {
    const next = folderRenameValue.trim();
    if (next && next !== (folders.find((f) => f.id === id)?.name ?? '')) {
      onRenameFolder(id, next);
    }
    setRenamingFolderId(null);
    setFolderRenameValue('');
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

          {showKnowledge && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={onOpenKnowledge} aria-label="Base de conhecimento">
                  <BookOpen className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Base de conhecimento</TooltipContent>
            </Tooltip>
          )}
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
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onNew} className="flex-1 justify-start min-w-0">
            <Plus className="w-4 h-4" />
            <span className="truncate">Nova conversa</span>
          </Button>
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    setCreatingFolder((v) => !v);
                    setNewFolderName('');
                  }}
                  aria-label="Nova pasta"
                >
                  <FolderPlus className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Nova pasta</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        {creatingFolder && (
          <div className="flex items-center gap-1.5">
            <Input
              autoFocus
              placeholder="Nome da pasta..."
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitCreateFolder();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setCreatingFolder(false);
                  setNewFolderName('');
                }
              }}
              className="h-9 text-xs flex-1"
              aria-label="Nome da nova pasta"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={commitCreateFolder}
              disabled={!newFolderName.trim()}
              aria-label="Criar pasta"
            >
              <Check className="w-4 h-4" />
            </Button>
          </div>
        )}
        {showKnowledge && (
          <Button variant="ghost" onClick={onOpenKnowledge} className="w-full justify-start text-xs text-muted-foreground hover:text-foreground">
            <BookOpen className="w-3.5 h-3.5" /> Base de conhecimento
          </Button>
        )}
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
        {searching ? (
          // ---- Modo busca: lista chapada, agrupada por data ----
          <>
            {searchGroups.length === 0 && (
              <div className="text-xs text-muted-foreground px-3 py-6 text-center leading-relaxed">
                Nenhuma conversa encontrada.
              </div>
            )}
            {searchGroups.map((g) => (
              <div key={g.label} className="mb-3">
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                  {g.label}
                </div>
                <div className="space-y-0.5">
                  {g.items.map((c) => renderConvItem(c))}
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
            {/* ---- Pastas ---- */}
            {folders.map((f) => {
              const convs = byFolder.get(f.id) ?? [];
              const isCollapsed = collapsedFolders.includes(f.id);
              const isActive = activeFolderId === f.id;
              const isRenaming = renamingFolderId === f.id;
              return (
                <div key={f.id} className="mb-1.5">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={
                      isRenaming
                        ? undefined
                        : () => {
                            onSelectFolder(f.id);
                            toggleFolderCollapse(f.id);
                          }
                    }
                    onKeyDown={(e) => {
                      if (isRenaming) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectFolder(f.id);
                        toggleFolderCollapse(f.id);
                      }
                    }}
                    aria-expanded={!isCollapsed}
                    title={isActive ? 'Pasta ativa — novas conversas nascem aqui' : 'Abrir pasta (novas conversas nascem na pasta ativa)'}
                    className={cn(
                      'group flex items-center gap-1.5 px-2 min-h-9 rounded-md cursor-pointer transition-colors select-none',
                      isActive
                        ? 'bg-accent/50 border-l-2 border-primary/70 pl-[6px]'
                        : 'hover:bg-accent/30',
                    )}
                  >
                    <ChevronRight
                      className={cn(
                        'w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform',
                        !isCollapsed && 'rotate-90',
                      )}
                    />
                    <Folder className={cn('w-3.5 h-3.5 shrink-0', isActive ? 'text-primary' : 'text-muted-foreground')} />
                    {isRenaming ? (
                      <input
                        autoFocus
                        value={folderRenameValue}
                        onChange={(e) => setFolderRenameValue(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={() => commitRenameFolder(f.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            commitRenameFolder(f.id);
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            setRenamingFolderId(null);
                            setFolderRenameValue('');
                          }
                        }}
                        className="flex-1 min-w-0 bg-transparent border-b border-muted-foreground text-xs py-0.5 outline-none"
                        aria-label={`Renomear pasta "${f.name}"`}
                      />
                    ) : (
                      <span
                        className={cn(
                          'flex-1 min-w-0 truncate text-xs font-medium',
                          isActive && 'text-primary',
                        )}
                      >
                        {f.name}
                      </span>
                    )}
                    <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                      {convs.length}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => e.stopPropagation()}
                          className="shrink-0 h-9 w-9 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                          aria-label={`Opções da pasta "${f.name}"`}
                          title="Opções da pasta"
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenuItem
                          onSelect={() => {
                            setRenamingFolderId(f.id);
                            setFolderRenameValue(f.name);
                          }}
                        >
                          <Pencil className="w-3.5 h-3.5" /> Renomear
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={() => onDeleteFolder(f.id)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Excluir pasta
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {!isCollapsed && (
                    <div className="space-y-0.5 mt-0.5 ml-3 border-l border-border/60 pl-1.5">
                      {convs.length === 0 ? (
                        <div className="text-[11px] text-muted-foreground px-2 py-2 leading-relaxed">
                          Pasta vazia — mova conversas pra cá ou crie uma nova com ela ativa.
                        </div>
                      ) : (
                        convs.map((c) => renderConvItem(c))
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* ---- Raiz (sem pasta) — sempre visível ---- */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => onSelectFolder(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectFolder(null);
                }
              }}
              title="Novas conversas sem pasta ativa nascem aqui na raiz"
              className={cn(
                'flex items-center gap-1.5 px-3 min-h-9 mt-1 rounded-md cursor-pointer select-none transition-colors hover:bg-accent/30',
              )}
            >
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                Conversas
              </span>
            </div>
            {rootGroups.length === 0 && (
              <div className="text-xs text-muted-foreground px-3 py-6 text-center leading-relaxed">
                Nenhuma conversa ainda. Faça uma pergunta pra começar.
              </div>
            )}
            {rootGroups.map((g) => (
              <div key={g.label} className="mb-3">
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/80 font-mono">
                  {g.label}
                </div>
                <div className="space-y-0.5">
                  {g.items.map((c) => renderConvItem(c))}
                </div>
              </div>
            ))}
          </>
        )}
      </ScrollArea>
    </aside>
  );

  function renderConvItem(c: Conversation) {
    return (
      <ConversationItem
        key={c.id}
        conv={c}
        folders={folders}
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
        onMove={(folderId) => onMove(c.id, folderId)}
      />
    );
  }
}

interface ConvItemProps {
  conv: Conversation;
  folders: ChatFolder[];
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
  onMove: (folderId: string | null) => void;
}

function ConversationItem({
  conv,
  folders,
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
  onMove,
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
        {/* Demais ações (renomear, mover, fixar, exportar) no menu. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={(e) => e.stopPropagation()}
              className="shrink-0 text-muted-foreground hover:text-foreground hover:bg-accent"
              aria-label="Mais opções (renomear, mover, fixar, exportar)"
              title="Mais opções"
            >
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onSelect={() => onStartRename()}>
              <Pencil className="w-3.5 h-3.5" /> Renomear
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderInput className="w-3.5 h-3.5" /> Mover pra…
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem
                  disabled={conv.folderId == null}
                  onSelect={() => onMove(null)}
                >
                  {conv.folderId == null && <Check className="w-3.5 h-3.5" />}
                  Sem pasta
                </DropdownMenuItem>
                {folders.length > 0 && <DropdownMenuSeparator />}
                {folders.map((f) => (
                  <DropdownMenuItem
                    key={f.id}
                    disabled={conv.folderId === f.id}
                    onSelect={() => onMove(f.id)}
                  >
                    {conv.folderId === f.id ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Folder className="w-3.5 h-3.5" />
                    )}
                    <span className="truncate max-w-[160px]">{f.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
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
