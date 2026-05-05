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
                      <td>{s.label}{isFE && <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--fg5)', fontFamily: 'var(--f-mono)' }}>BASELINE</span>}</td>
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
                  <div style={{ fontSize: 12, color: 'var(--fg2)' }}>{r.label}</div>
                  <div style={{ position: 'relative', height: 26, background: 'rgba(91,200,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{
                      position: 'absolute', inset: 0,
                      width: `${(r.value / maxV) * 100}%`,
                      background: `linear-gradient(90deg, ${r.color}, ${r.color}44)`,
                      borderRadius: 4,
                      display: 'flex', alignItems: 'center', paddingLeft: 10,
                      fontFamily: 'var(--f-display)', fontSize: 14, color: 'var(--fg1)',
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
            <div style={{ padding: 14, fontSize: 12, color: 'var(--fg4)', borderTop: '1px solid var(--border)' }}>
              Sem vendas FE no período — quando vendas chegarem, o lift aparece aqui.
            </div>
          )}
        </div>
      </div>

      {selected === 'all' && (state.data?.crossSell?.length > 0) && (
        <div className="panel" style={{ marginTop: 14 }}>
          <div className="panel-head">
            <div className="panel-title">
              <span className="panel-eyebrow">CROSS-SELL · ENTRE FAMÍLIAS</span>
              <div className="panel-sub">
                Sessões que entraram via FE de uma família e compraram backend de outra ·
                não infla as take rates da família origem
              </div>
            </div>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Origem (FE)</th>
                  <th></th>
                  <th>Destino (UP/DW)</th>
                  <th className="num">Sessões</th>
                  <th className="num">Receita</th>
                </tr>
              </thead>
              <tbody>
                {state.data.crossSell.map((c, i) => (
                  <tr key={i}>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: familyAccent(c.fromFamily) }}/>
                        {c.fromFamily}
                      </span>
                    </td>
                    <td style={{ color: 'var(--fg5)', textAlign: 'center', fontFamily: 'var(--f-mono)' }}>→</td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: familyAccent(c.toFamily) }}/>
                        {c.toFamily}
                      </span>
                    </td>
                    <td className="num cell-mono">{fmtInt(c.sessions)}</td>
                    <td className="num cell-mono">{fmtCurrency(c.revenue, cur, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
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
      case 'profit': return (b.estimatedProfit ?? 0) - (a.estimatedProfit ?? 0);
      case 'attributedProfit': return (b.attributedProfit ?? 0) - (a.attributedProfit ?? 0);
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
          {[['revenue','Receita'],['attributedProfit','Lucro atribuído'],['profit','Lucro direto'],['orders','Pedidos'],['netMargin','Margem'],['approvalRate','Aprovação'],['refundRate','Reembolsos'],['chargebackRate','Chargebacks']].map(([k,l]) => (
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
                <th className="num" title="Lucro contando só pedidos onde este afiliado está no affiliateId (sem upsells)">Lucro direto</th>
                <th className="num" title="Lucro contando o funil COMPLETO da sessão trazida por este afiliado (FE + UPs + DWs + bumps)">Lucro atribuído</th>
                <th>País principal</th>
                <th>Tendência 30d</th>
              </tr>
            </thead>
            <tbody>
              {state.status === 'loading' && (
                <tr><td colSpan={14} style={{ textAlign: 'center', padding: 24, opacity: 0.6 }}>Carregando...</td></tr>
              )}
              {state.status === 'ready' && rows.length === 0 && (
                <tr><td colSpan={14} style={{ textAlign: 'center', padding: 24, opacity: 0.6 }}>
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
                    <td className="num cell-mono" style={{ color: 'var(--fg1)' }}>{fmtCurrency(r.revenue, cur, 0)}</td>
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
                    <td className="num cell-mono" style={{ color: (r.estimatedProfit ?? 0) > 0 ? 'var(--success)' : 'var(--danger)', opacity: 0.75 }}>
                      {r.estimatedProfit != null ? fmtCurrency(r.estimatedProfit, cur, 0) : '—'}
                    </td>
                    <td className="num cell-mono" style={{ color: (r.attributedProfit ?? 0) > 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
                      {r.attributedProfit != null ? fmtCurrency(r.attributedProfit, cur, 0) : '—'}
                      {r.attributedSessions > 0 && (
                        <span style={{ display: 'block', fontSize: 9, color: 'var(--fg5)', fontWeight: 400, marginTop: 1 }}>
                          {r.attributedSessions} sessões
                        </span>
                      )}
                    </td>
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
              <div className="l">AOV global</div>
              <div className="v">{fmtCurrency(k.aov, cur, 0)}</div>
              <div className="s">
                {k.attributedSessions > 0
                  ? `funil completo · ${fmtInt(k.attributedSessions)} sessões`
                  : 'sem sessões FE no período'}
              </div>
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
                        <div className="cell-mono" style={{ fontSize: 10, color: 'var(--fg5)' }}>{p.externalId}</div>
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
              style={{ background: 'transparent', border: 0, color: 'var(--fg1)', outline: 'none', flex: 1, fontFamily: 'var(--f-body)', fontSize: 12 }}
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
                  <div style={{ fontFamily: 'var(--f-display)', fontSize: 18, color: 'var(--fg1)' }}>{f.family}</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {f.niches.map((n) => (
                    <span key={n} className="badge" style={{ background: `${accent}22`, color: accent, borderColor: `${accent}55`, fontSize: 9 }}>{n}</span>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
                <div style={{ fontFamily: 'var(--f-display)', fontSize: 28, color: 'var(--fg1)', letterSpacing: '-0.01em' }}>
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

              <div style={{ paddingTop: 10, borderTop: '1px solid rgba(91,200,255,0.15)', display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--fg4)', fontFamily: 'var(--f-mono)' }}>
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
                  <div style={{ fontSize: 11, color: 'var(--fg5)', fontStyle: 'italic' }}>
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
  // FE absorbs the CPA for the whole session; standalone profit understates
  // its real economics. When we have enough sessions to be statistically
  // honest (≥3), show the attributed view (full funnel credited to FE SKU).
  const useAttributed = v.productType === 'FRONTEND' && (v.attributedSessions ?? 0) >= 3;
  const profit = useAttributed ? v.attributedProfit : v.estimatedProfit;
  const marginPct = useAttributed ? v.attributedMarginPct : v.estimatedMarginPct;
  const profitLabel = useAttributed ? 'lucro atrib.' : 'lucro';
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
        <span style={{ fontSize: 12, color: 'var(--fg1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {v.name}
        </span>
        <span className={`plat ${platClass}`} style={{ flexShrink: 0 }}>{platShort}</span>
      </div>
      <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg5)', letterSpacing: '0.04em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {v.externalId}{v.vendorAccount ? ` · ${v.vendorAccount}` : ''}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontFamily: 'var(--f-mono)', fontSize: 11 }}>
        <span style={{ color: accent }}>{fmtInt(v.orders)} pedidos</span>
        <span style={{ color: 'var(--fg1)' }}>{fmtCurrency(v.revenue, cur, 0)}</span>
      </div>
      {marginPct != null && v.revenue > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--f-mono)', fontSize: 10 }}>
          <span style={{ color: 'var(--fg5)' }}>{profitLabel}</span>
          <span style={{
            color: profit > 0 ? 'var(--success)' : 'var(--danger)',
          }}>
            {fmtCurrency(profit, cur, 0)} ({marginPct.toFixed(0)}%)
          </span>
        </div>
      )}
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
  const profit = v.estimatedProfit ?? 0;
  const marginPct = v.estimatedMarginPct ?? 0;
  const showAttributed = v.productType === 'FRONTEND' && (v.attributedSessions ?? 0) >= 3;
  // AOV global: pra FE SKUs com sessões suficientes, usa
  // attributedRevenue/attributedSessions (funil completo). Pra
  // backend (UP/DW/RC) cai no AOV por pedido — eles não ancoram sessão.
  const aov = showAttributed
    ? v.attributedRevenue / v.attributedSessions
    : v.orders ? v.revenue / v.orders : 0;
  const aovLabel = showAttributed ? 'AOV global' : 'AOV';
  // Portal pro body — renderizado dentro de .page-in (que vira stacking
  // context via animation: pageIn, opacity), o drawer ficaria atrás da
  // topbar mesmo com z-index 50/51.
  return ReactDOM.createPortal((
    <>
      <div className="drawer-backdrop" onClick={onClose}/>
      <div className="drawer" style={{ width: 480 }}>
        <div className="drawer-head">
          <div>
            <span className="eyebrow">VARIANTE · {v.platformSlug === 'digistore24' ? 'DIGISTORE24' : 'CLICKBANK'}</span>
            <h3 style={{ margin: '4px 0', fontSize: 18, color: 'var(--fg1)' }}>{v.name}</h3>
            <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--fg4)' }}>
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
              <span className="badge" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--fg1)' }}>
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
            <div className="prod-stat"><div className="l">{aovLabel}</div><div className="v sm">{fmtCurrency(aov, cur, 0)}</div></div>
            <div className="prod-stat"><div className="l">Aprovação</div><div className="v sm">{v.allOrders ? (v.approvalRate * 100).toFixed(1) + '%' : '—'}</div></div>
            <div className="prod-stat"><div className="l">Lucro direto</div><div className="v sm" style={{ color: profit > 0 ? 'var(--success)' : 'var(--danger)' }}>{fmtCurrency(profit, cur, 0)}</div></div>
            <div className="prod-stat"><div className="l">Margem direta</div><div className="v sm">{marginPct.toFixed(1)}%</div></div>
          </div>

          {showAttributed && (
            <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 12, display: 'grid', gap: 8 }}>
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg5)', letterSpacing: '0.1em' }}>
                LUCRO ATRIBUÍDO · funil completo da sessão
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                <div className="prod-stat"><div className="l">Sessões</div><div className="v sm">{fmtInt(v.attributedSessions)}</div></div>
                <div className="prod-stat"><div className="l">Receita atrib.</div><div className="v sm">{fmtCurrency(v.attributedRevenue, cur, 0)}</div></div>
                <div className="prod-stat">
                  <div className="l">Lucro atrib.</div>
                  <div className="v sm" style={{ color: v.attributedProfit > 0 ? 'var(--success)' : 'var(--danger)' }}>
                    {fmtCurrency(v.attributedProfit, cur, 0)}
                  </div>
                </div>
                <div className="prod-stat"><div className="l">Margem atrib.</div><div className="v sm">{v.attributedMarginPct.toFixed(1)}%</div></div>
              </div>
              <div style={{ fontSize: 10, color: 'var(--fg4)', lineHeight: 1.4 }}>
                Inclui UPs, DWs e bumps comprados na mesma sessão deste FE — mostra a economia real do funil que este SKU traz.
              </div>
            </div>
          )}

          {(v.firstSoldAt || v.lastSoldAt) && (
            <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 12, fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--fg4)', display: 'flex', justifyContent: 'space-between' }}>
              <span>1ª venda: {v.firstSoldAt ? fmtDateShort(v.firstSoldAt) : '—'}</span>
              <span>Última: {v.lastSoldAt ? fmtDateShort(v.lastSoldAt) : '—'}</span>
            </div>
          )}

          {(v.salesPageUrl || v.checkoutUrl || v.thanksPageUrl || v.driveUrl) && (
            <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 12, display: 'grid', gap: 6 }}>
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg5)', letterSpacing: '0.1em' }}>LINKS DO CATÁLOGO</div>
              {v.salesPageUrl && <DrawerLink href={v.salesPageUrl} icon="globe" label="Sales Page"/>}
              {v.checkoutUrl && <DrawerLink href={v.checkoutUrl} icon="credit-card" label="Checkout"/>}
              {v.thanksPageUrl && <DrawerLink href={v.thanksPageUrl} icon="check" label="Thanks Page"/>}
              {v.driveUrl && <DrawerLink href={v.driveUrl} icon="link" label="Drive (assets)"/>}
            </div>
          )}
        </div>
      </div>
    </>
  ), document.body);
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
              style={{ background: 'transparent', border: 0, color: 'var(--fg1)', outline: 'none', flex: 1, fontFamily: 'var(--f-mono)', fontSize: 12 }}/>
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
                  <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg5)', letterSpacing: '0.06em', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.externalId}
                  </div>
                </div>
                <div className="prod-plat">
                  <span className={`plat ${platClass}`}>{platShort}</span>
                  <span className="badge" style={{ background: `${meta.accent}22`, color: meta.accent, borderColor: `${meta.accent}55` }}>
                    {meta.label}
                  </span>
                  {p.vendorAccount && (
                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg5)', marginLeft: 'auto' }}>
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
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(91,200,255,0.15)', fontSize: 11, color: 'var(--fg4)', display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--f-mono)' }}>
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
                      <td className="cell-mono" style={{ color: 'var(--fg4)' }}>{p.externalId}</td>
                      <td>
                        <span className="badge" style={{ background: `${meta.accent}22`, color: meta.accent, borderColor: `${meta.accent}55` }}>
                          {meta.label}
                        </span>
                      </td>
                      <td><span className={`plat ${platClass}`}>{platShort}</span></td>
                      <td className="cell-mono" style={{ color: 'var(--fg4)' }}>{p.vendorAccount || '—'}</td>
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
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '0.18em', color: 'var(--fg5)', textTransform: 'uppercase', marginBottom: 10 }}>
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
                  <div style={{ fontFamily: 'var(--f-display)', fontSize: 22, color: 'var(--fg1)', lineHeight: 1, marginBottom: 4 }}>
                    {fmtCurrency(b.revenue, cur, 0)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--fg4)' }}>
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
  // Initial status filter pode vir da URL (drill-down dos KPIs em /overview).
  // Aceita os valores que a UI suporta; default é 'all'.
  const [statusFilter, setStatusFilter] = useState(() => {
    try {
      const s = new URLSearchParams(location.search).get('status');
      return s && ['all', 'approved', 'pending', 'refunded', 'chargeback'].includes(s) ? s : 'all';
    } catch (e) { return 'all'; }
  });
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [state, setStateTx] = useState({ status: 'loading', data: null, error: null });
  const [drawer, setDrawer] = useState(null); // { externalId, platformSlug } | null

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
              style={{ background: 'transparent', border: 0, color: 'var(--fg1)', outline: 'none', flex: 1, fontFamily: 'var(--f-mono)', fontSize: 12 }}/>
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
                  <tr key={`${o.platformSlug}:${o.externalId}`}
                      onClick={() => setDrawer({ externalId: o.externalId, platformSlug: o.platformSlug })}
                      style={{ cursor: 'pointer' }}>
                    <td className="cell-mono">{fmtDateTime(o.orderedAt)}</td>
                    <td className="cell-mono">{o.externalId}</td>
                    <td><span className={`plat ${platClass}`}>{platShort}</span></td>
                    <td>{o.productName || o.productExternalId}</td>
                    <td className="cell-mono">{o.affiliateNickname || o.affiliateExternalId || '—'}</td>
                    <td className="cell-mono">{o.country || '—'}</td>
                    <td className="cell-mono">{o.paymentMethod || '—'}</td>
                    <td className="num cell-mono" style={{ color: o.grossAmountUsd < 0 ? 'var(--danger)' : 'var(--fg1)' }}>{fmtCurrency(o.grossAmountUsd, cur, 2)}</td>
                    <td className="num cell-mono" style={{ color: 'var(--fg5)' }}>{fmtCurrency(o.fees, cur, 2)}</td>
                    <td className="num cell-mono" style={{ color: o.netAmountUsd < 0 ? 'var(--danger)' : 'var(--fg1)' }}>{fmtCurrency(o.netAmountUsd, cur, 2)}</td>
                    <td><span className={`st st-${statusLc}`}>{statusLc}</span></td>
                    <td className="num cell-mono">{fmtCurrency(o.cpaPaidUsd, cur, 2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {drawer && (
        <TransactionDrawer
          externalId={drawer.externalId}
          platformSlug={drawer.platformSlug}
          cur={cur}
          onClose={() => setDrawer(null)}
          onPickOrder={(o) => setDrawer({ externalId: o.externalId, platformSlug: drawer.platformSlug })}
        />
      )}
    </div>
  );
}

