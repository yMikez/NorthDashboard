'use client';

// Topo do /chat = Topbar da SPA (public/src/shell.jsx: Topbar + ThemeToggle)
// com as mesmas classes de dashboard.css (.top, .top-title, .top-crumb,
// .top-h1, .top-actions, .theme-toggle, .btn.btn-ghost, .icon-btn), seguido
// da barra de filtros (FilterChips = FilterBar da SPA).
//
// Específico do chat:
// - título = conversa, com clique pra renomear;
// - botão "Conversas" (só ≤820px) abre a lista de conversas em drawer;
// - ações: Atualizar (lista de conversas; mostra "Respondendo…" enquanto a
//   IA responde), Exportar (JSON) e Copiar link;
// - a linha fica sempre em uma linha só: o título encolhe com reticências e
//   os rótulos dos botões somem quando o PRÓPRIO topo fica estreito
//   (container query), não só ≤820px — aqui a nav (232px) e a lista de
//   conversas (260px) dividem a tela com ele.

import * as React from 'react';
import { NsIcon, type NsIconName } from './NsIcon';
import { FilterChips } from './FilterChips';
import type { FilterState } from '@/types/chat';

export type SyncStatus = 'live' | 'stale' | 'syncing' | 'error';
export type ThemeMode = 'dark' | 'light';

interface TopBarProps {
  title: string | null;
  onRenameTitle: (next: string) => void;
  filters: FilterState;
  onChangeFilters: (next: FilterState) => void;
  /** 'syncing' = a IA está respondendo (não é sync de dados). */
  syncStatus: SyncStatus;
  syncLabel?: string;
  /** Recarrega a lista de conversas. */
  onRefresh: () => void;
  /** Há conversa selecionada. */
  canExport: boolean;
  onExport: () => void;
  /** Copia /chat?c=<id>&filtros; resolve true se deu certo. */
  onCopyLink: () => Promise<boolean>;
  /** Mantido no contrato; o ícone do toggle segue o data-theme via CSS. */
  theme: ThemeMode;
  onToggleTheme: () => void;
  /** Abre a nav esquerda como drawer (≤820px). */
  onMenu?: () => void;
  /** Abre a lista de conversas como drawer (≤820px). */
  onOpenConversations?: () => void;
}

type CopyState = 'idle' | 'ok' | 'fail';

// Rótulo de botão: some ≤820px (.hide-mobile, contrato da SPA) e quando o
// topo tem menos de 760px (container query no <header>).
const BTN_LABEL = 'hide-mobile [@container_(max-width:759px)]:hidden';

const SYNC: Record<SyncStatus, { label: string; icon: NsIconName; dot?: string; color?: string }> = {
  live: { label: 'Atualizar', icon: 'refresh' },
  stale: { label: 'Atualizar', icon: 'refresh', dot: 'var(--warning)' },
  syncing: { label: 'Respondendo…', icon: 'loader' },
  error: { label: 'Falha ao sincronizar', icon: 'refresh', dot: 'var(--danger)', color: 'var(--danger)' },
};

