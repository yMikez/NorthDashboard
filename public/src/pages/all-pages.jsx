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
  const chartStages = stages.map((s) => ({ label: s.label, volume: s.volume, revenue: s.revenue }));

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
        <FunnelChart stages={chartStages} currency={cur}/>
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
                {state.status === 'loading' && <SkelTableRows rows={6} cols={4}/>}
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

  // AOV global = receita atribuída (funil completo das sessões trazidas
  // pelo afiliado) / sessões trazidas. Captura quanto vale em média
  // cada lead que ele entrega — diferente do AOV por pedido (que ignora
  // upsells e bumps quando a plataforma atribui pra outro affiliateId).
  function aovOf(a) {
    if (!a || !a.attributedSessions) return 0;
    return a.attributedRevenue / a.attributedSessions;
  }

  const rows = all.filter((a) => a.allOrders >= minOrders).sort((a, b) => {
    switch (sortBy) {
      case 'orders': return b.orders - a.orders;
      case 'aov': return aovOf(b) - aovOf(a);
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
          {[['revenue','Receita'],['aov','AOV'],['attributedProfit','Lucro atribuído'],['profit','Lucro direto'],['orders','Pedidos'],['netMargin','Margem'],['approvalRate','Aprovação'],['refundRate','Reembolsos'],['chargebackRate','Chargebacks']].map(([k,l]) => (
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
                <th className="num" title="AOV global = receita do funil completo (FE+UPs+DWs+bumps das sessões trazidas) ÷ sessões. Mostra quanto vale em média cada lead.">AOV global</th>
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
              {state.status === 'loading' && <SkelTableRows rows={10} cols={9}/>}
              {state.status === 'ready' && rows.length === 0 && (
                <tr><td colSpan={15} style={{ textAlign: 'center', padding: 24, opacity: 0.6 }}>
                  Nenhum afiliado com pelo menos {minOrders} pedido{minOrders > 1 ? 's' : ''} no período
                </td></tr>
              )}
              {rows.map((r, i) => {
                const apClass = r.approvalRate > 0.7 ? 'val-ok' : r.approvalRate > 0.5 ? 'val-warn' : 'val-bad';
                const rfClass = r.refundRate < 0.06 ? 'val-ok' : r.refundRate < 0.12 ? 'val-warn' : 'val-bad';
                const cbClass = r.cbRate < 0.005 ? 'val-ok' : r.cbRate < 0.01 ? 'val-warn' : 'val-bad';
                const { cls: platClass, short: platShort } = platBadge(r.platformSlug);
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
                    <td className="num cell-mono" style={{ color: 'var(--glow-cyan)' }}>
                      {r.attributedSessions > 0 ? fmtCurrency(aovOf(r), cur, 0) : '—'}
                      {r.attributedSessions > 0 && (
                        <span style={{ display: 'block', fontSize: 9, color: 'var(--fg5)', fontWeight: 400, marginTop: 1 }}>
                          {r.attributedSessions} sess.
                        </span>
                      )}
                    </td>
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
  const { cls: platClass, short: platShort } = platBadge(aff.platformSlug);
  const joinedDaysAgo = Math.floor((Date.now() - new Date(aff.firstSeenAt).getTime()) / 86400000);

  const dailySeries = data.daily.map((d) => ({ date: d.date, gross: d.revenue }));

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
              <div className="s">
                {k.feApprovedCount > 0
                  ? `receita / ${fmtInt(k.feApprovedCount)} FE aprovados`
                  : 'sem FE no período'}
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
            {dailySeries.length > 0
              ? <NSTimeSeries data={dailySeries} height={200} currency={cur}
                  series={[{ key: 'gross', label: 'Receita', color: '#5BC8FF' }]}/>
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

  // KPIs do período
  const totalCpa = all.reduce((s, r) => s + (r.cpa || 0), 0);
  const totalOrders = all.reduce((s, r) => s + (r.orders || 0), 0);
  const affsWithOrders = all.filter((r) => (r.orders || 0) > 0);

  // CPA médio = média simples do CPA fixo dos afiliados com CPA válido.
  // Válido = entre $200 e $290 (faixa de contrato real, filtra outliers
  // tipo cpa=0 organic e valores estranhos).
  //
  // Fórmula: sum(cpaPerFe) / count, onde cada afiliado entra uma vez,
  // independente de quantas vendas teve.
  const VALID_CPA_MIN = 200;
  const VALID_CPA_MAX = 290;
  const affsWithValidCpa = all.filter((r) => {
    const c = r.cpaPerFe || 0;
    return c >= VALID_CPA_MIN && c <= VALID_CPA_MAX;
  });
  const cpaAvg = affsWithValidCpa.length > 0
    ? affsWithValidCpa.reduce((s, r) => s + r.cpaPerFe, 0) / affsWithValidCpa.length
    : 0;

  // AOV = faturamento próprio do afiliado / pedidos FE dele.
  //
  // Numerador: revenue — sum de grossAmountUsd dos APPROVED onde
  // affiliateId = afiliado. Lente DIRETA: só conta orders creditadas
  // a ele pela plataforma (FE + UPs/DWs onde ele continua sendo o
  // affiliateId). NÃO inclui cross-sells da sessão que foram
  // creditados a outros afiliados via last-click cookie.
  //
  // Denominador: feApprovedCount — pedidos FE+APPROVED do afiliado.
  //
  // Casa com a fórmula clássica que o usuário verifica:
  // "receita período / pedidos de front" = AOV.
  function aovOf(r) {
    return r.feApprovedCount > 0 ? r.revenue / r.feApprovedCount : 0;
  }
  const aovs = all.map(aovOf).filter((v) => v > 0).sort((a, b) => a - b);
  const enoughSample = aovs.length >= 6;
  const p33 = enoughSample ? aovs[Math.floor(aovs.length * 0.33)] : 0;
  const p67 = enoughSample ? aovs[Math.floor(aovs.length * 0.67)] : 0;

  function aovTier(v) {
    if (!enoughSample || v <= 0) return 'none';
    if (v >= p67) return 'good';
    if (v >= p33) return 'mid';
    return 'bad';
  }
  function aovPillStyle(tier) {
    const base = {
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 999,
      fontFamily: 'var(--f-mono)', fontSize: 11,
      letterSpacing: '0.02em', fontWeight: 500,
    };
    if (tier === 'good') return { ...base, background: 'rgba(34,197,94,0.14)', color: 'var(--success)', border: '1px solid rgba(34,197,94,0.35)' };
    if (tier === 'mid') return { ...base, background: 'rgba(255,180,0,0.14)', color: 'var(--warning)', border: '1px solid rgba(255,180,0,0.35)' };
    if (tier === 'bad') return { ...base, background: 'rgba(239,68,68,0.14)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.35)' };
    return { ...base, background: 'rgba(140,161,200,0.06)', color: 'var(--fg5)', border: '1px solid var(--border-soft)' };
  }

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

      <div className="mini-kpis">
        <div className="mini-kpi">
          <div className="l">CPA pago no período</div>
          <div className="v">{fmtCurrency(totalCpa, cur, 0)}</div>
          <div className="s">total pra {affsWithOrders.length} {affsWithOrders.length === 1 ? 'afiliado ativo' : 'afiliados ativos'}</div>
        </div>
        <div className="mini-kpi">
          <div className="l">CPA médio dos afiliados</div>
          <div className="v">{fmtCurrency(cpaAvg, cur, 0)}</div>
          <div className="s">
            média de {affsWithValidCpa.length} {affsWithValidCpa.length === 1 ? 'afiliado' : 'afiliados'} com CPA entre ${VALID_CPA_MIN}–${VALID_CPA_MAX}
          </div>
        </div>
      </div>

      {enoughSample && (
        <div style={{
          fontSize: 11, color: 'var(--fg5)', fontFamily: 'var(--f-mono)',
          padding: '4px 0 12px', display: 'flex', gap: 12, flexWrap: 'wrap',
        }}>
          <span>AOV em terços:</span>
          <span style={aovPillStyle('good')}>≥ {fmtCurrency(p67, cur, 0)} (top 33%)</span>
          <span style={aovPillStyle('mid')}>{fmtCurrency(p33, cur, 0)} – {fmtCurrency(p67, cur, 0)} (médio)</span>
          <span style={aovPillStyle('bad')}>&lt; {fmtCurrency(p33, cur, 0)} (bottom 33%)</span>
        </div>
      )}

      {state.status === 'error' && (
        <div className="panel" style={{ color: 'var(--danger)' }}>Erro ao carregar: {state.error}</div>
      )}

      <div className="panel" style={{ padding: 0 }}>
        <div className="tbl-wrap" style={{ margin: 0, padding: '0 4px', maxHeight: 720, overflowY: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Afiliado</th><th>Plataforma</th>
                <th className="num" title="CPA fixo negociado — valor que o afiliado recebe em cada venda FE aprovada (MODE de cpaPaidUsd das vendas FE+APPROVED+CPA>0 no período)">CPA por venda</th>
                <th className="num">Receita · período</th><th className="num">Pedidos · período</th>
                <th className="num">AOV · período</th>
                <th className="num">Reembolso</th>
                <th>1ª venda</th><th>Última venda</th><th></th>
              </tr>
            </thead>
            <tbody>
              {state.status === 'loading' && <SkelTableRows rows={10} cols={8}/>}
              {state.status === 'ready' && rows.length === 0 && (
                <tr><td colSpan={10} style={{ textAlign: 'center', padding: 24, opacity: 0.6 }}>
                  {query ? 'Nenhum afiliado encontrado' : 'Nenhum afiliado ainda'}
                </td></tr>
              )}
              {rows.map((r) => {
                const displayName = r.nickname || r.externalId;
                const { cls: platClass, short: platShort } = platBadge(r.platformSlug);
                const aov = aovOf(r);
                const tier = aovTier(aov);
                return (
                  <tr key={`${r.platformSlug}:${r.externalId}`} onClick={() => onOpenAffiliate(r.externalId)}>
                    <td>
                      <span className="cell-aff">
                        <span className="av" style={{ background: avatarColor(r.externalId) }}>{initials(displayName)}</span>
                        <span className="meta"><span className="nm">{displayName}</span><span className="id">{r.externalId}</span></span>
                      </span>
                    </td>
                    <td><span className={`plat ${platClass}`}>{platShort}</span></td>
                    <td className="num cell-mono" title={r.feCpaPaidCount > 0 ? `Detectado em ${r.feCpaPaidCount} venda${r.feCpaPaidCount === 1 ? '' : 's'} FE` : 'Sem vendas FE com CPA no período'}>
                      {(r.cpaPerFe || 0) > 0 ? fmtCurrency(r.cpaPerFe, cur, 0) : '—'}
                    </td>
                    <td className="num cell-mono">{fmtCurrency(r.revenue, cur, 0)}</td>
                    <td className="num cell-mono">{fmtInt(r.orders)}</td>
                    <td className="num">
                      {aov > 0 ? (
                        <span style={aovPillStyle(tier)} title={`${r.feApprovedCount} FE aprovados · ${fmtCurrency(r.attributedRevenue, cur, 0)} de faturamento (sessão completa com cross-sells)`}>
                          {fmtCurrency(aov, cur, 0)}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--fg5)', fontFamily: 'var(--f-mono)', fontSize: 11 }}>—</span>
                      )}
                    </td>
                    <td className="num cell-mono">{r.allOrders ? (r.refundRate * 100).toFixed(1) + '%' : '—'}</td>
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
  const pageStates = usePageStates();
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
      pageStates={pageStates}
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

// ----- Funnel page-state (Black/White) -----
// Estados reportados pelas páginas de Upsell 01 (beacon → /api/page-state).
function usePageStates() {
  const [states, setStates] = useState([]);
  useEffect(() => {
    let cancelled = false;
    window.NSApi.fetchPageStates()
      .then((d) => { if (!cancelled) setStates(d.states || []); })
      .catch(() => { /* silencioso — recurso opcional */ });
    return () => { cancelled = true; };
  }, []);
  return states;
}

function normKey(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

// Casa o slug do produto reportado com o nome da família (tolerante: um contém
// o outro depois de normalizar). Ex: slug "horsepeak" ↔ família "Horse Peak Gelatin".
function pageStatesForFamily(pageStates, family) {
  const fk = normKey(family);
  if (!fk) return [];
  return (pageStates || []).filter((s) => {
    const pk = normKey(s.product);
    return pk && (fk.includes(pk) || pk.includes(fk));
  });
}

// Uma entrada POR PLATAFORMA pra uma família (o estado mais recente de cada).
// Garante que o card mostre uma pill por plataforma, mesmo se houver slugs
// variados reportando o mesmo produto. Ordena por plataforma (estável).
function platformStatesForFamily(pageStates, family) {
  const byPlat = {};
  for (const s of pageStatesForFamily(pageStates, family)) {
    const k = s.platform || '?';
    if (!byPlat[k] || new Date(s.reportedAt) > new Date(byPlat[k].reportedAt)) byPlat[k] = s;
  }
  return Object.values(byPlat).sort((a, b) => String(a.platform).localeCompare(String(b.platform)));
}

// Normaliza o estado pra comparação: minúsculo, sem espaços ("Black 2"→"black2").
function normState(state) { return String(state || '').toLowerCase().replace(/\s+/g, ''); }

// Cores por estado (convenção): white claro; black escuro; black2 escuro com
// acento âmbar (pra distinguir do black num relance); gray cinza; resto ciano.
function pageStateStyle(state) {
  const s = normState(state);
  if (s === 'white' || s === 'white1' || s === 'white01') {
    return { bg: 'rgba(255,255,255,0.92)', fg: '#0a0b12', border: 'rgba(255,255,255,0.6)' };
  }
  if (s === 'black2' || s === 'black02' || s === 'blacktwo' || s === 'blackii') {
    return { bg: 'rgba(20,20,26,0.92)', fg: '#FFCF8B', border: 'rgba(255,184,91,0.65)' };
  }
  if (s === 'black' || s === 'black1' || s === 'black01') {
    return { bg: 'rgba(20,20,26,0.85)', fg: '#e7e9f0', border: 'rgba(255,255,255,0.30)' };
  }
  if (s === 'gray' || s === 'grey') {
    return { bg: 'rgba(120,130,160,0.30)', fg: '#cdd5e8', border: 'rgba(160,170,200,0.45)' };
  }
  return { bg: 'rgba(91,200,255,0.18)', fg: 'var(--glow-cyan)', border: 'rgba(91,200,255,0.45)' };
}

// Rótulo amigável: "black2"→"BLACK 2", "white"→"WHITE", senão UPPER do que veio.
function pageStateLabel(state) {
  const s = normState(state);
  if (s === 'black2' || s === 'black02' || s === 'blacktwo' || s === 'blackii') return 'BLACK 2';
  if (s === 'black' || s === 'black1' || s === 'black01') return 'BLACK';
  if (s === 'white' || s === 'white1' || s === 'white01') return 'WHITE';
  return String(state || '').toUpperCase();
}

function PageStateBadge({ state, platform, size = 'sm' }) {
  const st = pageStateStyle(state);
  const plat = platform ? platBadge(platform) : null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontFamily: 'var(--f-mono)', fontSize: size === 'sm' ? 9.5 : 11, fontWeight: 600,
      letterSpacing: '0.06em', textTransform: 'uppercase',
      padding: size === 'sm' ? '2px 7px' : '3px 9px', borderRadius: 'var(--r-full)',
      background: st.bg, color: st.fg, border: `1px solid ${st.border}`, whiteSpace: 'nowrap',
    }}>
      {plat && <span style={{ opacity: 0.7 }}>{plat.short}</span>}
      {pageStateLabel(state)}
    </span>
  );
}

// ── Beacon de estado do funil (script copiável por produto) ──────────────────
// O dashboard gera o <script> já com o PRODUCT certo embutido (= nome da
// família, que é exatamente o que o card casa). O usuário só edita PLATFORM
// depois de colar. O estado NÃO é hardcodado: o script lê a VARIANTE
// VISUALIZADA do copy-switch.js (window._copyVariant / data-copy-variant /
// classe .copy-black2|.copy-black / window._copyBlack) → white/black/black2/+.
// Por isso DEVE ser colado DEPOIS do copy-switch.js.

function beaconEndpoint() {
  // O dashboard é servido do mesmo host que recebe o beacon.
  try { return window.location.origin + '/api/page-state'; }
  catch (e) { return 'https://dash.thenorthscales.com/api/page-state'; }
}

function beaconScriptFor(product) {
  const endpoint = beaconEndpoint();
  const prod = JSON.stringify(String(product == null ? '' : product));
  return [
    '<!-- NorthScale · beacon de estado do funil (Upsell 01). -->',
    '<!-- Cole DEPOIS do copy-switch.js. Edite apenas PLATFORM. -->',
    '<script>',
    '(function () {',
    '  "use strict";',
    '  var PLATFORM = "EDITE_AQUI"; // clickbank | digistore24 | buygoods | cartpanda',
    '  var PRODUCT  = ' + prod + '; // gerado pelo dashboard — NÃO altere',
    '  var ENDPOINT = "' + endpoint + '";',
    '',
    '  // Reporta a VARIANTE VISUALIZADA (o tráfego sempre vem de afiliado, então',
    '  // o efetivo é confiável e captura white/black/black2/+). Ordem de leitura:',
    '  //   1) window._copyVariant  (string — exponha isto no copy-switch p/ multi)',
    '  //   2) <html data-copy-variant="...">',
    '  //   3) classe .copy-black2 / .copy-black no <html>/<body>',
    '  //   4) window._copyBlack (booleano do copy-switch atual)',
    '  function detectState() {',
    '    var de = document.documentElement, bd = document.body || {};',
    '    var v = window._copyVariant;',
    '    if (typeof v === "string" && v.trim()) return v.trim().toLowerCase().replace(/\\s+/g, "");',
    '    var attr = (de.getAttribute && de.getAttribute("data-copy-variant")) || "";',
    '    if (attr.trim()) return attr.trim().toLowerCase().replace(/\\s+/g, "");',
    '    function hasCls(c) { return (de.classList && de.classList.contains(c)) || (bd.classList && bd.classList.contains(c)); }',
    '    if (hasCls("copy-black2")) return "black2";',
    '    if (hasCls("copy-black")) return "black";',
    '    if (typeof window._copyBlack === "boolean") return window._copyBlack ? "black" : "white";',
    '    return "white";',
    '  }',
    '',
    '  function send() {',
    '    var body = JSON.stringify({ platform: PLATFORM, product: PRODUCT, state: detectState(), url: location.href });',
    '    try { if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, body)) return; } catch (e) {}',
    '    try { fetch(ENDPOINT, { method: "POST", body: body, keepalive: true, headers: { "Content-Type": "text/plain" } }); } catch (e) {}',
    '  }',
    '',
    '  if (document.readyState === "loading")',
    '    document.addEventListener("DOMContentLoaded", function () { setTimeout(send, 0); });',
    '  else setTimeout(send, 0);',
    '})();',
    '<' + '/script>',
  ].join('\n');
}

function fallbackCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  } catch (e) { return false; }
}

function copyBeaconScript(product, onDone) {
  const text = beaconScriptFor(product);
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => onDone && onDone(true),
        () => onDone && onDone(fallbackCopy(text))
      );
      return;
    }
  } catch (e) { /* cai no fallback */ }
  onDone && onDone(fallbackCopy(text));
}

function CopyBeaconChip({ product, accent, label = 'Script', block = false }) {
  const [copied, setCopied] = useState(false);
  const onCopy = (e) => {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    copyBeaconScript(product, (ok) => {
      if (ok === false) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };
  const col = copied ? 'var(--success)' : (accent || 'var(--glow-cyan)');
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={onCopy}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onCopy(e); }}
      title="Copiar o script do beacon deste produto — cole nas páginas de Upsell 01, depois do copy-switch.js. Só edite PLATFORM."
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        cursor: 'pointer', userSelect: 'none',
        fontFamily: 'var(--f-mono)', fontSize: 10.5, fontWeight: 600,
        letterSpacing: '0.04em', whiteSpace: 'nowrap',
        padding: block ? '7px 12px' : '3px 9px',
        borderRadius: 'var(--r-full)',
        background: copied ? 'rgba(58,214,140,0.14)' : `${col}1a`,
        color: col, border: `1px solid ${col}55`,
      }}
    >
      {copied ? '✓ Copiado' : '⧉ ' + label}
    </span>
  );
}

function FamilyGrid({ state, cur, onPick, pageStates }) {
  const families = state.data?.families || [];
  const allStates = pageStates || [];
  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">CATÁLOGO · PRODUTOS</span>
          <h2>Performance <em>por família</em></h2>
          <span className="sub">{families.length} famílias no catálogo · clica em uma pra ver as variantes</span>
        </div>
      </div>

      {allStates.length > 0 && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-head" style={{ marginBottom: 10 }}>
            <div className="panel-title">
              <span className="panel-eyebrow">ESTADO DAS PÁGINAS · FUNIL (UPSELL 01)</span>
              <div className="panel-sub">Variante visualizada na página de upsell, por plataforma — White / Black / Black 2</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {allStates.map((s) => (
              <div key={`${s.platform}:${s.product}`} style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '6px 10px', borderRadius: 8,
                background: 'rgba(91,200,255,0.04)', border: '1px solid var(--border-soft)',
              }}>
                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--fg2)' }}>{s.product}</span>
                <PageStateBadge state={s.state} platform={s.platform}/>
                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9.5, color: 'var(--fg5)' }}>{fmtSyncAgo(s.reportedAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {state.status === 'error' && (
        <div className="panel" style={{ color: 'var(--danger)' }}>Erro ao carregar: {state.error}</div>
      )}
      {state.status === 'loading' && (
        <SkelCardGrid n={6}/>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
        {families.map((f) => {
          const accent = familyAccent(f.family);
          const liftPct = f.upsellLiftPct;
          const hasOrders = f.totalOrders > 0;
          const fStates = platformStatesForFamily(allStates, f.family);
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

              {fStates.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}
                  title="Último estado de página registrado no Upsell 01">
                  {fStates.map((s) => (
                    <PageStateBadge key={`${s.platform}:${s.product}`} state={s.state} platform={s.platform}/>
                  ))}
                </div>
              )}

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

              <div style={{ paddingTop: 10, borderTop: '1px solid rgba(91,200,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: 'var(--fg4)', fontFamily: 'var(--f-mono)' }}>
                <span>{f.feSkuCount} FE · {f.upSkuCount} UP · {f.dwSkuCount} DW · {f.rcSkuCount} RC</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <CopyBeaconChip product={f.family} accent={accent}/>
                  <span style={{ color: accent }}>Abrir →</span>
                </span>
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

      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-head" style={{ marginBottom: 10 }}>
          <div className="panel-title">
            <span className="panel-eyebrow">BEACON DE ESTADO · UPSELL 01</span>
            <div className="panel-sub">
              Cole o script abaixo nas páginas de Upsell 01 de <strong>{family}</strong>. O produto já vem embutido —
              você só edita a <strong>plataforma</strong> depois de colar.
            </div>
          </div>
          <CopyBeaconChip product={family} accent={accent} label="Copiar script" block/>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, fontSize: 11.5, color: 'var(--fg3)', fontFamily: 'var(--f-mono)', marginBottom: 4 }}>
          <span><span style={{ color: accent }}>1.</span> Cole <strong>depois</strong> do <code>copy-switch.js</code></span>
          <span><span style={{ color: accent }}>2.</span> Edite só <code>PLATFORM</code></span>
          <span><span style={{ color: accent }}>3.</span> A variante (White/Black/Black 2) é lida <strong>automático</strong> do Copy Switch</span>
        </div>
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--fg4)' }}>
            ver o script (produto: <code>{family}</code>)
          </summary>
          <pre style={{
            marginTop: 8, padding: 12, borderRadius: 8, overflowX: 'auto',
            background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border-soft)',
            fontFamily: 'var(--f-mono)', fontSize: 10.5, lineHeight: 1.5, color: 'var(--fg2)',
          }}>{beaconScriptFor(family)}</pre>
        </details>
      </div>

      {productsState.status === 'loading' && (
        <SkelInline steps={['Carregando variantes…', 'Agregando por etapa…']} height={160}/>
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
  const { cls: platClass, short: platShort } = platBadge(v.platformSlug);
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
            <span className="eyebrow">VARIANTE · {platBadge(v.platformSlug).upper}</span>
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
        <SkelCardGrid n={6}/>
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
            const { cls: platClass, short: platShort } = platBadge(p.platformSlug);
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
                  const { cls: platClass, short: platShort } = platBadge(p.platformSlug);
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
const STAGE_LABEL = {
  FRONTEND: 'FE',
  UPSELL: 'Upsell',
  DOWNSELL: 'Downsell',
  BUMP: 'Bump',
  SMS_RECOVERY: 'Recovery',
};

// Classe liquid-glass por etapa (definidas em dashboard.css — mesmo
// tratamento do .st de status: blur+saturate, sheen, bevel).
const STAGE_CLASS = {
  FRONTEND: 'sp-fe',
  UPSELL: 'sp-up',
  BUMP: 'sp-bump',
  DOWNSELL: 'sp-dw',
  SMS_RECOVERY: 'sp-rc',
};

function StagePill({ type }) {
  if (!type) return null;
  const cls = STAGE_CLASS[type] || 'sp-fe';
  return (
    <span className={`stage-pill ${cls}`} style={{ marginLeft: 8 }}>
      {STAGE_LABEL[type] || type.toLowerCase()}
    </span>
  );
}

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
  // Filtro de etapa do funil (Order.productType). 'all' = sem filtro.
  const [typeFilter, setTypeFilter] = useState(() => {
    try {
      const s = new URLSearchParams(location.search).get('stage');
      const ok = ['all', 'FRONTEND', 'UPSELL', 'DOWNSELL', 'BUMP', 'SMS_RECOVERY'];
      return s && ok.includes(s) ? s : 'all';
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
    window.NSApi.fetchOrders(filters, { status: statusFilter, productType: typeFilter, search: debouncedQuery, limit: 500 })
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
      statusFilter, typeFilter, debouncedQuery]);

  const cur = filters.currency || 'USD';
  const orders = state.data?.orders || [];
  const statusCounts = state.data?.statusCounts || {};
  const typeCounts = state.data?.typeCounts || {};
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
        <span className="f-label" style={{ marginLeft: 8 }}>ETAPA</span>
        <div className="seg">
          {[['all','Todas'],['FRONTEND','FE'],['UPSELL','Upsell'],['DOWNSELL','Downsell'],['BUMP','Bump'],['SMS_RECOVERY','Recovery']].map(([k, l]) => (
            <button key={k} className={typeFilter === k ? 'is-active' : ''} onClick={() => setTypeFilter(k)}>
              {l}<span style={{ marginLeft: 6, opacity: 0.5 }}>{fmtInt(typeCounts[k] || 0)}</span>
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
              {state.status === 'loading' && <SkelTableRows rows={12} cols={8}/>}
              {state.status === 'ready' && orders.length === 0 && (
                <tr><td colSpan={12} style={{ textAlign: 'center', padding: 24, opacity: 0.6 }}>Nenhuma transação no período</td></tr>
              )}
              {orders.map((o) => {
                const { cls: platClass, short: platShort } = platBadge(o.platformSlug);
                const statusLc = o.status.toLowerCase();
                return (
                  <tr key={`${o.platformSlug}:${o.externalId}`}
                      onClick={() => setDrawer({ externalId: o.externalId, platformSlug: o.platformSlug })}
                      style={{ cursor: 'pointer' }}>
                    <td className="cell-mono">{fmtDateTime(o.orderedAt)}</td>
                    <td className="cell-mono">{o.externalId}</td>
                    <td><span className={`plat ${platClass}`}>{platShort}</span></td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap' }}>
                        {o.productName || o.productExternalId}
                        <StagePill type={o.productType} />
                      </span>
                    </td>
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
  const { short: platShort, cls: platClass } = platBadge(o.platformSlug);
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
  const [editing, setEditing] = useState(null); // { slug, displayName, feeRatePct, allowancePct }
  const [refreshKey, setRefreshKey] = useState(0);

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
      Array.from(filters.families).join(','),
      refreshKey]);

  const cur = filters.currency || 'USD';
  const platforms = state.data?.platforms || [];

  const PLATFORM_SHORT = { digistore24: 'D24', clickbank: 'CB', buygoods: 'BG' };
  const comingSoon = [
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
          <div style={{ gridColumn: '1 / -1' }}>
            <SkelInline steps={['Carregando plataformas…', 'Checando sincronização…']} height={150}/>
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

              {/* Waterfall financeiro — só se fees cadastradas (admin).
                 Reproduz a estrutura do relatório de allowance do Digistore:
                 Gross bruto → − taxa → − comissões → = Your earnings.
                 Allowance reservado entra como linha separada (sobre gross). */}
              {(p.feeRatePct != null || p.allowancePct != null) && (
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(91,200,255,0.15)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--fg4)' }}>
                      WATERFALL · PERÍODO
                    </div>
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 10, padding: '2px 6px' }}
                      onClick={() => setEditing({
                        slug: p.slug,
                        displayName: p.displayName,
                        feeRatePct: p.feeRatePct ?? '',
                        allowancePct: p.allowancePct ?? '',
                      })}
                      title="Atualizar taxas + allowance"
                    >
                      <Icon name="pencil" size={10}/> Editar
                    </button>
                  </div>
                  <div style={{ display: 'grid', gap: 4, fontFamily: 'var(--f-mono)', fontSize: 12 }}>
                    <FeesRow
                      label="Gross bruto"
                      title={`Receita aprovada ${fmtCurrency(p.totalRevenue, cur, 0)} + refunds/CBs ${fmtCurrency(p.grossRefunded, cur, 0)}`}
                      value={p.grossBruto} cur={cur} color="var(--fg1)"
                    />
                    {p.taxesPaid != null && (
                      <FeesRow
                        label={`− Taxa de transação (${p.feeRatePct}%)`}
                        value={p.taxesPaid} cur={cur} color="var(--danger)" prefix="−"
                      />
                    )}
                    {p.cpaPaidTotal > 0 && (
                      <FeesRow
                        label="− Comissões a afiliados"
                        title="Sum de cpaPaidUsd das orders do período"
                        value={p.cpaPaidTotal} cur={cur} color="var(--danger)" prefix="−"
                      />
                    )}
                    {p.vendorEarnings != null && (
                      <FeesRow
                        label="= Your earnings (estimado)"
                        value={p.vendorEarnings} cur={cur} color="var(--success)" bold
                      />
                    )}
                    {p.allowanceReserved != null && (
                      <FeesRow
                        label={`Allowance reservado (${p.allowancePct}% gross)`}
                        title="Reserva temporária retida pela plataforma contra refund/chargeback"
                        value={p.allowanceReserved} cur={cur} color="var(--warning)"
                      />
                    )}
                  </div>
                  {p.feesUpdatedAt && (
                    <div style={{ fontSize: 9, color: 'var(--fg5)', marginTop: 8, fontFamily: 'var(--f-mono)' }}>
                      % atualizados {fmtSyncAgo(p.feesUpdatedAt)}
                    </div>
                  )}
                </div>
              )}

              {/* Botão cadastrar quando vazio. */}
              {p.feeRatePct == null && p.allowancePct == null && (
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(91,200,255,0.15)' }}>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 11, width: '100%', justifyContent: 'center' }}
                    onClick={() => setEditing({
                      slug: p.slug,
                      displayName: p.displayName,
                      feeRatePct: '',
                      allowancePct: '',
                    })}
                  >
                    <Icon name="plus" size={11}/> Cadastrar taxas e allowance
                  </button>
                </div>
              )}

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

        {editing && (
          <PlatformFeesModal
            platform={editing}
            onCancel={() => setEditing(null)}
            onSaved={() => { setEditing(null); setRefreshKey((n) => n + 1); }}
          />
        )}

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

function FeesRow({ label, value, cur, color, prefix, bold, title }) {
  return (
    <div title={title} style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12,
      padding: '2px 0',
    }}>
      <span style={{ color: 'var(--fg3)', fontSize: 11 }}>{label}</span>
      <span style={{ color, fontWeight: bold ? 600 : 400 }}>
        {prefix && <span style={{ opacity: 0.7, marginRight: 2 }}>{prefix}</span>}
        {fmtCurrency(value, cur, 0)}
      </span>
    </div>
  );
}

function PlatformFeesModal({ platform, onCancel, onSaved }) {
  const [feeRate, setFeeRate] = useState(String(platform.feeRatePct ?? ''));
  const [allowance, setAllowance] = useState(String(platform.allowancePct ?? ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setError(null);
    const fee = feeRate.trim() === '' ? null : Number(feeRate.replace(',', '.'));
    const alw = allowance.trim() === '' ? null : Number(allowance.replace(',', '.'));
    if (fee != null && (!Number.isFinite(fee) || fee < 0 || fee > 100)) {
      setError('Taxa deve estar entre 0 e 100'); return;
    }
    if (alw != null && (!Number.isFinite(alw) || alw < 0 || alw > 100)) {
      setError('Allowance deve estar entre 0 e 100'); return;
    }
    setSaving(true);
    try {
      await window.NSApi.adminPatchPlatformFees(platform.slug, {
        feeRatePct: fee,
        allowancePct: alw,
      });
      // Limpa flag de "stale" pra evitar popup imediato após salvar.
      try { localStorage.removeItem('ns-fees-prompt-dismissed-until'); } catch {}
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(3,6,23,0.7)',
        backdropFilter: 'blur(8px)', display: 'grid', placeItems: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="panel"
        style={{ width: 380, padding: 22 }}
      >
        <div className="eyebrow" style={{ fontSize: 10, color: 'var(--glow-cyan)', marginBottom: 4 }}>
          PLATAFORMA · {platform.slug.toUpperCase()}
        </div>
        <h3 style={{ margin: '0 0 4px', fontSize: 18 }}>{platform.displayName}</h3>
        <p style={{ fontSize: 11, color: 'var(--fg4)', marginBottom: 18 }}>
          Taxa média de transação e allowance reservado, em %. Aplicado sobre
          a receita do período pra calcular valores absolutos no card.
        </p>

        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ fontSize: 11, color: 'var(--fg3)', display: 'block', marginBottom: 4 }}>
            Taxa de transação média (%)
          </span>
          <input
            type="text" inputMode="decimal" value={feeRate}
            onChange={(e) => setFeeRate(e.target.value)}
            placeholder="ex: 8.37"
            style={feesInputStyle}
            autoFocus
          />
        </label>
        <label style={{ display: 'block', marginBottom: 18 }}>
          <span style={{ fontSize: 11, color: 'var(--fg3)', display: 'block', marginBottom: 4 }}>
            Allowance médio (%)
          </span>
          <input
            type="text" inputMode="decimal" value={allowance}
            onChange={(e) => setAllowance(e.target.value)}
            placeholder="ex: 2.37"
            style={feesInputStyle}
          />
        </label>

        {error && (
          <div style={{ color: 'var(--danger)', fontSize: 11, marginBottom: 10 }}>{error}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-ghost" onClick={onCancel} disabled={saving}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}

const feesInputStyle = {
  width: '100%', padding: '8px 10px',
  background: 'rgba(91,200,255,0.05)', border: '1px solid rgba(91,200,255,0.20)',
  borderRadius: 6, color: 'var(--fg1)', fontFamily: 'var(--f-mono)', fontSize: 13,
  outline: 'none',
};

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
  { group: 'Captação',  id: 'recovery',       label: 'Recuperação' },
  { group: 'Captação',  id: 'tauk',           label: 'Tauk' },
  { group: 'Captação',  id: 'sms',            label: 'SMS' },
  { group: 'Captação',  id: 'email',          label: 'Email' },
  { group: 'Catálogo',  id: 'products',       label: 'Produtos' },
  { group: 'Catálogo',  id: 'transactions',   label: 'Transações' },
  { group: 'Sistema',   id: 'platforms',      label: 'Plataformas' },
  { group: 'Sistema',   id: 'costs',          label: 'Fulfillment' },
  { group: 'Sistema',   id: 'health',         label: 'Saúde do dado' },
];
const TAB_GROUPS = ['Análise', 'Afiliados', 'Captação', 'Catálogo', 'Sistema'];

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
              {state.status === 'loading' && <SkelTableRows rows={6} cols={6}/>}
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
    return (
      <div className="page-in">
        <SkelPageHead/>
        <SkelMiniKpis n={3}/>
        <div style={{ marginTop: 14 }}><SkelTablePanel rows={8} cols={5} i={1}/></div>
      </div>
    );
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
// Fornecedores de fulfillment — metadados p/ UI genérica (redrock/shipoffers/
// fullstack/+). Cores usadas nos cards de distribuição, barra, chart e selos.
const SUPPLIER_META = {
  shipoffers: { label: 'ShipOffers', solid: '#5BC8FF', text: '#7cd0ff', darkText: true,
    grad: 'linear-gradient(180deg, #7cd0ff 0%, #5BC8FF 50%, #2a9cd6 100%)', glow: 'rgba(91,200,255,0.45)', chipBg: 'rgba(124,208,255,0.18)' },
  redrock: { label: 'RedRock', solid: '#ff5a5a', text: '#ff8a8a', darkText: false,
    grad: 'linear-gradient(180deg, #ff7373 0%, #ff5a5a 50%, #e83838 100%)', glow: 'rgba(255,90,90,0.45)', chipBg: 'rgba(255,138,138,0.18)' },
  fullstack: { label: 'FullStack', solid: '#9b7bff', text: '#b99cff', darkText: false,
    grad: 'linear-gradient(180deg, #b99cff 0%, #9b7bff 50%, #6f4de0 100%)', glow: 'rgba(155,123,255,0.45)', chipBg: 'rgba(155,123,255,0.18)' },
};
function supMeta(s) {
  return SUPPLIER_META[s] || {
    label: s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '—',
    solid: '#8aa0c0', text: '#aab8d0', darkText: false,
    grad: 'linear-gradient(180deg, #9aa8c0 0%, #8aa0c0 50%, #6a7890 100%)', glow: 'rgba(140,160,190,0.4)', chipBg: 'rgba(140,160,190,0.18)',
  };
}
const SUPPLIER_OPTIONS = ['shipoffers', 'redrock', 'fullstack'];

function CostsPage({ filters }) {
  const [state, setCostState] = useState({ status: 'loading', data: null, error: null });
  const [draftFamilies, setDraftFamilies] = useState({});  // { [family]: unitCost string }
  const [draftSuppliers, setDraftSuppliers] = useState({}); // { [family]: 'redrock'|'shipoffers' }
  const [draftRates, setDraftRates] = useState({});         // { ['supplier|family|bottlesMax']: price string }
  const [fulfillmentKpi, setFulfillmentKpi] = useState({ status: 'loading', value: 0, gross: 0, daily: [] });
  // Distribuição RedRock vs ShipOffers (kpis + série diária). Respeita filtros.
  const [fulfDist, setFulfDist] = useState({ status: 'loading', kpis: null, bySupplier: [], daily: [] });
  // Cadastro de SKUs: lista de Products com supplier resolvido + drafts de
  // override (chave = productId, valor = 'redrock'|'shipoffers'|null|undefined).
  // undefined = sem mudança nesse SKU.
  const [supplierList, setSupplierList] = useState({ status: 'idle', products: [], error: null });
  const [supplierDrafts, setSupplierDrafts] = useState({});
  const [supplierFilters, setSupplierFilters] = useState({ platform: '', family: '', search: '' });
  const cur = filters?.currency || 'USD';

  // Fulfillment total + série diária via /api/metrics/costs-overview —
  // query DIRETA no Order (soma Order.fulfillmentUsd snapshotado por
  // pedido). Mesma fonte do dashboard /custos, então os números batem.
  // Antes usava /overview (materialized view) que podia estar defasada
  // → mostrava $0 enquanto o dado real existia.
  useEffect(() => {
    if (!filters) return;
    let cancelled = false;
    setFulfillmentKpi((s) => ({ ...s, status: 'loading' }));
    window.NSApi.fetchCostsOverview(filters)
      .then((data) => {
        if (cancelled) return;
        setFulfillmentKpi({
          status: 'ready',
          value: data.kpis?.fulfillmentUsd ?? 0,
          gross: data.kpis?.grossUsd ?? 0,
          daily: Array.isArray(data.daily) ? data.daily : [],
        });
      })
      .catch(() => { if (!cancelled) setFulfillmentKpi({ status: 'error', value: 0, gross: 0, daily: [] }); });
    return () => { cancelled = true; };
  }, [filters?.dateRange.start.getTime(), filters?.dateRange.end.getTime(),
      filters && Array.from(filters.platforms).join(','),
      filters && Array.from(filters.countries).join(','),
      filters && Array.from(filters.families).join(',')]);

  // Distribuição RedRock vs ShipOffers — usa filtros globais. Pegamos
  // kpis (contagens + %) e a série diária pro line chart de comparação.
  useEffect(() => {
    if (!filters) return;
    let cancelled = false;
    setFulfDist((s) => ({ ...s, status: 'loading' }));
    window.NSApi.fetchFulfillmentOverview(filters)
      .then((data) => {
        if (cancelled) return;
        setFulfDist({
          status: 'ready',
          kpis: data.kpis,
          bySupplier: Array.isArray(data.bySupplier) ? data.bySupplier : [],
          daily: Array.isArray(data.daily) ? data.daily : [],
        });
      })
      .catch(() => { if (!cancelled) setFulfDist({ status: 'error', kpis: null, bySupplier: [], daily: [] }); });
    return () => { cancelled = true; };
  }, [filters?.dateRange.start.getTime(), filters?.dateRange.end.getTime(),
      filters && Array.from(filters.platforms).join(','),
      filters && Array.from(filters.countries).join(','),
      filters && Array.from(filters.families).join(',')]);

  const fulfillmentBuckets = (fulfillmentKpi.daily || []).map((b) => ({
    date: b.date,
    fulfillment: b.fulfillmentUsd ?? 0,
  }));
  const fulfillmentDays = fulfillmentBuckets.length;
  const fulfillmentAvgDay = fulfillmentDays > 0
    ? fulfillmentKpi.value / fulfillmentDays
    : 0;
  const fulfillmentPeakDay = fulfillmentBuckets.reduce(
    (mx, b) => (b.fulfillment > mx.fulfillment ? b : mx),
    { fulfillment: 0, date: null },
  );

  // Estimativa pro próximo invoice da transportadora (toda terça-feira).
  // Calcula quantos dias até a próxima terça e usa a média diária do
  // período pra projetar o volume parcial até lá.
  function nextTuesdayInvoiceEstimate() {
    if (fulfillmentKpi.status !== 'ready' || !filters) return null;
    const days = Math.max(1, Math.ceil((filters.dateRange.end - filters.dateRange.start) / 86400000));
    const dailyAvg = fulfillmentKpi.value / days;
    const today = new Date();
    const dow = today.getDay(); // 0=Sun, 2=Tue
    let daysToTue = (2 - dow + 7) % 7;
    if (daysToTue === 0) daysToTue = 7; // se hoje é terça, próxima é semana q vem
    // Quantos dias da semana atual JÁ passaram desde a terça anterior.
    const daysSinceLastTue = 7 - daysToTue;
    const estimate = dailyAvg * daysSinceLastTue;
    return { dailyAvg, daysToTue, daysSinceLastTue, estimate };
  }
  const tueEst = nextTuesdayInvoiceEstimate();
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

  const rateKey = (r) => `${r.supplier}|${r.family}|${r.bottlesMax}`;

  function valueForFamily(family) {
    if (family in draftFamilies) return draftFamilies[family];
    const f = state.data?.families.find((x) => x.family === family);
    return f != null ? f.unitCostUsd : 0;
  }
  function supplierForFamily(family) {
    if (family in draftSuppliers) return draftSuppliers[family];
    const f = state.data?.families.find((x) => x.family === family);
    return f?.fulfillmentSupplier || 'shipoffers';
  }
  function valueForRate(key, orig) {
    if (key in draftRates) return draftRates[key];
    return orig;
  }
  function familyDirty(family) {
    const f = state.data?.families.find((x) => x.family === family);
    const costDirty = family in draftFamilies
      && parseFloat(draftFamilies[family]) !== (f?.unitCostUsd ?? 0);
    const supDirty = family in draftSuppliers
      && draftSuppliers[family] !== (f?.fulfillmentSupplier || 'shipoffers');
    return costDirty || supDirty;
  }
  function rateDirty(key, orig) {
    if (!(key in draftRates)) return false;
    return parseFloat(draftRates[key]) !== orig;
  }
  function dirtyCount() {
    let n = 0;
    if (state.data) {
      for (const f of state.data.families) if (familyDirty(f.family)) n++;
      for (const r of state.data.fulfillment) {
        if (rateDirty(rateKey(r), r.priceUsd)) n++;
      }
    }
    return n;
  }
  function discardChanges() {
    setDraftFamilies({});
    setDraftSuppliers({});
    setDraftRates({});
  }

  async function save() {
    if (!token) {
      setSaveState({ status: 'error', message: 'Token necessário pra salvar.' });
      return;
    }
    // União das famílias tocadas (custo OU fornecedor). Cada uma manda
    // o valor efetivo dos dois campos (o backend faz upsert).
    const touchedFamilies = new Set([
      ...Object.keys(draftFamilies),
      ...Object.keys(draftSuppliers),
    ]);
    const familyChanges = Array.from(touchedFamilies)
      .map((family) => ({
        family,
        unitCostUsd: parseFloat(valueForFamily(family)),
        fulfillmentSupplier: supplierForFamily(family),
      }))
      .filter((x) => Number.isFinite(x.unitCostUsd) && x.unitCostUsd >= 0);
    const rateChanges = Object.entries(draftRates)
      .map(([key, v]) => {
        const [supplier, family, bm] = key.split('|');
        return { supplier, family, bottlesMax: parseInt(bm, 10), priceUsd: parseFloat(v) };
      })
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
      setSaveState({ status: 'saved', message: `${result.updated.families} famílias + ${result.updated.fulfillment} tarifas salvas.` });
      setDraftFamilies({});
      setDraftSuppliers({});
      setDraftRates({});
      reload();
    } catch (err) {
      setSaveState({ status: 'error', message: err.message });
    }
  }

  async function recompute() {
    if (!token) { setSaveState({ status: 'error', message: 'Token necessário — autentique primeiro (campo bearer secret acima).' }); return; }
    if (!confirm('Reclassificar produtos (BuyGoods etc.) + recalcular COGS/frete em TODAS as orders com os preços atuais? Sobrescreve os snapshots históricos.')) return;
    setSaveState({ status: 'saving', message: 'Iniciando job em background…' });
    try {
      const kick = await window.NSApi.adminBackfillCogs(token);
      if (kick.running && kick.started === false) {
        setSaveState({ status: 'saving', message: 'Já tinha um backfill rodando — acompanhando o progresso…' });
      } else {
        setSaveState({ status: 'saving', message: 'Job rodando em background (reclassificar + recalcular)… pode levar alguns minutos.' });
      }
      // Polling do status. O job roda no servidor mesmo se você sair da
      // página; aqui só acompanhamos pra mostrar o resultado.
      const poll = async () => {
        try {
          const st = await window.NSApi.adminBackfillStatus(token);
          if (st.running) {
            setSaveState({ status: 'saving', message: `Job rodando desde ${st.startedAt ? new Date(st.startedAt).toLocaleTimeString() : '—'}… aguarde.` });
            setTimeout(poll, 4000);
            return;
          }
          if (st.error) {
            setSaveState({ status: 'error', message: `Backfill falhou: ${st.error}` });
            return;
          }
          const r = st.result || {};
          setSaveState({
            status: 'saved',
            message: `Pronto · ${r.reclassified ?? 0} produtos reclassificados · ${r.scanned ?? 0} orders varridas · ${r.cogsUpdated ?? 0} COGS atualizados · ${r.sessionsRebalanced ?? 0} sessões de frete rebalanceadas · ${r.funnelStepFixed ?? 0} funnelSteps corrigidos.`,
          });
          reload();
        } catch (err) {
          setSaveState({ status: 'error', message: `Erro consultando status: ${err.message}` });
        }
      };
      setTimeout(poll, 3000);
    } catch (err) {
      setSaveState({ status: 'error', message: err.message });
    }
  }

  // Classifica produtos não-reconhecidos via IA. 2 passos: dry-run mostra
  // as propostas; confirmar aplica + recalcula COGS de todas as orders.
  async function classifyAi() {
    if (!token) { setSaveState({ status: 'error', message: 'Token necessário pra usar a IA' }); return; }
    setSaveState({ status: 'saving', message: 'IA lendo os nomes dos produtos…' });
    try {
      const dry = await window.NSApi.adminClassifyAi(token, { dryRun: true });
      if (!dry.classified) {
        setSaveState({ status: 'saved', message: dry.message || 'Nenhum produto pendente.' });
        return;
      }
      const sample = dry.proposals.slice(0, 8)
        .map((p) => `• ${p.name} → ${p.family || '?'} / ${p.bottles ?? '?'} potes (${p.confidence})`)
        .join('\n');
      const ok = confirm(
        `A IA classificou ${dry.classified} de ${dry.pending} produtos pendentes.\n\n`
        + `${sample}${dry.proposals.length > 8 ? `\n… +${dry.proposals.length - 8}` : ''}\n\n`
        + 'Aplicar e recalcular COGS+frete em todas as orders afetadas?',
      );
      if (!ok) { setSaveState({ status: 'idle', message: 'Cancelado — nada gravado.' }); return; }
      setSaveState({ status: 'saving', message: 'Aplicando + recalculando snapshots…' });
      const res = await window.NSApi.adminClassifyAi(token, { dryRun: false });
      setSaveState({
        status: 'saved',
        message: `${res.applied} produtos classificados via IA`
          + (res.cogsStats ? ` · ${res.cogsStats.cogsUpdated} COGS atualizados, ${res.cogsStats.sessionsRebalanced} sessões rebalanceadas` : ''),
      });
      reload();
    } catch (err) {
      setSaveState({ status: 'error', message: err.message });
    }
  }

  // Carrega lista de Products pro cadastro (precisa de token). Refaz quando
  // o token muda OU quando o usuário muda os filtros do cadastro.
  async function reloadSupplierList() {
    if (!token) {
      setSupplierList({ status: 'idle', products: [], error: null });
      return;
    }
    setSupplierList((s) => ({ ...s, status: 'loading' }));
    try {
      const res = await window.NSApi.adminListProductSuppliers(token, supplierFilters);
      setSupplierList({ status: 'ready', products: res.products || [], error: null });
    } catch (err) {
      setSupplierList({ status: 'error', products: [], error: err.message });
    }
  }
  useEffect(() => { reloadSupplierList(); }, [
    token, supplierFilters.platform, supplierFilters.family, supplierFilters.search,
  ]);

  // Para um product: valor de override "efetivo" (draft se tocado, senão
  // o atual). null = explicit override removido (herda da família).
  // undefined no draft = sem mudança.
  function supplierFor(p) {
    if (p.id in supplierDrafts) {
      const d = supplierDrafts[p.id];
      // 'inherit' é placeholder de UI pra "herdar família" — vira null no save.
      return d === 'inherit' ? null : d;
    }
    return p.override;
  }
  function supplierEffective(p) {
    const ovr = supplierFor(p);
    if (ovr) return ovr;
    return p.familyDefault ?? 'shipoffers';
  }
  function supplierDirty(p) {
    if (!(p.id in supplierDrafts)) return false;
    const d = supplierDrafts[p.id];
    const cur = p.override;
    const nrm = d === 'inherit' ? null : d;
    return nrm !== cur;
  }
  function supplierDirtyCount() {
    return supplierList.products.filter(supplierDirty).length;
  }
  function setSupplierDraft(productId, value) {
    setSupplierDrafts((d) => ({ ...d, [productId]: value }));
  }
  function discardSupplierDrafts() { setSupplierDrafts({}); }
  async function saveSupplierDrafts() {
    if (!token) {
      setSaveState({ status: 'error', message: 'Token necessário pra salvar SKUs.' });
      return;
    }
    const updates = supplierList.products
      .filter(supplierDirty)
      .map((p) => ({ productId: p.id, supplier: supplierFor(p) }));
    if (updates.length === 0) {
      setSaveState({ status: 'idle', message: 'Sem mudanças no cadastro de SKUs.' });
      return;
    }
    setSaveState({ status: 'saving', message: `Salvando ${updates.length} SKU(s)…` });
    try {
      const res = await window.NSApi.adminUpdateProductSuppliers(token, updates);
      setSaveState({ status: 'saved', message: `${res.updated} SKU(s) salvos.` });
      setSupplierDrafts({});
      reloadSupplierList();
    } catch (err) {
      setSaveState({ status: 'error', message: err.message });
    }
  }

  if (state.status === 'loading' && !state.data) {
    return <SkelTablePage miniKpis={4} chart chartHeight={220} dualTable cols={5} rows={6}/>;
  }
  if (state.status === 'error') {
    return <div className="page-in"><div className="panel" style={{ color: 'var(--danger)' }}>Erro: {state.error}</div></div>;
  }

  const dCount = dirtyCount();
  const skuDCount = supplierDirtyCount();

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">SISTEMA · FULFILLMENT</span>
          <h2>Fulfillment <em>e custo de envio</em></h2>
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

      {/* Distribuição RedRock vs ShipOffers — cards + stacked bar + daily chart */}
      {filters && (
        <>
          <div className="mini-kpis" style={{ marginBottom: 14 }}>
            <div className="mini-kpi">
              <div className="l">Pedidos no período</div>
              <div className="v">
                {fulfDist.status === 'loading' ? '…' : fmtInt(fulfDist.kpis?.totalOrders ?? 0)}
              </div>
              <div className="s">APPROVED · pacotes enviados</div>
            </div>
            {(fulfDist.bySupplier || []).map((s) => {
              const m = supMeta(s.supplier);
              return (
                <div key={s.supplier} className="mini-kpi" style={{
                  borderColor: m.glow,
                  background: `linear-gradient(180deg, ${m.chipBg}, transparent)`,
                  boxShadow: `0 0 24px -8px ${m.glow}, inset 0 1px 0 rgba(255,255,255,0.04)`,
                }}>
                  <div className="l" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                      background: m.solid, boxShadow: `0 0 8px ${m.glow}`,
                    }}/>
                    <span style={{ color: m.text }}>{m.label}</span>
                  </div>
                  <div className="v">{fulfDist.status === 'loading' ? '…' : fmtInt(s.orderCount)}</div>
                  <div className="s">
                    {fulfDist.kpis?.totalOrders > 0
                      ? `${s.pct.toFixed(1)}% do total · ${fmtCurrency(s.fulfillmentUsd, cur, 0)} em frete`
                      : '—'}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Barra horizontal segmentada — split visual RedRock vs ShipOffers */}
          {fulfDist.status === 'ready' && fulfDist.kpis?.totalOrders > 0 && (
            <div className="panel" style={{ marginBottom: 14 }}>
              <div className="panel-head">
                <div className="panel-title">
                  <span className="panel-eyebrow">DISTRIBUIÇÃO POR FORNECEDOR</span>
                  <div className="panel-metric" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                    {(fulfDist.bySupplier || []).filter((s) => s.orderCount > 0).map((s, i) => {
                      const m = supMeta(s.supplier);
                      return (
                        <span key={s.supplier} style={{ display: 'inline-flex', alignItems: 'center', gap: 14 }}>
                          {i > 0 && <span style={{ color: 'var(--fg5)', fontSize: 14 }}>·</span>}
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            <span style={{
                              display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
                              background: m.solid, boxShadow: `0 0 10px ${m.glow}, 0 0 0 2px ${m.chipBg}`,
                            }}/>
                            <span style={{ color: m.text }}>{s.pct.toFixed(1)}%</span>
                            <span style={{ color: 'var(--fg3)', fontFamily: 'var(--f-mono)', fontSize: 13, fontWeight: 500, letterSpacing: '0.04em' }}>{m.label}</span>
                          </span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div style={{
                position: 'relative',
                display: 'flex',
                height: 30,
                borderRadius: 15,
                overflow: 'hidden',
                background: 'rgba(255,255,255,0.03)',
                marginTop: 10,
                // Bevel: inset shadow embaixo + highlight em cima
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 2px rgba(0,0,0,0.4)',
                border: '1px solid rgba(255,255,255,0.05)',
              }}>
                {(fulfDist.bySupplier || []).filter((s) => s.orderCount > 0).map((s) => {
                  const m = supMeta(s.supplier);
                  return (
                    <div key={s.supplier} style={{
                      width: `${s.pct}%`,
                      background: m.grad,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 600, color: m.darkText ? '#0a1820' : '#fff',
                      letterSpacing: '0.04em',
                      textShadow: m.darkText ? 'none' : '0 1px 2px rgba(0,0,0,0.4)',
                      position: 'relative',
                      boxShadow: `inset 0 1px 0 rgba(255,255,255,0.3), 0 0 14px ${m.glow}`,
                    }}>
                      <span style={{
                        position: 'absolute', inset: 0,
                        background: 'linear-gradient(180deg, rgba(255,255,255,0.2), transparent 45%)',
                        pointerEvents: 'none',
                      }}/>
                      <span style={{ position: 'relative', zIndex: 1 }}>
                        {s.pct >= 6 ? `${m.label} · ${fmtInt(s.orderCount)}` : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Daily comparative chart — 2 séries de contagem de pedidos */}
          {fulfDist.status === 'ready' && fulfDist.daily.length > 0 && (
            <div className="panel" style={{ marginBottom: 14 }}>
              <div className="panel-head">
                <div className="panel-title">
                  <span className="panel-eyebrow">PEDIDOS POR DIA · POR FORNECEDOR</span>
                  <div className="panel-metric" style={{ fontSize: 14, color: 'var(--fg3)', fontWeight: 500 }}>
                    {fulfDist.daily.length} {fulfDist.daily.length === 1 ? 'dia' : 'dias'} no intervalo
                  </div>
                </div>
                <div className="panel-legend" style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  {(fulfDist.bySupplier || []).filter((s) => s.orderCount > 0).map((s) => {
                    const m = supMeta(s.supplier);
                    return (
                      <span key={s.supplier} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        fontFamily: 'var(--f-mono)', fontSize: 11, letterSpacing: '0.05em', color: 'var(--fg3)',
                      }}>
                        <span style={{
                          display: 'inline-block', width: 9, height: 9, borderRadius: '50%',
                          background: m.solid, boxShadow: `0 0 8px ${m.glow}, 0 0 0 2px ${m.chipBg}`,
                        }}/>
                        {m.label}
                      </span>
                    );
                  })}
                </div>
              </div>
              <NSTimeSeries height={240} format="int"
                data={(fulfDist.daily || []).map((d) => {
                  const row = { date: d.date };
                  (fulfDist.bySupplier || []).forEach((s) => { row[s.supplier] = (d.counts || {})[s.supplier] || 0; });
                  return row;
                })}
                series={(fulfDist.bySupplier || []).filter((s) => s.orderCount > 0).map((s) => ({
                  key: s.supplier, label: supMeta(s.supplier).label, color: supMeta(s.supplier).solid,
                }))}/>
            </div>
          )}
        </>
      )}

      {/* KPIs de fulfillment no período */}
      {filters && (
        <div className="mini-kpis" style={{ marginBottom: 14 }}>
          <div className="mini-kpi">
            <div className="l">Fulfillment no período</div>
            <div className="v">
              {fulfillmentKpi.status === 'loading' ? '…' : fmtCurrency(fulfillmentKpi.value, cur, 0)}
            </div>
            <div className="s">
              {fulfillmentKpi.gross > 0
                ? `${((fulfillmentKpi.value / fulfillmentKpi.gross) * 100).toFixed(1)}% do gross`
                : (fulfillmentKpi.status === 'ready' ? 'sem vendas no período' : '—')}
            </div>
          </div>
          <div className="mini-kpi">
            <div className="l">Média por dia</div>
            <div className="v">
              {fulfillmentKpi.status === 'loading' ? '…' : fmtCurrency(fulfillmentAvgDay, cur, 0)}
            </div>
            <div className="s">
              {fulfillmentDays > 0 ? `${fulfillmentDays} ${fulfillmentDays === 1 ? 'dia' : 'dias'} no intervalo` : '—'}
            </div>
          </div>
          <div className="mini-kpi">
            <div className="l">Pico diário</div>
            <div className="v">
              {fulfillmentKpi.status === 'loading' ? '…' : fmtCurrency(fulfillmentPeakDay.fulfillment, cur, 0)}
            </div>
            <div className="s">
              {fulfillmentPeakDay.date
                ? fmtDateShort(fulfillmentPeakDay.date)
                : 'sem dados'}
            </div>
          </div>
          {tueEst && (
            <div className="mini-kpi" style={{ borderColor: 'rgba(255,180,0,0.3)' }}>
              <div className="l">Estimativa pra próxima fatura</div>
              <div className="v" style={{ color: 'var(--warning)' }}>{fmtCurrency(tueEst.estimate, cur, 0)}</div>
              <div className="s">
                {tueEst.daysSinceLastTue} {tueEst.daysSinceLastTue === 1 ? 'dia' : 'dias'} desde a última terça · faltam {tueEst.daysToTue} pra próxima · ~{fmtCurrency(tueEst.dailyAvg, cur, 0)}/dia médio
              </div>
            </div>
          )}
        </div>
      )}

      {/* Série diária de frete — gasto exato por dia (snapshot por pedido) */}
      {filters && fulfillmentBuckets.length > 0 && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-head">
            <div className="panel-title">
              <span className="panel-eyebrow">FRETE · GASTO DIÁRIO</span>
              <div className="panel-metric">
                {fmtCurrency(fulfillmentKpi.value, cur, 0)}
                <span className="panel-sub" style={{ marginLeft: 8 }}>
                  total no intervalo · {fmtDateShort(filters.dateRange.start)} → {fmtDateShort(filters.dateRange.end)}
                </span>
              </div>
            </div>
            <div className="panel-legend">
              <span className="legend-dot cyan"><span/>USD / dia</span>
            </div>
          </div>
          <NSTimeSeries data={fulfillmentBuckets} height={220} currency={cur}
            series={[{ key: 'fulfillment', label: 'Frete', color: '#5BC8FF' }]}/>
        </div>
      )}

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

      {/* Custo por pote + fornecedor por família */}
      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-head">
          <div className="panel-title">
            <span className="panel-eyebrow">CUSTO DO POTE + FORNECEDOR · POR FAMÍLIA</span>
            <div className="panel-sub">
              Custo de produção por pote (no fornecedor da família) + quem entrega.
              Funil NeuroMind → RedRock · resto → ShipOffers.
            </div>
          </div>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Família</th>
                <th className="num">Custo / pote (USD)</th>
                <th>Fornecedor</th>
                <th>Atualizado</th>
              </tr>
            </thead>
            <tbody>
              {state.data.families.map((f) => {
                const dirty = familyDirty(f.family);
                return (
                  <tr key={f.family}>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: familyAccent(f.family) }}/>
                        {f.family}
                        {f.isCataloged === false && (
                          <span title="Família ainda não catalogada — usando custo médio como placeholder. Atualize o valor real e salve."
                            style={{
                              fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '0.06em',
                              color: 'var(--warning)', background: 'rgba(255,180,0,0.12)',
                              border: '1px solid rgba(255,180,0,0.35)', borderRadius: 4,
                              padding: '1px 6px',
                            }}>
                            PLACEHOLDER
                          </span>
                        )}
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
                    <td>
                      <select
                        disabled={!token}
                        value={supplierForFamily(f.family)}
                        onChange={(e) => setDraftSuppliers((d) => ({ ...d, [f.family]: e.target.value }))}
                        style={{
                          ...costInputStyle(
                            f.family in draftSuppliers
                              && draftSuppliers[f.family] !== (f.fulfillmentSupplier || 'shipoffers'),
                            !token,
                          ),
                          minWidth: 120,
                        }}
                      >
                        {SUPPLIER_OPTIONS.map((s) => (
                          <option key={s} value={s}>{supMeta(s).label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="cell-mono" style={{ color: 'var(--fg4)' }}>{fmtDateShort(f.updatedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Frete por fornecedor → família → qtd de potes */}
      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-head">
          <div className="panel-title">
            <span className="panel-eyebrow">FRETE · POR FORNECEDOR · FAMÍLIA · QTD DE POTES</span>
            <div className="panel-sub">
              Custo de envio (ship + fee + pick + packaging + paper/fuel), sem o pote.
              Linha "_default" = fallback do fornecedor pra famílias sem tarifa própria.
            </div>
          </div>
        </div>
        <div className="tbl-wrap" style={{ maxHeight: 520, overflowY: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Fornecedor</th>
                <th>Família</th>
                <th className="num">Potes ≤</th>
                <th className="num">Preço (USD)</th>
              </tr>
            </thead>
            <tbody>
              {state.data.fulfillment.map((r) => {
                const key = rateKey(r);
                const dirty = rateDirty(key, r.priceUsd);
                const rm = supMeta(r.supplier);
                return (
                  <tr key={key}>
                    <td className="cell-mono" style={{ fontSize: 11, color: rm.text }}>
                      {rm.label}
                    </td>
                    <td style={{ fontSize: 12, color: r.family === '_default' ? 'var(--fg5)' : 'var(--fg2)' }}>
                      {r.family === '_default' ? '(padrão)' : r.family}
                    </td>
                    <td className="num cell-mono">{r.bottlesMax === 999 ? '7+' : r.bottlesMax}</td>
                    <td className="num">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        disabled={!token}
                        value={valueForRate(key, r.priceUsd)}
                        onChange={(e) => setDraftRates((d) => ({ ...d, [key]: e.target.value }))}
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

      {/* Cobertura de classificação — produtos sem família/potes geram
          COGS+frete = 0. Mostra o gap e oferece o fallback de IA. */}
      <div className="panel" style={{ marginTop: 14 }}>
        <div className="panel-head">
          <div className="panel-title">
            <span className="panel-eyebrow">COBERTURA DE CLASSIFICAÇÃO</span>
            <div className="panel-sub">
              Todo pedido registra nº de potes na ingestão (regex no nome do produto).
              Produtos abaixo NÃO foram reconhecidos → COGS + frete = $0 neles.
              A IA lê o nome e preenche família/potes.
            </div>
          </div>
          <div className="page-head-actions">
            <button
              className="btn btn-primary"
              disabled={saveState.status === 'saving' || (state.data?.unclassified?.length ?? 0) === 0}
              onClick={classifyAi}
              title={!token ? 'Cole o token admin acima e clique Autenticar primeiro' : 'Claude lê os nomes e classifica'}
            >
              <Icon name="zap" size={12}/> Identificar com IA
            </button>
          </div>
        </div>
        {(state.data?.unclassified?.length ?? 0) === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--success)', padding: '6px 2px' }}>
            ✓ Todos os produtos com pedidos estão classificados (potes + família).
          </div>
        ) : (
          <div className="tbl-wrap" style={{ maxHeight: 280, overflowY: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Produto (nome)</th>
                  <th>SKU</th>
                  <th className="num">Família</th>
                  <th className="num">Potes</th>
                  <th className="num">Pedidos afetados</th>
                </tr>
              </thead>
              <tbody>
                {state.data.unclassified.map((p) => (
                  <tr key={p.externalId}>
                    <td style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.name}
                    </td>
                    <td className="cell-mono" style={{ color: 'var(--fg4)', fontSize: 11 }}>{p.externalId}</td>
                    <td className="num cell-mono" style={{ color: p.family ? 'var(--fg2)' : 'var(--danger)' }}>
                      {p.family || '— null —'}
                    </td>
                    <td className="num cell-mono" style={{ color: p.bottles != null ? 'var(--fg2)' : 'var(--danger)' }}>
                      {p.bottles != null ? p.bottles : '— null —'}
                    </td>
                    <td className="num cell-mono">{fmtInt(p.orders)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Cadastro de SKUs por fornecedor — override do supplier por Product.
          Hierarquia: override por SKU > default da família > 'shipoffers'. */}
      {token && (
        <div className="panel" style={{ marginTop: 14 }}>
          <div className="panel-head">
            <div className="panel-title">
              <span className="panel-eyebrow">CADASTRO DE SKUs POR FORNECEDOR</span>
              <div className="panel-sub">
                Override por SKU vence o default da família. "Herda da família"
                volta o SKU pro comportamento padrão (NeuroMindPro/NightCalm/
                FlexImmuneGuard = RedRock; resto = ShipOffers).
              </div>
            </div>
            <div className="page-head-actions">
              {skuDCount > 0 && (
                <button className="btn btn-ghost" onClick={discardSupplierDrafts}>
                  Descartar {skuDCount}
                </button>
              )}
              <button
                className="btn btn-primary"
                disabled={skuDCount === 0 || saveState.status === 'saving'}
                onClick={saveSupplierDrafts}
                style={{ opacity: skuDCount === 0 ? 0.5 : 1 }}
              >
                <Icon name="check" size={12}/> Salvar SKUs {skuDCount > 0 ? `(${skuDCount})` : ''}
              </button>
            </div>
          </div>

          {/* Filtros */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <select
              value={supplierFilters.platform}
              onChange={(e) => setSupplierFilters((f) => ({ ...f, platform: e.target.value }))}
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: 'var(--fg2)', padding: '6px 10px', borderRadius: 6, fontSize: 12,
              }}
            >
              <option value="">Todas plataformas</option>
              <option value="buygoods">BuyGoods</option>
              <option value="clickbank">ClickBank</option>
              <option value="digistore24">Digistore24</option>
            </select>
            <input
              type="text"
              placeholder="Buscar nome ou SKU…"
              value={supplierFilters.search}
              onChange={(e) => setSupplierFilters((f) => ({ ...f, search: e.target.value }))}
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: 'var(--fg2)', padding: '6px 10px', borderRadius: 6, fontSize: 12,
                flex: 1, minWidth: 200,
              }}
            />
            <input
              type="text"
              placeholder="Família (NeuroMindPro, etc)…"
              value={supplierFilters.family}
              onChange={(e) => setSupplierFilters((f) => ({ ...f, family: e.target.value }))}
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: 'var(--fg2)', padding: '6px 10px', borderRadius: 6, fontSize: 12,
                width: 200,
              }}
            />
          </div>

          {/* Tabela */}
          {supplierList.status === 'loading' && (
            <div style={{ padding: 18, color: 'var(--fg5)', fontSize: 12 }}>Carregando…</div>
          )}
          {supplierList.status === 'error' && (
            <div style={{ padding: 18, color: 'var(--danger)', fontSize: 12 }}>
              Erro: {supplierList.error}
            </div>
          )}
          {supplierList.status === 'ready' && supplierList.products.length === 0 && (
            <div style={{ padding: 18, color: 'var(--fg5)', fontSize: 12 }}>
              Nenhum produto bate com os filtros.
            </div>
          )}
          {supplierList.status === 'ready' && supplierList.products.length > 0 && (
            <div style={{ maxHeight: 480, overflow: 'auto', borderRadius: 6 }}>
              <table className="data-table" style={{ width: '100%', fontSize: 12 }}>
                <thead style={{ position: 'sticky', top: 0, background: 'rgba(15,20,28,0.95)', zIndex: 1 }}>
                  <tr>
                    <th style={{ textAlign: 'left' }}>SKU / Produto</th>
                    <th style={{ textAlign: 'left', width: 100 }}>Plataforma</th>
                    <th style={{ textAlign: 'left', width: 130 }}>Família</th>
                    <th style={{ textAlign: 'left', width: 60 }}>Potes</th>
                    <th style={{ textAlign: 'right', width: 70 }}>Pedidos</th>
                    <th style={{ textAlign: 'left', width: 280 }}>Fornecedor</th>
                  </tr>
                </thead>
                <tbody>
                  {supplierList.products.map((p) => {
                    const dirty = supplierDirty(p);
                    const ovr = supplierFor(p);
                    const eff = supplierEffective(p);
                    const choiceVal = ovr === null ? 'inherit' : (ovr || 'inherit');
                    return (
                      <tr key={p.id} style={{ background: dirty ? 'rgba(91,200,255,0.06)' : undefined }}>
                        <td>
                          <div style={{ fontWeight: 500 }}>{p.name}</div>
                          <div style={{ color: 'var(--fg5)', fontSize: 10 }}>{p.externalId}</div>
                        </td>
                        <td style={{ color: 'var(--fg3)' }}>{p.platformName}</td>
                        <td style={{ color: p.family ? 'var(--fg2)' : 'var(--fg5)' }}>
                          {p.family || '—'}
                        </td>
                        <td style={{ color: 'var(--fg3)' }}>{p.bottles ?? '—'}</td>
                        <td style={{ textAlign: 'right', color: 'var(--fg3)' }}>{fmtInt(p.orderCount)}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                            <select
                              value={choiceVal}
                              onChange={(e) => setSupplierDraft(p.id, e.target.value)}
                              style={{
                                background: dirty ? 'rgba(91,200,255,0.12)' : 'rgba(255,255,255,0.04)',
                                border: `1px solid ${dirty ? 'rgba(91,200,255,0.4)' : 'rgba(255,255,255,0.1)'}`,
                                color: 'var(--fg2)', padding: '4px 8px', borderRadius: 4, fontSize: 11,
                                minWidth: 120,
                              }}
                            >
                              <option value="inherit">Herda família ({supMeta(p.familyDefault || 'shipoffers').label})</option>
                              {SUPPLIER_OPTIONS.map((s) => (
                                <option key={s} value={s}>{supMeta(s).label}</option>
                              ))}
                            </select>
                            <span style={{
                              fontSize: 10,
                              padding: '2px 6px',
                              borderRadius: 4,
                              background: supMeta(eff).chipBg,
                              color: supMeta(eff).text,
                              fontWeight: 600,
                              minWidth: 70,
                              textAlign: 'center',
                            }}>
                              {supMeta(eff).label}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Recompute */}
      <div className="panel" style={{ marginTop: 14 }}>
        <div className="panel-head">
          <div className="panel-title">
            <span className="panel-eyebrow">RECLASSIFICAR + RECALCULAR HISTÓRICO</span>
            <div className="panel-sub">
              (1) Reclassifica todos os produtos com o classifier atual — preenche
              família/potes dos BuyGoods e corrige tipo/funil. (2) Reescreve
              cogsUsd + fulfillmentUsd em TODAS as orders com os preços por
              fornecedor. Use após mudar custos OU pra trazer BuyGoods pro cálculo.
            </div>
          </div>
          <div className="page-head-actions">
            <button
              className="btn btn-ghost"
              disabled={saveState.status === 'saving'}
              onClick={recompute}
              title={!token ? 'Cole o token admin no campo acima e clique Autenticar primeiro' : 'Reclassifica produtos + recalcula COGS/frete'}
            >
              <Icon name="refresh" size={12}/> Reclassificar + recalcular orders
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
    return (
      <div className="page-in">
        <SkelPageHead/>
        <div style={{ margin: '2px 2px 16px' }}>
          <LoadingMsg steps={['Computando insights…', 'Analisando lucro & afiliados…', 'Cruzando funil e operação…', 'Quase lá…']} interval={1300}/>
        </div>
        <div className="grid-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="skel-panel anim-in" style={{ '--i': i, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 130 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Skel w={26} h={26} r={8}/><SkelLine w="55%"/></div>
              <SkelLine w="85%"/><SkelLine w="70%"/><SkelLine w="45%" size="sm"/>
            </div>
          ))}
        </div>
      </div>
    );
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

// Abre uma conversa nova no chat pré-carregada com o contexto do insight.
// Navega pra /chat passando ?seed= que o ChatPage detecta.
function discussInsightWithAi(insight) {
  const seed = [
    `Analise esse insight do dashboard com mais profundidade:`,
    ``,
    `**${insight.headline}**`,
    insight.body ? `\n${insight.body}` : '',
    insight.metrics && insight.metrics.length > 0
      ? `\nDados:\n${insight.metrics.map((m) => `- ${m.label}: ${m.value}`).join('\n')}`
      : '',
    ``,
    `O que isso significa? Quais ações concretas você recomenda?`,
  ].filter(Boolean).join('\n');
  // sessionStorage pra preservar entre o navigate e o mount do /chat
  sessionStorage.setItem('ns-chat-seed', seed);
  location.href = '/chat';
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
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'flex-start' }}>
          <button
            onClick={() => discussInsightWithAi(insight)}
            className="btn btn-ghost"
            title="Discutir esse insight com a IA"
            style={{ fontSize: 11 }}
          >
            <Icon name="sparkles" size={11}/> Discutir com IA
          </button>
          {insight.cta && (
            <button onClick={onCta} className="btn btn-ghost" style={{ fontSize: 11 }}>
              {insight.cta.label} <Icon name="chevron-right" size={11}/>
            </button>
          )}
        </div>
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
              {state.status === 'loading' && <SkelTableRows rows={8} cols={8}/>}
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
                  <td><span className={`plat ${platBadge(a.platformSlug).cls}`}>{platBadge(a.platformSlug).short}</span></td>
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
            {data.status === 'loading' && <SkelTableRows rows={4} cols={7}/>}
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
            {data.status === 'loading' && <SkelTableRows rows={4} cols={7}/>}
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
                          {platBadge(a.platformSlug).short} · {a.externalId} · {fmtInt(a.ordersCount)} pedidos
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
    return <SkelDrawerLoading steps={['Carregando contrato…']}/>;
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
                    <td><span className={`plat ${platBadge(a.platformSlug).cls}`}>{platBadge(a.platformSlug).short}</span></td>
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

// ==========================================================================
// AI CHAT — análise via Anthropic. Admin-only. Tool-use loop streamado
// via SSE. Histórico persistido em Conversation + Message.
//
// Dois entry points (escolha do usuário "ambos"):
//   - ChatPage: /chat → full page (sidebar de conversas + área principal)
//   - ChatWidget: botão flutuante bottom-right em qualquer página
//
// Componente interno ChatBody é compartilhado entre os dois.
// ==========================================================================

function ChatPage({ user }) {
  const [conversations, setConversations] = useState({ status: 'loading', list: [] });
  const [selectedId, setSelectedId] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // Seed vindo do "Discutir com IA" em /insights. Lê uma vez e limpa.
  const [seedMessage, setSeedMessage] = useState(() => {
    try {
      const s = sessionStorage.getItem('ns-chat-seed');
      if (s) sessionStorage.removeItem('ns-chat-seed');
      return s;
    } catch { return null; }
  });

  useEffect(() => {
    let cancelled = false;
    window.NSApi.aiListConversations()
      .then((data) => { if (!cancelled) setConversations({ status: 'ready', list: data.conversations || [] }); })
      .catch(() => { if (!cancelled) setConversations({ status: 'error', list: [] }); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  async function deleteConv(id) {
    if (!confirm('Deletar essa conversa? Mensagens vão junto.')) return;
    try {
      await window.NSApi.aiDeleteConversation(id);
      if (selectedId === id) setSelectedId(null);
      setRefreshKey((n) => n + 1);
    } catch (err) {
      alert('Erro: ' + err.message);
    }
  }

  return (
    <div className="page-in" style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 14, height: 'calc(100vh - 200px)', minHeight: 540 }}>
      <div className="panel" style={{ padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-soft)' }}>
          <button
            onClick={() => setSelectedId(null)}
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center' }}
          >
            <Icon name="plus" size={11}/> Nova conversa
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
          {conversations.status === 'loading' && (
            <div style={{ padding: 12, fontSize: 11, color: 'var(--fg5)' }}>Carregando...</div>
          )}
          {conversations.status === 'ready' && conversations.list.length === 0 && (
            <div style={{ padding: 12, fontSize: 11, color: 'var(--fg5)' }}>Nenhuma conversa ainda. Faça uma pergunta pra começar.</div>
          )}
          {conversations.list.map((c) => (
            <div
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              style={{
                padding: '8px 14px', cursor: 'pointer',
                background: selectedId === c.id ? 'rgba(91,200,255,0.08)' : 'transparent',
                borderLeft: selectedId === c.id ? '2px solid var(--glow-cyan)' : '2px solid transparent',
                display: 'flex', gap: 8, alignItems: 'flex-start',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--fg1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {c.title || '(sem título)'}
                </div>
                <div style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--fg5)' }}>
                  {c.messageCount} msg · {fmtRelativeShort(c.updatedAt)}
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); deleteConv(c.id); }}
                title="Deletar"
                style={{
                  background: 'transparent', border: 0, cursor: 'pointer',
                  color: 'var(--fg5)', padding: 2, opacity: 0.5,
                }}
              >
                <Icon name="trash" size={10}/>
              </button>
            </div>
          ))}
        </div>
      </div>
      <ChatBody
        conversationId={selectedId}
        onConversationCreated={(id) => { setSelectedId(id); setRefreshKey((n) => n + 1); }}
        onMessageSent={() => setRefreshKey((n) => n + 1)}
        seedMessage={seedMessage}
        onSeedConsumed={() => setSeedMessage(null)}
      />
    </div>
  );
}

function ChatWidget({ user }) {
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState(null);

  if (!user || user.role !== 'ADMIN') return null;

  return (
    <>
      {/* Botão flutuante */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          title="Análise com IA"
          style={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 1000,
            width: 52, height: 52, borderRadius: '50%',
            background: 'linear-gradient(135deg, #5BC8FF 0%, #9B7BFF 100%)',
            border: 0, cursor: 'pointer',
            boxShadow: '0 8px 20px -4px rgba(91,200,255,0.4)',
            display: 'grid', placeItems: 'center',
            color: '#0A1638',
          }}
        >
          <Icon name="sparkles" size={20}/>
        </button>
      )}
      {open && ReactDOM.createPortal((
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 1000,
          width: 420, height: 600, maxHeight: 'calc(100vh - 48px)',
          display: 'flex', flexDirection: 'column',
          background: 'linear-gradient(180deg, #15275A 0%, #0F1F4D 50%, #0A1638 100%)',
          border: '1px solid var(--border-strong)',
          borderRadius: 12, overflow: 'hidden',
          boxShadow: '0 30px 80px -10px rgba(0,0,0,0.6)',
        }}>
          <div style={{
            padding: '10px 14px', borderBottom: '1px solid var(--border-soft)',
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'rgba(91,200,255,0.04)',
          }}>
            <Icon name="sparkles" size={14} className=""/>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--fg4)' }}>ANÁLISE COM IA</div>
              <div style={{ fontSize: 11, color: 'var(--fg5)' }}>Especialista em analytics nutra DR</div>
            </div>
            <a
              href="/chat"
              title="Abrir em página inteira"
              style={{ color: 'var(--fg4)', padding: 4, textDecoration: 'none' }}
            >
              <Icon name="external-link" size={12}/>
            </a>
            <button onClick={() => setOpen(false)} className="icon-btn" title="Fechar"><Icon name="x" size={12}/></button>
          </div>
          <ChatBody
            conversationId={conversationId}
            onConversationCreated={setConversationId}
            compact
          />
        </div>
      ), document.body)}
    </>
  );
}

function ChatBody({ conversationId, onConversationCreated, onMessageSent, compact, seedMessage, onSeedConsumed }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [currentReply, setCurrentReply] = useState('');
  const [currentTools, setCurrentTools] = useState([]);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);

  // Seed (do insights → "Discutir com IA"): pré-popula input + foco.
  useEffect(() => {
    if (seedMessage && !conversationId && messages.length === 0) {
      setInput(seedMessage);
      onSeedConsumed?.();
    }
  }, [seedMessage, conversationId]);

  // Load messages quando muda conversationId
  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      setCurrentReply('');
      setCurrentTools([]);
      return;
    }
    let cancelled = false;
    window.NSApi.aiGetConversation(conversationId)
      .then((data) => { if (!cancelled) setMessages(data.messages || []); })
      .catch(() => { if (!cancelled) setMessages([]); });
    return () => { cancelled = true; };
  }, [conversationId]);

  // Auto-scroll pro fim
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, currentReply, currentTools]);

  async function send() {
    const msg = input.trim();
    if (!msg || streaming) return;
    setInput('');
    setStreaming(true);
    setError(null);
    setCurrentReply('');
    setCurrentTools([]);

    // Push user message localmente
    const userMessage = { id: 'tmp-' + Date.now(), role: 'user', content: msg, createdAt: new Date().toISOString() };
    setMessages((prev) => [...prev, userMessage]);

    let newConvId = conversationId;
    try {
      await window.NSApi.aiSendMessage(
        { conversationId, message: msg },
        {
          onConversation: ({ id }) => {
            if (!conversationId) {
              newConvId = id;
              onConversationCreated?.(id);
            }
          },
          onToken: ({ text }) => setCurrentReply((prev) => prev + text),
          onToolUse: ({ name }) => setCurrentTools((prev) => [...prev, { name, state: 'running' }]),
          onToolUseResult: ({ name }) => setCurrentTools((prev) => prev.map((t) =>
            t.name === name && t.state === 'running' ? { ...t, state: 'done' } : t,
          )),
          onError: ({ message }) => setError(message),
        },
      );
      // Push assistant message final
      setMessages((prev) => {
        // Refetch full state poderia ser mais limpo, mas evitamos extra round-trip.
        return [...prev, {
          id: 'tmp-a-' + Date.now(),
          role: 'assistant',
          content: '', // será substituído pela próxima refetch se houver
          createdAt: new Date().toISOString(),
        }];
      });
      onMessageSent?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setStreaming(false);
      // Limpa estado de streaming. Mensagem foi salva no DB.
      // Recarrega histórico pra pegar versão persistida.
      if (newConvId) {
        try {
          const data = await window.NSApi.aiGetConversation(newConvId);
          setMessages(data.messages || []);
        } catch { /* mantém otimista */ }
      }
      setCurrentReply('');
      setCurrentTools([]);
    }
  }

  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0,
      background: 'var(--surface, transparent)',
    }} className={compact ? '' : 'panel'}>
      <div
        ref={scrollRef}
        style={{
          flex: 1, overflowY: 'auto',
          padding: compact ? '12px 14px' : '18px 22px',
          display: 'flex', flexDirection: 'column', gap: 12,
        }}
      >
        {messages.length === 0 && !streaming && (
          <div style={{ color: 'var(--fg5)', fontSize: 13, padding: '24px 0', textAlign: 'center' }}>
            <Icon name="sparkles" size={18}/>
            <div style={{ marginTop: 8 }}>Pergunte o que quiser sobre os dados do dashboard.</div>
            <div style={{ marginTop: 12, display: 'grid', gap: 6, fontSize: 11, color: 'var(--fg4)' }}>
              <div>Ex: "Compara receita dessa semana com a semana passada"</div>
              <div>Ex: "Por que a margem do NeuroMind caiu?"</div>
              <div>Ex: "Top 3 afiliados com pior refund rate"</div>
            </div>
          </div>
        )}
        {messages.map((m) => (
          <ChatMessage key={m.id} message={m} compact={compact}/>
        ))}
        {streaming && (
          <div>
            {currentTools.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {currentTools.map((t, i) => (
                  <span key={i} style={{
                    fontFamily: 'var(--f-mono)', fontSize: 10,
                    padding: '2px 8px', borderRadius: 4,
                    background: t.state === 'done' ? 'rgba(40,200,120,0.1)' : 'rgba(91,200,255,0.1)',
                    color: t.state === 'done' ? 'var(--success)' : 'var(--glow-cyan)',
                    border: `1px solid ${t.state === 'done' ? 'rgba(40,200,120,0.3)' : 'rgba(91,200,255,0.3)'}`,
                  }}>
                    {t.state === 'done' ? '✓' : '⋯'} {t.name}
                  </span>
                ))}
              </div>
            )}
            {currentReply && (
              <ChatMessage
                message={{ role: 'assistant', content: currentReply, createdAt: new Date().toISOString() }}
                compact={compact}
                streaming
              />
            )}
            {!currentReply && currentTools.length === 0 && (
              <div style={{ color: 'var(--fg5)', fontSize: 12 }}>Pensando...</div>
            )}
          </div>
        )}
        {error && (
          <div style={{ color: 'var(--danger)', fontSize: 12, background: 'rgba(239,68,68,0.06)', padding: 10, borderRadius: 6 }}>
            Erro: {error}
          </div>
        )}
      </div>
      <div style={{
        padding: compact ? '10px 12px' : '14px 18px',
        borderTop: '1px solid var(--border-soft)',
        display: 'flex', gap: 8,
        background: 'rgba(91,200,255,0.02)',
      }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder="Pergunte algo sobre seus dados..."
          rows={compact ? 2 : 3}
          disabled={streaming}
          style={{
            flex: 1, resize: 'none', padding: '8px 10px',
            fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--fg1)',
            background: 'rgba(91,200,255,0.05)',
            border: '1px solid rgba(91,200,255,0.2)', borderRadius: 6,
            outline: 'none',
          }}
        />
        <button
          onClick={send}
          disabled={streaming || !input.trim()}
          className="btn btn-primary"
          style={{ alignSelf: 'flex-end', opacity: streaming || !input.trim() ? 0.5 : 1 }}
        >
          <Icon name={streaming ? 'loader' : 'send'} size={12}/>
        </button>
      </div>
    </div>
  );
}

// Renderiza markdown da resposta da IA usando marked + DOMPurify (loaded
// via CDN no index.html). Fallback pra texto plain se libs não carregaram.
// User messages NÃO viram markdown — preserva exatamente o que o user
// digitou (incluindo asteriscos literais, etc).
function renderMarkdown(text) {
  if (!text) return '';
  if (typeof window === 'undefined' || !window.marked || !window.DOMPurify) {
    return null; // caller renderiza como text plain
  }
  try {
    const raw = window.marked.parse(text, { gfm: true, breaks: true });
    return window.DOMPurify.sanitize(raw, {
      ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li',
                     'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                     'blockquote', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
                     'hr', 'span', 'div'],
      ALLOWED_ATTR: ['href', 'title', 'target', 'rel'],
    });
  } catch {
    return null;
  }
}

function ChatMessage({ message, compact, streaming }) {
  const isUser = message.role === 'user';
  const mdHtml = !isUser ? renderMarkdown(message.content) : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
      <div
        className={!isUser ? 'chat-md' : ''}
        style={{
          maxWidth: '85%',
          padding: '8px 12px', borderRadius: 8,
          background: isUser ? 'rgba(91,200,255,0.10)' : 'rgba(255,255,255,0.03)',
          border: `1px solid ${isUser ? 'rgba(91,200,255,0.25)' : 'var(--border-soft)'}`,
          fontSize: compact ? 12 : 13, color: 'var(--fg1)',
          wordBreak: 'break-word', lineHeight: 1.5,
          whiteSpace: isUser ? 'pre-wrap' : 'normal',
        }}
        {...(mdHtml ? { dangerouslySetInnerHTML: { __html: mdHtml } } : {})}
      >
        {mdHtml ? null : (message.content || (streaming ? '...' : '(vazio)'))}
      </div>
      {message.toolUses && Array.isArray(message.toolUses) && message.toolUses.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
          {message.toolUses.map((t, i) => (
            <span key={i} style={{
              fontFamily: 'var(--f-mono)', fontSize: 9,
              padding: '1px 6px', borderRadius: 3,
              background: 'rgba(40,200,120,0.08)', color: 'var(--success)',
              border: '1px solid rgba(40,200,120,0.2)',
            }}>
              ✓ {t.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Copy Optimizer — Painel A: CRUD das regras de exposição da copy Black 2
// (Upsell01 BuyGoods). Admin-only. Decisão real roda server-side; aqui só
// editamos % por afiliado. Mudança reflete na hora (cache 60s invalidado).
// ═══════════════════════════════════════════════════════════════════

const coInputStyle = {
  width: '100%', padding: '8px 10px',
  background: 'rgba(91,200,255,0.05)', border: '1px solid rgba(91,200,255,0.20)',
  borderRadius: 6, color: 'var(--fg1)', fontFamily: 'var(--f-mono)', fontSize: 13, outline: 'none',
};
const coFieldLabel = { display: 'grid', gap: 4, fontSize: 11, color: 'var(--fg3)' };

function CopyToggle({ on, onChange, disabled }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!on)}
      aria-pressed={on}
      title={on ? 'Ativo' : 'Inativo'}
      style={{
        width: 34, height: 18, borderRadius: 9, border: '1px solid var(--border)',
        background: on ? 'rgba(91,200,255,0.30)' : 'rgba(255,255,255,0.05)',
        position: 'relative', cursor: disabled ? 'default' : 'pointer', padding: 0,
        transition: 'background 150ms', opacity: disabled ? 0.6 : 1,
      }}
    >
      <span style={{
        position: 'absolute', top: 1, left: on ? 17 : 1, width: 14, height: 14, borderRadius: '50%',
        background: on ? 'var(--glow-cyan)' : 'var(--fg4)', transition: 'left 150ms',
      }}/>
    </button>
  );
}

function CopyRuleRow({ rule, onChanged }) {
  const [pct, setPct] = useState(rule.black2Pct);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const timer = useRef(null);

  // Re-sincroniza se o parent recarregar com valor novo (ex: auto-tune mexeu).
  useEffect(() => { setPct(rule.black2Pct); }, [rule.black2Pct]);

  async function patch(body) {
    setSaving(true); setErr(null);
    try { await window.NSApi.patchCopyRule(rule.id, body); onChanged(); }
    catch (e) { setErr(e.message || 'erro'); }
    finally { setSaving(false); }
  }

  function onSlide(v) {
    setPct(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => patch({ black2Pct: v }), 450);
  }

  async function remove() {
    if (!window.confirm(`Remover a regra "${rule.key}"? O histórico de auto-tune também é apagado.`)) return;
    setSaving(true); setErr(null);
    try { await window.NSApi.deleteCopyRule(rule.id); onChanged(); }
    catch (e) { setErr(e.message || 'erro'); setSaving(false); }
  }

  return (
    <tr style={{ opacity: rule.enabled ? 1 : 0.5 }}>
      <td className="cell-mono">{rule.key}</td>
      <td><span className="badge neutral">{rule.keyType === 'id' ? 'aff_id' : 'aff_name'}</span></td>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="range" min={0} max={100} step={5} value={pct}
            disabled={saving}
            onChange={(e) => onSlide(Number(e.target.value))}
            style={{ flex: 1, accentColor: 'var(--glow-cyan)' }}
          />
          <span className="cell-mono" style={{ width: 38, textAlign: 'right', color: pct > 0 ? 'var(--glow-cyan)' : 'var(--fg5)' }}>{pct}%</span>
        </div>
        {err && <div style={{ color: 'var(--danger)', fontSize: 10, marginTop: 2 }}>{err}</div>}
      </td>
      <td><CopyToggle on={rule.autotune} disabled={saving} onChange={(v) => patch({ autotune: v })}/></td>
      <td><CopyToggle on={rule.enabled} disabled={saving} onChange={(v) => patch({ enabled: v })}/></td>
      <td className="cell-mono" style={{ fontSize: 10, color: 'var(--fg5)' }}>{rule.updatedBy}</td>
      <td style={{ textAlign: 'right' }}>
        <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={remove} disabled={saving} title="Remover regra">
          <Icon name="trash-2" size={12}/>
        </button>
      </td>
    </tr>
  );
}

function CopyRuleCreateForm({ onClose, onSaved }) {
  const [key, setKey] = useState('');
  const [keyType, setKeyType] = useState('id');
  const [pct, setPct] = useState(50);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function submit() {
    if (!key.trim()) { setErr('Informe o aff_id ou aff_name.'); return; }
    setSaving(true); setErr(null);
    try {
      await window.NSApi.createCopyRule({ key: key.trim(), keyType, black2Pct: pct });
      onSaved();
    } catch (e) { setErr(e.message || 'erro'); setSaving(false); }
  }

  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div className="panel-head">
        <div className="panel-title">Nova regra</div>
        <button className="btn btn-ghost" onClick={onClose} style={{ padding: '4px 8px' }}><Icon name="x" size={12}/></button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 10, alignItems: 'end', marginTop: 10 }}>
        <label style={coFieldLabel}>
          <span>aff_id ou aff_name</span>
          <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="46 ou Matheus Petersen" style={coInputStyle}/>
        </label>
        <label style={coFieldLabel}>
          <span>Tipo</span>
          <select value={keyType} onChange={(e) => setKeyType(e.target.value)} style={coInputStyle}>
            <option value="id">aff_id</option>
            <option value="name">aff_name</option>
          </select>
        </label>
        <label style={coFieldLabel}>
          <span>% Black 2</span>
          <input type="number" min={0} max={100} value={pct} onChange={(e) => setPct(Number(e.target.value))} style={coInputStyle}/>
        </label>
        <button className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? 'Salvando…' : 'Criar'}</button>
      </div>
      <div style={{ marginTop: 8, fontSize: 10, color: 'var(--fg5)' }}>
        Dica: prefira <b>aff_id</b> — o aff_name do BuyGoods às vezes vem com espaço duplo e não casa por nome.
      </div>
      {err && <div style={{ color: 'var(--danger)', fontSize: 11, marginTop: 6 }}>{err}</div>}
    </div>
  );
}

function CopyKpi({ label, value, sub, tone }) {
  const color = tone === 'danger' ? 'var(--danger)' : tone === 'ok' ? 'var(--success)' : 'var(--fg1)';
  return (
    <div className="panel" style={{ padding: '12px 14px' }}>
      <div className="eyebrow" style={{ fontSize: 9 }}>{label}</div>
      <div style={{ fontFamily: 'var(--f-display)', fontSize: 24, fontWeight: 600, color, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--fg5)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// AOV diário com linha de target — NSTimeSeries com refLine.
function CopyAovLine({ daily, target }) {
  if (!daily || daily.length === 0) return <div style={{ padding: 20, color: 'var(--fg5)', fontSize: 12 }}>Sem série diária ainda.</div>;
  return (
    <NSTimeSeries
      data={daily.map((d) => ({ date: d.date, aov: d.aov }))}
      series={[{ key: 'aov', label: 'AOV', color: '#5BC8FF', format: 'money2' }]}
      height={150} brush={false}
      refLines={[{ y: target, label: `target ${fmtCurrency(target, 'USD', 0)}`, color: 'var(--warning)' }]}
    />
  );
}

// Card de previsão de ETA até a meta de AOV (tendência da série diária).
function CopyForecastCard({ forecast }) {
  const f = forecast;
  if (!f) return null;
  let icon = 'arrow-up-right', color = 'var(--glow-cyan)', title = '', detail = '';
  if (f.status === 'insufficient') {
    icon = 'calendar'; color = 'var(--fg4)';
    title = 'Previsão indisponível';
    detail = `Só ${f.daysOfData} dia(s) de dado no período — precisa de ≥3 pra estimar a tendência. Aguarde acumular ou amplie o período.`;
  } else if (f.status === 'reached') {
    icon = 'sparkles'; color = 'var(--success)';
    title = `Meta de ${fmtCurrency(f.target, 'USD', 0)} já atingida`;
    detail = `O AOV no ritmo da tendência está em ${fmtCurrency(f.currentAov, 'USD', 2)}.`;
  } else if (f.status === 'flat') {
    icon = 'alert-triangle'; color = 'var(--warning)';
    title = 'Sem previsão — AOV estável';
    detail = `No ritmo atual o AOV (${fmtCurrency(f.currentAov, 'USD', 2)}) não sobe (${f.slopePerDay >= 0 ? '+' : ''}${fmtCurrency(f.slopePerDay, 'USD', 2)}/dia). Suba o % de Black 2 ou ligue auto-tune pra começar a empurrar.`;
  } else {
    const eta = new Date(Date.now() + f.daysToTarget * 86400000);
    const etaStr = eta.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
    title = `≈ ${f.daysToTarget} dias até ${fmtCurrency(f.target, 'USD', 0)}`;
    detail = `No ritmo de +${fmtCurrency(f.slopePerDay, 'USD', 2)}/dia, partindo de ${fmtCurrency(f.currentAov, 'USD', 2)} → meta por volta de ${etaStr}. Volume médio: ${fmtInt(f.avgDailyViews)} views/dia.`;
  }
  return (
    <div className="panel" style={{ marginBottom: 12, borderColor: color, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <Icon name={icon} size={18}/>
      <div>
        <div className="eyebrow" style={{ fontSize: 9 }}>PREVISÃO ATÉ A META</div>
        <div style={{ fontWeight: 600, fontSize: 15, color, marginTop: 2 }}>{title}</div>
        <div style={{ fontSize: 11, color: 'var(--fg4)', marginTop: 3, lineHeight: 1.5 }}>{detail}</div>
        <div style={{ fontSize: 9, color: 'var(--fg5)', marginTop: 5, fontFamily: 'var(--f-mono)' }}>Extrapolação linear "no ritmo atual" sobre o período selecionado — estimativa, não garantia.</div>
      </div>
    </div>
  );
}

// Form inline pra aplicar uma regra a TODOS os afiliados BuyGoods de uma vez.
function CopyApplyAllForm({ onClose, onApplied }) {
  const [pct, setPct] = useState(30);
  const [autotune, setAutotune] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function apply() {
    if (!window.confirm(`Criar regra pra todos os afiliados que ainda não têm, a ${pct}% de Black 2${autotune ? ' com auto-tune ligado' : ''}? Regras existentes não são alteradas.`)) return;
    setBusy(true); setMsg(null);
    try {
      const r = await window.NSApi.applyCopyRulesToAll({ black2Pct: Number(pct), autotune });
      setMsg(`${r.created} criadas · ${r.skipped} já existiam · ${r.total} afiliados no total.`);
      onApplied();
    } catch (e) { setMsg('Erro: ' + (e.message || 'falha')); }
    finally { setBusy(false); }
  }

  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div className="panel-head">
        <div className="panel-title">Aplicar a todos os afiliados</div>
        <button className="btn btn-ghost" onClick={onClose} style={{ padding: '4px 8px' }}><Icon name="x" size={12}/></button>
      </div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'end', marginTop: 10, flexWrap: 'wrap' }}>
        <label style={coFieldLabel}><span>% Black 2 inicial</span>
          <input type="number" min={0} max={100} value={pct} onChange={(e) => setPct(e.target.value)} style={{ ...coInputStyle, width: 120 }}/>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--fg2)', cursor: 'pointer' }}>
          <CopyToggle on={autotune} onChange={setAutotune}/> Já ligar auto-tune
        </label>
        <button className="btn btn-primary" onClick={apply} disabled={busy}>{busy ? 'Aplicando…' : 'Aplicar a todos'}</button>
      </div>
      <div style={{ marginTop: 8, fontSize: 10, color: 'var(--fg5)' }}>
        Cria uma regra (por <b>aff_id</b>) pra cada afiliado BuyGoods <b>sem regra</b>. Regras já existentes ficam intactas. Com auto-tune ligado, o robô passa a balancear o % de cada um perseguindo o target de AOV.
      </div>
      {msg && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--fg3)' }}>{msg}</div>}
    </div>
  );
}

// ---------- Painel A — Regras ----------
function CopyRulesPanel() {
  const [state, setState] = useState({ status: 'loading', rules: [], error: null });
  const [refresh, setRefresh] = useState(0);
  const [creating, setCreating] = useState(false);
  const [applyAll, setApplyAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading' }));
    window.NSApi.fetchCopyRules()
      .then((data) => { if (!cancelled) setState({ status: 'ready', rules: data.rules || [], error: null }); })
      .catch((err) => { if (!cancelled) setState({ status: 'error', rules: [], error: err.message || 'erro' }); });
    return () => { cancelled = true; };
  }, [refresh]);
  function reload() { setRefresh((n) => n + 1); }

  const rules = state.rules;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: 'var(--fg5)' }}>{rules.length} regras · {rules.filter((r) => r.enabled).length} ativas · {rules.filter((r) => r.autotune).length} em auto-tune</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={reload}><Icon name="refresh" size={12}/> Recarregar</button>
          <button className="btn btn-ghost" onClick={() => setApplyAll((v) => !v)}><Icon name="users" size={12}/> Aplicar a todos</button>
          <button className="btn btn-primary" onClick={() => setCreating((v) => !v)}><Icon name="plus" size={12}/> Nova regra</button>
        </div>
      </div>
      {state.status === 'error' && <div className="panel" style={{ color: 'var(--danger)', marginBottom: 12 }}>Erro: {state.error}</div>}
      {applyAll && <CopyApplyAllForm onClose={() => setApplyAll(false)} onApplied={reload}/>}
      {creating && <CopyRuleCreateForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload(); }}/>}
      <div className="panel" style={{ padding: 0 }}>
        <div className="tbl-wrap" style={{ margin: 0, padding: '0 4px' }}>
          <table className="tbl">
            <thead><tr><th>Afiliado</th><th>Tipo</th><th style={{ width: 240 }}>% Black 2</th><th>Auto-tune</th><th>Status</th><th>Última</th><th></th></tr></thead>
            <tbody>
              {state.status === 'loading' && <SkelTableRows rows={6} cols={7}/>}
              {state.status === 'ready' && rules.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, opacity: 0.6 }}>Nenhuma regra ainda. Crie a primeira.</td></tr>}
              {rules.map((r) => <CopyRuleRow key={r.id} rule={r} onChanged={reload}/>)}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ marginTop: 10, fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg5)', lineHeight: 1.6 }}>
        Decisão server-side · match por <b>aff_id</b> ou <b>aff_name</b> (verbatim, mais inclusivo vence) · bucket sticky djb2 · Black 2 só com email válido · pausar = % vira 0.
      </div>
    </div>
  );
}

// ---------- Painel C — Observabilidade ----------
const CO_PERIODS = [['1h', '1h'], ['24h', '24h'], ['7d', '7 dias'], ['30d', '30 dias']];
function pctCell(s) { return s ? fmtPct(s.conv) : '—'; }

function CopyObservabilityPanel() {
  const [period, setPeriod] = useState('24h');
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading' }));
    window.NSApi.fetchCopyFunnel({ period })
      .then((data) => { if (!cancelled) setState({ status: 'ready', data, error: null }); })
      .catch((err) => { if (!cancelled) setState({ status: 'error', data: null, error: err.message || 'erro' }); });
    return () => { cancelled = true; };
  }, [period, tick]);

  const d = state.data;
  const empty = d && d.summary.totalViews === 0;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {CO_PERIODS.map(([id, label]) => (
            <button key={id} className={`chip ${period === id ? 'is-active' : ''}`} onClick={() => setPeriod(id)}>{label}</button>
          ))}
        </div>
        <button className="btn btn-ghost" onClick={() => setTick((t) => t + 1)}><Icon name="refresh" size={12}/> Atualizar</button>
      </div>

      {state.status === 'error' && <div className="panel" style={{ color: 'var(--danger)' }}>Erro: {state.error}</div>}
      {state.status === 'loading' && <SkelInline steps={['Carregando regras de copy…']} height={120}/>}
      {empty && <div className="panel" style={{ opacity: 0.7 }}>Nenhuma view registrada nesse período. A <b>CopyView</b> popula após o cutover do renderer.</div>}

      {d && !empty && (
        <>
          <div className="grid-2" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 12 }}>
            <CopyKpi label="AOV NO PERÍODO" value={fmtCurrency(d.summary.aovOverall, 'USD', 2)}/>
            <CopyKpi label="VIEWS" value={fmtInt(d.summary.totalViews)}/>
            <CopyKpi label="CONVERSÃO" value={fmtPct(d.summary.convOverall)}/>
            <CopyKpi label={`GAP vs ${fmtCurrency(d.summary.aovTarget, 'USD', 0)}`} value={(d.summary.aovGap >= 0 ? '+' : '') + fmtCurrency(d.summary.aovGap, 'USD', 2)} tone={d.summary.aovGap < 0 ? 'danger' : 'ok'}/>
          </div>

          <CopyForecastCard forecast={d.forecast}/>

          <div className="grid-2" style={{ gridTemplateColumns: '1.4fr 1fr', marginBottom: 12 }}>
            <div className="panel">
              <div className="panel-head"><div className="panel-title">AOV diário</div></div>
              <CopyAovLine daily={d.daily} target={d.summary.aovTarget}/>
            </div>
            <div className="panel">
              <div className="panel-head"><div className="panel-title">Distribuição por layer</div></div>
              <Donut items={[
                { label: 'Black 1', value: d.summary.byLayer.black1 || 0, color: '#a8b7d8' },
                { label: 'Black 2', value: d.summary.byLayer.black2 || 0, color: '#5BC8FF' },
                { label: 'White', value: d.summary.byLayer.white || 0, color: '#8B7FFF' },
              ]} totalLabel="views" format={(v) => fmtInt(v)}/>
            </div>
          </div>

          <div className="panel" style={{ padding: 0, marginBottom: 12 }}>
            <div className="panel-head" style={{ padding: '12px 14px 0' }}><div className="panel-title">Performance por stage</div></div>
            <div className="tbl-wrap" style={{ margin: 0, padding: '0 4px' }}>
              <table className="tbl">
                <thead><tr><th>Stage</th><th>Produto</th><th className="num">Views</th><th className="num">B1 conv</th><th className="num">B2 conv</th><th className="num">Lift</th></tr></thead>
                <tbody>
                  {d.byStage.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 16, opacity: 0.6 }}>Sem dados por stage.</td></tr>}
                  {d.byStage.map((s) => (
                    <tr key={s.stage}>
                      <td className="cell-mono">{s.stage}</td>
                      <td className="cell-mono" style={{ color: 'var(--fg5)' }}>{s.product || '—'}</td>
                      <td className="num">{fmtInt(s.nViews)}</td>
                      <td className="num">{pctCell(s.byLayer.black1)}</td>
                      <td className="num">{pctCell(s.byLayer.black2)}</td>
                      <td className="num" style={{ color: s.liftPp == null ? 'var(--fg5)' : s.liftPp >= 0 ? 'var(--success)' : 'var(--danger)' }}>{s.liftPp == null ? '—' : `${s.liftPp >= 0 ? '+' : ''}${s.liftPp}pp`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel" style={{ padding: 0 }}>
            <div className="panel-head" style={{ padding: '12px 14px 0' }}><div className="panel-title">Performance por afiliado</div></div>
            <div className="tbl-wrap" style={{ margin: 0, padding: '0 4px' }}>
              <table className="tbl">
                <thead><tr><th>Afiliado</th><th className="num">Leads</th><th className="num">B1 conv</th><th className="num">B2 conv</th><th className="num">Lift</th><th className="num">% atual</th></tr></thead>
                <tbody>
                  {d.byAffiliate.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 16, opacity: 0.6 }}>Sem afiliados com amostra ≥5.</td></tr>}
                  {d.byAffiliate.map((a) => (
                    <tr key={a.key}>
                      <td className="cell-mono">{a.key}{a.nLeads < 30 && <span className="badge neutral" style={{ marginLeft: 6, fontSize: 8 }}>amostra baixa</span>}</td>
                      <td className="num">{fmtInt(a.nLeads)}</td>
                      <td className="num">{pctCell(a.byLayer.black1)}</td>
                      <td className="num">{pctCell(a.byLayer.black2)}</td>
                      <td className="num" style={{ color: a.liftPp == null ? 'var(--fg5)' : a.liftPp >= 0 ? 'var(--success)' : 'var(--danger)' }}>{a.liftPp == null ? '—' : `${a.liftPp >= 0 ? '+' : ''}${a.liftPp}pp`}</td>
                      <td className="num cell-mono">{a.currentPct == null ? '—' : `${a.currentPct}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Painel B — Calculadora ----------
const CO_CALC_DEFAULTS = {
  front: 220, orders: 1000, target: 340,
  up: [
    { name: 'UP1 (neu6u)', price: 147, floor: 20 },
    { name: 'UP2 (nig6u)', price: 197, floor: 15 },
    { name: 'UP3 (fleimu33u)', price: 297, floor: 10 },
  ],
};
function CopyCalculatorPanel() {
  const [inp, setInp] = useState(() => JSON.parse(JSON.stringify(CO_CALC_DEFAULTS)));
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [applyMsg, setApplyMsg] = useState(null);

  function setUp(i, field, v) { setInp((s) => { const up = s.up.map((u, j) => j === i ? { ...u, [field]: v } : u); return { ...s, up }; }); }

  async function recalc() {
    setBusy(true); setErr(null); setApplyMsg(null);
    try {
      const r = await window.NSApi.calcCopyAov({
        front: Number(inp.front), orders: Number(inp.orders), target: Number(inp.target),
        up: inp.up.map((u) => ({ name: u.name, price: Number(u.price), floor: Number(u.floor) / 100 })),
      });
      setRes(r);
    } catch (e) { setErr(e.message || 'erro'); }
    finally { setBusy(false); }
  }

  async function applySuggestion() {
    if (!res || !res.suggestedRuleUpdates || res.suggestedRuleUpdates.rules.length === 0) return;
    const updates = res.suggestedRuleUpdates.rules.filter((r) => r.newPct !== r.currentPct).map((r) => ({ key: r.key, newPct: r.newPct }));
    if (updates.length === 0) { setApplyMsg('Nenhuma mudança a aplicar.'); return; }
    if (!window.confirm(`Aplicar ${updates.length} mudança(s) de % nas regras?`)) return;
    setBusy(true); setApplyMsg(null);
    try { const r = await window.NSApi.batchApplyCopyRules({ source: 'calculator', updates }); setApplyMsg(`${r.applied} aplicadas, ${r.skipped} ignoradas.`); }
    catch (e) { setApplyMsg('Erro: ' + (e.message || 'falha')); }
    finally { setBusy(false); }
  }

  const sorted = res ? res.scenarios.slice().sort((a, b) => a.effort - b.effort) : [];
  return (
    <div className="grid-2" style={{ gridTemplateColumns: '1fr 1.2fr', alignItems: 'start' }}>
      <div className="panel">
        <div className="panel-head"><div className="panel-title">Configuração</div></div>
        <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
          <label style={coFieldLabel}><span>Front AOV ($)</span><input type="number" value={inp.front} onChange={(e) => setInp((s) => ({ ...s, front: e.target.value }))} style={coInputStyle}/></label>
          <label style={coFieldLabel}><span>Base orders</span><input type="number" value={inp.orders} onChange={(e) => setInp((s) => ({ ...s, orders: e.target.value }))} style={coInputStyle}/></label>
          <label style={coFieldLabel}><span>Target AOV ($)</span><input type="number" value={inp.target} onChange={(e) => setInp((s) => ({ ...s, target: e.target.value }))} style={coInputStyle}/></label>
          {inp.up.map((u, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={coFieldLabel}><span>{u.name} preço</span><input type="number" value={u.price} onChange={(e) => setUp(i, 'price', e.target.value)} style={coInputStyle}/></label>
              <label style={coFieldLabel}><span>piso conv (%)</span><input type="number" value={u.floor} onChange={(e) => setUp(i, 'floor', e.target.value)} style={coInputStyle}/></label>
            </div>
          ))}
          <button className="btn btn-primary" onClick={recalc} disabled={busy}>{busy ? '…' : 'Recalcular'}</button>
          {err && <div style={{ color: 'var(--danger)', fontSize: 11 }}>{err}</div>}
        </div>
      </div>

      <div style={{ display: 'grid', gap: 12 }}>
        {res && (
          <div className="grid-2" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
            <CopyKpi label="BASELINE" value={fmtCurrency(res.baselineAov, 'USD', 2)}/>
            <CopyKpi label="GAP" value={(res.gap >= 0 ? '+' : '') + fmtCurrency(res.gap, 'USD', 2)} tone={res.gap > 0 ? 'danger' : 'ok'}/>
            <CopyKpi label="MAIS FÁCIL" value={res.easiestScenario || '—'} sub="menor esforço"/>
          </div>
        )}
        {res && (
          <div className="grid-2" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
            {sorted.map((sc) => (
              <div key={sc.label} className="panel" style={{ opacity: sc.status === 'over' ? 0.5 : 1, borderColor: sc.label === res.easiestScenario ? 'var(--glow-cyan)' : undefined }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{sc.label === res.easiestScenario ? '★ ' : ''}{sc.label}</span>
                  <span className="badge" style={{ background: sc.status === 'ok' ? 'rgba(34,197,94,0.15)' : sc.status === 'below' ? 'rgba(91,200,255,0.15)' : 'rgba(239,68,68,0.15)', fontSize: 9 }}>{sc.status}</span>
                </div>
                <div style={{ fontFamily: 'var(--f-display)', fontSize: 18, marginTop: 4 }}>{fmtCurrency(sc.aov, 'USD', 0)}</div>
                <div style={{ fontSize: 10, color: 'var(--fg5)', marginTop: 4 }}>convs: {sc.convs.map((c) => fmtPct(c)).join(' · ')}</div>
                <div style={{ fontSize: 10, color: 'var(--fg5)' }}>esforço: {(sc.effort * 100).toFixed(1)}pp</div>
              </div>
            ))}
          </div>
        )}
        {res && res.suggestedRuleUpdates && res.suggestedRuleUpdates.rules.length > 0 && (
          <div className="panel">
            <div className="panel-head"><div className="panel-title">Sugestão de regras</div></div>
            <div style={{ display: 'grid', gap: 4, marginTop: 8, fontSize: 12 }}>
              {res.suggestedRuleUpdates.rules.map((r) => (
                <div key={r.key} style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--fg2)' }}>
                  <span className="cell-mono">{r.key}</span>
                  <span>{r.currentPct}% → <b style={{ color: 'var(--glow-cyan)' }}>{r.newPct}%</b> <span style={{ color: 'var(--fg5)' }}>· {r.reasoning}</span></span>
                </div>
              ))}
            </div>
            <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={applySuggestion} disabled={busy}>Aplicar sugestão</button>
            {applyMsg && <div style={{ fontSize: 11, color: 'var(--fg3)', marginTop: 6 }}>{applyMsg}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Painel D — Auto-tune ----------
const CO_CFG_FIELDS = [
  ['cooldownH', 'Cooldown (h)'], ['windowH', 'Janela aval. (h)'], ['minSample', 'Min sample'],
  ['liftThresholdPp', 'Lift threshold (pp)'], ['adverseThresholdPp', 'Adverse threshold (pp)'], ['globalTargetAov', 'Target AOV global ($)'],
];
function CopyAutotunePanel() {
  const [cfg, setCfg] = useState(null);
  const [logs, setLogs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([window.NSApi.fetchCopyAutotuneConfig(), window.NSApi.fetchCopyAutotuneLogs({ limit: 50 })])
      .then(([c, l]) => { if (!cancelled) { setCfg(c.config); setLogs(l.logs || []); } })
      .catch((e) => { if (!cancelled) setMsg('Erro: ' + (e.message || 'falha')); });
    return () => { cancelled = true; };
  }, []);

  async function save() {
    setBusy(true); setMsg(null);
    try { const r = await window.NSApi.patchCopyAutotuneConfig(cfg); setCfg(r.config); setMsg('Config salva.'); }
    catch (e) { setMsg('Erro: ' + (e.message || 'falha')); }
    finally { setBusy(false); }
  }

  if (!cfg) return <div className="panel" style={{ opacity: 0.6 }}>{msg || 'Carregando…'}</div>;
  return (
    <div className="grid-2" style={{ gridTemplateColumns: '1fr 1.4fr', alignItems: 'start' }}>
      <div className="panel">
        <div className="panel-head"><div className="panel-title">Config global</div></div>
        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          {CO_CFG_FIELDS.map(([k, label]) => (
            <label key={k} style={coFieldLabel}><span>{label}</span>
              <input type="number" value={cfg[k]} onChange={(e) => setCfg((c) => ({ ...c, [k]: Number(e.target.value) }))} style={coInputStyle}/>
            </label>
          ))}
          <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? '…' : 'Salvar'}</button>
          {msg && <div style={{ fontSize: 11, color: 'var(--fg3)' }}>{msg}</div>}
          <div style={{ fontSize: 10, color: 'var(--fg5)', lineHeight: 1.6 }}>O ciclo roda via cron externo (systemd/GH Actions) batendo em <span className="cell-mono">/api/admin/copy-autotune/run</span> com JOB_SECRET. Ligue o auto-tune por regra na aba <b>Regras</b>.</div>
        </div>
      </div>

      <div className="panel" style={{ padding: 0 }}>
        <div className="panel-head" style={{ padding: '12px 14px 0' }}><div className="panel-title">Histórico de decisões</div></div>
        <div className="tbl-wrap" style={{ margin: 0, padding: '0 4px' }}>
          <table className="tbl">
            <thead><tr><th>Quando</th><th>Afiliado</th><th className="num">% antes→depois</th><th>Motivo</th></tr></thead>
            <tbody>
              {logs.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', padding: 16, opacity: 0.6 }}>Nenhuma decisão registrada ainda.</td></tr>}
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="cell-mono" style={{ fontSize: 10 }}>{fmtDateTime(l.decidedAt)}</td>
                  <td className="cell-mono">{l.ruleKey || '—'}</td>
                  <td className="num cell-mono">{l.pctBefore}% → {l.pctAfter}%</td>
                  <td><span className="badge neutral" style={{ fontSize: 9 }}>{l.reason}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------- Seção empilhada (bloco com header) ----------
function CopySection({ n, title, desc, first, children }) {
  return (
    <section style={{ marginTop: first ? 8 : 30, paddingTop: first ? 0 : 22, borderTop: first ? 'none' : '1px solid var(--border-soft)' }}>
      <div style={{ marginBottom: 14 }}>
        <div className="eyebrow" style={{ fontSize: 10 }}>{n ? `${n} · ` : ''}{title}</div>
        {desc && <div style={{ fontSize: 11, color: 'var(--fg5)', marginTop: 3 }}>{desc}</div>}
      </div>
      {children}
    </section>
  );
}

// Shell: 4 painéis empilhados verticalmente no mesmo scroll (sem abas).
function CopyOptimizerPage() {
  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">ADMIN · COPY OPTIMIZER</span>
          <h2>Copy <em>Optimizer</em></h2>
          <span className="sub">Exposição da copy Black 2 no Upsell01 (BuyGoods) — regras, observabilidade, calculadora de AOV e auto-tune.</span>
        </div>
      </div>

      <CopySection n="01" title="REGRAS" desc="% de Black 2 por afiliado (decisão server-side)." first>
        <CopyRulesPanel/>
      </CopySection>

      <CopySection n="02" title="OBSERVABILIDADE" desc="Conversão e AOV por stage / layer / afiliado.">
        <CopyObservabilityPanel/>
      </CopySection>

      <CopySection n="03" title="CALCULADORA DE AOV" desc="Cenários pra atingir o target e sugestão de ajuste de regras.">
        <CopyCalculatorPanel/>
      </CopySection>

      <CopySection n="04" title="AUTO-TUNE" desc="Config global do gradiente + histórico de decisões.">
        <CopyAutotunePanel/>
      </CopySection>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Recuperação — vendas trazidas por afiliados de recuperação (SMS/email)
// + comissão devida. A "recuperação" é uma FONTE (o afiliado), não um
// estágio de funil. Sem split SMS/email ainda (falta sinal no dado).
// ═══════════════════════════════════════════════════════════════════

function RecoveryManage({ affs, onChanged }) {
  const [ext, setExt] = useState('');
  const [plat, setPlat] = useState('digistore24');
  const [pct, setPct] = useState(30);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function add() {
    if (!ext.trim()) { setMsg('Informe o ID do afiliado.'); return; }
    setBusy(true); setMsg(null);
    try {
      await window.NSApi.addRecoveryAffiliate({ affiliateExternalId: ext.trim(), platformSlug: plat, commissionPct: Number(pct) });
      setExt(''); setMsg('Afiliado marcado.'); onChanged();
    } catch (e) { setMsg('Erro: ' + (e.message || 'falha')); }
    finally { setBusy(false); }
  }
  async function remove(id, label) {
    if (!window.confirm(`Remover ${label} da recuperação?`)) return;
    try { await window.NSApi.deleteRecoveryAffiliate(id); onChanged(); }
    catch (e) { setMsg('Erro: ' + (e.message || 'falha')); }
  }

  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div className="panel-head"><div className="panel-title">Afiliados de recuperação</div></div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'end', marginTop: 10, flexWrap: 'wrap' }}>
        <label style={coFieldLabel}><span>ID do afiliado</span><input value={ext} onChange={(e) => setExt(e.target.value)} placeholder="3722234" style={{ ...coInputStyle, width: 150 }}/></label>
        <label style={coFieldLabel}><span>Plataforma</span>
          <select value={plat} onChange={(e) => setPlat(e.target.value)} style={{ ...coInputStyle, width: 150 }}>
            <option value="digistore24">Digistore24</option>
            <option value="clickbank">ClickBank</option>
            <option value="buygoods">BuyGoods</option>
            <option value="cartpanda">Cartpanda</option>
          </select>
        </label>
        <label style={coFieldLabel}><span>Comissão %</span><input type="number" min={0} max={100} value={pct} onChange={(e) => setPct(e.target.value)} style={{ ...coInputStyle, width: 100 }}/></label>
        <button className="btn btn-primary" onClick={add} disabled={busy}>{busy ? '…' : 'Marcar'}</button>
      </div>
      <div style={{ marginTop: 8, fontSize: 10, color: 'var(--fg5)' }}>
        Pra alterar a % de quem já está marcado, re-marque com a nova % — as vendas antigas continuam
        registradas com a taxa antiga e um novo contador começa com a nova.
      </div>
      {msg && <div style={{ fontSize: 11, color: 'var(--fg3)', marginTop: 6 }}>{msg}</div>}
      <div style={{ marginTop: 12 }}>
        {affs.length === 0 && <div style={{ fontSize: 11, color: 'var(--fg5)' }}>Nenhum afiliado marcado ainda.</div>}
        {affs.map((a) => {
          const history = (a.ratePeriods || []).filter((p) => p.effectiveTo != null);
          return (
            <div key={a.id} style={{ padding: '7px 0', borderTop: '1px solid var(--border-soft)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="cell-mono" style={{ fontSize: 12 }}>{a.nickname || a.affiliateExternalId}<span style={{ color: 'var(--fg5)' }}> · {a.affiliateExternalId} · {a.platformSlug} · </span><span style={{ color: 'var(--glow-cyan)' }}>{(a.commissionPct * 100).toFixed(0)}% vigente</span></span>
                <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={() => remove(a.id, a.nickname || a.affiliateExternalId)} title="Remover"><Icon name="trash-2" size={12}/></button>
              </div>
              {history.length > 0 && (
                <div className="cell-mono" style={{ fontSize: 10, color: 'var(--fg5)', marginTop: 2 }}>
                  histórico: {history.map((p) => `${(p.commissionPct * 100).toFixed(0)}% até ${fmtDateShort(p.effectiveTo)}`).join(' · ')}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecoveryPage({ filters }) {
  const [data, setData] = useState({ status: 'loading', m: null, err: null });
  const [affs, setAffs] = useState([]);
  const [refresh, setRefresh] = useState(0);
  const [manage, setManage] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData((d) => ({ ...d, status: 'loading' }));
    Promise.all([
      window.NSApi.fetchRecovery(filters),
      window.NSApi.fetchRecoveryAffiliates().catch(() => ({ affiliates: [] })), // admin-only; membro só vê métricas
    ])
      .then(([m, a]) => { if (!cancelled) { setData({ status: 'ready', m, err: null }); setAffs(a.affiliates || []); } })
      .catch((err) => { if (!cancelled) setData({ status: 'error', m: null, err: err.message || 'erro' }); });
    return () => { cancelled = true; };
  }, [filters.dateRange.start.getTime(), filters.dateRange.end.getTime(), refresh]);

  function reload() { setRefresh((n) => n + 1); }
  const m = data.m;

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">AFILIADOS · RECUPERAÇÃO</span>
          <h2>Recuperação <em>de vendas</em></h2>
          <span className="sub">Vendas trazidas por afiliados de recuperação (SMS/email) + comissão devida. Respeita o filtro de período.</span>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-ghost" onClick={reload}><Icon name="refresh" size={12}/> Recarregar</button>
          <button className="btn btn-primary" onClick={() => setManage((v) => !v)}><Icon name="sliders" size={12}/> Gerenciar afiliados</button>
        </div>
      </div>

      {data.status === 'error' && <div className="panel" style={{ color: 'var(--danger)', marginBottom: 12 }}>Erro: {data.err}</div>}
      {manage && <RecoveryManage affs={affs} onChanged={reload}/>}

      {data.status === 'loading' && !m && (
        <>
          <SkelMiniKpis n={4}/>
          <div style={{ marginTop: 12 }}><SkelTablePanel rows={5} cols={5} i={1}/></div>
        </>
      )}

      {m && (
        <>
          <div className="grid-2" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 12 }}>
            <CopyKpi label="VENDAS RECUPERADAS" value={fmtInt(m.kpis.sales)}/>
            <CopyKpi label="RECEITA" value={fmtCurrency(m.kpis.grossUsd, 'USD', 2)}/>
            <CopyKpi label="COMISSÃO DEVIDA" value={fmtCurrency(m.kpis.commissionUsd, 'USD', 2)} tone="danger"/>
            <CopyKpi label="LÍQUIDO (pós-comissão)" value={fmtCurrency(m.kpis.netUsd, 'USD', 2)} tone="ok"/>
          </div>

          <div className="panel" style={{ padding: 0 }}>
            <div className="panel-head" style={{ padding: '12px 14px 0' }}><div className="panel-title">Por afiliado</div></div>
            <div className="tbl-wrap" style={{ margin: 0, padding: '0 4px' }}>
              <table className="tbl">
                <thead><tr><th>Afiliado</th><th className="num">% comissão</th><th className="num">Vendas</th><th className="num">Receita</th><th className="num">Comissão devida</th></tr></thead>
                <tbody>
                  {data.status === 'loading' && <SkelTableRows rows={5} cols={5}/>}
                  {data.status === 'ready' && m.byAffiliate.length === 0 && (
                    <tr><td colSpan={5} style={{ textAlign: 'center', padding: 20, opacity: 0.6 }}>
                      Nenhuma venda de recuperação no período.{affs.length === 0 ? ' Marque um afiliado em "Gerenciar afiliados".' : ''}
                    </td></tr>
                  )}
                  {m.byAffiliate.map((a) => {
                    const multi = (a.periods || []).length > 1;
                    return (
                      <React.Fragment key={a.affiliateExternalId}>
                        <tr>
                          <td className="cell-mono">{a.nickname || a.affiliateExternalId}<span style={{ color: 'var(--fg5)', marginLeft: 6, fontSize: 10 }}>{a.affiliateExternalId}</span></td>
                          <td className="num cell-mono">{(a.commissionPct * 100).toFixed(0)}%{multi && <span style={{ color: 'var(--warning)', marginLeft: 4 }} title="A % mudou dentro do período — contadores por taxa abaixo">*</span>}</td>
                          <td className="num">{fmtInt(a.sales)}</td>
                          <td className="num">{fmtCurrency(a.grossUsd, 'USD', 2)}</td>
                          <td className="num" style={{ color: 'var(--glow-cyan)' }}>{fmtCurrency(a.commissionUsd, 'USD', 2)}</td>
                        </tr>
                        {/* Contadores por período de taxa: vendas feitas com a % antiga
                            ficam registradas no contador antigo; a % nova acumula no novo. */}
                        {multi && a.periods.map((p, i) => {
                          const vigente = p.effectiveTo == null;
                          const label = vigente
                            ? `desde ${p.effectiveFrom ? fmtDateShort(p.effectiveFrom) : 'sempre'} · vigente`
                            : p.effectiveFrom
                              ? `${fmtDateShort(p.effectiveFrom)} → ${fmtDateShort(p.effectiveTo)}`
                              : `até ${fmtDateShort(p.effectiveTo)}`;
                          return (
                            <tr key={`${a.affiliateExternalId}-p${i}`} style={{ background: 'rgba(91,200,255,0.025)' }}>
                              <td className="cell-mono" style={{ paddingLeft: 26, fontSize: 10, color: vigente ? 'var(--fg3)' : 'var(--fg5)' }}>
                                <Icon name="chevron-right" size={9}/> <span style={{ marginLeft: 4 }}>{label}</span>
                              </td>
                              <td className="num cell-mono" style={{ fontSize: 10, color: vigente ? 'var(--glow-cyan)' : 'var(--fg5)' }}>{(p.commissionPct * 100).toFixed(0)}%</td>
                              <td className="num" style={{ fontSize: 11, color: 'var(--fg4)' }}>{fmtInt(p.sales)}</td>
                              <td className="num" style={{ fontSize: 11, color: 'var(--fg4)' }}>{fmtCurrency(p.grossUsd, 'USD', 2)}</td>
                              <td className="num" style={{ fontSize: 11, color: vigente ? 'var(--glow-cyan)' : 'var(--fg4)' }}>{fmtCurrency(p.commissionUsd, 'USD', 2)}</td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ marginTop: 10, fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg5)', lineHeight: 1.6 }}>
            Comissão = receita × % VIGENTE NA DATA DA VENDA, sobre cada venda APROVADA (FE + upsell).
            Alterar a % de um afiliado não reescreve o passado: vendas antigas ficam no contador da taxa
            antiga (linhas com *) e um novo contador acumula com a taxa nova. Split SMS vs email entra
            quando houver sinal no tracking.
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tauk Solutions — vendas recuperadas pelo serviço (telefone/SMS, checkout
// próprio). Feed: webhook Tauk → n8n → /api/ingest/tauk → TaukSale (fora da
// tabela Order de propósito — sem produto/ID e risco de dupla contagem).
// ─────────────────────────────────────────────────────────────────────────────

function taukStatusStyle(status) {
  const s = String(status || '').toUpperCase();
  if (s === 'HOLD') return { bg: 'rgba(255,180,0,0.14)', fg: '#ffd166', border: 'rgba(255,180,0,0.4)' };
  if (s === 'SHIPPED' || s === 'FULFILLED' || s === 'DELIVERED') {
    return { bg: 'rgba(58,214,140,0.14)', fg: 'var(--success)', border: 'rgba(58,214,140,0.4)' };
  }
  if (s === 'CANCELED' || s === 'CANCELLED' || s === 'REFUNDED') {
    return { bg: 'rgba(255,90,90,0.14)', fg: '#ff8a8a', border: 'rgba(255,90,90,0.4)' };
  }
  return { bg: 'rgba(91,200,255,0.12)', fg: 'var(--glow-cyan)', border: 'rgba(91,200,255,0.35)' };
}

function TaukStatusBadge({ status }) {
  const st = taukStatusStyle(status);
  return (
    <span style={{
      fontFamily: 'var(--f-mono)', fontSize: 9.5, fontWeight: 600, letterSpacing: '0.06em',
      textTransform: 'uppercase', padding: '2px 8px', borderRadius: 'var(--r-full)',
      background: st.bg, color: st.fg, border: `1px solid ${st.border}`, whiteSpace: 'nowrap',
    }}>
      {String(status || '—').toUpperCase()}
    </span>
  );
}

// Data/hora BRT curta pra tabela de vendas recentes.
function fmtTaukWhen(iso) {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch (e) { return iso; }
}

function TaukPage({ filters }) {
  const [data, setData] = useState({ status: 'loading', m: null, err: null });
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setData((d) => ({ ...d, status: 'loading' }));
    window.NSApi.fetchTauk(filters)
      .then((m) => { if (!cancelled) setData({ status: 'ready', m, err: null }); })
      .catch((err) => { if (!cancelled) setData({ status: 'error', m: null, err: err.message || 'erro' }); });
    return () => { cancelled = true; };
  }, [filters.dateRange.start.getTime(), filters.dateRange.end.getTime(), refresh]);

  const m = data.m;

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">AFILIADOS · TAUK SOLUTIONS</span>
          <h2>Tauk <em>· recuperação</em></h2>
          <span className="sub">Vendas recuperadas pela Tauk (telefone/SMS) reportadas via webhook. Respeita o filtro de período.</span>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-ghost" onClick={() => setRefresh((n) => n + 1)}><Icon name="refresh" size={12}/> Recarregar</button>
        </div>
      </div>

      {data.status === 'error' && <div className="panel" style={{ color: 'var(--danger)', marginBottom: 12 }}>Erro: {data.err}</div>}

      {data.status === 'loading' && !m && (
        <>
          <SkelMiniKpis n={4}/>
          <div style={{ marginTop: 12 }}><SkelChartPanel i={1}/></div>
          <div style={{ marginTop: 12 }}><SkelTablePanel rows={6} cols={5} i={2}/></div>
        </>
      )}

      {m && (
        <>
          <div className="grid-2" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginBottom: 12 }}>
            <CopyKpi label="VENDAS RECUPERADAS" value={fmtInt(m.kpis.sales)}/>
            <CopyKpi label="RECEITA" value={fmtCurrency(m.kpis.grossUsd, 'USD', 2)}/>
            <CopyKpi label="TICKET MÉDIO" value={fmtCurrency(m.kpis.aovUsd, 'USD', 2)}/>
            <CopyKpi label={`COMISSÃO TAUK (${Math.round((m.kpis.commissionPct ?? 0.35) * 100)}%)`} value={fmtCurrency(m.kpis.commissionUsd ?? 0, 'USD', 2)} tone="danger"/>
            <CopyKpi label="LÍQUIDO (pós-comissão)" value={fmtCurrency(m.kpis.netUsd ?? 0, 'USD', 2)} tone="ok"/>
            <CopyKpi label="EM HOLD (não enviadas)" value={fmtInt(m.kpis.holdCount)} tone={m.kpis.holdCount > 0 ? 'danger' : undefined}/>
          </div>

          {m.daily.length > 0 && (
            <div className="panel" style={{ marginBottom: 12 }}>
              <div className="panel-head">
                <div className="panel-title">
                  <span className="panel-eyebrow">RECEITA RECUPERADA · POR DIA</span>
                  <div className="panel-metric" style={{ fontSize: 14, color: 'var(--fg3)' }}>
                    {m.daily.length} {m.daily.length === 1 ? 'dia' : 'dias'} com venda no período
                  </div>
                </div>
              </div>
              <NSTimeSeries height={220} currency="USD"
                data={m.daily.map((d) => ({ date: d.date, receita: d.grossUsd }))}
                series={[{ key: 'receita', label: 'Receita', color: '#5BC8FF' }]}/>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12, alignItems: 'start' }}>
            <div className="panel" style={{ padding: 0 }}>
              <div className="panel-head" style={{ padding: '12px 14px 0' }}>
                <div className="panel-title">Por status de fulfillment</div>
              </div>
              <div className="tbl-wrap" style={{ margin: 0, padding: '0 4px' }}>
                <table className="tbl">
                  <thead><tr><th>Status</th><th className="num">Vendas</th><th className="num">Receita</th></tr></thead>
                  <tbody>
                    {m.byStatus.length === 0 && (
                      <tr><td colSpan={3} style={{ textAlign: 'center', padding: 16, opacity: 0.6 }}>Sem vendas no período.</td></tr>
                    )}
                    {m.byStatus.map((s) => (
                      <tr key={s.status}>
                        <td><TaukStatusBadge status={s.status}/></td>
                        <td className="num">{fmtInt(s.sales)}</td>
                        <td className="num">{fmtCurrency(s.grossUsd, 'USD', 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="panel" style={{ padding: 0 }}>
              <div className="panel-head" style={{ padding: '12px 14px 0' }}>
                <div className="panel-title">Vendas recentes <span style={{ color: 'var(--fg5)', fontSize: 10, marginLeft: 6 }}>últimas {m.recent.length} do período · horário BRT</span></div>
              </div>
              <div className="tbl-wrap" style={{ margin: 0, padding: '0 4px', maxHeight: 420, overflowY: 'auto' }}>
                <table className="tbl">
                  <thead><tr><th>Quando</th><th>Cliente</th><th>Contato</th><th className="num">Valor</th><th>Status</th></tr></thead>
                  <tbody>
                    {m.recent.length === 0 && (
                      <tr><td colSpan={5} style={{ textAlign: 'center', padding: 16, opacity: 0.6 }}>
                        Nenhuma venda da Tauk no período. Assim que o webhook deles disparar, aparece aqui.
                      </td></tr>
                    )}
                    {m.recent.map((r) => (
                      <tr key={r.id}>
                        <td className="cell-mono" style={{ fontSize: 11 }}>{fmtTaukWhen(r.purchasedAt)}</td>
                        <td>{r.name}</td>
                        <td className="cell-mono" style={{ fontSize: 10.5, color: 'var(--fg4)' }}>
                          {r.email || '—'}{r.phone ? <span style={{ color: 'var(--fg5)' }}> · {r.phone}</span> : null}
                        </td>
                        <td className="num" style={{ color: 'var(--glow-cyan)' }}>{fmtCurrency(r.amountUsd, 'USD', 2)}</td>
                        <td><TaukStatusBadge status={r.fulfillmentStatus}/></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 10, fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg5)', lineHeight: 1.6 }}>
            Fonte: webhook da Tauk Solutions (via n8n). Comissão = receita × {Math.round((m.kpis.commissionPct ?? 0.35) * 100)}%
            sobre cada venda recuperada (acordo comercial); líquido = receita − comissão. Números FORA das métricas
            de receita das plataformas — sem produto/ID de transação no feed, uma venda recuperada pode também
            transitar pela plataforma principal; manter separado evita dupla contagem. Horários convertidos de
            Eastern (EUA) pra UTC/BRT.
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Captação · SMS — saúde da stack Mautic → n8n → Twilio (4 subcontas).
// Observabilidade pura: disparo/pausa é no Mautic. Dados: /api/metrics/sms
// (eventos via /api/ingest/sms-events). 4 blocos: KPIs, saúde por número,
// tabela de campanhas (catálogo Mautic × telemetria) e feed de diagnóstico.
// ─────────────────────────────────────────────────────────────────────────────

const SMS_HEALTH_META = {
  green:  { label: 'SAUDÁVEL',    fg: 'var(--success)', bg: 'rgba(58,214,140,0.14)',  border: 'rgba(58,214,140,0.45)' },
  yellow: { label: 'ATENÇÃO',     fg: '#ffd166',        bg: 'rgba(255,180,0,0.14)',   border: 'rgba(255,180,0,0.45)' },
  red:    { label: 'CRÍTICO',     fg: '#ff8a8a',        bg: 'rgba(255,90,90,0.16)',   border: 'rgba(255,90,90,0.5)' },
  idle:   { label: 'SEM TRÁFEGO', fg: 'var(--fg5)',     bg: 'rgba(255,255,255,0.04)', border: 'var(--border-soft)' },
};

function SmsHealthBadge({ level, big }) {
  const meta = SMS_HEALTH_META[level] || SMS_HEALTH_META.idle;
  return (
    <span style={{
      fontFamily: 'var(--f-mono)', fontWeight: 700, letterSpacing: '0.08em', whiteSpace: 'nowrap',
      fontSize: big ? 11 : 9.5, padding: big ? '4px 12px' : '2px 8px', borderRadius: 'var(--r-full)',
      background: meta.bg, color: meta.fg, border: `1px solid ${meta.border}`,
      display: 'inline-flex', alignItems: 'center', gap: 6,
    }}>
      <span style={{ width: big ? 8 : 6, height: big ? 8 : 6, borderRadius: '50%', background: meta.fg }}/>
      {meta.label}
    </span>
  );
}

// Chip do feed de diagnóstico: sent=neutro, delivered=verde,
// undelivered/failed=vermelho, stop=laranja, skipped=cinza.
const SMS_TYPE_META = {
  sent:        { label: 'ENVIADO',    fg: 'var(--glow-cyan)', bg: 'rgba(91,200,255,0.12)',  border: 'rgba(91,200,255,0.35)' },
  delivered:   { label: 'ENTREGUE',   fg: 'var(--success)',   bg: 'rgba(58,214,140,0.14)',  border: 'rgba(58,214,140,0.4)' },
  undelivered: { label: 'NÃO ENTREGUE', fg: '#ff8a8a',        bg: 'rgba(255,90,90,0.14)',   border: 'rgba(255,90,90,0.4)' },
  failed:      { label: 'FALHOU',     fg: '#ff8a8a',          bg: 'rgba(255,90,90,0.14)',   border: 'rgba(255,90,90,0.4)' },
  stop:        { label: 'STOP',       fg: '#ffb86b',          bg: 'rgba(255,150,60,0.14)',  border: 'rgba(255,150,60,0.4)' },
  skipped:     { label: 'DESCARTADO', fg: 'var(--fg4)',       bg: 'rgba(255,255,255,0.05)', border: 'var(--border-soft)' },
};

function SmsTypeChip({ type }) {
  const meta = SMS_TYPE_META[type] || { label: String(type || '—').toUpperCase(), fg: 'var(--fg4)', bg: 'rgba(255,255,255,0.05)', border: 'var(--border-soft)' };
  return (
    <span style={{
      fontFamily: 'var(--f-mono)', fontSize: 9, fontWeight: 600, letterSpacing: '0.06em',
      padding: '2px 8px', borderRadius: 'var(--r-full)', whiteSpace: 'nowrap',
      background: meta.bg, color: meta.fg, border: `1px solid ${meta.border}`,
    }}>
      {meta.label}
    </span>
  );
}

function SmsCampaignStatusBadge({ row }) {
  if (row.orphan) {
    return <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: '#ffd166', border: '1px solid rgba(255,180,0,0.4)', background: 'rgba(255,180,0,0.1)', padding: '2px 8px', borderRadius: 'var(--r-full)', whiteSpace: 'nowrap' }}>NÃO ENCONTRADA NO MAUTIC</span>;
  }
  const map = {
    active:   { label: 'ATIVA',     fg: 'var(--success)', bg: 'rgba(58,214,140,0.14)', border: 'rgba(58,214,140,0.4)' },
    paused:   { label: 'PAUSADA',   fg: '#ffd166',        bg: 'rgba(255,180,0,0.12)',  border: 'rgba(255,180,0,0.4)' },
    archived: { label: 'ARQUIVADA', fg: 'var(--fg5)',     bg: 'rgba(255,255,255,0.04)', border: 'var(--border-soft)' },
  };
  const meta = map[row.status] || map.archived;
  return (
    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, fontWeight: 600, color: meta.fg, background: meta.bg, border: `1px solid ${meta.border}`, padding: '2px 8px', borderRadius: 'var(--r-full)', whiteSpace: 'nowrap' }}>
      {meta.label}
    </span>
  );
}

// Data/hora BRT curta pro feed e pra tabela de campanhas.
function fmtSmsWhen(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch (e) { return iso; }
}

// Card de saúde de um número ATIVO (bloco B — o coração da tela).
function SmsNumberCard({ n }) {
  const meta = SMS_HEALTH_META[n.health] || SMS_HEALTH_META.idle;
  const spark = (n.daily || []).filter((d) => d.deliveryRate != null).map((d) => d.deliveryRate);
  return (
    <div className="panel" style={{ padding: '14px 16px', borderColor: n.health === 'red' ? 'rgba(255,90,90,0.5)' : undefined }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 17, color: 'var(--fg1)' }}>
            {n.brand || (n.subIndex != null ? `Sub #${n.subIndex}` : '—')}
          </div>
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--fg5)', marginTop: 2 }}>
            {n.numberMasked || 'número não cadastrado'}{n.subIndex != null ? ` · sub ${n.subIndex}` : ''}
          </div>
        </div>
        <SmsHealthBadge level={n.health} big/>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginTop: 12 }}>
        <div>
          <div className="eyebrow" style={{ fontSize: 8.5 }}>TAXA DE ENTREGA</div>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 26, fontWeight: 600, color: meta.fg }}>
            {n.deliveryRate != null ? fmtPct(n.deliveryRate) : '—'}
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
          <Sparkline data={spark} width={140} height={34} color={n.health === 'red' ? '#ff8a8a' : n.health === 'yellow' ? '#ffd166' : '#5BC8FF'}/>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginTop: 12 }}>
        <div>
          <div className="eyebrow" style={{ fontSize: 8.5 }}>ENVIADOS</div>
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 14, color: 'var(--fg2)' }}>{fmtInt(n.sent)}</div>
        </div>
        <div>
          <div className="eyebrow" style={{ fontSize: 8.5 }}>30007 (OPERADORA)</div>
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 14, color: n.filtered30007 > 0 ? 'var(--danger)' : 'var(--fg2)', fontWeight: n.filtered30007 > 0 ? 700 : 400 }}>
            {fmtInt(n.filtered30007)}
            {n.filtered30007Last24h > 0 && <span style={{ fontSize: 9.5, marginLeft: 4, color: 'var(--danger)' }}>({n.filtered30007Last24h} em 24h)</span>}
          </div>
        </div>
        <div>
          <div className="eyebrow" style={{ fontSize: 8.5 }}>STOPS</div>
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 14, color: 'var(--fg2)' }}>
            {fmtInt(n.stops)}
            <span style={{ fontSize: 9.5, marginLeft: 4, color: 'var(--fg5)' }}>{n.stopRate != null ? fmtPct(n.stopRate) : ''}</span>
          </div>
        </div>
        <div>
          <div className="eyebrow" style={{ fontSize: 8.5 }}>PENDENTES &gt;1H</div>
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 14, color: n.pending > 0 ? '#ffd166' : 'var(--fg2)' }}>{fmtInt(n.pending)}</div>
        </div>
      </div>

      {n.health === 'red' && (
        <div style={{
          marginTop: 12, padding: '9px 12px', borderRadius: 8, fontSize: 11.5, lineHeight: 1.5,
          background: 'rgba(255,90,90,0.12)', border: '1px solid rgba(255,90,90,0.45)', color: '#ff8a8a',
        }}>
          <b>Pausar envios desta marca e acionar o parceiro de SMS.</b>
          {n.healthReasons.length > 0 && <span style={{ color: 'var(--fg3)' }}> Motivo: {n.healthReasons.join(' · ')}.</span>}
        </div>
      )}
      {n.health === 'yellow' && n.healthReasons.length > 0 && (
        <div style={{ marginTop: 10, fontFamily: 'var(--f-mono)', fontSize: 10, color: '#ffd166' }}>
          {n.healthReasons.join(' · ')}
        </div>
      )}
    </div>
  );
}