// ---------- TRANSACTION DRAWER (per-order detail) ----------
function TransactionDrawer({ externalId, platformSlug, cur, onClose, onPickOrder }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', data: null, error: null });
    window.NSApi.fetchOrderDetail(externalId, platformSlug)
      .then((data) => { if (!cancelled) setState({ status: 'ready', data, error: null }); })
      .catch((err) => {
        if (cancelled) return;
        console.error('fetchOrderDetail failed', err);
        setState({ status: 'error', data: null, error: err.message });
      });
    return () => { cancelled = true; };
  }, [externalId, platformSlug]);

  if (state.status === 'loading') {
    return ReactDOM.createPortal((
      <>
        <div className="drawer-backdrop" onClick={onClose}/>
        <div className="drawer" style={{ width: 540 }}>
          <div className="drawer-head">
            <span style={{ color: 'var(--fg4)' }}>Carregando pedido {externalId}...</span>
            <button className="icon-btn" onClick={onClose}><Icon name="x" size={14}/></button>
          </div>
        </div>
      </>
    ), document.body);
  }
  if (state.status === 'error' || !state.data) {
    return ReactDOM.createPortal((
      <>
        <div className="drawer-backdrop" onClick={onClose}/>
        <div className="drawer" style={{ width: 540 }}>
          <div className="drawer-head">
            <span style={{ color: 'var(--danger)' }}>Erro: {state.error || 'pedido não encontrado'}</span>
            <button className="icon-btn" onClick={onClose}><Icon name="x" size={14}/></button>
          </div>
        </div>
      </>
    ), document.body);
  }

  const { order: o, product, affiliate, customer, session, isCrossSell } = state.data;
  const platShort = o.platformSlug === 'digistore24' ? 'D24' : 'CB';
  const platClass = o.platformSlug === 'digistore24' ? 'plat-d24' : 'plat-cb';
  const typeLabel = txTypeLabel(o.productType, o.funnelStep);
  const typeColor = txTypeColor(o.productType);
  const statusLc = o.status.toLowerCase();
  const sumSession = session.reduce((s, x) => x.status === 'APPROVED' ? s + x.grossAmountUsd : s, 0);

  return ReactDOM.createPortal((
    <>
      <div className="drawer-backdrop" onClick={onClose}/>
      <div className="drawer" style={{ width: 540 }}>
        <div className="drawer-head">
          <div>
            <span className="eyebrow">PEDIDO · {o.platformDisplayName.toUpperCase()}</span>
            <h3 style={{ margin: '4px 0', fontSize: 18, color: 'var(--fg1)' }}>{o.externalId}</h3>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className={`plat ${platClass}`}>{platShort}</span>
              <span className="badge" style={{ background: `${typeColor}22`, color: typeColor, borderColor: `${typeColor}55` }}>
                {typeLabel}
              </span>
              <span className={`st st-${statusLc}`}>{statusLc}</span>
              {isCrossSell && (
                <span className="badge" style={{ background: 'rgba(255,140,0,0.15)', color: 'var(--warning)', borderColor: 'rgba(255,140,0,0.4)' }}>
                  CROSS-SELL
                </span>
              )}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>

        <div style={{ padding: '16px 18px 32px', display: 'grid', gap: 16 }}>

          {/* Financial breakdown */}
          <div>
            <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg4)', letterSpacing: '0.1em', marginBottom: 8 }}>
              FLUXO FINANCEIRO
            </div>
            <FinRow label="Cliente pagou" value={o.grossAmountUsd} cur={cur} bold/>
            <FinRow label="Imposto / IVA" value={-o.taxAmount} cur={cur} muted/>
            <FinRow label="Plataforma reteve" value={-o.platformRetention} cur={cur} muted />
            <FinRow
              label={o.cpaPaidUsd > 0
                ? 'Afiliado recebeu (CPA)'
                : `Afiliado recebeu (CPA) — sem CPA neste ${o.productType === 'UPSELL' ? 'upsell' : o.productType === 'DOWNSELL' ? 'downsell' : 'pedido'}`}
              value={-o.cpaPaidUsd}
              cur={cur}
              accent={o.cpaPaidUsd > 0 ? 'var(--glow-cyan)' : 'var(--navy-400)'}
              muted={o.cpaPaidUsd === 0}
            />
            <div style={{ height: 1, background: 'var(--border)', margin: '8px 0' }}/>
            <FinRow label={o.status === 'APPROVED' ? 'Empresa recebeu' : 'Empresa receberia (refund/cb)'}
                    value={o.companyKept} cur={cur}
                    accent={o.status === 'APPROVED' ? (o.companyKept > 0 ? 'var(--success)' : 'var(--danger)') : 'var(--navy-400)'}/>
            {o.cogsUsd != null && o.fulfillmentUsd != null && (
              <>
                <FinRow label="Custo do produto" value={-o.cogsUsd} cur={cur} muted/>
                <FinRow label="Frete" value={-o.fulfillmentUsd} cur={cur} muted/>
                <div style={{ height: 1, background: 'var(--border)', margin: '8px 0' }}/>
                <FinRow
                  label={o.status === 'APPROVED' ? 'LUCRO LÍQUIDO' : 'PREJUÍZO (refund/cb)'}
                  value={o.estimatedProfit ?? 0}
                  cur={cur}
                  bold
                  accent={(o.estimatedProfit ?? 0) > 0 ? 'var(--success)' : 'var(--danger)'}
                />
                {o.estimatedMarginPct != null && (
                  <div style={{ textAlign: 'right', fontFamily: 'var(--f-mono)', fontSize: 11,
                                color: o.estimatedMarginPct > 10 ? 'var(--success)'
                                     : o.estimatedMarginPct > 0  ? 'var(--warning)'
                                     :                              'var(--danger)' }}>
                    margem {o.estimatedMarginPct.toFixed(1)}%
                  </div>
                )}
              </>
            )}
            {o.cogsUsd == null && (
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--fg5)', fontStyle: 'italic' }}>
                COGS não calculado pra este pedido — rode /api/admin/backfill-cogs.
              </div>
            )}
            {o.currencyOriginal !== 'USD' && (
              <div style={{ marginTop: 6, fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg5)' }}>
                Original: {fmtCurrency(o.grossAmountOrig, o.currencyOriginal, 2)} ({o.currencyOriginal})
              </div>
            )}
          </div>

          {/* Product */}
          <div>
            <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg4)', letterSpacing: '0.1em', marginBottom: 8 }}>
              PRODUTO
            </div>
            <div style={{ fontFamily: 'var(--f-display)', fontSize: 16, color: 'var(--fg1)' }}>{product.name}</div>
            <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--fg4)', marginTop: 2 }}>
              SKU: {product.externalId}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {product.family && <Pill label={product.family} color={familyAccent(product.family)}/>}
              {product.bottles != null && <Pill label={`${product.bottles} bottles`}/>}
              {product.variant && <Pill label={`var: ${product.variant}`}/>}
              {product.catalogPriceUsd != null && (
                <Pill label={`Catálogo: ${fmtCurrency(product.catalogPriceUsd, cur, 0)}`}/>
              )}
              {o.vendorAccount && <Pill label={`Vendor: ${o.vendorAccount}`}/>}
            </div>
          </div>

          {/* Affiliate */}
          {affiliate ? (
            <div>
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg4)', letterSpacing: '0.1em', marginBottom: 8 }}>
                AFILIADO
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="av" style={{ background: avatarColor(affiliate.externalId) }}>
                  {initials(affiliate.nickname || affiliate.externalId)}
                </div>
                <div>
                  <div style={{ color: 'var(--fg1)' }}>{affiliate.nickname || '(sem nickname)'}</div>
                  <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--fg4)' }}>{affiliate.externalId}</div>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg4)', letterSpacing: '0.1em', marginBottom: 8 }}>
                AFILIADO
              </div>
              <div style={{ fontSize: 12, color: 'var(--fg5)', fontStyle: 'italic' }}>
                Venda direta (sem afiliado atribuído)
              </div>
            </div>
          )}

          {/* Customer */}
          {customer && (
            <div>
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg4)', letterSpacing: '0.1em', marginBottom: 8 }}>
                CLIENTE
              </div>
              <div style={{ color: 'var(--fg1)' }}>
                {[customer.firstName, customer.lastName].filter(Boolean).join(' ') || '(nome n/d)'}
              </div>
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--fg4)' }}>
                {customer.email || '—'} · {o.country || customer.country || '—'} · {customer.language || 'n/d'}
              </div>
            </div>
          )}

          {/* Session */}
          {session.length > 1 && (
            <div>
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg4)', letterSpacing: '0.1em', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                <span>SESSÃO COMPLETA · {session.length} pedidos</span>
                <span style={{ color: 'var(--success)' }}>{fmtCurrency(sumSession, cur, 2)}</span>
              </div>
              <div style={{ display: 'grid', gap: 4 }}>
                {session.map((s) => {
                  const sStatusLc = s.status.toLowerCase();
                  const sType = txTypeLabel(s.productType, s.funnelStep);
                  const sColor = txTypeColor(s.productType);
                  return (
                    <button
                      key={s.externalId}
                      onClick={() => !s.isSelf && onPickOrder(s)}
                      disabled={s.isSelf}
                      style={{
                        textAlign: 'left', font: 'inherit', padding: '6px 8px', borderRadius: 4,
                        background: s.isSelf ? 'rgba(91,200,255,0.1)' : 'rgba(91,200,255,0.04)',
                        border: '1px solid var(--border-soft)', cursor: s.isSelf ? 'default' : 'pointer',
                        display: 'grid', gridTemplateColumns: '64px 1fr auto auto', gap: 8, alignItems: 'center',
                      }}
                    >
                      <span className="badge" style={{ background: `${sColor}22`, color: sColor, borderColor: `${sColor}55`, fontSize: 9, justifySelf: 'start' }}>
                        {sType}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--fg2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.productName}
                        {s.isCrossSell && <span style={{ color: 'var(--warning)', marginLeft: 6, fontSize: 10 }}>cross</span>}
                      </span>
                      <span className={`st st-${sStatusLc}`} style={{ fontSize: 9 }}>{sStatusLc}</span>
                      <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--fg1)' }}>
                        {fmtCurrency(s.grossAmountUsd, cur, 2)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tracking */}
          {(o.clickId || o.trackingId || o.campaignKey || o.trafficSource) && (
            <div>
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg4)', letterSpacing: '0.1em', marginBottom: 8 }}>
                ORIGEM DO TRÁFEGO
              </div>
              <div style={{ display: 'grid', gap: 4, fontFamily: 'var(--f-mono)', fontSize: 11 }}>
                {o.trafficSource && <KV k="source" v={o.trafficSource}/>}
                {o.campaignKey && <KV k="campaign" v={o.campaignKey}/>}
                {o.clickId && <KV k="click_id" v={o.clickId}/>}
                {o.trackingId && <KV k="tracking_id" v={o.trackingId}/>}
              </div>
            </div>
          )}

          {/* Timeline */}
          <div>
            <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg4)', letterSpacing: '0.1em', marginBottom: 8 }}>
              TIMELINE
            </div>
            <div style={{ display: 'grid', gap: 4, fontFamily: 'var(--f-mono)', fontSize: 11 }}>
              <KV k="ordered" v={fmtDateTime(o.orderedAt)}/>
              {o.approvedAt && <KV k="approved" v={fmtDateTime(o.approvedAt)}/>}
              {o.refundedAt && <KV k="refunded" v={fmtDateTime(o.refundedAt)} color="var(--danger)"/>}
              {o.chargebackAt && <KV k="chargeback" v={fmtDateTime(o.chargebackAt)} color="var(--danger)"/>}
              {o.paymentMethod && <KV k="method" v={o.paymentMethod}/>}
              {o.billingType && o.billingType !== 'UNKNOWN' && <KV k="billing" v={o.billingType}/>}
            </div>
          </div>

          {o.detailsUrl && (
            <a href={o.detailsUrl} target="_blank" rel="noopener noreferrer"
               style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                        borderRadius: 4, background: 'rgba(91,200,255,0.06)', color: 'var(--glow-cyan)',
                        border: '1px solid var(--border-soft)', textDecoration: 'none',
                        fontFamily: 'var(--f-mono)', fontSize: 11 }}>
              <Icon name="link" size={12}/> Abrir receipt na plataforma
            </a>
          )}
        </div>
      </div>
    </>
  ), document.body);
}

function FinRow({ label, value, cur, bold, muted, accent }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', padding: '4px 0',
      fontSize: 12, color: muted ? 'var(--navy-400)' : 'var(--navy-100)',
    }}>
      <span>{label}</span>
      <span style={{
        fontFamily: 'var(--f-mono)',
        color: accent || (bold ? 'var(--white)' : 'inherit'),
        fontWeight: bold ? 600 : 400,
      }}>
        {fmtCurrency(value, cur, 2)}
      </span>
    </div>
  );
}

function Pill({ label, color }) {
  return (
    <span className="badge" style={{
      background: color ? `${color}22` : 'rgba(255,255,255,0.05)',
      color: color || 'var(--navy-100)',
      borderColor: color ? `${color}55` : 'var(--border-soft)',
      fontSize: 10,
    }}>{label}</span>
  );
}

function KV({ k, v, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color: 'var(--fg5)' }}>{k}</span>
      <span style={{ color: color || 'var(--white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {v}
      </span>
    </div>
  );
}

function txTypeLabel(productType, funnelStep) {
  if (productType === 'FRONTEND') return 'FRONTEND';
  if (productType === 'BUMP') return 'ORDER BUMP';
  if (productType === 'DOWNSELL') return 'DOWNSELL';
  if (productType === 'SMS_RECOVERY') return 'SMS RECOVERY';
  if (productType === 'UPSELL') return funnelStep && funnelStep >= 2 ? 'UPSELL 2' : 'UPSELL 1';
  return productType;
}
function txTypeColor(productType) {
  switch (productType) {
    case 'FRONTEND': return '#5BC8FF';
    case 'UPSELL': return '#4A90FF';
    case 'BUMP': return '#8B7FFF';
    case 'DOWNSELL': return '#FF8B5B';
    case 'SMS_RECOVERY': return '#9B7BFF';
    default: return '#8CA1C8';
  }
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
                    <span style={{ fontSize: 11, color: 'var(--fg4)', marginLeft: 6 }}>
                      / {fmtInt(p.affiliatesTotal)} no total
                    </span>
                  </div>
                </div>
              </div>

              {p.topProduct && (
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(91,200,255,0.15)' }}>
                  <div style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--fg4)', marginBottom: 4 }}>
                    TOP PRODUTO
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--fg1)', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
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
                <div className="ph-logo" style={{ color: 'var(--fg5)' }}>{p.short}</div>
                <div className="txt">
                  <span className="nm">{p.displayName}</span>
                  <span className="sync">Não configurado</span>
                </div>
              </div>
              <span className="badge neutral">EM BREVE</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg3)', lineHeight: 1.5, marginTop: 8 }}>
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
                  <td className="cell-mono" style={{ color: 'var(--fg4)' }}>ECB · daily</td>
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

// Catálogo de tabs no client (espelha lib/auth/tabs.ts). Pra renderizar
// os checkboxes na criação/edição de Member. Mantenha em sincronia com
// o backend — se adicionar uma tab nova, atualize os DOIS lados.
const TAB_CATALOG = [
  { group: 'Análise',   id: 'overview',       label: 'Visão geral' },
  { group: 'Análise',   id: 'funnel',         label: 'Funil' },
  { group: 'Análise',   id: 'insights',       label: 'Insights' },
  { group: 'Afiliados', id: 'leaderboard',    label: 'Ranking' },
  { group: 'Afiliados', id: 'all-affiliates', label: 'Todos os afiliados' },
  { group: 'Afiliados', id: 'networks',       label: 'Networks' },
  { group: 'Catálogo',  id: 'products',       label: 'Produtos' },
  { group: 'Catálogo',  id: 'transactions',   label: 'Transações' },
  { group: 'Sistema',   id: 'platforms',      label: 'Plataformas' },
  { group: 'Sistema',   id: 'costs',          label: 'Custos' },
  { group: 'Sistema',   id: 'health',         label: 'Saúde do dado' },
];
const TAB_GROUPS = ['Análise', 'Afiliados', 'Catálogo', 'Sistema'];

