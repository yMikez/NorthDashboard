/* global React, Icon, NSTimeSeries, fmtCurrency, fmtInt, fmtPct, encodeSet */
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
function CostKpi({ label, value, icon, hint, accent, index, countValue, countFormat }) {
  const valueNode = (countValue != null && countFormat)
    ? <CountUp value={countValue} format={countFormat}/>
    : value;
  return (
    <div className="kpi anim-in" style={{ ...(accent ? { borderColor: accent + '4D' } : {}), ...(index != null ? { '--i': index } : {}) }}>
      <span className="corner-tl"/>
      <span className="corner-br"/>
      <div className="kpi-row">
        <span className="kpi-label">{label}</span>
        <span className="kpi-icon" style={accent ? { color: accent } : undefined}>
          <Icon name={icon} size={12}/>
        </span>
      </div>
      <div className="kpi-value" style={accent ? { color: accent } : undefined}>{valueNode}</div>
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
    return <SkelCustos/>;
  }
  if (state.status === 'error') {
    return <div className="page-in"><div className="panel" style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 10 }}>
      <Icon name="alert-triangle" size={16}/> Erro ao carregar: {state.error}
    </div></div>;
  }

  const { kpis, daily, byPlatform, byFamily, allowance } = state.data;

  // Série da composição de custos: os 4 componentes EMPILHADOS (a soma das
  // áreas é o custo total do dia) + bruto e lucro como linhas de referência.
  const chartData = daily.map((d) => ({
    date: d.date,
    gross: d.grossUsd,
    profit: d.profitUsd,
    fulfillment: d.fulfillmentUsd,
    cogs: d.cogsUsd,
    platformFees: d.platformFeesUsd,
    cpa: d.cpaUsd,
  }));
  const costSeries = [
    { key: 'platformFees', label: 'Plataforma', color: '#8B7FFF', stackId: 'cost' },
    { key: 'cpa', label: 'CPA', color: '#FFB14E', stackId: 'cost' },
    { key: 'cogs', label: 'Produção', color: '#FF8FCF', stackId: 'cost' },
    { key: 'fulfillment', label: 'Frete', color: '#4A90FF', stackId: 'cost' },
    { key: 'gross', label: 'Bruto', color: '#5BC8FF', kind: 'line' },
    { key: 'profit', label: 'Lucro', color: '#28C878', kind: 'line' },
  ];

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
          index={0}
          countValue={kpis.grossUsd} countFormat={(n) => fmtCurrency(n, cur, 0)}
          hint={kpis.refundsCount
            ? `− ${fmtCurrency(kpis.refundsUsd, cur, 0)} em ${fmtInt(kpis.refundsCount)} reemb.`
            : 'sem reembolsos no período'}
        />
        <CostKpi
          label="LUCRO ESTIMADO"
          icon="target"
          index={1}
          accent={kpis.profitUsd >= 0 ? 'var(--success)' : 'var(--danger)'}
          countValue={kpis.profitUsd} countFormat={(n) => fmtCurrency(n, cur, 0)}
          hint={`margem ${kpis.marginPct.toFixed(1)}%`}
        />
        <CostKpi
          label="TAXA PLATAFORMA"
          icon="plug"
          index={2}
          countValue={kpis.platformFeesUsd} countFormat={(n) => fmtCurrency(n, cur, 0)}
          hint={kpis.grossUsd > 0
            ? `${((kpis.platformFeesUsd / kpis.grossUsd) * 100).toFixed(1)}% do gross`
            : 'sem vendas'}
        />
        <CostKpi
          label="CPA AFILIADO"
          icon="users"
          index={3}
          countValue={kpis.cpaUsd} countFormat={(n) => fmtCurrency(n, cur, 0)}
          hint={kpis.grossUsd > 0
            ? `${((kpis.cpaUsd / kpis.grossUsd) * 100).toFixed(1)}% do gross`
            : 'sem vendas'}
        />
        <CostKpi
          label="PRODUÇÃO · POTES"
          icon="package"
          index={4}
          countValue={kpis.cogsUsd} countFormat={(n) => fmtCurrency(n, cur, 0)}
          hint={kpis.grossUsd > 0
            ? `${((kpis.cogsUsd / kpis.grossUsd) * 100).toFixed(1)}% · custo pago ao fornecedor (incl. refund)`
            : 'custo pago ao fornecedor por pote'}
        />
        <CostKpi
          label="FRETE · ENVIO"
          icon="map"
          index={5}
          countValue={kpis.fulfillmentUsd} countFormat={(n) => fmtCurrency(n, cur, 0)}
          hint={kpis.grossUsd > 0
            ? `${((kpis.fulfillmentUsd / kpis.grossUsd) * 100).toFixed(1)}% · transportadora (incl. refund)`
            : 'envio do pacote ao cliente'}
        />
        <CostKpi
          label="ALLOWANCE RESERVADO"
          icon="clock"
          index={6}
          countValue={kpis.allowanceReservedUsd} countFormat={(n) => fmtCurrency(n, cur, 0)}
          hint="estimativa rolling 60d"
        />
        <CostKpi
          label="MARGEM"
          icon="trending-up"
          index={7}
          accent={kpis.marginPct >= 10 ? 'var(--success)' : kpis.marginPct >= 5 ? 'var(--warning)' : 'var(--danger)'}
          countValue={kpis.marginPct} countFormat={(n) => n.toFixed(1) + '%'}
          hint={kpis.profitUsd >= 0 ? 'lucro / receita bruta' : 'NEGATIVA — revise custos'}
        />
      </div>

      {/* Série temporal — composição de custos empilhada + bruto/lucro */}
      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-head">
          <div className="panel-title">
            <span className="panel-eyebrow">COMPOSIÇÃO DIÁRIA · CUSTOS EMPILHADOS vs BRUTO E LUCRO</span>
            <div className="panel-metric">
              {fmtCurrency(kpis.profitUsd, cur, 0)}
              <span className={`delta ${kpis.profitUsd >= 0 ? 'up' : 'down'}`}>
                margem {kpis.marginPct.toFixed(1)}%
              </span>
            </div>
          </div>
        </div>
        <NSTimeSeries data={chartData} series={costSeries} height={280}
          currency={cur} toggles brush="auto"/>
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