export function TopBar({
  title,
  onRenameTitle,
  filters,
  onChangeFilters,
  syncStatus,
  syncLabel,
  onRefresh,
  canExport,
  onExport,
  onCopyLink,
  onToggleTheme,
  onMenu,
  onOpenConversations,
}: TopBarProps) {
  const [renaming, setRenaming] = React.useState(false);
  const [draft, setDraft] = React.useState(title ?? '');
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  // Enter/Esc já resolveram: o blur que vem com a desmontagem não commita de novo.
  const settledRef = React.useRef(false);

  const [copy, setCopy] = React.useState<CopyState>('idle');
  const copyTimer = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (renaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renaming]);

  React.useEffect(() => {
    setDraft(title ?? '');
  }, [title]);

  React.useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  function startRename() {
    settledRef.current = false;
    setDraft(title ?? '');
    setRenaming(true);
  }

  function commit() {
    if (settledRef.current) return;
    settledRef.current = true;
    const next = draft.trim();
    if (next && next !== title) onRenameTitle(next);
    setRenaming(false);
  }

  function cancel() {
    settledRef.current = true;
    setDraft(title ?? '');
    setRenaming(false);
  }

  async function handleCopy() {
    let ok = false;
    try {
      ok = await onCopyLink();
    } catch {
      ok = false;
    }
    setCopy(ok ? 'ok' : 'fail');
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopy('idle'), ok ? 2000 : 3000);
  }

  const shownTitle = title || 'Nova conversa';
  const sync = SYNC[syncStatus];
  const syncText = syncLabel ?? sync.label;
  // Nome acessível contém o rótulo visível (WCAG 2.5.3) e continua valendo
  // quando o rótulo some no estreito.
  const refreshName = syncLabel
    ? `${syncLabel} — atualizar lista de conversas`
    : syncStatus === 'live'
      ? 'Atualizar lista de conversas'
      : syncStatus === 'stale'
        ? 'Atualizar lista de conversas (desatualizada)'
        : `${sync.label} — atualizar lista de conversas`;
  const copyText = copy === 'ok' ? 'Link copiado' : copy === 'fail' ? 'Não foi possível copiar' : 'Copiar link';
  const liveText =
    copy === 'ok'
      ? 'Link copiado'
      : copy === 'fail'
        ? 'Não foi possível copiar'
        : syncStatus === 'error'
          ? 'Falha ao sincronizar'
          : '';

  let titleNode: React.ReactNode;
  if (renaming) {
    titleNode = (
      <input
        ref={inputRef}
        value={draft}
        aria-label="Título da conversa"
        size={Math.min(Math.max(draft.length + 1, 12), 60)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            cancel();
          }
        }}
        // Mesma fonte/altura do título; sublinhado em --ring (2px no foco:
        // borda 1px + sombra interna 1px, sem mudar a altura).
        className="m-0 block min-w-0 max-w-full rounded-none border-0 border-b border-ring bg-transparent p-0 text-inherit outline-none [font:inherit] [letter-spacing:inherit] shadow-[inset_0_-1px_0_hsl(var(--ring))]"
      />
    );
  } else if (canExport) {
    titleNode = (
      <button
        type="button"
        onClick={startRename}
        title="Clique pra renomear"
        className="group flex w-fit min-w-0 max-w-full items-center gap-2 border-0 border-b border-transparent p-0 text-left transition-colors hover:border-[color:var(--border-strong)] focus-visible:[outline-offset:-2px]"
      >
        <span className="truncate">{shownTitle}</span>
        <NsIcon
          name="edit"
          size={14}
          className="shrink-0 text-[color:var(--fg4)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      </button>
    );
  } else {
    // Sem conversa selecionada não há o que renomear.
    titleNode = <span className="block truncate border-b border-transparent">{shownTitle}</span>;
  }

  return (
    <>
      <header
        className="top text-sm leading-[1.5714] text-[color:var(--fg3)] [container-type:inline-size]"
        style={{ flexWrap: 'nowrap' }}
      >
        {/* Hambúrguer do drawer — mesmo .top-menu-btn da SPA: o CSS de
            dashboard.css o esconde acima de 820px. */}
        {onMenu && (
          <button type="button" className="top-menu-btn" onClick={onMenu} aria-label="Abrir menu">
            <svg
              width={18}
              height={18}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 6h18" />
              <path d="M3 12h18" />
              <path d="M3 18h18" />
            </svg>
          </button>
        )}
        {/* Lista de conversas em drawer — só ≤820px. !important porque o
            display:grid do .icon-btn (dashboard.css, carregado depois) empata
            e venceria o utilitário; 44px = mesmo alvo do hambúrguer. */}
        {onOpenConversations && (
          <button
            type="button"
            className="icon-btn shrink-0 !h-11 !w-11 min-[821px]:!hidden"
            onClick={onOpenConversations}
            aria-label="Abrir conversas"
            title="Conversas"
          >
            <NsIcon name="panel-left" size={16} />
          </button>
        )}

        <div className="top-title" style={{ minWidth: 0, flex: '0 1 auto' }}>
          <div className="top-crumb">
            <span>IA</span>
            <span className="sep">/</span>
            <span className="cur">Análise (IA)</span>
          </div>
          <h1 className="top-h1" style={{ fontSize: 25 }}>
            {titleNode}
          </h1>
        </div>

        <div className="top-spacer" />

        <div className="top-actions" style={{ flexShrink: 0 }}>
          {/* Toggle da SPA: o knob mostra o tema ATUAL. Os dois ícones vão no
              HTML e o CSS (.ns-only-*) mostra o certo pelo data-theme — SSR e
              cliente geram a mesma marcação. */}
          <button
            type="button"
            className="theme-toggle"
            onClick={onToggleTheme}
            title="Alternar tema"
            aria-label="Alternar tema"
          >
            <span className="knob" aria-hidden="true">
              <NsIcon name="moon" size={12} className="ns-only-dark" />
              <NsIcon name="sun" size={12} className="ns-only-light" />
            </span>
          </button>

          <button
            type="button"
            className="btn btn-ghost"
            onClick={onRefresh}
            title="Atualizar lista de conversas"
            aria-label={refreshName}
          >
            <NsIcon
              name={sync.icon}
              size={13}
              className={syncStatus === 'syncing' ? 'motion-safe:animate-spin' : undefined}
            />
            {sync.dot && (
              <span
                aria-hidden="true"
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ background: sync.dot }}
              />
            )}
            <span className={BTN_LABEL} style={sync.color ? { color: sync.color } : undefined}>
              {syncText}
            </span>
          </button>

          <button
            type="button"
            className="btn btn-ghost"
            onClick={onExport}
            disabled={!canExport}
            title={canExport ? 'Exportar conversa (JSON)' : 'Abra uma conversa pra exportar'}
            aria-label="Exportar"
          >
            <NsIcon name="download" size={13} />
            <span className={BTN_LABEL}>Exportar</span>
          </button>

          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void handleCopy()}
            disabled={!canExport}
            title={canExport ? 'Copiar link desta conversa com os filtros' : 'Abra uma conversa pra copiar o link'}
            aria-label={copyText}
          >
            <NsIcon
              name={copy === 'ok' ? 'check' : copy === 'fail' ? 'alert-triangle' : 'link'}
              size={13}
              className={
                copy === 'ok'
                  ? 'text-[color:var(--success)]'
                  : copy === 'fail'
                    ? 'text-[color:var(--danger)]'
                    : undefined
              }
            />
            <span
              className={BTN_LABEL}
              style={copy === 'fail' ? { color: 'var(--danger)' } : undefined}
            >
              {copyText}
            </span>
          </button>
        </div>

        {/* Anúncio sem mover o foco (DS1 §9): cópia do link e falha de sync. */}
        <span className="sr-only" role="status" aria-live="polite">
          {liveText}
        </span>
      </header>

      <FilterChips filters={filters} onChange={onChangeFilters} />
    </>
  );
}