function UsersPage({ currentUser }) {
  const [state, setState] = useState({ status: 'loading', users: [], pagination: null, error: null });
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [bumpRefresh, setBumpRefresh] = useState(0);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading' }));
    window.NSApi.adminListUsers({ page, pageSize: 50 })
      .then((data) => { if (!cancelled) setState({ status: 'ready', users: data.users, pagination: data.pagination || null, error: null }); })
      .catch((err) => {
        if (cancelled) return;
        console.error('adminListUsers failed', err);
        setState({ status: 'error', users: [], pagination: null, error: err.message });
      });
    return () => { cancelled = true; };
  }, [bumpRefresh, page]);

  function reload() { setBumpRefresh((n) => n + 1); }

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">ADMIN · USUÁRIOS DO DASHBOARD</span>
          <h2>Quem tem <em>acesso</em></h2>
          <span className="sub">
            {state.users.length} {state.users.length === 1 ? 'usuário' : 'usuários'}
            {' · '}admin vê tudo, member vê só as abas marcadas
          </span>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Icon name="user-plus" size={12}/> Novo usuário
          </button>
        </div>
      </div>

      {state.status === 'error' && (
        <div className="panel" style={{ color: 'var(--danger)' }}>Erro: {state.error}</div>
      )}

      <div className="panel" style={{ padding: 0 }}>
        <div className="tbl-wrap" style={{ margin: 0, padding: '0 4px' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Usuário</th>
                <th>Papel</th>
                <th>Acesso</th>
                <th>Último login</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {state.status === 'loading' && (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, opacity: 0.6 }}>Carregando...</td></tr>
              )}
              {state.status === 'ready' && state.users.map((u) => {
                const isSelf = currentUser && u.id === currentUser.id;
                const display = u.name || u.email;
                return (
                  <tr key={u.id} onClick={() => setEditing(u)} style={{ cursor: 'pointer' }}>
                    <td>
                      <span className="cell-aff">
                        <span className="av" style={{ background: avatarColor(u.email) }}>{initials(display)}</span>
                        <span className="meta">
                          <span className="nm">
                            {display}
                            {isSelf && (
                              <span style={{ marginLeft: 6, fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--glow-cyan)', letterSpacing: '0.1em' }}>
                                VOCÊ
                              </span>
                            )}
                          </span>
                          <span className="id">{u.email}</span>
                        </span>
                      </span>
                    </td>
                    <td>
                      <span className="badge" style={{
                        background: u.role === 'ADMIN' ? 'rgba(91,200,255,0.15)' : 'rgba(155,123,255,0.15)',
                        color: u.role === 'ADMIN' ? 'var(--glow-cyan)' : '#9B7BFF',
                        borderColor: u.role === 'ADMIN' ? 'rgba(91,200,255,0.4)' : 'rgba(155,123,255,0.4)',
                      }}>
                        {u.role}
                      </span>
                    </td>
                    <td>
                      {u.role === 'ADMIN' ? (
                        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--glow-cyan)' }}>todas as abas</span>
                      ) : (
                        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: u.allowedTabs.length === 0 ? 'var(--danger)' : 'var(--navy-200)' }}>
                          {u.allowedTabs.length === 0 ? 'nenhuma aba' : `${u.allowedTabs.length} ${u.allowedTabs.length === 1 ? 'aba' : 'abas'}`}
                        </span>
                      )}
                    </td>
                    <td className="cell-mono" style={{ color: 'var(--fg4)', fontSize: 11 }}>
                      {u.lastLoginAt ? fmtRelative(u.lastLoginAt) : '—'}
                    </td>
                    <td>
                      <span className="badge" style={{
                        background: u.active ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                        color: u.active ? 'var(--success)' : 'var(--danger)',
                        borderColor: u.active ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)',
                      }}>
                        {u.active ? 'ATIVO' : 'INATIVO'}
                      </span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button className="btn btn-ghost" onClick={() => setEditing(u)}>
                        <Icon name="edit" size={11}/> Editar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {state.pagination && (
            <Pagination
              page={state.pagination.page}
              pageSize={state.pagination.pageSize}
              total={state.pagination.total}
              hasMore={state.pagination.hasMore}
              onChange={setPage}
            />
          )}
        </div>
      </div>

      {creating && (
        <UserFormDrawer
          mode="create"
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); reload(); }}
        />
      )}
      {editing && (
        <UserFormDrawer
          mode="edit"
          initial={editing}
          isSelf={currentUser && editing.id === currentUser.id}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </div>
  );
}

