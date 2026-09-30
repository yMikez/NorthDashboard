'use client';

// Painel de conversas do /chat. Desktop (≥821px): coluna de 260px no fluxo,
// ou trilho de 64px quando recolhida. Mobile (≤820px): a coluna sai do fluxo
// e o MESMO conteúdo (SidebarPanel) abre como drawer à esquerda (Sheet),
// controlado pelo ChatShell (mobileOpen). Estado de busca/renomear/pastas
// fica aqui em cima, então as duas instâncias do painel enxergam o mesmo.

import * as React from 'react';
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
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/ui-utils';
import { groupByDate, relativeTime } from '@/lib/chat/client';
import type { ChatFolder, Conversation } from '@/types/chat';
import { NsIcon } from './NsIcon';

const COLLAPSED_KEY = 'ns-chat-folders-collapsed';

// Alvo de toque do DS1 (pointer: coarse): controle de texto 44px, botão de
// ícone 40px (o compromisso de densidade da SPA, dashboard.css "Alvos de
// toque"). min-* pra não brigar com a altura base do Button.
const TOUCH_TEXT = '[@media(pointer:coarse)]:min-h-11';
const TOUCH_ICON = '[@media(pointer:coarse)]:min-h-10 [@media(pointer:coarse)]:min-w-10';

// Campo de renomear inline: sublinhado no acento, sem caixa, altura fixa
// igual à da linha que ele substitui (sem pulo de layout). O foco engrossa o
// sublinhado pra 2px (DS1: "2 px só no foco").
const INLINE_EDIT =
  'h-5 w-full min-w-0 bg-transparent border-0 border-b border-ring rounded-none px-0 py-0 text-[13px] leading-5 text-foreground outline-none focus:border-b-2';

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
  /** Lista de conversas aberta como drawer (≤820px). */
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
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
  mobileOpen,
  onMobileOpenChange,
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

  // Drawer aberto e a janela cresceu além de 820px: a coluna volta pro
  // fluxo, então o drawer fecha (senão ficariam os dois, com o fundo modal).
  React.useEffect(() => {
    if (!mobileOpen) return;
    const mq = window.matchMedia('(min-width: 821px)');
    const closeIfDesktop = () => {
      if (mq.matches) onMobileOpenChange(false);
    };
    closeIfDesktop();
    mq.addEventListener('change', closeIfDesktop);
    return () => mq.removeEventListener('change', closeIfDesktop);
  }, [mobileOpen, onMobileOpenChange]);

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

  function renderPanel(variant: 'column' | 'drawer') {
    return (
      <SidebarPanel
        variant={variant}
        folders={folders}
        activeFolderId={activeFolderId}
        selectedId={selectedId}
        search={search}
        onSearchChange={setSearch}
        searching={searching}
        searchGroups={searchGroups}
        byFolder={byFolder}
        rootGroups={rootGroups}
        collapsedFolders={collapsedFolders}
        onToggleFolderCollapse={toggleFolderCollapse}
        creatingFolder={creatingFolder}
        onToggleCreatingFolder={() => {
          setCreatingFolder((v) => !v);
          setNewFolderName('');
        }}
        newFolderName={newFolderName}
        onNewFolderNameChange={setNewFolderName}
        onCommitCreateFolder={commitCreateFolder}
        onCancelCreateFolder={() => {
          setCreatingFolder(false);
          setNewFolderName('');
        }}
        renamingFolderId={renamingFolderId}
        folderRenameValue={folderRenameValue}
        onStartRenameFolder={(f) => {
          setRenamingFolderId(f.id);
          setFolderRenameValue(f.name);
        }}
        onFolderRenameValueChange={setFolderRenameValue}
        onCommitRenameFolder={commitRenameFolder}
        onCancelRenameFolder={() => {
          setRenamingFolderId(null);
          setFolderRenameValue('');
        }}
        renamingId={renamingId}
        renameValue={renameValue}
        onStartRename={(c) => {
          setRenamingId(c.id);
          setRenameValue(c.title ?? '');
        }}
        onRenameValueChange={setRenameValue}
        onCommitRename={commitRename}
        onCancelRename={() => {
          setRenamingId(null);
          setRenameValue('');
        }}
        onToggleCollapsed={onToggleCollapsed}
        onSelect={onSelect}
        onSelectFolder={onSelectFolder}
        onNew={onNew}
        onTogglePin={onTogglePin}
        onExport={onExport}
        onDelete={onDelete}
        onMove={onMove}
        onDeleteFolder={onDeleteFolder}
        showKnowledge={showKnowledge}
        onOpenKnowledge={() => {
          // No drawer, fecha a lista antes de abrir a base (um modal por vez).
          if (variant === 'drawer') onMobileOpenChange(false);
          onOpenKnowledge();
        }}
      />
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      {collapsed ? (
        // Trilho recolhido — só desktop.
        <aside className="w-16 shrink-0 nx-glass-panel relative z-[1] flex flex-col items-center py-3 gap-2 max-[820px]:hidden">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={onToggleCollapsed} aria-label="Expandir conversas">
                <NsIcon name="panel-left" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Expandir conversas</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={onNew} aria-label="Nova conversa">
                <NsIcon name="plus" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              Nova conversa <kbd className="ml-2 font-mono text-[11px] text-muted-foreground">⌘J</kbd>
            </TooltipContent>
          </Tooltip>

          {showKnowledge && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={onOpenKnowledge} aria-label="Base de conhecimento">
                  <NsIcon name="book-open" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Base de conhecimento</TooltipContent>
            </Tooltip>
          )}

          <div className="flex-1" />
        </aside>
      ) : (
        <aside className="w-[260px] shrink-0 nx-glass-panel relative z-[1] flex flex-col h-full max-[820px]:hidden">
          {renderPanel('column')}
        </aside>
      )}

      {/* Mobile (≤820px): a mesma lista como drawer à esquerda. */}
      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetContent
          side="left"
          aria-describedby={undefined}
          className="w-[min(300px,86vw)] p-0 flex flex-col gap-0"
        >
          <SheetTitle className="sr-only">Conversas</SheetTitle>
          {renderPanel('drawer')}
        </SheetContent>
      </Sheet>
    </TooltipProvider>
  );
}

