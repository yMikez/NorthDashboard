/* global React */
/* Shell: sidebar, topbar, and global filters bar. */

const { useState: useStateS, useEffect: useEffectS, useRef: useRefS } = React;

function Sidebar({ active, onNav }) {
  const groups = [
    {
      label: 'Analytics',
      items: [
        { id: 'overview', label: 'Overview', icon: 'layout-dashboard' },
        { id: 'funnel',   label: 'Funnel Analytics', icon: 'bar-chart-3' },
      ]
    },
    {
      label: 'Affiliates',
      items: [
        { id: 'leaderboard', label: 'Leaderboard', icon: 'trophy', badge: '34' },
        { id: 'all-affiliates', label: 'All affiliates', icon: 'users' },
      ]
    },
    {
      label: 'Catalog',
      items: [
        { id: 'products', label: 'Products / Offers', icon: 'package' },
        { id: 'transactions', label: 'Transactions', icon: 'receipt' },
      ]
    },
    {
      label: 'System',
      items: [
        { id: 'integrations', label: 'Integrations', icon: 'plug' },
        { id: 'fx-currency',  label: 'FX / Currency', icon: 'dollar' },
        { id: 'users-perms',  label: 'Users & permissions', icon: 'settings' },
      ]
    }
  ];
  return (
    <aside className="side">
      <div className="side-logo">
        <img src="assets/logo-mark-dark.svg" alt="" style={{ width: 32, height: 32 }}/>
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 6px', fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--navy-400)', letterSpacing: '0.1em' }}>
          <span>v2.4.1 · prod</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--success)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)', boxShadow: '0 0 6px var(--success)' }}/>
            LIVE
          </span>
        </div>
        <div className="user-chip">
          <div className="av">LM</div>
          <div className="who">
            <span className="nm">Luiza Mendes</span>
            <span className="rl">OWNER · ADMIN</span>
          </div>
        </div>
      </div>
    </aside>
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
        <button className="btn btn-ghost" title="Refresh data">
          <Icon name="refresh" size={13}/> Synced 2m ago
        </button>
        <button className="btn btn-ghost">
          <Icon name="download" size={13}/> Export
        </button>
        <button className="icon-btn" title="Notifications">
          <Icon name="bell" size={14}/>
          <span className="pip"/>
        </button>
        <div className="user-chip" style={{ padding: '4px 8px 4px 4px', borderRadius: 6, margin: 0 }}>
          <div className="av" style={{ width: 26, height: 26, fontSize: 11 }}>LM</div>
        </div>
      </div>
    </header>
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
  const pill = isAll ? 'All' : String(selected.size);
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
          background: 'rgba(6,13,37,0.98)', border: '1px solid var(--border)',
          borderRadius: 8, padding: 6, zIndex: 20, boxShadow: '0 20px 60px -20px rgba(91,200,255,0.3)',
          backdropFilter: 'blur(10px)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', marginBottom: 4 }}>
            <button className="dh-link" style={{ background: 'none', border: 0, color: 'var(--glow-cyan)', fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.08em', cursor: 'pointer' }}
              onClick={() => onChange(new Set())}>ALL</button>
            <button className="dh-link" style={{ background: 'none', border: 0, color: 'var(--navy-300)', fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.08em', cursor: 'pointer' }}
              onClick={() => onChange(new Set(options.map(o => o.id)))}>NONE</button>
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {options.map(opt => {
              const on = selected.size === 0 ? true : selected.has(opt.id);
              return (
                <label key={opt.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                  fontSize: 12, color: 'var(--navy-100)', cursor: 'pointer', borderRadius: 4,
                  background: on ? 'rgba(91,200,255,0.06)' : 'transparent'
                }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(91,200,255,0.1)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = on ? 'rgba(91,200,255,0.06)' : 'transparent'}
                >
                  <input type="checkbox" checked={on} readOnly
                    onClick={(e) => {
                      e.preventDefault();
                      // treat empty set as "all selected". Toggling a single item from "all" makes a singleton filter.
                      const effective = selected.size === 0 ? new Set(options.map(o => o.id)) : new Set(selected);
                      if (effective.has(opt.id)) effective.delete(opt.id);
                      else effective.add(opt.id);
                      onChange(effective.size === options.length ? new Set() : effective);
                    }}
                    style={{ accentColor: 'var(--glow-cyan)' }}
                  />
                  {opt.swatch && <span style={{ width: 10, height: 10, borderRadius: 3, background: opt.swatch, flexShrink: 0 }}/>}
                  <span style={{ flex: 1 }}>{opt.label}</span>
                  {opt.meta && <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--navy-400)' }}>{opt.meta}</span>}
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Filter bar ----------
function FilterBar({ filters, setFilters }) {
  const DATE_PRESETS = [
    ['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', '7D'], ['30d', '30D'],
    ['mtd', 'MTD'], ['qtd', 'QTD'], ['ytd', 'YTD'], ['90d', '90D']
  ];

  const platformOpts = window.MOCK.PLATFORMS.map(p => ({ id: p.id, label: p.name, swatch: p.id === 'digistore24' ? '#8B7FFF' : '#5BC8FF' }));
  const productOpts = window.MOCK.PRODUCTS.filter(p => p.type === 'frontend').map(p => ({ id: p.funnel, label: p.name.split(' · ')[0], meta: p.sku.slice(0, 5) }));
  const countryOpts = window.MOCK.COUNTRIES.map(c => ({ id: c.code, label: c.name, meta: c.code }));
  const trafficOpts = ['Facebook','YouTube','Google','Native','TikTok','Email','Other'].map(t => ({ id: t, label: t }));

  return (
    <div className="filters">
      <Icon name="filter" size={12} className="f-icon" />
      <span className="f-label">RANGE</span>
      <div className="seg">
        {DATE_PRESETS.map(([k, l]) => (
          <button key={k} className={filters.preset === k ? 'is-active' : ''}
            onClick={() => setFilters(f => ({ ...f, preset: k, dateRange: rangeForPreset(k) }))}
          >{l}</button>
        ))}
      </div>
      <div className="date-chip">
        <Icon name="calendar" size={12}/>
        <span>{fmtDateShort(filters.dateRange.start)} → {fmtDateShort(filters.dateRange.end)}</span>
      </div>
      <span className="f-label" style={{ marginLeft: 8 }}>COMPARE</span>
      <button className={`chip ${filters.compare ? 'is-active' : ''}`}
        onClick={() => setFilters(f => ({ ...f, compare: !f.compare }))}
      >
        <Icon name="arrow-up-right" size={12}/>
        Prev period
      </button>

      <div style={{ flex: 1 }}/>

      <MultiSelect label="Platform" icon="plug" options={platformOpts} selected={filters.platforms}
        onChange={(s) => setFilters(f => ({ ...f, platforms: s }))}/>
      <MultiSelect label="Offer" icon="package" options={productOpts} selected={filters.funnels}
        onChange={(s) => setFilters(f => ({ ...f, funnels: s }))}/>
      <MultiSelect label="Country" icon="globe" options={countryOpts} selected={filters.countries}
        onChange={(s) => setFilters(f => ({ ...f, countries: s }))}/>
      <MultiSelect label="Source" icon="zap" options={trafficOpts} selected={filters.trafficSources}
        onChange={(s) => setFilters(f => ({ ...f, trafficSources: s }))}/>

      <div className="seg" style={{ marginLeft: 4 }}>
        {['USD','EUR','GBP'].map(c => (
          <button key={c} className={filters.currency === c ? 'is-active' : ''}
            onClick={() => setFilters(f => ({ ...f, currency: c }))}
          >{c}</button>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { Sidebar, Topbar, FilterBar });
