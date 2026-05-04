/* global React */
/* Shell: sidebar, topbar, and global filters bar. */

const { useState: useStateS, useEffect: useEffectS, useRef: useRefS } = React;

function Sidebar({ active, onNav, user }) {
  const allGroups = [
    {
      label: 'Análise',
      items: [
        { id: 'overview', label: 'Visão geral', icon: 'layout-dashboard' },
        { id: 'funnel',   label: 'Funil', icon: 'bar-chart-3' },
        { id: 'insights', label: 'Insights', icon: 'zap' },
      ]
    },
    {
      label: 'Afiliados',
      items: [
        { id: 'leaderboard', label: 'Ranking', icon: 'trophy' },
        { id: 'all-affiliates', label: 'Todos os afiliados', icon: 'users' },
        { id: 'networks', label: 'Networks', icon: 'layers' },
      ]
    },
    {
      label: 'Catálogo',
      items: [
        { id: 'products', label: 'Produtos', icon: 'package' },
        { id: 'transactions', label: 'Transações', icon: 'receipt' },
      ]
    },
    {
      label: 'Sistema',
      items: [
        { id: 'platforms', label: 'Plataformas', icon: 'plug' },
        { id: 'costs', label: 'Custos', icon: 'wallet' },
        { id: 'health', label: 'Saúde do dado', icon: 'alert-triangle' },
      ]
    }
  ];
  // Admin vê tudo; MEMBER só vê o que está em allowedTabs.
  // 'users' é admin-only (não está em AVAILABLE_TABS) — adicionado a parte
  // só pra admin.
  const isAdmin = user?.role === 'ADMIN';
  const allowed = new Set(user?.allowedTabs || []);
  const adminOnly = {
    label: 'Admin',
    items: [
      { id: 'users', label: 'Usuários', icon: 'user-plus' },
    ],
  };
  const groups = isAdmin
    ? [...allGroups, adminOnly]
    : allGroups
        .map((g) => ({ ...g, items: g.items.filter((it) => allowed.has(it.id)) }))
        .filter((g) => g.items.length > 0);
  return (
    <aside className="side">
      <div className="side-logo">
        <img
          src="/assets/logo-mark-dark.svg"
          alt=""
          className="logo-mark logo-dark"
          style={{ width: 32, height: 32 }}
        />
        <img
          src="/assets/logo-mark-light.svg"
          alt=""
          className="logo-mark logo-light"
          style={{ width: 32, height: 32 }}
        />
        <div className="wm" style={{ width: 71, fontSize: 24 }}>north<em>scale</em></div>
      </div>

      {groups.map((g) => (
        <div key={g.label}>
          <div className="side-group-label">{g.label}</div>
          <nav className="side-nav">
            {g.items.map((it) => (
              <button
                key={it.id}
                className={`side-item ${active === it.id ? 'is-active' : ''}`}
                onClick={() => onNav(it.id)}
              >
                <Icon name={it.icon} size={15} />
                <span>{it.label}</span>
                {it.badge && <span className="cnt">{it.badge}</span>}
              </button>
            ))}
          </nav>
        </div>
      ))}

      <div className="side-foot">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 6px', fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg5)', letterSpacing: '0.1em' }}>
          <span>v2.4.1 · prod</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--success)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)', boxShadow: '0 0 6px var(--success)' }}/>
            LIVE
          </span>
        </div>
        <UserChip user={user}/>
      </div>
    </aside>
  );
}