// ------------------------------------------------------------------
// Corpo do painel (cabeçalho, ações, busca, pastas, lista). Sem estado
// próprio: tudo vem do Sidebar, pra coluna e drawer ficarem em sincronia.
// ------------------------------------------------------------------

interface DateGroup {
  label: string;
  items: Conversation[];
}

interface SidebarPanelProps {
  variant: 'column' | 'drawer';
  folders: ChatFolder[];
  activeFolderId: string | null;
  selectedId: string | null;
  search: string;
  onSearchChange: (v: string) => void;
  searching: boolean;
  searchGroups: DateGroup[];
  byFolder: Map<string, Conversation[]>;
  rootGroups: DateGroup[];
  collapsedFolders: string[];
  onToggleFolderCollapse: (id: string) => void;
  creatingFolder: boolean;
  onToggleCreatingFolder: () => void;
  newFolderName: string;
  onNewFolderNameChange: (v: string) => void;
  onCommitCreateFolder: () => void;
  onCancelCreateFolder: () => void;
  renamingFolderId: string | null;
  folderRenameValue: string;
  onStartRenameFolder: (f: ChatFolder) => void;
  onFolderRenameValueChange: (v: string) => void;
  onCommitRenameFolder: (id: string) => void;
  onCancelRenameFolder: () => void;
  renamingId: string | null;
  renameValue: string;
  onStartRename: (c: Conversation) => void;
  onRenameValueChange: (v: string) => void;
  onCommitRename: (id: string) => void;
  onCancelRename: () => void;
  onToggleCollapsed: () => void;
  onSelect: (id: string | null) => void;
  onSelectFolder: (id: string | null) => void;
  onNew: () => void;
  onTogglePin: (id: string) => void;
  onExport: (id: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, folderId: string | null) => void;
  onDeleteFolder: (id: string) => void;
  showKnowledge: boolean;
  onOpenKnowledge: () => void;
}

