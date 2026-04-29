/* global React, useState, useMemo, Icon, Sparkline, LineChart, Donut, CountryBars,
   fmtCurrency, fmtInt, avatarColor, initials */
/* Overview page: fetches /api/metrics/overview, renders 8 KPIs + charts + tables. */

const { useEffect: useEffectOv } = React;

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

const PRODUCT_TYPE_LABELS = {
  FRONTEND: 'Front-end',
  UPSELL: 'Upsell',
  BUMP: 'Bump',
  DOWNSELL: 'Downsell',
};

const PRODUCT_TYPE_COLORS = {
  FRONTEND: '#5BC8FF',
  UPSELL: '#4A90FF',
  BUMP: '#8B7FFF',
  DOWNSELL: '#6b84b8',
};

const COUNTRY_NAMES = {
  US: 'United States', CA: 'Canada', UK: 'United Kingdom', GB: 'United Kingdom',
  AU: 'Australia', DE: 'Germany', NZ: 'New Zealand', IE: 'Ireland', NL: 'Netherlands',
  FR: 'France', ES: 'Spain', IT: 'Italy', BR: 'Brazil', MX: 'Mexico', JP: 'Japan',
};

const PLATFORM_VARIANTS = {
  digistore24: { short: 'D24', className: 'plat-d24' },
  clickbank: { short: 'CB', className: 'plat-cb' },
};

function deltaFor(cur, prev) {
  if (prev === undefined || prev === null) return { delta: '—', trend: 'flat' };
  if (prev === 0) {
    if (cur === 0) return { delta: '0%', trend: 'flat' };
    // Sem baseline pra comparar — mostra "novo" em vez de infinito.
    return { delta: 'novo', trend: 'up' };
  }
  const d = (cur - prev) / prev;
  // Cap em ±999% pra não poluir a UI com valores estratosféricos
  // quando o período anterior teve volume residual (ex.: 2 pedidos
  // virando 200 = +9900% que estoura visualmente).
  if (Math.abs(d) > 9.99) {
    return {
      delta: (d > 0 ? '>+999%' : '<-999%'),
      trend: d > 0 ? 'up' : 'down',
    };
  }
  return {
    delta: (d >= 0 ? '+' : '') + (d * 100).toFixed(1) + '%',
    trend: d >= 0.002 ? 'up' : d <= -0.002 ? 'down' : 'flat',
  };
}