function fmtRelative(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return 'agora';
  const min = Math.floor(ms / 60000);
  if (min < 60) return `há ${min}min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `há ${hr}h`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `há ${d}d`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

function UserFormDrawer({ mode, initial, isSelf, onClose, onSaved }) {
  const isCreate = mode === 'create';
  const [email, setEmail] = useState(initial?.email || '');
  const [name, setName] = useState(initial?.name || '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState(initial?.role || 'MEMBER');
  const [allowedTabs, setAllowedTabs] = useState(new Set(initial?.allowedTabs || []));
  const [active, setActive] = useState(initial?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showResetField, setShowResetField] = useState(false);
  // Pra role NETWORK_PARTNER: lista de networks pra escolher e qual está
  // selecionada. Carregada lazy quando role passa pra NETWORK_PARTNER.
  const [networks, setNetworks] = useState(null); // null = ainda não carregou
  const [networkId, setNetworkId] = useState(initial?.networkId || '');

  useEffect(() => {
    if (role !== 'NETWORK_PARTNER' || networks !== null) return;
    let cancelled = false;
    window.NSApi.adminListNetworks()
      .then((data) => { if (!cancelled) setNetworks(data.networks || []); })
      .catch(() => { if (!cancelled) setNetworks([]); });
    return () => { cancelled = true; };
  }, [role, networks]);

  function toggleTab(id) {
    setAllowedTabs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function selectAllInGroup(group) {
    setAllowedTabs((prev) => {
      const next = new Set(prev);
      for (const t of TAB_CATALOG) if (t.group === group) next.add(t.id);
      return next;
    });
  }
  function clearGroup(group) {
    setAllowedTabs((prev) => {
      const next = new Set(prev);
      for (const t of TAB_CATALOG) if (t.group === group) next.delete(t.id);
      return next;
    });
  }
  function selectAllTabs() {
    setAllowedTabs(new Set(TAB_CATALOG.map((t) => t.id)));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (role === 'NETWORK_PARTNER' && !networkId) {
        setError('selecione a network deste partner');
        setBusy(false);
        return;
      }
      const payload = {
        name: name || (isCreate ? undefined : null),
        role,
        allowedTabs: role === 'MEMBER' ? Array.from(allowedTabs) : [],
        ...(role === 'NETWORK_PARTNER' ? { networkId } : {}),
      };
      if (isCreate) {
        await window.NSApi.adminCreateUser({
          email,
          password,
          ...payload,
        });
      } else {
        await window.NSApi.adminPatchUser(initial.id, {
          ...payload,
          active,
        });
        if (showResetField && password) {
          await window.NSApi.adminResetUserPassword(initial.id, password);
        }
      }
      onSaved();
    } catch (err) {
      setError(err.message || 'erro');
      setBusy(false);
    }
  }

  async function deleteUser() {
    if (!confirm(`Desativar ${initial.email}? Sessões ativas serão derrubadas. (Pode reativar depois.)`)) return;
    setBusy(true);
    try {
      await window.NSApi.adminDeleteUser(initial.id);
      onSaved();
    } catch (err) {
      setError(err.message || 'erro');
      setBusy(false);
    }
  }

  function genPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let out = '';
    const arr = new Uint32Array(14);
    crypto.getRandomValues(arr);
    for (let i = 0; i < 14; i++) out += chars[arr[i] % chars.length];
    setPassword(out);
    if (!isCreate) setShowResetField(true);
  }

  // Portalizamos pro body pra escapar do stacking context da .page-in
  // (criado pela animation: pageIn que toca opacity — mesmo após terminar,
  // alguns browsers mantêm o layer e o modal acaba ficando "atrás" da
  // topbar mesmo com z-index alto).
  return ReactDOM.createPortal((
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className="eyebrow">{isCreate ? 'NOVO USUÁRIO' : 'EDITAR USUÁRIO'}</span>
            <h3 style={{ margin: '4px 0', fontSize: 18, color: 'var(--fg1)' }}>
              {isCreate ? 'Convidar pro dashboard' : (initial.name || initial.email)}
            </h3>
            {!isCreate && (
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--fg4)' }}>
                {initial.email}{isSelf && ' · você'}
              </div>
            )}
          </div>
          <button className="icon-btn" onClick={onClose} title="Fechar"><Icon name="x" size={14}/></button>
        </div>

        <div className="modal-body">
          {isCreate && (
            <UserField label="E-mail" value={email} onChange={setEmail} type="email" required/>
          )}
          <UserField label="Nome (opcional)" value={name} onChange={setName} type="text"/>

          {isCreate && (
            <div style={{ display: 'grid', gap: 6 }}>
              <UserField label="Senha (mín. 10 caracteres)" value={password} onChange={setPassword} type="text"/>
              <button
                onClick={genPassword}
                style={{
                  justifySelf: 'start', padding: '4px 10px', fontFamily: 'var(--f-mono)', fontSize: 10,
                  color: 'var(--glow-cyan)', background: 'rgba(91,200,255,0.08)',
                  border: '1px solid rgba(91,200,255,0.3)', borderRadius: 4, cursor: 'pointer',
                  letterSpacing: '0.08em',
                }}
              >
                <Icon name="key" size={10}/> GERAR
              </button>
            </div>
          )}

          <div style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--fg4)' }}>PAPEL</span>
            <div className="seg" style={{ width: 'fit-content' }}>
              {[['MEMBER', 'Member'], ['ADMIN', 'Admin'], ['NETWORK_PARTNER', 'Partner']].map(([k, l]) => (
                <button
                  key={k}
                  className={role === k ? 'is-active' : ''}
                  onClick={() => setRole(k)}
                  disabled={isSelf && initial?.role === 'ADMIN' && k !== 'ADMIN'}
                  title={isSelf && initial?.role === 'ADMIN' && k !== 'ADMIN' ? 'admin não pode se rebaixar' : ''}
                >
                  {l}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg5)', fontFamily: 'var(--f-mono)' }}>
              {role === 'ADMIN' && 'Admin acessa todas as abas + gerencia outros usuários.'}
              {role === 'MEMBER' && 'Member acessa só as abas marcadas abaixo.'}
              {role === 'NETWORK_PARTNER' && 'Partner externo de uma network. Acessa só os dados da própria network (afiliados, comissões, payouts, contrato).'}
            </div>
          </div>

          {role === 'NETWORK_PARTNER' && (
            <div style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--fg4)' }}>
                NETWORK VINCULADA
              </span>
              {networks === null ? (
                <div style={{ fontSize: 12, color: 'var(--fg5)' }}>Carregando networks...</div>
              ) : networks.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--warning)' }}>
                  Nenhuma network cadastrada. Crie uma na aba <strong>Networks</strong> antes de criar um partner.
                </div>
              ) : (
                <select
                  value={networkId}
                  onChange={(e) => setNetworkId(e.target.value)}
                  style={{
                    padding: '9px 12px', fontSize: 13, color: 'var(--fg1)',
                    background: 'rgba(91,200,255,0.05)', border: '1px solid rgba(91,200,255,0.2)',
                    borderRadius: 6,
                  }}
                >
                  <option value="">— escolher network —</option>
                  {networks.map((n) => (
                    <option key={n.id} value={n.id}>{n.name}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {role === 'MEMBER' && (
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--fg4)' }}>
                  ABAS LIBERADAS · {allowedTabs.size}
                </span>
                <button
                  onClick={selectAllTabs}
                  style={{ background: 'transparent', border: 0, color: 'var(--glow-cyan)',
                           fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.08em',
                           cursor: 'pointer' }}
                >
                  TUDO
                </button>
              </div>
              {TAB_GROUPS.map((group) => {
                const tabs = TAB_CATALOG.filter((t) => t.group === group);
                const checked = tabs.filter((t) => allowedTabs.has(t.id)).length;
                return (
                  <div key={group} style={{ border: '1px solid var(--border-soft)', borderRadius: 6, padding: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg4)', letterSpacing: '0.1em' }}>
                        {group.toUpperCase()} · {checked}/{tabs.length}
                      </span>
                      <span style={{ display: 'flex', gap: 4 }}>
                        <button
                          onClick={() => selectAllInGroup(group)}
                          style={{ background: 'transparent', border: 0, color: 'var(--glow-cyan)',
                                   fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '0.08em', cursor: 'pointer' }}
                        >TODOS</button>
                        <button
                          onClick={() => clearGroup(group)}
                          style={{ background: 'transparent', border: 0, color: 'var(--fg5)',
                                   fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '0.08em', cursor: 'pointer' }}
                        >NENHUM</button>
                      </span>
                    </div>
                    <div style={{ display: 'grid', gap: 4 }}>
                      {tabs.map((t) => (
                        <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--fg1)', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={allowedTabs.has(t.id)}
                            onChange={() => toggleTab(t.id)}
                            style={{ accentColor: 'var(--glow-cyan)' }}
                          />
                          {t.label}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!isCreate && (
            <div style={{ display: 'grid', gap: 6, paddingTop: 6, borderTop: '1px solid var(--border-soft)' }}>
              <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--fg4)' }}>STATUS</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--fg1)', cursor: isSelf ? 'not-allowed' : 'pointer', opacity: isSelf ? 0.6 : 1 }}>
                <input
                  type="checkbox"
                  checked={active}
                  disabled={isSelf}
                  onChange={(e) => setActive(e.target.checked)}
                  style={{ accentColor: 'var(--glow-cyan)' }}
                />
                Conta ativa {isSelf && '(você não pode desativar a si mesmo)'}
              </label>
            </div>
          )}

          {!isCreate && (
            <div style={{ display: 'grid', gap: 6, paddingTop: 6, borderTop: '1px solid var(--border-soft)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--fg4)' }}>SENHA</span>
                {!showResetField && (
                  <button
                    onClick={() => setShowResetField(true)}
                    style={{ background: 'rgba(255,180,0,0.08)', border: '1px solid rgba(255,180,0,0.3)',
                             color: 'var(--warning)', fontFamily: 'var(--f-mono)', fontSize: 10,
                             letterSpacing: '0.08em', padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}
                  >
                    <Icon name="key" size={10}/> RESETAR SENHA
                  </button>
                )}
              </div>
              {showResetField && (
                <div style={{ display: 'grid', gap: 6 }}>
                  <UserField label="Nova senha (mín. 10)" value={password} onChange={setPassword} type="text"/>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={genPassword}
                      style={{ padding: '4px 10px', fontFamily: 'var(--f-mono)', fontSize: 10,
                               color: 'var(--glow-cyan)', background: 'rgba(91,200,255,0.08)',
                               border: '1px solid rgba(91,200,255,0.3)', borderRadius: 4,
                               cursor: 'pointer', letterSpacing: '0.08em' }}
                    ><Icon name="key" size={10}/> GERAR</button>
                    <button
                      onClick={() => { setShowResetField(false); setPassword(''); }}
                      style={{ padding: '4px 10px', fontFamily: 'var(--f-mono)', fontSize: 10,
                               color: 'var(--fg5)', background: 'transparent',
                               border: '1px solid var(--border-soft)', borderRadius: 4,
                               cursor: 'pointer', letterSpacing: '0.08em' }}
                    >CANCELAR</button>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--warning)', fontFamily: 'var(--f-mono)' }}>
                    Ao salvar, sessões ativas deste usuário serão derrubadas.
                  </div>
                </div>
              )}
            </div>
          )}

          {error && (
            <div style={{ fontSize: 12, color: 'var(--danger)', background: 'rgba(239,68,68,0.08)',
                          border: '1px solid rgba(239,68,68,0.25)', padding: '8px 10px', borderRadius: 6,
                          fontFamily: 'var(--f-mono)' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 8, paddingTop: 12, borderTop: '1px solid var(--border-soft)' }}>
            <button
              className="btn btn-primary"
              onClick={save}
              disabled={busy || (isCreate && (!email || !password))}
              style={{ flex: 1 }}
            >
              {busy ? 'SALVANDO...' : (isCreate ? 'CRIAR USUÁRIO' : 'SALVAR ALTERAÇÕES')}
            </button>
            {!isCreate && !isSelf && (
              <button
                onClick={deleteUser}
                disabled={busy || !initial.active}
                style={{
                  padding: '8px 12px', fontFamily: 'var(--f-mono)', fontSize: 11, letterSpacing: '0.08em',
                  color: 'var(--danger)', background: 'rgba(239,68,68,0.08)',
                  border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6,
                  cursor: busy ? 'not-allowed' : 'pointer',
                }}
                title={!initial.active ? 'já está inativo' : 'desativa + derruba sessões'}
              >
                <Icon name="trash" size={11}/> DESATIVAR
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}

function UserField({ label, value, onChange, type, required }) {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--fg4)' }}>
        {label.toUpperCase()}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        style={{
          padding: '9px 12px', fontSize: 13, color: 'var(--fg1)',
          background: 'rgba(91,200,255,0.05)', border: '1px solid rgba(91,200,255,0.2)',
          borderRadius: 6, outline: 'none', fontFamily: 'inherit',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--glow-cyan)'; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(91,200,255,0.2)'; }}
      />
    </label>
  );
}

// ---------- HEALTH (data quality + ingestion freshness) ----------
function HealthPage() {
  const [state, setH] = useState({ status: 'loading', data: null, error: null });
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setH((s) => ({ ...s, status: 'loading' }));
    window.NSApi.fetchHealth()
      .then((data) => { if (!cancelled) setH({ status: 'ready', data, error: null }); })
      .catch((err) => {
        if (cancelled) return;
        console.error('fetchHealth failed', err);
        setH({ status: 'error', data: null, error: err.message });
      });
    return () => { cancelled = true; };
  }, [refreshTick]);

  if (state.status === 'loading' && !state.data) {
    return <div className="page-in"><div className="panel">Carregando saúde do dado...</div></div>;
  }
  if (state.status === 'error') {
    return <div className="page-in"><div className="panel" style={{ color: 'var(--danger)' }}>Erro: {state.error}</div></div>;
  }

  const d = state.data;
  const refundDelta = d.health.refundRate24h - d.health.refundRateBaseline30d;
  const refundColor = refundDelta > 0.005 ? 'var(--danger)' : refundDelta > 0 ? 'var(--warning)' : 'var(--success)';

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">SISTEMA · OBSERVABILIDADE</span>
          <h2>Saúde <em>do dado</em></h2>
          <span className="sub">
            Atualizado {fmtDateTime(d.generatedAt)} · {d.metricsView.rowCount} linhas na MV daily_metrics
          </span>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-ghost" onClick={() => setRefreshTick((t) => t + 1)}>
            <Icon name="refresh" size={12}/> Atualizar
          </button>
        </div>
      </div>

      {/* Per-platform ingestion */}
      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-head">
          <div className="panel-title">
            <span className="panel-eyebrow">INGESTÃO POR PLATAFORMA · ÚLTIMAS 24H</span>
            <div className="panel-sub">Recebido = IPNs aceitos · Falhados = parse/auth errors</div>
          </div>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Plataforma</th>
                <th>Última ingestão</th>
                <th className="num">Recebido 24h</th>
                <th className="num">Falhados 24h</th>
                <th className="num">Sucesso</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {d.ingestion.perPlatform.map((p) => {
                const stale = p.secondsAgo == null || p.secondsAgo > 6 * 3600;
                const noTraffic = p.receivedCount24h === 0;
                const failing = p.failedCount24h > 0;
                const ok = !stale && !noTraffic && !failing;
                const stateLabel = ok ? 'OK' : stale ? 'STALE' : noTraffic ? 'SEM TRÁFEGO' : 'FALHAS';
                const stateColor = ok ? 'var(--success)' : 'var(--warning)';
                return (
                  <tr key={p.platform}>
                    <td>{p.displayName}</td>
                    <td className="cell-mono" style={{ color: stale ? 'var(--danger)' : 'var(--navy-100)' }}>
                      {p.lastReceivedAt ? `${fmtAgo(p.secondsAgo)} atrás` : '—'}
                    </td>
                    <td className="num cell-mono">{fmtInt(p.receivedCount24h)}</td>
                    <td className="num cell-mono" style={{ color: failing ? 'var(--danger)' : 'var(--navy-300)' }}>
                      {fmtInt(p.failedCount24h)}
                    </td>
                    <td className="num cell-mono">{(p.successRate24h * 100).toFixed(1)}%</td>
                    <td>
                      <span className="badge" style={{ background: `${stateColor}22`, color: stateColor, borderColor: `${stateColor}55` }}>
                        {stateLabel}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Health rates */}
      <div className="grid-2" style={{ marginBottom: 14 }}>
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">
              <span className="panel-eyebrow">TAXAS · 24H</span>
              <div className="panel-sub">Status dos pedidos no último dia</div>
            </div>
          </div>
          <div style={{ display: 'grid', gap: 12, padding: '6px 0' }}>
            <HealthRate label="Aprovação" value={d.health.approvalRate24h} good="up" threshold={0.7}/>
            <HealthRate label="Refund" value={d.health.refundRate24h} good="down" threshold={0.02}
                       baseline={d.health.refundRateBaseline30d} baselineLabel="vs baseline 30d"
                       deltaColor={refundColor}/>
            <HealthRate label="Chargeback" value={d.health.chargebackRate24h} good="down" threshold={0.009}/>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">
              <span className="panel-eyebrow">CATÁLOGO</span>
              <div className="panel-sub">Cobertura de classificação SKU → família</div>
            </div>
          </div>
          <div style={{ display: 'grid', gap: 12, padding: '6px 0' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
              <span style={{ fontFamily: 'var(--f-display)', fontSize: 32, color: 'var(--fg1)' }}>
                {d.catalog.productsWithFamily}
              </span>
              <span style={{ fontSize: 12, color: 'var(--fg4)' }}>
                de {d.catalog.totalProducts} produtos classificados
                ({((d.catalog.productsWithFamily / Math.max(1, d.catalog.totalProducts)) * 100).toFixed(0)}%)
              </span>
            </div>
            {d.catalog.productsWithoutFamily > 0 ? (
              <>
                <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--warning)', letterSpacing: '0.1em' }}>
                  {d.catalog.productsWithoutFamily} SEM FAMÍLIA
                </div>
                <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--fg4)', maxHeight: 180, overflowY: 'auto', display: 'grid', gap: 4 }}>
                  {d.catalog.unknownSKUs.map((s, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.externalId}</span>
                      <span style={{ color: 'var(--fg5)' }}>{s.platform}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div style={{ color: 'var(--success)', fontSize: 12 }}>
                Todos produtos classificados ✓
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function HealthRate({ label, value, good, threshold, baseline, baselineLabel, deltaColor }) {
  const pct = (value * 100).toFixed(2);
  let color = 'var(--white)';
  if (good === 'up') color = value >= threshold ? 'var(--success)' : value >= threshold * 0.7 ? 'var(--warning)' : 'var(--danger)';
  if (good === 'down') color = value <= threshold ? 'var(--success)' : value <= threshold * 1.5 ? 'var(--warning)' : 'var(--danger)';
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ fontSize: 13, color: 'var(--fg3)' }}>{label}</span>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontFamily: 'var(--f-display)', fontSize: 22, color }}>{pct}%</div>
        {baseline != null && (
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: deltaColor || 'var(--navy-400)' }}>
            {(baseline * 100).toFixed(2)}% {baselineLabel}
          </div>
        )}
      </div>
    </div>
  );
}

function fmtAgo(seconds) {
  if (seconds == null) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}min`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

// ---------- COSTS (editable cost tables) ----------
function CostsPage() {
  const [state, setCostState] = useState({ status: 'loading', data: null, error: null });
  const [draftFamilies, setDraftFamilies] = useState({}); // { [family]: number }
  const [draftRates, setDraftRates] = useState({});       // { [bottlesMax]: number }
  // Token persisted in sessionStorage so the user only enters it once per
  // browser session. NOT localStorage — we don't want the secret to leak
  // beyond this tab's lifetime.
  const [token, setTokenState] = useState(() =>
    typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('ns-admin-token') || '' : '',
  );
  const [tokenInput, setTokenInput] = useState('');
  const [saveState, setSaveState] = useState({ status: 'idle', message: null });

  function setToken(t) {
    setTokenState(t);
    if (typeof sessionStorage !== 'undefined') {
      if (t) sessionStorage.setItem('ns-admin-token', t);
      else sessionStorage.removeItem('ns-admin-token');
    }
  }

  function reload() {
    setCostState((s) => ({ ...s, status: 'loading' }));
    window.NSApi.fetchCosts()
      .then((data) => setCostState({ status: 'ready', data, error: null }))
      .catch((err) => setCostState({ status: 'error', data: null, error: err.message }));
  }

  useEffect(() => { reload(); }, []);

  function valueForFamily(family) {
    if (family in draftFamilies) return draftFamilies[family];
    const f = state.data?.families.find((x) => x.family === family);
    return f != null ? f.unitCostUsd : 0;
  }
  function valueForRate(bottlesMax) {
    if (bottlesMax in draftRates) return draftRates[bottlesMax];
    const r = state.data?.fulfillment.find((x) => x.bottlesMax === bottlesMax);
    return r != null ? r.priceUsd : 0;
  }
  function familyDirty(family) {
    if (!(family in draftFamilies)) return false;
    const orig = state.data?.families.find((x) => x.family === family)?.unitCostUsd ?? 0;
    return parseFloat(draftFamilies[family]) !== orig;
  }
  function rateDirty(bottlesMax) {
    if (!(bottlesMax in draftRates)) return false;
    const orig = state.data?.fulfillment.find((x) => x.bottlesMax === bottlesMax)?.priceUsd ?? 0;
    return parseFloat(draftRates[bottlesMax]) !== orig;
  }
  function dirtyCount() {
    let n = 0;
    if (state.data) {
      for (const f of state.data.families) if (familyDirty(f.family)) n++;
      for (const r of state.data.fulfillment) if (rateDirty(r.bottlesMax)) n++;
    }
    return n;
  }
  function discardChanges() {
    setDraftFamilies({});
    setDraftRates({});
  }

  async function save() {
    if (!token) {
      setSaveState({ status: 'error', message: 'Token necessário pra salvar.' });
      return;
    }
    const familyChanges = Object.entries(draftFamilies)
      .map(([family, v]) => ({ family, unitCostUsd: parseFloat(v) }))
      .filter((x) => Number.isFinite(x.unitCostUsd) && x.unitCostUsd >= 0);
    const rateChanges = Object.entries(draftRates)
      .map(([bm, v]) => ({ bottlesMax: parseInt(bm, 10), priceUsd: parseFloat(v) }))
      .filter((x) => Number.isFinite(x.priceUsd) && x.priceUsd >= 0);
    if (!familyChanges.length && !rateChanges.length) {
      setSaveState({ status: 'idle', message: 'Sem mudanças' });
      return;
    }
    setSaveState({ status: 'saving', message: null });
    try {
      const result = await window.NSApi.adminSaveCosts(token, {
        families: familyChanges,
        fulfillment: rateChanges,
      });
      setSaveState({ status: 'saved', message: `${result.updated.families} famílias + ${result.updated.fulfillment} brackets salvos.` });
      setDraftFamilies({});
      setDraftRates({});
      reload();
    } catch (err) {
      setSaveState({ status: 'error', message: err.message });
    }
  }

  async function recompute() {
    if (!token) { setSaveState({ status: 'error', message: 'Token necessário' }); return; }
    if (!confirm('Recalcular COGS + frete em TODAS orders existentes com os preços atuais? Vai sobrescrever os snapshots históricos.')) return;
    setSaveState({ status: 'saving', message: 'Recomputando...' });
    try {
      const stats = await window.NSApi.adminBackfillCogs(token);
      setSaveState({
        status: 'saved',
        message: `${stats.scanned} orders, ${stats.cogsUpdated} COGS atualizados, ${stats.sessionsRebalanced} sessões rebalanceadas.`,
      });
    } catch (err) {
      setSaveState({ status: 'error', message: err.message });
    }
  }

  if (state.status === 'loading' && !state.data) {
    return <div className="page-in"><div className="panel">Carregando custos...</div></div>;
  }
  if (state.status === 'error') {
    return <div className="page-in"><div className="panel" style={{ color: 'var(--danger)' }}>Erro: {state.error}</div></div>;
  }

  const dCount = dirtyCount();

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">SISTEMA · CUSTOS DA OPERAÇÃO</span>
          <h2>Custos <em>de produção e envio</em></h2>
          <span className="sub">
            Editar aqui altera os snapshots de orders FUTUROS · "Recalcular" reescreve histórico
          </span>
        </div>
        <div className="page-head-actions">
          {dCount > 0 && (
            <button className="btn btn-ghost" onClick={discardChanges}>
              Descartar {dCount} {dCount === 1 ? 'mudança' : 'mudanças'}
            </button>
          )}
          <button
            className="btn btn-primary"
            disabled={dCount === 0 || saveState.status === 'saving'}
            onClick={save}
            style={{ opacity: dCount === 0 ? 0.5 : 1 }}
          >
            <Icon name="check" size={12}/> Salvar {dCount > 0 ? `(${dCount})` : ''}
          </button>
        </div>
      </div>

      {/* Token gate */}
      {!token && (
        <div className="panel" style={{ marginBottom: 14, background: 'rgba(255,180,0,0.06)', borderColor: 'rgba(255,180,0,0.4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Icon name="alert-triangle" size={14} className="" />
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 12, color: 'var(--fg1)', marginBottom: 4 }}>
                Token de admin necessário pra editar
              </div>
              <div style={{ fontSize: 11, color: 'var(--fg4)' }}>
                Bearer secret (mesmo INGEST_SECRET). Ficará na sessionStorage até fechar a aba.
              </div>
            </div>
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="bearer secret"
              style={{
                background: 'rgba(91,200,255,0.06)', border: '1px solid var(--border)',
                borderRadius: 4, padding: '6px 10px', color: 'var(--fg1)',
                fontFamily: 'var(--f-mono)', fontSize: 12, minWidth: 240,
              }}
            />
            <button className="btn btn-primary" onClick={() => { setToken(tokenInput); setTokenInput(''); }}>
              Autenticar
            </button>
          </div>
        </div>
      )}

      {/* Save status */}
      {saveState.message && (
        <div className="panel" style={{
          marginBottom: 14,
          background: saveState.status === 'error' ? 'rgba(239,68,68,0.06)' : 'rgba(40,200,120,0.06)',
          borderColor: saveState.status === 'error' ? 'rgba(239,68,68,0.4)' : 'rgba(40,200,120,0.4)',
          color: saveState.status === 'error' ? 'var(--danger)' : 'var(--success)',
          fontSize: 12,
        }}>
          {saveState.message}
        </div>
      )}

      <div className="grid-2">
        {/* Per-family unit cost */}
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">
              <span className="panel-eyebrow">CUSTO POR POTE · POR FAMÍLIA</span>
              <div className="panel-sub">Custo de produção que pagamos pro fornecedor por bottle</div>
            </div>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Família</th>
                  <th className="num">Custo / pote (USD)</th>
                  <th>Atualizado</th>
                </tr>
              </thead>
              <tbody>
                {state.data.families.map((f) => {
                  const dirty = familyDirty(f.family);
                  return (
                    <tr key={f.family}>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: familyAccent(f.family) }}/>
                          {f.family}
                        </span>
                      </td>
                      <td className="num">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          disabled={!token}
                          value={valueForFamily(f.family)}
                          onChange={(e) => setDraftFamilies((d) => ({ ...d, [f.family]: e.target.value }))}
                          style={costInputStyle(dirty, !token)}
                        />
                      </td>
                      <td className="cell-mono" style={{ color: 'var(--fg4)' }}>{fmtDateShort(f.updatedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Fulfillment brackets */}
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">
              <span className="panel-eyebrow">FRETE · POR BRACKET DE BOTTLES</span>
              <div className="panel-sub">Custo de envio que pagamos pelo total de bottles na sessão</div>
            </div>
          </div>
          <div className="tbl-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Bracket</th>
                  <th className="num">Bottles ≤</th>
                  <th className="num">Preço (USD)</th>
                </tr>
              </thead>
              <tbody>
                {state.data.fulfillment.map((r) => {
                  const dirty = rateDirty(r.bottlesMax);
                  return (
                    <tr key={r.bottlesMax}>
                      <td className="cell-mono" style={{ color: 'var(--fg4)', fontSize: 11 }}>{r.label}</td>
                      <td className="num cell-mono">{r.bottlesMax}</td>
                      <td className="num">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          disabled={!token}
                          value={valueForRate(r.bottlesMax)}
                          onChange={(e) => setDraftRates((d) => ({ ...d, [r.bottlesMax]: e.target.value }))}
                          style={costInputStyle(dirty, !token)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Recompute */}
      <div className="panel" style={{ marginTop: 14 }}>
        <div className="panel-head">
          <div className="panel-title">
            <span className="panel-eyebrow">RECALCULAR HISTÓRICO</span>
            <div className="panel-sub">
              Reescreve cogsUsd + fulfillmentUsd em TODAS orders existentes usando os preços atuais.
              Use após mudar custos pra refletir nos KPIs/lucros do passado.
            </div>
          </div>
          <div className="page-head-actions">
            <button
              className="btn btn-ghost"
              disabled={!token || saveState.status === 'saving'}
              onClick={recompute}
            >
              <Icon name="refresh" size={12}/> Recalcular orders existentes
            </button>
          </div>
        </div>
      </div>

      {/* Token clear */}
      {token && (
        <div style={{ marginTop: 18, fontSize: 11, color: 'var(--fg5)', textAlign: 'right' }}>
          Token autenticado nesta sessão · <button onClick={() => setToken('')} style={{ background: 'none', border: 0, color: 'var(--glow-cyan)', cursor: 'pointer', textDecoration: 'underline', font: 'inherit' }}>esquecer</button>
        </div>
      )}
    </div>
  );
}

function costInputStyle(dirty, disabled) {
  return {
    background: dirty ? 'rgba(91,200,255,0.15)' : 'rgba(91,200,255,0.06)',
    border: '1px solid ' + (dirty ? 'var(--glow-cyan)' : 'var(--border)'),
    borderRadius: 4,
    padding: '4px 8px',
    color: 'var(--fg1)',
    fontFamily: 'var(--f-mono)',
    fontSize: 12,
    width: 90,
    textAlign: 'right',
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'text',
  };
}

// ---------- INSIGHTS (narrative cards generated daily) ----------
function InsightsPage() {
  const [state, setInsState] = useState({ status: 'loading', data: null, error: null });
  const [layout, setLayout] = useState('tabs'); // 'tabs' (B) | 'feed' (C)
  const [activeCategory, setActiveCategory] = useState('all');

  useEffect(() => {
    let cancelled = false;
    setInsState((s) => ({ ...s, status: 'loading' }));
    window.NSApi.fetchInsights()
      .then((data) => { if (!cancelled) setInsState({ status: 'ready', data, error: null }); })
      .catch((err) => {
        if (cancelled) return;
        console.error('fetchInsights failed', err);
        setInsState({ status: 'error', data: null, error: err.message });
      });
    return () => { cancelled = true; };
  }, []);

  if (state.status === 'loading' && !state.data) {
    return <div className="page-in"><div className="panel">Computando insights...</div></div>;
  }
  if (state.status === 'error') {
    return <div className="page-in"><div className="panel" style={{ color: 'var(--danger)' }}>Erro: {state.error}</div></div>;
  }

  const insights = state.data?.insights || [];
  const generatedAt = state.data?.generatedAt;
  const windowDays = state.data?.windowDays || 30;

  const categories = [
    { id: 'profit', label: 'Lucro', icon: 'dollar' },
    { id: 'affiliates', label: 'Afiliados', icon: 'users' },
    { id: 'funnel', label: 'Funil', icon: 'bar-chart-3' },
    { id: 'operations', label: 'Operação', icon: 'plug' },
  ];
  const counts = categories.reduce((acc, c) => {
    acc[c.id] = insights.filter((i) => i.category === c.id).length;
    return acc;
  }, {});
  const alertCount = insights.filter((i) => i.severity === 'alert').length;

  const visible = layout === 'feed'
    ? insights
    : (activeCategory === 'all' ? insights : insights.filter((i) => i.category === activeCategory));

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">ANÁLISE · INSIGHTS · ÚLTIMOS {windowDays}D</span>
          <h2>O que a operação <em>está te dizendo</em></h2>
          <span className="sub">
            {insights.length} {insights.length === 1 ? 'insight' : 'insights'}
            {alertCount > 0 && <> · <span style={{ color: 'var(--danger)' }}>{alertCount} {alertCount === 1 ? 'alerta' : 'alertas'}</span></>}
            {generatedAt && <> · gerado {fmtDateTime(generatedAt)}</>}
          </span>
        </div>
        <div className="page-head-actions">
          <div className="seg">
            <button className={layout === 'tabs' ? 'is-active' : ''} onClick={() => setLayout('tabs')}>
              <Icon name="layout-dashboard" size={11}/> Por categoria
            </button>
            <button className={layout === 'feed' ? 'is-active' : ''} onClick={() => setLayout('feed')}>
              <Icon name="bar-chart-3" size={11}/> Feed
            </button>
          </div>
        </div>
      </div>

      {/* Tabs (when layout=tabs) */}
      {layout === 'tabs' && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, padding: 4,
                      background: 'rgba(91,200,255,0.04)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <InsightTab id="all" label="Todos" count={insights.length}
                      active={activeCategory === 'all'} onClick={() => setActiveCategory('all')}/>
          {categories.map((c) => (
            <InsightTab key={c.id} id={c.id} label={c.label} count={counts[c.id] || 0} icon={c.icon}
                        active={activeCategory === c.id} onClick={() => setActiveCategory(c.id)}/>
          ))}
        </div>
      )}

      {/* Insights list */}
      {visible.length === 0 && (
        <div className="panel" style={{ textAlign: 'center', padding: 32, color: 'var(--fg4)' }}>
          {layout === 'tabs' && activeCategory !== 'all'
            ? `Nenhum insight ativo nesta categoria. Tudo OK por aqui.`
            : `Nenhum insight ativo. Operação saudável neste período.`}
        </div>
      )}
      <div style={{ display: 'grid', gap: 10 }}>
        {visible.map((insight) => <InsightCard key={insight.id} insight={insight}/>)}
      </div>

      {/* Empty state by severity stats — celebrate green */}
      {insights.length > 0 && alertCount === 0 && layout === 'tabs' && activeCategory === 'all' && (
        <div className="panel" style={{ marginTop: 14, background: 'rgba(40,200,120,0.05)', borderColor: 'rgba(40,200,120,0.4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--success)' }}>
            <Icon name="check" size={14}/>
            <span>Sem alertas críticos. Os insights acima são oportunidades, não problemas.</span>
          </div>
        </div>
      )}
    </div>
  );
}

function InsightTab({ id, label, count, icon, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={active ? 'is-active' : ''}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '6px 12px', whiteSpace: 'nowrap',
        background: active ? 'rgba(91,200,255,0.15)' : 'transparent',
        border: active ? '1px solid rgba(91,200,255,0.4)' : '1px solid transparent',
        borderRadius: 6, cursor: 'pointer',
        fontFamily: 'var(--f-mono)', fontSize: 11, letterSpacing: '0.04em',
        color: active ? 'var(--white)' : 'var(--navy-200)',
      }}
    >
      {icon && <Icon name={icon} size={11}/>}
      {label}
      <span style={{
        fontSize: 10, fontFamily: 'var(--f-mono)',
        background: 'rgba(91,200,255,0.1)', color: 'var(--glow-cyan)',
        padding: '1px 5px', borderRadius: 3,
      }}>{count}</span>
    </button>
  );
}

function InsightCard({ insight }) {
  const sevColor = insight.severity === 'alert' ? 'var(--danger)'
    : insight.severity === 'good' ? 'var(--success)' : 'var(--glow-cyan)';
  const sevIcon = insight.severity === 'alert' ? 'alert-triangle'
    : insight.severity === 'good' ? 'check' : 'info';
  const catLabel = ({
    profit: 'LUCRO', affiliates: 'AFILIADOS', funnel: 'FUNIL', operations: 'OPERAÇÃO',
  })[insight.category] || insight.category;

  function onCta(e) {
    e.preventDefault();
    if (!insight.cta) return;
    history.pushState(null, '', insight.cta.href);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  return (
    <div className="panel" style={{ borderLeft: `3px solid ${sevColor}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ color: sevColor }}><Icon name={sevIcon} size={14}/></span>
            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: sevColor, letterSpacing: '0.16em' }}>
              {catLabel}
            </span>
          </div>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 16, color: 'var(--fg1)', letterSpacing: '-0.01em', lineHeight: 1.3 }}>
            {insight.headline}
          </div>
          {insight.body && (
            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--fg3)', lineHeight: 1.5 }}>
              {insight.body}
            </div>
          )}
        </div>
        {insight.cta && (
          <button onClick={onCta} className="btn btn-ghost" style={{ flexShrink: 0, fontSize: 11 }}>
            {insight.cta.label} <Icon name="chevron-right" size={11}/>
          </button>
        )}
      </div>
      {insight.metrics && insight.metrics.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-soft)' }}>
          {insight.metrics.map((m, i) => (
            <div key={i}>
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--fg5)', letterSpacing: '0.1em', marginBottom: 2 }}>
                {m.label.toUpperCase()}
              </div>
              <div style={{ fontSize: 12, color: 'var(--fg2)' }}>{m.value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ==========================================================================
// NETWORKS / SUBAFILIADOS — backed by /api/admin/networks
// Lista, criação, attach de afiliados, geração de payout, mark-as-paid e
// download de contrato em PDF. Cada commission row é gerada server-side
// quando uma venda FE de afiliado vinculado é aprovada (hook em
// upsertOrder). Refunds NÃO afetam comissões — admin sempre paga o
// pactuado. Schema em prisma/schema.prisma:Network*.
// ==========================================================================

function fmtRelativeShort(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return 'agora';
  if (ms < 3600000) return `${Math.floor(ms / 60000)}min`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h`;
  const d = Math.floor(ms / 86400000);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function commissionRateLabel(type, value) {
  const v = Number(value);
  if (type === 'FIXED') return `$${v.toFixed(2)} / FE`;
  return `${(v * 100).toFixed(2)}% gross`;
}

function paymentPeriodLabel(value, unit) {
  const u = unit === 'DAYS' ? (value === 1 ? 'dia' : 'dias')
          : unit === 'WEEKS' ? (value === 1 ? 'semana' : 'semanas')
          : (value === 1 ? 'mês' : 'meses');
  return `${value} ${u}`;
}

function NetKpi({ label, value, unit, hint, icon }) {
  return (
    <div className="kpi">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '0.16em', color: 'var(--fg5)' }}>{label}</span>
        <span style={{ color: 'var(--fg5)' }}><Icon name={icon} size={14}/></span>
      </div>
      <div className="kpi-value" style={{ fontSize: 28 }}>
        {value}
        {unit && <span style={{ fontSize: 14, color: 'var(--fg4)', marginLeft: 6, fontFamily: 'var(--f-mono)' }}>{unit}</span>}
      </div>
      {hint && <div style={{ fontSize: 11, color: 'var(--fg5)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

// Pagination genérica. Espera `{ page, pageSize, total, hasMore }` na shape
// que o /lib/pagination.ts retorna do server. onChange(newPage) atualiza
// só o page; pageSize fica imutável aqui (UI sem seletor de tamanho).
function Pagination({ page, pageSize, total, hasMore, onChange }) {
  const totalPages = total > 0 ? Math.ceil(total / pageSize) : 1;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '10px 14px', borderTop: '1px solid var(--border-soft)',
      fontSize: 11, fontFamily: 'var(--f-mono)', color: 'var(--fg5)',
      gap: 12,
    }}>
      <div>
        {total === 0
          ? 'nenhum registro'
          : `${from}–${to} de ${fmtInt(total)}`}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          className="btn btn-ghost"
          style={{ padding: '4px 10px', fontSize: 10, opacity: page <= 1 ? 0.4 : 1 }}
        >
          <Icon name="chevron-left" size={10}/> Anterior
        </button>
        <span style={{ minWidth: 60, textAlign: 'center', color: 'var(--fg3)' }}>
          {page} / {totalPages}
        </span>
        <button
          onClick={() => onChange(page + 1)}
          disabled={!hasMore}
          className="btn btn-ghost"
          style={{ padding: '4px 10px', fontSize: 10, opacity: !hasMore ? 0.4 : 1 }}
        >
          Próxima <Icon name="chevron-right" size={10}/>
        </button>
      </div>
    </div>
  );
}

function NetworksPage() {
  const [state, setState] = useState({ status: 'loading', networks: [], pagination: null, error: null });
  const [refresh, setRefresh] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q); setPage(1); }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading' }));
    window.NSApi.adminListNetworks({ page, pageSize: 25, q: debouncedQ || undefined })
      .then((data) => { if (!cancelled) setState({ status: 'ready', networks: data.networks || [], pagination: data.pagination || null, error: null }); })
      .catch((err) => { if (!cancelled) setState({ status: 'error', networks: [], pagination: null, error: err.message || 'erro' }); });
    return () => { cancelled = true; };
  }, [refresh, page, debouncedQ]);

  function reload() { setRefresh((n) => n + 1); }

  const totals = state.networks.reduce((acc, n) => {
    acc.activeCount += n.status === 'ACTIVE' ? 1 : 0;
    acc.accruedUsd += Number(n.accruedUsd || 0);
    acc.last30Usd += Number(n.last30SalesUsd || 0);
    acc.last30Count += n.last30SalesCount || 0;
    return acc;
  }, { activeCount: 0, accruedUsd: 0, last30Usd: 0, last30Count: 0 });

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">ADMIN · NETWORKS / PARCEIROS</span>
          <h2>Networks <em>parceiras</em></h2>
          <span className="sub">
            {totals.activeCount} ativas · ${fmtInt(totals.accrued || totals.accruedUsd)} acumulado a pagar · {fmtInt(totals.last30Count)} comissões nos últimos 30d
          </span>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={12}/> Nova network
          </button>
        </div>
      </div>

      {state.status === 'error' && (
        <div className="panel" style={{ color: 'var(--danger)' }}>Erro ao carregar: {state.error}</div>
      )}

      <div className="kpi-grid">
        <NetKpi label="NETWORKS ATIVAS" icon="layers"
          value={fmtInt(totals.activeCount)}
          unit={`/ ${state.networks.length}`}
          hint={`${state.networks.filter((n) => n.status === 'PAUSED').length} pausadas`}/>
        <NetKpi label="A PAGAR (ACUMULADO)" icon="wallet"
          value={fmtCurrency(totals.accruedUsd, 'USD', 0)}
          hint="comissões accrued aguardando payout"/>
        <NetKpi label="COMISSÕES 30D" icon="trending-up"
          value={fmtCurrency(totals.last30Usd, 'USD', 0)}
          hint={`${fmtInt(totals.last30Count)} vendas atribuíveis`}/>
        <NetKpi label="CONTRATOS PENDENTES" icon="file-text"
          value={fmtInt(state.networks.filter((n) => n.contractVersion && !n.contractSigned).length)}
          hint="aguardando aceite do partner"/>
      </div>

      <div className="panel" style={{ padding: 0 }}>
        <div className="panel-head" style={{ padding: '14px 18px 10px' }}>
          <div className="panel-title">
            <span className="panel-eyebrow">NETWORKS · CONTRATOS</span>
            <div className="panel-sub">Click numa linha pra abrir detalhes, comissões, payouts</div>
          </div>
        </div>
        <div className="tbl-wrap" style={{ margin: 0, padding: '0 4px' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 40 }}></th>
                <th>Network</th>
                <th>Status</th>
                <th>Comissão</th>
                <th>Período</th>
                <th className="num">Afiliados</th>
                <th className="num">A pagar</th>
                <th>Contrato</th>
                <th>Última atualização</th>
              </tr>
            </thead>
            <tbody>
              {state.status === 'loading' && (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: 24, opacity: 0.6 }}>Carregando...</td></tr>
              )}
              {state.status === 'ready' && state.networks.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: 24, color: 'var(--fg4)' }}>
                  Nenhuma network cadastrada. Click em <strong>Nova network</strong> pra começar.
                </td></tr>
              )}
              {state.networks.map((n) => (
                <tr key={n.id} onClick={() => setSelectedId(n.id)} style={{ cursor: 'pointer' }}>
                  <td><span className="av" style={{ background: avatarColor(n.id), width: 28, height: 28, fontSize: 11, fontFamily: 'var(--f-mono)' }}>{n.name.slice(0, 2).toUpperCase()}</span></td>
                  <td>
                    <div style={{ color: 'var(--fg1)', fontSize: 13 }}>{n.name}</div>
                    <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg5)' }}>{n.slug}</div>
                  </td>
                  <td>
                    <span className={`badge ${n.status === 'ACTIVE' ? 'ok' : 'neutral'}`}>
                      {n.status === 'ACTIVE' ? 'ATIVO' : 'PAUSADO'}
                    </span>
                  </td>
                  <td className="cell-mono">{commissionRateLabel(n.commissionType, n.commissionValue)}</td>
                  <td className="cell-mono">{paymentPeriodLabel(n.paymentPeriodValue, n.paymentPeriodUnit)}</td>
                  <td className="num cell-mono">{fmtInt(n.affiliatesCount)}</td>
                  <td className="num cell-mono">{fmtCurrency(Number(n.accruedUsd), 'USD', 0)}</td>
                  <td>
                    {n.contractVersion ? (
                      <span className={`badge ${n.contractSigned ? 'ok' : 'warn'}`}>
                        v{n.contractVersion} · {n.contractSigned ? 'assinado' : 'pendente'}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--fg5)', fontSize: 11 }}>—</span>
                    )}
                  </td>
                  <td style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg5)' }}>
                    {fmtRelativeShort(n.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {state.pagination && (
            <Pagination
              page={state.pagination.page}
              pageSize={state.pagination.pageSize}
              total={state.pagination.total}
              hasMore={state.pagination.hasMore}
              onChange={setPage}
            />
          )}
        </div>
      </div>

      {selectedId && (
        <NetworkDetailDrawer
          networkId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={reload}
          onEdit={(net) => { setEditing(net); setSelectedId(null); }}
        />
      )}
      {creating && (
        <NetworkFormModal
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); reload(); }}
        />
      )}
      {editing && (
        <NetworkFormModal
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </div>
  );
}

