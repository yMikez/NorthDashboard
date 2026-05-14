/* global React, Icon, LineChart, fmtCurrency, fmtInt, fmtPct, encodeSet */
/* Custos page: fetches /api/metrics/costs-overview, renders KPIs +
   daily chart com lente de custos + tabelas por plataforma e família +
   card de allowance rolling 60d. */

const { useState: useStateCu, useEffect: useEffectCu } = React;

const FAMILY_PALETTE_CU = [
  '#5BC8FF', '#8B7FFF', '#FFB14E', '#28C878', '#FF6B6B',
  '#4A90FF', '#FF8FCF', '#6BD9A8', '#FFD15B', '#A084FF',
];

function familyAccentCu(family) {
  if (!family) return '#6b84b8';
  let h = 0;
  for (let i = 0; i < family.length; i++) h = (h * 31 + family.charCodeAt(i)) | 0;
  return FAMILY_PALETTE_CU[Math.abs(h) % FAMILY_PALETTE_CU.length];
}

// Cards "mini": números secos pro card de allowance. Não usar KpiCard
// (sem sparkline, sem delta — esses números não têm comparação de período).
function MiniStat({ label, value, sub, color }) {
  return (
    <div className="mini-kpi" style={color ? { borderColor: color + '4D' } : undefined}>
      <div className="l">{label}</div>
      <div className="v" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="s">{sub}</div>}
    </div>
  );
}

// KpiCard simplificado (sem delta vs período anterior, sem sparkline).
// /custos não usa o modo compare; visualizações são "este período é assim".
function CostKpi({ label, value, icon, hint, accent }) {
  return (
    <div className="kpi" style={accent ? { borderColor: accent + '4D' } : undefined}>
      <span className="corner-tl"/>
      <span className="corner-br"/>
      <div className="kpi-row">
        <span className="kpi-label">{label}</span>
        <span className="kpi-icon" style={accent ? { color: accent } : undefined}>
          <Icon name={icon} size={12}/>
        </span>
      </div>
      <div className="kpi-value" style={accent ? { color: accent } : undefined}>{value}</div>
      {hint && (
        <div className="kpi-foot">
          <span className="delta flat" style={{ background: 'transparent' }}>{hint}</span>
        </div>
      )}
    </div>
  );
}