function UserChip({ user }) {
  const [open, setOpen] = useStateS(false);
  const ref = useRefS(null);
  useEffectS(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  if (!user) return null;
  const display = user.name || user.email;
  const initials = (user.name || user.email)
    .split(/[\s@.]+/).filter(Boolean).slice(0, 2)
    .map((p) => p[0]?.toUpperCase()).join('') || '?';
  async function logout() {
    try { await fetch('/api/auth/signout', { method: 'POST' }); } catch (e) {}
    window.location.href = '/login';
  }
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="user-chip"
        onClick={() => setOpen((v) => !v)}
        style={{ width: '100%', textAlign: 'left', cursor: 'pointer', background: open ? 'rgba(91,200,255,0.06)' : 'transparent', border: 0, font: 'inherit' }}
      >
        <div className="av">{initials}</div>
        <div className="who">
          <span className="nm">{display}</span>
          <span className="rl">{user.role === 'ADMIN' ? 'ADMIN · acesso total' : `MEMBER · ${user.allowedTabs.length} ${user.allowedTabs.length === 1 ? 'aba' : 'abas'}`}</span>
        </div>
      </button>
      {open && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, right: 0,
          background: 'var(--bg-elev)', border: '1px solid var(--border)',
          borderRadius: 8, padding: 4, zIndex: 30,
          boxShadow: '0 -10px 40px -10px rgba(91,200,255,0.25)', backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        }}>
          <button
            onClick={logout}
            style={{
              width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 4,
              background: 'transparent', border: 0, cursor: 'pointer',
              fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--fg1)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; e.currentTarget.style.color = 'var(--danger)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--fg1)'; }}
          >
            <Icon name="log-out" size={12}/> Sair
          </button>
        </div>
      )}
    </div>
  );
}

function Topbar({ title, titleEm, crumbs, onToggleCurrency, currency }) {
  return (
    <header className="top">
      <div className="top-title">
        <div className="top-crumb">
          {crumbs.map((c, i) => (
            <React.Fragment key={i}>
              <span className={i === crumbs.length - 1 ? 'cur' : ''}>{c}</span>
              {i < crumbs.length - 1 && <span className="sep">/</span>}
            </React.Fragment>
          ))}
        </div>
        <h1 className="top-h1" style={{ fontSize: 25 }}>
          {title}{titleEm && <> <em>{titleEm}</em></>}
        </h1>
      </div>
      <div className="top-spacer"/>
      <div className="top-actions">
        <ThemeToggle/>
        <button className="btn btn-ghost" title="Atualizar dados">
          <Icon name="refresh" size={13}/> Sincronizado há 2 min
        </button>
        <button className="btn btn-ghost">
          <Icon name="download" size={13}/> Exportar
        </button>
        <button className="icon-btn" title="Notificações">
          <Icon name="bell" size={14}/>
          <span className="pip"/>
        </button>
      </div>
    </header>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useStateS(() => {
    const cur = document.documentElement.getAttribute('data-theme');
    return cur === 'light' ? 'light' : 'dark';
  });
  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('ns-theme', next); } catch (e) {}
    setTheme(next);
  }
  return (
    <button
      className="theme-toggle"
      onClick={toggle}
      title={theme === 'dark' ? 'Mudar pra modo claro' : 'Mudar pra modo escuro'}
      aria-label="Alternar tema"
    >
      <span className="knob">
        <Icon name={theme === 'dark' ? 'moon' : 'sun'} size={12}/>
      </span>
    </button>
  );
}