function NetworkFormModal({ initial, onClose, onSaved }) {
  const isCreate = !initial;
  const [name, setName] = useState(initial?.name || '');
  const [commissionType, setCommissionType] = useState(initial?.commissionType || 'FIXED');
  const [commissionValue, setCommissionValue] = useState(
    initial ? String(initial.commissionValue) : ''
  );
  const [paymentPeriodValue, setPaymentPeriodValue] = useState(initial?.paymentPeriodValue || 30);
  const [paymentPeriodUnit, setPaymentPeriodUnit] = useState(initial?.paymentPeriodUnit || 'DAYS');
  const [billingEmail, setBillingEmail] = useState(initial?.billingEmail || '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const cv = Number(commissionValue);
      if (!Number.isFinite(cv) || cv <= 0) {
        throw new Error('valor da comissão inválido');
      }
      if (commissionType === 'PERCENT' && cv > 1) {
        throw new Error('PERCENT espera fração (ex: 0.05 = 5%)');
      }
      const body = {
        name: name.trim(),
        commissionType,
        commissionValue: cv,
        paymentPeriodValue: Number(paymentPeriodValue),
        paymentPeriodUnit,
        billingEmail: billingEmail.trim() || null,
        notes: notes.trim() || null,
      };
      if (isCreate) {
        await window.NSApi.adminCreateNetwork(body);
      } else {
        await window.NSApi.adminPatchNetwork(initial.id, body);
      }
      onSaved();
    } catch (err) {
      setError(err.message || 'erro');
      setBusy(false);
    }
  }

  return ReactDOM.createPortal((
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className="eyebrow">{isCreate ? 'NOVA NETWORK' : 'EDITAR NETWORK'}</span>
            <h3 style={{ margin: '4px 0', fontSize: 18, color: 'var(--fg1)' }}>
              {isCreate ? 'Cadastrar parceiro' : initial.name}
            </h3>
          </div>
          <button className="icon-btn" onClick={onClose} title="Fechar"><Icon name="x" size={14}/></button>
        </div>

        <div className="modal-body">
          <UserField label="Nome da network" value={name} onChange={setName} type="text" required/>

          <div style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--fg4)' }}>TIPO DE COMISSÃO</span>
            <div className="seg" style={{ width: 'fit-content' }}>
              {[['FIXED', 'Valor fixo (USD/venda)'], ['PERCENT', '% do gross']].map(([k, l]) => (
                <button key={k} className={commissionType === k ? 'is-active' : ''} onClick={() => setCommissionType(k)}>{l}</button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg5)', fontFamily: 'var(--f-mono)' }}>
              {commissionType === 'FIXED'
                ? 'Valor fixo em USD por cada venda FE aprovada de afiliado vinculado.'
                : 'Fração do gross. Ex: 0.05 = 5%. Use ponto decimal.'}
            </div>
          </div>

          <UserField
            label={commissionType === 'FIXED' ? 'Valor por venda (USD)' : 'Fração (0.05 = 5%)'}
            value={commissionValue}
            onChange={setCommissionValue}
            type="text"
            required
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <UserField
              label="Período de pagamento (valor)"
              value={String(paymentPeriodValue)}
              onChange={(v) => setPaymentPeriodValue(v.replace(/\D/g, '') || '0')}
              type="text"
              required
            />
            <div style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--fg4)' }}>UNIDADE</span>
              <select
                value={paymentPeriodUnit}
                onChange={(e) => setPaymentPeriodUnit(e.target.value)}
                style={{
                  padding: '9px 12px', fontSize: 13, color: 'var(--fg1)',
                  background: 'rgba(91,200,255,0.05)', border: '1px solid rgba(91,200,255,0.2)',
                  borderRadius: 6,
                }}
              >
                <option value="DAYS">Dias</option>
                <option value="WEEKS">Semanas</option>
                <option value="MONTHS">Meses</option>
              </select>
            </div>
          </div>

          <UserField label="E-mail de billing (opcional)" value={billingEmail} onChange={setBillingEmail} type="email"/>

          <div style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--fg4)' }}>NOTAS INTERNAS (OPCIONAL)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              style={{
                padding: '9px 12px', fontSize: 13, color: 'var(--fg1)',
                background: 'rgba(91,200,255,0.05)', border: '1px solid rgba(91,200,255,0.2)',
                borderRadius: 6, fontFamily: 'var(--f-sans)', resize: 'vertical',
              }}
            />
          </div>

          {!isCreate && (
            <div style={{ fontSize: 11, color: 'var(--warning)', background: 'rgba(255,140,0,0.06)',
                          border: '1px solid rgba(255,140,0,0.2)', padding: '8px 10px', borderRadius: 6 }}>
              Alterar termos comerciais (comissão, período, billing) gera nova versão do contrato.
              O partner vai precisar re-assinar antes do próximo login.
            </div>
          )}

          {error && (
            <div style={{ fontSize: 12, color: 'var(--danger)', background: 'rgba(239,68,68,0.08)',
                          border: '1px solid rgba(239,68,68,0.25)', padding: '8px 10px', borderRadius: 6 }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 8, paddingTop: 12, borderTop: '1px solid var(--border-soft)' }}>
            <button
              className="btn btn-primary"
              onClick={save}
              disabled={busy || !name.trim() || !commissionValue || !paymentPeriodValue}
              style={{ flex: 1 }}
            >
              {busy ? 'SALVANDO...' : (isCreate ? 'CRIAR NETWORK' : 'SALVAR ALTERAÇÕES')}
            </button>
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}

