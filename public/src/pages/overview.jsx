/* global React, Icon, Sparkline, NSTimeSeries, Donut, CountUp, SkelOverview, RefundCoverageNotice,
   fmtCurrency, fmtInt, fmtDateShort, avatarColor, initials, platBadge */
/* Visão geral (reforma de 2026-10-23): série temporal no topo com seletor de
   métrica, 7 KPIs, receita por estágio de captação (rosca + dia a dia) e top 5
   afiliados. Dados: /api/metrics/overview (daily_metrics) +
   /api/metrics/overview-panels (estágios, reembolso 60d, séries de reembolso,
   Net after CPA e AOV por sessão). */

const { useEffect: useEffectOv, useState: useStateOv } = React;

// TODO: thresholds eventualmente vão pra Settings UI. Por enquanto
// hardcoded — alinhado com operação real do user (validado 2026-04-29).
const KPI_THRESHOLDS = {
  approvalRate: {
    label: () => 'meta 90%',
    state: (v) => v >= 0.90 ? 'ok' : v >= 0.85 ? 'warn' : 'danger',
  },
  refundRate: {
    // Sem meta dura — só sinaliza acima de 8% (chargeback amplifica em 1%).
    label: (v) => v > 0.08 ? 'acima da meta (≤8%)' : 'meta ≤8%',
    state: (v) => v > 0.10 ? 'danger' : v > 0.08 ? 'warn' : 'ok',
  },
  cbRate: {
    label: () => 'limite 2.0% · atenção 1.0%',
    state: (v) => v >= 0.02 ? 'danger' : v >= 0.01 ? 'warn' : 'ok',
  },
  // Sem card na tela; fica aqui porque a IA usa a mesma régua
  // (lib/ai/kpiThresholds.ts — o teste compara as duas).
  estimatedMarginPct: {
    // estimatedMarginPct vem como %, ex: 6.6 = 6.6%
    label: () => null,
    state: (v) => v < 5 ? 'danger' : v < 10 ? 'warn' : 'ok',
  },
};

// Computa display + arrow + good (semântico, baseado em directionPreference).
function deltaFor(cur, prev, directionPreference = 'higher') {
  if (prev === undefined || prev === null) return { display: '—', delta: '—', trend: 'flat', good: null };
  if (prev === 0) {
    if (cur === 0) return { display: '0%', delta: '0%', trend: 'flat', good: null };
    return { display: 'novo', delta: 'novo', trend: 'up', good: null };
  }
  const d = (cur - prev) / prev;
  // Cap: |delta| > 999% vira "—" (overflow visual, dado pouco confiável).
  if (Math.abs(d) > 9.99) return { display: '—', delta: '—', trend: 'flat', good: null };
  const display = (d >= 0 ? '+' : '') + (d * 100).toFixed(1) + '%';
  if (Math.abs(d) < 0.002) return { display, delta: display, trend: 'flat', good: null };
  const trend = d > 0 ? 'up' : 'down';
  let good = null;
  if (directionPreference === 'higher') good = d > 0;
  else if (directionPreference === 'lower') good = d < 0;
  return { display, delta: display, trend, good };
}

// Tom de cada card (faixa no topo, ícone, ponto e sparkline). Métrica em que
// "menor é melhor" (reembolso, chargeback) leva o coral de risco; as demais
// alternam pela posição pra grade não virar um bloco de uma cor só.
const KPI_TONES = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-4)', 'var(--chart-3)'];

