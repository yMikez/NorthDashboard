/* global React */
/* Chart components: line/area with tooltip, donut, horizontal bar, funnel. */

const { useState: useStateC, useMemo: useMemoC, useRef: useRefC } = React;

// ---------- Line + area chart with tooltip ----------
function LineChart({ buckets, compareBuckets, metric, height = 280, currency = 'USD' }) {
  const [hover, setHover] = useStateC(null);
  const ref = useRefC(null);

  const W = 1000, H = height, PAD_L = 54, PAD_R = 24, PAD_T = 20, PAD_B = 30;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const series = buckets.map(b => ({
    date: b.date,
    gross: b.gross,
    net: b.net,
    profit: b.profit ?? 0,
    orders: b.approvedOrders,
    aov: b.approvedOrders ? b.gross / b.approvedOrders : 0,
    approvalRate: b.allOrders ? b.approvedOrders / b.allOrders : 0,
  }));
  const compareSeries = compareBuckets ? compareBuckets.map(b => ({
    date: b.date, gross: b.gross, net: b.net,
    profit: b.profit ?? 0,
    orders: b.approvedOrders,
    aov: b.approvedOrders ? b.gross / b.approvedOrders : 0,
    approvalRate: b.allOrders ? b.approvedOrders / b.allOrders : 0,
  })) : null;

  const vals = series.map(s => s[metric]);
  const cmpVals = compareSeries ? compareSeries.map(s => s[metric]) : [];
  // Profit can go negative (loss days); allow chart min < 0 only for that metric.
  const max = Math.max(1, ...vals, ...cmpVals);
  const min = metric === 'profit' ? Math.min(0, ...vals, ...cmpVals) : 0;

  const xFor = (i) => PAD_L + (series.length <= 1 ? 0 : (i / (series.length - 1)) * innerW);
  const yFor = (v) => PAD_T + innerH - ((v - min) / (max - min)) * innerH;

  const path = 'M' + series.map((s, i) => `${xFor(i)} ${yFor(s[metric])}`).join(' L ');
  const area = path + ` L ${xFor(series.length - 1)} ${PAD_T + innerH} L ${PAD_L} ${PAD_T + innerH} Z`;
  const cmpPath = compareSeries ? 'M' + compareSeries.map((s, i) => `${xFor(i)} ${yFor(s[metric])}`).join(' L ') : '';

  // y-axis ticks
  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }).map((_, i) => min + (max - min) * (i / ticks));
  // x labels: pick ~6 evenly spaced. Guard nLabels===1 to avoid 0/0 → NaN
  // index that crashes series[NaN].date (happens with the "today" preset when
  // daily has a single bucket).
  const nLabels = Math.min(7, series.length);
  const xLabelIdx = nLabels <= 1
    ? (series.length > 0 ? [0] : [])
    : Array.from({ length: nLabels }).map((_, i) => Math.round((i / (nLabels - 1)) * (series.length - 1)));

  function fmtYLabel(v) {
    if (metric === 'approvalRate') return (v * 100).toFixed(0) + '%';
    if (metric === 'orders') return fmtK(v);
    if (metric === 'aov') return '$' + v.toFixed(0);
    return '$' + fmtK(v);
  }
  function fmtTTValue(v) {
    if (metric === 'approvalRate') return (v * 100).toFixed(1) + '%';
    if (metric === 'orders') return fmtInt(v);
    if (metric === 'aov') return fmtCurrency(v, currency, 2);
    return fmtCurrency(v, currency, 0);
  }

  function onMove(e) {
    const rect = ref.current.getBoundingClientRect();
    const scale = W / rect.width;
    const x = (e.clientX - rect.left) * scale;
    const relX = x - PAD_L;
    if (relX < 0 || relX > innerW) { setHover(null); return; }
    const idx = Math.max(0, Math.min(series.length - 1, Math.round((relX / innerW) * (series.length - 1))));
    setHover(idx);
  }

  return (
    <div style={{ position: 'relative' }}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="chart-svg"
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="gradCyan" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#5BC8FF" stopOpacity="0.35"/>
            <stop offset="100%" stopColor="#5BC8FF" stopOpacity="0"/>
          </linearGradient>
        </defs>
        {/* grid */}
        <g className="chart-grid">
          {yTicks.map((t, i) => (
            <line key={i} x1={PAD_L} x2={W - PAD_R} y1={yFor(t)} y2={yFor(t)}/>
          ))}
        </g>
        {/* y axis labels */}
        <g className="chart-axis">
          {yTicks.map((t, i) => (
            <text key={i} x={PAD_L - 10} y={yFor(t) + 3} textAnchor="end">{fmtYLabel(t)}</text>
          ))}
        </g>
        {/* x axis labels */}
        <g className="chart-axis">
          {xLabelIdx.map((i) => (
            <text key={i} x={xFor(i)} y={H - 10} textAnchor="middle">{fmtDateShort(series[i].date)}</text>
          ))}
        </g>
        {/* prev period */}
        {cmpPath && <path d={cmpPath} className="chart-line prev"/>}
        {/* area + line */}
        <path d={area} className="chart-area"/>
        <path d={path} className="chart-line"/>

        {/* hover */}
        {hover != null && (
          <g>
            <line className="chart-tt-line" x1={xFor(hover)} x2={xFor(hover)} y1={PAD_T} y2={PAD_T + innerH}/>
            <circle cx={xFor(hover)} cy={yFor(series[hover][metric])} r="4" className="chart-dot"/>
          </g>
        )}
      </svg>
      {hover != null && (() => {
        const left = Math.min(85, Math.max(2, (xFor(hover) / W) * 100));
        const cur = series[hover][metric];
        const prev = compareSeries ? compareSeries[hover]?.[metric] : null;
        const delta = prev != null && prev !== 0 ? (cur - prev) / prev : null;
        return (
          <div style={{
            position: 'absolute', left: `${left}%`, top: 10,
            transform: 'translateX(-50%)',
            background: 'rgba(3,6,23,0.98)', border: '1px solid var(--border)',
            borderRadius: 6, padding: '8px 10px', minWidth: 140, pointerEvents: 'none',
            fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--navy-100)', letterSpacing: '0.02em',
            boxShadow: '0 10px 30px -10px rgba(91,200,255,0.35)', zIndex: 2
          }}>
            <div style={{ fontSize: 10, color: 'var(--navy-400)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
              {fmtDateLong(series[hover].date)}
            </div>
            <div style={{ color: 'var(--white)', fontSize: 15, fontFamily: 'var(--f-display)', marginBottom: 2 }}>
              {fmtTTValue(cur)}
            </div>
            {delta != null && (
              <div style={{ color: delta >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                {delta >= 0 ? '↗' : '↘'} {(delta * 100).toFixed(1)}% vs prev
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ---------- Donut ----------
function Donut({ items, totalLabel = 'Total', format = (v) => fmtCurrency(v) }) {
  const total = items.reduce((s, it) => s + it.value, 0) || 1;
  const r = 60, cx = 75, cy = 75, stroke = 16;
  const C = 2 * Math.PI * r;
  let offset = 0;
  const colors = ['#5BC8FF', '#4A90FF', '#8B7FFF', '#a8b7d8', '#6b84b8'];
  return (
    <div className="donut-wrap">
      <svg className="donut" viewBox="0 0 150 150">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(91,200,255,0.08)" strokeWidth={stroke}/>
        {items.map((it, i) => {
          const frac = it.value / total;
          const dash = C * frac;
          const seg = (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none"
              stroke={it.color || colors[i % colors.length]} strokeWidth={stroke}
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          );
          offset += dash;
          return seg;
        })}
        <text x={cx} y={cy - 4} textAnchor="middle" fill="#fff"
          style={{ fontFamily: 'var(--f-display)', fontSize: 20, fontWeight: 500, letterSpacing: '-0.02em', fontVariationSettings: "'opsz' 48, 'SOFT' 40" }}>
          {format(total)}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fill="#8CA1C8"
          style={{ fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
          {totalLabel}
        </text>
      </svg>
      <div className="donut-legend">
        {items.map((it, i) => (
          <div key={i} className="donut-row">
            <span className="sw" style={{ background: it.color || colors[i % colors.length] }}/>
            <span className="nm">{it.label}</span>
            <span className="v">{format(it.value)}</span>
            <span className="p">{((it.value / total) * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Horizontal country bars ----------
function CountryBars({ data, maxValue, currency = 'USD' }) {
  return (
    <div className="hbars">
      {data.map((d) => {
        const pct = Math.max(3, (d.value / maxValue) * 100);
        return (
          <div key={d.code} className={`hbar ${d.code.toLowerCase()}`}>
            <div className="flag">{d.code}</div>
            <div className="bar-track">
              <div className="bar" style={{ width: `${pct}%` }}/>
              <span className="nm">{d.name}</span>
            </div>
            <div className="stats">
              <span>{fmtCurrency(d.value, currency, 0)}</span>
              <span className="d"> · {fmtInt(d.orders)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- Funnel chart ----------
function FunnelChart({ stages }) {
  if (!stages || stages.length === 0) {
    return <div className="funnel" style={{ padding: 24, textAlign: 'center', color: 'var(--navy-300)', fontSize: 12 }}>Sem dados de funil no período</div>;
  }
  const topVol = stages[0].volume || 0;
  const maxBarW = 88; // %
  return (
    <div className="funnel">
      {stages.map((s, i) => {
        const pctOfTop = topVol > 0 ? s.volume / topVol : 0;
        const barW = Math.max(10, pctOfTop * maxBarW);
        const prevVol = i > 0 ? (stages[i - 1].volume || 0) : 0;
        const dropPct = i > 0 && prevVol > 0 ? 1 - (s.volume / prevVol) : 0;
        const dropClass = dropPct > 0.7 ? 'bad' : dropPct > 0.4 ? 'warn' : 'ok';
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
    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 6, padding: '8px 0' }}>
      <div/>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(24, 1fr)', gap: 2, fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--navy-400)', marginBottom: 4 }}>
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} style={{ textAlign: 'center' }}>{HOUR_TICK(h) ? String(h).padStart(2, '0') : ''}</div>
        ))}
      </div>

      {ROWS.map((label, r) => (
        <React.Fragment key={r}>
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--navy-300)', letterSpacing: '0.04em', alignSelf: 'center', paddingRight: 6, textAlign: 'right' }}>
            {label}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(24, 1fr)', gap: 2 }}>
            {matrix[r].map((c, h) => {
              const isHover = hover && hover.r === r && hover.h === h;
              return (
                <div
                  key={h}
                  onMouseEnter={() => setHover({ r, h, c })}
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
          gridColumn: '2 / 3',
          marginTop: 8,
          padding: '6px 10px',
          background: 'rgba(6,13,37,0.95)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--navy-100)',
          display: 'flex', justifyContent: 'space-between', gap: 12,
        }}>
          <span>{ROWS[hover.r]} · {String(hover.h).padStart(2, '0')}:00 UTC</span>
          <span style={{ color: 'var(--white)' }}>
            {fmtInt(hover.c.orders)} pedidos · {fmtCurrency(hover.c.gross, currency, 0)}
          </span>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { LineChart, Donut, CountryBars, FunnelChart, HourHeatmap });
