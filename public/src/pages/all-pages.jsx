/* global React */
/* All remaining pages: Funnel, Leaderboard, All Affiliates, Products, Transactions, Settings */

function funnelTabStyle(active) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '6px 10px', whiteSpace: 'nowrap',
    background: active ? 'rgba(91,200,255,0.15)' : 'transparent',
    border: active ? '1px solid rgba(91,200,255,0.4)' : '1px solid transparent',
    borderRadius: 6, cursor: 'pointer',
    fontFamily: 'var(--f-mono)', fontSize: 11, letterSpacing: '0.04em',
    color: active ? 'var(--white)' : 'var(--navy-200)',
  };
}
const funnelTabPillStyle = {
  fontSize: 10, fontFamily: 'var(--f-mono)',
  background: 'rgba(91,200,255,0.1)', color: 'var(--glow-cyan)',
  padding: '1px 5px', borderRadius: 3,
};
function truncFunnelName(name, max = 28) {
  if (!name) return '—';
  // Drop the " · vendor" tail Products use, then truncate.
  const head = name.split(' · ')[0];
  return head.length > max ? head.slice(0, max - 1) + '…' : head;
}

// ---------- FUNNEL ANALYTICS ----------
function FunnelPage({ filters }) {
  const [state, setFunState] = useState({ status: 'loading', data: null, error: null });
  const [selected, setSelected] = useState('all');

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
      Array.from(filters.platforms).join(','), Array.from(filters.countries).join(','),
      Array.from(filters.funnels).join(','),
      Array.from(filters.families).join(',')]);

  // Reset selection if the chosen family no longer exists in the new dataset
  useEffect(() => {
    if (selected === 'all') return;
    const list = state.data?.byFamily || [];
    if (!list.some((f) => f.family === selected)) setSelected('all');
  }, [state.data, selected]);

  const cur = filters.currency || 'USD';
  const byFamily = state.data?.byFamily || [];
  const emptySummary = {
    feGroups: 0, totalGroups: 0, totalRevenue: 0,
    aov: 0, aovFEOnly: 0, aovWithUpsell: 0, revenueLiftFromUpsells: 0,
  };
  const view = selected === 'all'
    ? { stages: state.data?.stages || [], summary: state.data?.summary || emptySummary, name: null }
    : (() => {
        const hit = byFamily.find((f) => f.family === selected);
        return hit
          ? { stages: hit.stages, summary: hit.summary, name: hit.family }
          : { stages: [], summary: emptySummary, name: null };
      })();
  const stages = view.stages;
  const summary = view.summary;

  // Adapt to FunnelChart shape: { label, volume }
  const chartStages = stages.map((s) => ({ label: s.label, volume: s.volume }));

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">FUNNEL ANALYTICS</span>
          <h2>Front-end <em>até backend</em>.</h2>
          <span className="sub">
            {selected === 'all'
              ? '100% = vendas iniciais · take rates relativas ao FE'
              : `Funil isolado: ${view.name}`}
          </span>
        </div>
      </div>

      {state.status === 'error' && (
        <div className="panel" style={{ color: 'var(--danger)' }}>Erro ao carregar: {state.error}</div>
      )}

      {byFamily.length > 0 && (
        <div style={{
          display: 'flex', gap: 6, marginBottom: 14, padding: 4,
          background: 'rgba(91,200,255,0.04)', border: '1px solid var(--border)',
          borderRadius: 8, overflowX: 'auto',
        }}>
          <button
            onClick={() => setSelected('all')}
            className={selected === 'all' ? 'is-active' : ''}
            style={funnelTabStyle(selected === 'all')}
          >
            Todos
            <span style={funnelTabPillStyle}>{fmtInt(state.data?.summary?.feGroups || 0)}</span>
          </button>
          {byFamily.map((f) => (
            <button
              key={f.family}
              onClick={() => setSelected(f.family)}
              className={selected === f.family ? 'is-active' : ''}
              style={funnelTabStyle(selected === f.family)}
              title={`Funil ${f.family}`}
            >
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: familyAccent(f.family),
              }}/>
              {f.family}
              <span style={funnelTabPillStyle}>{fmtInt(f.summary.feGroups)}</span>
            </button>
          ))}
        </div>
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
      Array.from(filters.platforms).join(','), Array.from(filters.countries).join(','),
      Array.from(filters.funnels).join(','),
      Array.from(filters.families).join(',')]);

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
          <span className="eyebrow">AFILIADOS · RANKING</span>
          <h2>Quem está <em>puxando o resultado</em>.</h2>
          <span className="sub">Volume vs. risco · linhas marcadas precisam de atenção</span>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-ghost"><Icon name="download" size={12}/> Exportar CSV</button>
        </div>
      </div>

      <div className="mini-kpis">
        <div className="mini-kpi">
          <div className="l">Afiliados ativos</div>
          <div className="v">{summary.activeNow}</div>
          <div className="s">
            <span style={{ color: summary.activeNow >= summary.activePrev ? 'var(--success)' : 'var(--danger)' }}>
              {summary.activeNow >= summary.activePrev ? '↗' : '↘'} {Math.abs(summary.activeNow - summary.activePrev)}
            </span> vs período anterior
          </div>
        </div>
        <div className={`mini-kpi ${summary.concentration > 0.6 ? 'is-alert' : ''}`}
          style={summary.concentration > 0.6 ? { borderColor: 'rgba(239,68,68,0.35)' } : {}}>
          <div className="l">Concentração top 5</div>
          <div className="v" style={summary.concentration > 0.6 ? { color: 'var(--danger)' } : {}}>
            {(summary.concentration * 100).toFixed(0)}%
          </div>
          <div className="s">{summary.concentration > 0.6 ? '⚠ risco de concentração · acima de 60%' : 'distribuição saudável'}</div>
        </div>
        <div className="mini-kpi">
          <div className="l">Novos afiliados</div>
          <div className="v">{summary.newAff}</div>
          <div className="s">primeira venda no período</div>
        </div>
        <div className="mini-kpi">
          <div className="l">Inativos</div>
          <div className="v" style={{ color: summary.churnedAff > 3 ? 'var(--warning)' : 'inherit' }}>{summary.churnedAff}</div>
          <div className="s">ativos antes · silenciosos agora</div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0 12px', flexWrap: 'wrap' }}>
        <span className="f-label">ORDENAR POR</span>
        <div className="seg">
          {[['revenue','Receita'],['orders','Pedidos'],['netMargin','Margem'],['approvalRate','Aprovação'],['refundRate','Reembolsos'],['chargebackRate','Chargebacks']].map(([k,l]) => (
            <button key={k} className={sortBy === k ? 'is-active' : ''} onClick={() => setSortBy(k)}>{l}</button>
          ))}
        </div>
        <span className="f-label" style={{ marginLeft: 10 }}>MÍN. PEDIDOS</span>
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
                <th>Afiliado</th>
                <th>Plataforma</th>
                <th className="num">Pedidos</th>
                <th className="num">Receita</th>
                <th>Aprovação</th>
                <th className="num">Reembolso</th>
                <th className="num">Chargeback</th>
                <th className="num">CPA pago</th>
                <th className="num">Margem</th>
                <th>País principal</th>
                <th>Tendência 30d</th>
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
  const [state, setDState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    setDState((s) => ({ ...s, status: 'loading' }));
    window.NSApi.fetchAffiliateDetail(affiliateId, filters)
      .then((data) => { if (!cancelled) setDState({ status: 'ready', data, error: null }); })
      .catch((err) => {
        if (cancelled) return;
        console.error('fetchAffiliateDetail failed', err);
        setDState({ status: 'error', data: null, error: err.message || String(err) });
      });
    return () => { cancelled = true; };
  }, [affiliateId, filters.dateRange.start.getTime(), filters.dateRange.end.getTime(),
      Array.from(filters.platforms).join(','), Array.from(filters.countries).join(','),
      Array.from(filters.funnels).join(','),
      Array.from(filters.families).join(',')]);

  const cur = filters.currency || 'USD';
  const data = state.data;

  // Loading/error guards
  if (state.status === 'loading' || (state.status === 'error' && !data)) {
    return (
      <>
        <div className="drawer-backdrop" onClick={onClose}/>
        <div className="drawer">
          <div className="drawer-head">
            <div className="drawer-aff">
              <div className="av-lg" style={{ background: avatarColor(affiliateId) }}>{initials(affiliateId)}</div>
              <div>
                <h3>{affiliateId}</h3>
                <div className="sub">
                  {state.status === 'loading' ? 'Carregando dados do afiliado…' : `Erro: ${state.error}`}
                </div>
              </div>
            </div>
            <button className="icon-btn" onClick={onClose}><Icon name="x" size={14}/></button>
          </div>
        </div>
      </>
    );
  }

  if (!data) return null;

  const aff = data.affiliate;
  const k = data.kpis;
  const displayName = aff.nickname || aff.externalId;
  const platShort = aff.platformSlug === 'digistore24' ? 'D24' : 'CB';
  const platClass = aff.platformSlug === 'digistore24' ? 'plat-d24' : 'plat-cb';
  const joinedDaysAgo = Math.floor((Date.now() - new Date(aff.firstSeenAt).getTime()) / 86400000);

  // Convert daily series to LineChart buckets shape
  const buckets = data.daily.map((d) => ({
    date: new Date(d.date),
    gross: d.revenue,
    net: d.revenue,
    cpa: 0,
    orders: d.orders,
    approvedOrders: d.orders,
    allOrders: d.allOrders,
  }));

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose}/>
      <div className="drawer">
        <div className="drawer-head">
          <div className="drawer-aff">
            <div className="av-lg" style={{ background: avatarColor(aff.externalId) }}>{initials(displayName)}</div>
            <div>
              <h3>{displayName}</h3>
              <div className="sub">
                <span className={`plat ${platClass}`} style={{ marginRight: 8 }}>{platShort}</span>
                {aff.externalId} · entrou há {joinedDaysAgo}d
              </div>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>
        <div className="drawer-body">
          <div className="mini-kpis">
            <div className="mini-kpi">
              <div className="l">Receita · período</div>
              <div className="v">{fmtCurrency(k.revenue, cur, 0)}</div>
              <div className="s">{fmtInt(k.orders)} pedidos aprovados</div>
            </div>
            <div className="mini-kpi">
              <div className="l">Approval rate</div>
              <div className="v">{k.allOrders ? (k.approvalRate * 100).toFixed(1) + '%' : '—'}</div>
              <div className="s">{fmtInt(k.allOrders)} tentativas</div>
            </div>
            <div className="mini-kpi">
              <div className="l">Refund rate</div>
              <div className="v">{k.allOrders ? (k.refundRate * 100).toFixed(1) + '%' : '—'}</div>
              <div className="s">meta &lt;6%</div>
            </div>
            <div className="mini-kpi">
              <div className="l">Chargeback</div>
              <div className="v" style={{ color: k.cbRate > 0.01 ? 'var(--danger)' : 'inherit' }}>
                {k.allOrders ? (k.cbRate * 100).toFixed(2) + '%' : '—'}
              </div>
              <div className="s">limite MCC 1.0%</div>
            </div>
          </div>

          <div className="mini-kpis" style={{ marginTop: 0 }}>
            <div className="mini-kpi">
              <div className="l">CPA pago · período</div>
              <div className="v">{fmtCurrency(k.cpa, cur, 0)}</div>
              <div className="s">total transferido ao afiliado</div>
            </div>
            <div className="mini-kpi">
              <div className="l">Net margin</div>
              <div className="v" style={{ color: k.netMargin > 0 ? 'var(--success)' : 'var(--danger)' }}>
                {fmtCurrency(k.netMargin, cur, 0)}
              </div>
              <div className="s">net − CPA</div>
            </div>
            <div className="mini-kpi">
              <div className="l">AOV</div>
              <div className="v">{fmtCurrency(k.aov, cur, 0)}</div>
              <div className="s">ticket médio aprovado</div>
            </div>
            <div className="mini-kpi">
              <div className="l">LTV total</div>
              <div className="v">{fmtCurrency(data.ltv.revenue, cur, 0)}</div>
              <div className="s">{fmtInt(data.ltv.orders)} pedidos · all-time</div>
            </div>
          </div>

          {data.flags.length > 0 && (
            <div className="panel">
              <div className="panel-head">
                <div className="panel-title">
                  <span className="panel-eyebrow">SINAIS AUTOMÁTICOS</span>
                  <div className="panel-sub">Detectados no período atual</div>
                </div>
              </div>
              <div className="drawer-flags">
                {data.flags.map((f, i) => (
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
                <span className="panel-eyebrow">RECEITA DIÁRIA · PERÍODO</span>
                <div className="panel-sub">Gross aprovado de {displayName}</div>
              </div>
            </div>
            {buckets.length > 0
              ? <LineChart buckets={buckets} metric="gross" height={200} currency={cur}/>
              : <div style={{ padding: 24, textAlign: 'center', opacity: 0.6 }}>Sem vendas no período</div>}
          </div>

          {data.byProduct.length > 0 && (
            <div className="panel">
              <div className="panel-head">
                <div className="panel-title">
                  <span className="panel-eyebrow">VENDAS POR OFERTA</span>
                  <div className="panel-sub">Aprovados, ordenados por receita</div>
                </div>
              </div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Oferta</th>
                    <th>Tipo</th>
                    <th className="num">Pedidos</th>
                    <th className="num">Receita</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byProduct.map((p) => (
                    <tr key={p.externalId}>
                      <td>
                        <div>{p.name}</div>
                        <div className="cell-mono" style={{ fontSize: 10, color: 'var(--navy-400)' }}>{p.externalId}</div>
                      </td>
                      <td><span className="badge neutral">{p.productType.toLowerCase()}</span></td>
                      <td className="num cell-mono">{fmtInt(p.orders)}</td>
                      <td className="num cell-mono">{fmtCurrency(p.revenue, cur, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.byCountry.length > 0 && (
            <div className="panel">
              <div className="panel-head">
                <div className="panel-title">
                  <span className="panel-eyebrow">PAÍSES · TOP 8</span>
                  <div className="panel-sub">Receita aprovada por país</div>
                </div>
              </div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>País</th>
                    <th className="num">Pedidos</th>
                    <th className="num">Receita</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byCountry.map((c) => (
                    <tr key={c.code}>
                      <td className="cell-mono">{c.code}</td>
                      <td className="num cell-mono">{fmtInt(c.orders)}</td>
                      <td className="num cell-mono">{fmtCurrency(c.revenue, cur, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
      Array.from(filters.platforms).join(','), Array.from(filters.countries).join(','),
      Array.from(filters.funnels).join(','),
      Array.from(filters.families).join(',')]);

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
          <span className="eyebrow">AFILIADOS · DIRETÓRIO</span>
          <h2>Todos os <em>afiliados</em></h2>
          <span className="sub">{rows.length} no total · pesquisável · pronto pra exportar</span>
        </div>
        <div className="page-head-actions">
          <div className="select-btn" style={{ padding: '0 10px', width: 260 }}>
            <Icon name="search" size={13}/>
            <input value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nickname ou ID..."
              style={{ background: 'transparent', border: 0, color: 'var(--white)', outline: 'none', flex: 1, fontFamily: 'var(--f-body)', fontSize: 12 }}
            />
          </div>
          <button className="btn btn-ghost"><Icon name="download" size={12}/> Exportar CSV</button>
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
                <th>Afiliado</th><th>Plataforma</th>
                <th className="num">Receita · período</th><th className="num">Pedidos · período</th>
                <th className="num">Aprovação</th><th className="num">Reembolso</th>
                <th className="num">Receita LTV</th><th className="num">Pedidos LTV</th>
                <th>1ª venda</th><th>Última venda</th><th></th>
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
// ProductsPage: 3-level UI (grid → drilldown → drawer).
//   Level 1: FamilyGrid — cards per ProductFamily (NeuroMindPro, GlycoPulse, ...)
//   Level 2: FamilyDrillDown — variants grouped by type (FE/UP/DW/RC) for one family
//   Level 3: VariantDetailDrawer — single SKU detail with assets/links
function ProductsPage({ filters }) {
  // Drill-down state. Selecting a family transitions to L2; selecting a variant
  // (sku externalId) opens the L3 drawer.
  const [selectedFamily, setSelectedFamily] = useState(null);
  const [selectedSku, setSelectedSku] = useState(null);

  const familiesState = useFamilyData(filters);
  // Lazy-load /products only when we drill down — avoids fetching all SKUs
  // for the grid view since FamilyGrid uses /families aggregates.
  const productsState = useProductsData(filters, selectedFamily !== null);
  const cur = filters.currency || 'USD';

  if (selectedFamily) {
    return (
      <FamilyDrillDown
        family={selectedFamily}
        familyAgg={(familiesState.data?.families || []).find((f) => f.family === selectedFamily)}
        productsState={productsState}
        cur={cur}
        onBack={() => { setSelectedFamily(null); setSelectedSku(null); }}
        onPickVariant={setSelectedSku}
        selectedSku={selectedSku}
        closeDrawer={() => setSelectedSku(null)}
      />
    );
  }

  return (
    <FamilyGrid
      state={familiesState}
      cur={cur}
      onPick={setSelectedFamily}
    />
  );
}

function useFamilyData(filters) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading' }));
    window.NSApi.fetchFamilies(filters)
      .then((data) => { if (!cancelled) setState({ status: 'ready', data, error: null }); })
      .catch((err) => {
        if (cancelled) return;
        console.error('fetchFamilies failed', err);
        setState({ status: 'error', data: null, error: err.message });
      });
    return () => { cancelled = true; };
  }, [filters.dateRange.start.getTime(), filters.dateRange.end.getTime(),
      Array.from(filters.platforms).join(','), Array.from(filters.countries).join(','),
      Array.from(filters.families).join(',')]);
  return state;
}

function useProductsData(filters, enabled) {
  const [state, setState] = useState({ status: 'idle', data: null, error: null });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading' }));
    window.NSApi.fetchProducts(filters)
      .then((data) => { if (!cancelled) setState({ status: 'ready', data, error: null }); })
      .catch((err) => {
        if (cancelled) return;
        console.error('fetchProducts failed', err);
        setState({ status: 'error', data: null, error: err.message });
      });
    return () => { cancelled = true; };
  }, [enabled, filters.dateRange.start.getTime(), filters.dateRange.end.getTime(),
      Array.from(filters.platforms).join(','), Array.from(filters.countries).join(','),
      Array.from(filters.funnels).join(','),
      Array.from(filters.families).join(',')]);
  return state;
}

const FAMILY_ACCENT = {
  NeuroMindPro: '#9B7BFF',
  GlycoPulse: '#5BC8FF',
  ThermoBurnPro: '#FF8B5B',
  MaxVitalize: '#5BFFB7',
};
function familyAccent(family) {
  return FAMILY_ACCENT[family] || '#5BC8FF';
}

function FamilyGrid({ state, cur, onPick }) {
  const families = state.data?.families || [];
  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">CATÁLOGO · PRODUTOS</span>
          <h2>Performance <em>por família</em></h2>
          <span className="sub">{families.length} famílias no catálogo · clica em uma pra ver as variantes</span>
        </div>
      </div>

      {state.status === 'error' && (
        <div className="panel" style={{ color: 'var(--danger)' }}>Erro ao carregar: {state.error}</div>
      )}
      {state.status === 'loading' && (
        <div className="panel" style={{ textAlign: 'center', padding: 32, opacity: 0.6 }}>Carregando...</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
        {families.map((f) => {
          const accent = familyAccent(f.family);
          const liftPct = f.upsellLiftPct;
          const hasOrders = f.totalOrders > 0;
          return (
            <button
              key={f.family}
              onClick={() => onPick(f.family)}
              className="prod-card"
              style={{ cursor: 'pointer', textAlign: 'left', font: 'inherit', borderLeft: `3px solid ${accent}` }}
              title={`Abrir variantes de ${f.family}`}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: accent, boxShadow: `0 0 8px ${accent}` }}/>
                  <div style={{ fontFamily: 'var(--f-display)', fontSize: 18, color: 'var(--white)' }}>{f.family}</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {f.niches.map((n) => (
                    <span key={n} className="badge" style={{ background: `${accent}22`, color: accent, borderColor: `${accent}55`, fontSize: 9 }}>{n}</span>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
                <div style={{ fontFamily: 'var(--f-display)', fontSize: 28, color: 'var(--white)', letterSpacing: '-0.01em' }}>
                  {hasOrders ? fmtCurrency(f.grossRevenue, cur, 0) : '—'}
                </div>
                {liftPct != null && (
                  <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: liftPct > 0 ? 'var(--success)' : 'var(--navy-400)' }}>
                    lift +{(liftPct * 100).toFixed(0)}%
                  </div>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
                <div className="prod-stat"><div className="l">FE orders</div><div className="v sm">{fmtInt(f.feOrders)}</div></div>
                <div className="prod-stat"><div className="l">Total orders</div><div className="v sm">{fmtInt(f.totalOrders)}</div></div>
                <div className="prod-stat"><div className="l">AOV</div><div className="v sm">{hasOrders ? fmtCurrency(f.aov, cur, 0) : '—'}</div></div>
              </div>

              <div style={{ paddingTop: 10, borderTop: '1px solid rgba(91,200,255,0.15)', display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--navy-300)', fontFamily: 'var(--f-mono)' }}>
                <span>{f.feSkuCount} FE · {f.upSkuCount} UP · {f.dwSkuCount} DW · {f.rcSkuCount} RC</span>
                <span style={{ color: accent }}>Abrir →</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const TYPE_COL_META = {
  FRONTEND: { label: 'Frontend', accent: '#5BC8FF' },
  UPSELL: { label: 'Upsell', accent: '#4A90FF' },
  DOWNSELL: { label: 'Downsell', accent: '#FF8B5B' },
  SMS_RECOVERY: { label: 'SMS Recovery', accent: '#9B7BFF' },
};

function FamilyDrillDown({ family, familyAgg, productsState, cur, onBack, onPickVariant, selectedSku, closeDrawer }) {
  const accent = familyAccent(family);
  const allVariants = (productsState.data?.products || []).filter((p) => p.family === family);

  const grouped = { FRONTEND: [], UPSELL: [], DOWNSELL: [], SMS_RECOVERY: [] };
  for (const v of allVariants) {
    const t = grouped[v.productType] ? v.productType : 'UPSELL';
    grouped[t].push(v);
  }
  // Sort each column by revenue desc
  for (const k of Object.keys(grouped)) {
    grouped[k].sort((a, b) => b.revenue - a.revenue);
  }

  const variantInDrawer = selectedSku
    ? allVariants.find((v) => v.externalId === selectedSku)
    : null;

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <button onClick={onBack} className="chip" style={{ marginBottom: 8 }}>
            <Icon name="chevron-right" size={11}/> Famílias
          </button>
          <span className="eyebrow" style={{ color: accent }}>FAMÍLIA · {family.toUpperCase()}</span>
          <h2>{family} <em>· variantes</em></h2>
          <span className="sub">
            {familyAgg
              ? `${familyAgg.feOrders} FE · ${familyAgg.totalOrders} total · ${fmtCurrency(familyAgg.grossRevenue, cur, 0)} no período`
              : 'Sem vendas no período'}
          </span>
        </div>
      </div>

      {productsState.status === 'loading' && (
        <div className="panel" style={{ textAlign: 'center', padding: 32, opacity: 0.6 }}>Carregando variantes...</div>
      )}
      {productsState.status === 'error' && (
        <div className="panel" style={{ color: 'var(--danger)' }}>Erro ao carregar: {productsState.error}</div>
      )}

      {productsState.status === 'ready' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {Object.entries(grouped).map(([type, variants]) => {
            const meta = TYPE_COL_META[type];
            return (
              <div key={type} className="panel" style={{ padding: 12, minHeight: 200 }}>
                <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.12em', color: meta.accent, marginBottom: 12 }}>
                  {meta.label.toUpperCase()} · {variants.length}
                </div>
                {variants.length === 0 && (
                  <div style={{ fontSize: 11, color: 'var(--navy-400)', fontStyle: 'italic' }}>
                    Sem variantes deste tipo no catálogo
                  </div>
                )}
                <div style={{ display: 'grid', gap: 8 }}>
                  {variants.map((v) => (
                    <VariantRow
                      key={`${v.platformSlug}:${v.externalId}`}
                      variant={v}
                      cur={cur}
                      accent={meta.accent}
                      onClick={() => onPickVariant(v.externalId)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {variantInDrawer && (
        <VariantDetailDrawer variant={variantInDrawer} cur={cur} onClose={closeDrawer}/>
      )}
    </div>
  );
}

function VariantRow({ variant: v, cur, accent, onClick }) {
  const platShort = v.platformSlug === 'digistore24' ? 'D24' : 'CB';
  const platClass = v.platformSlug === 'digistore24' ? 'plat-d24' : 'plat-cb';
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left', font: 'inherit', cursor: 'pointer',
        background: 'rgba(91,200,255,0.04)', border: '1px solid var(--border-soft)',
        borderRadius: 6, padding: 10,
        display: 'grid', gap: 4,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(91,200,255,0.1)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(91,200,255,0.04)'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {v.name}
        </span>
        <span className={`plat ${platClass}`} style={{ flexShrink: 0 }}>{platShort}</span>
      </div>
      <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--navy-400)', letterSpacing: '0.04em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {v.externalId}{v.vendorAccount ? ` · ${v.vendorAccount}` : ''}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontFamily: 'var(--f-mono)', fontSize: 11 }}>
        <span style={{ color: accent }}>{fmtInt(v.orders)} pedidos</span>
        <span style={{ color: 'var(--white)' }}>{fmtCurrency(v.revenue, cur, 0)}</span>
      </div>
    </button>
  );
}

function DrawerLink({ href, icon, label }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
       style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 4,
                background: 'rgba(91,200,255,0.04)', color: 'var(--glow-cyan)', fontFamily: 'var(--f-mono)', fontSize: 11,
                textDecoration: 'none', border: '1px solid var(--border-soft)' }}>
      <Icon name={icon} size={12}/> {label}
    </a>
  );
}

function VariantDetailDrawer({ variant: v, cur, onClose }) {
  const margin = v.net - v.cpa;
  const marginPct = v.revenue ? margin / v.revenue : 0;
  const aov = v.orders ? v.revenue / v.orders : 0;
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose}/>
      <div className="drawer" style={{ width: 480 }}>
        <div className="drawer-head">
          <div>
            <span className="eyebrow">VARIANTE · {v.platformSlug === 'digistore24' ? 'DIGISTORE24' : 'CLICKBANK'}</span>
            <h3 style={{ margin: '4px 0', fontSize: 18, color: 'var(--white)' }}>{v.name}</h3>
            <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--navy-300)' }}>
              {v.externalId} {v.vendorAccount && `· ${v.vendorAccount}`}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} title="Fechar"><Icon name="x" size={14}/></button>
        </div>

        <div style={{ padding: 16, display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {v.bottles != null && (
              <span className="badge" style={{ background: 'rgba(91,200,255,0.15)', color: 'var(--glow-cyan)', borderColor: 'rgba(91,200,255,0.4)' }}>
                {v.bottles} bottles
              </span>
            )}
            {v.catalogPriceUsd != null && (
              <span className="badge" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--white)' }}>
                Catálogo: {fmtCurrency(v.catalogPriceUsd, cur, 0)}
              </span>
            )}
            {v.variant && (
              <span className="badge" style={{ background: 'rgba(155,123,255,0.15)', color: '#9B7BFF', borderColor: 'rgba(155,123,255,0.4)' }}>
                Variant: {v.variant}
              </span>
            )}
            {v.catalogStatus && v.catalogStatus !== 'Ativo' && (
              <span className="badge" style={{ background: 'rgba(255,180,0,0.15)', color: 'var(--warning)', borderColor: 'rgba(255,180,0,0.4)' }}>
                {v.catalogStatus}
              </span>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            <div className="prod-stat"><div className="l">Pedidos</div><div className="v">{fmtInt(v.orders)}</div></div>
            <div className="prod-stat"><div className="l">Receita</div><div className="v">{fmtCurrency(v.revenue, cur, 0)}</div></div>
            <div className="prod-stat"><div className="l">AOV</div><div className="v sm">{fmtCurrency(aov, cur, 0)}</div></div>
            <div className="prod-stat"><div className="l">Aprovação</div><div className="v sm">{v.allOrders ? (v.approvalRate * 100).toFixed(1) + '%' : '—'}</div></div>
            <div className="prod-stat"><div className="l">Margem</div><div className="v sm" style={{ color: margin > 0 ? 'var(--success)' : 'var(--danger)' }}>{fmtCurrency(margin, cur, 0)}</div></div>
            <div className="prod-stat"><div className="l">Margem %</div><div className="v sm">{(marginPct * 100).toFixed(1)}%</div></div>
          </div>

          {(v.firstSoldAt || v.lastSoldAt) && (
            <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 12, fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--navy-300)', display: 'flex', justifyContent: 'space-between' }}>
              <span>1ª venda: {v.firstSoldAt ? fmtDateShort(v.firstSoldAt) : '—'}</span>
              <span>Última: {v.lastSoldAt ? fmtDateShort(v.lastSoldAt) : '—'}</span>
            </div>
          )}

          {(v.salesPageUrl || v.checkoutUrl || v.thanksPageUrl || v.driveUrl) && (
            <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 12, display: 'grid', gap: 6 }}>
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--navy-400)', letterSpacing: '0.1em' }}>LINKS DO CATÁLOGO</div>
              {v.salesPageUrl && <DrawerLink href={v.salesPageUrl} icon="globe" label="Sales Page"/>}
              {v.checkoutUrl && <DrawerLink href={v.checkoutUrl} icon="credit-card" label="Checkout"/>}
              {v.thanksPageUrl && <DrawerLink href={v.thanksPageUrl} icon="check" label="Thanks Page"/>}
              {v.driveUrl && <DrawerLink href={v.driveUrl} icon="link" label="Drive (assets)"/>}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ---------- Original ProductsPage (per-SKU card grid) — kept inline below
// for reference but no longer routed. Remove in a future cleanup pass once
// the FamilyGrid UI is validated in production.
function _LegacyProductsPage({ filters }) {
  const [state, setProdState] = useState({ status: 'loading', data: null, error: null });
  const [typeFilter, setTypeFilter] = useState('all');
  const [view, setView] = useState('cards');
  const [query, setQuery] = useState('');

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
      Array.from(filters.platforms).join(','), Array.from(filters.countries).join(','),
      Array.from(filters.funnels).join(','),
      Array.from(filters.families).join(',')]);

  const cur = filters.currency || 'USD';
  const byType = state.data?.byType || [];
  const allProducts = state.data?.products || [];

  // Apply local filters: productType + search
  const q = query.trim().toLowerCase();
  const products = allProducts.filter((p) => {
    if (typeFilter !== 'all' && p.productType !== typeFilter) return false;
    if (q && !(p.name.toLowerCase().includes(q) || p.externalId.toLowerCase().includes(q))) return false;
    return true;
  });

  // Type counts for the segment buttons
  const typeCounts = { all: allProducts.length };
  for (const t of ['FRONTEND', 'UPSELL', 'BUMP', 'DOWNSELL']) {
    typeCounts[t] = allProducts.filter((p) => p.productType === t).length;
  }

  const TYPE_META = {
    FRONTEND: { label: 'Frontend', accent: '#5BC8FF', tagClass: 'plat-cb' },
    UPSELL:   { label: 'Upsell',   accent: '#4A90FF', tagClass: 'plat-cb' },
    BUMP:     { label: 'Bump',     accent: '#8B7FFF', tagClass: 'plat-d24' },
    DOWNSELL: { label: 'Downsell', accent: '#6b84b8', tagClass: 'plat-d24' },
  };

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">PRODUTOS · OFERTAS</span>
          <h2>Performance <em>do catálogo</em></h2>
          <span className="sub">{products.length} de {allProducts.length} SKUs · clica num card pra abrir detalhes</span>
        </div>
        <div className="page-head-actions">
          <div className="select-btn" style={{ padding: '0 10px', width: 220 }}>
            <Icon name="search" size={13}/>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nome ou ID..."
              style={{ background: 'transparent', border: 0, color: 'var(--white)', outline: 'none', flex: 1, fontFamily: 'var(--f-mono)', fontSize: 12 }}/>
          </div>
          <div className="seg">
            <button className={view === 'cards' ? 'is-active' : ''} onClick={() => setView('cards')}>
              <Icon name="package" size={11}/> Cards
            </button>
            <button className={view === 'table' ? 'is-active' : ''} onClick={() => setView('table')}>
              <Icon name="receipt" size={11}/> Tabela
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0 14px', flexWrap: 'wrap' }}>
        <span className="f-label">TIPO DE PRODUTO</span>
        <div className="seg">
          {[
            ['all', 'Todos'],
            ['FRONTEND', 'Frontend'],
            ['UPSELL', 'Upsell'],
            ['BUMP', 'Bump'],
            ['DOWNSELL', 'Downsell'],
          ].map(([k, l]) => (
            <button key={k} className={typeFilter === k ? 'is-active' : ''} onClick={() => setTypeFilter(k)}>
              {l}<span style={{ marginLeft: 6, opacity: 0.5 }}>{fmtInt(typeCounts[k] || 0)}</span>
            </button>
          ))}
        </div>
      </div>

      {state.status === 'error' && (
        <div className="panel" style={{ color: 'var(--danger)' }}>Erro ao carregar: {state.error}</div>
      )}

      {state.status === 'loading' && (
        <div className="panel" style={{ textAlign: 'center', padding: 32, opacity: 0.6 }}>Carregando...</div>
      )}

      {state.status === 'ready' && products.length === 0 && (
        <div className="panel" style={{ textAlign: 'center', padding: 32, opacity: 0.6 }}>
          {q || typeFilter !== 'all' ? 'Nenhum produto bate com o filtro' : 'Sem produtos no período'}
        </div>
      )}

      {view === 'cards' && (
        <div className="prod-grid">
          {products.map((p) => {
            const meta = TYPE_META[p.productType] || { label: p.productType, accent: '#5BC8FF' };
            const margin = p.net - p.cpa;
            const marginPct = p.revenue ? margin / p.revenue : 0;
            const aov = p.orders ? p.revenue / p.orders : 0;
            const platClass = p.platformSlug === 'digistore24' ? 'plat-d24' : 'plat-cb';
            const platShort = p.platformSlug === 'digistore24' ? 'D24' : 'CB';
            const apColor = p.approvalRate > 0.7 ? 'var(--success)' : p.approvalRate > 0.5 ? 'var(--warning)' : 'var(--danger)';
            return (
              <div key={`${p.platformSlug}:${p.externalId}`} className="prod-card">
                <div className="prod-thumb" style={{ color: meta.accent }}>
                  <Icon name="package" size={36} stroke={1.2}/>
                </div>
                <div>
                  <div className="prod-name" title={p.name}>{p.name}</div>
                  <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--navy-400)', letterSpacing: '0.06em', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.externalId}
                  </div>
                </div>
                <div className="prod-plat">
                  <span className={`plat ${platClass}`}>{platShort}</span>
                  <span className="badge" style={{ background: `${meta.accent}22`, color: meta.accent, borderColor: `${meta.accent}55` }}>
                    {meta.label}
                  </span>
                  {p.vendorAccount && (
                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--navy-400)', marginLeft: 'auto' }}>
                      {p.vendorAccount}
                    </span>
                  )}
                </div>
                <div className="prod-stats">
                  <div className="prod-stat"><div className="l">Receita</div><div className="v">{fmtCurrency(p.revenue, cur, 0)}</div></div>
                  <div className="prod-stat"><div className="l">Pedidos</div><div className="v">{fmtInt(p.orders)}</div></div>
                  <div className="prod-stat"><div className="l">AOV</div><div className="v sm">{fmtCurrency(aov, cur, 0)}</div></div>
                  <div className="prod-stat"><div className="l">Aprovação</div><div className="v sm" style={{ color: p.allOrders ? apColor : 'var(--navy-400)' }}>
                    {p.allOrders ? (p.approvalRate * 100).toFixed(1) + '%' : '—'}
                  </div></div>
                  <div className="prod-stat"><div className="l">Margem</div><div className="v sm" style={{ color: margin > 0 ? 'var(--success)' : 'var(--danger)' }}>{fmtCurrency(margin, cur, 0)}</div></div>
                  <div className="prod-stat"><div className="l">Margem %</div><div className="v sm" style={{ color: marginPct > 0.2 ? 'var(--success)' : marginPct > 0.1 ? 'var(--warning)' : 'var(--danger)' }}>{(marginPct * 100).toFixed(1)}%</div></div>
                </div>
                {p.lastSoldAt && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(91,200,255,0.15)', fontSize: 11, color: 'var(--navy-300)', display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--f-mono)' }}>
                    <span>1ª venda: {fmtDateShort(p.firstSoldAt)}</span>
                    <span>Última: {fmtDateShort(p.lastSoldAt)}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {view === 'table' && (
        <div className="panel" style={{ padding: 0 }}>
          <div className="tbl-wrap" style={{ margin: 0, padding: '0 4px', maxHeight: 720, overflowY: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>ID externo</th>
                  <th>Tipo</th>
                  <th>Plataforma</th>
                  <th>Vendor</th>
                  <th className="num">Pedidos</th>
                  <th className="num">Aprovação</th>
                  <th className="num">Receita</th>
                  <th className="num">Margem</th>
                  <th className="num">CPA</th>
                  <th>Última venda</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const meta = TYPE_META[p.productType] || { label: p.productType, accent: '#5BC8FF' };
                  const platClass = p.platformSlug === 'digistore24' ? 'plat-d24' : 'plat-cb';
                  const platShort = p.platformSlug === 'digistore24' ? 'D24' : 'CB';
                  const apColor = p.approvalRate > 0.7 ? 'var(--success)' : p.approvalRate > 0.5 ? 'var(--warning)' : 'var(--danger)';
                  const margin = p.net - p.cpa;
                  return (
                    <tr key={`${p.platformSlug}:${p.externalId}`}>
                      <td>{p.name}</td>
                      <td className="cell-mono" style={{ color: 'var(--navy-300)' }}>{p.externalId}</td>
                      <td>
                        <span className="badge" style={{ background: `${meta.accent}22`, color: meta.accent, borderColor: `${meta.accent}55` }}>
                          {meta.label}
                        </span>
                      </td>
                      <td><span className={`plat ${platClass}`}>{platShort}</span></td>
                      <td className="cell-mono" style={{ color: 'var(--navy-300)' }}>{p.vendorAccount || '—'}</td>
                      <td className="num cell-mono">{fmtInt(p.orders)}</td>
                      <td className="num cell-mono" style={{ color: p.allOrders ? apColor : 'var(--navy-400)' }}>
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
      )}

      {/* Resumo por tipo no rodapé — contexto, não headline */}
      {byType.some((b) => b.orders > 0) && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '0.18em', color: 'var(--navy-400)', textTransform: 'uppercase', marginBottom: 10 }}>
            Resumo por tipo · período
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {byType.map((b) => {
              const meta = TYPE_META[b.productType] || { label: b.productType, accent: '#5BC8FF' };
              return (
                <div key={b.productType} style={{ padding: 12, border: '1px solid var(--border-soft)', borderRadius: 6, background: 'rgba(91,200,255,0.03)' }}>
                  <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: meta.accent, letterSpacing: '0.1em', marginBottom: 6 }}>
                    {meta.label.toUpperCase()}
                  </div>
                  <div style={{ fontFamily: 'var(--f-display)', fontSize: 22, color: 'var(--white)', lineHeight: 1, marginBottom: 4 }}>
                    {fmtCurrency(b.revenue, cur, 0)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--navy-300)' }}>
                    {fmtInt(b.orders)} pedidos · {b.productCount} SKUs
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
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
      Array.from(filters.funnels).join(','),
      Array.from(filters.families).join(','),
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
          <span className="eyebrow">TRANSAÇÕES · LEDGER</span>
          <h2>Cada <em>pedido</em>, cada linha.</h2>
          <span className="sub">
            Stream bruto · {fmtInt(showing)} de {fmtInt(total)} linhas{showing < total ? ' · cap de 500 linhas · use filtros pra refinar' : ''}
          </span>
        </div>
        <div className="page-head-actions">
          <div className="select-btn" style={{ padding: '0 10px', width: 240 }}>
            <Icon name="search" size={13}/>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por ID de pedido ou afiliado..."
              style={{ background: 'transparent', border: 0, color: 'var(--white)', outline: 'none', flex: 1, fontFamily: 'var(--f-mono)', fontSize: 12 }}/>
          </div>
          <button className="btn btn-ghost"><Icon name="download" size={12}/> CSV</button>
          <button className="btn btn-ghost"><Icon name="download" size={12}/> XLSX</button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0 12px', flexWrap: 'wrap' }}>
        <span className="f-label">STATUS</span>
        <div className="seg">
          {[['all','Todos'],['approved','Aprovados'],['pending','Pendentes'],['refunded','Reembolsados'],['chargeback','Chargeback']].map(([k, l]) => (
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
                <th>Data/hora</th><th>Pedido</th><th>Plataforma</th>
                <th>Produto</th><th>Afiliado</th>
                <th>País</th><th>Pagamento</th>
                <th className="num">Bruto</th><th className="num">Taxas</th>
                <th className="num">Líquido</th>
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
      Array.from(filters.platforms).join(','), Array.from(filters.countries).join(','),
      Array.from(filters.funnels).join(','),
      Array.from(filters.families).join(',')]);

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
          <span className="eyebrow">SISTEMA · PLATAFORMAS</span>
          <h2>Visão <em>das plataformas</em></h2>
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
                    <span className="sync">Sincronizado {syncLabel}</span>
                  </div>
                </div>
                {healthy
                  ? <span className="ph-status ok"><span className="led"/>SAUDÁVEL</span>
                  : <span className="badge warn">SEM SYNC</span>
                }
              </div>

              <div className="ph-stats">
                <div className="ph-stat">
                  <div className="l">Receita · período</div>
                  <div className="v">{fmtCurrency(p.totalRevenue, cur, 0)}</div>
                </div>
                <div className="ph-stat">
                  <div className="l">Pedidos aprovados</div>
                  <div className="v">{fmtInt(p.totalOrders)}</div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
                <div className="ph-stat">
                  <div className="l">Aprovação</div>
                  <div className={`v cell-mono ${apClass}`} style={{ fontSize: 18 }}>
                    {p.allOrders ? (p.approvalRate * 100).toFixed(1) + '%' : '—'}
                  </div>
                </div>
                <div className="ph-stat">
                  <div className="l">Afiliados ativos</div>
                  <div className="v" style={{ fontSize: 18 }}>
                    {fmtInt(p.affiliatesActive)}
                    <span style={{ fontSize: 11, color: 'var(--navy-300)', marginLeft: 6 }}>
                      / {fmtInt(p.affiliatesTotal)} no total
                    </span>
                  </div>
                </div>
              </div>

              {p.topProduct && (
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(91,200,255,0.15)' }}>
                  <div style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--navy-300)', marginBottom: 4 }}>
                    TOP PRODUTO
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
                  <span className="sync">Não configurado</span>
                </div>
              </div>
              <span className="badge neutral">EM BREVE</span>
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
  if (mins < 60) return `há ${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `há ${hrs}h`;
  const days = Math.round(hrs / 24);
  return `há ${days}d`;
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
