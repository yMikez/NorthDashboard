/* global React */
/* All remaining pages: Funnel, Leaderboard, All Affiliates, Products, Transactions, Settings */

// ---------- FUNNEL ANALYTICS ----------
function FunnelPage({ filters }) {
  const [selectedFunnels, setSelectedFunnels] = useState(new Set(['fx']));

  const allFunnels = [
    { id: 'fx', name: 'FocusRx', color: '#5BC8FF' },
    { id: 'sx', name: 'SleepCore', color: '#8B7FFF' },
    { id: 'mx', name: 'MetaLean', color: '#4A90FF' },
  ];

  const dFrom = dayIndexFromDate(filters.dateRange.start);
  const dTo = dayIndexFromDate(filters.dateRange.end);

  const funnelData = Array.from(selectedFunnels).map(id => {
    const e = window.MOCK.funnelEventsForRange(Math.max(0, dFrom), Math.min(89, dTo), id);
    return { id, name: allFunnels.find(f => f.id === id)?.name || id, events: e };
  });

  const primary = funnelData[0];
  const stages = primary ? [
    { label: 'Landing page views',   volume: primary.events.landing },
    { label: 'VSL engaged',           volume: primary.events.vsl },
    { label: 'Checkout initiated',    volume: primary.events.checkInit },
    { label: 'Checkout completed',    volume: primary.events.checkDone },
    { label: 'Payment approved',      volume: primary.events.approved },
    { label: 'Upsell 1 — shown',      volume: primary.events.up1Shown },
    { label: 'Upsell 1 — accepted',   volume: primary.events.up1Acc },
    { label: 'Upsell 2 — shown',      volume: primary.events.up2Shown },
    { label: 'Upsell 2 — accepted',   volume: primary.events.up2Acc },
  ] : [];

  // upsell/downsell take rates table (aggregated from orders)
  const filtered = useMemo(() => applyFilters(window.MOCK.orders, {
    dateRange: filters.dateRange,
    platforms: filters.platforms,
    products: mapFunnelsToProducts(selectedFunnels.size ? selectedFunnels : new Set(['fx','sx','mx'])),
    countries: filters.countries,
    trafficSources: filters.trafficSources,
  }), [filters, selectedFunnels]);

  // approval by payment method
  const pmAgg = {};
  for (const o of filtered) {
    const k = o.paymentMethod;
    pmAgg[k] = pmAgg[k] || { approved: 0, all: 0, revenue: 0 };
    pmAgg[k].all++;
    if (o.status === 'approved') { pmAgg[k].approved++; pmAgg[k].revenue += o.grossAmount; }
  }
  const pmRows = Object.entries(pmAgg).sort((a,b) => b[1].all - a[1].all);

  // upsell take rate by step (from all orders in range)
  const takeSteps = ['fx','sx','mx'].filter(f => selectedFunnels.size === 0 || selectedFunnels.has(f)).flatMap(f => {
    // pairs: fe->up1, up1->up2, fe->bump
    return [
      { key: f + '-up1', label: `${allFunnels.find(x=>x.id===f).name} → Upsell 1`, step: 'up1', funnel: f },
      { key: f + '-up2', label: `${allFunnels.find(x=>x.id===f).name} → Upsell 2`, step: 'up2', funnel: f },
      { key: f + '-bp',  label: `${allFunnels.find(x=>x.id===f).name} → Bump`,     step: 'bump', funnel: f },
    ];
  });
  const takeData = takeSteps.map(s => {
    let shown = 0, accepted = 0, revenue = 0;
    for (const o of filtered) {
      if (o.status !== 'approved') continue;
      if (!o.productId.startsWith(s.funnel)) continue;
      if (o.productType === 'frontend') shown++;
      if (s.step === 'up1' && o.productId.endsWith('up1')) { accepted++; revenue += o.grossAmount; }
      if (s.step === 'up2' && o.productId.endsWith('up2')) { accepted++; revenue += o.grossAmount; }
      if (s.step === 'bump' && o.productType === 'bump') { accepted++; revenue += o.grossAmount; }
    }
    return { ...s, shown, accepted, rate: shown ? accepted / shown : 0, revenue };
  });

  // AOV lift
  const feOnly = filtered.filter(o => o.status === 'approved' && o.productType === 'frontend');
  const avgFE = feOnly.length ? feOnly.reduce((s, o) => s + o.grossAmount, 0) / feOnly.length : 0;
  const grossByGroup = {};
  for (const o of filtered) {
    if (o.status !== 'approved') continue;
    grossByGroup[o.orderGroup] = grossByGroup[o.orderGroup] || { gross: 0, hasUp1: false, hasUp2: false };
    grossByGroup[o.orderGroup].gross += o.grossAmount;
    if (o.productType === 'upsell' && o.productId.endsWith('up1')) grossByGroup[o.orderGroup].hasUp1 = true;
    if (o.productType === 'upsell' && o.productId.endsWith('up2')) grossByGroup[o.orderGroup].hasUp2 = true;
  }
  const groups = Object.values(grossByGroup);
  const withUp1 = groups.filter(g => g.hasUp1 && !g.hasUp2);
  const withUp12 = groups.filter(g => g.hasUp1 && g.hasUp2);
  const avgUp1 = withUp1.length ? withUp1.reduce((s, g) => s + g.gross, 0) / withUp1.length : 0;
  const avgUp12 = withUp12.length ? withUp12.reduce((s, g) => s + g.gross, 0) / withUp12.length : 0;

  // funnel conv time series (approved/landing per day — simplified)
  const convBuckets = bucketByDay(filtered, filters.dateRange).map((b, i) => {
    const dIdx = dFrom + i;
    const funnelsInUse = selectedFunnels.size ? Array.from(selectedFunnels) : ['fx','sx','mx'];
    let lp = 0;
    funnelsInUse.forEach(f => {
      const e = window.MOCK.funnelEventsForRange(dIdx, dIdx, f);
      lp += e.landing;
    });
    return { ...b, landing: lp, convRate: lp ? b.approvedOrders / lp : 0 };
  });

  const cur = filters.currency;

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">FUNNEL ANALYTICS</span>
          <h2>Where the funnel <em>leaks</em>.</h2>
          <span className="sub">Stage-by-stage drop-off · compare up to 3 funnels side by side</span>
        </div>
        <div className="page-head-actions">
          <div className="seg">
            {allFunnels.map(f => (
              <button key={f.id} className={selectedFunnels.has(f.id) ? 'is-active' : ''}
                onClick={() => {
                  const s = new Set(selectedFunnels);
                  if (s.has(f.id)) s.delete(f.id); else s.add(f.id);
                  if (s.size === 0) s.add('fx');
                  if (s.size > 3) return;
                  setSelectedFunnels(s);
                }}>
                {f.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main funnel */}
      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-head">
          <div className="panel-title">
            <span className="panel-eyebrow">PRIMARY FUNNEL · {primary?.name.toUpperCase()}</span>
            <div className="panel-sub">Volume and drop-off · drop-offs &gt;70% flagged in red</div>
          </div>
          <div className="panel-legend">
            <span className="legend-dot cyan"><span/>{fmtInt(stages[0]?.volume || 0)} LANDING → {fmtInt(stages[4]?.volume || 0)} APPROVED</span>
          </div>
        </div>
        <FunnelChart stages={stages}/>
      </div>

      {/* Take rates + AOV lift */}
      <div className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">
              <span className="panel-eyebrow">UPSELL / DOWNSELL TAKE RATES</span>
              <div className="panel-sub">% of approved checkouts that accept each upsell</div>
            </div>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Offer step</th><th className="num">Shown</th><th className="num">Accepted</th><th className="num">Take rate</th><th className="num">Revenue</th></tr>
              </thead>
              <tbody>
                {takeData.map(t => (
                  <tr key={t.key}>
                    <td>{t.label}</td>
                    <td className="num cell-mono">{fmtInt(t.shown)}</td>
                    <td className="num cell-mono">{fmtInt(t.accepted)}</td>
                    <td className="num cell-mono" style={{ color: t.rate > 0.25 ? 'var(--success)' : t.rate > 0.12 ? 'var(--warning)' : 'var(--danger)' }}>
                      {(t.rate * 100).toFixed(1)}%
                    </td>
                    <td className="num cell-mono">{fmtCurrency(t.revenue, cur, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">
              <span className="panel-eyebrow">AOV LIFT — BY STACK</span>
              <div className="panel-sub">Average order value with/without upsells</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, padding: '10px 0' }}>
            {[
              { label: 'FE only', value: avgFE, color: '#8CA1C8' },
              { label: 'FE + Upsell 1', value: avgUp1 || avgFE * 1.8, color: '#5BC8FF' },
              { label: 'FE + Upsell 1 + 2', value: avgUp12 || avgFE * 2.6, color: '#4A90FF' },
            ].map((r, i) => {
              const maxV = Math.max(avgFE, avgUp1, avgUp12) || 1;
              const liftPct = i === 0 ? 0 : (r.value - avgFE) / avgFE;
              return (
                <div key={r.label} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 90px', gap: 12, alignItems: 'center' }}>
                  <div style={{ fontSize: 12, color: 'var(--navy-100)' }}>{r.label}</div>
                  <div style={{ position: 'relative', height: 26, background: 'rgba(91,200,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', inset: 0, width: `${(r.value / maxV) * 100}%`,
                      background: `linear-gradient(90deg, ${r.color}, ${r.color}44)`, borderRadius: 4,
                      display: 'flex', alignItems: 'center', paddingLeft: 10,
                      fontFamily: 'var(--f-display)', fontSize: 14, color: 'var(--white)', letterSpacing: '-0.01em',
                      fontVariationSettings: "'opsz' 48, 'SOFT' 40"
                    }}>
                      {fmtCurrency(r.value, cur, 0)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', fontFamily: 'var(--f-mono)', fontSize: 11, color: i === 0 ? 'var(--navy-400)' : 'var(--success)' }}>
                    {i === 0 ? '—' : `+${(liftPct * 100).toFixed(0)}% lift`}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Approval by payment method */}
      <div className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">
              <span className="panel-eyebrow">APPROVAL RATE · BY PAYMENT METHOD</span>
              <div className="panel-sub">Tier 1 international card approval varies widely</div>
            </div>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Method</th><th className="num">Attempts</th><th className="num">Approved</th><th>Rate</th><th className="num">Revenue</th></tr></thead>
              <tbody>
                {pmRows.map(([k, v]) => {
                  const rate = v.all ? v.approved / v.all : 0;
                  const cls = rate > 0.78 ? 'ok' : rate > 0.65 ? 'warn' : 'bad';
                  return (
                    <tr key={k}>
                      <td><Icon name="credit-card" size={12} className="" /> <span style={{ marginLeft: 8 }}>{k}</span></td>
                      <td className="num cell-mono">{fmtInt(v.all)}</td>
                      <td className="num cell-mono">{fmtInt(v.approved)}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="cell-mono" style={{ minWidth: 44 }}>{(rate * 100).toFixed(1)}%</span>
                          <div className={`ratebar ${cls}`}><span style={{ width: `${rate * 100}%` }}/></div>
                        </div>
                      </td>
                      <td className="num cell-mono">{fmtCurrency(v.revenue, cur, 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">
              <span className="panel-eyebrow">FUNNEL CONVERSION OVER TIME</span>
              <div className="panel-sub">Landing → approved · watch for VSL regressions</div>
            </div>
            <div className="panel-legend"><span className="legend-dot cyan"><span/>CONV RATE</span></div>
          </div>
          <ConvLineChart buckets={convBuckets}/>
        </div>
      </div>
    </div>
  );
}

function ConvLineChart({ buckets }) {
  const [hover, setHover] = useState(null);
  const ref = useRef(null);
  const W = 1000, H = 260, PAD_L = 50, PAD_R = 20, PAD_T = 20, PAD_B = 30;
  const innerW = W - PAD_L - PAD_R, innerH = H - PAD_T - PAD_B;
  const vals = buckets.map(b => b.convRate);
  const max = Math.max(0.01, ...vals) * 1.1;
  const xFor = (i) => PAD_L + (buckets.length <= 1 ? 0 : (i / (buckets.length - 1)) * innerW);
  const yFor = (v) => PAD_T + innerH - (v / max) * innerH;
  const path = 'M' + buckets.map((b, i) => `${xFor(i)} ${yFor(b.convRate)}`).join(' L ');
  const area = path + ` L ${xFor(buckets.length - 1)} ${PAD_T + innerH} L ${PAD_L} ${PAD_T + innerH} Z`;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => t * max);
  const labIdx = Array.from({ length: Math.min(6, buckets.length) }).map((_, i) => Math.round(i / 5 * (buckets.length - 1)));
  function onMove(e) {
    const rect = ref.current.getBoundingClientRect();
    const scale = W / rect.width;
    const x = (e.clientX - rect.left) * scale - PAD_L;
    if (x < 0 || x > innerW) { setHover(null); return; }
    setHover(Math.round((x / innerW) * (buckets.length - 1)));
  }
  return (
    <div style={{ position: 'relative' }}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="chart-svg" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <defs><linearGradient id="gradCyan2" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#5BC8FF" stopOpacity="0.35"/>
          <stop offset="100%" stopColor="#5BC8FF" stopOpacity="0"/>
        </linearGradient></defs>
        <g className="chart-grid">{yTicks.map((t, i) => <line key={i} x1={PAD_L} x2={W - PAD_R} y1={yFor(t)} y2={yFor(t)}/>)}</g>
        <g className="chart-axis">{yTicks.map((t, i) => <text key={i} x={PAD_L - 8} y={yFor(t) + 3} textAnchor="end">{(t * 100).toFixed(1)}%</text>)}</g>
        <g className="chart-axis">{labIdx.map(i => <text key={i} x={xFor(i)} y={H - 10} textAnchor="middle">{fmtDateShort(buckets[i].date)}</text>)}</g>
        <path d={area} fill="url(#gradCyan2)"/>
        <path d={path} className="chart-line"/>
        {hover != null && (
          <>
            <line className="chart-tt-line" x1={xFor(hover)} x2={xFor(hover)} y1={PAD_T} y2={PAD_T + innerH}/>
            <circle cx={xFor(hover)} cy={yFor(buckets[hover].convRate)} r="4" className="chart-dot"/>
          </>
        )}
      </svg>
    </div>
  );
}

// ---------- AFFILIATE LEADERBOARD ----------
function LeaderboardPage({ filters, onOpenAffiliate }) {
  const [sortBy, setSortBy] = useState('revenue');
  const [minOrders, setMinOrders] = useState(1);
  const [state, setLbState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    setLbState((s) => ({ ...s, status: 'loading' }));
    window.NSApi.fetchAffiliates(filters)
      .then((data) => { if (!cancelled) setLbState({ status: 'ready', data, error: null }); })
      .catch((err) => {
        if (cancelled) return;
        console.error('fetchAffiliates failed', err);
        setLbState({ status: 'error', data: null, error: err.message });
      });
    return () => { cancelled = true; };
  }, [filters.dateRange.start.getTime(), filters.dateRange.end.getTime(),
      Array.from(filters.platforms).join(','), Array.from(filters.countries).join(',')]);

  const cur = filters.currency || 'USD';
  const all = state.data?.affiliates || [];
  const summary = state.data?.summary || { activeNow: 0, activePrev: 0, concentration: 0, newAff: 0, churnedAff: 0 };

  const rows = all.filter((a) => a.allOrders >= minOrders).sort((a, b) => {
    switch (sortBy) {
      case 'orders': return b.orders - a.orders;
      case 'netMargin': return b.netMargin - a.netMargin;
      case 'approvalRate': return b.approvalRate - a.approvalRate;
      case 'refundRate': return a.refundRate - b.refundRate;
      case 'chargebackRate': return a.cbRate - b.cbRate;
      default: return b.revenue - a.revenue;
    }
  });

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">AFFILIATES · LEADERBOARD</span>
          <h2>Who's <em>pulling the weight</em>.</h2>
          <span className="sub">Volume vs. toxicity · flagged rows need attention</span>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-ghost"><Icon name="download" size={12}/> Export CSV</button>
        </div>
      </div>

      <div className="mini-kpis">
        <div className="mini-kpi">
          <div className="l">Active affiliates</div>
          <div className="v">{summary.activeNow}</div>
          <div className="s">
            <span style={{ color: summary.activeNow >= summary.activePrev ? 'var(--success)' : 'var(--danger)' }}>
              {summary.activeNow >= summary.activePrev ? '↗' : '↘'} {Math.abs(summary.activeNow - summary.activePrev)}
            </span> vs prev period
          </div>
        </div>
        <div className={`mini-kpi ${summary.concentration > 0.6 ? 'is-alert' : ''}`}
          style={summary.concentration > 0.6 ? { borderColor: 'rgba(239,68,68,0.35)' } : {}}>
          <div className="l">Top 5 concentration</div>
          <div className="v" style={summary.concentration > 0.6 ? { color: 'var(--danger)' } : {}}>
            {(summary.concentration * 100).toFixed(0)}%
          </div>
          <div className="s">{summary.concentration > 0.6 ? '⚠ concentration risk · over 60%' : 'healthy distribution'}</div>
        </div>
        <div className="mini-kpi">
          <div className="l">New affiliates</div>
          <div className="v">{summary.newAff}</div>
          <div className="s">first sale in period</div>
        </div>
        <div className="mini-kpi">
          <div className="l">Churned</div>
          <div className="v" style={{ color: summary.churnedAff > 3 ? 'var(--warning)' : 'inherit' }}>{summary.churnedAff}</div>
          <div className="s">active prev · silent now</div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0 12px', flexWrap: 'wrap' }}>
        <span className="f-label">SORT BY</span>
        <div className="seg">
          {[['revenue','Revenue'],['orders','Orders'],['netMargin','Net margin'],['approvalRate','Approval'],['refundRate','Refunds'],['chargebackRate','Chargebacks']].map(([k,l]) => (
            <button key={k} className={sortBy === k ? 'is-active' : ''} onClick={() => setSortBy(k)}>{l}</button>
          ))}
        </div>
        <span className="f-label" style={{ marginLeft: 10 }}>MIN ORDERS</span>
        <div className="seg">
          {[1, 5, 10, 25].map(n => (
            <button key={n} className={minOrders === n ? 'is-active' : ''} onClick={() => setMinOrders(n)}>{n}+</button>
          ))}
        </div>
      </div>

      {state.status === 'error' && (
        <div className="panel" style={{ color: 'var(--danger)' }}>Erro ao carregar: {state.error}</div>
      )}

      <div className="panel" style={{ padding: 0 }}>
        <div className="tbl-wrap" style={{ margin: 0, padding: '0 4px', maxHeight: 620, overflowY: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 36 }}>#</th>
                <th>Affiliate</th>
                <th>Platform</th>
                <th className="num">Orders</th>
                <th className="num">Gross rev.</th>
                <th>Approval</th>
                <th className="num">Refund</th>
                <th className="num">Chargeback</th>
                <th className="num">CPA paid</th>
                <th className="num">Net margin</th>
                <th>Top country</th>
                <th>30d trend</th>
              </tr>
            </thead>
            <tbody>
              {state.status === 'loading' && (
                <tr><td colSpan={12} style={{ textAlign: 'center', padding: 24, opacity: 0.6 }}>Carregando...</td></tr>
              )}
              {state.status === 'ready' && rows.length === 0 && (
                <tr><td colSpan={12} style={{ textAlign: 'center', padding: 24, opacity: 0.6 }}>
                  Nenhum afiliado com pelo menos {minOrders} pedido{minOrders > 1 ? 's' : ''} no período
                </td></tr>
              )}
              {rows.map((r, i) => {
                const apClass = r.approvalRate > 0.7 ? 'val-ok' : r.approvalRate > 0.5 ? 'val-warn' : 'val-bad';
                const rfClass = r.refundRate < 0.06 ? 'val-ok' : r.refundRate < 0.12 ? 'val-warn' : 'val-bad';
                const cbClass = r.cbRate < 0.005 ? 'val-ok' : r.cbRate < 0.01 ? 'val-warn' : 'val-bad';
                const platClass = r.platformSlug === 'digistore24' ? 'plat-d24' : 'plat-cb';
                const platShort = r.platformSlug === 'digistore24' ? 'D24' : 'CB';
                const displayName = r.nickname || r.externalId;
                return (
                  <tr key={`${r.platformSlug}:${r.externalId}`} onClick={() => onOpenAffiliate(r.externalId)}>
                    <td className="rank">{String(i+1).padStart(2, '0')}</td>
                    <td>
                      <span className="cell-aff">
                        <span className="av" style={{ background: avatarColor(r.externalId) }}>{initials(displayName)}</span>
                        <span className="meta">
                          <span className="nm">{displayName}</span>
                          <span className="id">{r.externalId}</span>
                        </span>
                      </span>
                    </td>
                    <td><span className={`plat ${platClass}`}>{platShort}</span></td>
                    <td className="num cell-mono">{fmtInt(r.orders)}</td>
                    <td className="num cell-mono" style={{ color: 'var(--white)' }}>{fmtCurrency(r.revenue, cur, 0)}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className={`cell-mono ${apClass}`} style={{ minWidth: 44 }}>{(r.approvalRate * 100).toFixed(1)}%</span>
                        <div className={`ratebar ${apClass === 'val-ok' ? 'ok' : apClass === 'val-warn' ? 'warn' : 'bad'}`} style={{ width: 48 }}><span style={{ width: `${r.approvalRate * 100}%` }}/></div>
                      </div>
                    </td>
                    <td className={`num cell-mono ${rfClass}`}>{(r.refundRate * 100).toFixed(1)}%</td>
                    <td className={`num cell-mono ${cbClass}`}>{(r.cbRate * 100).toFixed(2)}%</td>
                    <td className="num cell-mono">{fmtCurrency(r.cpa, cur, 0)}</td>
                    <td className="num cell-mono" style={{ color: r.netMargin > 0 ? 'var(--success)' : 'var(--danger)' }}>{fmtCurrency(r.netMargin, cur, 0)}</td>
                    <td className="cell-mono">{r.topCountry || '—'}</td>
                    <td><Sparkline data={r.sparkline && r.sparkline.length ? r.sparkline : [0,0]} width={80} height={18} fill={false}/></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------- AFFILIATE DRAWER (drill-down) ----------
function AffiliateDrawer({ affiliateId, filters, onClose }) {
  const aff = window.MOCK.affiliates.find(a => a.id === affiliateId);
  if (!aff) {
    return (
      <>
        <div className="drawer-backdrop" onClick={onClose}/>
        <div className="drawer">
          <div className="drawer-head">
            <div className="drawer-aff">
              <div className="av-lg">?</div>
              <div>
                <h3>{affiliateId}</h3>
                <div className="sub">Drill-down em construção — endpoint /api/metrics/affiliates/:id vem na próxima fase</div>
              </div>
            </div>
            <button className="icon-btn" onClick={onClose}><Icon name="x" size={14}/></button>
          </div>
          <div className="drawer-body" style={{ opacity: 0.7 }}>
            <div className="panel">
              <div className="panel-head">
                <div className="panel-title">
                  <span className="panel-eyebrow">EM BREVE</span>
                  <div className="panel-sub">
                    Por enquanto, use a Leaderboard/All affiliates pra ver números consolidados desse afiliado.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  const filtered = window.MOCK.orders.filter(o => o.affiliateId === affiliateId);
  const inRange = filtered.filter(o => {
    const t = new Date(o.createdAt).getTime();
    return t >= filters.dateRange.start.getTime() && t <= filters.dateRange.end.getTime();
  });
  const k = aggregateKPIs(inRange);
  const buckets = bucketByDay(inRange, filters.dateRange);

  // flags
  const flags = [];
  if (k.cbRate > 0.01) flags.push({ kind: 'bad', title: 'High chargeback rate', desc: `${(k.cbRate * 100).toFixed(2)}% chargebacks — above 1.0% MCC threshold. Review traffic quality and payment method mix.` });
  if (k.refundRate > 0.12) flags.push({ kind: 'warn', title: 'Refund rate elevated', desc: `${(k.refundRate * 100).toFixed(1)}% refunds vs 6% benchmark. Check post-purchase promises on landing pages.` });
  if (k.approvalRate < 0.55) flags.push({ kind: 'bad', title: 'Low approval rate', desc: `Only ${(k.approvalRate * 100).toFixed(1)}% of checkouts approved. Common in cold traffic or aggressive retargeting.` });

  // by offer
  const byOffer = {};
  for (const o of inRange) {
    if (o.status !== 'approved') continue;
    byOffer[o.productId] = byOffer[o.productId] || { revenue: 0, orders: 0 };
    byOffer[o.productId].revenue += o.grossAmount;
    byOffer[o.productId].orders += 1;
  }

  const cur = filters.currency;

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose}/>
      <div className="drawer">
        <div className="drawer-head">
          <div className="drawer-aff">
            <div className="av-lg" style={{ background: avatarColor(aff.id) }}>{initials(aff.name)}</div>
            <div>
              <h3>{aff.nickname}</h3>
              <div className="sub">{aff.id} · {aff.name} · joined {aff.joinedDaysAgo}d ago</div>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>
        <div className="drawer-body">
          <div className="mini-kpis">
            <div className="mini-kpi"><div className="l">Revenue</div><div className="v">{fmtCurrency(k.gross, cur, 0)}</div><div className="s">{fmtInt(k.approvedCount)} approved orders</div></div>
            <div className="mini-kpi"><div className="l">Approval rate</div><div className="v">{(k.approvalRate * 100).toFixed(1)}%</div><div className="s">{fmtInt(k.totalCount)} attempts</div></div>
            <div className="mini-kpi"><div className="l">Refund rate</div><div className="v">{(k.refundRate * 100).toFixed(1)}%</div><div className="s">target &lt;6%</div></div>
            <div className="mini-kpi"><div className="l">Chargeback</div><div className="v" style={{ color: k.cbRate > 0.01 ? 'var(--danger)' : 'inherit' }}>{(k.cbRate * 100).toFixed(2)}%</div><div className="s">MCC limit 1.0%</div></div>
          </div>

          {flags.length > 0 && (
            <div className="panel">
              <div className="panel-head">
                <div className="panel-title">
                  <span className="panel-eyebrow">AUTO FLAGS</span>
                  <div className="panel-sub">Detected from current period</div>
                </div>
              </div>
              <div className="drawer-flags">
                {flags.map((f, i) => (
                  <div key={i} className={`flag-card ${f.kind}`}>
                    <Icon name="alert-triangle" size={14}/>
                    <div className="ft"><div className="t">{f.title}</div><div className="d">{f.desc}</div></div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="panel">
            <div className="panel-head">
              <div className="panel-title">
                <span className="panel-eyebrow">REVENUE · PERIOD</span>
                <div className="panel-sub">Daily gross for {aff.nickname}</div>
              </div>
            </div>
            <LineChart buckets={buckets} metric="gross" height={200} currency={cur}/>
          </div>

          <div className="panel">
            <div className="panel-head">
              <div className="panel-title">
                <span className="panel-eyebrow">BREAKDOWN BY OFFER</span>
              </div>
            </div>
            <table className="tbl">
              <thead><tr><th>Offer</th><th className="num">Orders</th><th className="num">Revenue</th></tr></thead>
              <tbody>
                {Object.entries(byOffer).sort((a,b) => b[1].revenue - a[1].revenue).map(([pid, v]) => {
                  const p = window.MOCK.PRODUCTS.find(x => x.id === pid);
                  return <tr key={pid}><td>{p?.name || pid}</td><td className="num cell-mono">{fmtInt(v.orders)}</td><td className="num cell-mono">{fmtCurrency(v.revenue, cur, 0)}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------- ALL AFFILIATES ----------
function AllAffiliatesPage({ filters, onOpenAffiliate }) {
  const [query, setQuery] = useState('');
  const [state, setAllState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    setAllState((s) => ({ ...s, status: 'loading' }));
    window.NSApi.fetchAffiliates(filters)
      .then((data) => { if (!cancelled) setAllState({ status: 'ready', data, error: null }); })
      .catch((err) => {
        if (cancelled) return;
        console.error('fetchAffiliates failed', err);
        setAllState({ status: 'error', data: null, error: err.message });
      });
    return () => { cancelled = true; };
  }, [filters.dateRange.start.getTime(), filters.dateRange.end.getTime(),
      Array.from(filters.platforms).join(','), Array.from(filters.countries).join(',')]);

  const cur = filters.currency || 'USD';
  const all = state.data?.affiliates || [];
  const q = query.toLowerCase();
  const rows = (q
    ? all.filter((r) => (r.nickname || '').toLowerCase().includes(q) || r.externalId.toLowerCase().includes(q))
    : all
  ).slice().sort((a, b) => b.revenue - a.revenue);

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">AFFILIATES · DIRECTORY</span>
          <h2>All <em>affiliates</em></h2>
          <span className="sub">{rows.length} total · searchable · export-ready</span>
        </div>
        <div className="page-head-actions">
          <div className="select-btn" style={{ padding: '0 10px', width: 260 }}>
            <Icon name="search" size={13}/>
            <input value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by nickname or ID..."
              style={{ background: 'transparent', border: 0, color: 'var(--white)', outline: 'none', flex: 1, fontFamily: 'var(--f-body)', fontSize: 12 }}
            />
          </div>
          <button className="btn btn-ghost"><Icon name="download" size={12}/> Export CSV</button>
        </div>
      </div>

      {state.status === 'error' && (
        <div className="panel" style={{ color: 'var(--danger)' }}>Erro ao carregar: {state.error}</div>
      )}

      <div className="panel" style={{ padding: 0 }}>
        <div className="tbl-wrap" style={{ margin: 0, padding: '0 4px', maxHeight: 720, overflowY: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Affiliate</th><th>Platform</th>
                <th className="num">Rev · period</th><th className="num">Orders · period</th>
                <th className="num">Approval</th><th className="num">Refund</th>
                <th className="num">LTV revenue</th><th className="num">LTV orders</th>
                <th>First sale</th><th>Last sale</th><th></th>
              </tr>
            </thead>
            <tbody>
              {state.status === 'loading' && (
                <tr><td colSpan={11} style={{ textAlign: 'center', padding: 24, opacity: 0.6 }}>Carregando...</td></tr>
              )}
              {state.status === 'ready' && rows.length === 0 && (
                <tr><td colSpan={11} style={{ textAlign: 'center', padding: 24, opacity: 0.6 }}>
                  {query ? 'Nenhum afiliado encontrado' : 'Nenhum afiliado ainda'}
                </td></tr>
              )}
              {rows.map((r) => {
                const displayName = r.nickname || r.externalId;
                const platClass = r.platformSlug === 'digistore24' ? 'plat-d24' : 'plat-cb';
                const platShort = r.platformSlug === 'digistore24' ? 'D24' : 'CB';
                return (
                  <tr key={`${r.platformSlug}:${r.externalId}`} onClick={() => onOpenAffiliate(r.externalId)}>
                    <td>
                      <span className="cell-aff">
                        <span className="av" style={{ background: avatarColor(r.externalId) }}>{initials(displayName)}</span>
                        <span className="meta"><span className="nm">{displayName}</span><span className="id">{r.externalId}</span></span>
                      </span>
                    </td>
                    <td><span className={`plat ${platClass}`}>{platShort}</span></td>
                    <td className="num cell-mono">{fmtCurrency(r.revenue, cur, 0)}</td>
                    <td className="num cell-mono">{fmtInt(r.orders)}</td>
                    <td className="num cell-mono" style={{ color: r.approvalRate > 0.7 ? 'var(--success)' : r.approvalRate > 0.5 ? 'var(--warning)' : 'var(--danger)' }}>
                      {r.allOrders ? (r.approvalRate * 100).toFixed(1) + '%' : '—'}
                    </td>
                    <td className="num cell-mono">{r.allOrders ? (r.refundRate * 100).toFixed(1) + '%' : '—'}</td>
                    <td className="num cell-mono">{fmtCurrency(r.ltvRevenue, cur, 0)}</td>
                    <td className="num cell-mono">{fmtInt(r.ltvOrders)}</td>
                    <td className="cell-mono">{r.firstSeenAt ? fmtDateShort(r.firstSeenAt) : '—'}</td>
                    <td className="cell-mono">{r.lastOrderAt ? fmtDateShort(r.lastOrderAt) : '—'}</td>
                    <td><Icon name="chevron-right" size={13}/></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------- PRODUCTS ----------
function ProductsPage({ filters }) {
  const [state, setProdState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    setProdState((s) => ({ ...s, status: 'loading' }));
    window.NSApi.fetchProducts(filters)
      .then((data) => { if (!cancelled) setProdState({ status: 'ready', data, error: null }); })
      .catch((err) => {
        if (cancelled) return;
        console.error('fetchProducts failed', err);
        setProdState({ status: 'error', data: null, error: err.message });
      });
    return () => { cancelled = true; };
  }, [filters.dateRange.start.getTime(), filters.dateRange.end.getTime(),
      Array.from(filters.platforms).join(','), Array.from(filters.countries).join(',')]);

  const cur = filters.currency || 'USD';
  const byType = state.data?.byType || [];
  const products = state.data?.products || [];

  const TYPE_META = {
    FRONTEND: { label: 'Frontend', icon: 'target', accent: '#5BC8FF', tag: 'Entrada do funil' },
    UPSELL:   { label: 'Upsell',   icon: 'arrow-up-right', accent: '#4A90FF', tag: 'Escalada pós-FE' },
    BUMP:     { label: 'Bump',     icon: 'plus', accent: '#8B7FFF', tag: 'Add-on de checkout' },
    DOWNSELL: { label: 'Downsell', icon: 'arrow-down-right', accent: '#6b84b8', tag: 'Recuperação pós-recusa' },
  };

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">PRODUCTS · OFFERS</span>
          <h2>Catalog <em>performance</em></h2>
          <span className="sub">Por tipo de produto · SKUs consolidados abaixo</span>
        </div>
      </div>

      {state.status === 'error' && (
        <div className="panel" style={{ color: 'var(--danger)' }}>Erro ao carregar: {state.error}</div>
      )}

      <div className="prod-grid">
        {state.status === 'loading' && (
          <div className="panel" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 24, opacity: 0.6 }}>
            Carregando...
          </div>
        )}
        {byType.map((bucket) => {
          const meta = TYPE_META[bucket.productType] || { label: bucket.productType, icon: 'package', accent: '#5BC8FF', tag: '' };
          const margin = bucket.net - bucket.cpa;
          const marginPct = bucket.revenue ? margin / bucket.revenue : 0;
          const aov = bucket.orders ? bucket.revenue / bucket.orders : 0;
          return (
            <div key={bucket.productType} className="prod-card">
              <div className="prod-thumb" style={{ color: meta.accent }}>
                <Icon name={meta.icon} size={36} stroke={1.2}/>
              </div>
              <div>
                <div className="prod-name">{meta.label}</div>
                <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--navy-400)', letterSpacing: '0.08em', marginTop: 2 }}>
                  {meta.tag.toUpperCase()}
                </div>
              </div>
              <div className="prod-plat">
                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--navy-400)', marginLeft: 'auto' }}>
                  {bucket.productCount} SKUs
                </span>
              </div>
              <div className="prod-stats">
                <div className="prod-stat"><div className="l">Revenue</div><div className="v">{fmtCurrency(bucket.revenue, cur, 0)}</div></div>
                <div className="prod-stat"><div className="l">Orders</div><div className="v">{fmtInt(bucket.orders)}</div></div>
                <div className="prod-stat"><div className="l">AOV</div><div className="v sm">{fmtCurrency(aov, cur, 0)}</div></div>
                <div className="prod-stat"><div className="l">CPA</div><div className="v sm">{fmtCurrency(bucket.cpa, cur, 0)}</div></div>
                <div className="prod-stat"><div className="l">Net margin</div><div className="v sm" style={{ color: margin > 0 ? 'var(--success)' : 'var(--danger)' }}>{fmtCurrency(margin, cur, 0)}</div></div>
                <div className="prod-stat"><div className="l">Margin %</div><div className="v sm" style={{ color: marginPct > 0.2 ? 'var(--success)' : marginPct > 0.1 ? 'var(--warning)' : 'var(--danger)' }}>{(marginPct * 100).toFixed(1)}%</div></div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="panel" style={{ marginTop: 14 }}>
        <div className="panel-head">
          <div className="panel-title">
            <span className="panel-eyebrow">SKU · LINE DETAIL</span>
            <div className="panel-sub">Todos os produtos no catálogo ({products.length} SKUs)</div>
          </div>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Product</th>
                <th>External ID</th>
                <th>Type</th>
                <th>Platform</th>
                <th>Vendor</th>
                <th className="num">Orders</th>
                <th className="num">Approval</th>
                <th className="num">Revenue</th>
                <th className="num">Net margin</th>
                <th className="num">CPA</th>
                <th>Last sale</th>
              </tr>
            </thead>
            <tbody>
              {state.status === 'loading' && (
                <tr><td colSpan={11} style={{ textAlign: 'center', padding: 24, opacity: 0.6 }}>Carregando...</td></tr>
              )}
              {state.status === 'ready' && products.length === 0 && (
                <tr><td colSpan={11} style={{ textAlign: 'center', padding: 24, opacity: 0.6 }}>Sem produtos no período</td></tr>
              )}
              {products.map((p) => {
                const platClass = p.platformSlug === 'digistore24' ? 'plat-d24' : 'plat-cb';
                const platShort = p.platformSlug === 'digistore24' ? 'D24' : 'CB';
                const apColor = p.approvalRate > 0.7 ? 'var(--success)' : p.approvalRate > 0.5 ? 'var(--warning)' : 'var(--danger)';
                const margin = p.net - p.cpa;
                return (
                  <tr key={`${p.platformSlug}:${p.externalId}`}>
                    <td>{p.name}</td>
                    <td className="cell-mono" style={{ color: 'var(--navy-300)' }}>{p.externalId}</td>
                    <td><span className="badge neutral">{p.productType.toLowerCase()}</span></td>
                    <td><span className={`plat ${platClass}`}>{platShort}</span></td>
                    <td className="cell-mono" style={{ color: 'var(--navy-300)' }}>{p.vendorAccount || '—'}</td>
                    <td className="num cell-mono">{fmtInt(p.orders)}</td>
                    <td className="num cell-mono" style={{ color: apColor }}>
                      {p.allOrders ? (p.approvalRate * 100).toFixed(1) + '%' : '—'}
                    </td>
                    <td className="num cell-mono">{fmtCurrency(p.revenue, cur, 0)}</td>
                    <td className="num cell-mono" style={{ color: margin > 0 ? 'var(--success)' : 'var(--danger)' }}>
                      {fmtCurrency(margin, cur, 0)}
                    </td>
                    <td className="num cell-mono">{fmtCurrency(p.cpa, cur, 0)}</td>
                    <td className="cell-mono">{p.lastSoldAt ? fmtDateShort(p.lastSoldAt) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------- TRANSACTIONS ----------
function TransactionsPage({ filters }) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [state, setStateTx] = useState({ status: 'loading', data: null, error: null });

  // Debounce search input so we don't hammer the endpoint on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setStateTx((s) => ({ ...s, status: 'loading' }));
    window.NSApi.fetchOrders(filters, { status: statusFilter, search: debouncedQuery, limit: 500 })
      .then((data) => {
        if (cancelled) return;
        setStateTx({ status: 'ready', data, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('fetchOrders failed', err);
        setStateTx({ status: 'error', data: null, error: err.message });
      });
    return () => { cancelled = true; };
  }, [filters.dateRange.start.getTime(), filters.dateRange.end.getTime(),
      Array.from(filters.platforms).join(','), Array.from(filters.countries).join(','),
      statusFilter, debouncedQuery]);

  const cur = filters.currency || 'USD';
  const orders = state.data?.orders || [];
  const statusCounts = state.data?.statusCounts || {};
  const total = state.data?.total ?? 0;
  const showing = orders.length;

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">TRANSACTIONS · LEDGER</span>
          <h2>Every <em>order</em>, every line.</h2>
          <span className="sub">
            Raw stream · {fmtInt(showing)} of {fmtInt(total)} rows{showing < total ? ' · 500 row cap · use filters to narrow' : ''}
          </span>
        </div>
        <div className="page-head-actions">
          <div className="select-btn" style={{ padding: '0 10px', width: 240 }}>
            <Icon name="search" size={13}/>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search Order ID / Affiliate..."
              style={{ background: 'transparent', border: 0, color: 'var(--white)', outline: 'none', flex: 1, fontFamily: 'var(--f-mono)', fontSize: 12 }}/>
          </div>
          <button className="btn btn-ghost"><Icon name="download" size={12}/> CSV</button>
          <button className="btn btn-ghost"><Icon name="download" size={12}/> XLSX</button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0 12px', flexWrap: 'wrap' }}>
        <span className="f-label">STATUS</span>
        <div className="seg">
          {[['all','All'],['approved','Approved'],['pending','Pending'],['refunded','Refunded'],['chargeback','Chargeback']].map(([k, l]) => (
            <button key={k} className={statusFilter === k ? 'is-active' : ''} onClick={() => setStatusFilter(k)}>
              {l}<span style={{ marginLeft: 6, opacity: 0.5 }}>{fmtInt(statusCounts[k] || 0)}</span>
            </button>
          ))}
        </div>
      </div>

      {state.status === 'error' && (
        <div className="panel" style={{ color: 'var(--danger)' }}>Erro ao carregar: {state.error}</div>
      )}

      <div className="panel" style={{ padding: 0 }}>
        <div className="tbl-wrap" style={{ margin: 0, padding: '0 4px', maxHeight: 720, overflowY: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Date/time</th><th>Order</th><th>Platform</th>
                <th>Product</th><th>Affiliate</th>
                <th>Country</th><th>Payment</th>
                <th className="num">Gross</th><th className="num">Fees</th>
                <th className="num">Net</th>
                <th>Status</th>
                <th className="num">CPA</th>
              </tr>
            </thead>
            <tbody>
              {state.status === 'loading' && (
                <tr><td colSpan={12} style={{ textAlign: 'center', padding: 24, opacity: 0.6 }}>Carregando...</td></tr>
              )}
              {state.status === 'ready' && orders.length === 0 && (
                <tr><td colSpan={12} style={{ textAlign: 'center', padding: 24, opacity: 0.6 }}>Nenhuma transação no período</td></tr>
              )}
              {orders.map((o) => {
                const platClass = o.platformSlug === 'digistore24' ? 'plat-d24' : 'plat-cb';
                const platShort = o.platformSlug === 'digistore24' ? 'D24' : 'CB';
                const statusLc = o.status.toLowerCase();
                return (
                  <tr key={`${o.platformSlug}:${o.externalId}`}>
                    <td className="cell-mono">{fmtDateTime(o.orderedAt)}</td>
                    <td className="cell-mono">{o.externalId}</td>
                    <td><span className={`plat ${platClass}`}>{platShort}</span></td>
                    <td>{o.productName || o.productExternalId}</td>
                    <td className="cell-mono">{o.affiliateNickname || o.affiliateExternalId || '—'}</td>
                    <td className="cell-mono">{o.country || '—'}</td>
                    <td className="cell-mono">{o.paymentMethod || '—'}</td>
                    <td className="num cell-mono">{fmtCurrency(o.grossAmountUsd, cur, 2)}</td>
                    <td className="num cell-mono" style={{ color: 'var(--navy-400)' }}>{fmtCurrency(o.fees, cur, 2)}</td>
                    <td className="num cell-mono">{fmtCurrency(o.netAmountUsd, cur, 2)}</td>
                    <td><span className={`st st-${statusLc}`}>{statusLc}</span></td>
                    <td className="num cell-mono">{fmtCurrency(o.cpaPaidUsd, cur, 2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------- SETTINGS (integrations, FX, users) ----------
function IntegrationsPage({ filters }) {
  const [state, setPlatState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    setPlatState((s) => ({ ...s, status: 'loading' }));
    window.NSApi.fetchPlatforms(filters)
      .then((data) => { if (!cancelled) setPlatState({ status: 'ready', data, error: null }); })
      .catch((err) => {
        if (cancelled) return;
        console.error('fetchPlatforms failed', err);
        setPlatState({ status: 'error', data: null, error: err.message });
      });
    return () => { cancelled = true; };
  }, [filters.dateRange.start.getTime(), filters.dateRange.end.getTime(),
      Array.from(filters.countries).join(',')]);

  const cur = filters.currency || 'USD';
  const platforms = state.data?.platforms || [];

  const PLATFORM_SHORT = { digistore24: 'D24', clickbank: 'CB' };
  const comingSoon = [
    { slug: 'buygoods', displayName: 'BuyGoods', short: 'BG', desc: 'Connector pendente · credenciais não configuradas' },
    { slug: 'maxweb', displayName: 'MaxWeb', short: 'MW', desc: 'Connector pendente · credenciais não configuradas' },
    { slug: 'stickyio', displayName: 'Sticky.io', short: 'SK', desc: 'Connector em desenvolvimento' },
  ].filter((p) => !platforms.some((x) => x.slug === p.slug));

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">SYSTEM · PLATAFORMAS</span>
          <h2>Platform <em>overview</em></h2>
          <span className="sub">Receita, pedidos e saúde dos connectors por plataforma no período selecionado</span>
        </div>
      </div>

      {state.status === 'error' && (
        <div className="panel" style={{ color: 'var(--danger)' }}>Erro ao carregar: {state.error}</div>
      )}

      <div className="grid-3">
        {state.status === 'loading' && (
          <div className="panel" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 24, opacity: 0.6 }}>
            Carregando...
          </div>
        )}

        {platforms.map((p) => {
          const short = PLATFORM_SHORT[p.slug] || p.slug.slice(0, 3).toUpperCase();
          const syncLabel = p.lastSyncAt ? fmtSyncAgo(p.lastSyncAt) : 'nunca';
          const apClass = p.approvalRate > 0.7 ? 'val-ok' : p.approvalRate > 0.5 ? 'val-warn' : 'val-bad';
          const healthy = p.isActive && p.lastSyncAt;
          return (
            <div key={p.slug} className="ph-card">
              <div className="ph-head">
                <div className="ph-name">
                  <div className="ph-logo">{short}</div>
                  <div className="txt">
                    <span className="nm">{p.displayName}</span>
                    <span className="sync">Synced {syncLabel}</span>
                  </div>
                </div>
                {healthy
                  ? <span className="ph-status ok"><span className="led"/>HEALTHY</span>
                  : <span className="badge warn">NO SYNC YET</span>
                }
              </div>

              <div className="ph-stats">
                <div className="ph-stat">
                  <div className="l">Revenue · período</div>
                  <div className="v">{fmtCurrency(p.totalRevenue, cur, 0)}</div>
                </div>
                <div className="ph-stat">
                  <div className="l">Orders approved</div>
                  <div className="v">{fmtInt(p.totalOrders)}</div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
                <div className="ph-stat">
                  <div className="l">Approval</div>
                  <div className={`v cell-mono ${apClass}`} style={{ fontSize: 18 }}>
                    {p.allOrders ? (p.approvalRate * 100).toFixed(1) + '%' : '—'}
                  </div>
                </div>
                <div className="ph-stat">
                  <div className="l">Affiliates ativos</div>
                  <div className="v" style={{ fontSize: 18 }}>
                    {fmtInt(p.affiliatesActive)}
                    <span style={{ fontSize: 11, color: 'var(--navy-300)', marginLeft: 6 }}>
                      / {fmtInt(p.affiliatesTotal)} total
                    </span>
                  </div>
                </div>
              </div>

              {p.topProduct && (
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(91,200,255,0.15)' }}>
                  <div style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--navy-300)', marginBottom: 4 }}>
                    TOP PRODUCT
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--white)', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.topProduct.name}
                    </span>
                    <span className="cell-mono" style={{ color: 'var(--glow-cyan)' }}>
                      {fmtCurrency(p.topProduct.revenue, cur, 0)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {comingSoon.map((p) => (
          <div key={p.slug} className="ph-card" style={{ borderStyle: 'dashed', opacity: 0.7 }}>
            <div className="ph-head">
              <div className="ph-name">
                <div className="ph-logo" style={{ color: 'var(--navy-400)' }}>{p.short}</div>
                <div className="txt">
                  <span className="nm">{p.displayName}</span>
                  <span className="sync">Not configured</span>
                </div>
              </div>
              <span className="badge neutral">SOON</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--navy-200)', lineHeight: 1.5, marginTop: 8 }}>
              {p.desc}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Helper: format relative "synced X ago" from ISO timestamp
function fmtSyncAgo(iso) {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `${mins} min atrás`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h atrás`;
  const days = Math.round(hrs / 24);
  return `${days}d atrás`;
}

function FXPage({ filters }) {
  const rates = [
    { code: 'USD', rate: 1.0000, updated: 'Base' },
    { code: 'EUR', rate: 0.9218, updated: 'Apr 23 · 08:00 UTC' },
    { code: 'GBP', rate: 0.7931, updated: 'Apr 23 · 08:00 UTC' },
    { code: 'CAD', rate: 1.3742, updated: 'Apr 23 · 08:00 UTC' },
    { code: 'AUD', rate: 1.5518, updated: 'Apr 23 · 08:00 UTC' },
    { code: 'NZD', rate: 1.6802, updated: 'Apr 23 · 08:00 UTC' },
  ];
  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">SETTINGS · FX / CURRENCY</span>
          <h2>Rate <em>table</em></h2>
          <span className="sub">Daily snapshots · applied at time of order for historical accuracy</span>
        </div>
      </div>
      <div className="panel">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Currency</th><th className="num">Rate · vs USD</th><th>Last updated</th><th>Source</th><th></th></tr></thead>
            <tbody>
              {rates.map(r => (
                <tr key={r.code}>
                  <td><span className="plat plat-cb">{r.code}</span></td>
                  <td className="num cell-mono">{r.rate.toFixed(4)}</td>
                  <td className="cell-mono">{r.updated}</td>
                  <td className="cell-mono" style={{ color: 'var(--navy-300)' }}>ECB · daily</td>
                  <td><button className="btn btn-ghost"><Icon name="refresh" size={12}/> Refresh</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function UsersPage() {
  const users = [
    { name: 'Luiza Mendes', role: 'OWNER · ADMIN', email: 'luiza@northscale.io', last: '2 min ago' },
    { name: 'Marcelo Dias', role: 'FINANCE', email: 'marcelo@northscale.io', last: '1 hr ago' },
    { name: 'Ana Ruiz',     role: 'AFFILIATE MANAGER', email: 'ana@northscale.io', last: '3 hr ago' },
    { name: 'Theo Park',    role: 'ANALYST', email: 'theo@northscale.io', last: 'Yesterday' },
    { name: 'Juno Vale',    role: 'ANALYST · READ-ONLY', email: 'juno@northscale.io', last: '3 days ago' },
  ];
  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">SETTINGS · USERS & PERMISSIONS</span>
          <h2>Team <em>access</em></h2>
          <span className="sub">5 members · role-based permissions</span>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-primary"><Icon name="plus" size={12}/> Invite member</button>
        </div>
      </div>
      <div className="panel">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Member</th><th>Role</th><th>Email</th><th>Last active</th><th></th></tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.email}>
                  <td>
                    <span className="cell-aff">
                      <span className="av" style={{ background: avatarColor(u.email) }}>{initials(u.name)}</span>
                      <span className="meta"><span className="nm">{u.name}</span></span>
                    </span>
                  </td>
                  <td><span className="badge">{u.role}</span></td>
                  <td className="cell-mono" style={{ color: 'var(--navy-200)' }}>{u.email}</td>
                  <td className="cell-mono" style={{ color: 'var(--navy-400)' }}>{u.last}</td>
                  <td><button className="btn btn-ghost">Manage</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, {
  FunnelPage, LeaderboardPage, AffiliateDrawer, AllAffiliatesPage,
  ProductsPage, TransactionsPage, IntegrationsPage, FXPage, UsersPage,
});
