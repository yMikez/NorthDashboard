/* global React */
/* All remaining pages: Funnel, Leaderboard, All Affiliates, Products, Transactions, Settings */

// ---------- FUNNEL ANALYTICS ----------
function FunnelPage({ filters }) {
  const [state, setFunState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    setFunState((s) => ({ ...s, status: 'loading' }));
    window.NSApi.fetchFunnel(filters)
      .then((data) => { if (!cancelled) setFunState({ status: 'ready', data, error: null }); })
      .catch((err) => {
        if (cancelled) return;
        console.error('fetchFunnel failed', err);
        setFunState({ status: 'error', data: null, error: err.message });
      });
    return () => { cancelled = true; };
  }, [filters.dateRange.start.getTime(), filters.dateRange.end.getTime(),
      Array.from(filters.platforms).join(','), Array.from(filters.countries).join(',')]);

  const cur = filters.currency || 'USD';
  const stages = state.data?.stages || [];
  const summary = state.data?.summary || {
    feGroups: 0, totalGroups: 0, totalRevenue: 0,
    aov: 0, aovFEOnly: 0, aovWithUpsell: 0, revenueLiftFromUpsells: 0,
  };

  // Adapt to FunnelChart shape: { label, volume }
  const chartStages = stages.map((s) => ({ label: s.label, volume: s.volume }));

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">FUNNEL ANALYTICS</span>
          <h2>Front-end <em>até backend</em>.</h2>
          <span className="sub">100% = vendas iniciais · take rates relativas ao FE</span>
        </div>
      </div>

      {state.status === 'error' && (
        <div className="panel" style={{ color: 'var(--danger)' }}>Erro ao carregar: {state.error}</div>
      )}

      <div className="mini-kpis">
        <div className="mini-kpi">
          <div className="l">Frontend orders</div>
          <div className="v">{fmtInt(summary.feGroups)}</div>
          <div className="s">topo do funil = 100%</div>
        </div>
        <div className="mini-kpi">
          <div className="l">Total revenue</div>
          <div className="v">{fmtCurrency(summary.totalRevenue, cur, 0)}</div>
          <div className="s">FE + bumps + upsells + downsells</div>
        </div>
        <div className="mini-kpi">
          <div className="l">AOV (full funnel)</div>
          <div className="v">{fmtCurrency(summary.aov, cur, 0)}</div>
          <div className="s">receita total / FE orders</div>
        </div>
        <div className="mini-kpi">
          <div className="l">Lift de upsells</div>
          <div className="v" style={{ color: summary.revenueLiftFromUpsells > 0.3 ? 'var(--success)' : summary.revenueLiftFromUpsells > 0.1 ? 'var(--warning)' : 'inherit' }}>
            {summary.aovFEOnly > 0 ? `+${(summary.revenueLiftFromUpsells * 100).toFixed(0)}%` : '—'}
          </div>
          <div className="s">AOV com upsell vs só FE</div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-head">
          <div className="panel-title">
            <span className="panel-eyebrow">FUNNEL · FE → BACKEND</span>
            <div className="panel-sub">Volume por estágio · take rate relativa às vendas frontend</div>
          </div>
          <div className="panel-legend">
            <span className="legend-dot cyan"><span/>{fmtInt(summary.feGroups)} FE → {fmtInt(summary.totalGroups)} grupos totais</span>
          </div>
        </div>
        <FunnelChart stages={chartStages}/>
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">
              <span className="panel-eyebrow">TAKE RATES · POR ESTÁGIO</span>
              <div className="panel-sub">% de pedidos FE que avançaram pra cada estágio backend</div>
            </div>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Stage</th>
                  <th className="num">Orders</th>
                  <th className="num">Take rate</th>
                  <th className="num">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {state.status === 'loading' && (
                  <tr><td colSpan={4} style={{ textAlign: 'center', padding: 24, opacity: 0.6 }}>Carregando...</td></tr>
                )}
                {stages.map((s) => {
                  const isFE = s.id === 'frontend';
                  const rateColor = isFE
                    ? 'var(--white)'
                    : s.takeRate > 0.25 ? 'var(--success)'
                    : s.takeRate > 0.12 ? 'var(--warning)'
                    : s.takeRate > 0   ? 'var(--danger)'
                    : 'var(--navy-400)';
                  return (
                    <tr key={s.id}>
                      <td>{s.label}{isFE && <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--navy-400)', fontFamily: 'var(--f-mono)' }}>BASELINE</span>}</td>
                      <td className="num cell-mono">{fmtInt(s.volume)}</td>
                      <td className="num cell-mono" style={{ color: rateColor }}>
                        {(s.takeRate * 100).toFixed(1)}%
                      </td>
                      <td className="num cell-mono">{fmtCurrency(s.revenue, cur, 0)}</td>
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
              <span className="panel-eyebrow">AOV LIFT — FE vs FE+UPSELLS</span>
              <div className="panel-sub">Quanto cada grupo gasta em média</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, padding: '10px 0' }}>
            {[
              { label: 'FE only', value: summary.aovFEOnly, color: '#8CA1C8' },
              { label: 'FE + upsell/bump/down', value: summary.aovWithUpsell, color: '#5BC8FF' },
              { label: 'AOV global', value: summary.aov, color: '#4A90FF' },
            ].map((r, i) => {
              const maxV = Math.max(summary.aovFEOnly, summary.aovWithUpsell, summary.aov, 1);
              const liftPct = i === 1 && summary.aovFEOnly > 0 ? (r.value - summary.aovFEOnly) / summary.aovFEOnly : null;
              return (
                <div key={r.label} style={{ display: 'grid', gridTemplateColumns: '160px 1fr 80px', gap: 12, alignItems: 'center' }}>
                  <div style={{ fontSize: 12, color: 'var(--navy-100)' }}>{r.label}</div>
                  <div style={{ position: 'relative', height: 26, background: 'rgba(91,200,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{
                      position: 'absolute', inset: 0,
                      width: `${(r.value / maxV) * 100}%`,
                      background: `linear-gradient(90deg, ${r.color}, ${r.color}44)`,
                      borderRadius: 4,
                      display: 'flex', alignItems: 'center', paddingLeft: 10,
                      fontFamily: 'var(--f-display)', fontSize: 14, color: 'var(--white)',
                      letterSpacing: '-0.01em',
                      fontVariationSettings: "'opsz' 48, 'SOFT' 40",
                    }}>
                      {fmtCurrency(r.value, cur, 0)}
                    </div>
                  </div>
                  <div style={{
                    textAlign: 'right', fontFamily: 'var(--f-mono)', fontSize: 11,
                    color: liftPct != null && liftPct > 0 ? 'var(--success)' : 'var(--navy-400)',
                  }}>
                    {liftPct != null ? `+${(liftPct * 100).toFixed(0)}%` : '—'}
                  </div>
                </div>
              );
            })}
          </div>
          {summary.feGroups === 0 && (
            <div style={{ padding: 14, fontSize: 12, color: 'var(--navy-300)', borderTop: '1px solid var(--border)' }}>
              Sem vendas FE no período — quando vendas chegarem, o lift aparece aqui.
            </div>
          )}
        </div>
      </div>
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
