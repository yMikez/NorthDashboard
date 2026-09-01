/* global React, Icon, NSTimeSeries, NSBarRank, Sparkline, CpaStatusChip, fmtCurrency, fmtInt, fmtPct, SkelMiniKpis, SkelChartPanel, SkelTablePanel, SkelDrawerLoading, downloadCsv, AaContactForm, AffiliateIdentityDrawer, AaSequenceView, AaEvolutionView, AaHealthView, AaTopsByWindow, AaNewAffiliatesPanel, AiOriginChip */
/* Análise de afiliados — quem sobe, quem cai e por quê.
   Ranking por métrica (receita/vendas/AOV/reembolso/Net após CPA), janelas
   de 3/7/15/30/60 dias (cada uma vs a anterior), identidade unificada entre
   plataformas (parceiro = contas somadas), gráficos e drivers da variação.
   API: /api/metrics/affiliate-analysis (+ /explain), /api/admin/affiliate-identity. */

const { useState: useStateAA, useEffect: useEffectAA, useMemo: useMemoAA } = React;

const AA_WINDOWS = [3, 7, 15, 30, 60];
// [id, label, valor(cur), formato, asc(menor é melhor)]
const AA_METRICS = [
  ['revenue',     'Receita',       (m) => m.revenue,                'money',  false],
  ['sales',       'Vendas',        (m) => m.sales,                  'int',    false],
  ['aov',         'AOV',           (m) => m.aov,                    'money2', false],
  ['refundRate',  'Reembolso',     (m) => m.refundRate,             'pct',    true],
  ['netAfterCpa', 'Net após CPA',  (m) => (m.netAfterCpa == null ? -1e12 : m.netAfterCpa), 'money2', false],
];
const AA_TREND = {
  novo:        { label: 'Novo',          tone: 'var(--accent)' },
  churn:       { label: 'Saiu do radar', tone: 'var(--danger)' },
  breakout:    { label: 'Breakout',      tone: 'var(--success)' },
  crescimento: { label: 'Crescimento',   tone: 'var(--success)' },
  estavel:     { label: 'Estável',       tone: 'var(--fg4)' },
  volatil:     { label: 'Volátil',       tone: 'var(--warning)' },
  queda:       { label: 'Queda',         tone: 'var(--warning)' },
  queda_forte: { label: 'Queda forte',   tone: 'var(--danger)' },
};
const AA_INPUT = { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 9px', color: 'var(--fg1)', fontFamily: 'var(--f-body)', fontSize: 12 };
const AA_PLAT = { clickbank: 'CB', digistore24: 'D24', buygoods: 'BG', cartpanda: 'CP', jvzoo: 'JVZ' };

function aaFmt(format, v, cur = 'USD') {
  if (v == null || Number.isNaN(v)) return '—';
  if (format === 'int') return fmtInt(v);
  if (format === 'pct') return fmtPct(v, 1);
  if (format === 'money2') return fmtCurrency(v, cur, 2);
  return fmtCurrency(v, cur, 0);
}
function aaPctStr(f) { return (f * 100).toFixed(1).replace('.', ',') + '%'; }

// Variação: relativa (fração) ou em pontos percentuais / $ conforme kind.
function AaDelta({ value, kind = 'rel', invert = false, size = 10 }) {
  if (value == null) return <span style={{ color: 'var(--fg5)', fontSize: size }}>—</span>;
  const good = invert ? value <= 0 : value >= 0;
  const flat = Math.abs(value) < (kind === 'rel' ? 0.002 : kind === 'pp' ? 0.0005 : 0.5);
  const color = flat ? 'var(--fg4)' : good ? 'var(--success)' : 'var(--danger)';
  const arrow = flat ? '■' : value >= 0 ? '▲' : '▼';
  let text;
  if (kind === 'rel') text = aaPctStr(Math.abs(value));
  else if (kind === 'pp') text = (Math.abs(value) * 100).toFixed(1).replace('.', ',') + ' pp';
  else text = fmtCurrency(Math.abs(value), 'USD', kind === 'money2' ? 2 : 0);
  return <span className="mono" style={{ color, fontSize: size, whiteSpace: 'nowrap' }}>{arrow} {text}</span>;
}

function AaTrend({ tag }) {
  const t = AA_TREND[tag] || { label: tag || '—', tone: 'var(--fg4)' };
  return (
    <span style={{
      fontFamily: 'var(--f-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
      padding: '2px 7px', borderRadius: 'var(--r-full)', whiteSpace: 'nowrap',
      color: t.tone, background: `color-mix(in oklab, ${t.tone} 12%, transparent)`, border: `1px solid color-mix(in oklab, ${t.tone} 35%, transparent)`,
    }}>{t.label}</span>
  );
}

function AaPlat({ slug }) {
  return (
    <span title={slug} style={{
      fontFamily: 'var(--f-mono)', fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 6,
      color: 'var(--fg3)', background: 'color-mix(in oklab, var(--fg4) 12%, transparent)', border: '1px solid var(--border-soft)',
    }}>{AA_PLAT[slug] || slug}</span>
  );
}

function AaEmpty({ children }) {
  return <div style={{ padding: '22px 12px', textAlign: 'center', color: 'var(--fg5)', fontSize: 12, border: '1px dashed var(--border)', borderRadius: 12 }}>{children}</div>;
}

// ── Página ──────────────────────────────────────────────────────────────

function AffiliateAnalysisPage({ filters, user }) {
  // Quem tem a aba gerencia identidades/contato (não só admin) — 2026-08-25.
  const isAdmin = !!user;
  const [win, setWin] = useStateAA(7);
  const [view, setView] = useStateAA('partner');
  const [metric, setMetric] = useStateAA('revenue');
  const [internal, setInternal] = useStateAA(false);
  const [today, setToday] = useStateAA(false);
  // Modo: ranking (janela atual vs anterior) | janelas (sequência J1..JK) | evolucao | saude
  const [mode, setMode] = useStateAA('ranking');
  const [count, setCount] = useStateAA(3);
  // Janela personalizada: N dias (1–90) terminando na data-âncora ('' = ontem/hoje).
  const [anchor, setAnchor] = useStateAA('');
  const [anchorInput, setAnchorInput] = useStateAA('');
  const [customWin, setCustomWin] = useStateAA('');
  const [seqState, setSeqState] = useStateAA({ status: 'idle', data: null, error: null });
  const [query, setQuery] = useStateAA('');
  const [state, setState] = useStateAA({ status: 'loading', data: null, error: null });
  const [tick, setTick] = useStateAA(0);
  const [openKey, setOpenKey] = useStateAA(null); // { key, anchor } — anchor = último dia da janela clicada
  // Abre o "por quê" de uma entidade; anchorOverride = fim da janela clicada
  // (Janelas/Saúde), senão a âncora da página.
  const openEntity = (key, anchorOverride) => setOpenKey(key ? { key, anchor: anchorOverride || anchor || null } : null);
  // Âncora EFETIVA (a que o servidor usou) — o input pode ter valor que o
  // servidor corrigiu (futuro/inválido).
  const effectiveAnchor = (mode === 'ranking' ? state.data?.anchor : seqState.data?.anchor) || null;
  const [identityOpen, setIdentityOpen] = useStateAA(false);

  const platformsKey = Array.from(filters.platforms || []).join(',');
  const familiesKey = Array.from(filters.families || []).join(',');

  useEffectAA(() => {
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading' }));
    window.NSApi.fetchAffiliateAnalysis(filters, { window: win, view, internal, today, anchor: anchor || null })
      .then((data) => { if (!cancelled) setState({ status: 'ready', data, error: null }); })
      .catch((err) => { if (!cancelled) setState({ status: 'error', data: null, error: err.message }); });
    return () => { cancelled = true; };
  }, [win, view, internal, today, anchor, tick, platformsKey, familiesKey]);

  // Sequência (janelas/evolução/saúde): só busca quando um desses modos está ativo.
  useEffectAA(() => {
    let cancelled = false;
    setSeqState((s) => ({ ...s, status: 'loading' }));
    window.NSApi.fetchAffiliateSequence(filters, { window: win, count, view, internal, today, anchor: anchor || null })
      .then((data) => { if (!cancelled) setSeqState({ status: 'ready', data, error: null }); })
      .catch((err) => { if (!cancelled) setSeqState({ status: 'error', data: null, error: err.message }); });
    return () => { cancelled = true; };
  }, [mode, win, count, view, internal, today, anchor, tick, platformsKey, familiesKey]);
  const seq = seqState.data;

  const data = state.data;
  const rows = data?.rows || [];
  const mdef = AA_METRICS.find((m) => m[0] === metric) || AA_METRICS[0];
  const [, mLabel, mValue, mFormat, mAsc] = mdef;

  // Ranking client-side: posição na janela atual e na anterior pela métrica.
  const ranked = useMemoAA(() => {
    const rankOf = (pick) => {
      const arr = rows.filter((r) => pick(r).sales > 0);
      arr.sort((a, b) => {
        const d = mValue(pick(a)) - mValue(pick(b));
        if (d !== 0) return mAsc ? d : -d;
        return pick(b).revenue - pick(a).revenue;
      });
      const m = new Map();
      arr.forEach((r, i) => m.set(r.key, i + 1));
      return m;
    };
    const cur = rankOf((r) => r.cur);
    const prev = rankOf((r) => r.prev);
    const q = query.trim().toLowerCase();
    const list = rows
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.accounts.some((a) => a.externalId.toLowerCase().includes(q) || (a.nickname || '').toLowerCase().includes(q) || (a.email || '').toLowerCase().includes(q)))
      .map((r) => ({ ...r, rank: cur.get(r.key) || null, prevRank: prev.get(r.key) || null }))
      .sort((a, b) => (a.rank || 1e9) - (b.rank || 1e9));
    return list;
  }, [rows, metric, query]);

  const win0 = data?.windows?.find((w) => w.days === win);
  const bars = useMemoAA(() => ranked.filter((r) => r.rank).slice(0, 15).map((r) => ({
    label: r.name.length > 22 ? r.name.slice(0, 21) + '…' : r.name,
    value: metric === 'netAfterCpa' ? (r.cur.netAfterCpa ?? 0) : mValue(r.cur),
    sub: `#${r.rank}${r.prevRank ? ` (antes #${r.prevRank})` : ''} · ${r.platforms.map((p) => AA_PLAT[p] || p).join('+')}`,
  })), [ranked, metric]);

  const exportCsv = () => {
    const headers = ['#', 'Nome', 'Plataformas', 'Tendência', 'Vendas', 'Vendas ant.', 'Receita', 'Receita ant.', 'AOV', 'Aprovação', 'Reembolso', 'CPA/venda', 'Net após CPA', 'Net após CPA total', 'Status', 'E-mail', 'Telefone', 'Por quê'];
    const body = ranked.map((r) => [r.rank, r.name, r.platforms.join('+'), AA_TREND[r.trend]?.label || r.trend, r.cur.sales, r.prev.sales, r.cur.revenue, r.prev.revenue, r.cur.aov, r.cur.approvalRate, r.cur.refundRate, r.cur.cpaPerFe, r.cur.netAfterCpa ?? '', r.cur.netAfterCpaTotal ?? '', r.cur.cpaStatus || '', r.contact?.email || '', r.contact?.phone || '', r.topDriver ? `${r.topDriver.title}: ${r.topDriver.detail}` : '']);
    downloadCsv(`analise-afiliados-${win}d-${data?.todayBrt || ''}.csv`, headers, body);
  };

  const loading = state.status === 'loading';

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">AFILIADOS · ANÁLISE</span>
          <h2>Quem sobe, quem cai — <em>e por quê</em>.</h2>
          <span className="sub">
            janelas de N dias (presets ou personalizada) fechando no dia escolhido — por padrão ONTEM, último dia completo em BRT — cada uma comparada com a anterior de mesmo tamanho · o período global não se aplica aqui · plataforma/família do filtro global valem
          </span>
        </div>
        <div className="page-head-actions" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div className="seg">
            {[['partner', 'Unificados'], ['platform', 'Por plataforma']].map(([k, l]) => (
              <button key={k} className={view === k ? 'is-active' : ''} onClick={() => setView(k)}>{l}</button>
            ))}
          </div>
          {isAdmin && (
            <button className="btn btn-ghost" onClick={() => setIdentityOpen(true)} title="Unificar contas, contatos, internos">
              <Icon name="users" size={13}/> Identidades
            </button>
          )}
        </div>
      </div>

      {/* Seletor de visão — em destaque, acima dos controles de janela */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        {[
          ['ranking', 'Ranking', 'janela atual vs anterior · tops por janela'],
          ['janelas', 'Janelas & comparativo', 'cards por janela · de onde veio a variação · tabela por janela'],
          ['evolucao', 'Evolução · Comentários', 'quem sobe, quem cai, quem está parando — com texto'],
          ['saude', 'Saúde da empresa', 'linha do tempo · dinâmica da base · risco · reativação'],
        ].map(([k, l, d]) => (
          <button key={k} onClick={() => setMode(k)} style={{
            flex: '1 1 200px', textAlign: 'left', cursor: 'pointer', padding: '10px 14px', borderRadius: 12,
            border: `1px solid ${mode === k ? 'var(--accent)' : 'var(--border)'}`,
            background: mode === k ? 'color-mix(in oklab, var(--accent) 10%, transparent)' : 'var(--bg-raised)', color: 'var(--fg1)',
          }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: mode === k ? 'var(--accent)' : 'var(--fg1)' }}>{l}</div>
            <div style={{ fontSize: 11, color: 'var(--fg4)', marginTop: 2 }}>{d}</div>
          </button>
        ))}
      </div>
      <div className="panel" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '10px 14px', marginBottom: 14 }}>
        <span className="f-label">JANELA</span>
        <div className="seg">
          {AA_WINDOWS.map((w) => (
            <button key={w} className={win === w ? 'is-active' : ''} onClick={() => { setWin(w); setCustomWin(''); }}>{w}d</button>
          ))}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg4)' }} title="Qualquer tamanho de 1 a 90 dias">
          personalizada
          <input type="number" min={1} max={90} value={customWin} placeholder="N dias" style={{ ...AA_INPUT, width: 78 }}
            onChange={(e) => setCustomWin(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { const n = parseInt(customWin, 10); if (n >= 1 && n <= 90) setWin(n); } }}
            onBlur={() => { const n = parseInt(customWin, 10); if (n >= 1 && n <= 90) setWin(n); }}/>
          {!AA_WINDOWS.includes(win) && <span className="mono" style={{ color: 'var(--accent)' }}>{win}d ativa</span>}
          {customWin !== '' && !(parseInt(customWin, 10) >= 1 && parseInt(customWin, 10) <= 90) && <span style={{ color: 'var(--warning)' }}>use 1 a 90</span>}
        </label>
        <span className="f-label" style={{ marginLeft: 6 }}>ATÉ O DIA</span>
        <input type="date" value={anchorInput} min="2024-01-01" max={data?.todayBrt || undefined} style={{ ...AA_INPUT, width: 150 }} title="Último dia da janela: a análise olha N dias pra trás a partir daqui (e compara com os N dias anteriores)"
          onChange={(e) => {
            const v = e.target.value;
            setAnchorInput(v);
            // Só aplica data completa, ano plausível e não-futura (o picker
            // do Chrome emite anos parciais enquanto se digita).
            if (!v) { setAnchor(''); return; }
            if (/^\d{4}-\d{2}-\d{2}$/.test(v) && parseInt(v.slice(0, 4), 10) >= 2024 && (!data?.todayBrt || v <= data.todayBrt)) setAnchor(v);
          }}/>
        {anchor
          ? <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => { setAnchor(''); setAnchorInput(''); }}>× voltar pra {today ? 'hoje' : 'ontem'}</button>
          : <span style={{ fontSize: 11, color: 'var(--fg5)' }}>{today ? 'hoje (parcial)' : 'ontem (último dia completo)'}{anchorInput && !anchor ? <span style={{ color: 'var(--warning)', marginLeft: 6 }}>data inválida ou futura — ignorada</span> : null}</span>}
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: 'var(--fg4)', cursor: 'pointer', marginLeft: 6 }}>
          <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)}/> incluir internos
        </label>
        {!anchor && (
          <label title="Hoje ainda está em andamento — comparar com dias cheios vicia os Δ" style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: 'var(--fg4)', cursor: 'pointer' }}>
            <input type="checkbox" checked={today} onChange={(e) => setToday(e.target.checked)}/> incluir hoje (parcial)
          </label>
        )}
        <button className="btn btn-ghost" onClick={() => setTick((t) => t + 1)} title="Recarregar"><Icon name="refresh" size={13}/></button>
        {true && (
          <>
            <span className="f-label" style={{ marginLeft: 6 }}>QUANTAS JANELAS</span>
            <div className="seg">
              {[2, 3, 4, 6, 8].map((k) => <button key={k} className={count === k ? 'is-active' : ''} onClick={() => setCount(k)}>{k}</button>)}
            </div>
            <span style={{ fontSize: 11, color: 'var(--fg5)' }}>= {count} × {win} dias, a última terminando {effectiveAnchor || anchor || (today ? 'hoje' : 'ontem')}</span>
          </>
        )}
      </div>

      {/* KPIs + comparativo por janela: fixos em TODOS os modos (o modo só troca o que vem abaixo) */}
      {data && (
        <div style={{ opacity: loading ? 0.45 : 1, transition: 'opacity .2s' }}>
          {win0 && (
            <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
              <AaKpi label={`Receita · ${win}d`} value={fmtCurrency(win0.cur.revenue, 'USD', 0)} money delta={win0.prev.revenue ? (win0.cur.revenue - win0.prev.revenue) / win0.prev.revenue : null} sub={`antes ${fmtCurrency(win0.prev.revenue, 'USD', 0)}`}/>
              <AaKpi label="Vendas" value={fmtInt(win0.cur.sales)} delta={win0.prev.sales ? (win0.cur.sales - win0.prev.sales) / win0.prev.sales : null} sub={`${fmtInt(win0.cur.feApproved)} FEs`}/>
              <AaKpi label="AOV" value={fmtCurrency(win0.cur.aov, 'USD', 2)} money delta={win0.prev.aov ? (win0.cur.aov - win0.prev.aov) / win0.prev.aov : null} sub={`antes ${fmtCurrency(win0.prev.aov, 'USD', 2)}`}/>
              <AaKpi label="Reembolso" value={fmtPct(win0.cur.refundRate, 1)} delta={win0.prev.realOrders ? win0.cur.refundRate - win0.prev.refundRate : null} deltaKind="pp" invert sub={`${fmtInt(win0.cur.refunds)} estornos`}/>
              <AaKpi label="Net após CPA (total)" value={win0.cur.netAfterCpaTotal == null ? '—' : fmtCurrency(win0.cur.netAfterCpaTotal, 'USD', 0)} money delta={win0.cur.netAfterCpaTotal != null && win0.prev.netAfterCpaTotal != null ? win0.cur.netAfterCpaTotal - win0.prev.netAfterCpaTotal : null} deltaKind="money" sub={win0.cur.netAfterCpa == null ? 'sem CPA conhecido' : `${fmtCurrency(win0.cur.netAfterCpa, 'USD', 2)} por FE`}/>
              <AaKpi label="Ativos" value={fmtInt(data.summary.active)} delta={data.summary.activePrev ? (data.summary.active - data.summary.activePrev) / data.summary.activePrev : null} sub={`${data.summary.newCount} novos · ${data.summary.churnCount} sumiram · top 10 = ${fmtPct(data.summary.concentrationTop10, 0)}`}/>
            </div>
          )}

          {/* Comparativo por janela (todos os afiliados visíveis) */}
          <div className="panel" style={{ padding: 0, marginBottom: 14 }}>
            <div className="panel-head" style={{ padding: '12px 16px 6px' }}>
              <div className="panel-title">
                <span className="panel-eyebrow">COMPARATIVO POR JANELA</span>
                <span className="panel-sub">cada linha = últimos N dias vs os N dias anteriores · clique pra trocar a janela do ranking</span>
              </div>
            </div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr>
                  <th>Janela</th><th>Período</th>
                  <th className="num">Receita</th><th className="num">Δ</th>
                  <th className="num">Vendas</th><th className="num">Δ</th>
                  <th className="num">AOV</th><th className="num">Δ</th>
                  <th className="num">Reembolso</th><th className="num">Δ</th>
                  <th className="num">Net após CPA</th><th className="num">Δ</th>
                  <th className="num">Ativos</th>
                </tr></thead>
                <tbody>
                  {data.windows.map((w) => (
                    <tr key={w.days} onClick={() => setWin(w.days)} style={{ cursor: 'pointer', background: w.days === win ? 'color-mix(in oklab, var(--accent) 8%, transparent)' : undefined }}>
                      <td className="cell-mono" style={{ fontWeight: 700 }}>{w.days} dias</td>
                      <td style={{ fontSize: 11, color: 'var(--fg4)' }}>{w.start} → {w.end} <span style={{ color: 'var(--fg5)' }}>vs {w.prevStart} → {w.prevEnd}</span></td>
                      <td className="num cell-mono" style={{ color: 'var(--money)' }}>{fmtCurrency(w.cur.revenue, 'USD', 0)}</td>
                      <td className="num"><AaDelta value={w.prev.revenue ? (w.cur.revenue - w.prev.revenue) / w.prev.revenue : null}/></td>
                      <td className="num cell-mono">{fmtInt(w.cur.sales)}</td>
                      <td className="num"><AaDelta value={w.prev.sales ? (w.cur.sales - w.prev.sales) / w.prev.sales : null}/></td>
                      <td className="num cell-mono">{fmtCurrency(w.cur.aov, 'USD', 2)}</td>
                      <td className="num"><AaDelta value={w.prev.aov ? (w.cur.aov - w.prev.aov) / w.prev.aov : null}/></td>
                      <td className="num cell-mono">{fmtPct(w.cur.refundRate, 1)}</td>
                      <td className="num"><AaDelta value={w.prev.realOrders ? w.cur.refundRate - w.prev.refundRate : null} kind="pp" invert/></td>
                      <td className="num cell-mono" style={{ color: w.cur.netAfterCpaTotal == null ? 'var(--fg5)' : w.cur.netAfterCpaTotal >= 0 ? 'var(--money)' : 'var(--danger)' }}>{w.cur.netAfterCpaTotal == null ? '—' : fmtCurrency(w.cur.netAfterCpaTotal, 'USD', 0)}</td>
                      <td className="num"><AaDelta value={w.cur.netAfterCpaTotal != null && w.prev.netAfterCpaTotal != null ? w.cur.netAfterCpaTotal - w.prev.netAfterCpaTotal : null} kind="money"/></td>
                      <td className="num cell-mono">{w.active} <span style={{ color: 'var(--fg5)' }}>/ {w.activePrev}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      )}

      {mode !== 'ranking' && (
        <>
          {seqState.status === 'error' && <div className="panel" style={{ color: 'var(--danger)', fontSize: 12 }}>Erro ao carregar: {seqState.error}</div>}
          {!seq && seqState.status === 'loading' && <><SkelMiniKpis n={4}/><SkelTablePanel rows={8} cols={10} title="Janelas"/></>}
          {seq && (
            <div style={{ opacity: seqState.status === 'loading' ? 0.45 : 1, transition: 'opacity .2s' }}>
              {mode === 'janelas' && <AaSequenceView key={`${seq.count}:${seq.window}:${seq.anchor}`} seq={seq} onOpen={openEntity}/>}
              {mode === 'evolucao' && <AaEvolutionView seq={seq} onOpen={openEntity}/>}
              {mode === 'saude' && <AaHealthView seq={seq} onOpen={openEntity}/>}
            </div>
          )}
        </>
      )}

      {mode === 'ranking' && state.status === 'error' && (
        <div className="panel" style={{ color: 'var(--danger)', fontSize: 12 }}>Erro ao carregar: {state.error}</div>
      )}

      {loading && !data && (
        <>
          <SkelMiniKpis n={6}/>
          <SkelChartPanel height={260} title="Comparativo"/>
          <SkelTablePanel rows={10} cols={12} title="Ranking"/>
        </>
      )}

      {mode === 'ranking' && data && (
        <div style={{ opacity: loading ? 0.45 : 1, transition: 'opacity .2s' }}>
          {/* Gráficos */}
          <div className="grid-2" style={{ marginBottom: 14 }}>
            <div className="panel">
              <div className="panel-head">
                <div className="panel-title">
                  <span className="panel-eyebrow">RECEITA DIÁRIA · TOP 8 DA JANELA</span>
                  <span className="panel-sub">clique na legenda pra esconder/mostrar</span>
                </div>
              </div>
              <NSTimeSeries
                data={data.daily}
                series={[{ key: 'total', label: 'Total', kind: 'area' }, ...data.topKeys.map((t) => ({ key: t.key, label: t.name.length > 18 ? t.name.slice(0, 17) + '…' : t.name, kind: 'line' }))]}
                height={280} format="money" toggles brush={false}
              />
            </div>
            <div className="panel">
              <div className="panel-head">
                <div className="panel-title">
                  <span className="panel-eyebrow">TOP 15 · {mLabel.toUpperCase()}</span>
                  <span className="panel-sub">{mAsc ? 'menor é melhor' : 'maior é melhor'} · janela de {win} dias</span>
                </div>
              </div>
              <NSBarRank items={bars} format={mFormat}/>
            </div>
          </div>

          {/* Ranking */}
          <div className="panel" style={{ padding: 0 }}>
            <div className="panel-head" style={{ padding: '12px 16px 6px', flexWrap: 'wrap', gap: 8 }}>
              <div className="panel-title">
                <span className="panel-eyebrow">RANKING · {win} DIAS · {view === 'partner' ? 'CONTAS UNIFICADAS' : 'POR PLATAFORMA'}</span>
                <span className="panel-sub">
                  {fmtInt(ranked.length)} {view === 'partner' ? 'parceiros' : 'contas'} com atividade ·
                  {data.summary.internalExcluded > 0 && !internal ? ` ${data.summary.internalExcluded} internos excluídos (${fmtCurrency(data.summary.internalRevenueExcluded, 'USD', 0)}) · ` : ' '}
                  clique numa linha pra ver o porquê
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <div className="seg">
                  {AA_METRICS.map(([k, l]) => (
                    <button key={k} className={metric === k ? 'is-active' : ''} onClick={() => setMetric(k)}>{l}</button>
                  ))}
                </div>
                <input style={{ ...AA_INPUT, width: 190 }} placeholder="buscar nome, ID, e-mail…" value={query} onChange={(e) => setQuery(e.target.value)}/>
                <button className="btn btn-ghost" onClick={exportCsv} title="Exportar CSV"><Icon name="download" size={13}/></button>
              </div>
            </div>
            <div className="tbl-wrap" style={{ maxHeight: 720 }}>
              <table className="tbl tbl--sticky-first">
                <thead><tr>
                  <th>#</th><th>{view === 'partner' ? 'Parceiro' : 'Conta'}</th><th>Plat.</th><th>Tendência</th>
                  <th className="num">Vendas</th><th className="num">Δ</th>
                  <th className="num">Receita</th><th className="num">Δ</th>
                  <th className="num">AOV</th><th className="num">Δ</th>
                  <th className="num">Aprov.</th>
                  <th className="num">Reemb.</th><th className="num">Δ</th>
                  <th className="num">CPA/venda</th>
                  <th className="num">Net após CPA</th><th className="num">Δ</th>
                  <th>Status</th><th>Por quê</th><th>{win}d</th>
                </tr></thead>
                <tbody>
                  {ranked.length === 0 && (
                    <tr><td colSpan={19}><AaEmpty>Nenhum afiliado com atividade nesta janela{query ? ' pra essa busca' : ''}.</AaEmpty></td></tr>
                  )}
                  {ranked.map((r) => {
                    const rankDelta = r.rank && r.prevRank ? r.prevRank - r.rank : null;
                    return (
                      <tr key={r.key} onClick={() => openEntity(r.key)} style={{ cursor: 'pointer' }}>
                        <td className="cell-mono" style={{ whiteSpace: 'nowrap' }}>
                          {r.rank ? `#${r.rank}` : '—'}
                          {rankDelta != null && rankDelta !== 0 && (
                            <span style={{ marginLeft: 4, fontSize: 9, color: rankDelta > 0 ? 'var(--success)' : 'var(--danger)' }}>{rankDelta > 0 ? '▲' : '▼'}{Math.abs(rankDelta)}</span>
                          )}
                          {r.rank && !r.prevRank && <span style={{ marginLeft: 4, fontSize: 9, color: 'var(--accent)' }}>novo</span>}
                        </td>
                        <td style={{ maxWidth: 220 }}>
                          <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {r.kind === 'partner' && <span title="contas unificadas" style={{ marginRight: 4, color: 'var(--accent)' }}><Icon name="link" size={11}/></span>}
                            {r.name}
                            {r.internal && <span style={{ marginLeft: 6, fontSize: 9, color: 'var(--fg5)' }}>interno</span>}
                            {r.origin && <span style={{ marginLeft: 6 }}><AiOriginChip origin={r.origin} size={9}/></span>}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--fg5)', fontFamily: 'var(--f-mono)' }}>
                            {r.accounts.length > 1 ? `${r.accounts.length} contas` : r.accounts[0]?.externalId}
                            {r.contact?.email ? ` · ${r.contact.email}` : ''}
                          </div>
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>{r.platforms.map((p) => <span key={p} style={{ marginRight: 3 }}><AaPlat slug={p}/></span>)}</td>
                        <td><AaTrend tag={r.trend}/></td>
                        <td className="num cell-mono">{fmtInt(r.cur.sales)}</td>
                        <td className="num"><AaDelta value={r.delta.sales}/></td>
                        <td className="num cell-mono" style={{ color: 'var(--money)', fontWeight: 600 }}>{fmtCurrency(r.cur.revenue, 'USD', 0)}</td>
                        <td className="num"><AaDelta value={r.delta.revenue}/></td>
                        <td className="num cell-mono">{fmtCurrency(r.cur.aov, 'USD', 2)}</td>
                        <td className="num"><AaDelta value={r.delta.aov}/></td>
                        <td className="num cell-mono">{fmtPct(r.cur.approvalRate, 0)}</td>
                        <td className="num cell-mono" style={{ color: r.cur.refundRate > 0.15 ? 'var(--danger)' : undefined }}>{fmtPct(r.cur.refundRate, 1)}</td>
                        <td className="num"><AaDelta value={r.delta.refundRate} kind="pp" invert/></td>
                        <td className="num cell-mono">{r.cur.cpaPerFe > 0 ? fmtCurrency(r.cur.cpaPerFe, 'USD', 0) : '—'}</td>
                        <td className="num cell-mono" style={{ color: r.cur.netAfterCpa == null ? 'var(--fg5)' : r.cur.netAfterCpa >= 0 ? 'var(--money)' : 'var(--danger)' }}>
                          {r.cur.netAfterCpa == null ? '—' : fmtCurrency(r.cur.netAfterCpa, 'USD', 2)}
                        </td>
                        <td className="num"><AaDelta value={r.delta.netAfterCpa} kind="money2"/></td>
                        <td><CpaStatusChip status={r.cur.cpaStatus}/></td>
                        <td style={{ maxWidth: 260, fontSize: 11, color: 'var(--fg3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.topDriver ? r.topDriver.detail : ''}>
                          {r.topDriver ? <><b style={{ color: r.topDriver.tone === 'up' ? 'var(--success)' : r.topDriver.tone === 'down' ? 'var(--danger)' : 'var(--fg3)' }}>{r.topDriver.title}</b> · {r.topDriver.detail}</> : <span style={{ color: 'var(--fg5)' }}>sem variação relevante</span>}
                        </td>
                        <td><Sparkline data={r.sparkline} width={70} height={20}/></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Tops por janela (sequência J1..JK) logo abaixo do ranking */}
          {seq && <AaNewAffiliatesPanel seq={seq} onOpen={openEntity}/>}
          {seq && <AaTopsByWindow seq={seq} onOpen={openEntity}/>}
        </div>
      )}

      {openKey && (
        <AaExplainDrawer entityKey={openKey.key} win={win} filters={filters} internal={internal} today={today} anchor={openKey.anchor} isAdmin={isAdmin} onClose={() => setOpenKey(null)} onChanged={() => setTick((t) => t + 1)}/>
      )}
      {identityOpen && (
        <AffiliateIdentityDrawer onClose={() => setIdentityOpen(false)} onChanged={() => setTick((t) => t + 1)}/>
      )}
    </div>
  );
}

function AaKpi({ label, value, sub, money, delta, deltaKind = 'rel', invert = false }) {
  return (
    <div className="panel" style={{ padding: '12px 14px' }}>
      <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--fg5)', fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <div className="mono" style={{ fontFamily: 'var(--f-display)', fontSize: 22, fontWeight: 700, color: money ? 'var(--money)' : 'var(--fg1)' }}>{value}</div>
        <AaDelta value={delta} kind={deltaKind} invert={invert} size={11}/>
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--fg4)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ── Drawer "por quê" ────────────────────────────────────────────────────

function AaExplainDrawer({ entityKey, win, filters, internal, today, anchor, isAdmin, onClose, onChanged }) {
  const [state, setState] = useStateAA({ status: 'loading', data: null, error: null });
  const [tick, setTick] = useStateAA(0);
  const [editing, setEditing] = useStateAA(false);
  const [busy, setBusy] = useStateAA(false);
  const [msg, setMsg] = useStateAA(null);

  useEffectAA(() => {
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading' }));
    window.NSApi.fetchAffiliateExplain(filters, entityKey, { window: win, internal, today, anchor: anchor || null })
      .then((data) => {
        if (cancelled) return;
        if (data?.error) { setState({ status: 'error', data: null, error: 'não encontrado' }); return; }
        setState({ status: 'ready', data, error: null });
      })
      .catch((err) => { if (!cancelled) setState({ status: 'error', data: null, error: err.message }); });
    return () => { cancelled = true; };
  }, [entityKey, win, tick, internal, today, anchor, Array.from(filters.platforms || []).join(','), Array.from(filters.families || []).join(',')]);

  const d = state.data;
  const act = async (fn, okMsg) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: okMsg }); setTick((t) => t + 1); onChanged?.(); }
    catch (err) { setMsg({ ok: false, text: err.message }); }
    finally { setBusy(false); }
  };
  const saveContactWith = (form) => act(async () => {
    if (d.entity.partnerId) {
      await window.NSApi.adminAffiliateIdentity('update', { partnerId: d.entity.partnerId, displayName: form.displayName, email: form.email || null, phone: form.phone || null, notes: form.notes || null, originType: form.originType || null, originRef: form.originRef || null });
    } else {
      // Conta solta: cria um parceiro só com ela pra guardar o contato.
      // Só manda o que veio preenchido (vazio não apaga nada).
      const body = { affiliateIds: [d.entity.accounts[0].id] };
      for (const k of ['displayName', 'email', 'phone', 'notes', 'originType', 'originRef']) if ((form[k] || '').trim()) body[k] = form[k].trim();
      await window.NSApi.adminAffiliateIdentity('link', body);
    }
    setEditing(false);
  }, '✓ contato salvo');

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose}/>
      <div className="drawer" style={{ width: 820, maxWidth: '100vw' }}>
        <div className="drawer-head">
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow" style={{ fontSize: 10 }}>POR QUÊ · {win} DIAS{d ? ` · ${d.range.start} → ${d.range.end}` : ''}</div>
            <h3 style={{ margin: '4px 0 0', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {d ? d.entity.name : '…'}
              {d && d.entity.platforms.map((p) => <AaPlat key={p} slug={p}/>)}
              {d && <AaTrend tag={d.trend}/>}
              {d && <AiOriginChip origin={d.entity.origin}/>}
            </h3>
            {d && d.entity.contact && (d.entity.contact.email || d.entity.contact.phone) && !editing && (
              <div style={{ fontSize: 11, color: 'var(--fg4)', marginTop: 4, fontFamily: 'var(--f-mono)' }}>
                {d.entity.contact.email && <span><Icon name="mail" size={11}/> {d.entity.contact.email}</span>}
                {d.entity.contact.phone && <span style={{ marginLeft: 10 }}><Icon name="user" size={11}/> {d.entity.contact.phone}</span>}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {isAdmin && d && !editing && <button className="btn btn-ghost" onClick={() => setEditing(true)}><Icon name="edit" size={12}/> Contato</button>}
            <button className="btn btn-ghost" onClick={onClose}><Icon name="x" size={14}/></button>
          </div>
        </div>
        <div className="drawer-body">
          {state.status === 'loading' && !d && <SkelDrawerLoading/>}
          {state.status === 'error' && <div style={{ color: 'var(--danger)', fontSize: 12 }}>Erro: {state.error}</div>}
          {msg && <div style={{ fontSize: 12, color: msg.ok ? 'var(--success)' : 'var(--danger)', marginBottom: 8 }}>{msg.text}</div>}

          {isAdmin && d && editing && (
            <AaContactForm
              title="CONTATO DO PARCEIRO (opcional)"
              initial={{ displayName: d.entity.name || '', email: d.entity.contact?.email || '', phone: d.entity.contact?.phone || '', notes: d.entity.notes || '', originType: d.entity.origin?.type || '', originRef: d.entity.origin?.ref || '' }}
              busy={busy}
              onCancel={() => setEditing(false)}
              onSave={saveContactWith}
            />
          )}

          {d && (
            <>
              <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 12 }}>
                <AaKpi label="Receita" value={fmtCurrency(d.cur.revenue, 'USD', 0)} money delta={d.prev.revenue ? (d.cur.revenue - d.prev.revenue) / d.prev.revenue : null} sub={`antes ${fmtCurrency(d.prev.revenue, 'USD', 0)}`}/>
                <AaKpi label="Vendas / FEs" value={`${fmtInt(d.cur.sales)} / ${fmtInt(d.cur.feApproved)}`} delta={d.prev.feApproved ? (d.cur.feApproved - d.prev.feApproved) / d.prev.feApproved : null} sub={`antes ${fmtInt(d.prev.sales)} / ${fmtInt(d.prev.feApproved)}`}/>
                <AaKpi label="AOV" value={fmtCurrency(d.cur.aov, 'USD', 2)} money delta={d.prev.aov ? (d.cur.aov - d.prev.aov) / d.prev.aov : null} sub={`front ${fmtCurrency(d.cur.feTicket, 'USD', 0)} + back ${fmtCurrency(d.cur.backendPerFe, 'USD', 0)}`}/>
                <AaKpi label="Aprovação" value={fmtPct(d.cur.approvalRate, 1)} delta={d.prev.realOrders ? d.cur.approvalRate - d.prev.approvalRate : null} deltaKind="pp" sub={`antes ${fmtPct(d.prev.approvalRate, 1)}`}/>
                <AaKpi label="Reembolso" value={fmtPct(d.cur.refundRate, 1)} delta={d.prev.realOrders ? d.cur.refundRate - d.prev.refundRate : null} deltaKind="pp" invert sub={`${fmtInt(d.cur.refunds)} estornos · CB ${fmtPct(d.cur.cbRate, 1)}`}/>
                <AaKpi label="Net após CPA" value={d.cur.netAfterCpa == null ? '—' : fmtCurrency(d.cur.netAfterCpa, 'USD', 2)} money delta={d.cur.netAfterCpa != null && d.prev.netAfterCpa != null ? d.cur.netAfterCpa - d.prev.netAfterCpa : null} deltaKind="money2" sub={`CPA ${d.cur.cpaPerFe ? fmtCurrency(d.cur.cpaPerFe, 'USD', 0) : '—'} · NET AOV ${fmtCurrency(d.cur.netAov, 'USD', 0)} · total ${d.cur.netAfterCpaTotal == null ? '—' : fmtCurrency(d.cur.netAfterCpaTotal, 'USD', 0)}`}/>
              </div>

              <div className="panel" style={{ marginBottom: 12 }}>
                <div className="panel-head">
                  <div className="panel-title">
                    <span className="panel-eyebrow">POR QUÊ</span>
                    <span className="panel-sub">o que explica a variação vs a janela anterior, do maior efeito pro menor · Δreceita = volume × AOV (decomposição exata)</span>
                  </div>
                </div>
                {d.drivers.length === 0 && <AaEmpty>Sem variação relevante entre as duas janelas.</AaEmpty>}
                {d.drivers.map((dr, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '10px 1fr auto', gap: 10, alignItems: 'start', padding: '8px 0', borderTop: i ? '1px solid var(--border-soft)' : 'none' }}>
                    <span style={{ marginTop: 5, width: 8, height: 8, borderRadius: 99, background: dr.tone === 'up' ? 'var(--success)' : dr.tone === 'down' ? 'var(--danger)' : 'var(--fg4)' }}/>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{dr.title}</div>
                      <div style={{ fontSize: 12, color: 'var(--fg3)' }}>{dr.detail}</div>
                    </div>
                    <div className="mono" style={{ fontSize: 12, color: dr.impactUsd == null ? 'var(--fg5)' : dr.impactUsd >= 0 ? 'var(--success)' : 'var(--danger)', whiteSpace: 'nowrap' }}>
                      {dr.impactUsd == null ? '' : (dr.impactUsd >= 0 ? '+' : '−') + fmtCurrency(Math.abs(dr.impactUsd), 'USD', 0)}
                    </div>
                  </div>
                ))}
              </div>

              <div className="panel" style={{ marginBottom: 12 }}>
                <div className="panel-head">
                  <div className="panel-title">
                    <span className="panel-eyebrow">JANELA ATUAL × ANTERIOR</span>
                    <span className="panel-sub">receita por dia, as duas janelas sobrepostas (dia 1 = primeiro dia de cada janela)</span>
                  </div>
                </div>
                <NSTimeSeries
                  data={d.daily.map((x) => ({ date: x.date, atual: x.atual, anterior: x.anterior }))}
                  series={[{ key: 'atual', label: 'Atual', kind: 'area' }, { key: 'anterior', label: 'Anterior', kind: 'line' }]}
                  height={200} format="money" brush={false}
                />
              </div>

              <div className="panel" style={{ padding: 0, marginBottom: 12 }}>
                <div className="panel-head" style={{ padding: '12px 16px 6px' }}>
                  <div className="panel-title"><span className="panel-eyebrow">POR JANELA</span><span className="panel-sub">3 · 7 · 15 · 30 · 60 dias, cada uma vs a anterior</span></div>
                </div>
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead><tr>
                      <th>Janela</th><th className="num">Receita</th><th className="num">Δ</th><th className="num">Vendas</th><th className="num">Δ</th>
                      <th className="num">AOV</th><th className="num">Δ</th><th className="num">Reemb.</th><th className="num">Δ</th><th className="num">Net após CPA</th><th className="num">Δ</th>
                    </tr></thead>
                    <tbody>
                      {d.windows.map((w) => (
                        <tr key={w.days} style={{ background: w.days === win ? 'color-mix(in oklab, var(--accent) 8%, transparent)' : undefined }}>
                          <td className="cell-mono" style={{ fontWeight: 700 }}>{w.days}d</td>
                          <td className="num cell-mono" style={{ color: 'var(--money)' }}>{fmtCurrency(w.revenue, 'USD', 0)}</td>
                          <td className="num"><AaDelta value={w.prevRevenue ? (w.revenue - w.prevRevenue) / w.prevRevenue : null}/></td>
                          <td className="num cell-mono">{fmtInt(w.sales)}</td>
                          <td className="num"><AaDelta value={w.prevSales ? (w.sales - w.prevSales) / w.prevSales : null}/></td>
                          <td className="num cell-mono">{fmtCurrency(w.aov, 'USD', 2)}</td>
                          <td className="num"><AaDelta value={w.prevAov ? (w.aov - w.prevAov) / w.prevAov : null}/></td>
                          <td className="num cell-mono">{fmtPct(w.refundRate, 1)}</td>
                          <td className="num"><AaDelta value={w.prevSales ? w.refundRate - w.prevRefundRate : null} kind="pp" invert/></td>
                          <td className="num cell-mono" style={{ color: w.netAfterCpa == null ? 'var(--fg5)' : w.netAfterCpa >= 0 ? 'var(--money)' : 'var(--danger)' }}>{w.netAfterCpa == null ? '—' : fmtCurrency(w.netAfterCpa, 'USD', 2)}</td>
                          <td className="num"><AaDelta value={w.netAfterCpa != null && w.prevNetAfterCpa != null ? w.netAfterCpa - w.prevNetAfterCpa : null} kind="money2"/></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid-2" style={{ gap: 12 }}>
                <div className="panel" style={{ padding: 0 }}>
                  <div className="panel-head" style={{ padding: '12px 16px 6px' }}>
                    <div className="panel-title"><span className="panel-eyebrow">POR FAMÍLIA</span><span className="panel-sub">receita e share, atual vs anterior</span></div>
                  </div>
                  <div className="tbl-wrap">
                    <table className="tbl">
                      <thead><tr><th>Família</th><th className="num">Receita</th><th className="num">Δ</th><th className="num">Share</th><th className="num">antes</th></tr></thead>
                      <tbody>
                        {d.byFamily.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--fg5)', fontSize: 12 }}>—</td></tr>}
                        {d.byFamily.map((f) => (
                          <tr key={f.family}>
                            <td>{f.family}</td>
                            <td className="num cell-mono" style={{ color: 'var(--money)' }}>{fmtCurrency(f.revenue, 'USD', 0)}</td>
                            <td className="num"><AaDelta value={f.prevRevenue ? (f.revenue - f.prevRevenue) / f.prevRevenue : null}/></td>
                            <td className="num cell-mono">{fmtPct(f.share, 0)}</td>
                            <td className="num cell-mono" style={{ color: 'var(--fg5)' }}>{fmtPct(f.prevShare, 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="panel" style={{ padding: 0 }}>
                  <div className="panel-head" style={{ padding: '12px 16px 6px' }}>
                    <div className="panel-title"><span className="panel-eyebrow">CONTAS</span><span className="panel-sub">{d.entity.accounts.length > 1 ? 'uma linha por plataforma' : 'conta única'}</span></div>
                  </div>
                  <div className="tbl-wrap">
                    <table className="tbl">
                      <thead><tr><th>Conta</th><th className="num">Receita</th><th className="num">Δ</th><th className="num">Net/FE</th><th>Tend.</th>{isAdmin && <th></th>}</tr></thead>
                      <tbody>
                        {d.byAccount.map((a) => (
                          <tr key={a.account.id}>
                            <td>
                              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                <AaPlat slug={a.account.platformSlug}/>
                                <span style={{ fontWeight: 600 }}>{a.account.nickname || a.account.externalId}</span>
                                {a.account.internal && <span style={{ fontSize: 9, color: 'var(--fg5)' }}>interno</span>}
                              </div>
                              <div style={{ fontSize: 10, color: 'var(--fg5)', fontFamily: 'var(--f-mono)' }}>ID {a.account.externalId}{a.account.email ? ` · ${a.account.email}` : ''}</div>
                            </td>
                            <td className="num cell-mono" style={{ color: 'var(--money)' }}>{fmtCurrency(a.cur.revenue, 'USD', 0)}</td>
                            <td className="num"><AaDelta value={a.prev.revenue ? (a.cur.revenue - a.prev.revenue) / a.prev.revenue : null}/></td>
                            <td className="num cell-mono">{a.cur.netAfterCpa == null ? '—' : fmtCurrency(a.cur.netAfterCpa, 'USD', 2)}</td>
                            <td><AaTrend tag={a.trend}/></td>
                            {isAdmin && (
                              <td style={{ whiteSpace: 'nowrap' }}>
                                {d.entity.accounts.length > 1 && (
                                  <button className="btn btn-ghost" disabled={busy} title="Desvincular esta conta do parceiro" onClick={() => act(() => window.NSApi.adminAffiliateIdentity('unlink', { affiliateId: a.account.id }), '✓ conta desvinculada')}>
                                    <Icon name="x" size={11}/>
                                  </button>
                                )}
                                <button className="btn btn-ghost" disabled={busy} title={a.account.internal ? 'Marcar como afiliado real' : 'Marcar como interno (sai do ranking)'} onClick={() => act(() => window.NSApi.adminAffiliateIdentity('internal', { affiliateId: a.account.id, value: !a.account.internal }), '✓ atualizado')}>
                                  <Icon name={a.account.internal ? 'eye' : 'alert-triangle'} size={11}/>
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

Object.assign(window, { AffiliateAnalysisPage });