function CustosPage({ filters }) {
  const [state, setState] = useStateCu({ status: 'loading', data: null, error: null });
  const [metric, setMetric] = useStateCu('profit');

  useEffectCu(() => {
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading' }));
    window.NSApi.fetchCostsOverview(filters)
      .then((data) => {
        if (cancelled) return;
        setState({ status: 'ready', data, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('fetchCostsOverview failed', err);
        setState({ status: 'error', data: null, error: err.message });
      });
    return () => { cancelled = true; };
  }, [filters.dateRange.start.getTime(), filters.dateRange.end.getTime(),
      encodeSet(filters.platforms), encodeSet(filters.countries),
      encodeSet(filters.funnels), encodeSet(filters.families)]);

  const cur = filters.currency || 'USD';

  if (state.status === 'loading' && !state.data) {
    return <div className="page-in"><div className="panel">Carregando custos...</div></div>;
  }
  if (state.status === 'error') {
    return <div className="page-in"><div className="panel" style={{ color: 'var(--danger)' }}>
      Erro ao carregar: {state.error}
    </div></div>;
  }

  const { kpis, daily, byPlatform, byFamily, allowance } = state.data;

  // Buckets do LineChart: o componente espera fields com nomes específicos.
  // gross/profit nativos; fulfillment/cogs/platformFees/cpa via passthrough.
  const buckets = daily.map((d) => ({
    date: new Date(d.date),
    gross: d.grossUsd,
    profit: d.profitUsd,
    fulfillment: d.fulfillmentUsd,
    cogs: d.cogsUsd,
    platformFees: d.platformFeesUsd,
    cpa: d.cpaUsd,
    // campos requeridos pela LineChart (denoms) — defaults seguros
    net: d.grossUsd, approvedOrders: 0, allOrders: 0,
  }));

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">{filters.preset.toUpperCase()} · MARGEM & CUSTOS</span>
          <h2>Custos <em>e lucro real</em></h2>
          <span className="sub">
            Gross aprovado − taxa plataforma − CPA − COGS − frete · estimativa de allowance rolling 60d
          </span>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-ghost" onClick={() => window.NSNavigate('costs')}>
            <Icon name="wallet" size={12}/> Editar custos & frete
          </button>
          <button className="btn btn-ghost" onClick={() => window.NSNavigate('platforms')}>
            <Icon name="plug" size={12}/> Editar taxas plataforma
          </button>
        </div>
      </div>

      <div className="kpi-grid">
        <CostKpi
          label="RECEITA BRUTA"
          icon="dollar"
          value={fmtCurrency(kpis.grossUsd, cur, 0)}
          hint={kpis.refundsCount
            ? `− ${fmtCurrency(kpis.refundsUsd, cur, 0)} em ${fmtInt(kpis.refundsCount)} reemb.`
            : 'sem reembolsos no período'}
        />
        <CostKpi
          label="LUCRO ESTIMADO"
          icon="target"
          accent={kpis.profitUsd >= 0 ? 'var(--success)' : 'var(--danger)'}
          value={fmtCurrency(kpis.profitUsd, cur, 0)}
          hint={`margem ${kpis.marginPct.toFixed(1)}%`}
        />
        <CostKpi
          label="TAXA PLATAFORMA"
          icon="plug"
          value={fmtCurrency(kpis.platformFeesUsd, cur, 0)}
          hint={kpis.grossUsd > 0
            ? `${((kpis.platformFeesUsd / kpis.grossUsd) * 100).toFixed(1)}% do gross`
            : 'sem vendas'}
        />
        <CostKpi
          label="CPA AFILIADO"
          icon="users"
          value={fmtCurrency(kpis.cpaUsd, cur, 0)}
          hint={kpis.grossUsd > 0
            ? `${((kpis.cpaUsd / kpis.grossUsd) * 100).toFixed(1)}% do gross`
            : 'sem vendas'}
        />
        <CostKpi
          label="COGS · POTES"
          icon="package"
          value={fmtCurrency(kpis.cogsUsd, cur, 0)}
          hint={kpis.grossUsd > 0
            ? `${((kpis.cogsUsd / kpis.grossUsd) * 100).toFixed(1)}% do gross`
            : 'custo de produção'}
        />
        <CostKpi
          label="FRETE · FULFILLMENT"
          icon="map"
          value={fmtCurrency(kpis.fulfillmentUsd, cur, 0)}
          hint={kpis.grossUsd > 0
            ? `${((kpis.fulfillmentUsd / kpis.grossUsd) * 100).toFixed(1)}% do gross`
            : 'envio dos pedidos'}
        />
        <CostKpi
          label="ALLOWANCE RESERVADO"
          icon="clock"
          value={fmtCurrency(kpis.allowanceReservedUsd, cur, 0)}
          hint="estimativa rolling 60d"
        />
        <CostKpi
          label="MARGEM"
          icon="trending-up"
          accent={kpis.marginPct >= 10 ? 'var(--success)' : kpis.marginPct >= 5 ? 'var(--warning)' : 'var(--danger)'}
          value={kpis.marginPct.toFixed(1) + '%'}
          hint={kpis.profitUsd >= 0 ? 'lucro / receita bruta' : 'NEGATIVA — revise custos'}
        />
      </div>

      {/* Série temporal — switch entre métricas de custo */}
      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-head">
          <div className="panel-title">
            <span className="panel-eyebrow">SÉRIE TEMPORAL · DIÁRIA</span>
            <div className="panel-metric">
              {metric === 'gross' && fmtCurrency(kpis.grossUsd, cur, 0)}
              {metric === 'profit' && fmtCurrency(kpis.profitUsd, cur, 0)}
              {metric === 'platformFees' && fmtCurrency(kpis.platformFeesUsd, cur, 0)}
              {metric === 'cpa' && fmtCurrency(kpis.cpaUsd, cur, 0)}
              {metric === 'cogs' && fmtCurrency(kpis.cogsUsd, cur, 0)}
              {metric === 'fulfillment' && fmtCurrency(kpis.fulfillmentUsd, cur, 0)}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div className="metric-seg">
              {[
                ['profit', 'Lucro'],
                ['gross', 'Bruto'],
                ['platformFees', 'Plataforma'],
                ['cpa', 'CPA'],
                ['cogs', 'COGS'],
                ['fulfillment', 'Frete'],
              ].map(([k, l]) => (
                <button
                  key={k}
                  className={`metric-opt ${metric === k ? 'is-active' : ''}`}
                  onClick={() => setMetric(k)}
                >{l}</button>
              ))}
            </div>
          </div>
        </div>
        <LineChart buckets={buckets} compareBuckets={null}
          metric={metric} currency={cur} height={260}/>
      </div>

      {/* Allowance — 3 mini stats lado a lado */}
      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-head">
          <div className="panel-title">
            <span className="panel-eyebrow">ALLOWANCE · RESERVADO PELAS PLATAFORMAS</span>
            <div className="panel-sub">
              Estimativa rolling 60 dias. Independente do filtro de período — sempre "agora".
              Plataformas que liberam reserva após 60d (ex: Digistore) tem o valor calculado a partir do
              gross dos últimos 60 dias × allowance%.
            </div>
          </div>
        </div>
        <div className="mini-kpis" style={{ marginBottom: 12 }}>
          <MiniStat label="Reservado hoje" value={fmtCurrency(allowance.reservedTodayUsd, cur, 0)}
            sub="estimado — não disponível pra payout"/>
          <MiniStat label="Libera nos próximos 7 dias"
            value={fmtCurrency(allowance.releasingNext7DaysUsd, cur, 0)}
            sub="cohort 53–60 dias atrás" color="var(--success)"/>
          <MiniStat label="Libera nos próximos 30 dias"
            value={fmtCurrency(allowance.releasingNext30DaysUsd, cur, 0)}
            sub="cohort 30–60 dias atrás" color="var(--success)"/>
        </div>
        {allowance.byPlatform.length > 0 && (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Plataforma</th>
                  <th className="num">Allowance %</th>
                  <th className="num">Reservado (60d)</th>
                </tr>
              </thead>
              <tbody>
                {allowance.byPlatform.map((p) => (
                  <tr key={p.slug}>
                    <td>{p.displayName}</td>
                    <td className="num cell-mono">{p.allowancePct.toFixed(2)}%</td>
                    <td className="num cell-mono">{fmtCurrency(p.reservedUsd, cur, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {allowance.byPlatform.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--fg4)', padding: '8px 4px' }}>
            Nenhuma plataforma com allowance% cadastrado.{' '}
            <a href="/platforms" style={{ color: 'var(--glow-cyan)' }}>Configurar agora →</a>
          </div>
        )}
      </div>

      {/* Por plataforma */}
      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-head">
          <div className="panel-title">
            <span className="panel-eyebrow">POR PLATAFORMA</span>
            <div className="panel-sub">
              Taxa efetiva = (fees + tax do IPN) ÷ gross. Para plataformas sem breakdown no IPN
              (ClickBank), usa o feeRatePct cadastrado.
            </div>
          </div>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Plataforma</th>
                <th className="num">Bruto</th>
                <th className="num">Taxa ($)</th>
                <th className="num">Taxa (%)</th>
                <th className="num">CPA</th>
                <th className="num">COGS + Frete</th>
                <th className="num">Lucro</th>
                <th className="num">Margem</th>
              </tr>
            </thead>
            <tbody>
              {byPlatform.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', opacity: 0.6, padding: 24 }}>
                  Sem vendas aprovadas no período
                </td></tr>
              )}
              {byPlatform.map((p) => {
                const operating = p.cogsUsd + p.fulfillmentUsd;
                return (
                  <tr key={p.slug}>
                    <td>{p.displayName}</td>
                    <td className="num cell-mono">{fmtCurrency(p.grossUsd, cur, 0)}</td>
                    <td className="num cell-mono">{fmtCurrency(p.platformFeesUsd, cur, 0)}</td>
                    <td className="num cell-mono" style={{ color: 'var(--fg3)' }}>
                      {p.feeRatePctEffective.toFixed(2)}%
                    </td>
                    <td className="num cell-mono">{fmtCurrency(p.cpaUsd, cur, 0)}</td>
                    <td className="num cell-mono">{fmtCurrency(operating, cur, 0)}</td>
                    <td className="num cell-mono"
                      style={{ color: p.profitUsd >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                      {fmtCurrency(p.profitUsd, cur, 0)}
                    </td>
                    <td className="num cell-mono"
                      style={{ color: p.marginPct >= 10 ? 'var(--success)' : p.marginPct >= 5 ? 'var(--warning)' : 'var(--danger)' }}>
                      {p.marginPct.toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Por família */}
      <div className="panel">
        <div className="panel-head">
          <div className="panel-title">
            <span className="panel-eyebrow">POR FAMÍLIA DE PRODUTO</span>
            <div className="panel-sub">
              Margem só conta COGS + frete (taxa plataforma e CPA não são atribuídos por família).
              Famílias marcadas PLACEHOLDER ainda não têm custo unitário cadastrado.
            </div>
          </div>
          <div className="page-head-actions">
            <button className="btn btn-ghost" onClick={() => window.NSNavigate('costs')}>
              <Icon name="wallet" size={12}/> Editar custos
            </button>
          </div>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Família</th>
                <th className="num">Bruto</th>
                <th className="num">COGS</th>
                <th className="num">Frete</th>
                <th className="num">Lucro op.</th>
                <th className="num">Margem op.</th>
              </tr>
            </thead>
            <tbody>
              {byFamily.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', opacity: 0.6, padding: 24 }}>
                  Sem vendas no período
                </td></tr>
              )}
              {byFamily.map((f) => (
                <tr key={f.family}>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: familyAccentCu(f.family),
                      }}/>
                      {f.family === '_unknown' ? 'Sem classificação' : f.family}
                      {!f.isCataloged && (
                        <span title="Família sem custo unitário cadastrado — COGS pode estar zerado ou usando placeholder. Vá em /costs pra atualizar."
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
                  <td className="num cell-mono">{fmtCurrency(f.grossUsd, cur, 0)}</td>
                  <td className="num cell-mono">{fmtCurrency(f.cogsUsd, cur, 0)}</td>
                  <td className="num cell-mono">{fmtCurrency(f.fulfillmentUsd, cur, 0)}</td>
                  <td className="num cell-mono"
                    style={{ color: f.profitUsd >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                    {fmtCurrency(f.profitUsd, cur, 0)}
                  </td>
                  <td className="num cell-mono"
                    style={{ color: f.marginPct >= 50 ? 'var(--success)' : f.marginPct >= 30 ? 'var(--warning)' : 'var(--danger)' }}>
                    {f.marginPct.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { CustosPage });