function SmsPage({ filters }) {
  const [data, setData] = useState({ status: 'loading', m: null, err: null });
  const [refresh, setRefresh] = useState(0);
  const [brand, setBrand] = useState('');
  const [campaign, setCampaign] = useState('');
  // Opções dos selects vêm dos próprios dados; memorizadas do último load
  // SEM o respectivo filtro (senão filtrar por uma marca faria as outras
  // sumirem do dropdown).
  const [brandOpts, setBrandOpts] = useState([]);
  const [campOpts, setCampOpts] = useState([]);
  const [feedOpen, setFeedOpen] = useState(false);
  const [feedType, setFeedType] = useState('');
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setData((d) => ({ ...d, status: 'loading' }));
    window.NSApi.fetchSms(filters, { brand: brand || null, campaign: campaign || null })
      .then((m) => {
        if (cancelled) return;
        setData({ status: 'ready', m, err: null });
        if (!brand) {
          setBrandOpts(Array.from(new Set((m.numbers || []).filter((n) => n.brand && (n.sent > 0 || n.role === 'active')).map((n) => n.brand))));
        }
        if (!campaign) {
          setCampOpts((m.campaigns || []).filter((c) => c.slug).map((c) => ({ slug: c.slug, name: c.name || c.slug })));
        }
      })
      // Erro preserva o `m` anterior: com o auto-refresh de 60s, um blip
      // transiente não pode apagar a tela — mostra o banner de erro em cima
      // dos dados que já estavam visíveis.
      .catch((err) => { if (!cancelled) setData((d) => ({ status: 'error', m: d.m, err: err.message || 'erro' })); });
    return () => { cancelled = true; };
  }, [filters.dateRange.start.getTime(), filters.dateRange.end.getTime(), brand, campaign, refresh]);

  // Feed "tempo real": refresh de 60s da tela inteira (o cache server-side
  // de 30s segura o custo; o payload é o mesmo endpoint).
  useEffect(() => {
    const t = setInterval(() => setRefresh((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const m = data.m;
  const selStyle = {
    background: 'rgba(255,255,255,0.04)', color: 'var(--fg2)', border: '1px solid var(--border-soft)',
    borderRadius: 8, padding: '5px 8px', fontSize: 11, fontFamily: 'var(--f-mono)',
  };

  const actives = m ? m.numbers.filter((n) => n.role === 'active' || n.sent > 0 || n.stops > 0) : [];
  const reserves = m ? m.numbers.filter((n) => !actives.includes(n)) : [];
  const feedRows = m ? (feedType ? m.feed.filter((f) => f.type === feedType) : m.feed) : [];
  const topReason = m && m.kpis.skippedByReason.length > 0 ? m.kpis.skippedByReason[0] : null;

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">CAPTAÇÃO · SMS</span>
          <h2>SMS <em>· saúde da operação</em></h2>
          <span className="sub">Telemetria da stack Mautic → n8n → Twilio (envios, entregas, STOPs, filtragem de operadora). Observabilidade — disparo e pausa continuam no Mautic.</span>
        </div>
        <div className="page-head-actions" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={brand} onChange={(e) => setBrand(e.target.value)} style={selStyle}>
            <option value="">Todas as marcas</option>
            {brandOpts.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={campaign} onChange={(e) => setCampaign(e.target.value)} style={{ ...selStyle, maxWidth: 220 }}>
            <option value="">Todas as campanhas</option>
            {campOpts.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
          <button className="btn btn-ghost" onClick={() => setRefresh((n) => n + 1)}><Icon name="refresh" size={12}/> Recarregar</button>
        </div>
      </div>

      {data.status === 'error' && <div className="panel" style={{ color: 'var(--danger)', marginBottom: 12 }}>Erro: {data.err}</div>}

      {data.status === 'loading' && !m && (
        <>
          <SkelMiniKpis n={4}/>
          <div style={{ marginTop: 12 }}><SkelChartPanel i={1}/></div>
          <div style={{ marginTop: 12 }}><SkelTablePanel rows={6} cols={8} i={2}/></div>
        </>
      )}

      {m && (
        <>
          {/* Alertas transversais */}
          {m.alerts.redNumbers.length > 0 && (
            <div className="panel" style={{
              marginBottom: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10,
              background: 'rgba(255,90,90,0.1)', border: '1px solid rgba(255,90,90,0.5)',
            }}>
              <Icon name="alert-triangle" size={16}/>
              <div style={{ fontSize: 12.5, color: '#ff8a8a' }}>
                <b>{m.alerts.redNumbers.join(', ')} em estado crítico.</b>{' '}
                <span style={{ color: 'var(--fg3)' }}>Pausar envios desta marca e acionar o parceiro de SMS.</span>
              </div>
            </div>
          )}
          {m.alerts.callbacksSuspect && (
            <div style={{
              marginBottom: 12, padding: '8px 14px', borderRadius: 9, fontSize: 11.5,
              background: 'rgba(255,180,0,0.08)', border: '1px solid rgba(255,180,0,0.35)', color: '#ffd166',
            }}>
              {fmtPct(m.alerts.recentPendingRatio)} dos envios recentes seguem sem status final há mais de 1h — os callbacks do Twilio podem estar fora do ar.
              {m.kpis.pending > 0 ? ` ${fmtInt(m.kpis.pending)} pendentes no período.` : ''}
            </div>
          )}

          {/* Bloco A — KPIs do período */}
          <div className="grid-2" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 12 }}>
            <CopyKpi label="ENVIADOS" value={fmtInt(m.kpis.sent)}
              sub={m.kpis.pending > 0 ? `${fmtInt(m.kpis.pending)} pendentes >1h` : undefined}/>
            <CopyKpi label="TAXA DE ENTREGA" value={m.kpis.deliveryRate != null ? fmtPct(m.kpis.deliveryRate) : '—'}
              tone={m.kpis.deliveryRate != null ? (m.kpis.deliveryRate >= 0.95 ? 'ok' : m.kpis.deliveryRate < 0.90 ? 'danger' : undefined) : undefined}
              sub={m.kpis.deliveryRateDeltaPp != null
                ? `${m.kpis.deliveryRateDeltaPp >= 0 ? '+' : ''}${m.kpis.deliveryRateDeltaPp}pp vs período anterior`
                : `${fmtInt(m.kpis.finals)} status finais no denominador`}/>
            <CopyKpi label="STOPS" value={fmtInt(m.kpis.stops)}
              tone={m.kpis.stopRate != null && m.kpis.stopRate > 0.02 ? 'danger' : undefined}
              sub={m.kpis.stopRate != null ? `taxa ${fmtPct(m.kpis.stopRate)} dos enviados` : undefined}/>
            <CopyKpi label="DESCARTADOS (GATEWAY)" value={fmtInt(m.kpis.skipped)}
              sub={topReason ? `${topReason.reason} (${topReason.count})` : 'nenhum descarte no período'}/>
          </div>

          {/* Receita atribuída aos disparos (utm_source do checkout Digistore) */}
          <div className="panel" style={{ marginBottom: 12 }}>
            <div className="panel-head">
              <div className="panel-title">
                <span className="panel-eyebrow">RECEITA DOS DISPAROS · utm_source={m.sales.utmSource}</span>
                <div className="panel-metric" style={{ fontSize: 14, color: 'var(--fg3)' }}>
                  vendas aprovadas com o UTM dos SMS no checkout
                  {brand ? ' · este painel não segue o filtro de marca (a venda não carrega marca)' : ''}
                </div>
              </div>
            </div>
            <div className="grid-2" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginBottom: m.sales.daily.length > 0 ? 12 : 0 }}>
              <CopyKpi label="VENDAS ATRIBUÍDAS" value={fmtInt(m.sales.sales)}/>
              <CopyKpi label="RECEITA" value={fmtCurrency(m.sales.grossUsd, 'USD', 2)} tone={m.sales.grossUsd > 0 ? 'ok' : undefined}/>
              <CopyKpi label="TICKET MÉDIO" value={m.sales.aovUsd != null ? fmtCurrency(m.sales.aovUsd, 'USD', 2) : '—'}/>
            </div>
            {m.sales.daily.length > 0 && (
              <NSTimeSeries height={160} currency="USD"
                data={m.sales.daily.map((d) => ({ date: d.date, receita: d.grossUsd }))}
                series={[{ key: 'receita', label: 'Receita', color: '#3ad68c' }]}/>
            )}
            {m.sales.byCampaign.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                {m.sales.byCampaign.map((c) => (
                  <span key={c.campaignKey} style={{
                    fontFamily: 'var(--f-mono)', fontSize: 10, padding: '3px 10px', borderRadius: 'var(--r-full)',
                    background: 'rgba(58,214,140,0.1)', border: '1px solid rgba(58,214,140,0.35)', color: 'var(--fg3)',
                  }}>
                    {c.campaignKey} · {fmtInt(c.sales)} {c.sales === 1 ? 'venda' : 'vendas'} · <span style={{ color: 'var(--success)' }}>{fmtCurrency(c.grossUsd, 'USD', 0)}</span>
                  </span>
                ))}
              </div>
            )}
            {m.sales.sales === 0 && (
              <div style={{ fontSize: 11, color: 'var(--fg5)', marginTop: 8 }}>
                Nenhuma venda com utm_source={m.sales.utmSource} no período. Confira se os links dos SMS levam
                ?utm_source={m.sales.utmSource} até o checkout — a Digistore devolve os UTMs no IPN.
              </div>
            )}
          </div>

          {/* Bloco B — saúde por número */}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(actives.length, 2) || 1},1fr)`, gap: 12, marginBottom: 12 }}>
            {actives.map((n) => <SmsNumberCard key={`${n.subIndex}-${n.brand}`} n={n}/>)}
            {actives.length === 0 && (
              <div className="panel" style={{ padding: 20, color: 'var(--fg5)', fontSize: 12 }}>
                Nenhum número ativo com tráfego no período. Assim que o n8n reportar eventos, os cards de saúde aparecem aqui.
              </div>
            )}
          </div>
          {reserves.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${reserves.length},1fr)`, gap: 12, marginBottom: 12 }}>
              {reserves.map((n) => (
                <div key={`r-${n.subIndex}`} className="panel" style={{ padding: '10px 14px', opacity: 0.55 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontFamily: 'var(--f-display)', fontSize: 14, color: 'var(--fg3)' }}>
                        {n.brand || `Sub #${n.subIndex}`}
                      </div>
                      <div style={{ fontFamily: 'var(--f-mono)', fontSize: 9.5, color: 'var(--fg5)' }}>Reserva — sem tráfego</div>
                    </div>
                    <SmsHealthBadge level="idle"/>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Bloco C — tabela de campanhas */}
          <div className="panel" style={{ padding: 0, marginBottom: 12 }}>
            <div className="panel-head" style={{ padding: '12px 14px 0' }}>
              <div className="panel-title">
                Campanhas <span style={{ color: 'var(--fg5)', fontSize: 10, marginLeft: 6 }}>catálogo Mautic (snapshot horário) × telemetria · clique pra expandir</span>
              </div>
            </div>
            <div className="tbl-wrap" style={{ margin: 0, padding: '0 4px' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Campanha</th><th>Status Mautic</th><th>Marca</th>
                    <th className="num">Enviados</th><th className="num">Entrega %</th>
                    <th className="num">STOPs</th><th className="num">Descartados</th><th>Último envio</th>
                  </tr>
                </thead>
                <tbody>
                  {m.campaigns.length === 0 && (
                    <tr><td colSpan={8} style={{ textAlign: 'center', padding: 16, opacity: 0.6 }}>
                      Nenhuma campanha ainda — o snapshot do catálogo do Mautic chega de hora em hora.
                    </td></tr>
                  )}
                  {m.campaigns.map((c) => {
                    const key = c.slug || `mautic-${c.mauticId}`;
                    const isOpen = expanded === key;
                    return (
                      <React.Fragment key={key}>
                        <tr onClick={() => setExpanded(isOpen ? null : key)} style={{ cursor: 'pointer' }}>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ color: 'var(--fg2)' }}>{c.name || c.slug}</span>
                              {!c.slug && (
                                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 8.5, color: 'var(--fg5)', border: '1px solid var(--border-soft)', padding: '1px 6px', borderRadius: 'var(--r-full)', whiteSpace: 'nowrap' }}>
                                  SEM TELEMETRIA
                                </span>
                              )}
                            </div>
                            {c.slug && <div style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--fg5)', marginTop: 1 }}>{c.slug}</div>}
                          </td>
                          <td><SmsCampaignStatusBadge row={c}/></td>
                          <td style={{ fontSize: 11, color: 'var(--fg3)' }}>{c.brand || '—'}</td>
                          <td className="num">{fmtInt(c.sent)}</td>
                          <td className="num" style={{ color: c.deliveryRate != null && c.deliveryRate < 0.9 ? 'var(--danger)' : undefined }}>
                            {c.deliveryRate != null ? fmtPct(c.deliveryRate) : '—'}
                          </td>
                          <td className="num">{fmtInt(c.stops)}</td>
                          <td className="num" style={{ color: c.skipped > 0 ? '#ffd166' : undefined }}>{fmtInt(c.skipped)}</td>
                          <td className="cell-mono" style={{ fontSize: 10.5 }}>{fmtSmsWhen(c.lastSentAt)}</td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan={8} style={{ background: 'rgba(255,255,255,0.02)', padding: '10px 16px' }}>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16, alignItems: 'start' }}>
                                <div>
                                  <div className="eyebrow" style={{ fontSize: 8.5, marginBottom: 6 }}>DESCARTES POR MOTIVO</div>
                                  {c.skippedByReason.length === 0 && <div style={{ fontSize: 11, color: 'var(--fg5)' }}>Nenhum descarte no período.</div>}
                                  {c.skippedByReason.map((r) => (
                                    <div key={r.reason} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--fg3)', padding: '2px 0' }}>
                                      <span style={{ marginRight: 12 }}>{r.reason}</span>
                                      <span className="cell-mono" style={{ color: '#ffd166' }}>{fmtInt(r.count)}</span>
                                    </div>
                                  ))}
                                </div>
                                <div>
                                  <div className="eyebrow" style={{ fontSize: 8.5, marginBottom: 6 }}>ENVIOS POR DIA</div>
                                  {c.dailySent.length > 0
                                    ? <NSTimeSeries height={120} format="int" data={c.dailySent.map((d) => ({ date: d.date, enviados: d.sent }))}
                                        series={[{ key: 'enviados', label: 'Enviados', color: '#5BC8FF' }]}/>
                                    : <div style={{ fontSize: 11, color: 'var(--fg5)' }}>Sem envios no período.</div>}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bloco D — feed de diagnóstico (colapsável) */}
          <div className="panel" style={{ padding: 0, marginBottom: 12 }}>
            <div
              className="panel-head"
              style={{ padding: '12px 14px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              onClick={() => setFeedOpen((v) => !v)}
            >
              <div className="panel-title">
                Feed de diagnóstico
                <span style={{ color: 'var(--fg5)', fontSize: 10, marginLeft: 6 }}>últimos {m.feed.length} eventos · refresh 60s · horário BRT</span>
              </div>
              <Icon name={feedOpen ? 'chevron-down' : 'chevron-right'} size={14}/>
            </div>
            {feedOpen && (
              <>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '0 14px 10px' }}>
                  <button className={`chip ${feedType === '' ? 'is-active' : ''}`} onClick={() => setFeedType('')}>Todos</button>
                  {Object.keys(SMS_TYPE_META).map((t) => (
                    <button key={t} className={`chip ${feedType === t ? 'is-active' : ''}`} onClick={() => setFeedType(t)}>
                      {SMS_TYPE_META[t].label.toLowerCase()}
                    </button>
                  ))}
                </div>
                <div className="tbl-wrap" style={{ margin: 0, padding: '0 4px', maxHeight: 380, overflowY: 'auto' }}>
                  <table className="tbl">
                    <thead><tr><th>Quando</th><th>Evento</th><th>Marca</th><th>Campanha</th><th>Destino</th><th>Detalhe</th></tr></thead>
                    <tbody>
                      {feedRows.length === 0 && (
                        <tr><td colSpan={6} style={{ textAlign: 'center', padding: 16, opacity: 0.6 }}>Nenhum evento no período{feedType ? ' pra esse tipo' : ''}.</td></tr>
                      )}
                      {feedRows.map((f) => (
                        <tr key={f.id}>
                          <td className="cell-mono" style={{ fontSize: 10.5 }}>{fmtSmsWhen(f.occurredAt)}</td>
                          <td><SmsTypeChip type={f.type}/></td>
                          <td style={{ fontSize: 11, color: 'var(--fg3)' }}>{f.brand || '—'}</td>
                          <td className="cell-mono" style={{ fontSize: 10, color: 'var(--fg4)' }}>{f.campaign || '—'}</td>
                          <td className="cell-mono" style={{ fontSize: 10.5 }}>{f.toMasked || '—'}</td>
                          <td style={{ fontSize: 10.5, color: f.type === 'undelivered' || f.type === 'failed' ? '#ff8a8a' : 'var(--fg4)' }}>{f.detail || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg5)', lineHeight: 1.6 }}>
            Taxa de entrega = entregues ÷ status finais (delivered+undelivered+failed) — callbacks podem atrasar,
            então o denominador NÃO são os enviados. Pendentes = enviados há mais de 1h sem status final (sinal de
            callback quebrado). 30007 = filtragem de operadora — se recorrente, pausar a marca e acionar o parceiro.
            Semáforo: 🟢 entrega ≥95% e STOP &lt;1% · 🟡 entrega 90–95% ou STOP 1–2% ou qualquer 30007 em 24h ·
            🔴 entrega &lt;90% ou STOP &gt;2% ou ≥5× 30007 em 24h. Números de leads sempre mascarados.
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Captação · Email — placeholder "em breve" divertido. Sem backend:
// quando a fonte for integrada, troca esta página pela página real (mesma
// tab/rota, permissões já prontas). (SMS já virou página real — SmsPage.)
// ─────────────────────────────────────────────────────────────────────────────

const COMING_SOON_META = {
  sms: {
    icon: 'message-square',
    accent: '#5BC8FF',
    title: 'SMS',
    tagline: 'Mensagens curtas, receita comprida.',
    emoji: '📲',
    jokes: [
      'Digitando' ,
    ],
    steps: [
      { done: true,  label: 'Ideia aprovada (na reunião do café ☕)' },
      { done: true,  label: 'Aba criada no dashboard — você está literalmente dentro dela' },
      { done: false, label: 'Integração com a plataforma de disparo' },
      { done: false, label: 'Primeiro disparo · primeiros números pingando aqui' },
    ],
    footer: 'Quando o canal ligar, esta aba vira KPIs de verdade — vendas, receita e conversão por campanha, igual às abas Recuperação e Tauk.',
  },
  email: {
    icon: 'mail',
    accent: '#9b7bff',
    title: 'Email',
    tagline: 'O canal mais antigo da internet — e ainda um dos que mais pagam.',
    emoji: '📬',
    jokes: [
      'Aquecendo o domínio',
    ],
    steps: [
      { done: true,  label: 'Ideia aprovada (ninguém votou contra 🤝)' },
      { done: true,  label: 'Aba criada no dashboard — reservada e esperando' },
      { done: false, label: 'Aquecimento de domínio + integração da ferramenta de envio' },
      { done: false, label: 'Primeira campanha · open rate estreando aqui' },
    ],
    footer: 'Quando o canal ligar, esta aba vira KPIs de verdade — receita por campanha, cliques e conversão, igual às abas Recuperação e Tauk.',
  },
};

function ComingSoonPage({ channel }) {
  const meta = COMING_SOON_META[channel] || COMING_SOON_META.sms;
  const [dots, setDots] = useState(1);
  useEffect(() => {
    const t = setInterval(() => setDots((d) => (d % 3) + 1), 600);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="page-in">
      <style>{`
        @keyframes nsCsFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
        @keyframes nsCsRing { 0% { transform: scale(0.9); opacity: 0.55; } 100% { transform: scale(1.9); opacity: 0; } }
        @media (prefers-reduced-motion: reduce) {
          .ns-cs-float, .ns-cs-ring { animation: none !important; }
        }
      `}</style>

      <div className="page-head">
        <div className="lead">
          <span className="eyebrow" style={{ color: meta.accent }}>CAPTAÇÃO · {meta.title.toUpperCase()}</span>
          <h2>{meta.title} <em>marketing</em></h2>
          <span className="sub">{meta.tagline}</span>
        </div>
      </div>

      <div className="panel anim-in" style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
        padding: '56px 24px 44px', overflow: 'hidden', position: 'relative',
      }}>
        {/* glow de fundo */}
        <div style={{
          position: 'absolute', top: -120, left: '50%', transform: 'translateX(-50%)',
          width: 420, height: 300, borderRadius: '50%', filter: 'blur(80px)',
          background: `${meta.accent}22`, pointerEvents: 'none',
        }}/>

        {/* ícone flutuante com anéis pulsando */}
        <div style={{ position: 'relative', width: 110, height: 110, marginBottom: 22 }}>
          <div className="ns-cs-ring" style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            border: `1.5px solid ${meta.accent}`, animation: 'nsCsRing 2.4s ease-out infinite',
          }}/>
          <div className="ns-cs-ring" style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            border: `1.5px solid ${meta.accent}`, animation: 'nsCsRing 2.4s ease-out 1.2s infinite',
          }}/>
          <div className="ns-cs-float" style={{
            position: 'absolute', inset: 10, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: `linear-gradient(160deg, ${meta.accent}2e, ${meta.accent}10)`,
            border: `1px solid ${meta.accent}55`,
            boxShadow: `0 0 34px -6px ${meta.accent}80`,
            animation: 'nsCsFloat 3.2s ease-in-out infinite',
            fontSize: 38,
          }}>
            {meta.emoji}
          </div>
        </div>

        <span style={{
          fontFamily: 'var(--f-mono)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.18em',
          padding: '4px 14px', borderRadius: 'var(--r-full)', marginBottom: 14,
          background: `${meta.accent}1c`, color: meta.accent, border: `1px solid ${meta.accent}50`,
        }}>
          EM BREVE
        </span>

        <div style={{ fontFamily: 'var(--f-display)', fontSize: 30, color: 'var(--fg1)', letterSpacing: '-0.01em', marginBottom: 6 }}>
          {meta.title} está chegando
        </div>
        <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12.5, color: meta.accent, marginBottom: 30 }}>
          {meta.jokes[0]}{'.'.repeat(dots)}
        </div>

        {/* mini-roadmap */}
        <div style={{ display: 'grid', gap: 10, textAlign: 'left', minWidth: 300, maxWidth: 460, width: '100%', marginBottom: 28 }}>
          {meta.steps.map((s, i) => (
            <div key={i} className="anim-in" style={{
              display: 'flex', alignItems: 'center', gap: 10, '--i': i + 1,
              padding: '9px 13px', borderRadius: 9,
              background: s.done ? `${meta.accent}0e` : 'rgba(255,255,255,0.025)',
              border: `1px solid ${s.done ? `${meta.accent}40` : 'var(--border-soft)'}`,
              opacity: s.done ? 1 : 0.75,
            }}>
              <span style={{
                width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700,
                background: s.done ? `${meta.accent}28` : 'rgba(255,255,255,0.05)',
                color: s.done ? meta.accent : 'var(--fg5)',
                border: `1px solid ${s.done ? `${meta.accent}60` : 'var(--border-soft)'}`,
              }}>
                {s.done ? '✓' : i + 1}
              </span>
              <span style={{ fontSize: 12.5, color: s.done ? 'var(--fg2)' : 'var(--fg4)' }}>{s.label}</span>
            </div>
          ))}
        </div>

        {/* barra de progresso com shimmer (reusa .skel) */}
        <div style={{ width: '100%', maxWidth: 460, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg5)', marginBottom: 6 }}>
            <span>construção do canal</span><span style={{ color: meta.accent }}>~50%</span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
            <div className="skel" style={{ width: '50%', height: '100%', borderRadius: 4, background: `${meta.accent}55` }}/>
          </div>
        </div>

        <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--fg5)', maxWidth: 480, lineHeight: 1.7, marginTop: 10 }}>
          {meta.footer}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, {
  FunnelPage, LeaderboardPage, AffiliateDrawer, AllAffiliatesPage,
  ProductsPage, TransactionsPage, IntegrationsPage, FXPage, UsersPage,
  HealthPage, CostsPage, InsightsPage, NetworksPage,
  PartnerShell, ChatPage, ChatWidget,
  CopyOptimizerPage, RecoveryPage, TaukPage, SmsPage, ComingSoonPage,
});
