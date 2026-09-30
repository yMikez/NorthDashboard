'use client';

// Barra de filtros do /chat = porta da FilterBar da SPA (public/src/shell.jsx:
// FilterBar, MultiSelect, PeriodDropdown, DateRangeChip) com as MESMAS classes
// de dashboard.css (.filters, .f-icon, .f-label, .select-btn, .pill,
// .date-chip, .filter-pop), então fica idêntica ao resto do app, inclusive o
// bottom sheet dos dropdowns no celular (.filter-pop ≤820px).
//
// Diferenças de propósito em relação à SPA:
// - estado nos arrays do FilterState (não Set); array vazio = Todos;
// - sem "Nenhum" (NONE_TOKEN): o /api/chat não conhece esse marcador;
// - período em dia civil BRT (lib/shared/datePresets), igual ao rangeForPreset;
// - "Personalizado…" abre as duas datas no próprio dropdown. Na SPA ele só
//   troca o rótulo, e no celular o chip de datas some, então não havia como
//   escolher o intervalo;
// - o dropdown abre alinhado à direita quando não cabe (o <main> do chat
//   corta o que passa da borda);
// - sem MOCK enquanto carrega: listas vazias com "Carregando…".

import * as React from 'react';
import { NsIcon, type NsIconName } from './NsIcon';
import {
  DATE_PRESETS,
  PRESET_LABEL,
  brtRangeForDays,
  brtRangeForPreset,
} from '@/lib/shared/datePresets';
import type { FilterOptionsResponse } from '@/lib/services/filterOptions';
import type { FilterState } from '@/types/chat';

interface FilterChipsProps {
  filters: FilterState;
  onChange: (next: FilterState) => void;
}

type Period = FilterState['period'];

interface Option {
  id: string;
  label: string;
  meta?: string;
  swatch?: string;
}

type LoadState = 'loading' | 'ready' | 'error';

// Etapa do funil: mesmos ids da SPA (o servidor traduz pra Order.productType).
const STAGE_OPTIONS: Option[] = [
  { id: 'front', label: 'Front', meta: 'FE' },
  { id: 'upsell', label: 'Upsell', meta: 'UP' },
  { id: 'downsell', label: 'Downsell', meta: 'DW' },
  { id: 'recuperacao', label: 'Recuperação', meta: 'RC' },
];

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' → 'Sep 29': mesmo formato do chip da SPA (utils.jsx
 *  fmtDateShort, en-US). O dia civil é lido em UTC — sem deslocamento de fuso. */
const DAY_MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' });
function fmtDayMonth(iso: string): string {
  return ISO_DAY.test(iso) ? DAY_MONTH.format(new Date(iso + 'T00:00:00Z')) : '—';
}

// Mesmo estilo inline dos popovers da SPA (shell.jsx).
const POP_BASE: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 6px)',
  maxWidth: 'calc(100vw - 24px)',
  background: 'var(--bg-elev)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  zIndex: 20,
  boxShadow: 'var(--shadow-lg)',
};

// Campo de data no visual DS1 (o CSS de campo da SPA não alcança o chat).
const DATE_INPUT =
  'h-9 [@media(pointer:coarse)]:min-h-11 w-full px-2 rounded-md border border-[color:var(--border-strong)] bg-card text-sm ' +
  'text-[color:var(--fg1)] [color-scheme:light] [[data-theme=dark]_&]:[color-scheme:dark] ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 ' +
  'focus-visible:outline-[color:var(--accent)] aria-[invalid=true]:border-[color:var(--danger)]';

const OPTION_ROW =
  'block w-full text-left px-3 py-2 text-xs rounded-[4px] border-0 cursor-pointer ' +
  'hover:bg-[color:var(--bg-hover)] [@media(pointer:coarse)]:min-h-11';