function OverviewPage({ filters }) {
  const [state, setState] = useStateApp({ status: 'loading', data: null, error: null });
  const [metric, setMetric] = useState('gross');

  useEffectOv(() => {
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading' }));
    window.NSApi.fetchOverview({ ...filters, compare: true })
      .then((data) => {
        if (cancelled) return;
        setState({ status: 'ready', data, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('fetchOverview failed', err);
        setState({ status: 'error', data: null, error: err.message });
      });
    return () => { cancelled = true; };
  }, [filters.dateRange.start.getTime(), filters.dateRange.end.getTime(),
      encodeSet(filters.platforms), encodeSet(filters.countries),
      encodeSet(filters.funnels), encodeSet(filters.families), filters.compare]);

  const cur = filters.currency || 'USD';

  if (state.status === 'loading' && !state.data) {
    return <div className="page-in"><div className="panel">Carregando métricas...</div></div>;
  }
  if (state.status === 'error') {
    return <div className="page-in"><div className="panel" style={{ color: 'var(--danger)' }}>
      Erro ao carregar: {state.error}
    </div></div>;
  }

  const { kpis, previous, daily, byCountry, byProductType, topAffiliates, platformHealth } = state.data;
  const prev = previous || {};

  const buckets = daily.map((b) => ({
    date: new Date(b.date),
    gross: b.gross,
    net: b.net,
    cpa: b.cpa,
    cogs: b.cogs ?? 0,
    fulfillment: b.fulfillment ?? 0,
    profit: b.profit ?? 0,
    orders: b.approvedOrders,
    approvedOrders: b.approvedOrders,
    allOrders: b.allOrders,
  }));

  const sparkGross = buckets.map((b) => b.gross);
  const sparkNet = buckets.map((b) => b.net);
  const sparkOrders = buckets.map((b) => b.approvedOrders);
  const sparkAov = buckets.map((b) => (b.approvedOrders ? b.gross / b.approvedOrders : 0));
  const approvalSpark = buckets.map((b) => (b.allOrders ? b.approvedOrders / b.allOrders : 0));

  const typeItems = ['FRONTEND', 'UPSELL', 'BUMP', 'DOWNSELL'].map((key) => {
    const found = byProductType.find((x) => x.label === key);
    return {
      label: PRODUCT_TYPE_LABELS[key],
      value: found ? found.value : 0,
      color: PRODUCT_TYPE_COLORS[key],
    };
  });

  const countryData = byCountry.map((c) => ({
    code: c.code,
    name: COUNTRY_NAMES[c.code] || c.code,
    value: c.value,
    orders: c.orders,
  }));
  const maxCountry = Math.max(1, ...countryData.map((c) => c.value));

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">{filters.preset.toUpperCase()} · TIER 1 GLOBAL · USD</span>
          <h2>Operação <em>em tempo real</em></h2>
          <span className="sub">{fmtRange(filters.dateRange)} · dados unificados ClickBank + Digistore24</span>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-ghost"><Icon name="calendar" size={12}/> Agendar relatório</button>
          <button className="btn btn-primary"><Icon name="plus" size={12}/> Nova visão</button>
        </div>
      </div>

      <div className="kpi-grid">
        <KpiCard label="RECEITA BRUTA" icon="dollar"
          value={fmtCurrency(kpis.gross, cur, 0)}
          {...deltaFor(kpis.gross, prev.gross)}
          sparkData={sparkGross}/>
        <KpiCard label="RECEITA LÍQUIDA" icon="wallet"
          value={fmtCurrency(kpis.net, cur, 0)}
          {...deltaFor(kpis.net, prev.net)}
          sparkData={sparkNet}/>
        <KpiCard label="PEDIDOS APROVADOS" icon="shopping-cart"
          value={fmtInt(kpis.approvedCount)}
          {...deltaFor(kpis.approvedCount, prev.approvedCount)}
          sparkData={sparkOrders}/>
        <KpiCard label="AOV" icon="trending-up"
          value={fmtCurrency(kpis.aov, cur, 2)}
          {...deltaFor(kpis.aov, prev.aov)}
          sparkData={sparkAov}/>
        <KpiCard label="TAXA DE APROVAÇÃO" icon="check"
          value={(kpis.approvalRate * 100).toFixed(1)} unit="%"
          {...deltaFor(kpis.approvalRate, prev.approvalRate)}
          sparkData={approvalSpark}/>
        <KpiCard label="TAXA DE REEMBOLSO" icon="refresh"
          value={(kpis.refundRate * 100).toFixed(2)} unit="%"
          {...deltaFor(kpis.refundRate, prev.refundRate)}
          trend={kpis.refundRate > (prev.refundRate ?? 0) ? 'down' : 'up'}/>
        <KpiCard label="CHARGEBACK" icon="alert-triangle"
          alert={kpis.cbRate > 0.009}
          value={(kpis.cbRate * 100).toFixed(2)} unit="%"
          {...deltaFor(kpis.cbRate, prev.cbRate)}
          trend={kpis.cbRate > (prev.cbRate ?? 0) ? 'down' : 'up'}
          hint={kpis.cbRate > 0.009 ? 'acima do limite' : 'vs anterior'}/>
        <KpiCard label="LUCRO ESTIMADO" icon="target"
          alert={kpis.estimatedProfit < 0}
          value={fmtCurrency(kpis.estimatedProfit ?? kpis.netProfit, cur, 0)}
          {...deltaFor(kpis.estimatedProfit ?? kpis.netProfit, prev.estimatedProfit ?? prev.netProfit)}
          hint={kpis.estimatedMarginPct != null
            ? `margem ${kpis.estimatedMarginPct.toFixed(1)}%`
            : 'inclui COGS + frete'}/>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-head">
          <div className="panel-title">
            <span className="panel-eyebrow">SÉRIE TEMPORAL · DIÁRIA</span>
            <div className="panel-metric">
              {metric === 'gross' && <>{fmtCurrency(kpis.gross, cur, 0)}
                <span className={`delta ${deltaFor(kpis.gross, prev.gross).trend}`}>{deltaFor(kpis.gross, prev.gross).delta}</span></>}
              {metric === 'net' && <>{fmtCurrency(kpis.net, cur, 0)}
                <span className={`delta ${deltaFor(kpis.net, prev.net).trend}`}>{deltaFor(kpis.net, prev.net).delta}</span></>}
              {metric === 'orders' && <>{fmtInt(kpis.approvedCount)}
                <span className={`delta ${deltaFor(kpis.approvedCount, prev.approvedCount).trend}`}>{deltaFor(kpis.approvedCount, prev.approvedCount).delta}</span></>}
              {metric === 'aov' && <>{fmtCurrency(kpis.aov, cur, 2)}
                <span className={`delta ${deltaFor(kpis.aov, prev.aov).trend}`}>{deltaFor(kpis.aov, prev.aov).delta}</span></>}
              {metric === 'approvalRate' && <>{(kpis.approvalRate * 100).toFixed(1)}%
                <span className={`delta ${deltaFor(kpis.approvalRate, prev.approvalRate).trend}`}>{deltaFor(kpis.approvalRate, prev.approvalRate).delta}</span></>}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div className="metric-seg">
              {[['gross','Bruto'],['net','Líquido'],['profit','Lucro'],['orders','Pedidos'],['aov','AOV'],['approvalRate','Aprovação']].map(([k, l]) => (
                <button key={k} className={`metric-opt ${metric === k ? 'is-active' : ''}`} onClick={() => setMetric(k)}>{l}</button>
              ))}
            </div>
            <div className="panel-legend">
              <span className="legend-dot cyan"><span/>{filters.preset.toUpperCase()}</span>
            </div>
          </div>
        </div>
        <LineChart buckets={buckets} compareBuckets={null}
          metric={metric} currency={cur} height={260}/>
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">
              <span className="panel-eyebrow">RECEITA POR TIPO DE PRODUTO</span>
              <div className="panel-sub">Apenas pedidos aprovados · receita bruta</div>
            </div>
          </div>
          <Donut items={typeItems} totalLabel="Aprovado" format={(v) => fmtCurrency(v, cur, 0)}/>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">
              <span className="panel-eyebrow">RECEITA POR PAÍS</span>
              <div className="panel-sub">Top 8 · receita bruta aprovada</div>
            </div>
          </div>
          <CountryBars data={countryData} maxValue={maxCountry} currency={cur}/>
        </div>
      </div>

      <div className="grid-2-asym">
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">
              <span className="panel-eyebrow">TOP 5 AFILIADOS</span>
              <div className="panel-sub">Ordenados por receita bruta</div>
            </div>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 28 }}>#</th>
                  <th>Afiliado</th>
                  <th>Plataforma</th>
                  <th className="num">Pedidos</th>
                  <th className="num">Receita</th>
                  <th className="num">Aprovação</th>
                  <th className="num">Margem</th>
                </tr>
              </thead>
              <tbody>
                {topAffiliates.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', opacity: 0.6, padding: 24 }}>
                    Sem afiliados no período
                  </td></tr>
                )}
                {/* placeholder mantido em PT-BR */}
                {topAffiliates.map((a, i) => {
                  const plat = PLATFORM_VARIANTS[a.platformSlug] || { short: a.platformSlug.toUpperCase(), className: 'plat-cb' };
                  const apClass = a.approvalRate > 0.7 ? 'val-ok' : a.approvalRate > 0.5 ? 'val-warn' : 'val-bad';
                  const displayName = a.nickname || a.externalId;
                  return (
                    <tr key={`${a.platformSlug}:${a.externalId}`}>
                      <td className="rank">{String(i+1).padStart(2, '0')}</td>
                      <td>
                        <span className="cell-aff">
                          <span className="av" style={{ background: avatarColor(a.externalId) }}>{initials(displayName)}</span>
                          <span className="meta">
                            <span className="nm">{displayName}</span>
                            <span className="id">{a.externalId}</span>
                          </span>
                        </span>
                      </td>
                      <td><span className={`plat ${plat.className}`}>{plat.short}</span></td>
                      <td className="num cell-mono">{fmtInt(a.orders)}</td>
                      <td className="num cell-mono">{fmtCurrency(a.revenue, cur, 0)}</td>
                      <td className={`num cell-mono ${apClass}`}>{(a.approvalRate * 100).toFixed(1)}%</td>
                      <td className="num cell-mono" style={{ color: a.netMargin > 0 ? 'var(--success)' : 'var(--danger)' }}>
                        {fmtCurrency(a.netMargin, cur, 0)}
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
              <span className="panel-eyebrow">SAÚDE DAS PLATAFORMAS</span>
              <div className="panel-sub">Status dos connectors em tempo real</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {platformHealth.map((p) => {
              const variant = PLATFORM_VARIANTS[p.slug] || { short: p.slug.slice(0,3).toUpperCase() };
              return (
                <PlatformHealth
                  key={p.slug}
                  name={p.displayName}
                  short={variant.short}
                  ok
                  revenue={p.totalRevenue}
                  orders={p.totalOrders}
                  lastSync={p.lastSyncAt ? fmtSyncAgo(p.lastSyncAt) : '—'}
                  currency={cur}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Heatmap movido pro fim — visualização densa, secundária pra
          decisão rápida. KPIs + série + breakdowns vêm primeiro. */}
      <div className="panel" style={{ marginTop: 14 }}>
        <div className="panel-head">
          <div className="panel-title">
            <span className="panel-eyebrow">PADRÃO DE COMPRA · HORA × DIA DA SEMANA</span>
            <div className="panel-sub">Pedidos aprovados · UTC · hover pra ver detalhe</div>
          </div>
          <div className="panel-legend">
            <span className="legend-dot cyan"><span/>intensidade = volume</span>
          </div>
        </div>
        <HourHeatmap data={state.data?.hourlyHeatmap || []} metric="orders" currency={cur}/>
      </div>
    </div>
  );
}

function PlatformHealth({ name, short, ok, revenue, orders, lastSync, currency }) {
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

function fmtRange(range) {
  const start = range.start instanceof Date ? range.start : new Date(range.start);
  const end = range.end instanceof Date ? range.end : new Date(range.end);
  const opts = { month: 'short', day: 'numeric' };
  return `${start.toLocaleDateString('en-US', opts)} → ${end.toLocaleDateString('en-US', opts)}`;
}

function fmtSyncAgo(iso) {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

// encodeSet declared in index.html script scope — fallback here in case of load order
function encodeSet(set) {
  if (!set || set.size === 0) return '';
  return Array.from(set).join(',');
}

Object.assign(window, { OverviewPage });
