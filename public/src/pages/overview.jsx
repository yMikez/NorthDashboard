/* global React */
/* Overview page: 8 KPIs, main time chart, breakdowns, top 5, platform health. */

function KpiCard({ label, value, unit, delta, trend, sparkData, icon, alert, hint }) {
  const deltaClass = trend === 'up' ? 'up' : trend === 'down' ? 'down' : 'flat';
  return (
    <div className={`kpi ${alert ? 'is-alert' : ''}`}>
      <span className="corner-tl"/>
      <span className="corner-br"/>
      <div className="kpi-row">
        <span className="kpi-label">{label}</span>
        <span className="kpi-icon"><Icon name={icon} size={12}/></span>
      </div>
      <div className="kpi-value">
        {value}{unit && <span className="unit">{unit}</span>}
      </div>
      <div className="kpi-foot">
        <span className={`delta ${deltaClass}`}>
          <Icon name={trend === 'up' ? 'arrow-up-right' : trend === 'down' ? 'arrow-down-right' : 'trending-up'} size={10}/>
          {delta}
          <span className="vs">{hint || 'vs prev'}</span>
        </span>
        {sparkData && <Sparkline data={sparkData} color={alert ? '#EF4444' : '#5BC8FF'}/>}
      </div>
    </div>
  );
}