// ---------------------------------------------------------------------------
// Popover: abre/fecha, fecha no clique fora, no Esc (devolve o foco ao
// gatilho) e quando o foco sai por Tab.
// ---------------------------------------------------------------------------
function usePopover(popWidth: number) {
  const [open, setOpen] = React.useState(false);
  const [alignRight, setAlignRight] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const popId = React.useId();

  const close = React.useCallback((refocus = false) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  function toggle() {
    if (!open && wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
      const bound =
        wrapRef.current.closest('.filters')?.getBoundingClientRect().right ?? window.innerWidth;
      setAlignRight(r.left + popWidth > bound);
    }
    setOpen((v) => !v);
  }

  React.useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // Não deixa o Esc global do ChatShell (fecha o drawer de detalhe) agir junto.
      e.stopPropagation();
      close(true);
    }
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  // Foco saiu pra fora (Tab). relatedTarget nulo = clique em área não
  // focável — quem cuida disso é o pointerdown acima.
  function onBlur(e: React.FocusEvent<HTMLDivElement>) {
    const next = e.relatedTarget as Node | null;
    if (next && wrapRef.current && !wrapRef.current.contains(next)) setOpen(false);
  }

  const popStyle: React.CSSProperties = {
    ...POP_BASE,
    minWidth: popWidth,
    ...(alignRight ? { right: 0 } : { left: 0 }),
  };

  return { open, toggle, close, wrapRef, triggerRef, popId, onBlur, popStyle };
}