function SidebarPanel({
  variant,
  folders,
  activeFolderId,
  selectedId,
  search,
  onSearchChange,
  searching,
  searchGroups,
  byFolder,
  rootGroups,
  collapsedFolders,
  onToggleFolderCollapse,
  creatingFolder,
  onToggleCreatingFolder,
  newFolderName,
  onNewFolderNameChange,
  onCommitCreateFolder,
  onCancelCreateFolder,
  renamingFolderId,
  folderRenameValue,
  onStartRenameFolder,
  onFolderRenameValueChange,
  onCommitRenameFolder,
  onCancelRenameFolder,
  renamingId,
  renameValue,
  onStartRename,
  onRenameValueChange,
  onCommitRename,
  onCancelRename,
  onToggleCollapsed,
  onSelect,
  onSelectFolder,
  onNew,
  onTogglePin,
  onExport,
  onDelete,
  onMove,
  onDeleteFolder,
  showKnowledge,
  onOpenKnowledge,
}: SidebarPanelProps) {
  const isDrawer = variant === 'drawer';

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
        onStartRename={() => onStartRename(c)}
        onChangeRename={onRenameValueChange}
        onCommitRename={() => onCommitRename(c.id)}
        onCancelRename={onCancelRename}
        onTogglePin={() => onTogglePin(c.id)}
        onExport={() => onExport(c.id)}
        onDelete={() => onDelete(c.id)}
        onMove={(folderId) => onMove(c.id, folderId)}
      />
    );
  }

  function renderDateGroups(groups: DateGroup[]) {
    return groups.map((g) => (
      <div key={g.label} className="mb-3">
        <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">{g.label}</div>
        <div className="space-y-0.5">{g.items.map((c) => renderConvItem(c))}</div>
      </div>
    ));
  }

  return (
    <>
      {/* Cabeçalho */}
      <div className={cn('p-3 border-b border-border flex items-center gap-2', isDrawer && 'pr-12')}>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-8 h-8 rounded-md bg-secondary text-ring grid place-items-center shrink-0">
            <NsIcon name="ns-insights" />
          </div>
          <span className="font-semibold text-sm truncate">Análise IA</span>
        </div>
        {/* No drawer o fechar é o X do próprio Sheet; recolher é só desktop. */}
        {!isDrawer && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggleCollapsed}
                aria-label="Recolher conversas"
                className="text-muted-foreground hover:text-foreground"
              >
                <NsIcon name="panel-left-close" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Recolher conversas</TooltipContent>
          </Tooltip>
        )}
      </div>

      <div className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onNew} className={cn('flex-1 justify-start min-w-0', TOUCH_TEXT)}>
            <NsIcon name="plus" />
            <span className="truncate">Nova conversa</span>
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={onToggleCreatingFolder}
                aria-label="Nova pasta"
                aria-expanded={creatingFolder}
                className={cn('shrink-0', TOUCH_ICON)}
              >
                <NsIcon name="folder-plus" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Nova pasta</TooltipContent>
          </Tooltip>
        </div>
        {creatingFolder && (
          <div className="flex items-center gap-1.5">
            <Input
              autoFocus
              placeholder="Nome da pasta"
              value={newFolderName}
              onChange={(e) => onNewFolderNameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onCommitCreateFolder();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  onCancelCreateFolder();
                }
              }}
              className={cn(
                'h-9 flex-1 bg-card text-sm shadow-none focus-visible:ring-1 focus-visible:border-ring',
                TOUCH_TEXT,
              )}
              aria-label="Nome da nova pasta"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={onCommitCreateFolder}
              disabled={!newFolderName.trim()}
              aria-label="Criar pasta"
              className={cn('shrink-0', TOUCH_ICON)}
            >
              <NsIcon name="check" />
            </Button>
          </div>
        )}
        {showKnowledge && (
          <Button
            variant="ghost"
            onClick={onOpenKnowledge}
            className={cn('w-full justify-start text-muted-foreground hover:text-foreground', TOUCH_TEXT)}
          >
            <NsIcon name="book-open" /> Base de conhecimento
          </Button>
        )}
        <div className="relative">
          <NsIcon
            name="search"
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <Input
            // Alvo do ⌘K do ChatShell (querySelector pega o primeiro): só a
            // coluna; no drawer o campo já está à vista.
            data-chat-search=""
            placeholder="Buscar conversas"
            aria-label="Buscar conversas"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className={cn(
              'h-9 bg-card pl-9 text-sm shadow-none focus-visible:ring-1 focus-visible:border-ring',
              search && 'pr-9',
              TOUCH_TEXT,
            )}
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="Limpar busca"
              title="Limpar busca"
              className="absolute right-1 top-1/2 -translate-y-1/2 grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <NsIcon name="x" size={14} />
            </button>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1 px-2">
        {searching ? (
          // ---- Modo busca: lista chapada, agrupada por data ----
          <>
            {searchGroups.length === 0 && (
              <div className="text-sm text-muted-foreground px-3 py-6 text-center leading-relaxed">
                Nenhuma conversa encontrada.
              </div>
            )}
            {renderDateGroups(searchGroups)}
          </>
        ) : (
          <>
            {/* ---- Pastas ---- */}
            {folders.map((f) => (
              <FolderItem
                key={f.id}
                folder={f}
                convs={byFolder.get(f.id) ?? []}
                collapsed={collapsedFolders.includes(f.id)}
                active={activeFolderId === f.id}
                renaming={renamingFolderId === f.id}
                renameValue={folderRenameValue}
                onOpen={() => {
                  onSelectFolder(f.id);
                  onToggleFolderCollapse(f.id);
                }}
                onStartRename={() => onStartRenameFolder(f)}
                onChangeRename={onFolderRenameValueChange}
                onCommitRename={() => onCommitRenameFolder(f.id)}
                onCancelRename={onCancelRenameFolder}
                onDelete={() => onDeleteFolder(f.id)}
                renderConvItem={renderConvItem}
              />
            ))}

            {/* ---- Raiz (sem pasta) — sempre visível ---- */}
            <button
              type="button"
              onClick={() => onSelectFolder(null)}
              title="Novas conversas sem pasta ativa nascem aqui na raiz"
              className="flex w-full items-center gap-1.5 px-3 min-h-9 mt-1 rounded-md text-left select-none transition-colors hover:bg-accent"
            >
              <span className="text-xs font-medium text-muted-foreground">Conversas</span>
            </button>
            {rootGroups.length === 0 && (
              <div className="text-sm text-muted-foreground px-3 py-6 text-center leading-relaxed">
                Nenhuma conversa ainda. Faça uma pergunta pra começar.
              </div>
            )}
            {renderDateGroups(rootGroups)}
          </>
        )}
      </ScrollArea>
    </>
  );
}

