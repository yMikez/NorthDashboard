/* global React, Icon, fmtCurrency, fmtInt, fmtPct, fmtDateShort, fmtDateTime, SkelTableRows, Pager, ReadState */
/* Aba Leads — a pessoa (e-mail) no centro, cruzando todas as fontes de
   compra: funil das plataformas, call center (Tauk/Logicall) e SalesBound.
   Filtros globais (período, plataforma, produto, país, afiliado) valem pra
   ORIGEM do lead (a 1ª compra). A busca procura em todos os leads.
   API: GET /api/metrics/leads, GET /api/metrics/leads/detail?email= */

const { useState: useStateLd, useEffect: useEffectLd } = React;

const LEAD_CHANNELS = {
  funil:      { label: 'Funil',       color: 'var(--chart-1)' },
  callcenter: { label: 'Call center', color: 'var(--chart-2)' },
  salesbound: { label: 'SalesBound',  color: 'var(--chart-3)' },
};
const LEAD_SOURCE_LABEL = {
  buygoods: 'BuyGoods', jvzoo: 'JVZoo', digistore24: 'Digistore24', clickbank: 'ClickBank', cartpanda: 'Cartpanda',
  pagamerican: 'PagAmerican', tauk: 'Tauk', logicall: 'Logicall', salesbound: 'SalesBound',
};
const LEAD_SEGMENTS = [
  { id: 'all',          label: 'Todos' },
  { id: 'repeat',       label: 'Recompraram',  desc: 'Compraram em mais de um dia' },
  { id: 'single',       label: 'Uma compra só', desc: 'Todas as compras no mesmo dia (funil + upsells)' },
  { id: 'multichannel', label: 'Multicanal',   desc: 'Compraram por mais de um canal' },
  { id: 'callcenter',   label: 'Call center',  desc: 'Têm venda de Tauk ou Logicall' },
  { id: 'salesbound',   label: 'SalesBound',   desc: 'Têm venda da SalesBound' },
  { id: 'refunded',     label: 'Com estorno',  desc: 'Algum valor devolvido' },
];
const LEAD_SORTS = [
  { id: 'ltv', label: 'Maior LTV' },
  { id: 'recent', label: 'Compra mais recente' },
  { id: 'new', label: 'Lead mais novo' },
  { id: 'purchases', label: 'Mais compras' },
  { id: 'refunds', label: 'Mais estorno' },
];
const LEAD_GROUPS = [
  { id: 'channel', label: 'Canal' },
  { id: 'platform', label: 'Plataforma' },
  { id: 'affiliate', label: 'Afiliado' },
  { id: 'family', label: 'Produto' },
  { id: 'country', label: 'País' },
];
const LEAD_KIND_LABEL = { venda: 'Venda', estorno: 'Estorno', chargeback: 'Chargeback', void: 'Void', pendente: 'Pendente', cancelado: 'Cancelado' };
const LEAD_STAGE_LABEL = { FRONTEND: 'Front', UPSELL: 'Upsell', DOWNSELL: 'Downsell', BUMP: 'Bump', SMS_RECOVERY: 'Recuperação' };

const ldUsd = (n, d = 0) => (n == null ? '—' : fmtCurrency(n, 'USD', d));
const ldPct = (n) => (n == null ? '—' : fmtPct(n, 1));
const ldSource = (s) => LEAD_SOURCE_LABEL[s] || s || '—';

