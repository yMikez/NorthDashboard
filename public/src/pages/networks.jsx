/* global React, Icon, fmtCurrency, fmtInt, fmtPct, fmtDateShort, fmtDateTime, SkelTableRows, Pager, ReadState, NSTimeSeries, TransactionDrawer */
/* Aba Afiliados › Networks — vendas das REDES de afiliados (NorthAffiliates):
   rede, integrante, CPA devido, repasse, margem e o funil de cada venda.
   Separada dos afiliados individuais (eles não aparecem aqui, e a rede não
   aparece lá). Só o período do filtro global vale; os demais filtros são da aba.
   API: GET /api/metrics/networks · admin: /api/admin/networks-sync */

const { useState: useStateNw, useEffect: useEffectNw } = React;

const NW_STATE = {
  approved:   { label: 'Aprovada',     color: 'var(--success)' },
  held:       { label: 'Retida',       color: 'var(--warning)' },
  refunded:   { label: 'Reembolsada',  color: 'var(--danger)' },
  chargeback: { label: 'Chargeback',   color: 'var(--danger)' },
};
const NW_REASON = {
  awaiting_ipn: 'esperando a IPN de vendedor',
  not_commissionable: 'sem comissão (upsell ou recorrência)',
  unknown_affiliate: 'integrante não identificado (link sem nsid?)',
  affiliate_mismatch: 'integrante de outra rede',
  wrong_mode: 'modo da rede não bate',
  unknown_product: 'produto desconhecido',
  product_not_released: 'produto não liberado pra rede',
  no_cpa: 'produto sem CPA cadastrado',
  sem_motivo: 'sem motivo informado',
};
const NW_COMMISSION = { pending: 'No prazo', available: 'Disponível', paid: 'Paga' };

const nwUsd = (n, d = 0) => (n == null ? '—' : fmtCurrency(n, 'USD', d));
const nwPct = (n) => (n == null ? '—' : fmtPct(n, 1));