function OverviewPage({ filters }) {
  const filteredOrders = useMemo(() => applyFilters(window.MOCK.orders, {
    dateRange: filters.dateRange,
    platforms: filters.platforms,
    products: mapFunnelsToProducts(filters.funnels),
    countries: filters.countries,
    trafficSources: filters.trafficSources,
  }), [filters]);

  const prevRange = useMemo(() => previousRange(filters.dateRange), [filters.dateRange]);
  const prevOrders = useMemo(() => applyFilters(window.MOCK.orders, {
    dateRange: prevRange,
    platforms: filters.platforms,
    products: mapFunnelsToProducts(filters.funnels),
    countries: filters.countries,
    trafficSources: filters.trafficSources,
  }), [filters, prevRange]);

  const kpi = aggregateKPIs(filteredOrders);
  const kpiPrev = aggregateKPIs(prevOrders);
  const buckets = useMemo(() => bucketByDay(filteredOrders, filters.dateRange), [filteredOrders, filters.dateRange]);
  const cmpBuckets = useMemo(() => bucketByDay(prevOrders, prevRange), [prevOrders, prevRange]);

  const [metric, setMetric] = useState('gross');

  function deltaFor(cur, prev) {
    if (prev === 0) return { delta: '+∞', trend: 'up' };
    const d = (cur - prev) / prev;
    return {
      delta: (d >= 0 ? '+' : '') + (d * 100).toFixed(1) + '%',
      trend: d >= 0.002 ? 'up' : d <= -0.002 ? 'down' : 'flat'
    };
  }

  const sparkGross = buckets.map(b => b.gross);
  const sparkNet = buckets.map(b => b.net);
  const sparkOrders = buckets.map(b => b.approvedOrders);
  const sparkAov = buckets.map(b => b.approvedOrders ? b.gross / b.approvedOrders : 0);

  const approvalSpark = buckets.map(b => b.allOrders ? b.approvedOrders / b.allOrders : 0);
  const refundSpark = buckets.map(b => {
    // recount refunds from orders isn't tracked in buckets; use a proxy via allOrders-approvedOrders
    return b.allOrders ? (b.allOrders - b.approvedOrders) / b.allOrders * 0.5 : 0;
  });

  // product-type breakdown (approved only)
  const typeBreakdown = {};
  for (const o of filteredOrders) {
    if (o.status !== 'approved') continue;
    typeBreakdown[o.productType] = (typeBreakdown[o.productType] || 0) + o.grossAmount;
  }
  const typeItems = [
    { label: 'Front-end', value: typeBreakdown.frontend || 0, color: '#5BC8FF' },
    { label: 'Upsell',    value: typeBreakdown.upsell   || 0, color: '#4A90FF' },
    { label: 'Bump',      value: typeBreakdown.bump     || 0, color: '#8B7FFF' },
    { label: 'Downsell',  value: typeBreakdown.downsell || 0, color: '#6b84b8' },
  ];

  // country breakdown
  const countryAgg = {};
  for (const o of filteredOrders) {
    if (o.status !== 'approved') continue;
    countryAgg[o.country] = countryAgg[o.country] || { value: 0, orders: 0 };
    countryAgg[o.country].value += o.grossAmount;
    countryAgg[o.country].orders += 1;
  }
  const countryData = window.MOCK.COUNTRIES.map(c => ({
    code: c.code, name: c.name,
    value: countryAgg[c.code]?.value || 0,
    orders: countryAgg[c.code]?.orders || 0,
  })).filter(c => c.value > 0).sort((a, b) => b.value - a.value).slice(0, 8);
  const maxCountry = Math.max(1, ...countryData.map(c => c.value));

  // top 5 affiliates
  const affAgg = {};
  for (const o of filteredOrders) {
    const a = affAgg[o.affiliateId] = affAgg[o.affiliateId] || {
      revenue: 0, orders: 0, approvedOrders: 0, allOrders: 0, cpa: 0, net: 0
    };
    a.revenue += o.grossAmount;
    a.cpa += o.cpaPaid;
    a.net += o.netAmount;
    a.allOrders++;
    if (o.status === 'approved') { a.approvedOrders++; a.orders++; }
  }
  const topAffs = Object.entries(affAgg)
    .map(([id, a]) => ({ id, ...a, approvalRate: a.allOrders ? a.approvedOrders / a.allOrders : 0 }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  // platform health
  const platAgg = {};
  for (const o of filteredOrders) {
    const a = platAgg[o.platform] = platAgg[o.platform] || { revenue: 0, orders: 0 };
    a.revenue += o.grossAmount;
    if (o.status === 'approved') a.orders++;
  }

  const cur = filters.currency;

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">APRIL · 2026 · TIER 1 GLOBAL</span>
          <h2>Operation <em>at a glance</em></h2>
          <span className="sub">Last synced 2m ago · America/New_York · All channels unified</span>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-ghost"><Icon name="calendar" size={12}/> Schedule report</button>
          <button className="btn btn-primary"><Icon name="plus" size={12}/> Build view</button>
        </div>
      </div>

      {/* 8 KPI cards */}
      <div className="kpi-grid">
        <KpiCard label="GROSS REVENUE" icon="dollar"
          value={fmtCurrency(kpi.gross, cur, 0)}
          {...deltaFor(kpi.gross, kpiPrev.gross)}
          sparkData={sparkGross}
        />
        <KpiCard label="NET REVENUE" icon="wallet"
          value={fmtCurrency(kpi.net, cur, 0)}
          {...deltaFor(kpi.net, kpiPrev.net)}
          sparkData={sparkNet}
        />
        <KpiCard label="ORDERS APPROVED" icon="shopping-cart"
          value={fmtInt(kpi.approvedCount)}
          {...deltaFor(kpi.approvedCount, kpiPrev.approvedCount)}
          sparkData={sparkOrders}
        />
        <KpiCard label="AOV" icon="trending-up"
          value={fmtCurrency(kpi.aov, cur, 2)}
          {...deltaFor(kpi.aov, kpiPrev.aov)}
          sparkData={sparkAov}
        />
        <KpiCard label="APPROVAL RATE" icon="check"
          value={(kpi.approvalRate * 100).toFixed(1)} unit="%"
          {...deltaFor(kpi.approvalRate, kpiPrev.approvalRate)}
          sparkData={approvalSpark}
        />
        <KpiCard label="REFUND RATE" icon="refresh"
          value={(kpi.refundRate * 100).toFixed(2)} unit="%"
          {...deltaFor(kpi.refundRate, kpiPrev.refundRate)}
          trend={kpi.refundRate > kpiPrev.refundRate ? 'down' : 'up'}
          sparkData={refundSpark}
        />
        <KpiCard label="CHARGEBACK RATE" icon="alert-triangle"
          alert={kpi.cbRate > 0.009}
          value={(kpi.cbRate * 100).toFixed(2)} unit="%"
          {...deltaFor(kpi.cbRate, kpiPrev.cbRate)}
          trend={kpi.cbRate > kpiPrev.cbRate ? 'down' : 'up'}
          hint={kpi.cbRate > 0.009 ? 'over threshold' : 'vs prev'}
          sparkData={buckets.map((_, i) => 0.005 + (i / buckets.length) * 0.004 + Math.sin(i) * 0.0015)}
        />
        <KpiCard label="NET PROFIT" icon="target"
          value={fmtCurrency(kpi.netProfit, cur, 0)}
          {...deltaFor(kpi.netProfit, kpiPrev.netProfit)}
          sparkData={buckets.map(b => b.net - b.cpa - b.gross * 0.12)}
        />
      </div>

      {/* Time chart */}
      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-head">
          <div className="panel-title">
            <span className="panel-eyebrow">TIME SERIES · DAILY</span>
            <div className="panel-metric">
              {metric === 'gross' && <>{fmtCurrency(kpi.gross, cur, 0)}
                <span className={`delta ${deltaFor(kpi.gross, kpiPrev.gross).trend}`}>{deltaFor(kpi.gross, kpiPrev.gross).delta}</span></>}
              {metric === 'net' && <>{fmtCurrency(kpi.net, cur, 0)}
                <span className={`delta ${deltaFor(kpi.net, kpiPrev.net).trend}`}>{deltaFor(kpi.net, kpiPrev.net).delta}</span></>}
              {metric === 'orders' && <>{fmtInt(kpi.approvedCount)}
                <span className={`delta ${deltaFor(kpi.approvedCount, kpiPrev.approvedCount).trend}`}>{deltaFor(kpi.approvedCount, kpiPrev.approvedCount).delta}</span></>}
              {metric === 'aov' && <>{fmtCurrency(kpi.aov, cur, 2)}
                <span className={`delta ${deltaFor(kpi.aov, kpiPrev.aov).trend}`}>{deltaFor(kpi.aov, kpiPrev.aov).delta}</span></>}
              {metric === 'approvalRate' && <>{(kpi.approvalRate * 100).toFixed(1)}%
                <span className={`delta ${deltaFor(kpi.approvalRate, kpiPrev.approvalRate).trend}`}>{deltaFor(kpi.approvalRate, kpiPrev.approvalRate).delta}</span></>}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div className="metric-seg">
              {[['gross','Gross'],['net','Net'],['orders','Orders'],['aov','AOV'],['approvalRate','Approval']].map(([k, l]) => (
                <button key={k} className={`metric-opt ${metric === k ? 'is-active' : ''}`} onClick={() => setMetric(k)}>{l}</button>
              ))}
            </div>
            <div className="panel-legend">
              <span className="legend-dot cyan"><span/>{filters.preset.toUpperCase()}</span>
              {filters.compare && <span className="legend-dot dim"><span/>PREV</span>}
            </div>
          </div>
        </div>
        <LineChart buckets={buckets} compareBuckets={filters.compare ? cmpBuckets : null}
          metric={metric} currency={cur} height={260}/>
      </div>

      {/* Row 3: breakdowns */}
      <div className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">
              <span className="panel-eyebrow">REVENUE BY PRODUCT TYPE</span>
              <div className="panel-sub">Approved orders only · gross</div>
            </div>
          </div>
          <Donut items={typeItems} totalLabel="Approved" format={(v) => fmtCurrency(v, cur, 0)}/>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">
              <span className="panel-eyebrow">REVENUE BY COUNTRY</span>
              <div className="panel-sub">Top 8 · approved gross</div>
            </div>
            <button className="btn btn-ghost"><Icon name="map" size={12}/> View on map</button>
          </div>
          <CountryBars data={countryData} maxValue={maxCountry} currency={cur}/>
        </div>
      </div>

      {/* Row 4: Top affiliates + platform health */}
      <div className="grid-2-asym">
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">
              <span className="panel-eyebrow">TOP 5 AFFILIATES</span>
              <div className="panel-sub">Ranked by gross revenue</div>
            </div>
            <button className="btn btn-ghost">View all <Icon name="chevron-right" size={12}/></button>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 28 }}>#</th>
                  <th>Affiliate</th>
                  <th>Platform</th>
                  <th className="num">Orders</th>
                  <th className="num">Revenue</th>
                  <th className="num">Approval</th>
                  <th className="num">Net margin</th>
                </tr>
              </thead>
              <tbody>
                {topAffs.map((a, i) => {
                  const aff = window.MOCK.affiliates.find(x => x.id === a.id);
                  if (!aff) return null;
                  const apProfit = a.net - a.cpa;
                  const apClass = a.approvalRate > 0.7 ? 'val-ok' : a.approvalRate > 0.5 ? 'val-warn' : 'val-bad';
                  return (
                    <tr key={a.id}>
                      <td className="rank">{String(i+1).padStart(2, '0')}</td>
                      <td>
                        <span className="cell-aff">
                          <span className="av" style={{ background: avatarColor(a.id) }}>{initials(aff.name)}</span>
                          <span className="meta">
                            <span className="nm">{aff.nickname}</span>
                            <span className="id">{aff.id} · {aff.name}</span>
                          </span>
                        </span>
                      </td>
                      <td><span className={`plat plat-${aff.platform === 'digistore24' ? 'd24' : 'cb'}`}>{aff.platform === 'digistore24' ? 'D24' : 'CB'}</span></td>
                      <td className="num cell-mono">{fmtInt(a.approvedOrders)}</td>
                      <td className="num cell-mono">{fmtCurrency(a.revenue, cur, 0)}</td>
                      <td className={`num cell-mono ${apClass}`}>{(a.approvalRate * 100).toFixed(1)}%</td>
                      <td className="num cell-mono" style={{ color: apProfit > 0 ? 'var(--success)' : 'var(--danger)' }}>
                        {fmtCurrency(apProfit, cur, 0)}
                      </td>
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
              <span className="panel-eyebrow">PLATFORM HEALTH</span>
              <div className="panel-sub">Live connector status</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <PlatformHealth id="digistore24" name="Digistore24" short="D24" ok revenue={platAgg.digistore24?.revenue || 0} orders={platAgg.digistore24?.orders || 0} lastSync="2 min ago" currency={cur}/>
            <PlatformHealth id="clickbank" name="ClickBank" short="CB" ok revenue={platAgg.clickbank?.revenue || 0} orders={platAgg.clickbank?.orders || 0} lastSync="4 min ago" currency={cur}/>
            <div className="ph-card" style={{ borderStyle: 'dashed', opacity: 0.7 }}>
              <div className="ph-head">
                <div className="ph-name">
                  <div className="ph-logo" style={{ color: 'var(--navy-400)' }}><Icon name="plus" size={16}/></div>
                  <div className="txt">
                    <span className="nm">Add new platform</span>
                    <span className="sync">BuyGoods · MaxWeb · Sticky.io</span>
                  </div>
                </div>
                <span className="badge neutral">Soon</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlatformHealth({ id, name, short, ok, revenue, orders, lastSync, currency }) {
  return (
    <div className="ph-card">
      <div className="ph-head">
        <div className="ph-name">
          <div className="ph-logo">{short}</div>
          <div className="txt">
            <span className="nm">{name}</span>
            <span className="sync">Synced {lastSync}</span>
          </div>
        </div>
        <span className={`ph-status ${ok ? 'ok' : 'warn'}`}><span className="led"/>{ok ? 'HEALTHY' : 'DEGRADED'}</span>
      </div>
      <div className="ph-stats">
        <div className="ph-stat">
          <div className="l">Revenue · period</div>
          <div className="v">{fmtCurrency(revenue, currency, 0)}</div>
        </div>
        <div className="ph-stat">
          <div className="l">Orders · approved</div>
          <div className="v">{fmtInt(orders)}</div>
        </div>
      </div>
    </div>
  );
}

// helper: map selected funnel codes (fx/sx/mx) to matching product ids
function mapFunnelsToProducts(funnelSet) {
  if (!funnelSet || funnelSet.size === 0) return new Set();
  const out = new Set();
  for (const p of window.MOCK.PRODUCTS) {
    if (funnelSet.has(p.funnel)) out.add(p.id);
  }
  return out;
}

Object.assign(window, { OverviewPage, mapFunnelsToProducts });