function LeadChip({ color, children, title }) {
  return (
    <span title={title} style={{
      display: 'inline-block', padding: '1px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600, marginRight: 4,
      color, background: `color-mix(in oklab, ${color} 13%, transparent)`, whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

function LeadChannelChips({ channels }) {
  return (channels || []).map((c) => {
    const ch = LEAD_CHANNELS[c] || { label: c, color: 'var(--fg4)' };
    return <LeadChip key={c} color={ch.color}>{ch.label}</LeadChip>;
  });
}

function LeadKpi({ label, value, sub, tone }) {
  return (
    <div className="panel" style={{ padding: '12px 16px', flex: '1 1 160px', minWidth: 150 }}>
      <div className="panel-eyebrow" style={{ fontSize: 10 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: tone || 'var(--fg1)', lineHeight: 1.15, marginTop: 2 }}>{value}</div>
      {sub && <div className="panel-sub" style={{ fontSize: 11, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/* Curva de LTV médio: 24h → 30 → 90 → 180 dias → hoje. Cada janela só conta
   quem já viveu a janela inteira (o lead de ontem não puxa a média de 90d). */
function LeadLtvCurve({ k }) {
  const steps = [
    { label: '24 horas', value: k.ltv24hAvg, n: k.leads },
    { label: '30 dias', value: k.ltv30Avg, n: k.ltv30Eligible },
    { label: '90 dias', value: k.ltv90Avg, n: k.ltv90Eligible },
    { label: '180 dias', value: k.ltv180Avg, n: k.ltv180Eligible },
    { label: 'Hoje', value: k.ltvAvg, n: k.leads },
  ];
  const max = Math.max(...steps.map((s) => s.value || 0), 1);
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div className="panel-head">
        <div>
          <div className="panel-title">LTV médio por tempo de vida</div>
          <div className="panel-sub" style={{ fontSize: 11 }}>Valor líquido por lead até N dias depois da 1ª compra. Cada janela só conta quem já completou a janela.</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginTop: 12 }}>
        {steps.map((s) => (
          <div key={s.label}>
            <div style={{ fontSize: 11, color: 'var(--fg4)' }}>{s.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--money)' }}>{s.value == null || !s.n ? '—' : ldUsd(s.value, 2)}</div>
            <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-subtle)', marginTop: 4, overflow: 'hidden' }}>
              <div style={{ width: `${Math.round(((s.value || 0) / max) * 100)}%`, height: '100%', background: 'var(--money)' }}/>
            </div>
            <div style={{ fontSize: 10, color: 'var(--fg5)', marginTop: 3 }}>{fmtInt(s.n || 0)} leads</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LeadGroupsPanel({ data, group, setGroup }) {
  const rows = data.groups || [];
  const labelOf = (g) => {
    if (data.groupBy === 'channel') return (LEAD_CHANNELS[g.key] || {}).label || g.key || '—';
    if (data.groupBy === 'platform') return ldSource(g.key);
    if (data.groupBy === 'affiliate') return g.key ? (g.label || g.key) : 'sem afiliado';
    return g.key || 'sem informação';
  };
  return (
    <div className="panel" style={{ marginBottom: 12, padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '12px 14px' }}>
        <div>
          <div className="panel-title">LTV por origem</div>
          <div className="panel-sub" style={{ fontSize: 11 }}>De onde veio a 1ª compra e quanto esses leads valem depois.</div>
        </div>
        <div style={{ flex: 1 }}/>
        {LEAD_GROUPS.map((g) => (
          <button key={g.id} className={group === g.id ? 'chip is-active' : 'chip'} onClick={() => setGroup(g.id)}>{g.label}</button>
        ))}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl" style={{ fontSize: 12.5, minWidth: 760 }}>
          <thead>
            <tr>
              <th>Origem</th><th className="num">Leads</th><th className="num">LTV 24h</th><th className="num" title="Só leads com 90 dias ou mais">LTV 90d</th>
              <th className="num">LTV hoje</th><th className="num">Recompra</th><th className="num">Estorno</th><th className="num">Pós-venda</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={8} style={{ padding: 18, textAlign: 'center', color: 'var(--fg5)' }}>Nenhum lead neste filtro.</td></tr>}
            {rows.map((g) => (
              <tr key={g.key || '_none'}>
                <td>{labelOf(g)}</td>
                <td className="num cell-mono">{fmtInt(g.leads)}</td>
                <td className="num cell-mono">{ldUsd(g.ltv24hAvg)}</td>
                <td className="num cell-mono" title={`${fmtInt(g.ltv90Eligible)} leads com 90+ dias`}>{g.ltv90Eligible ? ldUsd(g.ltv90Avg) : '—'}</td>
                <td className="num cell-mono" style={{ color: 'var(--money)', fontWeight: 600 }}>{ldUsd(g.ltvAvg)}</td>
                <td className="num cell-mono">{ldPct(g.repeatRate)}</td>
                <td className="num cell-mono" style={{ color: (g.refundRate || 0) > 0.15 ? 'var(--danger)' : undefined }}>{ldPct(g.refundRate)}</td>
                <td className="num cell-mono">{ldPct(g.postSaleShare)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LeadRow({ r, onOpen }) {
  const origin = [r.originChannel === 'funil' ? ldSource(r.originPlatform) : (LEAD_CHANNELS[r.originChannel] || {}).label || ldSource(r.originPlatform), r.originAffiliate, r.originFamily]
    .filter(Boolean).join(' · ');
  return (
    <tr tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => onOpen(r.email)}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(r.email); }}>
      <td style={{ maxWidth: 260 }}>
        <div style={{ fontWeight: 600, color: 'var(--fg1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name || r.email}</div>
        <div style={{ fontSize: 11, color: 'var(--fg5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name ? r.email : ''}{r.country ? `${r.name ? ' · ' : ''}${r.country}` : ''}</div>
      </td>
      <td style={{ maxWidth: 240 }}>
        <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.originProduct || ''}>{origin || '—'}</div>
      </td>
      <td className="cell-mono">{fmtDateShort(r.firstAt)}</td>
      <td className="cell-mono">{fmtDateShort(r.lastAt)}</td>
      <td className="num cell-mono" title={`${r.purchases} compras em ${r.purchaseDays} dia(s)`}>{fmtInt(r.purchases)}{r.purchaseDays > 1 ? <span style={{ color: 'var(--fg5)' }}> · {r.purchaseDays}d</span> : ''}</td>
      <td><LeadChannelChips channels={r.channels}/></td>
      <td className="num cell-mono" style={{ color: r.refundedUsd > 0 ? 'var(--danger)' : 'var(--fg5)' }}>{r.refundedUsd > 0 ? ldUsd(r.refundedUsd) : '—'}</td>
      <td className="num cell-mono" style={{ color: 'var(--money)', fontWeight: 700 }}>{ldUsd(r.ltvUsd)}</td>
    </tr>
  );
}

/* Ficha do lead: tudo o que aconteceu com ele, de todas as fontes. */
function LeadDrawer({ email, onClose }) {
  const [state, setState] = useStateLd({ loading: true, d: null, err: null });
  useEffectLd(() => {
    let cancelled = false;
    setState({ loading: true, d: null, err: null });
    window.NSApi.fetchLeadDetail(email)
      .then((d) => { if (!cancelled) setState({ loading: false, d, err: null }); })
      .catch((e) => { if (!cancelled) setState({ loading: false, d: null, err: e.message || 'erro' }); });
    return () => { cancelled = true; };
  }, [email]);
  useEffectLd(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const d = state.d;
  const s = d?.summary;
  return (
    <div role="dialog" aria-modal="true" aria-label={`Lead ${email}`} style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(640px, 100vw)', background: 'var(--bg-raised)',
      borderLeft: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', padding: 20, overflowY: 'auto', zIndex: 60,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div className="panel-eyebrow" style={{ fontSize: 10 }}>Lead</div>
          <div style={{ fontSize: 18, fontWeight: 700, overflowWrap: 'anywhere' }}>{d?.name || email}</div>
          <div className="panel-sub" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{email}{d?.country ? ` · ${d.country}` : ''}</div>
          {d?.phones?.length > 0 && (
            <div className="cell-mono" style={{ fontSize: 12, color: 'var(--fg3)', marginTop: 2 }} title="Telefones informados nas compras (o mais recente primeiro)">
              {d.phones.map((p) => `+${p}`).join(' · ')}
            </div>
          )}
        </div>
        <button className="btn btn-ghost" onClick={onClose} aria-label="Fechar" title="Fechar"><Icon name="x" size={14}/></button>
      </div>

      {state.loading && <div style={{ padding: 24, color: 'var(--fg5)', fontSize: 12 }}>Carregando…</div>}
      {state.err && <ReadState kind="falha" title="Não consegui carregar o lead">{state.err}</ReadState>}
      {d && !d.found && <ReadState kind="vazio" title="Nenhuma compra com esse e-mail"/>}

      {d && d.found && (<>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, margin: '16px 0' }}>
          <div><div className="panel-eyebrow" style={{ fontSize: 10 }}>LTV</div><div style={{ fontSize: 20, fontWeight: 700, color: 'var(--money)' }}>{ldUsd(s.ltvUsd, 2)}</div>
            <div style={{ fontSize: 11, color: 'var(--fg5)' }}>bruto {ldUsd(s.grossUsd, 2)}</div></div>
          <div><div className="panel-eyebrow" style={{ fontSize: 10 }}>Estornos</div><div style={{ fontSize: 20, fontWeight: 700, color: s.refundedUsd > 0 ? 'var(--danger)' : 'var(--fg1)' }}>{ldUsd(s.refundedUsd, 2)}</div></div>
          <div><div className="panel-eyebrow" style={{ fontSize: 10 }}>Compras</div><div style={{ fontSize: 20, fontWeight: 700 }}>{fmtInt(s.purchases)}</div>
            <div style={{ fontSize: 11, color: 'var(--fg5)' }}>em {fmtInt(s.purchaseDays)} dia(s)</div></div>
          <div><div className="panel-eyebrow" style={{ fontSize: 10 }}>1ª compra</div><div style={{ fontSize: 13, fontWeight: 600 }}>{s.firstAt ? fmtDateTime(s.firstAt) : '—'}</div></div>
          <div><div className="panel-eyebrow" style={{ fontSize: 10 }}>Última compra</div><div style={{ fontSize: 13, fontWeight: 600 }}>{s.lastAt ? fmtDateTime(s.lastAt) : '—'}</div></div>
        </div>

        {s.origin && (
          <div style={{ fontSize: 12, color: 'var(--fg3)', marginBottom: 10 }}>
            <strong>Origem:</strong> {(LEAD_CHANNELS[s.origin.channel] || {}).label} · {ldSource(s.origin.source)}
            {s.origin.affiliate ? ` · afiliado ${s.origin.affiliate}` : ''}{s.origin.product ? ` · ${s.origin.product}` : ''}
          </div>
        )}

        <div className="panel" style={{ padding: '10px 12px', marginBottom: 14 }}>
          <div className="panel-eyebrow" style={{ fontSize: 10, marginBottom: 6 }}>LTV por canal</div>
          {['funil', 'callcenter', 'salesbound'].map((c) => {
            const v = c === 'funil' ? s.funnelUsd : c === 'callcenter' ? s.callcenterUsd : s.salesboundUsd;
            if (!v && !(s.channels || []).includes(c)) return null;
            return (
              <div key={c} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}>
                <LeadChip color={LEAD_CHANNELS[c].color}>{LEAD_CHANNELS[c].label}</LeadChip>
                <span className="cell-mono" style={{ color: 'var(--money)' }}>{ldUsd(v, 2)}</span>
              </div>
            );
          })}
        </div>

        <div className="panel-eyebrow" style={{ fontSize: 10, margin: '6px 0' }}>Produtos comprados</div>
        <div style={{ overflowX: 'auto', marginBottom: 14 }}>
          <table className="tbl" style={{ fontSize: 12 }}>
            <thead><tr><th>Produto</th><th className="num">Vezes</th><th className="num">Potes</th><th className="num">Valor</th><th className="num">Estorno</th></tr></thead>
            <tbody>
              {d.products.map((p) => (
                <tr key={p.product}>
                  <td><div>{p.product}</div><div style={{ fontSize: 10, color: 'var(--fg5)' }}>{[p.family, ...p.channels.map((c) => (LEAD_CHANNELS[c] || {}).label)].filter(Boolean).join(' · ')}</div></td>
                  <td className="num cell-mono">{fmtInt(p.times)}</td>
                  <td className="num cell-mono">{p.bottles ? fmtInt(p.bottles) : '—'}</td>
                  <td className="num cell-mono" style={{ color: 'var(--money)' }}>{ldUsd(p.grossUsd, 2)}</td>
                  <td className="num cell-mono" style={{ color: p.refundedUsd > 0 ? 'var(--danger)' : 'var(--fg5)' }}>{p.refundedUsd > 0 ? ldUsd(p.refundedUsd, 2) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel-eyebrow" style={{ fontSize: 10, margin: '6px 0' }}>Linha do tempo</div>
        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {d.events.map((e, i) => {
            const ch = LEAD_CHANNELS[e.channel] || { label: e.channel, color: 'var(--fg4)' };
            const refundedInPlace = e.kind === 'venda' && e.refundedUsd > 0;
            const value = e.kind === 'venda' || e.kind === 'pendente' || e.kind === 'cancelado' ? e.saleUsd : -e.refundedUsd;
            return (
              <li key={`${e.ref}-${i}`} style={{ display: 'grid', gridTemplateColumns: '92px 1fr auto', gap: 10, padding: '8px 0', borderTop: '1px solid var(--border-soft)', opacity: e.counted ? 1 : 0.6 }}>
                <div className="cell-mono" style={{ fontSize: 11, color: 'var(--fg4)' }}>{fmtDateTime(e.at)}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5 }}>
                    <LeadChip color={ch.color}>{ch.label}</LeadChip>
                    <strong>{LEAD_KIND_LABEL[e.kind] || e.kind}</strong>
                    {e.stage ? ` · ${LEAD_STAGE_LABEL[e.stage] || e.stage}` : ''}
                    {' · '}{ldSource(e.source)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--fg4)', overflowWrap: 'anywhere' }}>
                    {[e.product, e.bottles ? `${e.bottles} potes` : null, e.affiliate ? `afiliado ${e.affiliate}` : null, e.agent ? `agente ${e.agent}` : null].filter(Boolean).join(' · ')}
                  </div>
                  {refundedInPlace && (
                    <div style={{ fontSize: 11, color: 'var(--danger)' }}>
                      {e.status === 'CHARGEBACK' ? 'chargeback' : 'estornada'} {ldUsd(e.refundedUsd, 2)}{e.refundedAt ? ` em ${fmtDateShort(e.refundedAt)}` : ''}
                    </div>
                  )}
                  {!e.counted && <div style={{ fontSize: 11, color: 'var(--fg5)' }}>não entra no LTV</div>}
                </div>
                <div className="cell-mono" style={{ fontSize: 12.5, fontWeight: 600, color: value < 0 ? 'var(--danger)' : 'var(--money)', textAlign: 'right' }}>
                  {value < 0 ? '−' : ''}{ldUsd(Math.abs(value), 2)}
                </div>
              </li>
            );
          })}
        </ol>
        <div style={{ fontSize: 10, color: 'var(--fg5)', marginTop: 10 }}>
          Lido agora, direto das fontes. SMS e e-mail marketing ainda não chegam ao dash.
        </div>
      </>)}
    </div>
  );
}

function LeadsPage({ filters }) {
  const [segment, setSegment] = useStateLd('all');
  const [sort, setSort] = useStateLd('ltv');
  const [group, setGroup] = useStateLd('channel');
  const [page, setPage] = useStateLd(1);
  const [qInput, setQInput] = useStateLd('');
  const [q, setQ] = useStateLd('');
  const [state, setState] = useStateLd({ loading: true, data: null, err: null });
  const [open, setOpen] = useStateLd(null);

  // Busca com espera curta: não dispara uma consulta por tecla.
  useEffectLd(() => {
    const t = setTimeout(() => { setQ(qInput.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [qInput]);

  const filterKey = [
    filters.dateRange.start.getTime(), filters.dateRange.end.getTime(),
    Array.from(filters.platforms || []).join(','), Array.from(filters.families || []).join(','),
    Array.from(filters.countries || []).join(','), Array.from(filters.affiliates || []).join(','),
  ].join('|');
  useEffectLd(() => { setPage(1); }, [filterKey, segment, sort]);

  useEffectLd(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, err: null }));
    window.NSApi.fetchLeads(filters, { segment, sort, group, page, q })
      .then((data) => { if (!cancelled) setState({ loading: false, data, err: null }); })
      .catch((e) => { if (!cancelled) setState({ loading: false, data: null, err: e.message || 'erro' }); });
    return () => { cancelled = true; };
  }, [filterKey, segment, sort, group, page, q]);

  const data = state.data;
  const k = data?.kpis;
  const rows = data?.leads || [];

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">Clientes · Leads</span>
          <h2>Leads <em>e LTV</em></h2>
          <span className="sub">Cada pessoa (e-mail) com tudo o que comprou no funil, no call center e na SalesBound. Os filtros valem pra 1ª compra do lead.</span>
        </div>
      </div>

      {state.err && <ReadState kind="falha" title="Não consegui carregar os leads">{state.err}</ReadState>}

      {data?.search && (
        <ReadState kind="vazio" title={`Buscando "${data.search}" em todos os leads`}>Período e filtros não se aplicam à busca.</ReadState>
      )}

      {k && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <LeadKpi label="Leads" value={fmtInt(k.leads)} sub={data.search ? 'na busca' : '1ª compra no período'}/>
          <LeadKpi label="LTV médio" value={ldUsd(k.ltvAvg, 2)} sub={`total ${ldUsd(k.ltvUsd)}`} tone="var(--money)"/>
          <LeadKpi label="Recompra" value={ldPct(k.repeatRate)} sub={`${fmtInt(k.repeatLeads)} compraram em mais de um dia`}/>
          <LeadKpi label="Pós-venda no LTV" value={ldPct(k.postSaleShare)}
            sub={`${ldUsd(k.postSaleUsd)} · ${fmtInt(k.callcenterLeads)} call center · ${fmtInt(k.salesboundLeads)} SalesBound`}/>
          <LeadKpi label="Estornos" value={ldPct(k.refundRate)} sub={`${ldUsd(k.refundedUsd)} de ${ldUsd(k.grossUsd)} bruto`}
            tone={(k.refundRate || 0) > 0.15 ? 'var(--danger)' : 'var(--fg1)'}/>
        </div>
      )}

      {k && k.leads > 0 && <LeadLtvCurve k={k}/>}
      {data && !data.search && <LeadGroupsPanel data={data} group={group} setGroup={setGroup}/>}

      <div className="panel" style={{ padding: '10px 14px', marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {LEAD_SEGMENTS.map((s) => (
          <button key={s.id} title={s.desc} onClick={() => setSegment(s.id)} disabled={!!q}
            className={segment === s.id ? 'chip is-active' : 'chip'}>{s.label}</button>
        ))}
        <div style={{ flex: 1 }}/>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <Icon name="search" size={13}/>
          <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="buscar e-mail, nome ou telefone…" aria-label="Buscar lead" style={{ width: 210 }}/>
        </label>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenar">
          {LEAD_SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>

      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ fontSize: 12.5, minWidth: 980 }}>
            <thead>
              <tr>
                <th>Lead</th><th>Origem</th><th>1ª compra</th><th>Última</th><th className="num">Compras</th>
                <th>Canais</th><th className="num">Estornos</th><th className="num">LTV</th>
              </tr>
            </thead>
            <tbody>
              {state.loading && !rows.length && <SkelTableRows rows={10} cols={8}/>}
              {!state.loading && rows.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 22, textAlign: 'center', color: 'var(--fg5)' }}>
                  {q ? 'Ninguém com esse e-mail ou nome.' : 'Nenhum lead neste filtro.'}
                </td></tr>
              )}
              {rows.map((r) => <LeadRow key={r.email} r={r} onOpen={setOpen}/>)}
            </tbody>
          </table>
        </div>
        {data && (data.total || page > 1) ? (
          <Pager page={data.page} pageSize={data.pageSize} total={data.total ?? undefined}
            hasMore={rows.length === data.pageSize} onPageChange={setPage} label="leads"/>
        ) : null}
      </div>

      {data && (
        <div className="panel-sub" style={{ fontSize: 11, marginTop: 8 }}>
          LTV = valor das compras menos estornos, somando funil, call center (Tauk/Logicall) e SalesBound — cada canal é uma cobrança separada.
          Pessoa = e-mail. {data.computedAt ? `Resumo atualizado ${fmtDateTime(data.computedAt)} (a cada ~10 min); a ficha do lead é lida na hora.` : 'Resumo sendo calculado.'}
        </div>
      )}

      {open && <div className="drawer-backdrop" onClick={() => setOpen(null)}/>}
      {open && <LeadDrawer email={open} onClose={() => setOpen(null)}/>}
    </div>
  );
}

Object.assign(window, { LeadsPage });