// ---------- Multi-select dropdown ----------
function MultiSelect({ label, options, selected, onChange, icon }) {
  const [open, setOpen] = useStateS(false);
  const ref = useRefS(null);
  useEffectS(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const isAll = selected.size === 0 || selected.size === options.length;
  const pill = isAll ? 'Todos' : String(selected.size);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="select-btn" onClick={() => setOpen(v => !v)}>
        {icon && <Icon name={icon} size={13}/>}
        <span>{label}</span>
        <span className="pill">{pill}</span>
        <Icon name="chevron-down" size={12}/>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, minWidth: 220,
          background: 'var(--bg-elev)', border: '1px solid var(--border)',
          backdropFilter: 'blur(20px) saturate(180%)', WebkitBackdropFilter: 'blur(20px) saturate(180%)',          borderRadius: 8, padding: 6, zIndex: 20, boxShadow: '0 20px 60px -20px rgba(91,200,255,0.3)',
          backdropFilter: 'blur(10px)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', marginBottom: 4 }}>
            <button className="dh-link" style={{ background: 'none', border: 0, color: 'var(--glow-cyan)', fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.08em', cursor: 'pointer' }}
              onClick={() => onChange(new Set())}>TODOS</button>
            <button className="dh-link" style={{ background: 'none', border: 0, color: 'var(--fg4)', fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.08em', cursor: 'pointer' }}
              onClick={() => onChange(new Set(options.map(o => o.id)))}>NENHUM</button>
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {options.map(opt => {
              const on = selected.size === 0 ? true : selected.has(opt.id);
              // Toggle handler. Empty selection means "all" (visual) — first
              // click with empty state seeds the set with everything, then
              // toggles the clicked item. If the user re-selects every item
              // we collapse back to the empty "all" state for cleaner URLs.
              const toggle = () => {
                const effective = selected.size === 0 ? new Set(options.map(o => o.id)) : new Set(selected);
                if (effective.has(opt.id)) effective.delete(opt.id);
                else effective.add(opt.id);
                onChange(effective.size === options.length ? new Set() : effective);
              };
              return (
                <label key={opt.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                  fontSize: 12, color: 'var(--fg2)', cursor: 'pointer', borderRadius: 4,
                  background: on ? 'rgba(91,200,255,0.06)' : 'transparent',
                  transition: 'background 120ms',
                }}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={toggle}
                    style={{ accentColor: 'var(--glow-cyan)' }}
                  />
                  {opt.swatch && <span style={{ width: 10, height: 10, borderRadius: 3, background: opt.swatch, flexShrink: 0 }}/>}
                  <span style={{ flex: 1 }}>{opt.label}</span>
                  {opt.meta && <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg5)' }}>{opt.meta}</span>}
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Routes that already render comparison data (deltas vs previous period).
// Other routes hide the toggle since flipping it would have no visible effect.
const ROUTES_WITH_COMPARE = new Set(['overview']);

// ---------- Date range chip with custom-range popover ----------
function DateRangeChip({ range, onChange }) {
  const [open, setOpen] = useStateS(false);
  const [draft, setDraft] = useStateS({
    from: isoDateOnly(range.start),
    to: isoDateOnly(range.end),
  });
  const ref = useRefS(null);

  // Re-seed draft whenever the external range changes (preset clicks etc.)
  // so the popover never shows a stale leftover selection.
  useEffectS(() => {
    setDraft({ from: isoDateOnly(range.start), to: isoDateOnly(range.end) });
  }, [range.start.getTime(), range.end.getTime()]);

  useEffectS(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function apply() {
    const start = new Date(draft.from + 'T00:00:00.000Z');
    const end = new Date(draft.to + 'T23:59:59.999Z');
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
    if (start > end) return;
    onChange(start, end);
    setOpen(false);
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="date-chip"
        onClick={() => setOpen(v => !v)}
        style={{ cursor: 'pointer', background: 'transparent', border: 'none', padding: 0, font: 'inherit', color: 'inherit' }}
        title="Clique pra escolher datas customizadas"
      >
        <Icon name="calendar" size={12}/>
        <span>{fmtDateShort(range.start)} → {fmtDateShort(range.end)}</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, minWidth: 280,
          background: 'var(--bg-elev)', border: '1px solid var(--border)',
          backdropFilter: 'blur(20px) saturate(180%)', WebkitBackdropFilter: 'blur(20px) saturate(180%)',          borderRadius: 8, padding: 12, zIndex: 20,
          boxShadow: '0 20px 60px -20px rgba(91,200,255,0.3)',
          backdropFilter: 'blur(10px)',
          display: 'grid', gap: 10,
        }}>
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg4)', letterSpacing: '0.08em' }}>
            INTERVALO CUSTOMIZADO
          </div>
          <label style={{ display: 'grid', gap: 4, fontSize: 11, color: 'var(--fg3)' }}>
            <span>De</span>
            <input
              type="date"
              value={draft.from}
              onChange={(e) => setDraft(d => ({ ...d, from: e.target.value }))}
              max={draft.to}
              style={dateInputStyle}
            />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 11, color: 'var(--fg3)' }}>
            <span>Até</span>
            <input
              type="date"
              value={draft.to}
              onChange={(e) => setDraft(d => ({ ...d, to: e.target.value }))}
              min={draft.from}
              max={isoDateOnly(new Date())}
              style={dateInputStyle}
            />
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button onClick={() => setOpen(false)} className="btn btn-ghost" style={{ fontSize: 11 }}>Cancelar</button>
            <button onClick={apply} className="btn" style={{ fontSize: 11 }}>Aplicar</button>
          </div>
        </div>
      )}
    </div>
  );
}

const dateInputStyle = {
  background: 'rgba(91,200,255,0.06)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  padding: '6px 8px',
  color: 'var(--fg1)',
  fontFamily: 'var(--f-mono)',
  fontSize: 12,
  colorScheme: 'dark',
};

// ---------- Filter bar ----------
// Presets ordenados de mais curto pra mais longo, com nomes amigáveis
// (a UI do dropdown mostra essa label completa; o chip de range mostra
// só o intervalo curto).
const DATE_PRESETS = [
  { id: 'today',     label: 'Hoje' },
  { id: 'yesterday', label: 'Ontem' },
  { id: '7d',        label: 'Últimos 7 dias' },
  { id: '30d',       label: 'Últimos 30 dias' },
  { id: '90d',       label: 'Últimos 90 dias' },
  { id: 'mtd',       label: 'Este mês' },
  { id: 'qtd',       label: 'Este trimestre' },
  { id: 'ytd',       label: 'Este ano' },
];
const PRESET_LABEL = Object.fromEntries(DATE_PRESETS.map((p) => [p.id, p.label]));
PRESET_LABEL.custom = 'Personalizado';

function PeriodDropdown({ filters, setFilters }) {
  const [open, setOpen] = useStateS(false);
  const ref = useRefS(null);
  useEffectS(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  function pick(id) {
    setFilters((f) => ({ ...f, preset: id, dateRange: rangeForPreset(id) }));
    setOpen(false);
  }
  const activeLabel = PRESET_LABEL[filters.preset] || 'Selecionar';
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="select-btn"
        onClick={() => setOpen((v) => !v)}
        style={{ minWidth: 180, justifyContent: 'space-between' }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Icon name="calendar" size={12}/> {activeLabel}
        </span>
        <Icon name="chevron-down" size={12}/>
      </button>
      {open && (
        <div role="listbox" style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, minWidth: 220,
          background: 'var(--bg-elev)', border: '1px solid var(--border)',
          borderRadius: 8, padding: 4, zIndex: 20,
          boxShadow: '0 20px 60px -20px rgba(91,200,255,0.30)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        }}>
          {DATE_PRESETS.map((p) => (
            <button
              key={p.id}
              role="option"
              aria-selected={filters.preset === p.id}
              onClick={() => pick(p.id)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '8px 12px', fontSize: 12,
                color: filters.preset === p.id ? 'var(--glow-cyan)' : 'var(--fg2)',
                background: filters.preset === p.id ? 'rgba(91,200,255,0.08)' : 'transparent',
                border: 0, borderRadius: 4, cursor: 'pointer',
                fontFamily: 'inherit',
              }}
              onMouseEnter={(e) => { if (filters.preset !== p.id) e.currentTarget.style.background = 'rgba(91,200,255,0.04)'; }}
              onMouseLeave={(e) => { if (filters.preset !== p.id) e.currentTarget.style.background = 'transparent'; }}
            >
              {p.label}
            </button>
          ))}
          <div style={{ height: 1, background: 'var(--border-soft)', margin: '4px 0' }}/>
          <button
            role="option"
            aria-selected={filters.preset === 'custom'}
            onClick={() => { setFilters((f) => ({ ...f, preset: 'custom' })); setOpen(false); }}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '8px 12px', fontSize: 12,
              color: filters.preset === 'custom' ? 'var(--glow-cyan)' : 'var(--fg2)',
              background: filters.preset === 'custom' ? 'rgba(91,200,255,0.08)' : 'transparent',
              border: 0, borderRadius: 4, cursor: 'pointer',
              fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => { if (filters.preset !== 'custom') e.currentTarget.style.background = 'rgba(91,200,255,0.04)'; }}
            onMouseLeave={(e) => { if (filters.preset !== 'custom') e.currentTarget.style.background = 'transparent'; }}
          >
            Personalizado…
          </button>
        </div>
      )}
    </div>
  );
}

