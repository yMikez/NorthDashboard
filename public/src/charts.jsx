/* global React */
/* Chart components: line/area with tooltip, donut, horizontal bar, funnel. */

const { useState: useStateC, useMemo: useMemoC, useRef: useRefC } = React;

// ---------- Donut ----------
// Interativo: hover (no arco OU na legenda) destaca o segmento e troca o
// centro pro valor dele; onItemClick (opcional) torna segmentos/linhas
// clicáveis — usado no Overview pra filtrar por etapa.
function Donut({ items, totalLabel = 'Total', format = (v) => fmtCurrency(v), onItemClick }) {
  const [active, setActive] = useStateC(null);
  const total = items.reduce((s, it) => s + it.value, 0) || 1;
  const r = 60, cx = 75, cy = 75, stroke = 16;
  const C = 2 * Math.PI * r;
  let offset = 0;
  const colors = ['#5BC8FF', '#4A90FF', '#8B7FFF', '#a8b7d8', '#6b84b8'];
  const act = active != null ? items[active] : null;
  const clickable = (it) => !!onItemClick && it.clickable !== false;
  return (
    <div className="donut-wrap">
      <svg className="donut" viewBox="0 0 150 150">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(91,200,255,0.08)" strokeWidth={stroke}/>
        {items.map((it, i) => {
          const frac = it.value / total;
          const dash = C * frac;
          const isActive = active === i;
          const seg = (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none"
              stroke={it.color || colors[i % colors.length]}
              strokeWidth={isActive ? stroke + 5 : stroke}
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${cx} ${cy})`}
              style={{
                opacity: active == null || isActive ? 1 : 0.3,
                transition: 'opacity 140ms, stroke-width 140ms',
                cursor: clickable(it) ? 'pointer' : 'default',
              }}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onClick={clickable(it) ? () => onItemClick(it) : undefined}
            />
          );
          offset += dash;
          return seg;
        })}
        <text x={cx} y={cy - 4} textAnchor="middle" fill="var(--fg1)" style={{ pointerEvents: 'none',
          fontFamily: 'var(--f-display)', fontSize: act ? 17 : 20, fontWeight: 600, letterSpacing: '-0.02em' }}>
          {format(act ? act.value : total)}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fill={act ? (act.color || colors[active % colors.length]) : 'var(--fg5)'}
          style={{ pointerEvents: 'none', fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
          {act ? `${act.label} · ${((act.value / total) * 100).toFixed(0)}%` : totalLabel}
        </text>
      </svg>
      <div className="donut-legend">
        {items.map((it, i) => {
          const Tag = clickable(it) ? 'button' : 'div';
          return (
            <Tag key={i} className="donut-row"
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onClick={clickable(it) ? () => onItemClick(it) : undefined}
              title={clickable(it) ? `Filtrar por ${it.label}` : undefined}
              style={{
                opacity: active == null || active === i ? 1 : 0.45,
                transition: 'opacity 140ms',
                cursor: clickable(it) ? 'pointer' : 'default',
                background: 'none', border: 'none', textAlign: 'inherit', width: '100%',
                font: 'inherit', color: 'inherit', padding: 0,
              }}>
              <span className="sw" style={{ background: it.color || colors[i % colors.length] }}/>
              <span className="nm">{it.label}</span>
              <span className="v">{format(it.value)}</span>
              <span className="p">{((it.value / total) * 100).toFixed(0)}%</span>
            </Tag>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Horizontal country bars ----------
// Renderiza os top N (N=10 por default) com bandeira SVG (via flag-icons),
// barra proporcional linear (sem padding artificial), e stats com AOV.
// Países abaixo do threshold são agrupados em uma linha "Outros (N)"
// expandível. onCountryClick (opcional) torna as linhas clicáveis pra
// adicionar país aos filtros globais do dashboard.
const COUNTRY_GROUP_THRESHOLD_USD = 1000;
const COUNTRY_TOP_N = 10;
// flag-icons usa código ISO 3166-1 alpha-2 lowercase. Nossa API usa
// alguns aliases (UK == GB) — normalizamos aqui.
function flagCodeFor(code) {
  const c = (code || '').toUpperCase();
  if (c === 'UK') return 'gb';
  return c.toLowerCase();
}
function CountryBars({ data, currency = 'USD', onCountryClick }) {
  const [expanded, setExpanded] = useStateC(false);
  // Top N que estão acima do threshold. O resto vira "Outros".
  const top = data.filter((d) => d.value >= COUNTRY_GROUP_THRESHOLD_USD).slice(0, COUNTRY_TOP_N);
  const topSet = new Set(top.map((d) => d.code));
  const others = data.filter((d) => !topSet.has(d.code));
  const maxValue = Math.max(1, ...top.map((d) => d.value));
  const othersTotal = others.reduce((s, d) => s + d.value, 0);
  const othersOrders = others.reduce((s, d) => s + d.orders, 0);

  function renderRow(d) {
    const pct = (d.value / maxValue) * 100; // linear, sem padding artificial
    const aov = d.orders > 0 ? d.value / d.orders : 0;
    const code = flagCodeFor(d.code);
    const isClickable = !!onCountryClick;
    const Tag = isClickable ? 'button' : 'div';
    return (
      <Tag
        key={d.code}
        className={`hbar ${isClickable ? 'is-clickable' : ''}`}
        onClick={isClickable ? () => onCountryClick(d.code) : undefined}
        title={isClickable ? `Filtrar por ${d.name}` : undefined}
      >
        <span className={`fi fi-${code}`} aria-label={d.code}/>
        <div className="bar-track">
          <div className="bar" style={{ width: `${pct}%` }}/>
          <span className="nm">{d.name}</span>
        </div>
        <div className="stats">
          <span className="cell-mono">{fmtCurrency(d.value, currency, 0)}</span>
          <span className="d cell-mono"> · {fmtInt(d.orders)} ped · AOV {fmtCurrency(aov, currency, 0)}</span>
        </div>
      </Tag>
    );
  }

  return (
    <div className="hbars">
      {top.map(renderRow)}
      {others.length > 0 && (
        <>
          <button
            className="hbar hbar-others is-clickable"
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? 'Recolher' : 'Expandir países menores'}
          >
            <span className="flag-other">+{others.length}</span>
            <div className="bar-track">
              <span className="nm">Outros · {others.length} {others.length === 1 ? 'país' : 'países'}</span>
            </div>
            <div className="stats">
              <span className="cell-mono">{fmtCurrency(othersTotal, currency, 0)}</span>
              <span className="d cell-mono"> · {fmtInt(othersOrders)} ped</span>
              <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={11}/>
            </div>
          </button>
          {expanded && others.map(renderRow)}
        </>
      )}
    </div>
  );
}

// ---------- Funnel chart ----------
function FunnelChart({ stages, currency }) {
  if (!stages || stages.length === 0) {
    return <div className="funnel" style={{ padding: 24, textAlign: 'center', color: 'var(--fg4)', fontSize: 12 }}>Sem dados de funil no período</div>;
  }
  const topVol = stages[0].volume || 0;
  const maxBarW = 88; // %
  const cur = currency || 'USD';
  return (
    <div className="funnel">
      {stages.map((s, i) => {
        const pctOfTop = topVol > 0 ? s.volume / topVol : 0;
        const barW = Math.max(10, pctOfTop * maxBarW);
        const prevVol = i > 0 ? (stages[i - 1].volume || 0) : 0;
        const dropPct = i > 0 && prevVol > 0 ? 1 - (s.volume / prevVol) : 0;
        const dropClass = dropPct > 0.7 ? 'bad' : dropPct > 0.4 ? 'warn' : 'ok';
        const hasRevenue = s.revenue != null && s.revenue !== undefined;
        return (
          <div key={i} className="funnel-row">
            <div className="funnel-stage">
              <span className="n">{String(i + 1).padStart(2, '0')}</span>
              {s.label}
            </div>
            <div className="funnel-bar-wrap">
              <div className="funnel-bar" style={{ width: `${barW}%` }}>
                {(pctOfTop * 100).toFixed(1)}% of top
              </div>
            </div>
            <div className="funnel-meta">
              <span className="vol">{fmtInt(s.volume)}</span>
              {hasRevenue && (
                <span style={{
                  fontFamily: 'var(--f-mono)', fontSize: 11,
                  color: s.revenue > 0 ? 'var(--glow-cyan)' : 'var(--fg5)',
                  letterSpacing: '0.02em',
                }}>
                  {fmtCurrency(s.revenue, cur, 0)}
                </span>
              )}
              {i > 0 && (
                <span className={`funnel-drop ${dropClass}`}>
                  <Icon name="trending-down" size={10}/>
                  −{(dropPct * 100).toFixed(1)}% vs prev
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- Hour-of-day × Day-of-week heatmap ----------
// data: Array<{ dow:0..6 (Sun-Sat), hour:0..23, orders:number, gross:number }>
// Renders a 7×24 grid in Mon-first order (business convention) with cell
// intensity proportional to orders (or gross via the metric prop).
function HourHeatmap({ data, metric = 'orders', currency = 'USD' }) {
  const [hover, setHover] = useStateC(null);
  const wrapRef = useRefC(null);

  function onCellMove(e, r, h, c) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({ r, h, c, x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  // Pivot input rows into a Mon..Sun × hour matrix. dow 0=Sun → row index 6;
  // dow 1=Mon → row 0.
  const matrix = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ orders: 0, gross: 0 })),
  );
  for (const r of (data || [])) {
    const row = (r.dow + 6) % 7; // Sun(0)→6, Mon(1)→0, ..., Sat(6)→5
    matrix[row][r.hour] = { orders: r.orders, gross: r.gross };
  }

  const values = matrix.flat().map((c) => c[metric]);
  const max = Math.max(1, ...values);

  const ROWS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  // Show subset of hour labels (every 3h) to avoid clutter.
  const HOUR_TICK = (h) => h % 3 === 0;

  function cellColor(v) {
    if (v <= 0) return 'rgba(91,200,255,0.04)';
    const t = Math.min(1, v / max);
    // Cyan ramp matching the dashboard palette.
    return `rgba(91,200,255,${0.08 + t * 0.82})`;
  }

  function fmtCellValue(c) {
    if (metric === 'orders') return fmtInt(c.orders);
    return fmtCurrency(c.gross, currency, 0);
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 6, padding: '8px 0' }}>
      <div/>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(24, 1fr)', gap: 2, fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--fg5)', marginBottom: 4 }}>
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} style={{ textAlign: 'center' }}>{HOUR_TICK(h) ? String(h).padStart(2, '0') : ''}</div>
        ))}
      </div>

      {ROWS.map((label, r) => (
        <React.Fragment key={r}>
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg4)', letterSpacing: '0.04em', alignSelf: 'center', paddingRight: 6, textAlign: 'right' }}>
            {label}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(24, 1fr)', gap: 2 }}>
            {matrix[r].map((c, h) => {
              const isHover = hover && hover.r === r && hover.h === h;
              return (
                <div
                  key={h}
                  onMouseEnter={(e) => onCellMove(e, r, h, c)}
                  onMouseMove={(e) => onCellMove(e, r, h, c)}
                  onMouseLeave={() => setHover(null)}
                  style={{
                    aspectRatio: '1.4',
                    minHeight: 20,
                    background: cellColor(c[metric]),
                    border: isHover ? '1px solid var(--glow-cyan)' : '1px solid transparent',
                    borderRadius: 3,
                    cursor: 'default',
                    transition: 'background 120ms',
                  }}
                />
              );
            })}
          </div>
        </React.Fragment>
      ))}

      {hover && (
        <div style={{
          position: 'absolute',
          left: Math.min(hover.x + 14, (wrapRef.current?.clientWidth ?? 600) - 215),
          top: Math.max(2, hover.y - 44),
          padding: '6px 10px',
          background: 'var(--bg-elev)', backdropFilter: 'blur(14px) saturate(180%)', WebkitBackdropFilter: 'blur(14px) saturate(180%)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--fg2)',
          display: 'flex', gap: 12, whiteSpace: 'nowrap',
          pointerEvents: 'none', zIndex: 3,
          boxShadow: '0 10px 30px -10px rgba(91,200,255,0.35)',
        }}>
          <span>{ROWS[hover.r]} · {String(hover.h).padStart(2, '0')}:00 BRT</span>
          <span style={{ color: 'var(--fg1)' }}>
            {fmtInt(hover.c.orders)} pedidos · {fmtCurrency(hover.c.gross, currency, 0)}
          </span>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { Donut, CountryBars, FunnelChart, HourHeatmap });
