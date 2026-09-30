// Peças de UI compartilhadas pelas abas do painel admin da IA
// (KnowledgeSheet). Seguem o DS1 (DESIGN-SYSTEM.md): controle 36 px (44 px em
// toque), foco visível de 2 px, estados de leitura vazio · carregando ·
// parcial · falha com as classes .ns-readstate da SPA, paginação com as
// classes .ns-pager (dashboard.css já é carregado pela layout do chat).

'use client';

import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/ui-utils';
import { NsIcon, type NsIconName } from '../NsIcon';
import { adminFetch, errorText, isAbortError } from './adminApi';
import { PAGE_SIZES, fmtInt, listChangedEnough, pageWindow, type Tone } from './adminCore';

// DS1: controle 36 px, 44 px em toque (botão de ícone: 40 px, como a SPA).
export const TOUCH_TEXT = '[@media(pointer:coarse)]:min-h-11';
export const TOUCH_ICON = '[@media(pointer:coarse)]:min-h-10 [@media(pointer:coarse)]:min-w-10';
// Campo do DS1: superfície, limite de controle (--input = border-strong) e
// foco de 2 px (1 px de borda no acento + 1 px de anel).
export const FIELD = 'bg-card text-sm shadow-none focus-visible:ring-1 focus-visible:border-ring';
const SELECT =
  'h-9 rounded-md border border-input bg-card px-2.5 text-sm text-foreground ' +
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-ring ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

// ── Estados de leitura ────────────────────────────────────────────────────

type ReadKind = 'vazio' | 'carregando' | 'parcial' | 'falha';
const READ_ICON: Record<ReadKind, NsIconName> = {
  vazio: 'info',
  carregando: 'loader',
  parcial: 'alert-triangle',
  falha: 'alert-triangle',
};