function KpiCard({
  label, value, unit, icon, alert, hint, sparkData,
  cur, prev, directionPreference = 'higher',
  threshold, hideSparkline, onClick,
  index, countValue, countFormat, money, sub, tone,
}) {
  const kpiTone = alert ? 'var(--danger)'
    : tone || (directionPreference === 'lower' ? 'var(--chart-5)' : KPI_TONES[(index || 0) % KPI_TONES.length]);
  const { display, trend, good } = deltaFor(cur, prev, directionPreference);
  const colorClass = good === true ? 'good' : good === false ? 'bad' : 'flat';
  const arrowIcon = trend === 'up' ? 'arrow-up-right'
                  : trend === 'down' ? 'arrow-down-right'
                  : 'trending-up';
  // Count-up animado quando o valor numérico bruto + formatter são passados;
  // senão usa o `value` já formatado (retrocompat).
  const valueNode = (countValue != null && countFormat)
    ? <CountUp value={countValue} format={countFormat}/>
    : value;
  return (
    <div
      className={`kpi anim-in ${alert ? 'is-alert' : ''} ${onClick ? 'is-clickable' : ''}`}
      style={{ '--kpi-tone': kpiTone, ...(index != null ? { '--i': index } : {}) }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      aria-label={onClick ? `${label} — clique pra abrir o detalhe` : undefined}
    >
      <span className="corner-tl"/>
      <span className="corner-br"/>
      <div className="kpi-row">
        <span className="kpi-label">{label}</span>
        <span className="kpi-icon"><Icon name={icon} size={12}/></span>
      </div>
      <div className={`kpi-value${money ? ' is-money' : ''}`}>
        {valueNode}{unit && <span className="unit">{unit}</span>}
      </div>
      <div className="kpi-foot">
        <span className="kpi-delta">
          {prev != null && (
            <span className={`delta ${colorClass}`}>
              <Icon name={arrowIcon} size={10}/>
              {display}
            </span>
          )}
          <span className="vs">{hint || 'vs prev'}</span>
        </span>
        {!hideSparkline && sparkData && <Sparkline data={sparkData} color={kpiTone}/>}
      </div>
      {threshold && threshold.label && (
        <div className={`kpi-threshold ${threshold.state}`}>{threshold.label}</div>
      )}
      {/* Linha extra neutra (sem semáforo). */}
      {sub && (
        <div className="kpi-threshold" style={{ color: 'var(--fg4)' }}>{sub}</div>
      )}
    </div>
  );
}

// ---------- Série temporal (topo) ----------
const TS_METRICS = [
  { id: 'gross', label: 'Faturamento bruto', icon: 'dollar', format: 'money' },
  { id: 'orders', label: 'Pedidos', icon: 'shopping-cart', format: 'int' },
  { id: 'aov', label: 'AOV', icon: 'trending-up', format: 'money2' },
  { id: 'refunds', label: 'Reembolso', icon: 'refresh', format: 'money' },
  { id: 'netAfterCpa', label: 'Net after CPA', icon: 'target', format: 'money' },
];
const TS_NOTE = {
  gross: 'receita bruta das vendas aprovadas, por dia da venda',
  orders: 'pedidos aprovados por dia',
  aov: 'receita da sessão de funil ÷ sessões, pelo dia do front',
  refunds: 'valor devolvido por dia do estorno (inclui vendas de antes do período)',
  netAfterCpa: 'funil · modelo da planilha CPA (bruto − refund/cb, taxa e opex − CPA pago)',
};

// Valor de uma métrica num dia do overview-panels (atual ou anterior).
function panelValue(metric, p) {
  if (!p) return null;
  if (metric === 'gross') return p.gross;
  if (metric === 'orders') return p.orders;
  if (metric === 'aov') return p.feSessions ? p.feRevenue / p.feSessions : 0;
  if (metric === 'refunds') return p.refundUsd;
  return p.netAfterCpa;
}

function TimeSeriesPanel({ metric, setMetric, kpis, prev, buckets, panels, cur, presetLabel, eventMode }) {
  const byDay = new Map((panels?.daily || []).map((d) => [d.date, d]));
  const needsPanels = metric === 'refunds' || metric === 'netAfterCpa' || metric === 'aov';
  const def = TS_METRICS.find((m) => m.id === metric) || TS_METRICS[0];
  // Período anterior, dia i <-> dia i. No modo "Evento" o bruto anterior não
  // existe nessa lente: a linha some só pra essa métrica.
  const prevDaily = panels?.previous?.daily || null;
  const showPrev = !!prevDaily && !(eventMode && metric === 'gross');

  const data = buckets.map((b, i) => {
    const p = byDay.get(b.day);
    const value = metric === 'gross' ? b.gross
      : metric === 'orders' ? b.approvedOrders
      : (panelValue(metric, p) ?? 0);
    const row = { date: b.date, value };
    if (showPrev) row.prev = panelValue(metric, prevDaily[i]);
    return row;
  });
  const sumPrev = (k) => (prevDaily ? prevDaily.reduce((acc, d) => acc + d[k], 0) : null);

  // Valor do período + variação (quando há período anterior comparável).
  let head = null;
  let cmp = null;
  let extra = null;
  if (metric === 'gross') { head = fmtCurrency(kpis.gross, cur, 0); cmp = deltaFor(kpis.gross, prev.gross); }
  if (metric === 'orders') { head = fmtInt(kpis.approvedCount); cmp = deltaFor(kpis.approvedCount, prev.approvedCount); }
  if (metric === 'aov') { head = fmtCurrency(kpis.aov, cur, 2); cmp = deltaFor(kpis.aov, prev.aov); }
  if (metric === 'refunds' && panels) {
    const usd = panels.daily.reduce((s, d) => s + d.refundUsd, 0);
    const n = panels.daily.reduce((s, d) => s + d.refundCount, 0);
    head = fmtCurrency(usd, cur, 0);
    cmp = deltaFor(usd, sumPrev('refundUsd'), 'lower');
    extra = `${fmtInt(n)} estornos no período`;
  }
  if (metric === 'netAfterCpa' && panels) {
    head = fmtCurrency(panels.netAfterCpa.usd, cur, 0);
    cmp = deltaFor(panels.netAfterCpa.usd, sumPrev('netAfterCpa'));
    extra = `${fmtCurrency(panels.netAfterCpa.frontGrossUsd, cur, 0)} de bruto no funil · CPA ${fmtCurrency(panels.netAfterCpa.frontCpaUsd, cur, 0)}`;
  }
  const cmpClass = cmp ? (cmp.good === true ? 'good' : cmp.good === false ? 'bad' : 'flat') : 'flat';
  const color = metric === 'refunds' ? 'var(--chart-5)' : metric === 'netAfterCpa' ? 'var(--chart-2)' : 'var(--accent)';

  return (
    <div className="panel ts-panel" style={{ marginBottom: 14 }}>
      <div className="ts-tabs" role="tablist" aria-label="Métrica do gráfico">
        {TS_METRICS.map((m) => (
          <button key={m.id} role="tab" aria-selected={metric === m.id}
            className={`ts-tab ${metric === m.id ? 'is-active' : ''}`} onClick={() => setMetric(m.id)}>
            <span className="ic"><Icon name={m.icon} size={14}/></span>{m.label}
          </button>
        ))}
      </div>
      <div className="ts-head">
        <div>
          <div className="panel-eyebrow">{def.label} · {presetLabel}</div>
          <div className="ts-value" style={{ color: def.format === 'int' ? 'var(--fg1)' : metric === 'refunds' ? 'var(--danger)' : 'var(--money)' }}>
            {head ?? '…'}
            {cmp && cmp.display !== '—' && (
              <span className={`delta ${cmpClass}`} style={{ marginLeft: 10, fontSize: 12, verticalAlign: 'middle' }}>
                <Icon name={cmp.trend === 'up' ? 'arrow-up-right' : cmp.trend === 'down' ? 'arrow-down-right' : 'trending-up'} size={10}/>
                {cmp.display} <span className="vs">vs período anterior</span>
              </span>
            )}
          </div>
          <div className="panel-sub">{extra ? `${extra} · ` : ''}{TS_NOTE[metric]}</div>
        </div>
      </div>
      {needsPanels && !panels
        ? <div style={{ height: 300, display: 'grid', placeItems: 'center', color: 'var(--fg5)', fontSize: 12 }}>carregando…</div>
        : <NSTimeSeries data={data} height={300} currency={cur}
            series={[
              { key: 'value', label: showPrev ? 'Este período' : def.label, color, format: def.format },
              ...(showPrev ? [{ key: 'prev', label: 'Período anterior', color: 'var(--fg4)', kind: 'line', dashed: true, format: def.format }] : []),
            ]}/>}
    </div>
  );
}

// ---------- Receita por estágio de captação ----------
const STAGES = [
  { key: 'front', label: 'Front (funil)', color: 'var(--chart-1)', sub: 'front + upsells + downsells' },
  { key: 'backend', label: 'Back-end', color: 'var(--chart-2)', sub: 'Tauk, Logicall e SalesBound' },
  { key: 'recovery', label: 'Recuperação', color: 'var(--chart-3)', sub: 'afiliados de recuperação e SMS' },
];

function StagePanels({ panels, cur }) {
  if (!panels) {
    return (
      <div className="grid-2">
        <div className="panel" style={{ minHeight: 260, display: 'grid', placeItems: 'center', color: 'var(--fg5)', fontSize: 12 }}>carregando…</div>
        <div className="panel" style={{ minHeight: 260, display: 'grid', placeItems: 'center', color: 'var(--fg5)', fontSize: 12 }}>carregando…</div>
      </div>
    );
  }
  const st = panels.stages;
  const total = st.totalUsd || 0;
  const items = STAGES.map((s) => ({ label: s.label, value: st[s.key].usd, color: s.color, clickable: false }));
  const outside = total > 0 ? (st.backend.usd + st.recovery.usd) / total : 0;
  const pct = (v) => (total > 0 ? `${((v / total) * 100).toFixed(0)}%` : '—');

  return (
    <div className="grid-2">
      <div className="panel">
        <div className="panel-head">
          <div className="panel-title">
            <span className="panel-eyebrow">Receita por estágio de captação</span>
            <div className="panel-sub">Vendas aprovadas · receita bruta · {fmtCurrency(total, cur, 0)} no período</div>
          </div>
        </div>
        <Donut items={items} totalLabel="Total" format={(v) => fmtCurrency(v, cur, 0)}/>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
          {STAGES.map((s) => {
            const g = st[s.key];
            const parts = g.parts || [];
            return (
              <div key={s.key} style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }}/>
                  <strong style={{ color: 'var(--fg1)' }}>{s.label}</strong>
                  <span style={{ color: 'var(--fg5)', fontSize: 11 }}>{s.sub}</span>
                  <span style={{ flex: 1 }}/>
                  <span className="cell-mono" style={{ color: 'var(--money)' }}>{fmtCurrency(g.usd, cur, 0)}</span>
                  <span className="cell-mono" style={{ color: 'var(--fg4)', width: 36, textAlign: 'right' }}>{pct(g.usd)}</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6, paddingLeft: 18 }}>
                  {s.key === 'backend' && !g.available && (
                    <span style={{ fontSize: 11, color: 'var(--fg5)' }}>Fora do recorte: call center e SalesBound não têm plataforma, produto nem afiliado.</span>
                  )}
                  {parts.length === 0 && (s.key !== 'backend' || g.available) && (
                    <span style={{ fontSize: 11, color: 'var(--fg5)' }}>Nada no período.</span>
                  )}
                  {parts.map((p) => (
                    <span key={p.key} style={{
                      fontSize: 11, padding: '2px 10px', borderRadius: 'var(--r-full)',
                      border: '1px solid var(--border-soft)', background: 'var(--bg-raised)', color: 'var(--fg3)',
                    }}>
                      {p.label} · <span className="cell-mono" style={{ color: 'var(--fg1)' }}>{fmtCurrency(p.usd, cur, 0)}</span>
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div className="panel-title">
            <span className="panel-eyebrow">Captação dia a dia</span>
            <div className="panel-sub">
              Receita de cada estágio por dia (empilhada) · {total > 0 ? `${(outside * 100).toFixed(1)}% veio de fora do funil` : 'sem receita no período'}
            </div>
          </div>
        </div>
        <NSTimeSeries data={panels.daily} height={300} currency={cur} toggles
          series={STAGES.map((s) => ({ key: s.key, label: s.label, color: s.color, stackId: 'stage' }))}/>
      </div>
    </div>
  );
}

function OverviewPage({ filters }) {
  const [state, setState] = useStateOv({ status: 'loading', data: null, error: null });
  const [panels, setPanels] = useStateOv({ status: 'loading', data: null });
  const [metric, setMetric] = useStateOv('gross');
  // Modo do gross:
  //  - 'active'  (default): gross = só APPROVED (status atual). Refunds removem
  //    do total. Reflete "receita ativa real" hoje no books.
  //  - 'event'   (CB-style): gross = valor original da venda no dia que ocorreu,
  //    inclui orders que depois foram refundadas. Bate com o "Gross Sale Amount"
  //    do CB Reporting Dashboard.
  const [grossMode, setGrossMode] = useStateOv('active');

  const filterKey = [filters.dateRange.start.getTime(), filters.dateRange.end.getTime(),
    encodeSet(filters.platforms), encodeSet(filters.countries), encodeSet(filters.funnels),
    encodeSet(filters.families), encodeSet(filters.stages || new Set()), encodeSet(filters.affiliates || new Set())].join('|');

  useEffectOv(() => {
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading' }));
    window.NSApi.fetchOverview({ ...filters, compare: true })
      .then((data) => { if (!cancelled) setState({ status: 'ready', data, error: null }); })
      .catch((err) => {
        if (cancelled) return;
        console.error('fetchOverview failed', err);
        setState({ status: 'error', data: null, error: err.message });
      });
    return () => { cancelled = true; };
  }, [filterKey]);

  useEffectOv(() => {
    let cancelled = false;
    setPanels((s) => ({ ...s, status: 'loading' }));
    window.NSApi.fetchOverviewPanels(filters)
      .then((data) => { if (!cancelled) setPanels({ status: 'ready', data }); })
      .catch((err) => {
        if (cancelled) return;
        console.error('fetchOverviewPanels failed', err);
        setPanels({ status: 'error', data: null });
      });
    return () => { cancelled = true; };
  }, [filterKey]);

  // Reembolso de 60 dias (coorte) das contas do Top 5: chamada pequena,
  // depois que o overview diz quem está no Top 5.
  const [affRefunds, setAffRefunds] = useStateOv({});
  const topKeys = (state.data?.topAffiliates || []).map((a) => `${a.platformSlug}:${a.externalId}`).join(',');
  useEffectOv(() => {
    if (!topKeys) { setAffRefunds({}); return undefined; }
    let cancelled = false;
    window.NSApi.fetchAffiliateRefunds(topKeys.split(','))
      .then((d) => { if (!cancelled) setAffRefunds(Object.fromEntries(d.affiliates.map((a) => [a.key, a]))); })
      .catch(() => { if (!cancelled) setAffRefunds({}); });
    return () => { cancelled = true; };
  }, [topKeys]);

  const cur = filters.currency || 'USD';
  const presetLabel = (typeof PRESET_LABEL !== 'undefined' && PRESET_LABEL[filters.preset]) || filters.preset;

  if (state.status === 'loading' && !state.data) return <SkelOverview/>;
  if (state.status === 'error') {
    return <div className="page-in"><div className="panel" style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 10 }}>
      <Icon name="alert-triangle" size={16}/> Erro ao carregar: {state.error}
    </div></div>;
  }

  const { kpis: rawKpis, previous: rawPrev, daily, topAffiliates } = state.data;
  const pd = panels.data;
  // grossMode='event' substitui gross por grossOriginal (CB-aligned).
  const useEvent = grossMode === 'event';
  const kpis = useEvent && rawKpis.grossOriginal != null ? {
    ...rawKpis,
    gross: rawKpis.grossOriginal,
    aov: rawKpis.orderGroups ? rawKpis.grossOriginal / rawKpis.orderGroups : 0,
  } : rawKpis;
  const prev = useEvent && rawPrev?.grossOriginal != null ? {
    ...rawPrev,
    gross: rawPrev.grossOriginal,
    aov: rawPrev.orderGroups ? rawPrev.grossOriginal / rawPrev.orderGroups : 0,
  } : (rawPrev || {});

  const buckets = daily.map((b) => ({
    day: b.date,
    date: new Date(b.date),
    gross: useEvent && b.grossOriginal != null ? b.grossOriginal : b.gross,
    approvedOrders: b.approvedOrders,
    allOrders: b.allOrders,
  }));
  const panelByDay = new Map((pd?.daily || []).map((d) => [d.date, d]));

  // Esconde sparklines quando não há histórico suficiente (< 7 dias).
  const hideSpark = buckets.length < 7;
  const sparkGross = buckets.map((b) => b.gross);
  const sparkOrders = buckets.map((b) => b.approvedOrders);
  const sparkAov = buckets.map((b) => { const p = panelByDay.get(b.day); return p && p.feSessions ? p.feRevenue / p.feSessions : 0; });
  const sparkNet = buckets.map((b) => panelByDay.get(b.day)?.netAfterCpa ?? 0);
  const approvalSpark = buckets.map((b) => (b.allOrders ? b.approvedOrders / b.allOrders : 0));

  const r60 = pd?.refunds60d;
  const r60Pct = r60?.pctCount;
  const nac = pd?.netAfterCpa;

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow" style={{ whiteSpace: 'normal' }}>{presetLabel} · USD</span>
          <h2>Operação <em>em tempo real</em></h2>
          <span className="sub">{fmtRange(filters.dateRange)}<span className="hide-mobile"> · dados unificados de todas as plataformas</span></span>
        </div>
        <div className="page-head-actions" style={{ flexWrap: 'wrap' }}>
          <div className="seg" title="Modo de cálculo do gross" style={{ flexShrink: 0 }}>
            <button className={grossMode === 'active' ? 'is-active' : ''} onClick={() => setGrossMode('active')}
              aria-label="Receita ativa: só vendas aprovadas">Ativo</button>
            <button className={grossMode === 'event' ? 'is-active' : ''} onClick={() => setGrossMode('event')}
              aria-label="Data do evento: inclui valor original de vendas estornadas (alinha com ClickBank)">Evento</button>
          </div>
        </div>
      </div>
      {/* DS1 "dado com contexto": fonte que não reporta estorno = leitura parcial */}
      <RefundCoverageNotice platforms={Array.from(filters.platforms || [])}/>

      <TimeSeriesPanel metric={metric} setMetric={setMetric} kpis={kpis} prev={prev}
        buckets={buckets} panels={pd} cur={cur} presetLabel={presetLabel} eventMode={useEvent}/>

      <div className="kpi-grid">
        <KpiCard label="Receita bruta" icon="dollar" index={0} money
          countValue={kpis.gross} countFormat={(n) => fmtCurrency(n, cur, 0)}
          cur={kpis.gross} prev={prev.gross}
          sparkData={sparkGross} hideSparkline={hideSpark}
          onClick={() => window.NSNavigate('transactions')}/>
        <KpiCard label="Pedidos aprovados" icon="shopping-cart" index={1}
          countValue={kpis.approvedCount} countFormat={(n) => fmtInt(n)}
          cur={kpis.approvedCount} prev={prev.approvedCount}
          sparkData={sparkOrders} hideSparkline={hideSpark}
          onClick={() => window.NSNavigate('transactions', { status: 'approved' })}/>
        <KpiCard label="AOV" icon="trending-up" index={2} money
          countValue={kpis.aov} countFormat={(n) => fmtCurrency(n, cur, 2)}
          cur={kpis.aov} prev={prev.aov}
          sparkData={sparkAov} hideSparkline={hideSpark || !pd}/>
        {/* NET AFTER CPA do modelo da planilha CPA — mesma régua da aba Afiliados. */}
        <KpiCard label="Net after CPA (modelo)" icon="target" index={3} money
          alert={(nac?.usd ?? 0) < 0}
          countValue={nac ? nac.usd : 0} countFormat={(n) => nac ? fmtCurrency(n, cur, 0) : '…'}
          cur={null} prev={null}
          hint={nac ? `funil · opex ${nac.opexPct}% · CPA ${fmtCurrency(nac.frontCpaUsd, cur, 0)}` : 'carregando modelo CPA…'}
          sparkData={sparkNet} hideSparkline={hideSpark || !pd}/>
        <KpiCard label="Taxa de aprovação" icon="check" index={4}
          countValue={kpis.approvalRate * 100} countFormat={(n) => n.toFixed(1)} unit="%"
          cur={kpis.approvalRate} prev={prev.approvalRate}
          sparkData={approvalSpark} hideSparkline={hideSpark}
          threshold={{
            label: KPI_THRESHOLDS.approvalRate.label(),
            state: KPI_THRESHOLDS.approvalRate.state(kpis.approvalRate),
          }}
          onClick={() => window.NSNavigate('transactions')}/>
        {/* Reembolso pela régua da aba Reembolsos: das vendas feitas nos
            últimos 60 dias, quantas já voltaram (cada estorno conta no dia da
            venda). Janela fixa — não segue o período do filtro. */}
        <KpiCard label="Reembolso · últimos 60 dias" icon="refresh" index={5}
          countValue={r60Pct != null ? r60Pct * 100 : 0}
          countFormat={(n) => (r60 ? n.toFixed(2) : '…')} unit="%"
          cur={null} prev={null} directionPreference="lower"
          alert={r60Pct != null && r60Pct > 0.10}
          hint={r60 ? `${fmtInt(r60.refundCount)} de ${fmtInt(r60.baseCount)} vendas` : 'carregando…'}
          threshold={r60Pct != null ? {
            label: KPI_THRESHOLDS.refundRate.label(r60Pct),
            state: KPI_THRESHOLDS.refundRate.state(r60Pct),
          } : null}
          sub={r60 && r60.projectedPctCount != null
            ? `~${(r60.projectedPctCount * 100).toFixed(1)}% ao amadurecer${r60.tailIncomplete ? ' (piso)' : ''} · em valor ${r60.pctUsd != null ? (r60.pctUsd * 100).toFixed(1) : '—'}%`
            : null}
          onClick={() => window.NSNavigate('refund-cohorts')}/>
        <KpiCard label="Chargeback" icon="alert-triangle" index={6}
          alert={kpis.cbRate >= 0.02}
          countValue={kpis.cbRate * 100} countFormat={(n) => n.toFixed(2)} unit="%"
          cur={kpis.cbRate} prev={prev.cbRate}
          directionPreference="lower"
          threshold={{
            label: KPI_THRESHOLDS.cbRate.label(),
            state: KPI_THRESHOLDS.cbRate.state(kpis.cbRate),
          }}
          onClick={() => window.NSNavigate('transactions', { status: 'chargeback' })}/>
      </div>

      <StagePanels panels={pd} cur={cur}/>

      <div className="panel">
        <div className="panel-head">
          <div className="panel-title">
            <span className="panel-eyebrow">Top 5 afiliados</span>
            <div className="panel-sub">Ordenados por receita bruta · redes de afiliados ficam na aba Networks</div>
          </div>
          <button className="btn btn-ghost" style={{ flexShrink: 0 }} onClick={() => window.NSNavigate('leaderboard')}>
            Ver ranking completo <Icon name="arrow-up-right" size={12}/>
          </button>
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
                <th className="num" title="Das vendas da conta nos últimos 60 dias, quantas já foram estornadas (régua da aba Reembolsos; janela fixa)">Reembolso 60d</th>
                <th className="num" title="NET AFTER CPA do período = (NET AOV − CPA por venda) × FEs aprovadas. Mesma conta do ranking de afiliados.">Net after CPA</th>
              </tr>
            </thead>
            <tbody>
              {topAffiliates.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', opacity: 0.6, padding: 24 }}>
                  Sem afiliados no período
                </td></tr>
              )}
              {topAffiliates.map((a, i) => {
                const plat = platBadge(a.platformSlug);
                const apClass = a.approvalRate > 0.7 ? 'val-ok' : a.approvalRate > 0.5 ? 'val-warn' : 'val-bad';
                const displayName = a.nickname || a.externalId;
                const rf = affRefunds[`${a.platformSlug}:${a.externalId}`];
                const rfSmall = rf && rf.baseCount < 20;
                const rfColor = !rf || rf.pctCount == null || rfSmall ? 'var(--fg5)'
                  : rf.pctCount > 0.10 ? 'var(--danger)' : rf.pctCount > 0.08 ? 'var(--warning)' : 'var(--fg2)';
                return (
                  <tr key={`${a.platformSlug}:${a.externalId}`}>
                    <td className="rank">{String(i + 1).padStart(2, '0')}</td>
                    <td>
                      <span className="cell-aff">
                        <span className="av" style={{ background: avatarColor(a.externalId) }}>{initials(displayName)}</span>
                        <span className="meta">
                          <span className="nm">{displayName}</span>
                          <span className="id">{a.externalId}</span>
                        </span>
                      </span>
                    </td>
                    <td><span className={`plat ${plat.cls}`}>{plat.short}</span></td>
                    <td className="num cell-mono">{fmtInt(a.orders)}</td>
                    <td className="num cell-mono">{fmtCurrency(a.revenue, cur, 0)}</td>
                    <td className={`num cell-mono ${apClass}`}>{(a.approvalRate * 100).toFixed(1)}%</td>
                    <td className="num cell-mono" style={{ color: rfColor }}
                      title={rf ? `${fmtInt(rf.refundCount)} de ${fmtInt(rf.baseCount)} vendas dos últimos 60 dias${rf.pctUsd != null ? ` · ${(rf.pctUsd * 100).toFixed(1)}% em valor` : ''}${rfSmall ? ' · amostra pequena' : ''}` : 'sem vendas nos últimos 60 dias'}>
                      {rf && rf.pctCount != null ? `${(rf.pctCount * 100).toFixed(1)}%` : '—'}
                    </td>
                    <td className="num cell-mono"
                      title={a.netAfterCpaUsd != null
                        ? `${fmtCurrency(a.netAfterCpaUsd, cur, 2)}/venda × ${a.feApprovedCount} FEs aprovadas`
                        : 'sem CPA observado no período'}
                      style={{ color: a.netAfterCpaTotalUsd == null ? 'var(--fg5)'
                        : a.netAfterCpaTotalUsd > 0 ? 'var(--money)' : 'var(--danger)' }}>
                      {a.netAfterCpaTotalUsd != null ? fmtCurrency(a.netAfterCpaTotalUsd, cur, 0) : '—'}
                    </td>
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

function fmtRange(range) {
  const start = range.start instanceof Date ? range.start : new Date(range.start);
  const end = range.end instanceof Date ? range.end : new Date(range.end);
  const opts = { month: 'short', day: 'numeric' };
  return `${start.toLocaleDateString('en-US', opts)} → ${end.toLocaleDateString('en-US', opts)}`;
}

// encodeSet declared in index.html script scope — fallback here in case of load order
function encodeSet(set) {
  if (!set || set.size === 0) return '';
  return Array.from(set).join(',');
}

Object.assign(window, { OverviewPage });
