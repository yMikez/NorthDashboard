/* global React */
/* All remaining pages: Funnel, Leaderboard, All Affiliates, Products, Transactions, Settings */

// ---------- MOBILE (R2) ----------
// Hook local: true quando o viewport é mobile (≤820px) — mesma régua dos
// utilitários .hide-mobile/.only-mobile do CSS. useState/useEffect vêm dos
// globals de utils.jsx (React UMD).
function useIsMobileAP() {
  const [m, setM] = useState(() => window.matchMedia('(max-width: 820px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 820px)');
    const on = (e) => setM(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return m;
}

// ID de pedido curto pros cards mobile (l3 meta) — mantém início+fim.
function shortTxId(id) {
  if (!id) return '—';
  return id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

function funnelTabStyle(active) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '6px 10px', whiteSpace: 'nowrap',
    background: active ? 'color-mix(in oklab, var(--accent) 12%, transparent)' : 'transparent',
    border: active ? '1px solid var(--accent)' : '1px solid transparent',
    borderRadius: 6, cursor: 'pointer',
    fontFamily: 'var(--f-mono)', fontSize: 11,
    color: active ? 'var(--accent)' : 'var(--fg3)',
  };
}
const funnelTabPillStyle = {
  fontSize: 10, fontFamily: 'var(--f-mono)',
  background: 'color-mix(in oklab, var(--accent) 10%, transparent)', color: 'var(--accent)',
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
  // 'periodo' = filtro global (como sempre); 'janelas' = K janelas de N dias até uma data, com comparativos.
  const [funMode, setFunMode] = useState('periodo');

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
      Array.from(filters.families).join(','), Array.from(filters.affiliates || []).join(',')]);

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
    aov: 0, aovFEOnly: 0, aovWithUpsell: 0, revenueLiftFromUpsells: 0, revenueFeSessions: 0,
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
          <span className="eyebrow">Funnel analytics</span>
          <h2>Front-end <em>até backend</em>.</h2>
          <span className="sub">
            {funMode === 'janelas'
              ? 'janelas de N dias até uma data, cada uma comparada com a anterior · take rates relativas ao FE'
              : selected === 'all'
                ? '100% = vendas iniciais · take rates relativas ao FE'
                : `Funil isolado: ${view.name}`}
          </span>
        </div>
        <div className="page-head-actions">
          <div className="seg">
            {[['periodo', 'Período (filtro)'], ['janelas', 'Janelas & comparativo']].map(([k, l]) => (
              <button key={k} className={funMode === k ? 'is-active' : ''} onClick={() => setFunMode(k)}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      {state.status === 'error' && (
        <div className="panel" style={{ color: 'var(--danger)' }}>Erro ao carregar: {state.error}</div>
      )}

      {byFamily.length > 0 && (
        <div style={{
          display: 'flex', gap: 6, marginBottom: 14, padding: 4,
          background: 'color-mix(in oklab, var(--accent) 4%, transparent)', border: '1px solid var(--border)',
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

      {funMode === 'janelas' && <FunnelWindowsView filters={filters} family={selected}/>}

      {funMode === 'periodo' && (<>
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
          {summary.revenueFeSessions != null && summary.totalGroups > summary.feGroups && (
            <div className="s" style={{ color: 'var(--warning)' }} title="Backend cujo FE ficou fora do período filtrado (ex.: FE ontem, upsell hoje). Entra na receita, não no AOV.">
              inclui {fmtCurrency(summary.totalRevenue - summary.revenueFeSessions, cur, 0)} de {fmtInt(summary.totalGroups - summary.feGroups)} sessões sem FE no período
            </div>
          )}
        </div>
        <div className="mini-kpi">
          <div className="l">AOV (full funnel)</div>
          <div className="v">{fmtCurrency(summary.aov, cur, 0)}</div>
          <div className="s">receita das sessões com FE ÷ FE orders{summary.revenueFeSessions != null && summary.feGroups > 0 ? ` (${fmtCurrency(summary.revenueFeSessions, cur, 0)} ÷ ${fmtInt(summary.feGroups)})` : ''}</div>
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
            <span className="panel-eyebrow">Funnel · FE → backend</span>
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
              <span className="panel-eyebrow">Take rates · por estágio</span>
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
                    ? 'var(--fg1)'
                    : s.takeRate > 0.25 ? 'var(--success)'
                    : s.takeRate > 0.12 ? 'var(--warning)'
                    : s.takeRate > 0   ? 'var(--danger)'
                    : 'var(--fg4)';
                  return (
                    <tr key={s.id}>
                      <td>{s.label}{isFE && <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--fg5)', fontFamily: 'var(--f-mono)' }}>Baseline</span>}</td>
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
              <span className="panel-eyebrow">AOV lift — FE vs FE+upsells</span>
              <div className="panel-sub">Quanto cada grupo gasta em média</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, padding: '10px 0' }}>
            {[
              { label: 'FE only', value: summary.aovFEOnly, color: 'var(--fg5)' },
              { label: 'FE + upsell/bump/down', value: summary.aovWithUpsell, color: 'var(--accent)' },
              { label: 'AOV global', value: summary.aov, color: 'var(--gold)' },
            ].map((r, i) => {
              const maxV = Math.max(summary.aovFEOnly, summary.aovWithUpsell, summary.aov, 1);
              const liftPct = i === 1 && summary.aovFEOnly > 0 ? (r.value - summary.aovFEOnly) / summary.aovFEOnly : null;
              return (
                <div key={r.label} style={{ display: 'grid', gridTemplateColumns: '160px 1fr 80px', gap: 12, alignItems: 'center' }}>
                  <div style={{ fontSize: 12, color: 'var(--fg2)' }}>{r.label}</div>
                  <div style={{ position: 'relative', height: 26, background: 'color-mix(in oklab, var(--fg1) 6%, transparent)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{
                      position: 'absolute', inset: 0,
                      width: `${(r.value / maxV) * 100}%`,
                      background: 'var(--accent)',
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
                    color: liftPct != null && liftPct > 0 ? 'var(--success)' : 'var(--fg4)',
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
              <span className="panel-eyebrow">Cross-sell · entre famílias</span>
              <div className="panel-sub">
                Sessões que entraram via FE de uma família e compraram backend de outra ·
                não infla as take rates da família origem
              </div>
            </div>
          </div>
          <Paginated items={state.data.crossSell} label="pares">
            {(pageRows, pager) => (<>
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
                    {pageRows.map((c, i) => (
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
              {pager}
            </>)}
          </Paginated>
        </div>
      )}
      </>)}
    </div>
  );
}

// ---------- AFFILIATE LEADERBOARD ----------
// Chip do status do modelo CPA (planilha): saudável / atenção / renegociar.
function CpaStatusChip({ status }) {
  if (!status) return <span style={{ color: 'var(--fg5)', fontSize: 10 }}>—</span>;
  const meta = {
    saudavel:   { label: 'Saudável',   fg: 'var(--success)', bg: 'color-mix(in oklab, var(--success) 12%, transparent)', border: 'color-mix(in oklab, var(--success) 35%, transparent)' },
    atencao:    { label: 'Atenção',    fg: 'var(--warning)', bg: 'color-mix(in oklab, var(--warning) 12%, transparent)', border: 'color-mix(in oklab, var(--warning) 35%, transparent)' },
    renegociar: { label: 'Renegociar', fg: 'var(--danger)',  bg: 'color-mix(in oklab, var(--danger) 12%, transparent)',  border: 'color-mix(in oklab, var(--danger) 35%, transparent)' },
  }[status] || { label: String(status), fg: 'var(--fg4)', bg: 'color-mix(in oklab, var(--fg4) 12%, transparent)', border: 'var(--border-soft)' };
  return (
    <span style={{
      fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 700,
      padding: '2px 8px', borderRadius: 'var(--r-full)', whiteSpace: 'nowrap',
      background: meta.bg, color: meta.fg, border: `1px solid ${meta.border}`,
    }}>
      {meta.label}
    </span>
  );
}

// Painel admin da config do modelo CPA (opex% global + régua do status).
// Refund&CB% por plataforma é editado na página Plataformas.
function ProfitConfigPanel() {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState(null);
  const [draft, setDraft] = useState({});
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    if (!open || cfg) return;
    window.NSApi.fetchProfitConfig().then((d) => setCfg(d.config)).catch((e) => setMsg(e.message));
  }, [open]);
  function save() {
    const body = {};
    for (const k of ['opexPct', 'healthyMinUsd', 'attentionMinUsd']) {
      if (draft[k] !== undefined && draft[k] !== '') body[k] = Number(draft[k]);
    }
    if (Object.keys(body).length === 0) return;
    window.NSApi.patchProfitConfig(body)
      .then((d) => { setCfg(d.config); setDraft({}); setMsg('Salvo. Recarrega a lista pra recalcular.'); })
      .catch((e) => setMsg(e.message));
  }
  const inStyle = {
    background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4,
    padding: '4px 8px', color: 'var(--fg1)', fontFamily: 'var(--f-mono)', fontSize: 12, width: 90, textAlign: 'right',
  };
  return (
    <div className="panel" style={{ padding: 0, marginBottom: 12 }}>
      <div className="panel-head" style={{ padding: '10px 14px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} onClick={() => setOpen((v) => !v)}>
        <div className="panel-title">
          Config do modelo CPA
          <span style={{ color: 'var(--fg5)', fontSize: 10, marginLeft: 6 }}>
            custos operacionais % (global) · régua do status · refund&cb% por plataforma fica em Plataformas
          </span>
        </div>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14}/>
      </div>
      {open && (
        <div style={{ display: 'flex', gap: 14, alignItems: 'end', flexWrap: 'wrap', padding: '4px 14px 12px' }}>
          <label style={{ display: 'grid', gap: 4, fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg4)' }}>
            <span>Custos operacionais %</span>
            <input style={inStyle} value={draft.opexPct ?? cfg?.opexPct ?? ''} onChange={(e) => setDraft((d) => ({ ...d, opexPct: e.target.value }))}/>
          </label>
          <label style={{ display: 'grid', gap: 4, fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg4)' }}>
            <span>Saudável ≥ (USD)</span>
            <input style={inStyle} value={draft.healthyMinUsd ?? cfg?.healthyMinUsd ?? ''} onChange={(e) => setDraft((d) => ({ ...d, healthyMinUsd: e.target.value }))}/>
          </label>
          <label style={{ display: 'grid', gap: 4, fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg4)' }}>
            <span>Atenção ≥ (USD)</span>
            <input style={inStyle} value={draft.attentionMinUsd ?? cfg?.attentionMinUsd ?? ''} onChange={(e) => setDraft((d) => ({ ...d, attentionMinUsd: e.target.value }))}/>
          </label>
          <button className="btn btn-primary" onClick={save}>Salvar</button>
          {msg && <span style={{ fontSize: 11, color: 'var(--fg4)' }}>{msg}</span>}
        </div>
      )}
    </div>
  );
}

// Modal de override do refund&cb% de UM afiliado (modelo CPA). Vazio ou
// "Voltar a herdar" → null (usa o default da plataforma).
function AffiliateRefundModal({ aff, onCancel, onSaved }) {
  const [value, setValue] = useState(aff.refundCbPctOverride != null ? String(aff.refundCbPctOverride) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function submit(v) {
    setError(null);
    let parsed = null;
    if (v != null) {
      parsed = Number(String(v).replace(',', '.'));
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
        setError('Valor deve estar entre 0 e 100'); return;
      }
    }
    setSaving(true);
    window.NSApi.patchAffiliateRefundOverride({
      platformSlug: aff.platformSlug,
      externalId: aff.externalId,
      refundCbPct: parsed,
    })
      .then(onSaved)
      .catch((err) => { setError(err.message); setSaving(false); });
  }

  const platformDefault = aff.refundCbPctOverride != null
    ? null // usado ≠ default quando tem override; não sabemos o default aqui
    : aff.refundCbPctUsed;

  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, zIndex: 100, background: 'color-mix(in srgb, var(--ns-black) 72%, transparent)',
      display: 'grid', placeItems: 'center',
    }}>
      <div onClick={(e) => e.stopPropagation()} className="panel" style={{ width: 'min(380px, 92vw)', padding: 22 }}>
        <div className="eyebrow" style={{ fontSize: 10, color: 'var(--glow-cyan)', marginBottom: 4 }}>
          Refund & chargeback · modelo CPA
        </div>
        <h3 style={{ margin: '0 0 4px', fontSize: 18 }}>{aff.nickname || aff.externalId}</h3>
        <p style={{ fontSize: 11, color: 'var(--fg4)', marginBottom: 16 }}>
          Taxa usada no NET AOV <b>só deste afiliado</b>. Em uso agora:{' '}
          <b style={{ color: 'var(--fg2)' }}>{aff.refundCbPctUsed}%</b>{' '}
          ({aff.refundCbPctOverride != null ? 'override' : 'default da plataforma'}).
          {platformDefault != null ? '' : ' Salvar vazio ou "Voltar a herdar" retorna ao default da plataforma.'}
        </p>
        <label style={{ display: 'block', marginBottom: 16 }}>
          <span style={{ fontSize: 11, color: 'var(--fg3)', display: 'block', marginBottom: 4 }}>
            Refund & chargeback (%)
          </span>
          <input
            type="text" inputMode="decimal" value={value} autoFocus
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(value.trim() === '' ? null : value); }}
            placeholder="ex: 12.5 · vazio = herdar da plataforma"
            style={feesInputStyle}
          />
        </label>
        {error && <div style={{ color: 'var(--danger)', fontSize: 11, marginBottom: 10 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <button className="btn btn-ghost" disabled={saving || aff.refundCbPctOverride == null}
            onClick={() => submit(null)} title="Remove o override — volta ao default da plataforma">
            Voltar a herdar
          </button>
          <span style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" onClick={onCancel} disabled={saving}>Cancelar</button>
            <button className="btn btn-primary" disabled={saving}
              onClick={() => submit(value.trim() === '' ? null : value)}>
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

function LeaderboardPage({ filters, onOpenAffiliate, user }) {
  // Quem tem a aba gerencia identidades/contato (não só admin) — 2026-08-25.
  const isAdmin = !!user;
  const [sortBy, setSortBy] = useState('revenue');
  const [minOrders, setMinOrders] = useState(1);
  const [query, setQuery] = useState('');
  const [state, setLbState] = useState({ status: 'loading', data: null, error: null });
  // Modal de override do refund&cb% por afiliado (substitui o prompt nativo).
  const [refundModal, setRefundModal] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);
  // Agrupamento da lista: 'partner' = contas do mesmo parceiro (Identidades)
  // viram uma linha; 'mapped' = pelo affiliate_id do NorthScale Afiliados
  // (sistema de afiliados); 'none' = uma linha por conta/plataforma.
  const [unify, setUnify] = useState('partner');
  const [mappingOpen, setMappingOpen] = useState(false);
  // Guarda só a CHAVE; a linha é re-derivada da lista a cada refetch (trocar
  // filtro ou salvar contato com o drawer aberto não deixa dado velho).
  const [partnerKey, setPartnerKey] = useState(null);
  const [identityOpen, setIdentityOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLbState((s) => ({ ...s, status: 'loading' }));
    window.NSApi.fetchAffiliates(filters, { unify })
      .then((data) => { if (!cancelled) setLbState({ status: 'ready', data, error: null }); })
      .catch((err) => {
        if (cancelled) return;
        console.error('fetchAffiliates failed', err);
        setLbState({ status: 'error', data: null, error: err.message });
      });
    return () => { cancelled = true; };
  }, [refreshTick, unify, filters.dateRange.start.getTime(), filters.dateRange.end.getTime(),
      Array.from(filters.platforms).join(','), Array.from(filters.countries).join(','),
      Array.from(filters.funnels).join(','),
      Array.from(filters.families).join(','), Array.from(filters.affiliates || []).join(',')]);

  const cur = filters.currency || 'USD';
  const all = state.data?.affiliates || [];
  const partnerRow = partnerKey ? (all.find((r) => r.key === partnerKey) || null) : null;
  const setPartnerRow = (r) => setPartnerKey(r ? r.key : null);
  const summary = state.data?.summary || { activeNow: 0, activePrev: 0, concentration: 0, newAff: 0, churnedAff: 0 };

  // AOV padrão (fórmula do usuário): RECEITA da linha ÷ FEs APROVADAS —
  // verificável a olho, as duas são colunas da própria tabela. Mesmo
  // cálculo do NET AOV do modelo CPA no backend.
  function aovOf(a) {
    if (!a || !(a.feApprovedCount > 0)) return 0;
    return a.revenue / a.feApprovedCount;
  }

  // Média simples da coluna CPA/venda (cpaPerFe = CPA negociado, último
  // valor observado). Roda sobre `all` — a lista completa do período, NÃO
  // sobre `rows` (que o usuário filtra por mín. de pedidos e ordenação):
  // o card mede o contrato médio da base, não da fatia visível.
  //
  // Afiliado de RECUPERAÇÃO fica FORA (pedido do usuário, 2026-09-22): ele é
  // pago por comissão % sobre a venda, não por CPA de contrato — o skill99
  // entra com ~$38/venda contra ~$245 dos outros e afunda a média.
  const cpaStats = (() => {
    const withCpa = all.filter((a) => (a.cpaPerFe || 0) > 0 && !a.isRecovery);
    const sum = withCpa.reduce((s, a) => s + a.cpaPerFe, 0);
    const excluded = all.filter((a) => (a.cpaPerFe || 0) > 0 && a.isRecovery);
    return { sum, count: withCpa.length, avg: withCpa.length ? sum / withCpa.length : 0, excluded: excluded.length };
  })();

  // Busca por nome OU id. Quando há termo, o mínimo de pedidos é ignorado —
  // procurar um afiliado específico e não achar porque ele tem 2 vendas seria
  // o pior resultado possível.
  const q = query.trim().toLowerCase();
  const rows = all.filter((a) => (q
    ? ((a.nickname || '').toLowerCase().includes(q) || a.externalId.toLowerCase().includes(q)
       || (a.accounts || []).some((c) => (c.nickname || '').toLowerCase().includes(q) || c.externalId.toLowerCase().includes(q))
       || (a.contact?.email || '').toLowerCase().includes(q)
       || (a.mapped?.name || '').toLowerCase().includes(q))
    : a.realOrders >= minOrders
  )).sort((a, b) => {
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
          <span className="eyebrow">Afiliados</span>
          <h2>Quem está <em>puxando o resultado</em>.</h2>
          <span className="sub">Ranking + diretório fundidos · modelo da planilha CPA: NET AOV → Net after CPA → status de renegociação</span>
        </div>
        <div className="page-head-actions" style={{ flexWrap: 'wrap' }}>
          <div className="select-btn" style={{ padding: '0 10px', width: 'min(240px, 100%)' }}>
            <Icon name="search" size={13}/>
            <input value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nome ou ID..."
              style={{ background: 'transparent', border: 0, color: 'var(--fg1)', outline: 'none', flex: 1, fontFamily: 'var(--f-body)', fontSize: 12 }}
            />
            {query && (
              <button className="btn btn-ghost" style={{ padding: '0 4px', fontSize: 11 }}
                title="Limpar busca" onClick={() => setQuery('')}>×</button>
            )}
          </div>
          <div className="seg" title="Como agrupar: por conta/plataforma · por parceiro (Identidades) · pelo affiliate_id do sistema de afiliados (NorthScale Afiliados)">
            <button className={unify === 'none' ? 'is-active' : ''} onClick={() => setUnify('none')}>por conta</button>
            <button className={unify === 'partner' ? 'is-active' : ''} onClick={() => setUnify('partner')}>parceiros</button>
            <button className={unify === 'mapped' ? 'is-active' : ''} onClick={() => setUnify('mapped')}>sistema</button>
          </div>
          {isAdmin && (
            <button className="btn btn-ghost" title="Unificar contas, contatos e internos" onClick={() => setIdentityOpen(true)}>
              <Icon name="link" size={12}/> Identidades
            </button>
          )}
          <button className="btn btn-ghost" title="Espelho do NorthScale Afiliados: quem está mapeado e a fila de IDs sem mapeamento" onClick={() => setMappingOpen(true)}>
            <Icon name="plug" size={12}/> Mapeamento
          </button>
          <button className="btn btn-ghost" onClick={() => downloadCsv(
            `ranking-afiliados_${isoDateOnly(filters.dateRange.start)}_${isoDateOnly(filters.dateRange.end)}.csv`,
            ['#', 'Afiliado', 'Afiliado ID', 'Afiliado (sistema)', 'affiliate_id', 'Plataforma', 'Pedidos aprovados', 'Receita USD', 'FEs aprovadas',
             'AOV global USD', 'Aprovação %', 'Refund&CB modelo %', 'CPA pago USD', 'Custos op %',
             'NET AOV USD', 'CPA por venda USD', 'Net after CPA USD', 'Status CPA'],
            rows.map((r, i) => [
              i + 1, r.nickname || r.externalId, r.accounts && r.accounts.length > 1 ? r.accounts.map((c) => c.externalId).join(' | ') : r.externalId, r.mapped ? r.mapped.name : '', r.mappedAffiliateId || '', (r.platforms || [r.platformSlug]).join('+'), r.orders, r.revenue, r.feApprovedCount,
              aovOf(r), r.approvalRate * 100, r.refundCbPctUsed, r.cpa, r.opexPctUsed,
              r.netAovUsd, r.cpaPerFe, r.netAfterCpaUsd, r.cpaStatus,
            ]),
          )}><Icon name="download" size={12}/> Exportar CSV</button>
        </div>
      </div>
      {/* DS1 "dado com contexto": fonte que não reporta estorno = leitura parcial */}
      <RefundCoverageNotice platforms={Array.from(filters.platforms || [])}/>

      <ProfitConfigPanel/>

      {partnerRow && (
        <AffiliatePartnerDrawer row={partnerRow} filters={filters} isAdmin={isAdmin && !String(partnerRow.key || '').startsWith('mapped:')}
          onClose={() => setPartnerRow(null)}
          onOpenAccount={(acc) => { setPartnerRow(null); onOpenAffiliate({ externalId: acc.externalId, platformSlug: acc.platformSlug }); }}
          onChanged={() => setRefreshTick((n) => n + 1)}/>
      )}
      {identityOpen && <AffiliateIdentityDrawer onClose={() => setIdentityOpen(false)} onChanged={() => setRefreshTick((n) => n + 1)}/>}
      {mappingOpen && <AffiliateMappingDrawer isAdmin={user?.role === 'ADMIN'} onClose={() => setMappingOpen(false)} onChanged={() => setRefreshTick((n) => n + 1)}/>}

      {refundModal && (
        <AffiliateRefundModal
          aff={refundModal}
          onCancel={() => setRefundModal(null)}
          onSaved={() => { setRefundModal(null); setRefreshTick((n) => n + 1); }}
        />
      )}

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
          style={summary.concentration > 0.6 ? { borderColor: 'color-mix(in srgb, var(--danger) 35%, transparent)' } : {}}>
          <div className="l">Concentração top 5</div>
          <div className="v" style={summary.concentration > 0.6 ? { color: 'var(--danger)' } : {}}>
            {(summary.concentration * 100).toFixed(0)}%
          </div>
          <div className="s">{summary.concentration > 0.6 ? <><Icon name="alert-triangle" size={11}/> risco de concentração · acima de 60%</> : 'distribuição saudável'}</div>
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
        {/* CPA médio: média SIMPLES da coluna CPA/venda — cada afiliado
            entra uma vez, independente do volume dele (é a média do CPA
            NEGOCIADO, não o custo médio por venda). Denominador = quem tem
            CPA > 0; afiliado organic (coluna "—") ficaria como zero e
            puxaria a média pra baixo. Afiliado de recuperação também fica de
            fora — é comissão %, não CPA. O sub deixa a conta explícita. */}
        <div className="mini-kpi">
          <div className="l">CPA médio por afiliado</div>
          <div className="v" style={{ color: 'var(--money)' }}>
            {cpaStats.count > 0 ? fmtCurrency(cpaStats.avg, cur, 0) : '—'}
          </div>
          <div className="s" title={cpaStats.excluded > 0 ? 'Afiliado de recuperação é pago por comissão % sobre a venda, não por CPA — entra na aba Recuperação, não nesta média.' : undefined}>
            {cpaStats.count > 0
              ? `${fmtCurrency(cpaStats.sum, cur, 0)} ÷ ${cpaStats.count} afiliados com CPA`
              : 'nenhum afiliado com CPA no período'}
            {cpaStats.excluded > 0
              ? ` · fora ${cpaStats.excluded} de recuperação`
              : ''}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0 12px', flexWrap: 'wrap' }}>
        <span className="f-label">Ordenar por</span>
        <div className="seg">
          {[['revenue','Receita'],['aov','AOV'],['orders','Pedidos'],['approvalRate','Aprovação'],['refundRate','Reembolsos'],['chargebackRate','Chargebacks']].map(([k,l]) => (
            <button key={k} className={sortBy === k ? 'is-active' : ''} onClick={() => setSortBy(k)}>{l}</button>
          ))}
        </div>
        <span className="f-label" style={{ marginLeft: 10 }}>Mín. pedidos</span>
        <div className="seg" style={q ? { opacity: 0.45, pointerEvents: 'none' } : undefined}>
          {[1, 5, 10, 25].map(n => (
            <button key={n} className={minOrders === n ? 'is-active' : ''} onClick={() => setMinOrders(n)}>{n}+</button>
          ))}
        </div>
        {q && (
          <span className="f-label" style={{ color: 'var(--fg4)' }}>
            busca ativa · {rows.length} {rows.length === 1 ? 'afiliado' : 'afiliados'} (mín. de pedidos ignorado)
          </span>
        )}
      </div>

      {state.status === 'error' && (
        <div className="panel" style={{ color: 'var(--danger)' }}>Erro ao carregar: {state.error}</div>
      )}

      <div className="panel" style={{ padding: 0 }}>
        <Paginated items={rows} label="afiliados" resetKey={`${sortBy}|${q}|${minOrders}|${unify}`}>
          {(pageRows, pager, pg) => (<>
            <div className="tbl-wrap" key={`p${pg.page}-${pg.pageSize}`} style={{ margin: 0, padding: '0 4px', maxHeight: 620, overflowY: 'auto' }}>
              <table className="tbl tbl--sticky-first">
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>#</th>
                    <th>Afiliado</th>
                    <th>Plataforma</th>
                    <th className="num">Pedidos</th>
                    <th className="num">Receita</th>
                    <th className="num" title="AOV = receita das vendas creditadas a ESTE afiliado (FE + os upsells/downsells em que a plataforma manteve o crédito nele) ÷ FEs APROVADAS. É a lente DIRETA: cross-sell da mesma sessão que a plataforma creditou a outro afiliado não entra. Mesmo AOV que alimenta o NET AOV do modelo CPA.">AOV</th>
                    <th title="Aprovadas ÷ pedidos REAIS do período. Na Digistore o estorno é uma linha extra e não entra no denominador — a venda original já está contada.">Aprovação</th>
                    <th className="num">Reembolso</th>
                    <th className="num" title="Chargebacks ÷ pedidos REAIS do período.">Chargeback</th>
                    <th className="num">CPA pago</th>
                    <th className="num" title="Custos operacionais % (global, modelo CPA) — editável no painel de config acima">Custos op.</th>
                    <th className="num" title="NET AOV = AOV global × (1 − refund&cb% − taxa da plataforma − custos operacionais % − reserva retida %). Modelo da planilha CPA — % editáveis em Plataformas e no painel de config acima.">NET AOV</th>
                    <th className="num" title="CPA por venda FE — último valor observado nas transações">CPA/venda</th>
                    <th className="num" title="NET AFTER CPA = NET AOV − CPA por venda. Quanto sobra por pedido depois de pagar o afiliado.">Net after CPA</th>
                    <th title="≥ limiar saudável → Saudável · ≥ limiar atenção → Atenção · abaixo → Renegociar (régua editável no painel de config)">Status CPA</th>
                  </tr>
                </thead>
                <tbody>
                  {state.status === 'loading' && <SkelTableRows rows={10} cols={15}/>}
                  {state.status === 'ready' && rows.length === 0 && (
                    <tr><td colSpan={15} style={{ textAlign: 'center', padding: 24, opacity: 0.6 }}>
                      Nenhum afiliado com pelo menos {minOrders} pedido{minOrders > 1 ? 's' : ''} no período
                    </td></tr>
                  )}
                  {pageRows.map((r, i) => {
                    const apClass = r.approvalRate > 0.7 ? 'val-ok' : r.approvalRate > 0.5 ? 'val-warn' : 'val-bad';
                    const rfClass = r.refundRate < 0.06 ? 'val-ok' : r.refundRate < 0.12 ? 'val-warn' : 'val-bad';
                    const cbClass = r.cbRate < 0.005 ? 'val-ok' : r.cbRate < 0.01 ? 'val-warn' : 'val-bad';
                    const { cls: platClass, short: platShort } = platBadge(r.platformSlug);
                    const displayName = r.nickname || r.externalId;
                    return (
                      <tr tabIndex={0} key={r.key || `${r.platformSlug}:${r.externalId}`} onClick={() => (r.accounts && r.accounts.length > 1 ? setPartnerRow(r) : onOpenAffiliate({ externalId: r.externalId, platformSlug: r.platformSlug }))}>
                        <td className="rank">{String(pg.start + i + 1).padStart(2, '0')}</td>
                        <td>
                          <span className="cell-aff">
                            <span className="av" style={{ background: avatarColor(r.externalId) }}>{initials(displayName)}</span>
                            <span className="meta">
                              <span className="nm">{displayName}{r.accounts && r.accounts.length > 1 && <span title="contas unificadas" style={{ marginLeft: 5, color: 'var(--accent)', verticalAlign: -1 }}><Icon name="link" size={10}/></span>}{r.origin && <span style={{ marginLeft: 6 }}><AiOriginChip origin={r.origin} size={9}/></span>}</span>
                              <span className="id">{r.accounts && r.accounts.length > 1 ? `${r.accounts.length} contas · ${r.accounts.map((c) => c.externalId).join(' · ')}` : r.externalId}{isAdmin && r.contact?.email ? ` · ${r.contact.email}` : ''}</span>
                              <span style={{ marginTop: 2 }}><AmMappedChip mapped={r.mapped} platformSlug={r.platformSlug}/></span>
                            </span>
                          </span>
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {(r.accounts && r.accounts.length > 1 ? r.accounts : [r]).map((c) => { const pb = platBadge(c.platformSlug); return <span key={`${c.platformSlug}:${c.externalId}`} className={`plat ${pb.cls}`} style={{ marginRight: 3 }} title={c.nickname || c.externalId}>{pb.short}</span>; })}
                        </td>
                        <td className="num cell-mono">{fmtInt(r.orders)}</td>
                        <td className="num cell-mono" style={{ color: 'var(--fg1)' }}>{fmtCurrency(r.revenue, cur, 0)}</td>
                        <td className="num cell-mono" style={{ color: 'var(--money)' }}>
                          {aovOf(r) > 0 ? fmtCurrency(aovOf(r), cur, 0) : '—'}
                          {aovOf(r) > 0 && (
                            <span style={{ display: 'block', fontSize: 10, color: 'var(--fg5)', fontWeight: 400, marginTop: 1 }}>
                              {fmtInt(r.feApprovedCount)} FEs
                            </span>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span className={`cell-mono ${apClass}`} style={{ minWidth: 44 }}>{(r.approvalRate * 100).toFixed(1)}%</span>
                            <div className={`ratebar ${apClass === 'val-ok' ? 'ok' : apClass === 'val-warn' ? 'warn' : 'bad'}`} style={{ width: 48 }}><span style={{ width: `${r.approvalRate * 100}%` }}/></div>
                          </div>
                        </td>
                        <td className="num cell-mono"
                          title={`Taxa do MODELO CPA usada no NET AOV: ${r.refundCbPctUsed}% (${r.accounts && r.accounts.length > 1 ? 'média ponderada das contas — override é por conta' : r.refundCbPctOverride != null ? 'override deste afiliado' : 'default da plataforma'}).\nObservada no período: ${(r.refundRate * 100).toFixed(1)}% = ${fmtInt(r.refunds)} estornos ÷ ${fmtInt(r.realOrders)} pedidos reais.${r.realOrders !== r.allOrders ? `\n(${fmtInt(r.allOrders - r.realOrders)} linhas de estorno da Digistore fora do denominador.)` : ''}\nCoorte por data da VENDA: período recente ainda vai receber reembolsos.`}>
                          {r.refundCbPctUsed}%
                          {r.refundCbPctOverride != null && <span style={{ fontSize: 8, color: 'var(--glow-cyan)', marginLeft: 3 }}>ovr</span>}
                          <span className={rfClass} style={{ fontSize: 10, marginLeft: 5, opacity: 0.75 }}>obs {(r.refundRate * 100).toFixed(1)}%</span>
                        </td>
                        <td className={`num cell-mono ${cbClass}`}>{(r.cbRate * 100).toFixed(2)}%</td>
                        <td className="num cell-mono">{fmtCurrency(r.cpa, cur, 0)}</td>
                        <td className="num cell-mono" style={{ color: 'var(--fg4)' }}>{r.opexPctUsed}%</td>
                        <td className="num cell-mono">{r.netAovUsd > 0 ? fmtCurrency(r.netAovUsd, cur, 0) : '—'}</td>
                        <td className="num cell-mono">{(r.cpaPerFe || 0) > 0 ? fmtCurrency(r.cpaPerFe, cur, 0) : '—'}</td>
                        <td className="num cell-mono" style={{ fontWeight: 700, color: r.netAfterCpaUsd == null ? 'var(--fg5)' : r.netAfterCpaUsd < 0 ? 'var(--danger)' : r.cpaStatus === 'saudavel' ? 'var(--money)' : 'var(--warning)' }}>
                          {r.netAfterCpaUsd != null ? fmtCurrency(r.netAfterCpaUsd, cur, 0) : '—'}
                        </td>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <CpaStatusChip status={r.cpaStatus}/>
                            {!(r.accounts && r.accounts.length > 1) && (<button
                              className="btn btn-ghost" style={{ padding: '1px 6px', fontSize: 10 }}
                              title={`Refund&CB usado: ${r.refundCbPctUsed}% ${r.refundCbPctOverride != null ? '(override deste afiliado)' : '(default da plataforma)'} — clique pra editar só deste afiliado`}
                              onClick={(e) => { e.stopPropagation(); setRefundModal(r); }}
                            >%</button>)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {pager}
          </>)}
        </Paginated>
      </div>
    </div>
  );
}

// ---------- AFFILIATE DRAWER (drill-down) ----------
function AffiliateDrawer({ affiliateId, filters, onClose }) {
  // Aceita string (externalId) ou { externalId, platformSlug } — o hint de
  // plataforma evita ambiguidade quando o mesmo ID existe em mais de uma.
  const affKey = typeof affiliateId === 'string' ? affiliateId : ((affiliateId && affiliateId.externalId) || '');
  const platformHint = affiliateId && typeof affiliateId === 'object' ? affiliateId.platformSlug : undefined;
  const [state, setDState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    setDState((s) => ({ ...s, status: 'loading' }));
    window.NSApi.fetchAffiliateDetail(affKey, filters, platformHint)
      .then((data) => { if (!cancelled) setDState({ status: 'ready', data, error: null }); })
      .catch((err) => {
        if (cancelled) return;
        console.error('fetchAffiliateDetail failed', err);
        setDState({ status: 'error', data: null, error: err.message || String(err) });
      });
    return () => { cancelled = true; };
  }, [affKey, platformHint, filters.dateRange.start.getTime(), filters.dateRange.end.getTime(),
      Array.from(filters.platforms).join(','), Array.from(filters.countries).join(','),
      Array.from(filters.funnels).join(','),
      Array.from(filters.families).join(','), Array.from(filters.affiliates || []).join(',')]);

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
              <div className="av-lg" style={{ background: avatarColor(affKey) }}>{initials(affKey)}</div>
              <div>
                <h3>{affKey}</h3>
                <div className="sub">
                  {state.status === 'loading' ? 'Carregando dados do afiliado…' : `Erro: ${state.error}`}
                </div>
              </div>
            </div>
            <button className="icon-btn" onClick={onClose} aria-label="Fechar" title="Fechar"><Icon name="x" size={14}/></button>
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
                <span style={{ marginLeft: 8 }}><AmMappedChip mapped={aff.mapped} platformSlug={aff.platformSlug}/></span>
              </div>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar" title="Fechar"><Icon name="x" size={14}/></button>
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
              <div className="v">{k.realOrders ? (k.approvalRate * 100).toFixed(1) + '%' : '—'}</div>
              <div className="s">{fmtInt(k.realOrders)} pedidos reais</div>
            </div>
            <div className="mini-kpi">
              <div className="l">Refund rate</div>
              <div className="v">{k.realOrders ? (k.refundRate * 100).toFixed(1) + '%' : '—'}</div>
              <div className="s">{fmtInt(k.refunds)} de {fmtInt(k.realOrders)} · meta &lt;6%</div>
            </div>
            <div className="mini-kpi">
              <div className="l">Chargeback</div>
              <div className="v" style={{ color: k.cbRate > 0.01 ? 'var(--danger)' : 'inherit' }}>
                {k.realOrders ? (k.cbRate * 100).toFixed(2) + '%' : '—'}
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
            {/* Substitui o antigo "Net margin" (net − CPA), que somava os
                estornos no net mas não descontava o CPA da venda estornada, e
                ignorava COGS/frete/opex. Aqui é o modelo da planilha CPA, com
                os MESMOS números do ranking — só que somado no período. */}
            <div className="mini-kpi">
              <div className="l">Net after CPA · total</div>
              <div className="v" style={{
                color: k.netAfterCpaTotalUsd == null ? 'var(--fg5)'
                  : k.netAfterCpaTotalUsd < 0 ? 'var(--danger)'
                  : k.cpaStatus === 'saudavel' ? 'var(--money)' : 'var(--warning)',
              }}>
                {k.netAfterCpaTotalUsd != null ? fmtCurrency(k.netAfterCpaTotalUsd, cur, 0) : '—'}
              </div>
              <div className="s" title={k.netAfterCpaUsd != null
                ? `NET AOV ${fmtCurrency(k.netAovUsd, cur, 2)} = AOV ${fmtCurrency(k.aov, cur, 2)} × (1 − ${k.refundCbPctUsed}% refund&cb${k.refundCbPctOverride != null ? ' (override)' : ''} − taxa da plataforma − ${k.opexPctUsed}% opex).\nNET AFTER CPA ${fmtCurrency(k.netAfterCpaUsd, cur, 2)} = NET AOV − CPA ${fmtCurrency(k.cpaPerFe, cur, 2)}.\nTotal = × ${fmtInt(k.feApprovedCount)} FEs aprovadas.`
                : 'Sem CPA observado no período — afiliado organic ou sem venda de front.'}>
                {k.netAfterCpaUsd != null
                  ? `${fmtCurrency(k.netAfterCpaUsd, cur, 0)}/venda × ${fmtInt(k.feApprovedCount)} FEs`
                  : 'sem CPA observado no período'}
              </div>
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
                  <span className="panel-eyebrow">Sinais automáticos</span>
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
                <span className="panel-eyebrow">Receita diária · período</span>
                <div className="panel-sub">Gross aprovado de {displayName}</div>
              </div>
            </div>
            {dailySeries.length > 0
              ? <NSTimeSeries data={dailySeries} height={200} currency={cur}
                  series={[{ key: 'gross', label: 'Receita', color: 'var(--money)' }]}/>
              : <div style={{ padding: 24, textAlign: 'center', opacity: 0.6 }}>Sem vendas no período</div>}
          </div>

          {data.byProduct.length > 0 && (
            <div className="panel">
              <div className="panel-head">
                <div className="panel-title">
                  <span className="panel-eyebrow">Vendas por oferta</span>
                  <div className="panel-sub">Aprovados, ordenados por receita</div>
                </div>
              </div>
              <Paginated items={data.byProduct} label="ofertas">
                {(pageRows, pager) => (<>
                  <div className="tbl-wrap">
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
                        {pageRows.map((p) => (
                          <tr key={p.externalId}>
                            <td>
                              <div>{p.name}</div>
                              <div className="cell-mono" style={{ fontSize: 10, color: 'var(--fg5)' }}>{p.externalId}</div>
                            </td>
                            <td><span className="badge neutral">{({ FRONTEND: 'Frontend', UPSELL: 'Upsell', DOWNSELL: 'Downsell', BUMP: 'Bump', SMS_RECOVERY: 'SMS Recovery' })[p.productType] || p.productType}</span></td>
                            <td className="num cell-mono">{fmtInt(p.orders)}</td>
                            <td className="num cell-mono">{fmtCurrency(p.revenue, cur, 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {pager}
                </>)}
              </Paginated>
            </div>
          )}

          {data.byCountry.length > 0 && (
            <div className="panel">
              <div className="panel-head">
                <div className="panel-title">
                  <span className="panel-eyebrow">Países · top 8</span>
                  <div className="panel-sub">Receita aprovada por país</div>
                </div>
              </div>
              <div className="tbl-wrap">
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
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ---------- REFUND COHORTS (Cohort.md) ----------
// Matriz: linha = dia da VENDA, coluna = dias desde a venda, célula = %
// ACUMULADO estornado (reembolso+chargeback). Censura: coorte que ainda não
// viveu o dia N fica em branco (≠ 0%). Curva de maturação agrega só coortes
// maduras em cada idade. Eixos vêm da dupla lente (orderedAt=venda,
// refundedAt=estorno) — ver lib/services/refundCohorts.ts.
function RefundCohortsPage({ filters }) {
  const [view, setView] = useState('painel');      // 'painel' | 'ajuda'
  const [metric, setMetric] = useState('count');   // 'count' | 'usd'
  const [horizon, setHorizon] = useState(30);
  const [minN, setMinN] = useState(30);            // amostra mínima (Cohort.md §4)
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading' }));
    window.NSApi.fetchRefundCohorts(filters, horizon)
      .then((data) => { if (!cancelled) setState({ status: 'ready', data, error: null }); })
      .catch((err) => {
        if (cancelled) return;
        console.error('fetchRefundCohorts failed', err);
        setState({ status: 'error', data: null, error: err.message });
      });
    return () => { cancelled = true; };
  }, [horizon, filters.dateRange.start.getTime(), filters.dateRange.end.getTime(),
      Array.from(filters.platforms).join(','), Array.from(filters.countries).join(','),
      Array.from(filters.funnels).join(','), Array.from(filters.stages).join(','),
      Array.from(filters.families).join(','), Array.from(filters.affiliates || []).join(',')]);

  const cur = filters.currency || 'USD';
  const d = state.data;
  const cohorts = d?.cohorts || [];
  const curve = d?.curve || [];

  const pctOf = (cell) => (metric === 'usd' ? cell.pctUsd : cell.pctCount);

  // Escala DIVERGENTE com ponto neutro na meta de 6% (mesma régua "meta
  // <6%" do resto do dash): abaixo → verde (--ok), acima → vermelho
  // (--danger), saturando em 2× a meta. Fundo via color-mix em oklab
  // (regra do design system); o NÚMERO fica em token de texto, sempre.
  const MID = 0.06;
  function cellBg(p) {
    if (p <= MID) {
      const t = Math.round((1 - p / MID) * 55);
      return `color-mix(in oklab, var(--success) ${t}%, transparent)`;
    }
    const t = Math.round(Math.min(1, (p - MID) / MID) * 55);
    return `color-mix(in oklab, var(--danger) ${t}%, transparent)`;
  }

  // Chips de maturação: valor agregado da curva nas idades de referência.
  const matAt = (age) => {
    const pt = curve[age];
    if (!pt) return null;
    const v = metric === 'usd' ? pt.pctUsd : pt.pctCount;
    return v == null ? null : v;
  };

  // Colunas exibidas: até o horizonte, mas em passos maiores no fim pra
  // matriz não explodir em largura (0..14 diário, depois de 2 em 2 / 5 em 5).
  const cols = [];
  for (let c = 0; c <= horizon; c++) {
    if (c <= 14 || (horizon <= 30 ? c % 2 === 0 : c % 5 === 0) || c === horizon) cols.push(c);
  }

  const curveMax = Math.max(0.001, ...curve.map((pt) => {
    const v = metric === 'usd' ? pt.pctUsd : pt.pctCount;
    return v == null ? 0 : v;
  }));

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">Análise · reembolso por coorte</span>
          <h2>Quando o reembolso <em>realmente acontece</em>.</h2>
          <span className="sub">
            cada estorno preso ao dia da VENDA original · célula em branco = coorte ainda não viveu aquele dia · inclui chargebacks
          </span>
        </div>
        <div className="page-head-actions" style={{ flexWrap: 'wrap' }}>
          <div className="seg">
            {[['painel', 'Painel'], ['ajuda', 'Como ler']].map(([k, l]) => (
              <button key={k} className={view === k ? 'is-active' : ''} onClick={() => setView(k)}>{l}</button>
            ))}
          </div>
          {view === 'painel' && (
            <div className="seg">
              {[['count', 'Pedidos'], ['usd', 'Valor $']].map(([k, l]) => (
                <button key={k} className={metric === k ? 'is-active' : ''} onClick={() => setMetric(k)}>{l}</button>
              ))}
            </div>
          )}
        </div>
      </div>
      {/* DS1 "dado com contexto": fonte que não reporta estorno = leitura parcial */}
      <RefundCoverageNotice platforms={Array.from(filters.platforms || [])}/>

      {view === 'ajuda' && <RefundCohortsHelp horizon={horizon}/>}

      {view === 'painel' && <>

      <div className="mini-kpis">
        {[7, 14, 30].filter((a) => a <= horizon).map((age) => {
          const v = matAt(age);
          const pt = curve[age];
          return (
            <div className="mini-kpi" key={age}>
              <div className="l">Taxa madura · D{age}</div>
              <div className="v" style={{ color: v != null && v > MID ? 'var(--danger)' : 'inherit' }}>
                {v != null ? (v * 100).toFixed(2) + '%' : '—'}
              </div>
              <div className="s">
                {pt && pt.eligibleBaseCount > 0
                  ? `${fmtInt(pt.eligibleBaseCount)} vendas com ${age}d+ de idade`
                  : 'nenhuma coorte madura ainda'}
              </div>
            </div>
          );
        })}
        <div className="mini-kpi">
          <div className="l">Base no período</div>
          <div className="v">{d ? fmtInt(d.totals.baseCount) : '—'}</div>
          <div className="s">{d ? `${fmtCurrency(d.totals.baseUsd, cur, 0)} vendidos` : '…'}</div>
        </div>
        {/* FASE 2: projeção chain-ladder+BF de onde o PERÍODO estabiliza. */}
        <div className="mini-kpi">
          <div className="l">Projeção do período · D{d ? d.horizonDays : horizon}</div>
          <div className="v" style={{
            color: (() => {
              const v = d ? (metric === 'usd' ? d.projection?.periodPctUsd : d.projection?.periodPctCount) : null;
              return v != null && v > 0.06 ? 'var(--danger)' : 'inherit';
            })(),
          }}>
            {(() => {
              const v = d ? (metric === 'usd' ? d.projection?.periodPctUsd : d.projection?.periodPctCount) : null;
              return v != null ? '~' + (v * 100).toFixed(2) + '%' : '—';
            })()}
          </div>
          <div className="s">
            {d?.projection?.tailIncomplete
              ? 'Piso — falta histórico pro fim da curva'
              : 'estimativa · coortes imaturas projetadas'}
          </div>
        </div>
        <div className="mini-kpi">
          <div className="l">Estornado (matriz)</div>
          <div className="v" style={{ color: 'var(--danger)' }}>{d ? fmtInt(d.totals.refundCount) : '—'}</div>
          <div className="s">
            {d ? `${fmtCurrency(d.totals.refundUsd, cur, 0)}${d.totals.beyondHorizonCount > 0 ? ` · +${fmtInt(d.totals.beyondHorizonCount)} além do horizonte` : ''}` : '…'}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0 12px', flexWrap: 'wrap' }}>
        <span className="f-label">Horizonte</span>
        <div className="seg">
          {[14, 30, 60, 90].map((h) => (
            <button key={h} className={horizon === h ? 'is-active' : ''} onClick={() => setHorizon(h)}>{h}d</button>
          ))}
        </div>
        <span className="f-label" style={{ marginLeft: 10 }}>Amostra mín.</span>
        <div className="seg">
          {[10, 30, 50].map((n) => (
            <button key={n} className={minN === n ? 'is-active' : ''} onClick={() => setMinN(n)}>{n}</button>
          ))}
        </div>
        <span className="f-label" style={{ color: 'var(--fg5)' }}>
          coorte com menos de {minN} vendas fica apagada — é ruído, não taxa
        </span>
      </div>

      {state.status === 'error' && (
        <div className="panel" style={{ color: 'var(--danger)' }}>Erro ao carregar: {state.error}</div>
      )}

      {/* Curva de maturação agregada */}
      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-head">
          <div className="panel-title">
            <span className="panel-eyebrow">Curva de maturação</span>
            <div className="panel-sub">
              % agregado estornado até o dia N — só coortes que JÁ TÊM N dias entram no ponto N (sem viés de coorte imatura)
            </div>
          </div>
        </div>
        {state.status === 'ready' && curve.length > 0 ? (
          <MaturationCurve curve={curve} metric={metric} height={170} midline={MID} maxY={Math.max(curveMax * 1.15, MID * 1.4)}/>
        ) : (
          <div style={{ padding: 24, textAlign: 'center', opacity: 0.6 }}>
            {state.status === 'loading' ? 'carregando…' : 'Sem dados no período'}
          </div>
        )}
      </div>

      {/* Matriz de coorte */}
      <div className="panel" style={{ padding: 0 }}>
        <div className="panel-head" style={{ padding: '14px 16px 8px' }}>
          <div className="panel-title">
            <span className="panel-eyebrow">Matriz de coorte</span>
            <div className="panel-sub">
              linha = dia da venda · coluna = dias desde a venda · célula = % acumulado {metric === 'usd' ? 'do VALOR vendido' : 'dos PEDIDOS'} estornado
            </div>
          </div>
        </div>
        <Paginated items={cohorts} label="coortes">
          {(pageRows, pager) => (<>
            <div className="tbl-wrap" style={{ margin: 0, padding: '0 4px 8px', maxHeight: 640, overflow: 'auto' }}>
              <table className="tbl" style={{ borderCollapse: 'separate', borderSpacing: 2 }}>
                <thead>
                  <tr>
                    <th style={{ position: 'sticky', left: 0, top: 0, zIndex: 4, background: 'var(--bg-raised)', minWidth: 118 }}>Venda</th>
                    <th className="num" style={{ position: 'sticky', top: 0, zIndex: 3, background: 'var(--bg-raised)', minWidth: 46 }}>Base</th>
                    {cols.map((c) => (
                      <th key={c} className="num" style={{ position: 'sticky', top: 0, zIndex: 3, background: 'var(--bg-raised)', minWidth: 40 }}>+{c}d</th>
                    ))}
                    <th className="num" style={{ position: 'sticky', top: 0, right: 0, zIndex: 4, background: 'var(--bg-raised)', minWidth: 56 }}
                      title={`Onde a coorte deve ESTABILIZAR ao completar ${horizon} dias — padrão das coortes maduras + ajuste Bornhuetter-Ferguson, calculado sobre o histórico do próprio recorte. Coorte madura mostra o valor observado.`}>
                      final D{horizon}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {state.status === 'loading' && <SkelTableRows rows={10} cols={cols.length + 3}/>}
                  {state.status === 'ready' && cohorts.length === 0 && (
                    <tr><td colSpan={cols.length + 3} style={{ textAlign: 'center', padding: 24, opacity: 0.6 }}>Sem vendas no período</td></tr>
                  )}
                  {state.status === 'ready' && pageRows.map((row) => {
                    const lowN = row.baseCount < minN;
                    return (
                      <tr key={row.day}>
                        <td className="cell-mono" style={{ position: 'sticky', left: 0, zIndex: 1, background: 'var(--bg-raised)', whiteSpace: 'nowrap' }}
                            title={lowN ? `amostra baixa: ${row.baseCount} vendas (< ${minN})` : undefined}>
                          {fmtDateShort(row.day)}
                          {lowN && <span style={{ color: 'var(--warning)', marginLeft: 4 }} title={`amostra baixa (< ${minN})`}>·</span>}
                        </td>
                        <td className="num cell-mono" style={{ color: lowN ? 'var(--fg5)' : 'var(--fg3)' }}>
                          {fmtInt(row.baseCount)}
                        </td>
                        {cols.map((c) => {
                          const cell = row.cells[c];
                          if (!cell) return <td key={c} className="num"/>;  // censurado
                          const p = pctOf(cell);
                          return (
                            <td key={c} className="num cell-mono"
                              title={`vendas de ${fmtDateShort(row.day)} · até ${c} dia${c === 1 ? '' : 's'}\n`
                                + `${fmtInt(cell.cumCount)} de ${fmtInt(row.baseCount)} pedidos (${(cell.pctCount * 100).toFixed(2)}%)\n`
                                + `${fmtCurrency(cell.cumUsd, cur, 0)} de ${fmtCurrency(row.baseUsd, cur, 0)} (${(cell.pctUsd * 100).toFixed(2)}%)`}
                              style={{
                                background: lowN ? 'color-mix(in oklab, var(--fg5) 10%, transparent)' : cellBg(p),
                                color: lowN ? 'var(--fg5)' : 'var(--fg1)',
                                borderRadius: 4,
                                fontSize: 10.5,
                                padding: '4px 5px',
                              }}>
                              {(p * 100).toFixed(1)}
                            </td>
                          );
                        })}
                        {(() => {
                          const proj = row.projection;
                          const v = proj ? (metric === 'usd' ? proj.pctUsd : proj.pctCount) : null;
                          const dev = proj ? (metric === 'usd' ? proj.developedUsd : proj.developedCount) : null;
                          const isMature = row.ageDays >= horizon;
                          const piso = d?.projection?.tailIncomplete && !isMature;
                          const stickyRight = { position: 'sticky', right: 0, zIndex: 1 };
                          if (v == null) {
                            return <td className="num cell-mono" style={{ ...stickyRight, background: 'var(--bg-raised)', color: 'var(--fg5)' }}>—</td>;
                          }
                          // Mix com a SUPERFÍCIE (não transparent): célula sticky
                          // precisa de fundo opaco pro conteúdo não vazar por baixo.
                          const solidBg = lowN
                            ? 'color-mix(in oklab, var(--fg5) 10%, var(--bg-raised))'
                            : v <= 0.06
                              ? `color-mix(in oklab, var(--success) ${Math.round((1 - v / 0.06) * 55)}%, var(--bg-raised))`
                              : `color-mix(in oklab, var(--danger) ${Math.round(Math.min(1, (v - 0.06) / 0.06) * 65)}%, var(--bg-raised))`;
                          return (
                            <td className="num cell-mono"
                              title={isMature
                                ? `coorte completa: ${(v * 100).toFixed(2)}% observado até D${horizon}`
                                : `projeção: já viu ${dev != null ? Math.round(dev * 100) : '?'}% do caminho (D${Math.min(row.ageDays, horizon)} de D${horizon}).\npadrão das coortes maduras + ajuste Bornhuetter-Ferguson, sobre o histórico deste recorte.${piso ? '\nPISO: falta histórico pro fim da curva — o real tende a ser maior.' : ''}`}
                              style={{
                                ...stickyRight,
                                background: solidBg,
                                color: lowN ? 'var(--fg5)' : 'var(--fg1)',
                                borderRadius: 4,
                                fontSize: 10.5,
                                padding: '4px 5px',
                                borderLeft: '2px solid var(--border-soft)',
                                fontWeight: 600,
                              }}>
                              {isMature ? '' : '~'}{(v * 100).toFixed(1)}{piso ? '+' : ''}
                            </td>
                          );
                        })()}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {state.status === 'ready' && pager}
          </>)}
        </Paginated>
        <div style={{ padding: '6px 16px 12px', fontSize: 10.5, color: 'var(--fg5)', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: 'color-mix(in oklab, var(--success) 45%, transparent)', verticalAlign: '-1px' }}/> abaixo da meta (6%)</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: 'color-mix(in oklab, var(--danger) 55%, transparent)', verticalAlign: '-1px' }}/> acima da meta</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: 'color-mix(in oklab, var(--fg5) 10%, transparent)', verticalAlign: '-1px' }}/> amostra &lt; {minN}</span>
          <span>célula vazia = coorte ainda não chegou naquele dia</span>
          <span><em>~N</em> na última coluna = projeção de maturidade (ritmo das coortes maduras + BF, do próprio recorte); sem ~ = observado · <em>+</em> = piso</span>
          {d && d.totals.orphanEventCount > 0 && (
            <span style={{ color: 'var(--warning)' }}>
              {fmtInt(d.totals.orphanEventCount)} estorno{d.totals.orphanEventCount === 1 ? '' : 's'} de dias sem venda elegível — fora da matriz
            </span>
          )}
        </div>
      </div>
      </>}
    </div>
  );
}

// Sub-visão "Como ler": manual didático da aba de coortes — pedido do
// usuário 2026-08-18. Zero fetch: conteúdo estático, exemplos numéricos
// fixos (não dependem do período filtrado) e a mini-matriz reusa o mesmo
// visual das células reais pra treinar o olho.
function RefundCohortsHelp({ horizon }) {
  const P = ({ children }) => (
    <p style={{ margin: '0 0 10px', fontSize: 13, lineHeight: 1.65, color: 'var(--fg2, var(--fg1))' }}>{children}</p>
  );
  const H = ({ children }) => <strong style={{ color: 'var(--fg1)' }}>{children}</strong>;
  const Mono = ({ children }) => (
    <span className="cell-mono" style={{ fontSize: 12, color: 'var(--fg1)' }}>{children}</span>
  );
  // Célula de exemplo com o MESMO visual da matriz real.
  const Cell = ({ v, tone, dim, italic }) => (
    <td className="num cell-mono" style={{
      background: dim ? 'color-mix(in oklab, var(--fg5) 10%, transparent)'
        : tone === 'ok' ? 'color-mix(in oklab, var(--success) 35%, transparent)'
        : tone === 'bad' ? 'color-mix(in oklab, var(--danger) 45%, transparent)'
        : 'transparent',
      color: dim ? 'var(--fg5)' : 'var(--fg1)',
      borderRadius: 4, fontSize: 10.5, padding: '4px 7px',
    }}>{v}</td>
  );

  const Panel = ({ eyebrow, sub, children }) => (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="panel-head">
        <div className="panel-title">
          <span className="panel-eyebrow">{eyebrow}</span>
          {sub && <div className="panel-sub">{sub}</div>}
        </div>
      </div>
      <div style={{ padding: '0 4px' }}>{children}</div>
    </div>
  );

  return (
    <div>
      <Panel eyebrow="Por que esta aba existe" sub="o problema que a taxa comum de reembolso não consegue resolver">
        <P>
          A taxa "normal" divide os estornos do mês pelas vendas do <em>mesmo</em> mês. Só que reembolso
          quase nunca é da venda de hoje — ele chega dias ou semanas depois. Quando o volume de venda muda
          rápido, essa conta quebra:
        </P>
        <P>
          <H>Exemplo:</H> em julho você vendeu <Mono>1.000</Mono> pedidos. Em agosto pausou o tráfego e
          vendeu <Mono>100</Mono>. Aí chegam <Mono>40</Mono> estornos em agosto — quase todos de vendas de
          julho. A taxa comum de agosto mostra <Mono>40 ÷ 100 = 40%</Mono> e parece catástrofe. Mas a
          qualidade não piorou <em>nada</em>: o denominador é que encolheu.
        </P>
        <P>
          Aqui cada estorno é <H>preso ao dia da VENDA original</H>. Os 40 estornos contam contra as 1.000
          vendas de julho (<Mono>4%</Mono>), e agosto é julgado só pelo que agosto vendeu. "Coorte" é isso:
          a <em>safra</em> de vendas de um dia, acompanhada pelo resto da vida dela.
        </P>
      </Panel>

      <Panel eyebrow="Como ler a matriz" sub="linha = dia da venda · coluna = dias depois da venda · célula = % acumulado">
        <div className="tbl-wrap" style={{ margin: '0 0 10px', overflowX: 'auto' }}>
          <table className="tbl" style={{ borderCollapse: 'separate', borderSpacing: 2, maxWidth: 560 }}>
            <thead>
              <tr>
                <th style={{ minWidth: 96 }}>Venda</th>
                <th className="num">Base</th>
                <th className="num">+0d</th><th className="num">+7d</th>
                <th className="num">+15d</th><th className="num">+30d</th>
                <th className="num">final D30</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="cell-mono">10 de jul</td>
                <td className="num cell-mono">200</td>
                <Cell v="1.0" tone="ok"/><Cell v="4.5" tone="ok"/><Cell v="6.5" tone="bad"/><Cell v="8.0" tone="bad"/>
                <Cell v="8.0" tone="bad"/>
              </tr>
              <tr>
                <td className="cell-mono">05 de ago</td>
                <td className="num cell-mono">180</td>
                <Cell v="0.6" tone="ok"/><Cell v="2.8" tone="ok"/><td className="num"/><td className="num"/>
                <Cell v="~6.9" tone="bad" italic/>
              </tr>
              <tr>
                <td className="cell-mono">17 de ago <span style={{ color: 'var(--warning)' }}>·</span></td>
                <td className="num cell-mono" style={{ color: 'var(--fg5)' }}>7</td>
                <Cell v="14.3" dim/><td className="num"/><td className="num"/><td className="num"/>
                <Cell v="~9.1" dim italic/>
              </tr>
            </tbody>
          </table>
        </div>
        <P>
          <H>Linha 1 (10 de jul):</H> das 200 vendas do dia, <Mono>1.0%</Mono> estornou no próprio dia,
          <Mono> 4.5%</Mono> até uma semana, <Mono>8.0%</Mono> até 30 dias. A célula é sempre
          <H> acumulada</H> — nunca diminui da esquerda pra direita. Como a coorte já viveu os 30 dias,
          a última coluna é o número <em>final observado</em> (sem <Mono>~</Mono>).
        </P>
        <P>
          <H>Linha 2 (05 de ago):</H> as células vazias são <H>censura</H> — a coorte tem só 13 dias de
          vida, então "+15d" e "+30d" ainda <em>não aconteceram</em>. Vazio ≠ 0%: é "cedo demais pra saber".
          O <Mono>~6.9</Mono> é a <H>projeção</H> de onde ela deve parar.
        </P>
        <P>
          <H>Linha 3 (17 de ago):</H> cinza = <H>amostra baixa</H>. 7 vendas com 1 estorno mostra
          <Mono> 14.3%</Mono>, mas isso é ruído, não taxa — o ponto <span style={{ color: 'var(--warning)' }}>·</span> ao
          lado da data avisa. Só leve a sério coorte acima do corte de amostra mínima que você escolheu.
        </P>
        <P>
          A cor segue a <H>meta de 6%</H>: verde abaixo, vermelho acima — a mesma régua do resto do dashboard.
        </P>
      </Panel>

      <Panel eyebrow="A curva de maturação" sub="quanto do estorno total aparece até o dia N — a régua justa entre meses">
        <P>
          A curva agrega as coortes por <H>idade</H>: no ponto "+10d" só entram coortes que já viveram 10
          dias. Isso remove o viés das coortes novas (que puxariam a média pra baixo só por serem novas).
        </P>
        <P>
          <H>Como usar:</H> compare o mês atual com o anterior <em>nas mesmas idades</em>. Se a curva de
          agosto está acima da de julho no "+7d" e no "+14d", a qualidade piorou de verdade — não é efeito
          de volume nem de coorte imatura. Os chips <H>D7 / D14 / D30</H> no topo são exatamente esses
          pontos da curva.
        </P>
      </Panel>

      <Panel eyebrow="A projeção (~)" sub="onde a coorte nova deve ESTABILIZAR quando amadurecer">
        <P>
          As coortes antigas ensinam o <H>ritmo</H> do estorno. Exemplo: historicamente, até o dia 5
          aparece <Mono>40%</Mono> de tudo que vai estornar até o dia 30. Se a coorte de 5 dias está com
          <Mono> 3%</Mono>, a projeção é <Mono>3% ÷ 40% ≈ 7.5%</Mono> — uma regra de três com o ritmo real
          do seu histórico (o mesmo princípio que seguradoras usam pra prever sinistros que ainda vão chegar).
        </P>
        <P>
          Um ajuste extra (<em>Bornhuetter-Ferguson</em>) evita um erro bobo: coorte de ontem com 0 estornos
          projetaria 0% — otimismo, não dado. O ajuste puxa coortes muito novas pra perto da média do
          período até elas terem informação própria.
        </P>
        <P>
          <H>Como ler:</H> <Mono>~8.2</Mono> = estimativa. Sem <Mono>~</Mono> = coorte completa,
          valor observado. <H>"Piso"</H> no chip de projeção = falta histórico pra ver o fim da curva
          (ex.: horizonte de 90d com só 40 dias de dados) — o número real tende a ser um pouco <em>maior</em>.
        </P>
      </Panel>

      <Panel eyebrow="Três decisões que esta aba resolve" sub="exemplos práticos">
        <P>
          <H>1. Pegar coorte ruim cedo.</H> A coorte de terça está projetando <Mono>~12%</Mono> com 4 dias
          de vida? Não espere 30 dias pra confirmar: abra Transações naquele dia, veja qual afiliado/campanha
          dominou as vendas e aja agora.
        </P>
        <P>
          <H>2. Julgar um mês sem viés.</H> "Agosto está com refund alto" — está mesmo? Olhe a curva nas
          mesmas idades. Se bate com julho, o "alto" é só estorno de venda antiga caindo agora.
        </P>
        <P>
          <H>3. Calibrar o modelo CPA.</H> O D30 maduro por família (use o filtro global) é o número certo
          pro <em>refund&cb%</em> da aba Plataformas — que alimenta o NET AFTER CPA dos afiliados.
        </P>
      </Panel>

      <Panel eyebrow="Glossário" sub="todos os termos da aba, sem economês">
        <div className="tbl-wrap" style={{ margin: 0, overflowX: 'auto' }}>
          <table className="tbl" style={{ maxWidth: 860 }}>
            <tbody>
              {[
                ['Coorte', 'a "safra" de vendas de um dia, acompanhada dali em diante. Cada linha da matriz é uma coorte.'],
                ['Base', 'quantas vendas reais a coorte tem. Na Digistore a linha de estorno é um registro extra — ela NÃO conta como venda.'],
                ['+Nd (lag)', 'dias entre a venda e o estorno. Estorno no mesmo dia = +0d.'],
                ['Acumulado', 'a célula soma tudo ATÉ aquele dia — por isso nunca diminui da esquerda pra direita.'],
                ['Censura', 'célula em branco: a coorte ainda não viveu aquele dia. Diferente de 0%.'],
                ['Coorte madura', 'já completou o horizonte — o número dela é final, não estimativa.'],
                ['Horizonte', `a última coluna da matriz (você escolhe: 14/30/60/90 dias; agora está em ${horizon}d). Estornos depois disso aparecem no rodapé como "além do horizonte".`],
                ['D7 / D14 / D30', 'a taxa agregada madura naquela idade — pontos da curva de maturação.'],
                ['Amostra mínima', 'coorte com menos vendas que o corte fica cinza: 1 estorno em 5 vendas é 20% de ruído, não de taxa.'],
                ['Meta 6%', 'a régua de cor das células (verde abaixo, vermelho acima) — mesma referência de reembolso do resto do dash.'],
                ['Pedidos × Valor $', 'duas lentes: contagem de pedidos estornados vs dinheiro devolvido. Divergem quando há refund parcial ou quando tickets altos estornam mais.'],
                ['Projeção (~)', 'estimativa de onde a coorte imatura estabiliza, calculada com o ritmo das suas coortes já maduras + ajuste Bornhuetter-Ferguson pra coorte muito nova.'],
                ['Piso', 'projeção com histórico incompleto — o valor real tende a ser maior, nunca menor.'],
                ['Inclui chargebacks', 'a matriz soma reembolso + chargeback: é tudo dinheiro que voltou, a mesma régua do modelo CPA.'],
                ['Estornos órfãos', 'estornos de vendas anteriores ao dashboard (dia de venda desconhecido) — ficam fora da matriz e são avisados no rodapé.'],
              ].map(([t, d2]) => (
                <tr key={t}>
                  <td style={{ whiteSpace: 'nowrap', fontWeight: 600, color: 'var(--fg1)', verticalAlign: 'top' }}>{t}</td>
                  <td style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--fg3)' }}>{d2}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

// Curva de maturação: SVG único, uma série (sem legenda — o título nomeia),
// linha na cor de acento, grade recessiva, referência tracejada na meta e
// rótulo direto no último ponto maduro.
function MaturationCurve({ curve, metric, height, midline, maxY }) {
  const W = 720, H = height, PAD_L = 44, PAD_R = 16, PAD_T = 10, PAD_B = 22;
  const pts = curve
    .map((pt) => ({ age: pt.age, v: metric === 'usd' ? pt.pctUsd : pt.pctCount }))
    .filter((pt) => pt.v != null);
  if (pts.length === 0) {
    return <div style={{ padding: 24, textAlign: 'center', opacity: 0.6 }}>Nenhuma coorte madura no período</div>;
  }
  const maxAge = Math.max(1, curve.length - 1);
  const x = (age) => PAD_L + (age / maxAge) * (W - PAD_L - PAD_R);
  const y = (v) => PAD_T + (1 - v / maxY) * (H - PAD_T - PAD_B);
  const path = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${x(pt.age).toFixed(1)},${y(pt.v).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  const yTicks = [0, midline, maxY].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: 420, height: 'auto', display: 'block' }} role="img"
        aria-label="Curva de maturação de reembolso">
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)}
              stroke={v === midline ? 'var(--warning)' : 'var(--border-soft)'}
              strokeDasharray={v === midline ? '4 4' : undefined} strokeWidth={1} opacity={v === midline ? 0.7 : 0.6}/>
            <text x={PAD_L - 6} y={y(v) + 3} textAnchor="end" fontSize={9}
              fill="var(--fg5)" fontFamily="var(--f-mono)">{(v * 100).toFixed(1)}%</text>
          </g>
        ))}
        {[0, Math.round(maxAge / 2), maxAge].map((a) => (
          <text key={a} x={x(a)} y={H - 6} textAnchor="middle" fontSize={9}
            fill="var(--fg5)" fontFamily="var(--f-mono)">+{a}d</text>
        ))}
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round"/>
        {pts.map((pt) => (
          <circle key={pt.age} cx={x(pt.age)} cy={y(pt.v)} r={pt.age === last.age ? 3.5 : 2.2}
            fill="var(--accent)">
            <title>{`+${pt.age}d: ${(pt.v * 100).toFixed(2)}%`}</title>
          </circle>
        ))}
        <text x={Math.min(x(last.age), W - PAD_R - 4)} y={Math.max(y(last.v) - 8, 10)} textAnchor="end"
          fontSize={10} fontWeight={700} fill="var(--fg1)" fontFamily="var(--f-mono)">
          {(last.v * 100).toFixed(2)}%
        </text>
      </svg>
    </div>
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
      Array.from(filters.families).join(','), Array.from(filters.affiliates || []).join(',')]);

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
  // Afiliado de recuperação (comissão %, não CPA) fica fora — a faixa abaixo
  // já o excluiria hoje, mas a intenção fica explícita se ela mudar.
  const VALID_CPA_MIN = 200;
  const VALID_CPA_MAX = 290;
  const affsWithValidCpa = all.filter((r) => {
    if (r.isRecovery) return false;
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
      fontWeight: 500,
    };
    if (tier === 'good') return { ...base, background: 'var(--success-bg)', color: 'var(--success)', border: '1px solid color-mix(in srgb, var(--success) 35%, transparent)' };
    if (tier === 'mid') return { ...base, background: 'var(--warning-bg)', color: 'var(--warning)', border: '1px solid color-mix(in srgb, var(--warning) 35%, transparent)' };
    if (tier === 'bad') return { ...base, background: 'var(--danger-bg)', color: 'var(--danger)', border: '1px solid color-mix(in srgb, var(--danger) 35%, transparent)' };
    return { ...base, background: 'var(--bg-subtle)', color: 'var(--fg5)', border: '1px solid var(--border-soft)' };
  }

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">Afiliados · diretório</span>
          <h2>Todos os <em>afiliados</em></h2>
          <span className="sub">{rows.length} no total · pesquisável · exporta o que está filtrado</span>
        </div>
        <div className="page-head-actions" style={{ flexWrap: 'wrap' }}>
          <div className="select-btn" style={{ padding: '0 10px', width: 'min(260px, 100%)' }}>
            <Icon name="search" size={13}/>
            <input value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nickname ou ID..."
              style={{ background: 'transparent', border: 0, color: 'var(--fg1)', outline: 'none', flex: 1, fontFamily: 'var(--f-body)', fontSize: 12 }}
            />
          </div>
          <button className="btn btn-ghost" onClick={() => downloadCsv(
            `afiliados_${isoDateOnly(filters.dateRange.start)}_${isoDateOnly(filters.dateRange.end)}.csv`,
            ['Afiliado', 'Afiliado ID', 'Plataforma', 'CPA por venda USD', 'Receita período USD',
             'Pedidos período', 'AOV global USD', 'Reembolso %', '1ª venda', 'Última venda'],
            rows.map((r) => [
              r.nickname || r.externalId, r.externalId, r.platformSlug,
              (r.cpaPerFe || 0) > 0 ? r.cpaPerFe : null, r.revenue, r.orders,
              aovOf(r) > 0 ? aovOf(r) : null,
              r.realOrders ? r.refundRate * 100 : null,
              r.firstSeenAt ? fmtDateShort(r.firstSeenAt) : null,
              r.lastOrderAt ? fmtDateShort(r.lastOrderAt) : null,
            ]),
          )}><Icon name="download" size={12}/> Exportar CSV</button>
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
        <Paginated items={rows} label="afiliados" resetKey={query}>
          {(pageRows, pager) => (<>
            <div className="tbl-wrap" style={{ margin: 0, padding: '0 4px', maxHeight: 720, overflowY: 'auto' }}>
              <table className="tbl tbl--sticky-first">
                <thead>
                  <tr>
                    <th>Afiliado</th><th>Plataforma</th>
                    <th className="num" title="CPA fixo negociado — ÚLTIMO valor pago por venda FE aprovada no período (fonte: lista de transações; renegociação atualiza na primeira venda com o valor novo)">CPA por venda</th>
                    <th className="num">Receita · período</th><th className="num">Pedidos · período</th>
                    <th className="num">AOV · período</th>
                    <th className="num">Reembolso</th>
                    <th>1ª venda</th><th>Última venda</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {state.status === 'loading' && <SkelTableRows rows={10} cols={10}/>}
                  {state.status === 'ready' && rows.length === 0 && (
                    <tr><td colSpan={10} style={{ textAlign: 'center', padding: 24, opacity: 0.6 }}>
                      {query ? 'Nenhum afiliado encontrado' : 'Nenhum afiliado ainda'}
                    </td></tr>
                  )}
                  {pageRows.map((r) => {
                    const displayName = r.nickname || r.externalId;
                    const { cls: platClass, short: platShort } = platBadge(r.platformSlug);
                    const aov = aovOf(r);
                    const tier = aovTier(aov);
                    return (
                      <tr tabIndex={0} key={`${r.platformSlug}:${r.externalId}`} onClick={() => onOpenAffiliate(r.externalId)}>
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
                        <td className="num cell-mono"
                          title={r.realOrders ? `${fmtInt(r.refunds)} estornos ÷ ${fmtInt(r.realOrders)} pedidos reais` : undefined}>
                          {r.realOrders ? (r.refundRate * 100).toFixed(1) + '%' : '—'}
                        </td>
                        <td className="cell-mono">{r.firstSeenAt ? fmtDateShort(r.firstSeenAt) : '—'}</td>
                        <td className="cell-mono">{r.lastOrderAt ? fmtDateShort(r.lastOrderAt) : '—'}</td>
                        <td><Icon name="chevron-right" size={13}/></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {pager}
          </>)}
        </Paginated>
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
  const callCenter = useCallCenter();
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
      callCenter={callCenter}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Monitor de call center — contador de vendas/dia dos produtos AINDA SEM
// call center. Média 3d ≥30/dia → conectar Tauk; ≥100/dia → integrar
// SalesBound (cross-sell). Watchlist editável (admin). Produto integrado =
// remover da lista.
// ─────────────────────────────────────────────────────────────────────────────

function useCallCenter() {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let cancelled = false;
    window.NSApi.fetchCallCenter()
      .then((d) => { if (!cancelled) setState({ status: 'ready', data: d }); })
      .catch(() => { if (!cancelled) setState((s) => ({ status: 'error', data: s.data })); });
    return () => { cancelled = true; };
  }, [refresh]);
  return { ...state, reload: () => setRefresh((n) => n + 1) };
}

const CC_LEVEL_META = {
  salesbound: { label: 'Integrar SalesBound', chip: 'SalesBound ≥100/d', fg: 'var(--danger)', bg: 'color-mix(in oklab, var(--danger) 12%, transparent)', border: 'color-mix(in oklab, var(--danger) 35%, transparent)' },
  tauk:       { label: 'Conectar Tauk',       chip: 'Tauk ≥30/d',        fg: 'var(--warning)', bg: 'color-mix(in oklab, var(--warning) 12%, transparent)', border: 'color-mix(in oklab, var(--warning) 35%, transparent)' },
  ok:         { label: 'OK',                  chip: 'OK',                fg: 'var(--success)', bg: 'var(--success-bg)', border: 'color-mix(in srgb, var(--success) 35%, transparent)' },
};

function CallCenterMonitor({ cc }) {
  const [open, setOpen] = useState(false);
  const [plat, setPlat] = useState('buygoods');
  const [fam, setFam] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const d = cc.data;
  if (!d || !d.rows) return null;
  const alerts = d.alerts || [];

  function removeWatch(row) {
    if (busy) return;
    // Linha de wildcard compartilha o watch da plataforma INTEIRA — apagar
    // uma família apagaria o monitor todo; confirma antes.
    if (row.wildcard && !window.confirm(
      `Esta linha vem do monitor de TODA a plataforma ${row.platformSlug}. Remover apaga o monitoramento da plataforma inteira. Continuar?`,
    )) return;
    setBusy(true);
    setErr(null);
    window.NSApi.deleteCallCenterWatch(row.watchId)
      .then(() => cc.reload())
      .catch((e) => setErr(e.message || 'erro'))
      .finally(() => setBusy(false));
  }
  function addWatch() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    window.NSApi.addCallCenterWatch({ platformSlug: plat, family: fam.trim() || null })
      .then(() => { setFam(''); cc.reload(); })
      .catch((e) => setErr(e.message || 'erro'))
      .finally(() => setBusy(false));
  }

  const selStyle = {
    background: 'var(--bg)', color: 'var(--fg1)', border: '1px solid var(--border)',
    borderRadius: 8, padding: '5px 8px', fontSize: 11, fontFamily: 'var(--f-mono)',
  };

  return (
    <>
      {/* Alerta: produto cruzou limiar de call center */}
      {alerts.length > 0 && (
        <div className="panel" style={{ marginBottom: 14, padding: '12px 16px', background: 'var(--warning-bg)', border: '1px solid color-mix(in srgb, var(--warning) 40%, transparent)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Icon name="bell" size={14}/>
            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, fontWeight: 700, color: 'var(--warning)' }}>
              Call center · {alerts.length} {alerts.length === 1 ? 'produto cruzou' : 'produtos cruzaram'} o limiar
            </span>
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {alerts.map((r) => {
              const meta = CC_LEVEL_META[r.level];
              const pb = platBadge(r.platformSlug);
              return (
                <div key={`${r.watchId}:${r.family}`} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12.5 }}>
                  <span className={`plat ${pb.cls}`}>{pb.short}</span>
                  <span style={{ color: 'var(--fg1)', fontWeight: 600 }}>{r.family}</span>
                  <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--fg3)' }}>
                    {r.avg3d} vendas/dia (média 3d) · ontem {fmtInt(r.yesterday)} · hoje {fmtInt(r.today)}
                  </span>
                  <span style={{
                    fontFamily: 'var(--f-mono)', fontSize: 9.5, fontWeight: 700,
                    padding: '2px 10px', borderRadius: 'var(--r-full)',
                    background: meta.bg, color: meta.fg, border: `1px solid ${meta.border}`,
                  }}>
                    → {meta.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Painel colapsável com o contador de todos os vigiados */}
      <div className="panel" style={{ padding: 0, marginBottom: 14 }}>
        <div
          className="panel-head"
          style={{ padding: '12px 14px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          onClick={() => setOpen((v) => !v)}
        >
          <div className="panel-title">
            Monitor de call center
            <span style={{ color: 'var(--fg5)', fontSize: 10, marginLeft: 6 }}>
              vendas/dia dos produtos sem call center · Tauk ≥{d.thresholds.tauk}/d · SalesBound ≥{d.thresholds.salesbound}/d
            </span>
          </div>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14}/>
        </div>
        {open && (
          <>
            <Paginated items={d.rows} label="produtos">
              {(pageRows, pager) => (<>
                <div className="tbl-wrap" style={{ margin: 0, padding: '0 4px' }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Produto</th><th>Plataforma</th>
                        <th className="num">Hoje</th><th className="num">Ontem</th>
                        <th className="num" title="Média dos últimos 3 dias BRT completos — é o que dispara o alerta">Média 3d</th>
                        <th className="num">Média 7d</th><th className="num">Pico 7d</th>
                        <th>Status</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.rows.length === 0 && (
                        <tr><td colSpan={9} style={{ textAlign: 'center', padding: 16, opacity: 0.6 }}>Nenhum produto monitorado.</td></tr>
                      )}
                      {pageRows.map((r) => {
                        const meta = CC_LEVEL_META[r.level];
                        const pb = platBadge(r.platformSlug);
                        return (
                          <tr key={`${r.watchId}:${r.family}`} style={r.level !== 'ok' ? { background: `${meta.bg.replace('0.14', '0.05')}` } : undefined}>
                            <td>
                              {r.family}
                              {r.dormant && <span style={{ fontFamily: 'var(--f-mono)', fontSize: 8.5, color: 'var(--fg5)', marginLeft: 6 }}>Sem vendas na janela</span>}
                            </td>
                            <td><span className={`plat ${pb.cls}`}>{pb.short}</span></td>
                            <td className="num">{fmtInt(r.today)}</td>
                            <td className="num">{fmtInt(r.yesterday)}</td>
                            <td className="num" style={{ fontWeight: 700, color: r.level !== 'ok' ? meta.fg : undefined }}>{r.avg3d}</td>
                            <td className="num">{r.avg7d}</td>
                            <td className="num">{fmtInt(r.peak7d)}</td>
                            <td>
                              <span style={{
                                fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 600,
                                padding: '2px 8px', borderRadius: 'var(--r-full)', whiteSpace: 'nowrap',
                                background: meta.bg, color: meta.fg, border: `1px solid ${meta.border}`,
                              }}>
                                {meta.chip}
                              </span>
                            </td>
                            <td>
                              <button
                                className="btn btn-ghost"
                                style={{ padding: '2px 8px', fontSize: 10 }}
                                title={`Remover monitoramento${r.wildcard ? ' (remove o monitor da plataforma INTEIRA)' : ''} — use quando o produto for integrado`}
                                onClick={() => removeWatch(r)}
                                disabled={busy}
                              >×</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {pager}
              </>)}
            </Paginated>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '10px 14px' }}>
              <select value={plat} onChange={(e) => setPlat(e.target.value)} style={selStyle}>
                <option value="buygoods">BuyGoods</option>
                <option value="cartpanda">Cartpanda</option>
                <option value="clickbank">ClickBank</option>
                <option value="digistore24">Digistore24</option>
                <option value="jvzoo">JVZoo</option>
              </select>
              <input
                value={fam}
                onChange={(e) => setFam(e.target.value)}
                placeholder="Família (vazio = TODAS da plataforma)"
                style={{ ...selStyle, width: 'min(260px, 100%)' }}
              />
              <button className="btn btn-ghost" onClick={addWatch} disabled={busy}>
                <Icon name="plus" size={12}/> Monitorar
              </button>
              {err && <span style={{ color: 'var(--danger)', fontSize: 11 }}>{err}</span>}
              <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9.5, color: 'var(--fg5)', marginLeft: 'auto' }}>
                integrou o call center? remove da lista · match tolera espaços/maiúsculas
              </span>
            </div>
          </>
        )}
      </div>
    </>
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
      Array.from(filters.families).join(','), Array.from(filters.affiliates || []).join(',')]);
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
      Array.from(filters.families).join(','), Array.from(filters.affiliates || []).join(',')]);
  return state;
}

const FAMILY_ACCENT = {
  NeuroMindPro: 'var(--chart-1)',
  GlycoPulse: 'var(--chart-2)',
  ThermoBurnPro: 'var(--chart-3)',
  // não --chart-4: a cor da família também vira TEXTO (badge, eyebrow, Pill) e
  // #4260E6 dá 3,4:1 no card escuro. --chart-5 passa como texto nos dois temas.
  MaxVitalize: 'var(--chart-5)',
};
function familyAccent(family) {
  return FAMILY_ACCENT[family] || 'var(--fg4)';
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
    return { bg: 'var(--ns-white)', fg: 'var(--ns-black)', border: 'var(--border-strong)' };
  }
  if (s === 'black2' || s === 'black02' || s === 'blacktwo' || s === 'blackii') {
    return { bg: 'var(--ns-black)', fg: 'var(--warning-base)', border: 'color-mix(in srgb, var(--warning-base) 65%, transparent)' };
  }
  if (s === 'black' || s === 'black1' || s === 'black01') {
    return { bg: 'var(--ns-black)', fg: 'var(--ns-white)', border: 'var(--border-strong)' };
  }
  if (s === 'gray' || s === 'grey') {
    return { bg: 'color-mix(in srgb, var(--fg5) 18%, transparent)', fg: 'var(--fg3)', border: 'color-mix(in srgb, var(--fg5) 45%, transparent)' };
  }
  return { bg: 'color-mix(in oklab, var(--accent) 10%, transparent)', fg: 'var(--glow-cyan)', border: 'color-mix(in oklab, var(--accent) 45%, transparent)' };
}

// Rótulo amigável: "black2"→"Black 2", "white"→"White", senão o que veio com inicial maiúscula.
function pageStateLabel(state) {
  const s = normState(state);
  if (s === 'black2' || s === 'black02' || s === 'blacktwo' || s === 'blackii') return 'Black 2';
  if (s === 'black' || s === 'black1' || s === 'black01') return 'Black';
  if (s === 'white' || s === 'white1' || s === 'white01') return 'White';
  const raw = String(state || '');
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function PageStateBadge({ state, platform, size = 'sm' }) {
  const st = pageStateStyle(state);
  const plat = platform ? platBadge(platform) : null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontFamily: 'var(--f-mono)', fontSize: size === 'sm' ? 9.5 : 11, fontWeight: 600,
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
    '  var PLATFORM = "EDITE_AQUI"; // clickbank | digistore24 | buygoods | cartpanda | jvzoo',
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
        whiteSpace: 'nowrap',
        padding: block ? '7px 12px' : '3px 9px',
        borderRadius: 'var(--r-full)',
        background: copied ? 'var(--success-bg)' : `color-mix(in srgb, ${col} 10%, transparent)`,
        color: col, border: `1px solid color-mix(in srgb, ${col} 33%, transparent)`,
      }}
    >
      {copied ? '✓ Copiado' : '⧉ ' + label}
    </span>
  );
}

function FamilyGrid({ state, cur, onPick, pageStates, callCenter }) {
  const families = state.data?.families || [];
  const allStates = pageStates || [];
  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">Catálogo · Produtos</span>
          <h2>Performance <em>por família</em></h2>
          <span className="sub">{families.length} famílias no catálogo · clica em uma pra ver as variantes</span>
        </div>
      </div>

      {callCenter && <CallCenterMonitor cc={callCenter}/>}

      {allStates.length > 0 && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-head" style={{ marginBottom: 10 }}>
            <div className="panel-title">
              <span className="panel-eyebrow">Estado das páginas · Funil (Upsell 01)</span>
              <div className="panel-sub">Variante visualizada na página de upsell, por plataforma — White / Black / Black 2</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {allStates.map((s) => (
              <div key={`${s.platform}:${s.product}`} style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '6px 10px', borderRadius: 8,
                background: 'var(--bg-raised)', border: '1px solid var(--border-soft)',
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

      <Paginated items={families} label="famílias">
        {(pageRows, pager) => (<>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
            {pageRows.map((f) => {
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
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: accent }}/>
                      <div style={{ fontFamily: 'var(--f-display)', fontSize: 18, color: 'var(--fg1)' }}>{f.family}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {f.niches.map((n) => (
                        <span key={n} className="badge" style={{ background: `color-mix(in srgb, ${accent} 13%, transparent)`, color: accent, borderColor: `color-mix(in srgb, ${accent} 33%, transparent)`, fontSize: 10 }}>{n}</span>
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
                      <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: liftPct > 0 ? 'var(--success)' : 'var(--fg5)' }}>
                        lift +{(liftPct * 100).toFixed(0)}%
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
                    <div className="prod-stat"><div className="l">FE orders</div><div className="v sm">{fmtInt(f.feOrders)}</div></div>
                    <div className="prod-stat"><div className="l">Total orders</div><div className="v sm">{fmtInt(f.totalOrders)}</div></div>
                    <div className="prod-stat"><div className="l">AOV</div><div className="v sm">{hasOrders ? fmtCurrency(f.aov, cur, 0) : '—'}</div></div>
                  </div>

                  <div style={{ paddingTop: 10, borderTop: '1px solid var(--border-soft)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: 'var(--fg4)', fontFamily: 'var(--f-mono)' }}>
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
          {pager}
        </>)}
      </Paginated>
    </div>
  );
}

const TYPE_COL_META = {
  FRONTEND: { label: 'Frontend', accent: 'var(--accent)' },
  UPSELL: { label: 'Upsell', accent: 'var(--gold)' },
  DOWNSELL: { label: 'Downsell', accent: 'var(--chart-2)' },
  SMS_RECOVERY: { label: 'SMS Recovery', accent: 'var(--chart-5)' },
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
          <span className="eyebrow" style={{ color: accent }}>Família · {family}</span>
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
            <span className="panel-eyebrow">Beacon de estado · Upsell 01</span>
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
            background: 'var(--bg-subtle)', border: '1px solid var(--border-soft)',
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
                <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: meta.accent, marginBottom: 12 }}>
                  {meta.label} · {variants.length}
                </div>
                {variants.length === 0 && (
                  <div style={{ fontSize: 11, color: 'var(--fg5)' }}>
                    Sem variantes deste tipo no catálogo
                  </div>
                )}
                <Paginated items={variants} label="variantes">
                  {(pageRows, pager) => (<>
                    <div style={{ display: 'grid', gap: 8 }}>
                      {pageRows.map((v) => (
                        <VariantRow
                          key={`${v.platformSlug}:${v.externalId}`}
                          variant={v}
                          cur={cur}
                          accent={meta.accent}
                          onClick={() => onPickVariant(v.externalId)}
                        />
                      ))}
                    </div>
                    {pager}
                  </>)}
                </Paginated>
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
        background: 'var(--bg-raised)', border: '1px solid var(--border-soft)',
        borderRadius: 6, padding: 10,
        display: 'grid', gap: 4,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in oklab, var(--accent) 6%, transparent)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-raised)'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--fg1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {v.name}
        </span>
        <span className={`plat ${platClass}`} style={{ flexShrink: 0 }}>{platShort}</span>
      </div>
      <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                background: 'var(--bg-raised)', color: 'var(--accent)', fontFamily: 'var(--f-mono)', fontSize: 11,
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
            <span className="eyebrow">Variante · {platBadge(v.platformSlug).upper}</span>
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
              <span className="badge" style={{ background: 'color-mix(in oklab, var(--accent) 15%, transparent)', color: 'var(--glow-cyan)', borderColor: 'color-mix(in oklab, var(--accent) 40%, transparent)' }}>
                {v.bottles} bottles
              </span>
            )}
            {v.catalogPriceUsd != null && (
              <span className="badge" style={{ background: 'var(--bg-subtle)', color: 'var(--fg1)' }}>
                Catálogo: {fmtCurrency(v.catalogPriceUsd, cur, 0)}
              </span>
            )}
            {v.variant && (
              <span className="badge" style={{ background: 'color-mix(in oklab, var(--hot) 12%, transparent)', color: 'var(--hot)', borderColor: 'color-mix(in oklab, var(--hot) 35%, transparent)' }}>
                Variant: {v.variant}
              </span>
            )}
            {v.catalogStatus && v.catalogStatus !== 'Ativo' && (
              <span className="badge" style={{ background: 'var(--warning-bg)', color: 'var(--warning)', borderColor: 'color-mix(in srgb, var(--warning) 40%, transparent)' }}>
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
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg5)' }}>
                Lucro atribuído · funil completo da sessão
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
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg5)' }}>Links do catálogo</div>
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
      Array.from(filters.families).join(','), Array.from(filters.affiliates || []).join(',')]);

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
    FRONTEND: { label: 'Frontend', accent: 'var(--accent)', tagClass: 'plat-cb' },
    UPSELL:   { label: 'Upsell',   accent: 'var(--gold)', tagClass: 'plat-cb' },
    BUMP:     { label: 'Bump',     accent: 'var(--hot)', tagClass: 'plat-d24' },
    DOWNSELL: { label: 'Downsell', accent: 'var(--fg5)', tagClass: 'plat-d24' },
  };

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">Produtos · Ofertas</span>
          <h2>Performance <em>do catálogo</em></h2>
          <span className="sub">{products.length} de {allProducts.length} SKUs · clica num card pra abrir detalhes</span>
        </div>
        <div className="page-head-actions" style={{ flexWrap: 'wrap' }}>
          <div className="select-btn" style={{ padding: '0 10px', width: 'min(220px, 100%)' }}>
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
        <span className="f-label">Tipo de produto</span>
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
            const meta = TYPE_META[p.productType] || { label: p.productType, accent: 'var(--accent)' };
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
                  <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg5)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.externalId}
                  </div>
                </div>
                <div className="prod-plat">
                  <span className={`plat ${platClass}`}>{platShort}</span>
                  <span className="badge" style={{ background: `color-mix(in oklab, ${meta.accent} 12%, transparent)`, color: meta.accent, borderColor: `color-mix(in oklab, ${meta.accent} 35%, transparent)` }}>
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
                  <div className="prod-stat"><div className="l">Aprovação</div><div className="v sm" style={{ color: p.allOrders ? apColor : 'var(--fg5)' }}>
                    {p.allOrders ? (p.approvalRate * 100).toFixed(1) + '%' : '—'}
                  </div></div>
                  <div className="prod-stat"><div className="l">Margem</div><div className="v sm" style={{ color: margin > 0 ? 'var(--success)' : 'var(--danger)' }}>{fmtCurrency(margin, cur, 0)}</div></div>
                  <div className="prod-stat"><div className="l">Margem %</div><div className="v sm" style={{ color: marginPct > 0.2 ? 'var(--success)' : marginPct > 0.1 ? 'var(--warning)' : 'var(--danger)' }}>{(marginPct * 100).toFixed(1)}%</div></div>
                </div>
                {p.lastSoldAt && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-soft)', fontSize: 11, color: 'var(--fg4)', display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--f-mono)' }}>
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
                  const meta = TYPE_META[p.productType] || { label: p.productType, accent: 'var(--accent)' };
                  const { cls: platClass, short: platShort } = platBadge(p.platformSlug);
                  const apColor = p.approvalRate > 0.7 ? 'var(--success)' : p.approvalRate > 0.5 ? 'var(--warning)' : 'var(--danger)';
                  const margin = p.net - p.cpa;
                  return (
                    <tr key={`${p.platformSlug}:${p.externalId}`}>
                      <td>{p.name}</td>
                      <td className="cell-mono" style={{ color: 'var(--fg4)' }}>{p.externalId}</td>
                      <td>
                        <span className="badge" style={{ background: `color-mix(in oklab, ${meta.accent} 12%, transparent)`, color: meta.accent, borderColor: `color-mix(in oklab, ${meta.accent} 35%, transparent)` }}>
                          {meta.label}
                        </span>
                      </td>
                      <td><span className={`plat ${platClass}`}>{platShort}</span></td>
                      <td className="cell-mono" style={{ color: 'var(--fg4)' }}>{p.vendorAccount || '—'}</td>
                      <td className="num cell-mono">{fmtInt(p.orders)}</td>
                      <td className="num cell-mono" style={{ color: p.allOrders ? apColor : 'var(--fg5)' }}>
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
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg5)', marginBottom: 10 }}>
            Resumo por tipo · período
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {byType.map((b) => {
              const meta = TYPE_META[b.productType] || { label: b.productType, accent: 'var(--accent)' };
              return (
                <div key={b.productType} style={{ padding: 12, border: '1px solid var(--border-soft)', borderRadius: 6, background: 'color-mix(in oklab, var(--accent) 3%, transparent)' }}>
                  <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: meta.accent, marginBottom: 6 }}>
                    {meta.label}
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
  // `search` pode vir da URL (drill-down da fila de não mapeados).
  const [query, setQuery] = useState(() => {
    try { return new URLSearchParams(location.search).get('search') || ''; } catch (e) { return ''; }
  });
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
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [state, setStateTx] = useState({ status: 'loading', data: null, error: null });
  const [drawer, setDrawer] = useState(null); // { externalId, platformSlug } | null
  const isMobile = useIsMobileAP();

  // Debounce search input so we don't hammer the endpoint on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Paginação no SERVIDOR: cada página busca só as suas linhas (limit/offset)
  // e o total é o real do filtro — antes a tela fatiava um lote de 500 e o
  // que passasse disso não aparecia em página nenhuma. A página vive junto
  // com a chave do filtro: filtro novo = página 1 já no MESMO render, sem um
  // fetch perdido da página antiga.
  const txFilterKey = [statusFilter, typeFilter, debouncedQuery,
    filters.dateRange.start.getTime(), filters.dateRange.end.getTime(),
    Array.from(filters.platforms).join(','), Array.from(filters.countries).join(','),
    Array.from(filters.funnels).join(','), Array.from(filters.families).join(','),
    Array.from(filters.affiliates || []).join(',')].join('|');
  const [txPg, setTxPg] = useState(() => ({ key: txFilterKey, page: 1 }));
  const page = txPg.key === txFilterKey ? txPg.page : 1;
  const setPage = (p) => setTxPg({ key: txFilterKey, page: p });
  const [pageSize, setPageSize] = useState(() => window.nsReadPageSize(50));

  useEffect(() => {
    let cancelled = false;
    setStateTx((s) => ({ ...s, status: 'loading' }));
    window.NSApi.fetchOrders(filters, { status: statusFilter, productType: typeFilter, search: debouncedQuery, limit: pageSize, offset: (page - 1) * pageSize })
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
      Array.from(filters.families).join(','), Array.from(filters.affiliates || []).join(','),
      statusFilter, typeFilter, debouncedQuery, page, pageSize]);

  const cur = filters.currency || 'USD';
  const orders = state.data?.orders || [];
  const statusCounts = state.data?.statusCounts || {};
  const typeCounts = state.data?.typeCounts || {};
  const total = state.data?.total ?? 0;
  // Enquanto a próxima página carrega, o total da anterior segura o controle
  // no lugar (sem piscar "Nenhum resultado").
  const txPager = total > 0 ? (
    <Pager page={page} pageSize={pageSize} total={total} label="transações"
      onPageChange={setPage}
      onPageSizeChange={(n) => { setPageSize(n); window.nsSavePageSize(n); setPage(1); }}/>
  ) : null;

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">Transações · Ledger</span>
          <h2>Cada <em>pedido</em>, cada linha.</h2>
          <span className="sub">
            Stream bruto · {fmtInt(total)} {total === 1 ? 'linha' : 'linhas'} no filtro
          </span>
        </div>
        <div className="page-head-actions" style={{ flexWrap: 'wrap' }}>
          <div className="select-btn" style={{ padding: '0 10px', width: 'min(240px, 100%)' }}>
            <Icon name="search" size={13}/>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por ID de pedido ou afiliado..."
              style={{ background: 'transparent', border: 0, color: 'var(--fg1)', outline: 'none', flex: 1, fontFamily: 'var(--f-mono)', fontSize: 12 }}/>
          </div>
          {/* Download navegando direto pro endpoint (sessão no cookie): o
              servidor exporta TODAS as linhas do filtro atual, não só a
              página da tela. XLSX removido — era um botão morto; CSV com BOM
              abre no Excel do mesmo jeito. */}
          <button className="btn btn-ghost" title="Exporta todas as transações do filtro atual (não só a página visível)"
            onClick={() => { window.location.href = window.NSApi.ordersExportUrl(filters, { status: statusFilter, productType: typeFilter, search: debouncedQuery }); }}>
            <Icon name="download" size={12}/> Exportar CSV
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0 12px', flexWrap: 'wrap' }}>
        <span className="f-label">Status</span>
        <div className="seg">
          {[['all','Todos'],['approved','Aprovados'],['pending','Pendentes'],['refunded','Reembolsados'],['chargeback','Chargeback']].map(([k, l]) => (
            <button key={k} className={statusFilter === k ? 'is-active' : ''} onClick={() => setStatusFilter(k)}>
              {l}<span style={{ marginLeft: 6, opacity: 0.5 }}>{fmtInt(statusCounts[k] || 0)}</span>
            </button>
          ))}
        </div>
        <span className="f-label" style={{ marginLeft: 8 }}>Etapa</span>
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

      {isMobile ? (
        /* MOBILE (R2): mesma lista, em cards — mesmo handler do drawer da
           linha. Estilos de .tx-cards/.tx-card vêm do CSS (contrato R2). */
        <>
            <div className="tx-cards">
              {state.status === 'loading' && Array.from({ length: 6 }).map((_, i) => (
                <div className="tx-card" key={`sk-${i}`}>
                  <div className="l1"><SkelLine w="55%"/></div>
                  <div className="l3"><SkelLine w="75%"/></div>
                </div>
              ))}
              {state.status === 'ready' && orders.length === 0 && (
                <div style={{ textAlign: 'center', padding: 24, opacity: 0.6 }}>Nenhuma transação no período</div>
              )}
              {state.status !== 'loading' && orders.map((o) => {
                const { cls: platClass, short: platShort } = platBadge(o.platformSlug);
                const statusLc = o.status.toLowerCase();
                return (
                  <div className="tx-card" key={`${o.platformSlug}:${o.externalId}`}
                       onClick={() => setDrawer({ externalId: o.externalId, platformSlug: o.platformSlug })}>
                    <div className="l1">
                      <span>{o.productName || o.productExternalId}</span>
                      <span className="val" style={o.grossAmountUsd < 0 ? { color: 'var(--danger)' } : undefined}>
                        {fmtCurrency(o.grossAmountUsd, cur, 2)}
                      </span>
                    </div>
                    <div className="l2">
                      <span className={`plat ${platClass}`}>{platShort}</span>
                      <StagePill type={o.productType} />
                      <span className={`st st-${statusLc}`}>{statusLc}</span>
                    </div>
                    <div className="l3">
                      {fmtDateTime(o.eventAt || o.orderedAt)} · {o.affiliateNickname || o.affiliateExternalId || '—'}{o.mappedAffiliateName ? ` (${o.mappedAffiliateName})` : ''} · {o.country || '—'} · {shortTxId(o.externalId)}
                    </div>
                  </div>
                );
              })}
            </div>
            {txPager}
        </>
      ) : (
      <div className="panel" style={{ padding: 0 }}>
        <>
            {/* key por página: o scroller (maxHeight 720) remonta e volta ao topo —
                senão a página 2 abre rolada onde o usuário parou na página 1. */}
            <div className="tbl-wrap" key={`${page}:${pageSize}`} style={{ margin: 0, padding: '0 4px', maxHeight: 720, overflowY: 'auto' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Data/hora</th><th>Pedido</th><th>Plataforma</th>
                    <th>Produto</th><th>Afiliado</th>
                    <th title="Identidade no NorthScale Afiliados (affiliate_id resolvido pelo mapeamento)">Afiliado (sistema)</th>
                    <th>País</th><th>Pagamento</th>
                    <th className="num">Bruto</th><th className="num">Taxas</th>
                    <th className="num">Líquido</th>
                    <th>Status</th>
                    <th className="num">CPA</th>
                  </tr>
                </thead>
                <tbody>
                  {state.status === 'loading' && <SkelTableRows rows={12} cols={13}/>}
                  {state.status === 'ready' && orders.length === 0 && (
                    <tr><td colSpan={13} style={{ textAlign: 'center', padding: 24, opacity: 0.6 }}>Nenhuma transação no período</td></tr>
                  )}
                  {state.status !== 'loading' && orders.map((o) => {
                    const { cls: platClass, short: platShort } = platBadge(o.platformSlug);
                    const statusLc = o.status.toLowerCase();
                    return (
                      <tr key={`${o.platformSlug}:${o.externalId}`}
                          onClick={() => setDrawer({ externalId: o.externalId, platformSlug: o.platformSlug })}
                          style={{ cursor: 'pointer' }}>
                        {/* Linha de estorno é datada da VENDA na Digistore (é
                            linha extra), então mostramos a data do EVENTO —
                            quando o dinheiro voltou — com a venda no title. */}
                        <td className="cell-mono" title={o.eventAt !== o.orderedAt ? `venda em ${fmtDateTime(o.orderedAt)}` : undefined}>
                          {fmtDateTime(o.eventAt || o.orderedAt)}
                        </td>
                        <td className="cell-mono">{o.externalId}</td>
                        <td><span className={`plat ${platClass}`}>{platShort}</span></td>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap' }}>
                            {o.productName || o.productExternalId}
                            <StagePill type={o.productType} />
                          </span>
                        </td>
                        <td className="cell-mono">{o.affiliateNickname || o.affiliateExternalId || '—'}</td>
                        <td>
                          {o.mappedAffiliateId
                            ? <AmMappedChip mapped={{ id: o.mappedAffiliateId, name: o.mappedAffiliateName || o.mappedAffiliateId, status: o.mappedAffiliateStatus || 'active' }}/>
                            : (o.affiliateExternalId ? <AmMappedChip mapped={null} platformSlug={o.platformSlug}/> : <span style={{ color: 'var(--fg5)' }}>—</span>)}
                        </td>
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
            {txPager}
        </>
      </div>
      )}

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
            <button className="icon-btn" onClick={onClose} aria-label="Fechar" title="Fechar"><Icon name="x" size={14}/></button>
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
            <button className="icon-btn" onClick={onClose} aria-label="Fechar" title="Fechar"><Icon name="x" size={14}/></button>
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
            <span className="eyebrow">Pedido · {o.platformDisplayName}</span>
            <h3 style={{ margin: '4px 0', fontSize: 18, color: 'var(--fg1)' }}>{o.externalId}</h3>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className={`plat ${platClass}`}>{platShort}</span>
              <span className="badge" style={{ background: `color-mix(in oklab, ${typeColor} 12%, transparent)`, color: typeColor, borderColor: `color-mix(in oklab, ${typeColor} 35%, transparent)` }}>
                {typeLabel}
              </span>
              <span className={`st st-${statusLc}`}>{statusLc}</span>
              {isCrossSell && (
                <span className="badge" style={{ background: 'var(--warning-bg)', color: 'var(--warning)', borderColor: 'color-mix(in srgb, var(--warning) 40%, transparent)' }}>
                  Cross-sell
                </span>
              )}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar" title="Fechar"><Icon name="x" size={14}/></button>
        </div>

        <div style={{ padding: '16px 18px 32px', display: 'grid', gap: 16 }}>

          {/* Financial breakdown */}
          <div>
            <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg4)', marginBottom: 8 }}>
              Fluxo financeiro
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
              accent={o.cpaPaidUsd > 0 ? 'var(--money)' : 'var(--fg5)'}
              muted={o.cpaPaidUsd === 0}
            />
            <div style={{ height: 1, background: 'var(--border)', margin: '8px 0' }}/>
            <FinRow label={o.status === 'APPROVED' ? 'Empresa recebeu' : 'Empresa receberia (refund/cb)'}
                    value={o.companyKept} cur={cur}
                    accent={o.status === 'APPROVED' ? (o.companyKept > 0 ? 'var(--success)' : 'var(--danger)') : 'var(--fg5)'}/>
            {o.cogsUsd != null && o.fulfillmentUsd != null && (
              <>
                <FinRow label="Custo do produto" value={-o.cogsUsd} cur={cur} muted/>
                <FinRow label="Frete" value={-o.fulfillmentUsd} cur={cur} muted/>
                <div style={{ height: 1, background: 'var(--border)', margin: '8px 0' }}/>
                <FinRow
                  label={o.status === 'APPROVED' ? 'Lucro líquido' : 'Prejuízo (refund/cb)'}
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
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--fg5)' }}>
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
            <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg4)', marginBottom: 8 }}>
              Produto
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
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg4)', marginBottom: 8 }}>
                Afiliado
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
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg4)', marginBottom: 8 }}>
                Afiliado
              </div>
              <div style={{ fontSize: 12, color: 'var(--fg5)' }}>
                Venda direta (sem afiliado atribuído)
              </div>
            </div>
          )}

          {/* Customer */}
          {customer && (
            <div>
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg4)', marginBottom: 8 }}>
                Cliente
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
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg4)', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                <span>Sessão completa · {session.length} pedidos</span>
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
                        background: s.isSelf ? 'color-mix(in oklab, var(--accent) 10%, transparent)' : 'var(--bg-raised)',
                        border: '1px solid var(--border-soft)', cursor: s.isSelf ? 'default' : 'pointer',
                        display: 'grid', gridTemplateColumns: '64px 1fr auto auto', gap: 8, alignItems: 'center',
                      }}
                    >
                      <span className="badge" style={{ background: `color-mix(in oklab, ${sColor} 12%, transparent)`, color: sColor, borderColor: `color-mix(in oklab, ${sColor} 35%, transparent)`, fontSize: 10, justifySelf: 'start' }}>
                        {sType}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--fg2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.productName}
                        {s.isCrossSell && <span style={{ color: 'var(--warning)', marginLeft: 6, fontSize: 10 }}>cross</span>}
                      </span>
                      <span className={`st st-${sStatusLc}`} style={{ fontSize: 10 }}>{sStatusLc}</span>
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
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg4)', marginBottom: 8 }}>
                Origem do tráfego
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
            <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg4)', marginBottom: 8 }}>
              Timeline
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
                        borderRadius: 4, background: 'var(--bg-raised)', color: 'var(--accent)',
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
      fontSize: 12, color: muted ? 'var(--fg5)' : 'var(--fg2)',
    }}>
      <span>{label}</span>
      <span style={{
        fontFamily: 'var(--f-mono)',
        color: accent || (bold ? 'var(--fg1)' : 'inherit'),
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
      background: color ? `color-mix(in srgb, ${color} 13%, transparent)` : 'var(--bg-subtle)',
      color: color || 'var(--fg2)',
      borderColor: color ? `color-mix(in srgb, ${color} 33%, transparent)` : 'var(--border-soft)',
      fontSize: 10,
    }}>{label}</span>
  );
}

function KV({ k, v, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color: 'var(--fg5)' }}>{k}</span>
      <span style={{ color: color || 'var(--fg1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {v}
      </span>
    </div>
  );
}

function txTypeLabel(productType, funnelStep) {
  if (productType === 'FRONTEND') return 'Frontend';
  if (productType === 'BUMP') return 'Order bump';
  if (productType === 'DOWNSELL') return 'Downsell';
  if (productType === 'SMS_RECOVERY') return 'SMS Recovery';
  if (productType === 'UPSELL') return funnelStep && funnelStep >= 2 ? 'Upsell 2' : 'Upsell 1';
  return productType;
}
function txTypeColor(productType) {
  switch (productType) {
    case 'FRONTEND': return 'var(--accent)';
    case 'UPSELL': return 'var(--gold)';
    case 'BUMP': return 'var(--hot)';
    case 'DOWNSELL': return 'var(--chart-2)';
    case 'SMS_RECOVERY': return 'var(--chart-5)';
    default: return 'var(--fg5)';
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
      Array.from(filters.families).join(','), Array.from(filters.affiliates || []).join(','),
      refreshKey]);

  const cur = filters.currency || 'USD';
  const platforms = state.data?.platforms || [];

  const PLATFORM_SHORT = { digistore24: 'D24', clickbank: 'CB', buygoods: 'BG', cartpanda: 'CP', jvzoo: 'JVZ' };
  const comingSoon = [
    { slug: 'maxweb', displayName: 'MaxWeb', short: 'MW', desc: 'Connector pendente · credenciais não configuradas' },
    { slug: 'stickyio', displayName: 'Sticky.io', short: 'SK', desc: 'Connector em desenvolvimento' },
  ].filter((p) => !platforms.some((x) => x.slug === p.slug));

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">Sistema · Plataformas</span>
          <h2>Visão <em>das plataformas</em></h2>
          <span className="sub">Receita, pedidos e saúde dos connectors por plataforma no período selecionado</span>
        </div>
      </div>

      {state.status === 'error' && (
        <div className="panel" style={{ color: 'var(--danger)' }}>Erro ao carregar: {state.error}</div>
      )}

      {/* Espelho do NorthScale Afiliados (identidade dos afiliados): status
          da integração, fila de não mapeados, ações de sync/backfill. */}
      <AffiliateMappingPanel/>

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
                  ? <span className="ph-status ok"><span className="led"/>Saudável</span>
                  : <span className="badge warn">Sem sync</span>
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
                {/* % de PEDIDOS reembolsados (+CB) em coorte MADURA (60–150d):
                   o único recorte honesto — janela curta subestima porque o
                   refund chega semanas depois da venda. Denominador já
                   corrigido por plataforma no backend (linha-extra da D24). */}
                <div className="ph-stat" style={{ gridColumn: '1 / -1' }}
                  title="Refund+chargeback ÷ vendas, coorte de 60–150 dias atrás (madura). Janelas curtas subestimam — o reembolso chega até meses depois da venda.">
                  <div className="l">Pedidos reembolsados · coorte madura</div>
                  <div className="v cell-mono" style={{ fontSize: 18, color: (p.observedRefundCbPct ?? 0) > 10 ? 'var(--warning)' : 'inherit' }}>
                    {p.observedRefundCbPct != null && p.observedRefundSample > 0
                      ? `${p.observedRefundCbPct.toFixed(1)}%`
                      : '—'}
                    {p.observedRefundSample > 0 && (
                      <span style={{ fontSize: 11, color: 'var(--fg4)', marginLeft: 6 }}>
                        de {fmtInt(p.observedRefundSample)} pedidos (60–150d)
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Waterfall financeiro — só se fees cadastradas (admin).
                 Reproduz a estrutura do relatório de allowance do Digistore:
                 Gross bruto → − taxa → − comissões → = Your earnings.
                 Allowance reservado entra como linha separada (sobre gross). */}
              {(p.feeRatePct != null || p.allowancePct != null) && (
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border-soft)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ fontSize: 10, color: 'var(--fg4)' }}>
                      Waterfall · Período
                    </div>
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 10, padding: '2px 6px' }}
                      onClick={() => setEditing({
                        slug: p.slug,
                        displayName: p.displayName,
                        feeRatePct: p.feeRatePct ?? '',
                        allowancePct: p.allowancePct ?? '',
                        refundCbPct: p.refundCbPct ?? '',
                        observedRefundCbPct: p.observedRefundCbPct,
                        observedRefundSample: p.observedRefundSample,
                      })}
                      title="Atualizar taxas + allowance + refund&cb do modelo CPA"
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
                    <div style={{ fontSize: 10, color: 'var(--fg5)', marginTop: 8, fontFamily: 'var(--f-mono)' }}>
                      % atualizados {fmtSyncAgo(p.feesUpdatedAt)}
                    </div>
                  )}
                </div>
              )}

              {/* Botão cadastrar quando vazio. */}
              {p.feeRatePct == null && p.allowancePct == null && (
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border-soft)' }}>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 11, width: '100%', justifyContent: 'center' }}
                    onClick={() => setEditing({
                      slug: p.slug,
                      displayName: p.displayName,
                      feeRatePct: '',
                      allowancePct: '',
                      refundCbPct: p.refundCbPct ?? '',
                      observedRefundCbPct: p.observedRefundCbPct,
                      observedRefundSample: p.observedRefundSample,
                    })}
                  >
                    <Icon name="plus" size={11}/> Cadastrar taxas e allowance
                  </button>
                </div>
              )}

              {p.topProduct && (
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border-soft)' }}>
                  <div style={{ fontSize: 10, color: 'var(--fg4)', marginBottom: 4 }}>
                    Top produto
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--fg1)', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.topProduct.name}
                    </span>
                    <span className="cell-mono" style={{ color: 'var(--money)' }}>
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
              <span className="badge neutral">Em breve</span>
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
  const [refundCb, setRefundCb] = useState(String(platform.refundCbPct ?? ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setError(null);
    const fee = feeRate.trim() === '' ? null : Number(feeRate.replace(',', '.'));
    const alw = allowance.trim() === '' ? null : Number(allowance.replace(',', '.'));
    const rcb = refundCb.trim() === '' ? null : Number(refundCb.replace(',', '.'));
    if (fee != null && (!Number.isFinite(fee) || fee < 0 || fee > 100)) {
      setError('Taxa deve estar entre 0 e 100'); return;
    }
    if (alw != null && (!Number.isFinite(alw) || alw < 0 || alw > 100)) {
      setError('Allowance deve estar entre 0 e 100'); return;
    }
    if (rcb != null && (!Number.isFinite(rcb) || rcb < 0 || rcb > 100)) {
      setError('Refund & CB deve estar entre 0 e 100'); return;
    }
    setSaving(true);
    try {
      await window.NSApi.adminPatchPlatformFees(platform.slug, {
        feeRatePct: fee,
        allowancePct: alw,
        refundCbPct: rcb,
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
        position: 'fixed', inset: 0, zIndex: 100, background: 'color-mix(in srgb, var(--ns-black) 72%, transparent)',
        display: 'grid', placeItems: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="panel"
        style={{ width: 'min(380px, 92vw)', padding: 22 }}
      >
        <div className="eyebrow" style={{ fontSize: 10, color: 'var(--glow-cyan)', marginBottom: 4 }}>
          Plataforma · {platform.displayName || platform.slug}
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
        <label style={{ display: 'block', marginBottom: 14 }}>
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
        <label style={{ display: 'block', marginBottom: 18 }}>
          <span style={{ fontSize: 11, color: 'var(--fg3)', display: 'block', marginBottom: 4 }}>
            Refund & chargeback (%) · modelo CPA
          </span>
          <input
            type="text" inputMode="decimal" value={refundCb}
            onChange={(e) => setRefundCb(e.target.value)}
            placeholder="ex: 15"
            style={feesInputStyle}
          />
          <span style={{ display: 'block', fontSize: 10, color: 'var(--fg5)', marginTop: 4, fontFamily: 'var(--f-mono)' }}>
            {platform.observedRefundCbPct != null && platform.observedRefundSample > 0
              ? `observada (coorte madura 60–150d): ${platform.observedRefundCbPct.toFixed(1)}% em ${fmtInt(platform.observedRefundSample)} pedidos — use pra calibrar`
              : 'sem coorte madura ainda (plataforma nova) — mantenha a estimativa manual'}
          </span>
          {platform.slug === 'digistore24' && (
            <span style={{ display: 'block', fontSize: 10, color: 'var(--accent)', marginTop: 4, fontFamily: 'var(--f-mono)' }}>
              Digistore usa a taxa REAL dos eventos de refund/chargeback
              (em valor, coorte madura) automaticamente no NET AFTER CPA —
              este campo manual é só fallback enquanto não há amostra.
            </span>
          )}
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
  background: 'var(--bg)', border: '1px solid var(--border)',
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
          <span className="eyebrow">Settings · FX / currency</span>
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

// Catálogo de tabs: vem do servidor em GET /api/admin/users (availableTabs),
// que lê lib/auth/tabs.ts. Esta lista é só o FALLBACK pra resposta antiga —
// não é a fonte da verdade. Aba nova entra em lib/auth/tabs.ts e aparece aqui
// sozinha.
const TAB_CATALOG = [
  { group: 'Análise',   id: 'overview',       label: 'Visão geral' },
  { group: 'Análise',   id: 'funnel',         label: 'Funil' },
  { group: 'Análise',   id: 'refund-cohorts', label: 'Reembolsos' },
  { group: 'Afiliados', id: 'leaderboard',    label: 'Ranking' },
  { group: 'Afiliados', id: 'all-affiliates', label: 'Todos os afiliados' },
  { group: 'Afiliados', id: 'affiliate-analysis', label: 'Análise' },
  { group: 'Afiliados', id: 'affiliate-crm',  label: 'CRM' },
  { group: 'Captação',  id: 'recovery',       label: 'Recuperação' },
  { group: 'Captação',  id: 'tauk',           label: 'Call Center' },
  { group: 'Catálogo',  id: 'products',       label: 'Produtos' },
  { group: 'Catálogo',  id: 'transactions',   label: 'Transações' },
  { group: 'Sistema',   id: 'platforms',      label: 'Plataformas' },
  { group: 'Sistema',   id: 'health',         label: 'Saúde do dado' },
];
// Preenchido por GET /api/admin/users. Enquanto não chega (ou se a resposta
// for de uma versão antiga), vale a cópia local acima.
let SERVER_TAB_CATALOG = null;
function tabCatalog() { return SERVER_TAB_CATALOG && SERVER_TAB_CATALOG.length ? SERVER_TAB_CATALOG : TAB_CATALOG; }
function tabGroups() {
  const out = [];
  for (const t of tabCatalog()) if (!out.includes(t.group)) out.push(t.group);
  return out;
}

function UsersPage({ currentUser }) {
  const [state, setState] = useState({ status: 'loading', users: [], pagination: null, error: null });
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [bumpRefresh, setBumpRefresh] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading' }));
    window.NSApi.adminListUsers({ page, pageSize })
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data.availableTabs) && data.availableTabs.length) SERVER_TAB_CATALOG = data.availableTabs;
        setState({ status: 'ready', users: data.users, pagination: data.pagination || null, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('adminListUsers failed', err);
        setState({ status: 'error', users: [], pagination: null, error: err.message });
      });
    return () => { cancelled = true; };
  }, [bumpRefresh, page, pageSize]);

  function reload() { setBumpRefresh((n) => n + 1); }

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">Admin · Usuários do dashboard</span>
          <h2>Quem tem <em>acesso</em></h2>
          <span className="sub">
            {/* total do servidor (paginação no servidor), não só a página atual */}
            {fmtInt(state.pagination ? state.pagination.total : state.users.length)} {(state.pagination ? state.pagination.total : state.users.length) === 1 ? 'usuário' : 'usuários'}
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
                  <tr tabIndex={0} key={u.id} onClick={() => setEditing(u)} style={{ cursor: 'pointer' }}>
                    <td>
                      <span className="cell-aff">
                        <span className="av" style={{ background: avatarColor(u.email) }}>{initials(display)}</span>
                        <span className="meta">
                          <span className="nm">
                            {display}
                            {isSelf && (
                              <span style={{ marginLeft: 6, fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--glow-cyan)' }}>
                                Você
                              </span>
                            )}
                          </span>
                          <span className="id">{u.email}</span>
                        </span>
                      </span>
                    </td>
                    <td>
                      <span className="badge" style={{
                        background: u.role === 'ADMIN' ? 'color-mix(in oklab, var(--accent) 12%, transparent)' : 'transparent',
                        color: u.role === 'ADMIN' ? 'var(--accent)' : 'var(--fg4)',
                        borderColor: u.role === 'ADMIN' ? 'var(--accent)' : 'var(--border)',
                      }}>
                        {u.role}
                      </span>
                    </td>
                    <td>
                      {u.role === 'ADMIN' ? (
                        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--glow-cyan)' }}>todas as abas</span>
                      ) : (
                        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: u.allowedTabs.length === 0 ? 'var(--danger)' : 'var(--fg2)' }}>
                          {u.allowedTabs.length === 0 ? 'nenhuma aba' : `${u.allowedTabs.length} ${u.allowedTabs.length === 1 ? 'aba' : 'abas'}`}
                        </span>
                      )}
                    </td>
                    <td className="cell-mono" style={{ color: 'var(--fg4)', fontSize: 11 }}>
                      {u.lastLoginAt ? fmtRelative(u.lastLoginAt) : '—'}
                    </td>
                    <td>
                      <span className="badge" style={{
                        background: u.active ? 'color-mix(in oklab, var(--success) 12%, transparent)' : 'color-mix(in oklab, var(--danger) 12%, transparent)',
                        color: u.active ? 'var(--success)' : 'var(--danger)',
                        borderColor: u.active ? 'color-mix(in oklab, var(--success) 35%, transparent)' : 'color-mix(in oklab, var(--danger) 35%, transparent)',
                      }}>
                        {u.active ? 'Ativo' : 'Inativo'}
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
        </div>
        {state.pagination && (
          <Pager
            page={state.pagination.page}
            pageSize={state.pagination.pageSize}
            total={state.pagination.total}
            hasMore={state.pagination.hasMore}
            onPageChange={setPage}
            onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
            label="usuários"
          />
        )}
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
      for (const t of tabCatalog()) if (t.group === group) next.add(t.id);
      return next;
    });
  }
  function clearGroup(group) {
    setAllowedTabs((prev) => {
      const next = new Set(prev);
      for (const t of tabCatalog()) if (t.group === group) next.delete(t.id);
      return next;
    });
  }
  function selectAllTabs() {
    setAllowedTabs(new Set(tabCatalog().map((t) => t.id)));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: name || (isCreate ? undefined : null),
        role,
        allowedTabs: role === 'MEMBER' ? Array.from(allowedTabs) : [],
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
            <span className="eyebrow">{isCreate ? 'Novo usuário' : 'Editar usuário'}</span>
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
                  color: 'var(--glow-cyan)', background: 'color-mix(in oklab, var(--accent) 8%, transparent)',
                  border: '1px solid color-mix(in oklab, var(--accent) 30%, transparent)', borderRadius: 4, cursor: 'pointer',
                }}
              >
                <Icon name="key" size={10}/> Gerar
              </button>
            </div>
          )}

          <div style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg4)' }}>Papel</span>
            <div className="seg" style={{ width: 'fit-content' }}>
              {[['MEMBER', 'Member'], ['ADMIN', 'Admin']].map(([k, l]) => (
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
            </div>
          </div>

          {role === 'MEMBER' && (
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg4)' }}>
                  Abas liberadas · {allowedTabs.size}
                </span>
                <button
                  onClick={selectAllTabs}
                  style={{ background: 'transparent', border: 0, color: 'var(--glow-cyan)',
                           fontFamily: 'var(--f-mono)', fontSize: 10,
                           cursor: 'pointer' }}
                >
                  Tudo
                </button>
              </div>
              {tabGroups().map((group) => {
                const tabs = tabCatalog().filter((t) => t.group === group);
                const checked = tabs.filter((t) => allowedTabs.has(t.id)).length;
                return (
                  <div key={group} style={{ border: '1px solid var(--border-soft)', borderRadius: 6, padding: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg4)' }}>
                        {group} · {checked}/{tabs.length}
                      </span>
                      <span style={{ display: 'flex', gap: 4 }}>
                        <button
                          onClick={() => selectAllInGroup(group)}
                          style={{ background: 'transparent', border: 0, color: 'var(--glow-cyan)',
                                   fontFamily: 'var(--f-mono)', fontSize: 10, cursor: 'pointer' }}
                        >Todos</button>
                        <button
                          onClick={() => clearGroup(group)}
                          style={{ background: 'transparent', border: 0, color: 'var(--fg5)',
                                   fontFamily: 'var(--f-mono)', fontSize: 10, cursor: 'pointer' }}
                        >Nenhum</button>
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
              <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg4)' }}>Status</span>
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
                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg4)' }}>Senha</span>
                {!showResetField && (
                  <button
                    onClick={() => setShowResetField(true)}
                    style={{ background: 'var(--warning-bg)', border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)',
                             color: 'var(--warning)', fontFamily: 'var(--f-mono)', fontSize: 10,
                             padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}
                  >
                    <Icon name="key" size={10}/> Resetar senha
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
                               color: 'var(--glow-cyan)', background: 'color-mix(in oklab, var(--accent) 8%, transparent)',
                               border: '1px solid color-mix(in oklab, var(--accent) 30%, transparent)', borderRadius: 4,
                               cursor: 'pointer' }}
                    ><Icon name="key" size={10}/> Gerar</button>
                    <button
                      onClick={() => { setShowResetField(false); setPassword(''); }}
                      style={{ padding: '4px 10px', fontFamily: 'var(--f-mono)', fontSize: 10,
                               color: 'var(--fg5)', background: 'transparent',
                               border: '1px solid var(--border-soft)', borderRadius: 4,
                               cursor: 'pointer' }}
                    >Cancelar</button>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--warning)', fontFamily: 'var(--f-mono)' }}>
                    Ao salvar, sessões ativas deste usuário serão derrubadas.
                  </div>
                </div>
              )}
            </div>
          )}

          {error && (
            <div style={{ fontSize: 12, color: 'var(--danger)', background: 'var(--danger-bg)',
                          border: '1px solid color-mix(in srgb, var(--danger) 25%, transparent)', padding: '8px 10px', borderRadius: 6,
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
              {busy ? 'Salvando...' : (isCreate ? 'Criar usuário' : 'Salvar alterações')}
            </button>
            {!isCreate && !isSelf && (
              <button
                onClick={deleteUser}
                disabled={busy || !initial.active}
                style={{
                  padding: '8px 12px', fontFamily: 'var(--f-mono)', fontSize: 11,
                  color: 'var(--danger)', background: 'var(--danger-bg)',
                  border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)', borderRadius: 6,
                  cursor: busy ? 'not-allowed' : 'pointer',
                }}
                title={!initial.active ? 'já está inativo' : 'desativa + derruba sessões'}
              >
                <Icon name="trash" size={11}/> Desativar
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
      <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg4)' }}>
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        style={{
          padding: '9px 12px', fontSize: 13, color: 'var(--fg1)',
          background: 'var(--bg)', border: '1px solid var(--border)',
          borderRadius: 6, outline: 'none', fontFamily: 'inherit',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
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
          <span className="eyebrow">Sistema · Observabilidade</span>
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
            <span className="panel-eyebrow">Ingestão por plataforma · Últimas 24h</span>
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
                const stateLabel = ok ? 'OK' : stale ? 'Stale' : noTraffic ? 'Sem tráfego' : 'Falhas';
                const stateColor = ok ? 'var(--success)' : 'var(--warning)';
                return (
                  <tr key={p.platform}>
                    <td>{p.displayName}</td>
                    <td className="cell-mono" style={{ color: stale ? 'var(--danger)' : 'var(--fg2)' }}>
                      {p.lastReceivedAt ? `${fmtAgo(p.secondsAgo)} atrás` : '—'}
                    </td>
                    <td className="num cell-mono">{fmtInt(p.receivedCount24h)}</td>
                    <td className="num cell-mono" style={{ color: failing ? 'var(--danger)' : 'var(--fg3)' }}>
                      {fmtInt(p.failedCount24h)}
                    </td>
                    <td className="num cell-mono">{(p.successRate24h * 100).toFixed(1)}%</td>
                    <td>
                      <span className="badge" style={{ background: `color-mix(in oklab, ${stateColor} 12%, transparent)`, color: stateColor, borderColor: `color-mix(in oklab, ${stateColor} 35%, transparent)` }}>
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
              <span className="panel-eyebrow">Taxas · 24h</span>
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
              <span className="panel-eyebrow">Catálogo</span>
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
            {d.catalog.unverifiedProducts != null && (d.catalog.unverifiedProducts > 0 || d.catalog.pendingOrders > 0) && (
              <div style={{ fontSize: 12, color: d.catalog.pendingOrders > 0 ? 'var(--warning)' : 'var(--fg4)' }}>
                {d.catalog.unverifiedProducts} SKU(s) aguardando confirmação no catálogo
                {d.catalog.pendingOrders > 0 && <> · {d.catalog.pendingOrders} pedido(s) com custo pendente ({fmtCurrency(d.catalog.pendingGrossUsd || 0, 'USD', 0)})</>}
              </div>
            )}
            {d.catalog.productsWithoutFamily > 0 ? (
              <>
                <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--warning)' }}>
                  {d.catalog.productsWithoutFamily} sem família
                </div>
                <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--fg4)', maxHeight: 180, overflowY: 'auto', display: 'grid', gap: 4 }}>
                  {d.catalog.unknownSKUs.map((s, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.externalId}</span>
                      <span style={{ color: 'var(--fg5)' }}>{s.platform}</span>
                    </div>
                  ))}
                </div>
                {d.catalog.unknownSKUs.length < d.catalog.productsWithoutFamily && (
                  <div style={{ fontSize: 11, color: 'var(--fg5)' }}>
                    Mostrando {fmtInt(d.catalog.unknownSKUs.length)} de {fmtInt(d.catalog.productsWithoutFamily)} — o servidor devolve no máximo 25.
                  </div>
                )}
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
  let color = 'var(--fg1)';
  if (good === 'up') color = value >= threshold ? 'var(--success)' : value >= threshold * 0.7 ? 'var(--warning)' : 'var(--danger)';
  if (good === 'down') color = value <= threshold ? 'var(--success)' : value <= threshold * 1.5 ? 'var(--warning)' : 'var(--danger)';
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ fontSize: 13, color: 'var(--fg3)' }}>{label}</span>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontFamily: 'var(--f-display)', fontSize: 22, color }}>{pct}%</div>
        {baseline != null && (
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: deltaColor || 'var(--fg4)' }}>
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

// "há 5min", "3h", "2d" — lista de conversas do chat.
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
                background: selectedId === c.id ? 'color-mix(in oklab, var(--accent) 8%, transparent)' : 'transparent',
                borderLeft: selectedId === c.id ? '2px solid var(--glow-cyan)' : '2px solid transparent',
                display: 'flex', gap: 8, alignItems: 'flex-start',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--fg1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {c.title || '(sem título)'}
                </div>
                <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg5)' }}>
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

  // Chat IA é pra qualquer usuário logado (admin E member) — sem gate de role.
  if (!user) return null;

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
            background: 'var(--cta)',
            border: 0, cursor: 'pointer',
            boxShadow: 'var(--shadow-md)',
            display: 'grid', placeItems: 'center',
            color: 'var(--on-cta)',
          }}
        >
          <Icon name="sparkles" size={20}/>
        </button>
      )}
      {open && ReactDOM.createPortal((
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 1000,
          width: 'min(420px, calc(100vw - 24px))', height: 'min(600px, calc(100vh - 100px))', maxHeight: 'calc(100vh - 48px)',
          display: 'flex', flexDirection: 'column',
          background: 'var(--bg-elev)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-lg)', overflow: 'hidden',
          boxShadow: 'var(--shadow-lg)',
        }}>
          <div style={{
            padding: '10px 14px', borderBottom: '1px solid var(--border-soft)',
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'color-mix(in oklab, var(--accent) 4%, transparent)',
          }}>
            <Icon name="sparkles" size={14} className=""/>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg4)' }}>Análise com IA</div>
              <div style={{ fontSize: 11, color: 'var(--fg5)' }}>Especialista em analytics nutra DR</div>
            </div>
            <a
              href={(() => {
                // Mesma conversa + filtros atuais na página inteira.
                const p = new URLSearchParams(location.search);
                if (conversationId) p.set('c', conversationId);
                const qs = p.toString();
                return '/chat' + (qs ? '?' + qs : '');
              })()}
              // Recalcula no clique: o App grava os filtros na URL num efeito
              // DEPOIS deste render, então o href do render fica um passo atrás.
              onClick={(e) => {
                const p = new URLSearchParams(location.search);
                if (conversationId) p.set('c', conversationId);
                const qs = p.toString();
                e.currentTarget.href = '/chat' + (qs ? '?' + qs : '');
              }}
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
          onTruncated: () => setError('A resposta bateu no teto de tamanho e foi cortada — peça "continue" pra ver o resto.'),
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
                    background: t.state === 'done' ? 'color-mix(in oklab, var(--success) 10%, transparent)' : 'color-mix(in oklab, var(--accent) 10%, transparent)',
                    color: t.state === 'done' ? 'var(--success)' : 'var(--glow-cyan)',
                    border: `1px solid ${t.state === 'done' ? 'color-mix(in oklab, var(--success) 30%, transparent)' : 'color-mix(in oklab, var(--accent) 30%, transparent)'}`,
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
          <div style={{ color: 'var(--danger)', fontSize: 12, background: 'var(--danger-bg)', padding: 10, borderRadius: 6 }}>
            Erro: {error}
          </div>
        )}
      </div>
      <div style={{
        padding: compact ? '10px 12px' : '14px 18px',
        borderTop: '1px solid var(--border-soft)',
        display: 'flex', gap: 8,
        background: 'color-mix(in oklab, var(--accent) 2%, transparent)',
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
            background: 'var(--bg)',
            border: '1px solid var(--border)', borderRadius: 6,
            outline: 'none',
          }}
        />
        <button
          onClick={send}
          disabled={streaming || !input.trim()}
          className="btn btn-primary"
          style={{ alignSelf: 'flex-end', opacity: streaming || !input.trim() ? 0.5 : 1 }}
          aria-label={streaming ? 'Gerando resposta…' : 'Enviar pergunta'}
          title={streaming ? 'Gerando resposta…' : 'Enviar (Enter)'}
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
  // ` [[cite:n]]` (citação do chat novo): o widget não tem chip de fonte — vira "[n]".
  const mdHtml = !isUser ? renderMarkdown(String(message.content || '').replace(/[ \t]?\[\[cite:(\d+)\]\]/g, ' [$1]')) : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
      <div
        className={!isUser ? 'chat-md' : ''}
        style={{
          maxWidth: '85%',
          padding: '8px 12px', borderRadius: 8,
          background: isUser ? 'color-mix(in oklab, var(--accent) 10%, transparent)' : 'var(--bg-subtle)',
          border: `1px solid ${isUser ? 'color-mix(in oklab, var(--accent) 25%, transparent)' : 'var(--border-soft)'}`,
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
              fontFamily: 'var(--f-mono)', fontSize: 10,
              padding: '1px 6px', borderRadius: 'var(--r-sm)',
              background: 'var(--success-bg)', color: 'var(--success)',
              border: '1px solid color-mix(in srgb, var(--success) 20%, transparent)',
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
// Recuperação — vendas trazidas por afiliados de recuperação (SMS/email)
// + comissão devida. A "recuperação" é uma FONTE (o afiliado), não um
// estágio de funil. Sem split SMS/email ainda (falta sinal no dado).
// ═══════════════════════════════════════════════════════════════════

// Cartão de número compacto (Recuperação e Call Center).
function CopyKpi({ label, value, sub, tone }) {
  const color = tone === 'danger' ? 'var(--danger)' : tone === 'ok' ? 'var(--success)' : 'var(--fg1)';
  return (
    <div className="panel" style={{ padding: '12px 14px' }}>
      <div className="eyebrow" style={{ fontSize: 10 }}>{label}</div>
      <div style={{ fontFamily: 'var(--f-mono)', fontSize: 24, fontWeight: 600, color, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--fg5)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// AOV diário com linha de target — NSTimeSeries com refLine.

// Estilos de campo dos formulários da Recuperação.
const coInputStyle = {
  width: '100%', padding: '8px 10px',
  background: 'var(--bg)', border: '1px solid var(--border)',
  borderRadius: 6, color: 'var(--fg1)', fontFamily: 'var(--f-mono)', fontSize: 13, outline: 'none',
};
const coFieldLabel = { display: 'grid', gap: 4, fontSize: 11, color: 'var(--fg3)' };

function RecoveryManage({ affs, onChanged }) {
  const [ext, setExt] = useState('');
  const [plat, setPlat] = useState('digistore24');
  const [pct, setPct] = useState(25);
  const [empresa, setEmpresa] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  // Conta que a plataforma ainda não conhece (parceria fechada, tráfego não
  // começou). Em vez de cadastrar às cegas, o erro vira uma oferta: o botão
  // só aparece depois que o dash confirmou que o ID não existe.
  const [semVenda, setSemVenda] = useState(null);

  // Empresas já cadastradas — datalist pra atrelar conta nova sem redigitar
  // (e sem criar "MailX" e "Mailx" como se fossem duas).
  const empresas = Array.from(new Set((affs || []).map((a) => (a.note || '').trim()).filter(Boolean))).sort();

  async function add(criarSemVenda) {
    if (!ext.trim()) { setMsg('Informe o ID do afiliado.'); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await window.NSApi.addRecoveryAffiliate({
        affiliateExternalId: ext.trim(),
        platformSlug: plat,
        commissionPct: Number(pct),
        note: empresa.trim() || null,
        nickname: empresa.trim() || null,
        createIfMissing: criarSemVenda === true,
      });
      // BuyGoods: o servidor resolve link/ID@loja na conta — mostra qual ficou.
      const conta = r && r.affiliateExternalId ? ` (${r.affiliateExternalId})` : '';
      setExt(''); setSemVenda(null);
      setMsg(criarSemVenda ? `Conta pré-cadastrada${conta} — a marca vale da primeira venda em diante.` : `Afiliado marcado${conta}.`);
      onChanged();
    } catch (e) {
      const erro = e.message || 'falha';
      // 404 do serviço: o ID não existe nessa plataforma ainda.
      if (/não encontrado/i.test(erro)) {
        setSemVenda({ ext: ext.trim(), plat });
        setMsg(`Esse ID ainda não vendeu nada em ${plat}. Confira se está certo — ou cadastre mesmo assim, se o parceiro ainda vai começar.`);
      } else {
        setSemVenda(null);
        setMsg('Erro: ' + erro);
      }
    }
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
        <label style={coFieldLabel}><span>{plat === 'buygoods' ? 'Link do checkout ou ID@loja' : 'ID do afiliado'}</span><input value={ext} onChange={(e) => {
          const v = e.target.value;
          setExt(v); setSemVenda(null);
          // Link de checkout colado: a plataforma é BuyGoods.
          if (/buygoods\.com|[?&]aff_id=/i.test(v)) setPlat('buygoods');
        }} placeholder={plat === 'buygoods' ? 'https://buygoods.com/secure/checkout.html?…  ou  62@13457' : '3722234'} style={{ ...coInputStyle, width: plat === 'buygoods' ? 320 : 150 }}/></label>
        <label style={coFieldLabel}><span>Empresa</span>
          <input value={empresa} onChange={(e) => setEmpresa(e.target.value)} list="ns-empresas-recuperacao" placeholder="MailX" style={{ ...coInputStyle, width: 160 }}/>
          <datalist id="ns-empresas-recuperacao">{empresas.map((n) => <option key={n} value={n}/>)}</datalist>
        </label>
        <label style={coFieldLabel}><span>Plataforma</span>
          <select value={plat} onChange={(e) => setPlat(e.target.value)} style={{ ...coInputStyle, width: 150 }}>
            <option value="digistore24">Digistore24</option>
            <option value="clickbank">ClickBank</option>
            <option value="buygoods">BuyGoods</option>
            <option value="cartpanda">Cartpanda</option>
            <option value="jvzoo">JVZoo</option>
          </select>
        </label>
        <label style={coFieldLabel}><span>Comissão %</span><input type="number" min={0} max={100} value={pct} onChange={(e) => setPct(e.target.value)} style={{ ...coInputStyle, width: 100 }}/></label>
        <button className="btn btn-primary" onClick={() => add(false)} disabled={busy}>{busy ? '…' : 'Marcar'}</button>
        {semVenda && semVenda.ext === ext.trim() && semVenda.plat === plat && (
          <button className="btn btn-ghost" onClick={() => add(true)} disabled={busy} title="Cria a conta agora; a marca vale da primeira venda em diante">
            Cadastrar mesmo assim
          </button>
        )}
      </div>
      <div style={{ marginTop: 6, fontSize: 10, color: 'var(--fg5)' }}>
        A <strong>empresa</strong> é o que agrupa as contas: a mesma parceira pode ter um ID por plataforma, e a aba
        soma tudo numa linha só. Uma parceira com vários IDs? Marque um por vez com a mesma empresa.
      </div>
      <div style={{ marginTop: 6, fontSize: 10, color: 'var(--fg5)' }}>
        <strong>BuyGoods</strong> numera o afiliado <strong>por loja</strong>: o 62 de uma loja é outra pessoa na loja ao lado.
        Cole o link do checkout do parceiro (ele traz o aff_id e o account_id) — a conta fica como <span className="cell-mono">ID@loja</span>.
      </div>
      <div style={{ marginTop: 8, fontSize: 10, color: 'var(--fg5)' }}>
        Pra alterar a % de quem já está marcado, re-marque com a nova % — as vendas antigas continuam
        registradas com a taxa antiga e um novo contador começa com a nova.
      </div>
      {msg && <div style={{ fontSize: 11, color: 'var(--fg3)', marginTop: 6 }}>{msg}</div>}
      <Paginated items={affs} label="afiliados">
        {(pageRows, pager) => (<>
          <div style={{ marginTop: 12 }}>
            {affs.length === 0 && <div style={{ fontSize: 11, color: 'var(--fg5)' }}>Nenhum afiliado marcado ainda.</div>}
            {pageRows.map((a) => {
              const history = (a.ratePeriods || []).filter((p) => p.effectiveTo != null);
              return (
                <div key={a.id} style={{ padding: '7px 0', borderTop: '1px solid var(--border-soft)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="cell-mono" style={{ fontSize: 12 }}>{a.nickname || a.affiliateExternalId}<span style={{ color: 'var(--fg5)' }}> · {a.affiliateExternalId} · {a.platformSlug} · </span>{a.enabled === false
                      ? <span style={{ color: 'var(--warning)' }}>{(a.commissionPct * 100).toFixed(0)}% · desativada</span>
                      : <span style={{ color: 'var(--glow-cyan)' }}>{(a.commissionPct * 100).toFixed(0)}% vigente</span>}</span>
                    <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={() => remove(a.id, a.nickname || a.affiliateExternalId)} title="Remover"><Icon name="trash-2" size={12}/></button>
                  </div>
                  {a.note && (
                    <div className="cell-mono" style={{ fontSize: 10, color: 'var(--fg4)', marginTop: 2 }}>empresa: {a.note}</div>
                  )}
                  {a.enabled === false && (
                    <div style={{ fontSize: 10, color: 'var(--warning)', marginTop: 2 }}>
                      Desativada — não entra na Recuperação nem no Lucro real. {a.platformSlug === 'buygoods'
                        ? 'A conta misturava lojas da BuyGoods; marque de novo com o link do checkout certo.'
                        : 'Marque de novo pra reativar.'}
                    </div>
                  )}
                  {a.storeless && (
                    <div style={{ fontSize: 10, color: 'var(--warning)', marginTop: 2 }}>
                      Sem loja — esta conta BuyGoods não recebe mais vendas (o ID é por loja). Remova e marque de novo com o link do checkout.
                    </div>
                  )}
                  {history.length > 0 && (
                    <div className="cell-mono" style={{ fontSize: 10, color: 'var(--fg5)', marginTop: 2 }}>
                      histórico: {history.map((p) => `${(p.commissionPct * 100).toFixed(0)}% até ${fmtDateShort(p.effectiveTo)}`).join(' · ')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {pager}
        </>)}
      </Paginated>
    </div>
  );
}

function RecoveryPage({ filters }) {
  const [data, setData] = useState({ status: 'loading', m: null, err: null });
  // Empresas abertas no acordeão (o detalhe por conta).
  const [openCo, setOpenCo] = useState(() => new Set());
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
  }, [filters.dateRange.start.getTime(), filters.dateRange.end.getTime(), refresh, Array.from(filters.affiliates || []).join(',')]);

  function reload() { setRefresh((n) => n + 1); }
  const m = data.m;

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">Afiliados · Recuperação</span>
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
          <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: 12 }}>
            <CopyKpi label="Vendas recuperadas" value={fmtInt(m.kpis.sales)}/>
            <CopyKpi label="Receita" value={fmtCurrency(m.kpis.grossUsd, 'USD', 2)}/>
            <CopyKpi label="Comissão devida" value={fmtCurrency(m.kpis.commissionUsd, 'USD', 2)} tone="danger"/>
            <CopyKpi label="Líquido (pós-comissão)" value={fmtCurrency(m.kpis.netUsd, 'USD', 2)} tone="ok"/>
          </div>

          <div className="panel" style={{ padding: 0 }}>
            <div className="panel-head" style={{ padding: '12px 14px 0' }}>
              <div className="panel-title">Por empresa</div>
              <div className="panel-sub">clique pra ver as contas</div>
            </div>
            <Paginated items={m.byCompany || []} label="empresas" resetKey={`${filters.dateRange.start.getTime()}|${filters.dateRange.end.getTime()}`}>
              {(pageRows, pager) => (<>
                <div className="tbl-wrap" style={{ margin: 0, padding: '0 4px' }}>
                  <table className="tbl">
                    <thead><tr><th>Empresa</th><th className="num">% comissão</th><th className="num">Vendas</th><th className="num">Receita</th><th className="num">Comissão devida</th></tr></thead>
                    <tbody>
                      {data.status === 'loading' && <SkelTableRows rows={5} cols={5}/>}
                      {data.status === 'ready' && (m.byCompany || []).length === 0 && (
                        <tr><td colSpan={5} style={{ textAlign: 'center', padding: 20, opacity: 0.6 }}>
                          Nenhuma venda de recuperação no período.{affs.length === 0 ? ' Marque um afiliado em "Gerenciar afiliados".' : ''}
                        </td></tr>
                      )}
                      {pageRows.map((c) => {
                        const aberta = openCo.has(c.company);
                        // byCompany.accounts NÃO traz `periods` (lib/services/recovery.ts):
                        // o histórico de taxa vem de m.byAffiliate, casado por ID + plataforma
                        // (o mesmo ID pode existir em duas plataformas).
                        const fullOf = (a) => (m.byAffiliate || []).find((x) => x.affiliateExternalId === a.affiliateExternalId && (x.platformSlug || null) === (a.platformSlug || null)) || a;
                        // Uma conta só e sem histórico de taxa: não há o que abrir.
                        const temDetalhe = c.accounts.length > 1 || (c.accounts[0] ? (fullOf(c.accounts[0]).periods || []).length > 1 : false);
                        return (
                          <React.Fragment key={c.company}>
                            <tr
                              tabIndex={temDetalhe ? 0 : undefined}
                              aria-expanded={temDetalhe ? aberta : undefined}
                              onClick={() => temDetalhe && setOpenCo((prev) => { const n = new Set(prev); if (n.has(c.company)) n.delete(c.company); else n.add(c.company); return n; })}
                              style={{ cursor: temDetalhe ? 'pointer' : 'default' }}
                            >
                              <td style={{ fontWeight: 600 }}>
                                {temDetalhe && (
                                  <span style={{ display: 'inline-block', transform: aberta ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}>
                                    <Icon name="chevron-right" size={11}/>
                                  </span>
                                )}
                                <span style={{ marginLeft: temDetalhe ? 6 : 17 }}>{c.company}</span>
                                <span style={{ color: 'var(--fg5)', marginLeft: 8, fontSize: 10 }}>
                                  {c.accounts.length === 1 ? c.accounts[0].platformSlug : `${c.accounts.length} contas`}
                                </span>
                              </td>
                              <td className="num cell-mono">{(c.effectivePct * 100).toFixed(0)}%</td>
                              <td className="num">{fmtInt(c.sales)}</td>
                              <td className="num">{fmtCurrency(c.grossUsd, 'USD', 2)}</td>
                              <td className="num" style={{ color: 'var(--money)' }}>{fmtCurrency(c.commissionUsd, 'USD', 2)}</td>
                            </tr>

                            {aberta && c.accounts.map((a) => {
                              const full = fullOf(a);
                              const periodos = full.periods || [];
                              const multi = periodos.length > 1;
                              return (
                                <React.Fragment key={`${c.company}-${a.platformSlug}-${a.affiliateExternalId}`}>
                                  <tr style={{ background: 'color-mix(in oklab, var(--accent) 4%, transparent)' }}>
                                    <td className="cell-mono" style={{ paddingLeft: 26, fontSize: 11 }}>
                                      {a.nickname || a.affiliateExternalId}
                                      <span style={{ color: 'var(--fg5)', marginLeft: 6, fontSize: 10 }}>{a.affiliateExternalId} · {a.platformSlug}</span>
                                    </td>
                                    <td className="num cell-mono" style={{ fontSize: 11 }}>
                                      {(a.commissionPct * 100).toFixed(0)}%
                                      {multi && <span style={{ color: 'var(--warning)', marginLeft: 4 }} title="A % mudou dentro do período — contadores por taxa abaixo">*</span>}
                                    </td>
                                    <td className="num" style={{ fontSize: 11 }}>{fmtInt(a.sales)}</td>
                                    <td className="num" style={{ fontSize: 11 }}>{fmtCurrency(a.grossUsd, 'USD', 2)}</td>
                                    <td className="num" style={{ fontSize: 11, color: 'var(--money)' }}>{fmtCurrency(a.commissionUsd, 'USD', 2)}</td>
                                  </tr>
                                  {/* Contadores por período de taxa: venda feita com a % antiga
                                      fica no contador antigo; a % nova acumula no novo. */}
                                  {multi && periodos.map((p, i) => {
                                    const vigente = p.effectiveTo == null;
                                    const label = vigente
                                      ? `desde ${p.effectiveFrom ? fmtDateShort(p.effectiveFrom) : 'sempre'} · vigente`
                                      : p.effectiveFrom
                                        ? `${fmtDateShort(p.effectiveFrom)} → ${fmtDateShort(p.effectiveTo)}`
                                        : `até ${fmtDateShort(p.effectiveTo)}`;
                                    return (
                                      <tr key={`${a.affiliateExternalId}-p${i}`}>
                                        <td className="cell-mono" style={{ paddingLeft: 46, fontSize: 10, color: vigente ? 'var(--fg3)' : 'var(--fg5)' }}>{label}</td>
                                        <td className="num cell-mono" style={{ fontSize: 10, color: vigente ? 'var(--glow-cyan)' : 'var(--fg5)' }}>{(p.commissionPct * 100).toFixed(0)}%</td>
                                        <td className="num" style={{ fontSize: 10, color: 'var(--fg4)' }}>{fmtInt(p.sales)}</td>
                                        <td className="num" style={{ fontSize: 10, color: 'var(--fg4)' }}>{fmtCurrency(p.grossUsd, 'USD', 2)}</td>
                                        <td className="num" style={{ fontSize: 10, color: vigente ? 'var(--money)' : 'var(--fg4)' }}>{fmtCurrency(p.commissionUsd, 'USD', 2)}</td>
                                      </tr>
                                    );
                                  })}
                                </React.Fragment>
                              );
                            })}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {pager}
              </>)}
            </Paginated>
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
  const up = String(status || '').toUpperCase();
  if (up === 'CHARGEBACK') return { bg: 'var(--danger-bg)', fg: 'var(--danger)', border: 'color-mix(in srgb, var(--danger) 45%, transparent)' };
  if (up === 'PENDING' || up === 'PROCESSING') return { bg: 'var(--warning-bg)', fg: 'var(--warning)', border: 'color-mix(in srgb, var(--warning) 40%, transparent)' };
  const s = String(status || '').toUpperCase();
  if (s === 'HOLD') return { bg: 'color-mix(in oklab, var(--warning) 12%, transparent)', fg: 'var(--warning)', border: 'color-mix(in oklab, var(--warning) 35%, transparent)' };
  if (s === 'SHIPPED' || s === 'FULFILLED' || s === 'DELIVERED') {
    return { bg: 'var(--success-bg)', fg: 'var(--success)', border: 'color-mix(in srgb, var(--success) 40%, transparent)' };
  }
  if (s === 'CANCELED' || s === 'CANCELLED' || s === 'REFUNDED') {
    return { bg: 'color-mix(in oklab, var(--danger) 12%, transparent)', fg: 'var(--danger)', border: 'color-mix(in oklab, var(--danger) 35%, transparent)' };
  }
  return { bg: 'color-mix(in oklab, var(--accent) 12%, transparent)', fg: 'var(--accent)', border: 'color-mix(in oklab, var(--accent) 35%, transparent)' };
}

function TaukStatusBadge({ status }) {
  const st = taukStatusStyle(status);
  // (CHARGEBACK/PENDING/PROCESSING entraram com a Logicall — taukStatusStyle
  // abaixo já os conhece; este wrapper só renderiza.)
  return (
    <span style={{
      fontFamily: 'var(--f-mono)', fontSize: 9.5, fontWeight: 600,
      padding: '2px 8px', borderRadius: 'var(--r-full)',
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

// Aba "Call Center" — vendas recuperadas por PARCEIROS de telefone/SMS:
// Tauk (webhook via n8n, desde 2026-07) e Logicall (polling da API deles,
// desde 2026-08-22). Substitui a TaukPage. Endpoint e id da tab seguem
// 'tauk' (permissões dos usuários apontam pra ele).
const CC_PROVIDER_META = {
  tauk:       { label: 'Tauk',       color: 'var(--chart-1)' },
  logicall:   { label: 'Logicall',   color: 'var(--chart-3)' },
  salesbound: { label: 'SalesBound', color: 'var(--chart-2)' },
};

function CcProviderBadge({ provider }) {
  const m = CC_PROVIDER_META[provider] || { label: provider, color: 'var(--fg4)' };
  return (
    <span style={{
      fontFamily: 'var(--f-mono)', fontSize: 9.5, fontWeight: 700,
      padding: '2px 7px', borderRadius: 'var(--r-full)',
      color: m.color, border: `1px solid color-mix(in oklab, ${m.color} 40%, transparent)`,
      background: `color-mix(in oklab, ${m.color} 10%, transparent)`, whiteSpace: 'nowrap',
    }}>{m.label}</span>
  );
}

function CallCenterPage({ filters, user }) {
  const [provider, setProvider] = useState('all');
  const [data, setData] = useState({ status: 'loading', m: null, err: null });
  const [refresh, setRefresh] = useState(0);
  const isAdmin = user?.role === 'ADMIN';

  useEffect(() => {
    let cancelled = false;
    setData((d) => ({ ...d, status: 'loading' }));
    window.NSApi.fetchTauk(filters, provider)
      .then((m) => { if (!cancelled) setData({ status: 'ready', m, err: null }); })
      .catch((err) => { if (!cancelled) setData({ status: 'error', m: null, err: err.message || 'erro' }); });
    return () => { cancelled = true; };
  }, [filters.dateRange.start.getTime(), filters.dateRange.end.getTime(), refresh, provider]);

  const m = data.m;
  // KPIs do recorte: totais quando "Todos", senão o parceiro selecionado.
  const k = m ? (provider === 'all' ? m.totals : (m.providers.find((p) => p.provider === provider) || m.totals)) : null;
  const sync = m?.logicallSync;
  // Reset da paginação: parceiro + período. "Vendas recentes" tem teto de 80 no
  // servidor — com o tamanho fixo, o reset por tamanho do usePaged nunca dispara.
  const pageResetKey = provider + '|' + filters.dateRange.start.getTime() + '|' + filters.dateRange.end.getTime();

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">Captação · Call Center</span>
          <h2>Call Center <em>· Tauk + Logicall + SalesBound</em></h2>
          <span className="sub">
            Vendas por telefone dos parceiros. Tauk chega por webhook; Logicall é puxada da API deles a cada 30 min; SalesBound (cross-sell) chega por webhook do CRM deles, com reembolso e void vindo do export. Respeita o filtro de período.
          </span>
        </div>
        <div className="page-head-actions" style={{ flexWrap: 'wrap' }}>
          <div className="seg">
            {[['all', 'Todos'], ['tauk', 'Tauk'], ['logicall', 'Logicall'], ['salesbound', 'SalesBound']].map(([kk, l]) => (
              <button key={kk} className={provider === kk ? 'is-active' : ''} onClick={() => setProvider(kk)}>{l}</button>
            ))}
          </div>
          <button className="btn btn-ghost" onClick={() => setRefresh((n) => n + 1)}><Icon name="refresh" size={12}/> Recarregar</button>
        </div>
      </div>

      {data.status === 'error' && <div className="panel" style={{ color: 'var(--danger)', marginBottom: 12 }}>Erro: {data.err}</div>}

      {/* Painel admin fica FORA do bloco de dados: se a integração derrubar o
          GET (migration, API fora), o admin ainda vê status e consegue agir. */}
      {isAdmin && <LogicallIntegrationPanel sync={sync} onChanged={() => setRefresh((n) => n + 1)}/>}

      {data.status === 'loading' && !m && (
        <>
          <SkelMiniKpis n={4}/>
          <div style={{ marginTop: 12 }}><SkelChartPanel i={1}/></div>
          <div style={{ marginTop: 12 }}><SkelTablePanel rows={6} cols={5} i={2}/></div>
        </>
      )}

      {m && k && (
        <div style={{ opacity: data.status === 'loading' ? 0.45 : 1, transition: 'opacity .15s' }}>
          <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: 12 }}>
            <CopyKpi label="Vendas recuperadas" value={fmtInt(k.sales)} sub={k.refundedCount > 0 ? `${fmtInt(k.approved)} sem estorno` : undefined}/>
            <CopyKpi label="Receita" value={fmtCurrency(k.grossUsd, 'USD', 2)}/>
            <CopyKpi label="Ticket médio" value={fmtCurrency(k.aovUsd, 'USD', 2)}/>
            <CopyKpi
              label={`Comissão (${Math.round((k.commissionPct || 0) * 100)}%)${k.commissionAssumed ? ' · assumida' : ''}`}
              value={fmtCurrency(k.commissionUsd || 0, 'USD', 2)} tone="danger"
              sub={k.commissionAssumed ? 'parceiro sem % configurada — usando o padrão' : undefined}/>
            <CopyKpi label="Líquido (pós-comissão)" value={fmtCurrency(k.netUsd || 0, 'USD', 2)} tone="ok"/>
            <CopyKpi label="Pendentes (HOLD/PENDING)" value={fmtInt(k.pendingCount)} tone={k.pendingCount > 0 ? 'danger' : undefined}/>
            <CopyKpi label="Estornos" value={fmtInt(k.refundedCount)} sub={k.refundedCount > 0 ? fmtCurrency(k.refundedUsd, 'USD', 0) : 'a Tauk não reporta'}/>
          </div>

          {/* Por parceiro — sempre os dois, mesmo com filtro, pra comparar. */}
          <div className="panel" style={{ padding: 0, marginBottom: 12 }}>
            <div className="panel-head" style={{ padding: '12px 14px 0' }}>
              <div className="panel-title">Por parceiro</div>
            </div>
            <div className="tbl-wrap" style={{ margin: 0, padding: '0 4px' }}>
              <table className="tbl">
                <thead><tr>
                  <th>Parceiro</th><th className="num">Vendas</th><th className="num">Receita</th><th className="num">Ticket</th>
                  <th className="num">Comissão</th><th className="num">Líquido</th><th className="num">Pendentes</th><th className="num">Estornos</th><th>Integração</th>
                </tr></thead>
                <tbody>
                  {m.providers.map((p) => {
                    const cov = m.salesbound?.coverage;
                    const integ = p.provider === 'tauk'
                      ? { ok: true, text: 'webhook via n8n' }
                      : p.provider === 'salesbound'
                      ? (!cov ? { ok: false, text: 'nenhum dado importado' }
                        : { ok: (cov.webhookCount || 0) > 0,
                            text: ((cov.webhookCount || 0) > 0 ? 'webhook: ' + fmtInt(cov.webhookCount) + ' vendas' : 'webhook sem evento')
                              + ' · export até ' + (cov.csvLastAt ? cov.csvLastAt.slice(8, 10) + '/' + cov.csvLastAt.slice(5, 7) : '—') })
                      : !sync?.configured ? { ok: false, text: 'chave não configurada' }
                      : sync.running ? { ok: true, text: 'sincronizando agora…' }
                      : sync.lastOk === false ? { ok: false, text: `última sync falhou: ${sync.lastError || '?'}` }
                      : sync.lastRunAt ? { ok: true, text: `sync ${fmtTaukWhen(sync.lastRunAt)}` }
                      : { ok: false, text: 'aguardando 1ª sync' };
                    return (
                      <tr key={p.provider} style={{ opacity: provider !== 'all' && provider !== p.provider ? 0.55 : 1 }}>
                        <td><CcProviderBadge provider={p.provider}/></td>
                        <td className="num cell-mono">{fmtInt(p.sales)}</td>
                        <td className="num cell-mono" style={{ color: 'var(--money)' }}>{fmtCurrency(p.grossUsd, 'USD', 0)}</td>
                        <td className="num cell-mono">{p.aovUsd ? fmtCurrency(p.aovUsd, 'USD', 0) : '—'}</td>
                        <td className="num cell-mono" title={p.commissionAssumed ? 'comissão ASSUMIDA (não configurada)' : `fonte: acordo configurado`}>
                          {Math.round(p.commissionPct * 100)}%{p.commissionAssumed ? '?' : ''} · {fmtCurrency(p.commissionUsd, 'USD', 0)}
                        </td>
                        <td className="num cell-mono">{fmtCurrency(p.netUsd, 'USD', 0)}</td>
                        <td className="num cell-mono" style={{ color: p.pendingCount > 0 ? 'var(--warning)' : undefined }}>{fmtInt(p.pendingCount)}</td>
                        <td className="num cell-mono">{p.refundedCount ? `${fmtInt(p.refundedCount)} · ${fmtCurrency(p.refundedUsd, 'USD', 0)}` : '—'}</td>
                        <td style={{ fontSize: 11, color: integ.ok ? 'var(--fg4)' : 'var(--danger)' }}>{integ.text}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {m.daily.length > 0 && (
            <div className="panel" style={{ marginBottom: 12 }}>
              <div className="panel-head">
                <div className="panel-title">
                  <span className="panel-eyebrow">Receita recuperada · por dia · por parceiro</span>
                  <div className="panel-metric" style={{ fontSize: 14, color: 'var(--fg3)' }}>
                    {m.daily.length} {m.daily.length === 1 ? 'dia' : 'dias'} com venda no período
                  </div>
                </div>
              </div>
              <NSTimeSeries height={220} currency="USD"
                data={m.daily.map((d) => ({ date: d.date, tauk: d.tauk, logicall: d.logicall, salesbound: d.salesbound }))}
                series={[
                  { key: 'tauk', label: 'Tauk', color: CC_PROVIDER_META.tauk.color },
                  { key: 'logicall', label: 'Logicall', color: CC_PROVIDER_META.logicall.color },
                  { key: 'salesbound', label: 'SalesBound', color: CC_PROVIDER_META.salesbound.color },
                ]}/>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, alignItems: 'start', marginBottom: 12 }}>
            {/* Agentes — só a Logicall informa. IA × humano é a leitura que interessa. */}
            <div className="panel" style={{ padding: 0 }}>
              <div className="panel-head" style={{ padding: '12px 14px 0' }}>
                <div className="panel-title">Por agente <span style={{ color: 'var(--fg5)', fontSize: 10, marginLeft: 6 }}>Logicall (IA × humano) + SalesBound</span></div>
              </div>
              <Paginated items={m.byAgent} label="agentes" resetKey={pageResetKey}>
                {(pageRows, pager, pg) => (<>
                  <div key={pg.page + ':' + pg.pageSize} className="tbl-wrap" style={{ margin: 0, padding: '0 4px', maxHeight: 320, overflowY: 'auto' }}>
                    <table className="tbl">
                      <thead><tr><th>Agente</th><th className="num">Vendas</th><th className="num">Receita</th><th className="num">Ticket</th></tr></thead>
                      <tbody>
                        {m.byAgent.length === 0 && (
                          <tr><td colSpan={4} style={{ textAlign: 'center', padding: 16, opacity: 0.6 }}>Sem dado de agente no período (a Tauk não informa).</td></tr>
                        )}
                        {pageRows.map((a) => (
                          <tr key={a.agent}>
                            <td className="cell-mono" style={{ fontSize: 11 }}>
                              {a.agent}
                              {a.isAi && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: 'var(--accent)' }}>IA</span>}
                            </td>
                            <td className="num">{fmtInt(a.sales)}</td>
                            <td className="num" style={{ color: 'var(--money)' }}>{fmtCurrency(a.grossUsd, 'USD', 0)}</td>
                            <td className="num">{fmtCurrency(a.aovUsd, 'USD', 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {pager}
                </>)}
              </Paginated>
            </div>

            <div className="panel" style={{ padding: 0 }}>
              <div className="panel-head" style={{ padding: '12px 14px 0' }}>
                <div className="panel-title">Por produto <span style={{ color: 'var(--fg5)', fontSize: 10, marginLeft: 6 }}>Logicall + SalesBound</span></div>
              </div>
              <Paginated items={m.byProduct} label="produtos" resetKey={pageResetKey}>
                {(pageRows, pager, pg) => (<>
                  <div key={pg.page + ':' + pg.pageSize} className="tbl-wrap" style={{ margin: 0, padding: '0 4px', maxHeight: 320, overflowY: 'auto' }}>
                    <table className="tbl">
                      <thead><tr><th>Produto</th><th className="num">Vendas</th><th className="num">Receita</th></tr></thead>
                      <tbody>
                        {m.byProduct.length === 0 && (
                          <tr><td colSpan={3} style={{ textAlign: 'center', padding: 16, opacity: 0.6 }}>Sem dado de produto no período (a Tauk não informa).</td></tr>
                        )}
                        {pageRows.map((p) => (
                          <tr key={p.product}>
                            <td>{p.product}{p.family && <span style={{ color: 'var(--fg5)', fontSize: 10, marginLeft: 6 }}>{p.family}</span>}</td>
                            <td className="num">{fmtInt(p.sales)}</td>
                            <td className="num" style={{ color: 'var(--money)' }}>{fmtCurrency(p.grossUsd, 'USD', 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {pager}
                </>)}
              </Paginated>
            </div>

            {m.bySourcePlatform?.length > 0 && (
              <div className="panel" style={{ padding: 0 }}>
                <div className="panel-head" style={{ padding: '12px 14px 0' }}>
                  <div className="panel-title">Origem do cliente <span style={{ color: 'var(--fg5)', fontSize: 10, marginLeft: 6 }}>SalesBound · onde ele comprou antes</span></div>
                </div>
                <div className="tbl-wrap" style={{ margin: 0, padding: '0 4px', maxHeight: 320, overflowY: 'auto' }}>
                  <table className="tbl">
                    <thead><tr><th>Plataforma</th><th className="num">Vendas</th><th className="num">Receita</th></tr></thead>
                    <tbody>
                      {m.bySourcePlatform.map((b) => (
                        <tr key={b.platform}>
                          <td>{b.platform === 'sem origem'
                            ? <span style={{ color: 'var(--fg5)' }}>sem origem no evento</span>
                            : <span className={`plat ${platBadge(b.platform).cls}`}>{platBadge(b.platform).short}</span>}</td>
                          <td className="num">{fmtInt(b.sales)}</td>
                          <td className="num" style={{ color: 'var(--money)' }}>{fmtCurrency(b.grossUsd, 'USD', 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="panel" style={{ padding: 0 }}>
              <div className="panel-head" style={{ padding: '12px 14px 0' }}>
                <div className="panel-title">Por status de fulfillment <span style={{ color: 'var(--fg5)', fontSize: 10, marginLeft: 6 }}>Tauk + Logicall</span></div>
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
          </div>

          <div className="panel" style={{ padding: 0, marginBottom: 12 }}>
            <div className="panel-head" style={{ padding: '12px 14px 0' }}>
              <div className="panel-title">Vendas recentes <span style={{ color: 'var(--fg5)', fontSize: 10, marginLeft: 6 }}>últimas {m.recent.length} do período · horário BRT</span></div>
            </div>
            <Paginated items={m.recent} label="vendas" resetKey={pageResetKey}>
              {(pageRows, pager, pg) => (<>
                <div key={pg.page + ':' + pg.pageSize} className="tbl-wrap" style={{ margin: 0, padding: '0 4px', maxHeight: 460, overflowY: 'auto' }}>
                  <table className="tbl">
                    <thead><tr><th>Quando</th><th>Parceiro</th><th>Cliente</th><th>Produto</th><th>Agente</th><th className="num">Valor</th><th>Status</th></tr></thead>
                    <tbody>
                      {m.recent.length === 0 && (
                        <tr><td colSpan={7} style={{ textAlign: 'center', padding: 16, opacity: 0.6 }}>Nenhuma venda de call center no período.</td></tr>
                      )}
                      {pageRows.map((r) => (
                        <tr key={r.id} style={{ opacity: r.status === 'APPROVED' ? 1 : 0.6 }}>
                          <td className="cell-mono" style={{ fontSize: 11 }}>{fmtTaukWhen(r.purchasedAt)}</td>
                          <td><CcProviderBadge provider={r.provider}/></td>
                          <td>
                            {r.name}
                            <div className="cell-mono" style={{ fontSize: 10, color: 'var(--fg5)' }}>{r.email || '—'}{r.phone ? ` · ${r.phone}` : ''}</div>
                          </td>
                          <td style={{ fontSize: 11.5 }}>{r.productName || <span style={{ color: 'var(--fg5)' }}>—</span>}</td>
                          <td className="cell-mono" style={{ fontSize: 10.5 }}>{r.agentName || <span style={{ color: 'var(--fg5)' }}>—</span>}</td>
                          <td className="num" style={{ color: r.status === 'APPROVED' ? 'var(--money)' : 'var(--danger)', textDecoration: r.status === 'APPROVED' ? 'none' : 'line-through' }}
                            title={r.placeholder ? 'estorno recebido antes da venda ser sincronizada — a venda entra no próximo backfill' : (r.refundedUsd && r.status === 'APPROVED' ? `refund parcial: −${fmtCurrency(r.refundedUsd, 'USD', 2)}` : undefined)}>
                            {r.placeholder ? '—' : fmtCurrency(r.amountUsd, 'USD', 2)}
                            {r.refundedUsd && r.status === 'APPROVED' ? <span style={{ fontSize: 9.5, color: 'var(--warning)', marginLeft: 4 }}>−{fmtCurrency(r.refundedUsd, 'USD', 0)}</span> : null}
                          </td>
                          <td>
                            {r.status !== 'APPROVED'
                              ? <TaukStatusBadge status={r.status}/>
                              : <TaukStatusBadge status={r.fulfillmentStatus}/>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {pager}
              </>)}
            </Paginated>
          </div>

          <div style={{ marginTop: 10, fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg5)', lineHeight: 1.6 }}>
            Fontes: Tauk = webhook (via n8n), sem produto nem ID de transação; Logicall = API de transações (polling: janela de 3 dias
            a cada 30 min + releitura de 45 dias uma vez por dia, idempotente por ID); SalesBound = webhook do CRM deles (chega em
            minutos, mas NÃO marca tipo de evento — tudo entra como venda) mais o export "Transaction Details", de onde vêm reembolso
            e void; as duas fontes se juntam pelo clientTxnId, sem contar duas vezes. Comissão = receita × % de cada parceiro sobre
            cada venda; líquido = receita − comissão. Estornos (a Tauk não reporta): total tira a venda inteira, parcial abate só o
            valor devolvido — e entram pela DATA DA VENDA (coorte), diferente dos cards de reembolso da Visão Geral (data do
            estorno); na SalesBound, venda anulada (void) conta como estorno total. Números FORA das métricas das plataformas (a
            mesma venda pode transitar pela plataforma principal — separado evita dupla contagem). Horários: Tauk/Logicall e o
            webhook da SalesBound vêm em Eastern, o export da SalesBound em Central; tudo é convertido pra BRT.
          </div>
        </div>
      )}
    </div>
  );
}

// Painel admin: estado da integração Logicall, sync manual/backfill e a
// configuração (chave da API, comissões) — gravada no banco; env sobrescreve.
function LogicallIntegrationPanel({ sync, onChanged }) {
  const [settings, setSettings] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [lcPct, setLcPct] = useState('');
  const [taukPct, setTaukPct] = useState('');
  const [range, setRange] = useState({ start: '', end: '' });
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    let cancelled = false;
    window.NSApi.adminListIntegrationSettings()
      .then((d) => { if (!cancelled) setSettings(d); })
      .catch(() => { if (!cancelled) setSettings({ settings: [], envOverrides: {} }); });
    return () => { cancelled = true; };
  }, []);

  const current = (key) => settings?.settings?.find((s) => s.key === key);
  const envLocked = (key) => Boolean(settings?.envOverrides?.[key]);

  async function save(key, value, clearFn) {
    setBusy(key); setMsg(null);
    try {
      await window.NSApi.adminSaveIntegrationSetting(key, value);
      const d = await window.NSApi.adminListIntegrationSettings();
      setSettings(d); clearFn && clearFn('');
      setMsg({ ok: true, text: value ? 'salvo' : 'apagado' });
      onChanged && onChanged();
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(null); }
  }
  async function runSync(withRange) {
    setBusy('sync'); setMsg(null);
    try {
      const r = await window.NSApi.adminLogicallSync(withRange && range.start && range.end ? range : undefined);
      setMsg({ ok: true, text: `sync ${r.startDate}→${r.endDate}: ${r.fetched} transações · ${r.created} novas · ${r.updated} atualizadas · ${r.reversalsApplied} estornos${r.skipped ? ` · ${r.skipped} ignoradas` : ''}` });
      onChanged && onChanged();
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(null); }
  }

  const inputStyle = {
    padding: '7px 10px', fontSize: 12, color: 'var(--fg1)', background: 'var(--bg)',
    border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'var(--f-mono)', minWidth: 0,
  };
  const row = { display: 'grid', gridTemplateColumns: '180px 1fr auto', gap: 8, alignItems: 'center' };

  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div className="panel-head">
        <div className="panel-title">
          <span className="panel-eyebrow">Integração Logicall · Admin</span>
          <div className="panel-sub">
            {!sync?.configured
              ? 'Chave da API não configurada — a sincronização está desligada.'
              : sync.running
                ? 'Sincronizando agora…'
              : sync.lastRunAt
                ? `Última sync ${fmtTaukWhen(sync.lastRunAt)} · ${sync.lastOk ? 'ok' : `ERRO: ${sync.lastError || '?'}`}${sync.lastStats ? ` · ${sync.lastStats.fetched ?? 0} transações (${sync.lastStats.startDate}→${sync.lastStats.endDate})` : ''}`
                : 'Configurada · aguardando a primeira rodada (até 30 min após o boot).'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" disabled={busy === 'sync'} onClick={() => runSync(false)}>
            <Icon name="refresh" size={12}/> {busy === 'sync' ? 'sincronizando…' : 'Sincronizar agora'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10, padding: '4px 0' }}>
        <div style={row}>
          <span className="f-label">Backfill (datas)</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <input type="date" style={inputStyle} value={range.start} onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))}/>
            <input type="date" style={inputStyle} value={range.end} onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))}/>
          </div>
          <button className="btn btn-ghost" disabled={busy === 'sync' || !range.start || !range.end} onClick={() => runSync(true)}>Puxar intervalo</button>
        </div>

        <div style={row}>
          <span className="f-label">Chave da API</span>
          <input type="password" style={inputStyle} value={apiKey} onChange={(e) => setApiKey(e.target.value)}
            placeholder={envLocked('logicall.apiKey') ? 'definida por env (LOGICALL_API_KEY)' : (current('logicall.apiKey')?.value || 'cole a key da Logicall')}
            disabled={envLocked('logicall.apiKey')}/>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-ghost" disabled={busy != null || !apiKey || envLocked('logicall.apiKey')} onClick={() => save('logicall.apiKey', apiKey, setApiKey)}>Salvar</button>
            {current('logicall.apiKey') && !envLocked('logicall.apiKey') && (
              <button className="btn btn-ghost" disabled={busy != null} title="apagar a chave (desliga a sync)" onClick={() => save('logicall.apiKey', '', setApiKey)}>Limpar</button>
            )}
          </div>
        </div>

        <div style={row}>
          <span className="f-label">Comissão Logicall %</span>
          <input type="number" min="0" max="100" step="0.5" style={inputStyle} value={lcPct} onChange={(e) => setLcPct(e.target.value)}
            placeholder={envLocked('logicall.commissionPct') ? 'definida por env' : (current('logicall.commissionPct')?.value || '35 (assumida)')}
            disabled={envLocked('logicall.commissionPct')}/>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-ghost" disabled={busy != null || !lcPct || envLocked('logicall.commissionPct')} onClick={() => save('logicall.commissionPct', lcPct, setLcPct)}>Salvar</button>
            {current('logicall.commissionPct') && !envLocked('logicall.commissionPct') && (
              <button className="btn btn-ghost" disabled={busy != null} title="voltar ao default (35% assumido)" onClick={() => save('logicall.commissionPct', '', setLcPct)}>Limpar</button>
            )}
          </div>
        </div>

        <div style={row}>
          <span className="f-label">Comissão Tauk %</span>
          <input type="number" min="0" max="100" step="0.5" style={inputStyle} value={taukPct} onChange={(e) => setTaukPct(e.target.value)}
            placeholder={envLocked('tauk.commissionPct') ? 'definida por env (TAUK_COMMISSION_PCT)' : (current('tauk.commissionPct')?.value || '35 (acordo)')}
            disabled={envLocked('tauk.commissionPct')}/>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-ghost" disabled={busy != null || !taukPct || envLocked('tauk.commissionPct')} onClick={() => save('tauk.commissionPct', taukPct, setTaukPct)}>Salvar</button>
            {current('tauk.commissionPct') && !envLocked('tauk.commissionPct') && (
              <button className="btn btn-ghost" disabled={busy != null} title="voltar ao default (35%)" onClick={() => save('tauk.commissionPct', '', setTaukPct)}>Limpar</button>
            )}
          </div>
        </div>

        {msg && <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: msg.ok ? 'var(--success)' : 'var(--danger)' }}>{msg.text}</div>}
        <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg5)', lineHeight: 1.6 }}>
          Comissões aqui são em PERCENTUAL (35 = 35%). A chave e as comissões ficam no banco (IntegrationSetting); variável de
          ambiente de mesmo nome sobrescreve (nela a comissão é fração, ex.: 0.35). A sincronização automática roda no próprio
          servidor: janela de 3 dias a cada 30 min + releitura de 45 dias uma vez por dia (fulfillment e chargeback marcados
          semanas depois). Fuso da Logicall assumido como Eastern (EUA) — se o dia da venda parecer deslocado vs o painel deles, é isso.
        </div>
      </div>
    </div>
  );
}

Object.assign(window, {
  FunnelPage, LeaderboardPage, AffiliateDrawer, AllAffiliatesPage,
  ProductsPage, TransactionsPage, IntegrationsPage, FXPage, UsersPage,
  HealthPage,
  ChatPage, ChatWidget,
  RecoveryPage, CallCenterPage,
});