export function ReadState({
  kind,
  title,
  children,
  action,
  onAction,
  id,
}: {
  kind: ReadKind;
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: string;
  onAction?: () => void;
  id?: string;
}) {
  return (
    <div id={id} className={`ns-readstate is-${kind}`} role={kind === 'falha' ? 'alert' : 'status'}>
      <NsIcon
        name={READ_ICON[kind]}
        className={kind === 'carregando' ? 'motion-safe:animate-spin' : undefined}
      />
      <div className="min-w-0 flex-1">
        {title && <strong className="block">{title}</strong>}
        {children && <div className="ns-readstate-body break-words">{children}</div>}
      </div>
      {action && onAction && (
        <button type="button" className="btn btn-ghost shrink-0" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}

/** Carregando / falha / vazio de uma lista num lugar só. */
export function ListStates({
  status,
  error,
  empty,
  emptyTitle,
  emptyBody,
  onRetry,
}: {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  empty: boolean;
  emptyTitle: string;
  emptyBody?: React.ReactNode;
  onRetry: () => void;
}) {
  if (status === 'loading') return <ReadState kind="carregando">Carregando…</ReadState>;
  if (status === 'error' && error) {
    return (
      <ReadState kind="falha" title="Não foi possível carregar" action="Tentar de novo" onAction={onRetry}>
        {error}
      </ReadState>
    );
  }
  if (empty) return <ReadState kind="vazio" title={emptyTitle}>{emptyBody}</ReadState>;
  return null;
}

// ── Aviso de ação (sucesso anunciado sem mover o foco; erro como alerta) ──

export interface Flash {
  tone: 'ok' | 'error';
  text: string;
}

export function useFlash(ttlMs = 6000): [Flash | null, (f: Flash | null) => void] {
  const [flash, setFlash] = React.useState<Flash | null>(null);
  React.useEffect(() => {
    // Erro fica até a próxima ação; sucesso some sozinho.
    if (!flash || flash.tone === 'error') return;
    const t = setTimeout(() => setFlash(null), ttlMs);
    return () => clearTimeout(t);
  }, [flash, ttlMs]);
  return [flash, setFlash];
}

export function FlashMessage({ flash, onDismiss }: { flash: Flash | null; onDismiss: () => void }) {
  return (
    // A região viva existe sempre (leitor de tela só anuncia mudança dentro
    // de uma região já montada).
    <div aria-live="polite" className="empty:hidden">
      {flash &&
        (flash.tone === 'error' ? (
          <ReadState kind="falha" action="Fechar" onAction={onDismiss}>
            {flash.text}
          </ReadState>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-[13px] leading-5 text-success">
            <NsIcon name="check" className="shrink-0" />
            <span className="min-w-0 flex-1">{flash.text}</span>
          </div>
        ))}
    </div>
  );
}

// ── Recurso remoto (GET) com recarga e acompanhamento ─────────────────────

interface ResourceState<T> {
  url: string | null;
  status: 'loading' | 'ready' | 'error';
  data: T | null;
  error: string | null;
  refreshing: boolean;
}

export interface Resource<T> extends ResourceState<T> {
  reload: () => void;
  /** Atualização local otimista (depois de um PATCH que já devolveu o item). */
  mutate: (fn: (data: T) => T) => void;
}

/**
 * GET de uma rota admin. Trocar a URL (filtro) limpa a lista; recarregar a
 * mesma URL mantém os dados na tela (refreshing). `pollWhile` acompanha
 * trabalho em andamento (indexação, avaliação rodando) só enquanto a aba
 * está visível (`active`) — aba escondida não gasta requisição.
 */
export function useAdminResource<T>(
  url: string | null,
  opts: { pollMs?: number; pollWhile?: (data: T) => boolean; active?: boolean } = {},
): Resource<T> {
  const { pollMs, active = true } = opts;
  // Predicado em ref: a função inline do chamador muda a cada render e não
  // deve reiniciar o timer do acompanhamento.
  const pollWhile = React.useRef(opts.pollWhile);
  React.useEffect(() => {
    pollWhile.current = opts.pollWhile;
  });
  const [state, setState] = React.useState<ResourceState<T>>({
    url,
    status: 'loading',
    data: null,
    error: null,
    refreshing: false,
  });
  const [nonce, setNonce] = React.useState(0);
  const reload = React.useCallback(() => setNonce((n) => n + 1), []);
  const mutate = React.useCallback(
    (fn: (data: T) => T) => setState((s) => (s.data == null ? s : { ...s, data: fn(s.data) })),
    [],
  );

  React.useEffect(() => {
    if (!url) return;
    const ctrl = new AbortController();
    setState((s) =>
      s.url === url && s.data != null
        ? { ...s, refreshing: true }
        : { url, status: 'loading', data: null, error: null, refreshing: false },
    );
    adminFetch<T>(url, { signal: ctrl.signal })
      .then((data) => setState({ url, status: 'ready', data, error: null, refreshing: false }))
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        setState((s) => ({
          url,
          status: 'error',
          data: s.url === url ? s.data : null,
          error: errorText(err),
          refreshing: false,
        }));
      });
    return () => ctrl.abort();
  }, [url, nonce]);

  // Aba que volta a ficar visível recarrega (mantendo a lista na tela): o
  // que mudou em outra aba — memória aprovada virando documento, entrada
  // fixada — aparece sem fechar o painel.
  const wasActive = React.useRef(active);
  React.useEffect(() => {
    if (active && !wasActive.current) reload();
    wasActive.current = active;
  }, [active, reload]);

  const { data, status, refreshing } = state;
  React.useEffect(() => {
    if (!active || !pollMs || status !== 'ready' || refreshing || data == null) return;
    if (!pollWhile.current?.(data)) return;
    const t = setTimeout(reload, pollMs);
    return () => clearTimeout(t);
  }, [active, pollMs, status, refreshing, data, reload]);

  // Enquanto a URL nova não respondeu, a tela não mostra a lista da antiga.
  const current: ResourceState<T> =
    state.url === url ? state : { url, status: 'loading', data: null, error: null, refreshing: false };
  return { ...current, reload, mutate };
}

// ── Paginação (10/25/50, lembrada por usuário — mesma chave da SPA) ───────

const PAGE_SIZE_KEY = 'ns-page-size';

function readPageSize(fallback: number): number {
  try {
    const v = Number(localStorage.getItem(PAGE_SIZE_KEY));
    return (PAGE_SIZES as readonly number[]).includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function savePageSize(v: number): void {
  try {
    localStorage.setItem(PAGE_SIZE_KEY, String(v));
  } catch {
    /* armazenamento bloqueado: o tamanho vale só nesta sessão */
  }
}

export function Pager({
  page,
  pageSize,
  total,
  label,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  label: string;
  onPageChange: (p: number) => void;
  onPageSizeChange: (n: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const go = (p: number) => {
    if (p !== page && p >= 1 && p <= totalPages) onPageChange(p);
  };
  return (
    <nav className="ns-pager -mx-px" aria-label="Paginação">
      <div className="ns-pager-summary" aria-live="polite">
        Mostrando <strong>{fmtInt(from)}–{fmtInt(to)}</strong> de <strong>{fmtInt(total)}</strong> {label}
      </div>
      <label className="ns-pager-size">
        <span>Por página</span>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className={SELECT}
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <div className="ns-pager-nav">
        <button
          type="button"
          className="ns-pager-btn"
          onClick={() => go(page - 1)}
          disabled={page <= 1}
          aria-label="Página anterior"
          title="Página anterior"
        >
          <NsIcon name="chevron-left" />
        </button>
        {pageWindow(page, totalPages).map((p) =>
          typeof p === 'number' ? (
            <button
              type="button"
              key={p}
              className="ns-pager-btn"
              onClick={() => go(p)}
              aria-current={p === page ? 'page' : undefined}
              aria-label={`Página ${p}`}
            >
              {p}
            </button>
          ) : (
            <span key={p} className="ns-pager-gap" aria-hidden="true">
              …
            </span>
          ),
        )}
        <button
          type="button"
          className="ns-pager-btn"
          onClick={() => go(page + 1)}
          disabled={page >= totalPages}
          aria-label="Próxima página"
          title="Próxima página"
        >
          <NsIcon name="chevron-right" />
        </button>
      </div>
    </nav>
  );
}

/**
 * Paginação no cliente. Volta à página 1 quando `resetKey` muda (filtro) ou
 * quando a lista vira outra; fica na página quando só sai um punhado de
 * itens (fila que encolhe a cada ação). Até `minToShow` itens não pagina.
 */
export function usePaged<T>(
  items: readonly T[],
  opts: { keyOf: (item: T) => string; label: string; resetKey?: string; minToShow?: number },
): { pageItems: readonly T[]; pager: React.ReactNode; start: number } {
  const { keyOf, label, resetKey, minToShow = 10 } = opts;
  // Leitura direta do localStorage: o painel só monta no cliente (sheet
  // aberto por clique), sem risco de divergir da hidratação.
  const [pageSize, setPageSize] = React.useState(() => readPageSize(10));
  const [page, setPage] = React.useState(1);

  const keys = React.useMemo(() => items.map(keyOf), [items, keyOf]);
  const prev = React.useRef({ keys, resetKey });
  React.useEffect(() => {
    const p = prev.current;
    if (p.keys === keys && p.resetKey === resetKey) return;
    // Lista vazia no meio de um recarregamento não conta.
    if (p.resetKey === resetKey && keys.length === 0) return;
    const reset = p.resetKey !== resetKey || listChangedEnough(p.keys, keys);
    prev.current = { keys, resetKey };
    if (reset) setPage(1);
  }, [keys, resetKey]);

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  React.useEffect(() => {
    if (total > 0 && page > totalPages) setPage(totalPages);
  }, [total, page, totalPages]);

  const activePaging = total > minToShow;
  const start = activePaging ? (safePage - 1) * pageSize : 0;
  const pageItems = activePaging ? items.slice(start, start + pageSize) : items;
  const pager = activePaging ? (
    <Pager
      page={safePage}
      pageSize={pageSize}
      total={total}
      label={label}
      onPageChange={setPage}
      onPageSizeChange={(n) => {
        setPageSize(n);
        savePageSize(n);
        setPage(1);
      }}
    />
  ) : null;
  return { pageItems, pager, start };
}

// ── Controles ─────────────────────────────────────────────────────────────

export const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => <select ref={ref} className={cn(SELECT, TOUCH_TEXT, className)} {...props} />,
);
NativeSelect.displayName = 'NativeSelect';

/** Interruptor liga/desliga (role=switch); área de toque maior que o desenho. */
export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
  busy,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={busy || undefined}
      title={label}
      disabled={disabled || busy}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'group inline-grid h-9 w-11 shrink-0 place-items-center rounded-md',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        TOUCH_ICON,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'relative block h-5 w-9 rounded-full border transition-colors',
          checked ? 'border-primary bg-primary' : 'border-input bg-transparent',
        )}
      >
        <span
          className={cn(
            'absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full transition-[left] motion-reduce:transition-none',
            checked ? 'left-[18px] bg-primary-foreground' : 'left-[2px] bg-muted-foreground',
          )}
        />
      </span>
    </button>
  );
}