// ------------------------------------------------------------------
// Pasta: cabeçalho clicável (abre/fecha e vira a pasta ativa) + menu.
// ------------------------------------------------------------------

interface FolderItemProps {
  folder: ChatFolder;
  convs: Conversation[];
  collapsed: boolean;
  active: boolean;
  renaming: boolean;
  renameValue: string;
  onOpen: () => void;
  onStartRename: () => void;
  onChangeRename: (v: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onDelete: () => void;
  renderConvItem: (c: Conversation) => React.ReactNode;
}

function FolderItem({
  folder: f,
  convs,
  collapsed,
  active,
  renaming,
  renameValue,
  onOpen,
  onStartRename,
  onChangeRename,
  onCommitRename,
  onCancelRename,
  onDelete,
  renderConvItem,
}: FolderItemProps) {
  // "Renomear" sai de um menu Radix que, ao fechar, devolve o foco pro
  // gatilho — isso tiraria o foco do campo recém-aberto (blur = commit sem
  // mudança). O foco vai pro campo no onCloseAutoFocus, no lugar do gatilho.
  const focusRenameOnClose = React.useRef(false);
  const renameInputRef = React.useRef<HTMLInputElement>(null);

  return (
    <div className="mb-1.5">
      <div
        className={cn(
          'group flex items-center gap-1 rounded-md pr-0.5 transition-colors',
          active ? 'bg-accent border-l-2 border-ring' : 'hover:bg-accent',
        )}
      >
        {renaming ? (
          <div className={cn('flex flex-1 min-w-0 items-center gap-1.5 min-h-9 pr-1', active ? 'pl-[6px]' : 'pl-2', TOUCH_TEXT)}>
            <FolderGlyph collapsed={collapsed} active={active} />
            <input
              ref={renameInputRef}
              value={renameValue}
              onChange={(e) => onChangeRename(e.target.value)}
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
              className={cn(INLINE_EDIT, 'flex-1 text-xs font-medium')}
              aria-label={`Renomear pasta "${f.name}"`}
            />
            <FolderCount n={convs.length} />
          </div>
        ) : (
          <button
            type="button"
            onClick={onOpen}
            aria-expanded={!collapsed}
            title={active ? 'Pasta ativa — novas conversas nascem aqui' : 'Abrir pasta (novas conversas nascem na pasta ativa)'}
            className={cn(
              'flex flex-1 min-w-0 items-center gap-1.5 min-h-9 pr-1 rounded-md text-left select-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              active ? 'pl-[6px]' : 'pl-2',
              TOUCH_TEXT,
            )}
          >
            <FolderGlyph collapsed={collapsed} active={active} />
            <span className={cn('flex-1 min-w-0 truncate text-xs font-medium', active && 'text-ring font-semibold')}>
              {f.name}
            </span>
            <FolderCount n={convs.length} />
          </button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'shrink-0 text-muted-foreground hover:text-foreground',
                // Some sem hover; aparece no hover/foco, com o menu aberto e
                // sempre em toque (não existe hover no dedo).
                'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(pointer:coarse)]:opacity-100',
                TOUCH_ICON,
              )}
              aria-label={`Opções da pasta "${f.name}"`}
              title="Opções da pasta"
            >
              <NsIcon name="more-horizontal" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={(e) => {
              if (!focusRenameOnClose.current) return;
              focusRenameOnClose.current = false;
              e.preventDefault();
              renameInputRef.current?.focus();
              renameInputRef.current?.select();
            }}
          >
            <DropdownMenuItem
              onSelect={() => {
                focusRenameOnClose.current = true;
                onStartRename();
              }}
            >
              <NsIcon name="edit" /> Renomear
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive">
              <NsIcon name="trash" /> Excluir pasta
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {!collapsed && (
        <div className="space-y-0.5 mt-0.5 ml-3 border-l border-border pl-1.5">
          {convs.length === 0 ? (
            <div className="text-xs text-muted-foreground px-2 py-2 leading-relaxed">
              Pasta vazia — mova conversas pra cá ou crie uma nova com ela ativa.
            </div>
          ) : (
            convs.map((c) => renderConvItem(c))
          )}
        </div>
      )}
    </div>
  );
}

function FolderCount({ n }: { n: number }) {
  return (
    <span className="text-xs font-mono text-muted-foreground shrink-0 tabular-nums">
      {n}
      <span className="sr-only"> {n === 1 ? 'conversa' : 'conversas'}</span>
    </span>
  );
}

function FolderGlyph({ collapsed, active }: { collapsed: boolean; active: boolean }) {
  return (
    <>
      <NsIcon
        name="chevron-right"
        size={14}
        className={cn('shrink-0 text-muted-foreground transition-transform', !collapsed && 'rotate-90')}
      />
      <NsIcon name="folder" size={14} className={cn('shrink-0', active ? 'text-ring' : 'text-muted-foreground')} />
    </>
  );
}

// ------------------------------------------------------------------
// Conversa: título/metadados (botão que seleciona) + lixeira + menu.
// ------------------------------------------------------------------

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
  // Mesmo motivo do FolderItem: o foco do menu que fecha iria pro gatilho.
  const focusRenameOnClose = React.useRef(false);
  const renameInputRef = React.useRef<HTMLInputElement>(null);
  const title = conv.title || 'Sem título';
  const pad = selected ? 'pl-[10px]' : 'pl-3';