function FilterBar({ filters, setFilters, options, route }) {

  // Real options come from /api/metrics/filters (loaded async by App). Fall
  // back to MOCK universe while loading so the bar isn't blank on first paint.
  const platformOpts = options?.platforms
    ? options.platforms.map((p) => ({
        id: p.id,
        label: p.label,
        swatch: p.id === 'digistore24' ? '#8B7FFF' : '#5BC8FF',
      }))
    : window.MOCK.PLATFORMS.map((p) => ({
        id: p.id, label: p.name,
        swatch: p.id === 'digistore24' ? '#8B7FFF' : '#5BC8FF',
      }));

  // "Oferta" agora é a família do produto (NeuroMindPro, GlycoPulse, etc.).
  // Antes existia também um filtro per-SKU mas ele confundia a UX e não
  // bate com o modelo mental do usuário ("ofertas" pensa em produto-pai,
  // não em variantes individuais).
  const familyOpts = options?.families
    ? options.families.map((f) => ({
        id: f.id, label: f.label, meta: `${f.feSkuCount} FE`,
      }))
    : [];

  const countryOpts = options?.countries
    ? options.countries.map((c) => ({
        id: c.id, label: c.label, meta: String(c.orderCount),
      }))
    : window.MOCK.COUNTRIES.map((c) => ({
        id: c.code, label: c.name, meta: c.code,
      }));

  const showCompare = ROUTES_WITH_COMPARE.has(route);

  return (
    <div className="filters">
      <Icon name="filter" size={12} className="f-icon" />
      <span className="f-label">PERÍODO</span>
      <PeriodDropdown filters={filters} setFilters={setFilters}/>
      <DateRangeChip
        range={filters.dateRange}
        onChange={(start, end) => setFilters(f => ({
          ...f, preset: 'custom', dateRange: { start, end, preset: 'custom' },
        }))}
      />
      {showCompare && (
        <>
          <span className="f-label" style={{ marginLeft: 8 }}>COMPARAR</span>
          <button className={`chip ${filters.compare ? 'is-active' : ''}`}
            onClick={() => setFilters(f => ({ ...f, compare: !f.compare }))}
          >
            <Icon name="arrow-up-right" size={12}/>
            Período anterior
          </button>
        </>
      )}

      <div style={{ flex: 1 }}/>

      <MultiSelect label="Plataforma" icon="plug" options={platformOpts} selected={filters.platforms}
        onChange={(s) => setFilters(f => ({ ...f, platforms: s }))}/>
      <MultiSelect label="Produto" icon="package" options={familyOpts} selected={filters.families}
        onChange={(s) => setFilters(f => ({ ...f, families: s }))}/>
      <MultiSelect label="País" icon="globe" options={countryOpts} selected={filters.countries}
        onChange={(s) => setFilters(f => ({ ...f, countries: s }))}/>
    </div>
  );
}

Object.assign(window, { Sidebar, Topbar, FilterBar });