function NwChip({ color, children, title }) {
  return (
    <span title={title} style={{
      display: 'inline-block', padding: '1px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600, marginRight: 4,
      color, background: `color-mix(in oklab, ${color} 13%, transparent)`, whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

function NwKpi({ label, value, sub, tone, hint }) {
  return (
    <div className="panel" title={hint || undefined} style={{ padding: '12px 16px', flex: '1 1 170px', minWidth: 160 }}>
      <div className="panel-eyebrow" style={{ fontSize: 10 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: tone || 'var(--fg1)', lineHeight: 1.15, marginTop: 2 }}>{value}</div>
      {sub && <div className="panel-sub" style={{ fontSize: 11, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function NwSelect({ label, value, onChange, options, allLabel = 'Todas' }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10.5, color: 'var(--fg5)', textTransform: 'uppercase', letterSpacing: '0.04em', minWidth: 140, flex: '1 1 150px' }}>
      {label}
      <select value={value || ''} onChange={(e) => onChange(e.target.value || null)} aria-label={label}
        style={{ textTransform: 'none', letterSpacing: 0, fontSize: 12.5 }}>
        <option value="">{allLabel}</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </label>
  );
}

/* "Como ler": o vocabulário da aba em linguagem simples. */
function NetworksHelp() {
  const item = (t, d) => (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--fg1)' }}>{t}</div>
      <div style={{ fontSize: 12, color: 'var(--fg3)', lineHeight: 1.5 }}>{d}</div>
    </div>
  );
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div className="panel-title" style={{ marginBottom: 10 }}>Como ler esta aba</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0 24px' }}>
        <div>
          {item('Rede e integrante', 'Uma rede é um grupo de afiliados (integrantes) com uma conta própria na JVZoo. A NorthScale paga à rede um CPA por venda; o gerente da rede decide quanto disso vai pro integrante — o resto é a margem da rede.')}
          {item('Vendas', 'Vendas atribuídas a uma rede no período (com integrante e CPA), sem as compras-teste. Upsells e recorrências da conta da rede não contam aqui: entram no faturamento do funil.')}
          {item('Faturamento', 'O que entrou de verdade nos pedidos dessas vendas e do funil delas (front + upsells), já sem os estornos — o mesmo critério do resto do dashboard.')}
        </div>
        <div>
          {item('CPA devido', 'O CPA das vendas aprovadas, retidas e das que já foram pagas ao integrante (mesmo que tenham sido estornadas depois). É o que a NorthScale deve às redes.')}
          {item('Repasse e margem', 'Repasse é a parte do CPA que vai pro integrante; "pago" é o que ele já recebeu. Margem é o que fica com a rede. Os valores são os da hora da venda — não são recalculados.')}
          {item('Lucro NS', 'Faturamento menos o CPA devido. Ainda não desconta taxas, produto e frete (isso fica no Lucro real).')}
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--fg5)', marginTop: 4 }}>
        As vendas chegam pelo n8n em tempo real e são conferidas com o NorthAffiliates a cada 15 minutos (reembolso, retenção e pagamento, dos últimos 45 dias, uma vez por dia).
      </div>
    </div>
  );
}

function NwStateCell({ r }) {
  const st = NW_STATE[r.state] || null;
  return (
    <>
      {r.is_test && <NwChip color="var(--fg4)">Teste</NwChip>}
      {r.attribution_status === 'attributed'
        ? (st ? <NwChip color={st.color}>{st.label}</NwChip> : <span style={{ color: 'var(--fg5)' }}>—</span>)
        : r.attribution_status === 'pending'
          ? <NwChip color="var(--warning)" title={NW_REASON[r.attribution_reason] || r.attribution_reason || ''}>Pendente</NwChip>
          : <NwChip color="var(--fg4)" title={NW_REASON[r.attribution_reason] || r.attribution_reason || ''}>Sem atribuição</NwChip>}
      {r.attribution_status !== 'attributed' && r.attribution_reason && (
        <div style={{ fontSize: 10.5, color: 'var(--fg5)', marginTop: 2 }}>{NW_REASON[r.attribution_reason] || r.attribution_reason}</div>
      )}
    </>
  );
}

function NwCommissionCell({ r }) {
  if (!r.commission_status) return <span style={{ color: 'var(--fg5)' }}>—</span>;
  const label = NW_COMMISSION[r.commission_status] || r.commission_status;
  const when = r.commission_status === 'paid' ? r.commission_paid_at : r.commission_status === 'pending' ? r.commission_available_at : null;
  return (
    <div>
      <span style={{ color: r.commission_status === 'paid' ? 'var(--success)' : 'var(--fg2)', fontWeight: r.commission_status === 'paid' ? 600 : 400 }}>{label}</span>
      {when && <div style={{ fontSize: 10.5, color: 'var(--fg5)' }}>{r.commission_status === 'paid' ? 'em ' : 'até '}{fmtDateShort(when)}</div>}
    </div>
  );
}

function NetworkTable({ rows, onOpen, activeId }) {
  return (
    <div className="panel" style={{ padding: 0, overflow: 'hidden', marginBottom: 12 }}>
      <div style={{ padding: '12px 16px 8px' }}>
        <div className="panel-title">Por rede</div>
        <div className="panel-sub" style={{ fontSize: 11 }}>Clique numa rede pra ver só ela (integrantes, vendas e gráfico).</div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl" style={{ fontSize: 12.5, minWidth: 980 }}>
          <thead>
            <tr>
              <th>Rede</th>
              <th className="num">Vendas</th>
              <th className="num" title="Receita líquida dos pedidos das vendas e do funil delas">Faturamento</th>
              <th className="num">Checkouts</th>
              <th className="num" title="Vendas ÷ checkouts iniciados">Conversão</th>
              <th className="num">CPA devido</th>
              <th className="num">Margem da rede</th>
              <th className="num" title="Reembolsos + chargebacks ÷ vendas">Reemb. / CB</th>
              <th className="num" title="Faturamento − CPA devido">Lucro NS</th>
              <th className="num" title="Integrantes com venda no período / integrantes ativos na rede">Integrantes</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={10} style={{ padding: 18, textAlign: 'center', color: 'var(--fg5)' }}>Nenhuma venda de rede neste filtro.</td></tr>}
            {rows.map((n) => (
              <tr key={n.networkId} onClick={() => onOpen(n.networkId)} style={{ cursor: 'pointer', background: activeId === n.networkId ? 'color-mix(in oklab, var(--accent) 7%, transparent)' : undefined }}>
                <td>
                  <div style={{ fontWeight: 600 }}>{n.name}</div>
                  {n.status && n.status !== 'active' && <div style={{ fontSize: 10.5, color: 'var(--warning)' }}>{n.status}</div>}
                </td>
                <td className="num cell-mono">{fmtInt(n.sales)}</td>
                <td className="num cell-mono" style={{ color: 'var(--money)' }}>{nwUsd(n.revenue)}</td>
                <td className="num cell-mono">{fmtInt(n.checkouts)}</td>
                <td className="num cell-mono">{nwPct(n.conversion)}</td>
                <td className="num cell-mono">{nwUsd(n.cpaDue)}</td>
                <td className="num cell-mono">{nwUsd(n.margin)}</td>
                <td className="num cell-mono" style={{ color: (n.refunds + n.chargebacks) > 0 ? 'var(--danger)' : 'var(--fg5)' }}>
                  {n.sales ? nwPct((n.refunds + n.chargebacks) / n.sales) : '—'}
                </td>
                <td className="num cell-mono" style={{ color: n.profit < 0 ? 'var(--danger)' : 'var(--money)', fontWeight: 600 }}>{nwUsd(n.profit)}</td>
                <td className="num cell-mono">{fmtInt(n.membersWithSales)} / {fmtInt(n.membersActive)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MemberTable({ rows, showNetwork, onPick, activeId }) {
  return (
    <div className="panel" style={{ padding: 0, overflow: 'hidden', marginBottom: 12 }}>
      <div style={{ padding: '12px 16px 8px' }}>
        <div className="panel-title">Por integrante</div>
        <div className="panel-sub" style={{ fontSize: 11 }}>Ranking por vendas líquidas (vendas − reembolsos − chargebacks). Clique pra filtrar a aba pelo integrante.</div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl" style={{ fontSize: 12.5, minWidth: 960 }}>
          <thead>
            <tr>
              <th>Integrante</th>
              {showNetwork && <th>Rede</th>}
              <th className="num" title="Vendas − reembolsos − chargebacks">Vendas líq.</th>
              <th className="num">Vendas</th>
              <th className="num">Checkouts</th>
              <th className="num">Conversão</th>
              <th className="num">Faturamento</th>
              <th className="num" title="Repasse devido ao integrante que ainda não foi pago">A receber</th>
              <th className="num" title="Repasse já pago ao integrante">Pago</th>
              <th className="num">Reemb. / CB</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={showNetwork ? 10 : 9} style={{ padding: 18, textAlign: 'center', color: 'var(--fg5)' }}>Nenhum integrante com venda ou checkout neste filtro.</td></tr>}
            {rows.map((m) => (
              <tr key={`${m.networkId}|${m.memberId || ''}`} onClick={m.memberId ? () => onPick(m) : undefined}
                style={{ cursor: m.memberId ? 'pointer' : 'default', background: activeId && activeId === m.memberId ? 'color-mix(in oklab, var(--accent) 7%, transparent)' : undefined }}>
                <td>
                  <div style={{ fontWeight: 600, color: m.memberId ? 'var(--fg1)' : 'var(--fg4)' }}>{m.name}</div>
                  <div className="cell-mono" style={{ fontSize: 10.5, color: 'var(--fg5)' }}>
                    {m.memberId ? (m.publicId || '—') : 'checkouts sem integrante identificado'}
                    {m.status && m.status !== 'active' ? ` · ${m.status}` : ''}
                  </div>
                </td>
                {showNetwork && <td>{m.networkName}</td>}
                <td className="num cell-mono" style={{ fontWeight: 600 }}>{fmtInt(m.netSales)}</td>
                <td className="num cell-mono">{fmtInt(m.sales)}</td>
                <td className="num cell-mono">{fmtInt(m.checkouts)}</td>
                <td className="num cell-mono">{nwPct(m.conversion)}</td>
                <td className="num cell-mono" style={{ color: 'var(--money)' }}>{nwUsd(m.revenue)}</td>
                <td className="num cell-mono">{nwUsd(Math.max(0, m.memberDue - m.memberPaid))}</td>
                <td className="num cell-mono" style={{ color: m.memberPaid > 0 ? 'var(--success)' : 'var(--fg5)' }}>{nwUsd(m.memberPaid)}</td>
                <td className="num cell-mono" style={{ color: (m.refunds + m.chargebacks) > 0 ? 'var(--danger)' : 'var(--fg5)' }}>
                  {m.sales ? nwPct((m.refunds + m.chargebacks) / m.sales) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NetworkDaily({ daily, networks }) {
  const [metric, setMetric] = useStateNw('sales');
  const names = new Map(networks.map((n) => [n.id, n.name]));
  const ids = [...new Set(daily.map((d) => d.network_id))];
  const byDay = new Map();
  for (const d of daily) {
    const row = byDay.get(d.day) || { date: d.day };
    row[d.network_id] = (row[d.network_id] || 0) + (metric === 'sales' ? d.sales : d.checkouts);
    byDay.set(d.day, row);
  }
  const data = [...byDay.values()].map((r) => {
    for (const id of ids) if (r[id] == null) r[id] = 0;
    return r;
  });
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        <div className="panel-title" style={{ flex: 1 }}>Por dia</div>
        <button className={metric === 'sales' ? 'chip is-active' : 'chip'} onClick={() => setMetric('sales')}>Vendas</button>
        <button className={metric === 'checkouts' ? 'chip is-active' : 'chip'} onClick={() => setMetric('checkouts')}>Checkouts</button>
      </div>
      <NSTimeSeries data={data} format="int" height={220} toggles
        series={ids.map((id) => ({ key: id, label: names.get(id) || id, kind: 'line' }))}/>
    </div>
  );
}

function NetworkDiagnostics({ diag }) {
  const [open, setOpen] = useStateNw(false);
  const unattributed = diag?.unattributed || [];
  const pending = diag?.pending || [];
  const total = unattributed.reduce((s, r) => s + r.sales, 0);
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <button onClick={() => setOpen(!open)} aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit', width: '100%', textAlign: 'left' }}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14}/>
        <span className="panel-title" style={{ flex: 1 }}>Diagnóstico</span>
        <span style={{ fontSize: 11.5, color: total || pending.length ? 'var(--warning)' : 'var(--fg5)' }}>
          {fmtInt(total)} sem atribuição · {fmtInt(pending.length)} pendentes há mais de 1 h
        </span>
      </button>
      {open && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginTop: 12 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Vendas das contas das redes sem atribuição</div>
            <div style={{ fontSize: 11, color: 'var(--fg4)', marginBottom: 6 }}>São da rede, mas sem integrante ou sem CPA — não geram comissão. Ajuda a achar link sem nsid, produto não liberado etc.</div>
            {unattributed.length === 0
              ? <div style={{ fontSize: 12, color: 'var(--fg5)' }}>Nenhuma no período.</div>
              : (
                <table className="tbl" style={{ fontSize: 12 }}>
                  <thead><tr><th>Motivo</th><th className="num">Vendas</th><th className="num">Valor</th></tr></thead>
                  <tbody>
                    {unattributed.map((r) => (
                      <tr key={r.reason}><td>{NW_REASON[r.reason] || r.reason}</td><td className="num cell-mono">{fmtInt(r.sales)}</td><td className="num cell-mono">{nwUsd(r.amount, 2)}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Pendentes há mais de 1 hora</div>
            <div style={{ fontSize: 11, color: 'var(--fg4)', marginBottom: 6 }}>O NorthAffiliates ainda espera a IPN de vendedor dessas vendas — sinal de IPN perdida. Qualquer data.</div>
            {pending.length === 0
              ? <div style={{ fontSize: 12, color: 'var(--fg5)' }}>Nenhuma.</div>
              : (
                <table className="tbl" style={{ fontSize: 12 }}>
                  <thead><tr><th>Venda</th><th>Rede</th><th>Quando</th><th title="O pedido já chegou ao dashboard pela IPN de vendedor?">Pedido no dash</th></tr></thead>
                  <tbody>
                    {pending.map((r) => (
                      <tr key={r.transaction_id}>
                        <td className="cell-mono">{r.transaction_id}<div style={{ fontSize: 10.5, color: 'var(--fg5)' }}>{r.product_name || ''}</div></td>
                        <td>{r.network_name || r.network_id}</td>
                        <td className="cell-mono">{fmtDateTime(r.sold_at)}</td>
                        <td>{r.has_order ? 'sim' : <span style={{ color: 'var(--danger)' }}>não</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </div>
        </div>
      )}
    </div>
  );
}

function NetworksSyncLine({ isAdmin }) {
  const [status, setStatus] = useStateNw(null);
  const [busy, setBusy] = useStateNw(false);
  const [msg, setMsg] = useStateNw(null);
  useEffectNw(() => {
    if (!isAdmin) return;
    window.NSApi.adminNetworksSyncStatus().then(setStatus).catch(() => setStatus(null));
  }, [isAdmin]);
  if (!isAdmin) return null;
  async function run() {
    setBusy(true); setMsg(null);
    try {
      const r = await window.NSApi.adminNetworksSync('quick');
      setMsg(r.errors && r.errors.length ? `Conferência com erro: ${r.errors[0]}` : `Conferido: ${fmtInt(r.conversions?.items || 0)} vendas de hoje, ${fmtInt(r.checkouts?.checkouts || 0)} checkouts.`);
      setStatus(await window.NSApi.adminNetworksSyncStatus());
    } catch (e) {
      setMsg(e.message || 'falhou');
    } finally {
      setBusy(false);
    }
  }
  const last = status?.lastRun;
  return (
    <div className="panel-sub" style={{ fontSize: 11, marginTop: 8, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <span>
        {status && !status.configured && 'Chave do NorthAffiliates não configurada — sem conferência. '}
        {last ? `Última conferência ${fmtDateTime(last.at)}${last.ok ? '' : ' (com erro)'}. ` : 'Conferência ainda não rodou. '}
        {status ? `${fmtInt(status.events24h)} eventos do n8n nas últimas 24 h${status.eventsFailed24h ? ` (${fmtInt(status.eventsFailed24h)} com erro)` : ''}.` : ''}
      </span>
      <button className="btn btn-ghost" onClick={run} disabled={busy} style={{ fontSize: 11, padding: '2px 8px' }}>
        <Icon name="refresh" size={11}/> {busy ? 'Conferindo…' : 'Conferir agora'}
      </button>
      {msg && <span>{msg}</span>}
    </div>
  );
}

function NetworksPage({ filters, user }) {
  const [sel, setSel] = useStateNw({ network: null, member: null, product: null, utmSource: null, utmCampaign: null, sub1: null, includeTests: false });
  const [page, setPage] = useStateNw(1);
  const [help, setHelp] = useStateNw(() => { try { return localStorage.getItem('ns-networks-help') !== '0'; } catch (e) { return true; } });
  const [state, setState] = useStateNw({ loading: true, data: null, err: null });
  const [drawer, setDrawer] = useStateNw(null);

  function toggleHelp() {
    const next = !help;
    setHelp(next);
    try { localStorage.setItem('ns-networks-help', next ? '1' : '0'); } catch (e) { /* sem storage: só não lembra */ }
  }
  const set = (k, v) => setSel((s) => {
    const next = { ...s, [k]: v };
    if (k === 'network') next.member = null; // integrante é da rede
    return next;
  });

  const selKey = JSON.stringify(sel);
  const rangeKey = `${filters.dateRange.start.getTime()}|${filters.dateRange.end.getTime()}`;
  useEffectNw(() => { setPage(1); }, [selKey, rangeKey]);

  useEffectNw(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, err: null }));
    window.NSApi.fetchNetworks(filters, { ...sel, page })
      .then((data) => { if (!cancelled) setState({ loading: false, data, err: null }); })
      .catch((e) => { if (!cancelled) setState({ loading: false, data: null, err: e.message || 'erro' }); });
    return () => { cancelled = true; };
  }, [selKey, rangeKey, page]);

  const data = state.data;
  const t = data?.totals;
  const opt = data?.options;
  const recent = data?.recent?.rows || [];
  const noNetworks = opt && opt.networks.length === 0;
  const memberOpts = (opt?.members || []).filter((m) => !sel.network || m.networkId === sel.network)
    .map((m) => ({ id: m.id, label: `${m.name}${m.publicId ? ` · ${m.publicId}` : ''}` }));
  const anyFilter = sel.network || sel.member || sel.product || sel.utmSource || sel.utmCampaign || sel.sub1 || sel.includeTests;

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">Afiliados · Networks</span>
          <h2>Networks <em>redes de afiliados</em></h2>
          <span className="sub">Vendas das redes (conta própria na JVZoo, integrantes com link próprio): quanto venderam, o CPA devido a cada rede, o repasse aos integrantes e o que sobra pra NorthScale.</span>
        </div>
        <div className="page-head-actions">
          <button className={help ? 'btn btn-primary' : 'btn btn-ghost'} onClick={toggleHelp} aria-pressed={help}><Icon name="info" size={12}/> Como ler</button>
        </div>
      </div>

      {help && <NetworksHelp/>}
      {state.err && <ReadState kind="falha" title="Não consegui carregar as redes">{state.err}</ReadState>}
      {noNetworks && (
        <ReadState kind="vazio" title="Nenhuma rede recebida ainda">
          As redes chegam do NorthAffiliates (conferência a cada 15 min) e as vendas pelo workflow "JVZoo Redes" do n8n. Assim que a primeira chegar, ela aparece aqui.
        </ReadState>
      )}

      {opt && !noNetworks && (
        <div className="panel" style={{ padding: '10px 14px', marginBottom: 12, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <NwSelect label="Rede" value={sel.network} onChange={(v) => set('network', v)}
            options={opt.networks.map((n) => ({ id: n.id, label: n.status === 'active' ? n.name : `${n.name} (${n.status})` }))}/>
          <NwSelect label="Integrante" value={sel.member} onChange={(v) => set('member', v)} options={memberOpts} allLabel="Todos"/>
          <NwSelect label="Produto" value={sel.product} onChange={(v) => set('product', v)} options={opt.products.map((p) => ({ id: p.id, label: p.name }))} allLabel="Todos"/>
          <NwSelect label="utm_source" value={sel.utmSource} onChange={(v) => set('utmSource', v)} options={opt.utmSources.map((v) => ({ id: v, label: v }))} allLabel="Qualquer"/>
          <NwSelect label="utm_campaign" value={sel.utmCampaign} onChange={(v) => set('utmCampaign', v)} options={opt.utmCampaigns.map((v) => ({ id: v, label: v }))} allLabel="Qualquer"/>
          <NwSelect label="sub1" value={sel.sub1} onChange={(v) => set('sub1', v)} options={opt.sub1s.map((v) => ({ id: v, label: v }))} allLabel="Qualquer"/>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, paddingBottom: 4 }}>
            <input type="checkbox" checked={sel.includeTests} onChange={(e) => set('includeTests', e.target.checked)}/>
            incluir testes
          </label>
          {anyFilter && (
            <button className="btn btn-ghost" style={{ fontSize: 11.5 }}
              onClick={() => setSel({ network: null, member: null, product: null, utmSource: null, utmCampaign: null, sub1: null, includeTests: false })}>
              limpar
            </button>
          )}
        </div>
      )}

      {t && !noNetworks && (<>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <NwKpi label="Vendas" value={fmtInt(t.sales)} sub={`${fmtInt(t.netSales)} líquidas (sem reembolso e chargeback)`}/>
          <NwKpi label="Faturamento" value={nwUsd(t.revenue)} sub="pedidos das vendas e do funil, sem estornos" tone="var(--money)"/>
          <NwKpi label="Checkouts iniciados" value={fmtInt(t.checkouts)}
            sub={data.checkoutsSource === 'events' ? 'só eventos (filtro de tráfego ativo)' : 'abriram o checkout pelo link da rede'}/>
          <NwKpi label="Conversão do checkout" value={nwPct(t.conversion)} sub="vendas ÷ checkouts iniciados"/>
          <NwKpi label="Lucro NS com redes" value={nwUsd(t.profit)} sub="faturamento − CPA devido" tone={t.profit < 0 ? 'var(--danger)' : 'var(--money)'}/>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <NwKpi label="CPA devido às redes" value={nwUsd(t.cpaDue)} sub="aprovadas, retidas e já pagas"/>
          <NwKpi label="Repasse aos integrantes" value={nwUsd(t.memberDue)}
            sub={<span><span style={{ color: 'var(--success)', fontWeight: 600 }}>{nwUsd(t.memberPaid)} já pagos</span> · {nwUsd(Math.max(0, t.memberDue - t.memberPaid))} a pagar</span>}/>
          <NwKpi label="Margem das redes" value={nwUsd(t.margin)} sub="CPA − repasse"/>
          <NwKpi label="Reembolsos / chargebacks" value={`${fmtInt(t.refunds)} / ${fmtInt(t.chargebacks)}`}
            sub={`${nwPct(t.refundPct)} reembolso · ${nwPct(t.chargebackPct)} chargeback`}
            tone={(t.refunds + t.chargebacks) > 0 ? 'var(--danger)' : 'var(--fg1)'}/>
          <NwKpi label="Retidas" value={fmtInt(t.held)} sub={`${nwUsd(t.heldCpa)} de CPA retido (integrante suspenso)`}
            tone={t.held > 0 ? 'var(--warning)' : 'var(--fg1)'}/>
        </div>
      </>)}

      {data && !noNetworks && (<>
        <NetworkTable rows={data.byNetwork} activeId={sel.network} onOpen={(id) => set('network', sel.network === id ? null : id)}/>
        <MemberTable rows={data.byMember} showNetwork={!sel.network} activeId={sel.member}
          onPick={(m) => setSel((s) => ({ ...s, network: m.networkId, member: s.member === m.memberId ? null : m.memberId }))}/>
        {data.daily.length > 0 && <NetworkDaily daily={data.daily} networks={opt.networks}/>}
      </>)}

      {!noNetworks && (
        <div className="panel" style={{ padding: 0, overflow: 'hidden', marginBottom: 12 }}>
          <div style={{ padding: '12px 16px 8px' }}>
            <div className="panel-title">Vendas recentes</div>
            <div className="panel-sub" style={{ fontSize: 11 }}>Todas as vendas das contas das redes no período, inclusive sem atribuição. Clique pra abrir o pedido.</div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl" style={{ fontSize: 12.5, minWidth: 1080 }}>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Rede · integrante</th>
                  <th>Produto</th>
                  <th className="num">Valor</th>
                  <th>Situação</th>
                  <th className="num" title="CPA da rede · repasse ao integrante">CPA · repasse</th>
                  <th>Comissão</th>
                  <th>Origem</th>
                </tr>
              </thead>
              <tbody>
                {state.loading && !recent.length && <SkelTableRows rows={8} cols={8}/>}
                {!state.loading && recent.length === 0 && (
                  <tr><td colSpan={8} style={{ padding: 22, textAlign: 'center', color: 'var(--fg5)' }}>Nenhuma venda de rede neste filtro.</td></tr>
                )}
                {recent.map((r) => (
                  <tr key={r.transaction_id} onClick={r.order_external_id ? () => setDrawer(r.order_external_id) : undefined}
                    title={r.order_external_id ? 'Abrir o pedido' : 'O pedido ainda não chegou pela IPN de vendedor'}
                    style={{ cursor: r.order_external_id ? 'pointer' : 'default', opacity: r.is_test ? 0.7 : 1 }}>
                    <td className="cell-mono" style={{ fontSize: 11.5 }}>{fmtDateTime(r.sold_at)}<div style={{ fontSize: 10.5, color: 'var(--fg5)' }}>{r.transaction_id}</div></td>
                    <td>
                      <div>{r.network_name || r.network_id}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--fg5)' }}>{r.member_id ? `${r.member_name || r.member_id}${r.member_public_id ? ` · ${r.member_public_id}` : ''}` : 'sem integrante'}</div>
                    </td>
                    <td>{r.product_name || r.jvzoo_product_id || '—'}</td>
                    <td className="num cell-mono" style={{ color: 'var(--money)' }}>{nwUsd(r.amount_usd, 2)}</td>
                    <td><NwStateCell r={r}/></td>
                    <td className="num cell-mono">{r.network_cpa != null ? `${nwUsd(r.network_cpa)} · ${nwUsd(r.member_amount)}` : '—'}</td>
                    <td><NwCommissionCell r={r}/></td>
                    <td style={{ fontSize: 11.5, overflowWrap: 'anywhere' }}>
                      {[r.utm_source, r.utm_campaign].filter(Boolean).join(' / ') || <span style={{ color: 'var(--fg5)' }}>—</span>}
                      {r.sub1 && <div style={{ fontSize: 10.5, color: 'var(--fg5)' }}>sub1 {r.sub1}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data && data.recent.total > data.recent.pageSize ? (
            <Pager page={data.recent.page} pageSize={data.recent.pageSize} total={data.recent.total}
              hasMore={recent.length === data.recent.pageSize} onPageChange={setPage} label="vendas"/>
          ) : null}
        </div>
      )}

      {data && !noNetworks && <NetworkDiagnostics diag={data.diagnostics}/>}
      <NetworksSyncLine isAdmin={user?.role === 'ADMIN'}/>

      {drawer && (
        <TransactionDrawer externalId={drawer} platformSlug="jvzoo" cur="USD"
          onClose={() => setDrawer(null)} onPickOrder={(o) => setDrawer(o.externalId)}/>
      )}
    </div>
  );
}

Object.assign(window, { NetworksPage });