function NetworkDetailDrawer({ networkId, onClose, onChanged, onEdit }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [tab, setTab] = useState('summary');
  const [refresh, setRefresh] = useState(0);
  const [attaching, setAttaching] = useState(false);
  const [markPaid, setMarkPaid] = useState(null);
  const [commissionsStatus, setCommissionsStatus] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading' }));
    window.NSApi.adminGetNetwork(networkId)
      .then((data) => { if (!cancelled) setState({ status: 'ready', data, error: null }); })
      .catch((err) => { if (!cancelled) setState({ status: 'error', data: null, error: err.message || 'erro' }); });
    return () => { cancelled = true; };
  }, [networkId, refresh]);

  function reload() { setRefresh((n) => n + 1); onChanged?.(); }

  async function generatePayout() {
    if (!confirm('Gerar payout com todas as comissões accrued? Você ainda precisa marcar como pago depois.')) return;
    try {
      const r = await window.NSApi.adminCreatePayout(networkId);
      if (!r.payoutId) {
        alert(r.reason === 'no_accrued' ? 'Nenhuma comissão accrued pra pagar.' : `Erro: ${r.reason}`);
      } else {
        alert(`Payout #${r.payoutId.slice(0, 8)} criado: $${Number(r.totalUsd).toFixed(2)} (${r.commissionsCount} comissões). Status PENDING — marque como pago após confirmar pagamento.`);
        reload();
      }
    } catch (err) {
      alert('Erro: ' + err.message);
    }
  }

  async function detachAffiliate(affiliateId) {
    if (!confirm('Desvincular esse afiliado da network? Vendas futuras dele deixam de gerar comissão. Comissões já contabilizadas permanecem.')) return;
    try {
      await window.NSApi.adminDetachAffiliate(networkId, affiliateId);
      reload();
    } catch (err) {
      alert('Erro: ' + err.message);
    }
  }

  async function deleteNetwork() {
    const n = state.data?.network;
    if (!n) return;
    // Confirmação dupla pela severidade — cascade delete pesado.
    const msg = `⚠ DELETAR a network "${n.name}"?\n\n` +
      `Isso vai REMOVER PERMANENTEMENTE:\n` +
      `• ${state.data.affiliates.length} vínculo(s) de afiliado\n` +
      `• Todas as comissões geradas (${state.data.commissionsTotal || 0})\n` +
      `• Todos os payouts (${state.data.payoutsTotal || 0}) e o histórico de pagamento\n` +
      `• Todas as versões do contrato\n\n` +
      `Os usuários partner vinculados ficam SEM network — vão precisar\n` +
      `ser re-atribuídos ou desativados manualmente.\n\n` +
      `Esta ação NÃO pode ser desfeita. Continuar?`;
    if (!confirm(msg)) return;
    const confirmName = prompt(`Pra confirmar, digite o nome da network exatamente:\n\n${n.name}`);
    if (confirmName !== n.name) {
      if (confirmName !== null) alert('Nome não confere — delete cancelado.');
      return;
    }
    setDeleting(true);
    try {
      await window.NSApi.adminDeleteNetwork(networkId);
      onChanged?.();
      onClose();
    } catch (err) {
      alert('Erro ao deletar: ' + err.message);
      setDeleting(false);
    }
  }

  if (state.status === 'loading') {
    return ReactDOM.createPortal((
      <>
        <div className="drawer-backdrop" onClick={onClose}/>
        <div className="drawer" style={{ width: 720 }}>
          <div className="drawer-head">
            <span style={{ color: 'var(--fg4)' }}>Carregando network...</span>
            <button className="icon-btn" onClick={onClose}><Icon name="x" size={14}/></button>
          </div>
        </div>
      </>
    ), document.body);
  }
  if (state.status === 'error' || !state.data) {
    return ReactDOM.createPortal((
      <>
        <div className="drawer-backdrop" onClick={onClose}/>
        <div className="drawer" style={{ width: 720 }}>
          <div className="drawer-head">
            <span style={{ color: 'var(--danger)' }}>Erro: {state.error || 'network não encontrada'}</span>
            <button className="icon-btn" onClick={onClose}><Icon name="x" size={14}/></button>
          </div>
        </div>
      </>
    ), document.body);
  }

  // commissions/payouts são preview-only no detail endpoint (top 10).
  // Listas completas vêm dos sub-endpoints paginados via NetCommissions/NetPayouts.
  const { network: n, affiliates, commissionsTotal = 0, payoutsTotal = 0 } = state.data;

  return ReactDOM.createPortal((
    <>
      <div className="drawer-backdrop" onClick={onClose}/>
      <div className="drawer" style={{ width: 720 }}>
        <div className="drawer-head">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="av" style={{ background: avatarColor(n.id), width: 36, height: 36, fontSize: 14 }}>{n.name.slice(0, 2).toUpperCase()}</span>
              <div>
                <span className="eyebrow">NETWORK · {n.slug.toUpperCase()}</span>
                <h3 style={{ margin: '2px 0', fontSize: 18, color: 'var(--fg1)' }}>{n.name}</h3>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                  <span className={`badge ${n.status === 'ACTIVE' ? 'ok' : 'neutral'}`}>{n.status}</span>
                  <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg5)' }}>
                    {commissionRateLabel(n.commissionType, n.commissionValue)} · {paymentPeriodLabel(n.paymentPeriodValue, n.paymentPeriodUnit)}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-ghost" onClick={() => onEdit(n)} title="Editar termos">
              <Icon name="edit" size={11}/> Editar
            </button>
            <button
              onClick={deleteNetwork}
              disabled={deleting}
              title="Deletar network (cascade — irreversível)"
              style={{
                padding: '6px 10px', fontFamily: 'var(--f-mono)', fontSize: 11,
                letterSpacing: '0.06em', color: 'var(--danger)',
                background: 'rgba(239,68,68,0.06)',
                border: '1px solid rgba(239,68,68,0.25)', borderRadius: 6,
                cursor: deleting ? 'not-allowed' : 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}
            >
              <Icon name="trash" size={11}/> {deleting ? 'DELETANDO...' : 'Deletar'}
            </button>
            <button className="icon-btn" onClick={onClose}><Icon name="x" size={14}/></button>
          </div>
        </div>

        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-soft)', padding: '0 16px' }}>
          {[
            ['summary', 'Resumo'],
            ['affiliates', `Afiliados · ${affiliates.length}`],
            ['commissions', `Comissões · ${fmtInt(commissionsTotal)}`],
            ['payouts', `Payouts · ${fmtInt(payoutsTotal)}`],
            ['contract', 'Contrato'],
          ].map(([k, l]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              style={{
                padding: '12px 14px', fontFamily: 'var(--f-mono)', fontSize: 11,
                letterSpacing: '0.08em', textTransform: 'uppercase',
                background: 'transparent', border: 0, cursor: 'pointer',
                color: tab === k ? 'var(--glow-cyan)' : 'var(--fg5)',
                borderBottom: tab === k ? '2px solid var(--glow-cyan)' : '2px solid transparent',
              }}
            >{l}</button>
          ))}
        </div>

        <div className="drawer-body" style={{ padding: 16 }}>
          {tab === 'summary' && <NetSummary network={n}/>}
          {tab === 'affiliates' && (
            <NetAffiliates
              affiliates={affiliates}
              onDetach={detachAffiliate}
              onAttach={() => setAttaching(true)}
            />
          )}
          {tab === 'commissions' && (
            <NetCommissions
              fetcher={(opts) => window.NSApi.adminListNetworkCommissions(networkId, opts)}
              statusFilter={commissionsStatus}
              onStatusChange={setCommissionsStatus}
            />
          )}
          {tab === 'payouts' && (
            <NetPayouts
              fetcher={(opts) => window.NSApi.adminListNetworkPayouts(networkId, opts)}
              onGenerate={generatePayout}
              onMarkPaid={(p) => setMarkPaid(p)}
              accruedUsd={n.nextPayout.accruedUsd}
              accruedCount={n.nextPayout.accruedCount}
              refreshKey={refresh}
            />
          )}
          {tab === 'contract' && <NetContract network={n} networkId={networkId}/>}
        </div>
      </div>

      {attaching && (
        <AttachAffiliateModal
          networkId={networkId}
          onClose={() => setAttaching(false)}
          onSaved={() => { setAttaching(false); reload(); }}
        />
      )}
      {markPaid && (
        <MarkPaidModal
          networkId={networkId}
          payout={markPaid}
          onClose={() => setMarkPaid(null)}
          onSaved={() => { setMarkPaid(null); reload(); }}
        />
      )}
    </>
  ), document.body);
}