/** Grupo de botões exclusivos (período, filtro de status). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: ReadonlyArray<{ id: T; label: string }>;
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex h-9 items-stretch gap-0.5 rounded-md border border-input bg-card p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            'rounded-[4px] px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground whitespace-nowrap',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'aria-pressed:bg-secondary aria-pressed:text-foreground',
            TOUCH_TEXT,
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'border-border bg-transparent text-muted-foreground',
  success: '',
  warning: '',
  danger: '',
  // Azul como TEXTO é o --ring (#2E47BA): o azul North daria 4,1:1 no claro suave.
  accent: 'border-ring/30 bg-accent text-ring',
};

const TONE_VARIANT = {
  neutral: 'outline',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  accent: 'outline',
} as const;

export function ToneBadge({
  tone,
  children,
  title,
  icon,
  spin,
}: {
  tone: Tone;
  children: React.ReactNode;
  title?: string;
  icon?: NsIconName;
  spin?: boolean;
}) {
  return (
    <Badge variant={TONE_VARIANT[tone]} className={cn('whitespace-nowrap rounded-[4px]', TONE_CLASS[tone])} title={title}>
      {icon && <NsIcon name={icon} size={12} className={spin ? 'motion-safe:animate-spin' : undefined} />}
      {children}
    </Badge>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  errorId,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: React.ReactNode;
  error?: string | null;
  errorId?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
      {error ? (
        <p id={errorId} className="text-xs leading-[18px] text-danger">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs leading-[18px] text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

/** Superfície com título — cartão do DS1 (fundo + borda, sem sombra como limite). */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('nx-glass-card rounded-lg', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <div className="min-w-0">
            {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
            {description && <p className="text-xs leading-[18px] text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/** Texto longo com "Mostrar tudo" — trecho de documento, evidência, resposta. */
export function Expandable({
  children,
  lines = 4,
  className,
}: {
  children: React.ReactNode;
  lines?: 2 | 3 | 4 | 6;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [overflows, setOverflows] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (el && !open) setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [children, open]);
  const clamp = { 2: 'line-clamp-2', 3: 'line-clamp-3', 4: 'line-clamp-4', 6: 'line-clamp-6' }[lines];
  return (
    <div className={className}>
      <div ref={ref} className={cn('whitespace-pre-wrap break-words', !open && clamp)}>
        {children}
      </div>
      {(overflows || open) && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="mt-1 rounded-sm text-xs font-medium text-ring hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? 'Mostrar menos' : 'Mostrar tudo'}
        </button>
      )}
    </div>
  );
}