  const meta = (
    <div className="text-xs text-muted-foreground font-mono tabular-nums mt-0.5 truncate">
      {conv.messageCount} msg · {relativeTime(conv.updatedAt)}
    </div>
  );

  return (
    <div
      className={cn(
        'group flex items-center gap-1 rounded-md pr-1 transition-colors',
        selected ? 'bg-accent border-l-2 border-ring' : 'hover:bg-accent',
      )}
    >
      {renaming ? (
        <div className={cn('flex-1 min-w-0 overflow-hidden py-2', pad)}>
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => onChangeRename(e.target.value)}
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
            className={INLINE_EDIT}
            aria-label={`Renomear conversa "${title}"`}
          />
          {meta}
        </div>
      ) : (
        <button
          type="button"
          onClick={onSelect}
          aria-current={selected ? 'true' : undefined}
          className={cn(
            'flex-1 min-w-0 overflow-hidden py-2 rounded-md text-left',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
            pad,
          )}
        >
          {/* Flex com min-w-0 + filho truncate flex-1 min-w-0 — necessário pra
              truncar em flex containers (truncate puro no flex parent não corta
              o filho span, ele cresce além do container e some na borda). */}
          <div className="h-5 text-[13px] leading-5 flex items-center gap-1 min-w-0">
            {conv.pinned && <NsIcon name="pin" size={12} className="shrink-0 text-ring" label="Fixada" />}
            <span
              className={cn(
                'truncate flex-1 min-w-0 block',
                selected && 'font-medium',
                !conv.title && 'text-muted-foreground',
              )}
            >
              {title}
            </span>
          </div>
          {meta}
        </button>
      )}
      <div className="flex items-center gap-0.5 shrink-0">
        {/* Lixeira SEMPRE visível — delete é a ação mais pedida e estava
            escondida dentro do dropdown. Click direto + confirm no handler. */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onDelete}
          className={cn('shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10', TOUCH_ICON)}
          aria-label={`Excluir conversa "${title}"`}
          title="Excluir conversa"
        >
          <NsIcon name="trash" />
        </Button>
        {/* Demais ações (renomear, mover, fixar, exportar) no menu. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn('shrink-0 text-muted-foreground hover:text-foreground hover:bg-accent', TOUCH_ICON)}
              aria-label={`Mais opções da conversa "${title}" (renomear, mover, fixar, exportar)`}
              title="Mais opções"
            >
              <NsIcon name="more-horizontal" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={(e) => {
              if (!focusRenameOnClose.current) return;
              focusRenameOnClose.current = false;
              e.preventDefault();
              renameInputRef.current?.focus();
              renameInputRef.current?.select();
            }}
          >
            <DropdownMenuItem
              onSelect={() => {
                focusRenameOnClose.current = true;
                onStartRename();
              }}
            >
              <NsIcon name="edit" /> Renomear
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <NsIcon name="folder-input" /> Mover pra…
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem disabled={conv.folderId == null} onSelect={() => onMove(null)}>
                  {conv.folderId == null ? <NsIcon name="check" /> : <span className="w-4 shrink-0" aria-hidden />}
                  Sem pasta
                </DropdownMenuItem>
                {folders.length > 0 && <DropdownMenuSeparator />}
                {folders.map((f) => (
                  <DropdownMenuItem key={f.id} disabled={conv.folderId === f.id} onSelect={() => onMove(f.id)}>
                    <NsIcon name={conv.folderId === f.id ? 'check' : 'folder'} />
                    <span className="truncate max-w-[160px]">{f.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onSelect={onTogglePin}>
              {conv.pinned ? (
                <>
                  <NsIcon name="pin-off" /> Desafixar
                </>
              ) : (
                <>
                  <NsIcon name="pin" /> Fixar
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onExport}>
              <NsIcon name="download" /> Exportar
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive">
              <NsIcon name="trash" /> Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