function NetSummary({ network: n }) {
  const next = n.nextPayout;
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        <NetKpi label="A PAGAR (ACUMULADO)" icon="wallet"
          value={fmtCurrency(Number(next.accruedUsd), 'USD', 0)}
          hint={`${fmtInt(next.accruedCount)} comissões accrued`}/>
        <NetKpi label="AOV (30D)" icon="trending-up"
          value={fmtCurrency(Number(n.networkAovUsd), 'USD', 0)}
          hint="média ponderada dos afiliados vinculados"/>
        <NetKpi label="PRÓXIMO PAYOUT" icon="calendar"
          value={new Date(next.at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
          hint={`a cada ${paymentPeriodLabel(n.paymentPeriodValue, n.paymentPeriodUnit)}`}/>
        <NetKpi label="ÚLTIMO PAGAMENTO" icon="check-circle"
          value={next.lastPayoutAt ? new Date(next.lastPayoutAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '—'}
          hint={next.lastPayoutAt ? fmtRelativeShort(next.lastPayoutAt) : 'nunca'}/>
      </div>
      <div className="panel">
        <div className="panel-head">
          <div className="panel-title">
            <span className="panel-eyebrow">CONTRATO ATUAL</span>
            <div className="panel-sub">Termos vigentes — alterações criam nova versão</div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
          <ContractField label="Comissão" value={commissionRateLabel(n.commissionType, n.commissionValue)}/>
          <ContractField label="Período de pagamento" value={paymentPeriodLabel(n.paymentPeriodValue, n.paymentPeriodUnit)}/>
          <ContractField label="Início do contrato" value={fmtDateShort(n.contractStart)}/>
          <ContractField label="Email de billing" value={n.billingEmail || '(não informado)'}/>
          <ContractField label="Versão do contrato"
            value={n.currentContract ? `v${n.currentContract.version} · ${n.currentContract.signedAt ? 'assinado' : 'aguardando aceite'}` : '—'}/>
          <ContractField label="Status" value={n.status === 'ACTIVE' ? 'Ativo' : 'Pausado'}/>
        </div>
      </div>
      {n.notes && (
        <div className="panel">
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg5)', letterSpacing: '0.12em', marginBottom: 6 }}>NOTAS INTERNAS</div>
          <div style={{ fontSize: 13, color: 'var(--fg2)', whiteSpace: 'pre-wrap' }}>{n.notes}</div>
        </div>
      )}
    </div>
  );
}

function NetAffiliates({ affiliates, onDetach, onAttach }) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 12, color: 'var(--fg5)', fontFamily: 'var(--f-mono)' }}>
          {affiliates.length === 0 ? 'Nenhum afiliado vinculado' : `${affiliates.length} afiliado(s) vinculado(s)`}
        </div>
        <button className="btn btn-primary" onClick={onAttach}>
          <Icon name="plus" size={11}/> Vincular afiliado
        </button>
      </div>
      {affiliates.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Afiliado</th>
                <th>Plataforma</th>
                <th className="num">Pedidos totais</th>
                <th>Última venda</th>
                <th>Vinculado em</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {affiliates.map((a) => (
                <tr key={a.id}>
                  <td>
                    <div style={{ color: 'var(--fg1)', fontSize: 13 }}>{a.nickname || a.externalId}</div>
                    <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg5)' }}>{a.externalId}</div>
                  </td>
                  <td><span className={`plat plat-${a.platformSlug === 'digistore24' ? 'd24' : 'cb'}`}>{a.platformSlug === 'digistore24' ? 'D24' : 'CB'}</span></td>
                  <td className="num cell-mono">{fmtInt(a.ordersCount)}</td>
                  <td style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--fg4)' }}>{fmtRelativeShort(a.lastOrderAt)}</td>
                  <td style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--fg4)' }}>{fmtDateShort(a.attachedAt)}</td>
                  <td>
                    <button onClick={() => onDetach(a.affiliateId)} className="btn btn-ghost" style={{ fontSize: 10, color: 'var(--danger)' }}>
                      <Icon name="trash" size={10}/>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Self-fetching paginated commissions list. fetcher é injetado pra
// reaproveitar o mesmo componente no contexto admin (network detail) e
// partner (/me) sem duplicação.
function NetCommissions({ fetcher, statusFilter, onStatusChange }) {
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [data, setData] = useState({ status: 'loading', items: [], total: 0, hasMore: false });

  useEffect(() => {
    let cancelled = false;
    setData((s) => ({ ...s, status: 'loading' }));
    fetcher({ page, pageSize, status: statusFilter || undefined })
      .then((r) => { if (!cancelled) setData({ status: 'ready', items: r.items, total: r.total, hasMore: r.hasMore }); })
      .catch(() => { if (!cancelled) setData({ status: 'error', items: [], total: 0, hasMore: false }); });
    return () => { cancelled = true; };
  }, [fetcher, page, pageSize, statusFilter]);

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {onStatusChange && (
        <div className="seg" style={{ width: 'fit-content' }}>
          {[['', 'Todas'], ['ACCRUED', 'Accrued'], ['PAID', 'Pagas']].map(([k, l]) => (
            <button
              key={k || 'all'}
              className={(statusFilter || '') === k ? 'is-active' : ''}
              onClick={() => { onStatusChange(k); setPage(1); }}
            >{l}</button>
          ))}
        </div>
      )}
      <div className="tbl-wrap" style={{ margin: 0 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Order</th>
              <th>Afiliado</th>
              <th>Country</th>
              <th className="num">Gross</th>
              <th className="num">Comissão</th>
              <th>Status</th>
              <th>Data</th>
            </tr>
          </thead>
          <tbody>
            {data.status === 'loading' && (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 16, opacity: 0.6 }}>Carregando...</td></tr>
            )}
            {data.status !== 'loading' && data.items.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--fg4)', fontSize: 12 }}>
                Nenhuma comissão{statusFilter ? ` ${statusFilter.toLowerCase()}` : ''}.
              </td></tr>
            )}
            {data.items.map((c) => (
              <tr key={c.id}>
                <td className="cell-mono" style={{ fontSize: 11 }}>{c.orderExternalId}</td>
                <td>{c.affiliateNickname || c.affiliateExternalId}</td>
                <td className="cell-mono">{c.country || '—'}</td>
                <td className="num cell-mono">{fmtCurrency(Number(c.orderGrossUsd), 'USD', 2)}</td>
                <td className="num cell-mono" style={{ color: 'var(--glow-cyan)' }}>{fmtCurrency(Number(c.amountUsd), 'USD', 2)}</td>
                <td><span className={`badge ${c.status === 'PAID' ? 'ok' : 'neutral'}`}>{c.status}</span></td>
                <td style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--fg4)' }}>{fmtRelativeShort(c.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page} pageSize={pageSize} total={data.total} hasMore={data.hasMore} onChange={setPage}/>
      </div>
    </div>
  );
}

function NetPayouts({ fetcher, onGenerate, onMarkPaid, accruedUsd, accruedCount, refreshKey }) {
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [data, setData] = useState({ status: 'loading', items: [], total: 0, hasMore: false });

  useEffect(() => {
    let cancelled = false;
    setData((s) => ({ ...s, status: 'loading' }));
    fetcher({ page, pageSize })
      .then((r) => { if (!cancelled) setData({ status: 'ready', items: r.items, total: r.total, hasMore: r.hasMore }); })
      .catch(() => { if (!cancelled) setData({ status: 'error', items: [], total: 0, hasMore: false }); });
    return () => { cancelled = true; };
  }, [fetcher, page, pageSize, refreshKey]);

  const showAccruedCard = onGenerate !== undefined; // partner não tem botão

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {showAccruedCard && (
        <div className="panel" style={{ background: 'rgba(91,200,255,0.04)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <div>
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg5)', letterSpacing: '0.12em' }}>PRONTO PRA PAYOUT</div>
              <div style={{ fontSize: 24, color: 'var(--glow-cyan)', fontFamily: 'var(--f-display)', marginTop: 4 }}>
                {fmtCurrency(Number(accruedUsd), 'USD', 2)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--fg5)' }}>{fmtInt(accruedCount)} comissões accrued</div>
            </div>
            <button className="btn btn-primary" onClick={onGenerate} disabled={!accruedCount}>
              <Icon name="file-text" size={11}/> Gerar payout
            </button>
          </div>
        </div>
      )}

      <div className="tbl-wrap" style={{ margin: 0 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Período</th>
              <th className="num">Comissões</th>
              <th className="num">Total</th>
              <th>Status</th>
              <th>Pago em</th>
              <th>Por</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.status === 'loading' && (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 16, opacity: 0.6 }}>Carregando...</td></tr>
            )}
            {data.status !== 'loading' && data.items.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--fg4)', fontSize: 12 }}>Nenhum payout gerado ainda.</td></tr>
            )}
            {data.items.map((p) => (
              <tr key={p.id}>
                <td style={{ fontSize: 11 }}>{fmtDateShort(p.periodStart)} → {fmtDateShort(p.periodEnd)}</td>
                <td className="num cell-mono">{fmtInt(p.commissionsCount)}</td>
                <td className="num cell-mono">{fmtCurrency(Number(p.totalUsd), 'USD', 2)}</td>
                <td><span className={`badge ${p.status === 'PAID' ? 'ok' : 'warn'}`}>{p.status}</span></td>
                <td style={{ fontSize: 11 }}>{p.paidAt ? fmtDateShort(p.paidAt) : '—'}</td>
                <td style={{ fontSize: 11, color: 'var(--fg4)' }}>{p.paidByName || p.paymentMethod || '—'}</td>
                <td>
                  {onMarkPaid && p.status === 'PENDING' && (
                    <button onClick={() => onMarkPaid(p)} className="btn btn-ghost" style={{ fontSize: 10 }}>
                      <Icon name="check" size={10}/> Marcar pago
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page} pageSize={pageSize} total={data.total} hasMore={data.hasMore} onChange={setPage}/>
      </div>
    </div>
  );
}

function NetContract({ network: n, networkId }) {
  const c = n.currentContract;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="panel">
        <div className="panel-head">
          <div className="panel-title">
            <span className="panel-eyebrow">CONTRATO {c ? `· V${c.version}` : ''}</span>
            <div className="panel-sub">
              {c
                ? (c.signedAt
                    ? `Assinado em ${fmtDateLong(c.signedAt)}`
                    : 'Aguardando aceite do partner. Versão atual nasce não-assinada.')
                : 'Nenhum contrato gerado ainda.'}
            </div>
          </div>
          {c && (
            <a href={window.NSApi.adminContractPdfUrl(networkId)} target="_blank" rel="noopener noreferrer"
               className="btn btn-primary" style={{ textDecoration: 'none' }}>
              <Icon name="download" size={11}/> Baixar PDF
            </a>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--fg4)', lineHeight: 1.6 }}>
          O contrato é gerado automaticamente a partir dos termos da network (nome, comissão, período de pagamento, billing e início).
          Quando você edita esses termos, uma nova versão é criada e o partner precisa re-assinar antes do próximo login.
        </div>
      </div>
    </div>
  );
}

function AttachAffiliateModal({ networkId, onClose, onSaved }) {
  // Modo primário: pré-cadastrar afiliado por (platform, externalId).
  // Quando o webhook chegar com esse ID, upsertOrder reusa o row e a
  // vinculação à network já está em vigor.
  const [platformSlug, setPlatformSlug] = useState('clickbank');
  const [externalId, setExternalId] = useState('');
  const [nickname, setNickname] = useState('');

  // Modo secundário: lista de afiliados conhecidos (já com vendas no DB).
  const [showKnown, setShowKnown] = useState(false);
  const [list, setList] = useState({ status: 'loading', items: [], pagination: null });
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(new Set());

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!showKnown) return;
    let cancelled = false;
    setList((s) => ({ ...s, status: 'loading' }));
    const t = setTimeout(() => {
      window.NSApi.adminListAvailableAffiliates({ q: q || undefined, page, pageSize: 25 })
        .then((data) => { if (!cancelled) setList({ status: 'ready', items: data.affiliates || [], pagination: data.pagination || null }); })
        .catch(() => { if (!cancelled) setList({ status: 'ready', items: [], pagination: null }); });
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [showKnown, q, page]);

  useEffect(() => { setPage(1); }, [q]);

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function attachByExternal() {
    if (!externalId.trim()) {
      setError('preencha o ID do afiliado');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await window.NSApi.adminAttachAffiliateByExternal(networkId, [{
        platformSlug,
        externalId: externalId.trim(),
        nickname: nickname.trim() || null,
      }]);
      if (r.attached.length === 0 && r.conflicts.length > 0) {
        setError(r.conflicts[0].reason);
        setBusy(false);
        return;
      }
      onSaved();
    } catch (err) {
      setError(err.message || 'erro');
      setBusy(false);
    }
  }

  async function attachKnown() {
    setBusy(true);
    setError(null);
    try {
      const r = await window.NSApi.adminAttachAffiliates(networkId, Array.from(selected));
      if (r.attached.length === 0 && r.conflicts.length > 0) {
        setError('Todos os afiliados selecionados estão em conflito: ' + r.conflicts.map((c) => c.reason).join(', '));
        setBusy(false);
        return;
      }
      onSaved();
    } catch (err) {
      setError(err.message || 'erro');
      setBusy(false);
    }
  }

  const inputStyle = {
    padding: '9px 12px', fontSize: 13, color: 'var(--fg1)',
    background: 'rgba(91,200,255,0.05)', border: '1px solid rgba(91,200,255,0.2)',
    borderRadius: 6,
  };

  return ReactDOM.createPortal((
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className="modal-head">
          <div>
            <span className="eyebrow">VINCULAR AFILIADO</span>
            <h3 style={{ margin: '4px 0', fontSize: 18, color: 'var(--fg1)' }}>Adicionar à network</h3>
            <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--fg4)' }}>
              Pré-cadastra por ID — vendas futuras desse afiliado já caem pra network.
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>
        <div className="modal-body">

          {/* Form primário: adicionar por ID */}
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--fg4)' }}>PLATAFORMA</span>
              <div className="seg" style={{ width: 'fit-content' }}>
                {[['clickbank', 'ClickBank'], ['digistore24', 'Digistore24']].map(([k, l]) => (
                  <button key={k} className={platformSlug === k ? 'is-active' : ''} onClick={() => setPlatformSlug(k)}>{l}</button>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--fg4)' }}>ID DO AFILIADO (NICKNAME NA PLATAFORMA)</span>
              <input
                type="text"
                placeholder="ex: fenix2025"
                value={externalId}
                onChange={(e) => setExternalId(e.target.value)}
                style={inputStyle}
                autoFocus
              />
              <div style={{ fontSize: 11, color: 'var(--fg5)' }}>
                Esse é o nickname que aparece no campo Affiliate dos webhooks da plataforma.
              </div>
            </div>

            <div style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--fg4)' }}>NOME DE EXIBIÇÃO (OPCIONAL)</span>
              <input
                type="text"
                placeholder="ex: Fenix Media — João Silva"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                style={inputStyle}
              />
            </div>

            <button
              className="btn btn-primary"
              onClick={attachByExternal}
              disabled={busy || !externalId.trim()}
              style={{ marginTop: 4 }}
            >
              {busy ? 'VINCULANDO...' : 'VINCULAR'}
            </button>
          </div>

          {error && (
            <div style={{ fontSize: 12, color: 'var(--danger)', background: 'rgba(239,68,68,0.08)',
                          border: '1px solid rgba(239,68,68,0.25)', padding: '8px 10px', borderRadius: 6 }}>
              {error}
            </div>
          )}

          {/* Modo secundário: escolher de afiliados conhecidos */}
          <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 14 }}>
            <button
              onClick={() => setShowKnown((v) => !v)}
              style={{
                background: 'transparent', border: 0, cursor: 'pointer',
                fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--glow-cyan)',
                letterSpacing: '0.06em', padding: 0,
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <Icon name={showKnown ? 'chevron-down' : 'chevron-right'} size={11}/>
              Ou escolher de afiliados já conhecidos ({list.pagination?.total ?? '...'})
            </button>

            {showKnown && (
              <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
                <input
                  type="text"
                  placeholder="Buscar por nickname ou externalId..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  style={inputStyle}
                />
                <div style={{ maxHeight: 240, overflowY: 'auto', display: 'grid', gap: 4 }}>
                  {list.status === 'loading' && <div style={{ color: 'var(--fg5)', fontSize: 12 }}>Carregando...</div>}
                  {list.status === 'ready' && list.items.length === 0 && (
                    <div style={{ color: 'var(--fg5)', fontSize: 12, padding: 12, textAlign: 'center' }}>
                      Nenhum afiliado disponível.
                    </div>
                  )}
                  {list.items.map((a) => (
                    <label key={a.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                      background: selected.has(a.id) ? 'rgba(91,200,255,0.08)' : 'transparent',
                      border: '1px solid var(--border-soft)', borderRadius: 6, cursor: 'pointer',
                    }}>
                      <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)}/>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: 'var(--fg1)', fontSize: 13 }}>{a.nickname || a.externalId}</div>
                        <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg5)' }}>
                          {a.platformSlug === 'digistore24' ? 'D24' : 'CB'} · {a.externalId} · {fmtInt(a.ordersCount)} pedidos
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
                {list.pagination && list.pagination.total > list.pagination.pageSize && (
                  <Pagination
                    page={list.pagination.page}
                    pageSize={list.pagination.pageSize}
                    total={list.pagination.total}
                    hasMore={list.pagination.hasMore}
                    onChange={setPage}
                  />
                )}
                <button
                  className="btn btn-primary"
                  onClick={attachKnown}
                  disabled={busy || selected.size === 0}
                >
                  {busy ? 'VINCULANDO...' : `VINCULAR ${selected.size} SELECIONADO(S)`}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}

function MarkPaidModal({ networkId, payout, onClose, onSaved }) {
  const [paymentMethod, setPaymentMethod] = useState('wise');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await window.NSApi.adminMarkPayoutPaid(networkId, payout.id, {
        paymentMethod: paymentMethod || null,
        notes: notes || null,
      });
      onSaved();
    } catch (err) {
      setError(err.message || 'erro');
      setBusy(false);
    }
  }

  return ReactDOM.createPortal((
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className="eyebrow">MARCAR COMO PAGO</span>
            <h3 style={{ margin: '4px 0', fontSize: 18, color: 'var(--fg1)' }}>
              Confirmar pagamento de {fmtCurrency(Number(payout.totalUsd), 'USD', 2)}
            </h3>
            <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--fg4)' }}>
              {payout.commissionsCount} comissões · período {fmtDateShort(payout.periodStart)} → {fmtDateShort(payout.periodEnd)}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>
        <div className="modal-body">
          <UserField label="Método de pagamento (opcional)" value={paymentMethod} onChange={setPaymentMethod} type="text"/>
          <div style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--fg4)' }}>NOTAS (OPCIONAL)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="ex: TX hash, ref do transfer, etc"
              style={{
                padding: '9px 12px', fontSize: 13, color: 'var(--fg1)',
                background: 'rgba(91,200,255,0.05)', border: '1px solid rgba(91,200,255,0.2)',
                borderRadius: 6, fontFamily: 'var(--f-sans)', resize: 'vertical',
              }}
            />
          </div>
          {error && (
            <div style={{ fontSize: 12, color: 'var(--danger)', background: 'rgba(239,68,68,0.08)',
                          border: '1px solid rgba(239,68,68,0.25)', padding: '8px 10px', borderRadius: 6 }}>
              {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 4, paddingTop: 12, borderTop: '1px solid var(--border-soft)' }}>
            <button className="btn btn-primary" onClick={confirm} disabled={busy} style={{ flex: 1 }}>
              {busy ? 'CONFIRMANDO...' : 'CONFIRMAR PAGAMENTO'}
            </button>
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}