// ---------------------------------------------------------------------------
// Intervalo personalizado (De / Até) — usado no dropdown de período e no chip.
// ---------------------------------------------------------------------------
function RangeForm({
  period,
  onApply,
  onCancel,
}: {
  period: Period;
  onApply: (from: string, to: string) => void;
  onCancel: () => void;
}) {
  const [from, setFrom] = React.useState(period.start);
  const [to, setTo] = React.useState(period.end);
  const fromRef = React.useRef<HTMLInputElement | null>(null);
  const errId = React.useId();
  const today = React.useMemo(() => brtRangeForPreset('today').end, []);

  React.useEffect(() => {
    fromRef.current?.focus();
  }, []);

  const filled = ISO_DAY.test(from) && ISO_DAY.test(to);
  const error = !filled
    ? null
    : from > to
      ? 'A data inicial precisa ser igual ou anterior à final.'
      : to > today
        ? 'A data final não pode ser depois de hoje.'
        : null;
  const valid = filled && !error;

  return (
    <form
      className="grid gap-2.5 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onApply(from, to);
      }}
    >
      <div className="text-xs font-medium text-[color:var(--fg4)]">Intervalo personalizado</div>
      <label className="grid gap-1 text-xs text-[color:var(--fg3)]">
        <span>De</span>
        <input
          ref={fromRef}
          type="date"
          value={from}
          max={to || today}
          onChange={(e) => setFrom(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errId : undefined}
          className={DATE_INPUT}
        />
      </label>
      <label className="grid gap-1 text-xs text-[color:var(--fg3)]">
        <span>Até</span>
        <input
          type="date"
          value={to}
          min={from || undefined}
          max={today}
          onChange={(e) => setTo(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errId : undefined}
          className={DATE_INPUT}
        />
      </label>
      {error && (
        <p id={errId} role="alert" className="m-0 text-xs" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}
      <div className="mt-1 flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-primary" disabled={!valid}>
          Aplicar
        </button>
      </div>
    </form>
  );
}

function customPeriod(from: string, to: string): Period {
  const r = brtRangeForDays(from, to, 'custom');
  return { preset: 'custom', start: r.start, end: r.end };
}

// ---------------------------------------------------------------------------
// Período (presets + Personalizado…)
// ---------------------------------------------------------------------------
function PeriodDropdown({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  const pop = usePopover(280);
  const [customOpen, setCustomOpen] = React.useState(false);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const customBtnRef = React.useRef<HTMLButtonElement | null>(null);
  const activeLabel = PRESET_LABEL[period.preset] ?? 'Selecionar';

  // Ao abrir: volta pra lista e põe o foco na opção atual (setas navegam).
  React.useEffect(() => {
    if (!pop.open) {
      setCustomOpen(false);
      return;
    }
    const el =
      listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]') ??
      listRef.current?.querySelector<HTMLElement>('[role="option"]');
    el?.focus();
  }, [pop.open]);

  function pick(id: string) {
    const r = brtRangeForPreset(id);
    onChange({ preset: r.preset, start: r.start, end: r.end });
    pop.close(true);
  }

  function onListKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="option"]'));
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    let n = -1;
    if (e.key === 'ArrowDown') n = (i + 1) % items.length;
    else if (e.key === 'ArrowUp') n = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = items.length - 1;
    if (n >= 0) {
      e.preventDefault();
      items[n].focus();
    }
  }

  function optionStyle(active: boolean): React.CSSProperties | undefined {
    return active
      ? {
          color: 'var(--accent)',
          background: 'color-mix(in oklab, var(--accent) 10%, transparent)',
          fontWeight: 500,
        }
      : { color: 'var(--fg2)' };
  }

  return (
    <div ref={pop.wrapRef} style={{ position: 'relative' }} onBlur={pop.onBlur}>
      <button
        ref={pop.triggerRef}
        type="button"
        className="select-btn"
        onClick={pop.toggle}
        style={{ minWidth: 'min(180px, calc(100vw - 48px))', justifyContent: 'space-between' }}
        aria-haspopup="listbox"
        aria-expanded={pop.open}
        aria-controls={pop.open ? pop.popId : undefined}
        aria-label={`Período: ${activeLabel}`}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <NsIcon name="calendar" size={12} /> {activeLabel}
        </span>
        <NsIcon name="chevron-down" size={12} />
      </button>
      {pop.open && (
        <div id={pop.popId} className="filter-pop" style={{ ...pop.popStyle, minWidth: customOpen ? 280 : 220 }}>
          <div
            ref={listRef}
            role="listbox"
            aria-label="Período"
            onKeyDown={onListKey}
            style={{ padding: 4 }}
          >
            {DATE_PRESETS.map((p) => {
              const active = period.preset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={OPTION_ROW}
                  style={optionStyle(active)}
                  onClick={() => pick(p.id)}
                >
                  {p.label}
                </button>
              );
            })}
            <div style={{ height: 1, background: 'var(--border-soft)', margin: '4px 0' }} />
            <button
              ref={customBtnRef}
              type="button"
              role="option"
              aria-selected={period.preset === 'custom'}
              className={OPTION_ROW}
              style={optionStyle(period.preset === 'custom')}
              onClick={() => setCustomOpen((v) => !v)}
            >
              Personalizado…
            </button>
          </div>
          {customOpen && (
            <div style={{ borderTop: '1px solid var(--border-soft)' }}>
              <RangeForm
                period={period}
                onApply={(from, to) => {
                  onChange(customPeriod(from, to));
                  pop.close(true);
                }}
                onCancel={() => {
                  setCustomOpen(false);
                  customBtnRef.current?.focus();
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chip do intervalo ('dd/mm → dd/mm') com popover de datas
// ---------------------------------------------------------------------------
function DateRangeChip({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  const pop = usePopover(280);
  const label = `${fmtDayMonth(period.start)} → ${fmtDayMonth(period.end)}`;
  return (
    // hide-mobile: igual à SPA — no celular o intervalo sai (o dropdown de
    // período já tem o "Personalizado…").
    <div ref={pop.wrapRef} className="hide-mobile" style={{ position: 'relative' }} onBlur={pop.onBlur}>
      <button
        ref={pop.triggerRef}
        type="button"
        className="date-chip"
        onClick={pop.toggle}
        style={{
          cursor: 'pointer',
          background: 'transparent',
          border: 'none',
          padding: 0,
          font: 'inherit',
          color: 'inherit',
        }}
        title="Clique pra escolher datas customizadas"
        aria-haspopup="dialog"
        aria-expanded={pop.open}
        aria-controls={pop.open ? pop.popId : undefined}
        aria-label={`Intervalo ${label}. Escolher datas`}
      >
        <NsIcon name="calendar" size={12} />
        <span className="num">{label}</span>
      </button>
      {pop.open && (
        <div id={pop.popId} role="dialog" aria-label="Intervalo personalizado" className="filter-pop" style={pop.popStyle}>
          <RangeForm
            period={period}
            onApply={(from, to) => {
              onChange(customPeriod(from, to));
              pop.close(true);
            }}
            onCancel={() => pop.close(true)}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MultiSelect (checkboxes, fica aberto enquanto marca)
// ---------------------------------------------------------------------------
function MultiSelect({
  label,
  icon,
  options,
  selected,
  onChange,
  status = 'ready',
}: {
  label: string;
  icon: NsIconName;
  options: Option[];
  selected: string[];
  onChange: (next: string[]) => void;
  status?: LoadState;
}) {
  const pop = usePopover(220);

  // Selecionado que não está na lista (veio da URL, ou opções ainda
  // carregando) continua visível pra poder ser desmarcado.
  const knownIds = new Set(options.map((o) => o.id));
  const extras: Option[] = selected.filter((id) => !knownIds.has(id)).map((id) => ({ id, label: id }));
  const rows = extras.length ? [...options, ...extras] : options;
  const sel = new Set(selected);

  const isAll =
    selected.length === 0 ||
    (extras.length === 0 && options.length > 0 && options.every((o) => sel.has(o.id)));
  const pill = isAll ? 'Todos' : String(selected.length);

  // Mesmo modelo da SPA: vazio = TODOS (tudo marcado). Desmarcar a partir de
  // TODOS seleciona o resto; marcar tudo volta pra vazio. Sem "Nenhum":
  // desmarcar o último também volta pra TODOS.
  function toggle(id: string) {
    const eff = new Set(selected.length === 0 ? options.map((o) => o.id) : selected);
    if (eff.has(id)) eff.delete(id);
    else eff.add(id);
    const everyKnown = options.length > 0 && options.every((o) => eff.has(o.id));
    const hasExtra = Array.from(eff).some((x) => !knownIds.has(x));
    if (eff.size === 0 || (everyKnown && !hasExtra)) {
      onChange([]);
      return;
    }
    onChange(rows.map((r) => r.id).filter((x) => eff.has(x)));
  }

  const emptyText =
    status === 'loading'
      ? 'Carregando…'
      : status === 'error'
        ? 'Não foi possível carregar as opções.'
        : 'Nenhuma opção.';

  return (
    <div ref={pop.wrapRef} style={{ position: 'relative' }} onBlur={pop.onBlur}>
      <button
        ref={pop.triggerRef}
        type="button"
        className="select-btn"
        onClick={pop.toggle}
        aria-expanded={pop.open}
        aria-controls={pop.open ? pop.popId : undefined}
      >
        <NsIcon name={icon} size={13} />
        <span>{label}</span>
        <span className="pill">{pill}</span>
        <NsIcon name="chevron-down" size={12} />
      </button>
      {pop.open && (
        <div
          id={pop.popId}
          role="group"
          aria-label={label}
          className="filter-pop"
          style={{ ...pop.popStyle, padding: 6 }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 4px', marginBottom: 4 }}>
            <button
              type="button"
              className="rounded-[4px] border-0 bg-transparent px-2 py-1 text-xs font-medium cursor-pointer hover:bg-[color:var(--bg-hover)] [@media(pointer:coarse)]:min-h-11"
              style={{ color: 'var(--accent)' }}
              onClick={() => onChange([])}
              title={`Mostrar todos (limpa o filtro de ${label.toLowerCase()})`}
            >
              Todos
            </button>
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {rows.length === 0 && (
              <div className="px-2 py-1.5 text-xs" style={{ color: 'var(--fg5)' }}>
                {emptyText}
              </div>
            )}
            {rows.map((opt) => {
              const on = selected.length === 0 ? true : sel.has(opt.id);
              return (
                <label
                  key={opt.id}
                  className="flex items-center gap-2 rounded-[4px] px-2 py-1.5 text-xs cursor-pointer hover:bg-[color:var(--bg-hover)] [@media(pointer:coarse)]:min-h-11"
                  style={{
                    color: 'var(--fg2)',
                    transition: 'background 120ms',
                    ...(on ? { background: 'color-mix(in oklab, var(--accent) 8%, transparent)' } : null),
                  }}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(opt.id)}
                    className="shrink-0 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--accent)]"
                    style={{ accentColor: 'var(--glow-cyan)' }}
                  />
                  {opt.swatch && (
                    <span
                      aria-hidden="true"
                      style={{ width: 10, height: 10, borderRadius: 3, background: opt.swatch, flexShrink: 0 }}
                    />
                  )}
                  <span style={{ flex: 1 }}>{opt.label}</span>
                  {opt.meta && (
                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg5)' }}>
                      {opt.meta}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Barra
// ---------------------------------------------------------------------------
export function FilterChips({ filters, onChange }: FilterChipsProps) {
  const [opts, setOpts] = React.useState<FilterOptionsResponse | null>(null);
  const [load, setLoad] = React.useState<LoadState>('loading');

  // Opções reais, uma vez por montagem (mesma fonte da SPA; requireAuth só).
  React.useEffect(() => {
    const ctrl = new AbortController();
    fetch('/api/metrics/filters', {
      signal: ctrl.signal,
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as FilterOptionsResponse;
      })
      .then((data) => {
        setOpts(data);
        setLoad('ready');
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        console.warn('[chat] filter options failed', err);
        setLoad('error');
      });
    return () => ctrl.abort();
  }, []);

  const platformOpts = React.useMemo<Option[]>(
    () =>
      (opts?.platforms ?? []).map((p) => ({
        id: p.id,
        label: p.label,
        swatch: p.id === 'digistore24' ? 'var(--glow-violet)' : 'var(--glow-cyan)',
      })),
    [opts],
  );
  const familyOpts = React.useMemo<Option[]>(
    () => (opts?.families ?? []).map((f) => ({ id: f.id, label: f.label, meta: `${f.feSkuCount} FE` })),
    [opts],
  );
  const countryOpts = React.useMemo<Option[]>(
    () => (opts?.countries ?? []).map((c) => ({ id: c.id, label: c.label, meta: String(c.orderCount) })),
    [opts],
  );
  const affiliateOpts = React.useMemo<Option[]>(
    () =>
      (opts?.affiliates ?? []).map((a) => ({
        id: a.id,
        label: a.label,
        meta: a.removed ? 'removido' : a.status === 'active' ? 'ativo' : 'inativo',
      })),
    [opts],
  );
  // O /api/chat não aplica affiliate_id (parseFilters não preenche
  // mappedAffiliateIds) — como a SPA fora de ROUTES_WITH_AFFILIATE, o seletor
  // não aparece; o valor só viaja na URL de volta pra SPA.
  const showAffiliate = false;

  return (
    <div
      className="filters text-sm leading-[1.5714] text-[color:var(--fg3)]"
      style={{ position: 'static' }}
      role="group"
      aria-label="Filtros"
    >
      <NsIcon name="filter" size={12} className="f-icon" />
      <span className="f-label">Período</span>
      <PeriodDropdown period={filters.period} onChange={(period) => onChange({ ...filters, period })} />
      <DateRangeChip period={filters.period} onChange={(period) => onChange({ ...filters, period })} />

      <div style={{ flex: 1 }} />

      <MultiSelect
        label="Plataforma"
        icon="plug"
        options={platformOpts}
        status={load}
        selected={filters.platforms}
        onChange={(platforms) => onChange({ ...filters, platforms })}
      />
      <MultiSelect
        label="Produto"
        icon="package"
        options={familyOpts}
        status={load}
        selected={filters.families}
        onChange={(families) => onChange({ ...filters, families })}
      />
      <MultiSelect
        label="Etapa"
        icon="layers"
        options={STAGE_OPTIONS}
        selected={filters.stages}
        onChange={(stages) => onChange({ ...filters, stages })}
      />
      <MultiSelect
        label="País"
        icon="globe"
        options={countryOpts}
        status={load}
        selected={filters.countries}
        onChange={(countries) => onChange({ ...filters, countries })}
      />
      {showAffiliate && (
        <MultiSelect
          label="Afiliado"
          icon="users"
          options={affiliateOpts}
          status={load}
          selected={filters.affiliates}
          onChange={(affiliates) => onChange({ ...filters, affiliates })}
        />
      )}
    </div>
  );
}