function ContractField({ label, value }) {
  return (
    <div>
      <div style={{ fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '0.15em', color: 'var(--fg5)', marginBottom: 4, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ color: 'var(--fg1)', fontSize: 13 }}>{value}</div>
    </div>
  );
}

// ==========================================================================
// PARTNER SHELL — view simplificada pra role NETWORK_PARTNER. Substitui o
// dashboard inteiro: só mostra dados da própria network do partner. No
// primeiro login (ou quando admin altera termos comerciais), o partner
// vê o contrato em PDF + checkbox de aceite antes de acessar qualquer
// outra coisa.
// ==========================================================================

function PartnerShell({ user, onLogout }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [refresh, setRefresh] = useState(0);
  const [signing, setSigning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading' }));
    window.NSApi.fetchNetworkMe()
      .then((data) => { if (!cancelled) setState({ status: 'ready', data, error: null }); })
      .catch((err) => { if (!cancelled) setState({ status: 'error', data: null, error: err.message || 'erro' }); });
    return () => { cancelled = true; };
  }, [refresh]);

  async function signContract() {
    setSigning(true);
    try {
      await window.NSApi.networkSignContract();
      setRefresh((n) => n + 1);
    } catch (err) {
      alert('Erro: ' + err.message);
    }
    setSigning(false);
  }

  if (state.status === 'loading') {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg4)' }}>Carregando...</div>;
  }
  if (state.status === 'error') {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--danger)' }}>Erro: {state.error}</div>;
  }

  const data = state.data;
  const n = data.network;
  const c = n.currentContract;
  const needsSign = c && c.needsSignature;

  if (needsSign) {
    return <ContractAcceptanceGate network={n} onSign={signContract} signing={signing} onLogout={onLogout}/>;
  }

  return (
    <div className="app">
      <FXLayers/>
      <aside className="side">
        <div className="side-logo">
          <div className="wm" style={{ width: 71, fontSize: 24 }}>north<em>scale</em></div>
        </div>
        <div style={{ flex: 1 }}>
          <div className="side-group-label">Minha Network</div>
          <nav className="side-nav">
            <button className="side-item is-active">
              <Icon name="layers" size={14}/> {n.name}
            </button>
          </nav>
        </div>
        <div className="side-foot">
          <div className="user-chip" onClick={onLogout} style={{ cursor: 'pointer' }} title="Logout">
            <div className="av" style={{ background: avatarColor(user.email) }}>{initials(user.name || user.email)}</div>
            <div className="who">
              <span className="nm">{user.name || user.email}</span>
              <span className="rl">PARTNER · {n.status}</span>
            </div>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="top">
          <div className="top-title">
            <div className="top-crumb"><span className="cur">PARTNER · MINHA NETWORK</span></div>
            <h1 className="top-h1" style={{ fontSize: 25 }}>{n.name}</h1>
          </div>
          <div className="top-spacer"/>
          <div className="top-actions">
            <a href={window.NSApi.networkContractPdfUrl} target="_blank" rel="noopener noreferrer"
               className="btn btn-ghost" style={{ textDecoration: 'none' }}>
              <Icon name="download" size={12}/> Contrato (PDF)
            </a>
          </div>
        </header>

        <div className="page">
          <div className="page-in">
            <PartnerOverview data={data}/>
          </div>
        </div>
      </div>
    </div>
  );
}

function PartnerOverview({ data }) {
  const n = data.network;
  const next = n.nextPayout;
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="kpi-grid">
        <NetKpi label="A RECEBER (ACUMULADO)" icon="wallet"
          value={fmtCurrency(Number(next.accruedUsd), 'USD', 0)}
          hint={`${fmtInt(next.accruedCount)} comissões accrued`}/>
        <NetKpi label="AOV (30D)" icon="trending-up"
          value={fmtCurrency(Number(n.networkAovUsd), 'USD', 0)}
          hint="média dos seus afiliados"/>
        <NetKpi label="PRÓXIMO PAGAMENTO" icon="calendar"
          value={new Date(next.at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
          hint={`a cada ${paymentPeriodLabel(n.paymentPeriodValue, n.paymentPeriodUnit)}`}/>
        <NetKpi label="ÚLTIMO PAGAMENTO" icon="check-circle"
          value={next.lastPayoutAt ? new Date(next.lastPayoutAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '—'}
          hint={next.lastPayoutAt ? fmtRelativeShort(next.lastPayoutAt) : 'nenhum ainda'}/>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div className="panel-title">
            <span className="panel-eyebrow">CONTRATO VIGENTE</span>
            <div className="panel-sub">
              {n.currentContract
                ? `Versão ${n.currentContract.version} · Assinado em ${fmtDateLong(n.currentContract.signedAt)}`
                : 'Sem contrato'}
            </div>
          </div>
          <a href={window.NSApi.networkContractPdfUrl} target="_blank" rel="noopener noreferrer"
             className="btn btn-ghost" style={{ textDecoration: 'none' }}>
            <Icon name="download" size={11}/> Baixar PDF
          </a>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
          <ContractField label="Comissão" value={commissionRateLabel(n.commissionType, n.commissionValue)}/>
          <ContractField label="Período de pagamento" value={paymentPeriodLabel(n.paymentPeriodValue, n.paymentPeriodUnit)}/>
          <ContractField label="Início do contrato" value={fmtDateShort(n.contractStart)}/>
          <ContractField label="Email de billing" value={n.billingEmail || '(não informado)'}/>
        </div>
      </div>

      <div className="panel" style={{ padding: 0 }}>
        <div className="panel-head" style={{ padding: '14px 18px 10px' }}>
          <div className="panel-title">
            <span className="panel-eyebrow">MEUS AFILIADOS · {data.affiliates.length}</span>
            <div className="panel-sub">Vendas FE deles geram comissão pra você automaticamente.</div>
          </div>
        </div>
        {data.affiliates.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg4)', fontSize: 12 }}>Nenhum afiliado vinculado ainda.</div>
        ) : (
          <div className="tbl-wrap" style={{ margin: 0, padding: '0 4px' }}>
            <table className="tbl">
              <thead><tr><th>Afiliado</th><th>Plataforma</th><th>Última venda</th><th>Vinculado em</th></tr></thead>
              <tbody>
                {data.affiliates.map((a, i) => (
                  <tr key={i}>
                    <td>
                      <div style={{ color: 'var(--fg1)', fontSize: 13 }}>{a.nickname || a.externalId}</div>
                      <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg5)' }}>{a.externalId}</div>
                    </td>
                    <td><span className={`plat plat-${a.platformSlug === 'digistore24' ? 'd24' : 'cb'}`}>{a.platformSlug === 'digistore24' ? 'D24' : 'CB'}</span></td>
                    <td style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--fg4)' }}>{fmtRelativeShort(a.lastOrderAt)}</td>
                    <td style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--fg4)' }}>{fmtDateShort(a.attachedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel" style={{ padding: 0 }}>
        <div className="panel-head" style={{ padding: '14px 18px 10px' }}>
          <div className="panel-title">
            <span className="panel-eyebrow">MINHAS COMISSÕES · {fmtInt(data.commissionsTotal || 0)}</span>
            <div className="panel-sub">Cada venda FE de afiliado vinculado vira uma linha aqui.</div>
          </div>
        </div>
        <div style={{ padding: '0 4px' }}>
          <NetCommissions
            fetcher={(opts) => window.NSApi.fetchNetworkMyCommissions(opts)}
            statusFilter={''}
            onStatusChange={null}
          />
        </div>
      </div>

      <div className="panel" style={{ padding: 0 }}>
        <div className="panel-head" style={{ padding: '14px 18px 10px' }}>
          <div className="panel-title">
            <span className="panel-eyebrow">HISTÓRICO DE PAGAMENTOS · {fmtInt(data.payoutsTotal || 0)}</span>
            <div className="panel-sub">Transparência total: cada payout, status e método.</div>
          </div>
        </div>
        <div style={{ padding: '0 4px' }}>
          <NetPayouts
            fetcher={(opts) => window.NSApi.fetchNetworkMyPayouts(opts)}
          />
        </div>
      </div>
    </div>
  );
}

function ContractAcceptanceGate({ network, onSign, signing, onLogout }) {
  const [agreed, setAgreed] = useState(false);
  return (
    <div className="app">
      <FXLayers/>
      <div style={{
        position: 'fixed', inset: 0, display: 'grid', placeItems: 'center',
        padding: 24, overflowY: 'auto', zIndex: 1,
      }}>
        <div className="panel" style={{ maxWidth: 720, width: '100%', position: 'relative', zIndex: 1 }}>
          <div className="panel-head">
            <div className="panel-title">
              <span className="panel-eyebrow">CONTRATO DE PARCERIA · {network.name.toUpperCase()}</span>
              <div className="panel-sub">
                Antes de acessar o portal, leia e aceite o contrato. Versão {network.currentContract.version}.
              </div>
            </div>
            <button onClick={onLogout} className="btn btn-ghost" style={{ fontSize: 11 }}>
              <Icon name="x" size={11}/> Sair
            </button>
          </div>

          <div style={{ display: 'grid', gap: 14 }}>
            <iframe
              src={window.NSApi.networkContractPdfUrl}
              style={{ width: '100%', height: 480, border: '1px solid var(--border)', borderRadius: 6, background: '#fff' }}
              title="Contrato"
            />

            <a href={window.NSApi.networkContractPdfUrl} target="_blank" rel="noopener noreferrer"
               style={{ fontSize: 12, color: 'var(--glow-cyan)', textDecoration: 'none', fontFamily: 'var(--f-mono)' }}>
              <Icon name="download" size={11}/> Baixar PDF em uma nova aba
            </a>

            <label style={{
              display: 'flex', alignItems: 'flex-start', gap: 10, padding: 12,
              background: 'rgba(91,200,255,0.06)', border: '1px solid var(--border-soft)',
              borderRadius: 6, cursor: 'pointer',
            }}>
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: 3 }}/>
              <div>
                <div style={{ color: 'var(--fg1)', fontSize: 13 }}>Li e concordo com o contrato acima</div>
                <div style={{ fontSize: 11, color: 'var(--fg5)', marginTop: 4 }}>
                  Seu aceite é registrado com data, hora e endereço IP como evidência probatória,
                  conforme MP 2.200-2/2001.
                </div>
              </div>
            </label>

            <button
              className="btn btn-primary"
              onClick={onSign}
              disabled={!agreed || signing}
              style={{ width: '100%', padding: 14, fontSize: 13 }}
            >
              {signing ? 'REGISTRANDO ACEITE...' : 'ACEITAR E ENTRAR NO PORTAL'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, {
  FunnelPage, LeaderboardPage, AffiliateDrawer, AllAffiliatesPage,
  ProductsPage, TransactionsPage, IntegrationsPage, FXPage, UsersPage,
  HealthPage, CostsPage, InsightsPage, NetworksPage,
  PartnerShell,
});
