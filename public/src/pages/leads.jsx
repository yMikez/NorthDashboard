/* global React, Icon, fmtCurrency, fmtInt, fmtPct, fmtDateShort, fmtDateLong, fmtDateTime, SkelTableRows, Pager, ReadState */
/* Aba Leads — cada cliente (pelo e-mail) com tudo o que comprou: funil das
   plataformas, call center (Tauk/Logicall) e SalesBound; LTV, potes e quanto
   tempo de produto ele ainda tem. Filtros globais valem pra 1ª compra do lead.
   API: GET /api/metrics/leads, GET /api/metrics/leads/detail?email= */

const { useState: useStateLd, useEffect: useEffectLd } = React;

const LEAD_CHANNELS = {
  funil:      { label: 'Funil',       color: 'var(--chart-1)' },
  callcenter: { label: 'Call center', color: 'var(--chart-2)' },
  salesbound: { label: 'SalesBound',  color: 'var(--chart-3)' },
};
const LEAD_SOURCE_LABEL = {
  buygoods: 'BuyGoods', jvzoo: 'JVZoo', digistore24: 'Digistore24', clickbank: 'ClickBank', cartpanda: 'Cartpanda',
  pagamerican: 'PagAmerican', vupim: 'Vupim', tauk: 'Tauk', logicall: 'Logicall', salesbound: 'SalesBound',
};
// Atalhos da lista, em três grupos pra leitura rápida.
const LEAD_SEGMENT_GROUPS = [
  { label: 'Compras', items: [
    { id: 'all',          label: 'Todos' },
    { id: 'repeat',       label: 'Compraram de novo', desc: 'Compraram em mais de um dia (front + upsells no mesmo dia contam como uma compra)' },
    { id: 'single',       label: 'Só uma compra',     desc: 'Todas as compras no mesmo dia' },
    { id: 'refunded',     label: 'Com estorno',       desc: 'Algum valor devolvido' },
  ] },
  { label: 'Canal', items: [
    { id: 'callcenter',   label: 'Call center',  desc: 'Têm venda de Tauk ou Logicall' },
    { id: 'salesbound',   label: 'SalesBound',   desc: 'Têm venda da SalesBound' },
    { id: 'multichannel', label: 'Mais de um canal', desc: 'Compraram por mais de um canal (ex.: funil e call center)' },
  ] },
  { label: 'Estoque', items: [
    { id: 'stock_low',    label: 'Acaba em até 15 dias', desc: 'O produto deles acaba nos próximos 15 dias — hora de oferecer reposição' },
    { id: 'stock_out',    label: 'Acabou há até 30 dias', desc: 'O produto acabou nos últimos 30 dias e não compraram de novo' },
  ] },
];
const LEAD_SORTS = [
  { id: 'ltv', label: 'Maior LTV' },
  { id: 'recent', label: 'Compra mais recente' },
  { id: 'new', label: 'Lead mais novo' },
  { id: 'purchases', label: 'Mais compras' },
  { id: 'stock', label: 'Estoque acabando primeiro' },
  { id: 'refunds', label: 'Mais estorno' },
];
const LEAD_GROUPS = [
  { id: 'channel', label: 'Canal' },
  { id: 'platform', label: 'Plataforma' },
  { id: 'affiliate', label: 'Afiliado' },
  { id: 'family', label: 'Produto' },
  { id: 'country', label: 'País' },
];
const LEAD_KIND_LABEL = { venda: 'Venda', estorno: 'Estorno', chargeback: 'Chargeback', void: 'Anulada', pendente: 'Pendente', cancelado: 'Cancelada' };
const LEAD_STAGE_LABEL = { FRONTEND: 'Front', UPSELL: 'Upsell', DOWNSELL: 'Downsell', BUMP: 'Bump', SMS_RECOVERY: 'Recuperação' };
const LEAD_DAY_MS = 86400000;

const ldUsd = (n, d = 0) => (n == null ? '—' : fmtCurrency(n, 'USD', d));
const ldPct = (n) => (n == null ? '—' : fmtPct(n, 1));
const ldSource = (s) => LEAD_SOURCE_LABEL[s] || s || '—';

// Telefone guardado só com dígitos (DDI quando a origem manda).
function ldPhone(d) {
  if (!d) return null;
  if (d.length === 11 && d[0] === '1') return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return `+55 ${d.slice(2, 4)} ${d.slice(4, d.length - 4)}-${d.slice(-4)}`;
  return `+${d}`;
}

// Estoque: dias que restam hoje e a cor do aviso.
function ldStock(until) {
  if (!until) return null;
  const days = Math.ceil((new Date(until).getTime() - Date.now()) / LEAD_DAY_MS);
  if (days <= 0) return { days: 0, ended: true, agoDays: -days, color: 'var(--fg5)' };
  return { days, ended: false, color: days <= 15 ? 'var(--warning)' : 'var(--success)' };
}

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

function LeadKpi({ label, value, sub, tone, onClick, active, hint }) {
  const clickable = !!onClick;
  return (
    <div className="panel" title={hint || undefined} onClick={onClick} role={clickable ? 'button' : undefined} tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter') onClick(); } : undefined}
      style={{ padding: '12px 16px', flex: '1 1 170px', minWidth: 160, cursor: clickable ? 'pointer' : 'default',
        borderColor: active ? 'var(--accent)' : undefined }}>
      <div className="panel-eyebrow" style={{ fontSize: 10 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: tone || 'var(--fg1)', lineHeight: 1.15, marginTop: 2 }}>{value}</div>
      {sub && <div className="panel-sub" style={{ fontSize: 11, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/* "Como ler": o vocabulário da aba em linguagem simples. */
function LeadsHelp() {
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
          {item('Lead', 'Uma pessoa, reconhecida pelo e-mail. Se ela comprou em plataformas diferentes com o mesmo e-mail, aparece uma vez só, com tudo somado.')}
          {item('Veio de', 'A primeira compra dela: plataforma, afiliado e produto. Os filtros do topo (período, plataforma, produto, país e afiliado) valem pra essa primeira compra — "quem entrou no período".')}
          {item('LTV', 'Tudo o que a pessoa já pagou, menos o que foi devolvido (estorno). Soma o funil, o call center e a SalesBound.')}
        </div>
        <div>
          {item('Compraram de novo', 'Voltaram a comprar em outro dia. O front e os upsells do mesmo dia contam como uma compra só.')}
          {item('Potes e estoque', 'Cada pote tem 30 cápsulas, 1 por dia: dura 30 dias. Compras do mesmo produto se somam em fila (a nova começa quando a anterior acaba). Produtos diferentes contam ao mesmo tempo. "Estoque até" é quando o último produto acaba.')}
          {item('Potes com ~', 'A Tauk não informa quantos potes vendeu: estimamos pelo valor da venda, com a tabela de preços da Logicall.')}
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--fg5)', marginTop: 4 }}>
        A lista e os números se atualizam a cada ~10 minutos. A ficha de cada lead (clique na linha) é lida na hora. SMS e e-mail marketing ainda não chegam ao dash.
      </div>
    </div>
  );
}

/* Curva de LTV: 1º dia → 30 → 90 → 180 dias → hoje. Cada ponto só conta quem
   já viveu o prazo inteiro (o lead de ontem não puxa a média de 90 dias). */
function LeadLtvCurve({ k }) {
  const steps = [
    { label: 'No 1º dia', value: k.ltv24hAvg, n: k.leads },
    { label: 'Em 30 dias', value: k.ltv30Avg, n: k.ltv30Eligible },
    { label: 'Em 90 dias', value: k.ltv90Avg, n: k.ltv90Eligible },
    { label: 'Em 180 dias', value: k.ltv180Avg, n: k.ltv180Eligible },
    { label: 'Até hoje', value: k.ltvAvg, n: k.leads },
  ];
  const max = Math.max(...steps.map((s) => s.value || 0), 1);
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div className="panel-title">Quanto um lead vale com o tempo</div>
      <div className="panel-sub" style={{ fontSize: 11 }}>Média por lead do que ele pagou (menos estornos) até cada prazo depois da 1ª compra. Só entra quem já completou o prazo.</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginTop: 12 }}>
        {steps.map((s) => (
          <div key={s.label}>
            <div style={{ fontSize: 11, color: 'var(--fg4)' }}>{s.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--money)' }}>{s.value == null || !s.n ? '—' : ldUsd(s.value, 2)}</div>
            <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-subtle)', marginTop: 4, overflow: 'hidden' }}>
              <div style={{ width: `${Math.round(((s.value || 0) / max) * 100)}%`, height: '100%', background: 'var(--money)' }}/>
            </div>
            <div style={{ fontSize: 10, color: 'var(--fg5)', marginTop: 3 }}>{s.n ? `${fmtInt(s.n)} leads` : 'ninguém completou ainda'}</div>
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
          <div className="panel-title">De onde vêm os leads que mais valem</div>
          <div className="panel-sub" style={{ fontSize: 11 }}>Agrupado pela primeira compra de cada lead. Valores são médias por lead.</div>
        </div>
        <div style={{ flex: 1 }}/>
        <span style={{ fontSize: 11, color: 'var(--fg5)' }}>agrupar por</span>
        {LEAD_GROUPS.map((g) => (
          <button key={g.id} className={group === g.id ? 'chip is-active' : 'chip'} onClick={() => setGroup(g.id)}>{g.label}</button>
        ))}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl" style={{ fontSize: 12.5, minWidth: 820 }}>
          <thead>
            <tr>
              <th>Veio de</th>
              <th className="num">Leads</th>
              <th className="num" title="Média do que o lead pagou no dia da 1ª compra (front + upsells)">No 1º dia</th>
              <th className="num" title="Só leads que já completaram 90 dias">Em 90 dias</th>
              <th className="num" title="Média do que o lead pagou até hoje, menos estornos">Até hoje</th>
              <th className="num" title="Média de potes comprados por lead">Potes/lead</th>
              <th className="num" title="Leads que compraram de novo em outro dia">Compraram de novo</th>
              <th className="num" title="Valor devolvido ÷ valor vendido">Estorno</th>
              <th className="num" title="Parte do LTV que veio do call center e da SalesBound">Pós-venda</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={9} style={{ padding: 18, textAlign: 'center', color: 'var(--fg5)' }}>Nenhum lead neste filtro.</td></tr>}
            {rows.map((g) => (
              <tr key={g.key || '_none'}>
                <td>{labelOf(g)}</td>
                <td className="num cell-mono">{fmtInt(g.leads)}</td>
                <td className="num cell-mono">{ldUsd(g.ltv24hAvg)}</td>
                <td className="num cell-mono" title={`${fmtInt(g.ltv90Eligible)} leads com 90+ dias`}>{g.ltv90Eligible ? ldUsd(g.ltv90Avg) : '—'}</td>
                <td className="num cell-mono" style={{ color: 'var(--money)', fontWeight: 600 }}>{ldUsd(g.ltvAvg)}</td>
                <td className="num cell-mono">{g.bottlesAvg == null ? '—' : g.bottlesAvg.toFixed(1)}</td>
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

function LeadStockCell({ until, family }) {
  const st = ldStock(until);
  if (!st) return <span style={{ color: 'var(--fg5)' }}>—</span>;
  return (
    <div title={family && family !== '—' ? `Último produto a acabar: ${family}` : undefined}>
      <div className="cell-mono" style={{ color: st.color, fontWeight: 600 }}>{st.ended ? 'acabou' : `${fmtInt(st.days)} dias`}</div>
      <div style={{ fontSize: 10.5, color: 'var(--fg5)' }}>{st.ended ? `em ${fmtDateLong(until)}` : `até ${fmtDateLong(until)}`}</div>
    </div>
  );
}

function LeadRow({ r, onOpen }) {
  const origin = [
    r.originChannel === 'funil' ? ldSource(r.originPlatform) : (LEAD_CHANNELS[r.originChannel] || {}).label || ldSource(r.originPlatform),
    r.originAffiliate,
  ].filter(Boolean).join(' · ');
  const nowrap = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
  return (
    <tr tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => onOpen(r.email)}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(r.email); }}>
      <td style={{ maxWidth: 240 }}>
        <div style={{ fontWeight: 600, color: 'var(--fg1)', ...nowrap }}>{r.name || r.email}</div>
        <div style={{ fontSize: 11, color: 'var(--fg5)', ...nowrap }}>{r.name ? r.email : ''}{r.country ? `${r.name ? ' · ' : ''}${r.country}` : ''}</div>
      </td>
      <td className="cell-mono" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{r.phone ? ldPhone(r.phone) : <span style={{ color: 'var(--fg5)' }}>—</span>}</td>
      <td style={{ maxWidth: 220 }}>
        <div style={{ fontSize: 12, ...nowrap }}>{origin || '—'}</div>
        <div style={{ fontSize: 10.5, color: 'var(--fg5)', ...nowrap }} title={r.originProduct || ''}>{fmtDateShort(r.firstAt)}{r.originProduct ? ` · ${r.originProduct}` : ''}</div>
      </td>
      <td title={`${r.purchases} compras em ${r.purchaseDays} dia(s)`}>
        <div className="cell-mono">{fmtInt(r.purchases)}{r.purchaseDays > 1 ? <span style={{ color: 'var(--fg5)', fontSize: 11 }}> em {r.purchaseDays} dias</span> : ''}</div>
        <div style={{ marginTop: 2 }}><LeadChannelChips channels={r.channels}/></div>
      </td>
      <td className="cell-mono">{fmtDateShort(r.lastAt)}</td>
      <td className="num cell-mono" title={r.bottlesEstimated ? `${fmtInt(r.bottlesEstimated)} potes estimados pelo valor (Tauk)` : undefined}>
        {r.bottles ? `${r.bottlesEstimated ? '~' : ''}${fmtInt(r.bottles)}` : '—'}
      </td>
      <td><LeadStockCell until={r.stockUntil} family={r.stockFamily}/></td>
      <td className="num">
        <div className="cell-mono" style={{ color: 'var(--money)', fontWeight: 700 }}>{ldUsd(r.ltvUsd)}</div>
        {r.refundedUsd > 0 && <div className="cell-mono" style={{ fontSize: 10.5, color: 'var(--danger)' }}>−{ldUsd(r.refundedUsd)} estorno</div>}
      </td>
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
  const stock = d?.stock;
  const lastStock = stock ? ldStock(stock.stockUntil) : null;
  const sectionTitle = (t, sub) => (
    <div style={{ margin: '18px 0 6px' }}>
      <div className="panel-eyebrow" style={{ fontSize: 10 }}>{t}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--fg5)' }}>{sub}</div>}
    </div>
  );
  return (
    <div role="dialog" aria-modal="true" aria-label={`Lead ${email}`} style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(680px, 100vw)', background: 'var(--bg-raised)',
      borderLeft: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', padding: 20, overflowY: 'auto', zIndex: 60,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div className="panel-eyebrow" style={{ fontSize: 10 }}>Lead</div>
          <div style={{ fontSize: 18, fontWeight: 700, overflowWrap: 'anywhere' }}>{d?.name || email}</div>
          <div className="panel-sub" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{email}{d?.country ? ` · ${d.country}` : ''}</div>
          {d?.phones?.length > 0 && (
            <div className="cell-mono" style={{ fontSize: 12.5, color: 'var(--fg2)', marginTop: 3 }} title="Telefones informados nas compras (o mais recente primeiro)">
              <Icon name="message-square" size={12}/> {d.phones.map(ldPhone).join(' · ')}
            </div>
          )}
        </div>
        <button className="btn btn-ghost" onClick={onClose} aria-label="Fechar" title="Fechar"><Icon name="x" size={14}/></button>
      </div>

      {state.loading && <div style={{ padding: 24, color: 'var(--fg5)', fontSize: 12 }}>Carregando…</div>}
      {state.err && <ReadState kind="falha" title="Não consegui carregar o lead">{state.err}</ReadState>}
      {d && !d.found && <ReadState kind="vazio" title="Nenhuma compra com esse e-mail"/>}

      {d && d.found && (<>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))', gap: 12, margin: '16px 0 4px' }}>
          <div><div className="panel-eyebrow" style={{ fontSize: 10 }}>LTV</div><div style={{ fontSize: 20, fontWeight: 700, color: 'var(--money)' }}>{ldUsd(s.ltvUsd, 2)}</div>
            <div style={{ fontSize: 11, color: s.refundedUsd > 0 ? 'var(--danger)' : 'var(--fg5)' }}>{s.refundedUsd > 0 ? `−${ldUsd(s.refundedUsd, 2)} de estorno` : 'sem estorno'}</div></div>
          <div><div className="panel-eyebrow" style={{ fontSize: 10 }}>Compras</div><div style={{ fontSize: 20, fontWeight: 700 }}>{fmtInt(s.purchases)}</div>
            <div style={{ fontSize: 11, color: 'var(--fg5)' }}>em {fmtInt(s.purchaseDays)} dia(s)</div></div>
          <div><div className="panel-eyebrow" style={{ fontSize: 10 }}>Potes</div><div style={{ fontSize: 20, fontWeight: 700 }}>{stock.estimatedBottles ? '~' : ''}{fmtInt(stock.bottles)}</div>
            <div style={{ fontSize: 11, color: 'var(--fg5)' }}>{fmtInt(stock.bottles * 30)} dias de produto</div></div>
          <div><div className="panel-eyebrow" style={{ fontSize: 10 }}>Estoque</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: lastStock ? lastStock.color : 'var(--fg5)' }}>{!lastStock ? '—' : lastStock.ended ? 'acabou' : `${fmtInt(lastStock.days)} dias`}</div>
            <div style={{ fontSize: 11, color: 'var(--fg5)' }}>{stock.stockUntil ? `${lastStock.ended ? 'em' : 'até'} ${fmtDateLong(stock.stockUntil)}` : ''}</div></div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--fg3)' }}>
          <strong>Primeira compra:</strong> {s.firstAt ? fmtDateTime(s.firstAt) : '—'}{s.origin ? ` · ${(LEAD_CHANNELS[s.origin.channel] || {}).label} · ${ldSource(s.origin.source)}${s.origin.affiliate ? ` · afiliado ${s.origin.affiliate}` : ''}${s.origin.product ? ` · ${s.origin.product}` : ''}` : ''}
        </div>
        <div style={{ fontSize: 12, color: 'var(--fg3)', marginTop: 2 }}><strong>Última compra:</strong> {s.lastAt ? fmtDateTime(s.lastAt) : '—'}</div>

        {sectionTitle('Estoque por produto', 'Cada pote dura 30 dias (30 cápsulas, 1 por dia). Compras do mesmo produto se somam em fila.')}
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ fontSize: 12 }}>
            <thead><tr><th>Produto</th><th className="num">Potes</th><th className="num">Compras</th><th>Última compra</th><th>Acaba em</th><th className="num">Restam</th></tr></thead>
            <tbody>
              {stock.families.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--fg5)', padding: 12 }}>Nenhum pote conhecido nas compras.</td></tr>}
              {stock.families.map((f) => {
                const st = ldStock(f.stockUntil);
                return (
                  <tr key={f.family}>
                    <td>{f.family === '—' ? 'sem produto identificado' : f.family}</td>
                    <td className="num cell-mono" title={f.estimatedBottles ? `${f.estimatedBottles} estimados pelo valor (Tauk)` : undefined}>{f.estimatedBottles ? '~' : ''}{fmtInt(f.bottles)}</td>
                    <td className="num cell-mono">{fmtInt(f.purchases)}</td>
                    <td className="cell-mono">{fmtDateLong(f.lastAt)}</td>
                    <td className="cell-mono">{fmtDateLong(f.stockUntil)}</td>
                    <td className="num cell-mono" style={{ color: st.color, fontWeight: 600 }}>{st.ended ? 'acabou' : `${fmtInt(st.days)} dias`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {sectionTitle('LTV por canal')}
        <div className="panel" style={{ padding: '8px 12px' }}>
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

        {sectionTitle('Produtos comprados')}
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ fontSize: 12 }}>
            <thead><tr><th>Produto</th><th className="num">Vezes</th><th className="num">Potes</th><th className="num">Valor</th><th className="num">Estorno</th></tr></thead>
            <tbody>
              {d.products.map((p) => (
                <tr key={p.product}>
                  <td><div>{p.product}</div><div style={{ fontSize: 10, color: 'var(--fg5)' }}>{[p.family, ...p.channels.map((c) => (LEAD_CHANNELS[c] || {}).label)].filter(Boolean).join(' · ')}</div></td>
                  <td className="num cell-mono">{fmtInt(p.times)}</td>
                  <td className="num cell-mono">{p.bottles ? `${p.estimatedBottles ? '~' : ''}${fmtInt(p.bottles)}` : '—'}</td>
                  <td className="num cell-mono" style={{ color: 'var(--money)' }}>{ldUsd(p.grossUsd, 2)}</td>
                  <td className="num cell-mono" style={{ color: p.refundedUsd > 0 ? 'var(--danger)' : 'var(--fg5)' }}>{p.refundedUsd > 0 ? ldUsd(p.refundedUsd, 2) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {sectionTitle('Linha do tempo', 'Tudo o que aconteceu com este lead, do mais antigo pro mais novo.')}
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
                    {[e.product, e.bottles ? `${e.bottlesEstimated ? '~' : ''}${e.bottles} ${e.bottles === 1 ? 'pote' : 'potes'}${e.bottlesEstimated ? ' (estimado pelo valor)' : ''}` : null,
                      e.affiliate ? `afiliado ${e.affiliate}` : null, e.agent ? `agente ${e.agent}` : null].filter(Boolean).join(' · ')}
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
  const [help, setHelp] = useStateLd(() => { try { return localStorage.getItem('ns-leads-help') !== '0'; } catch (e) { return true; } });
  const [state, setState] = useStateLd({ loading: true, data: null, err: null });
  const [open, setOpen] = useStateLd(null);

  function toggleHelp() {
    const next = !help;
    setHelp(next);
    try { localStorage.setItem('ns-leads-help', next ? '1' : '0'); } catch (e) { /* sem storage: só não lembra */ }
  }
  // Atalho de estoque já ordena pelo que acaba antes.
  function pickSegment(id) {
    setSegment(id);
    if (id === 'stock_low' || id === 'stock_out') setSort('stock');
  }

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
          <span className="sub">Cada cliente com tudo o que já comprou — no funil, no call center e na SalesBound — quanto pagou e até quando tem produto.</span>
        </div>
        <div className="page-head-actions">
          <button className={help ? 'btn btn-primary' : 'btn btn-ghost'} onClick={toggleHelp} aria-pressed={help}><Icon name="info" size={12}/> Como ler</button>
        </div>
      </div>

      {help && <LeadsHelp/>}

      {state.err && <ReadState kind="falha" title="Não consegui carregar os leads">{state.err}</ReadState>}

      {data?.search && (
        <ReadState kind="vazio" title={`Buscando "${data.search}" em todos os leads`}>Período, filtros e atalhos não valem para a busca.</ReadState>
      )}

      {k && (<>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <LeadKpi label="Leads" value={fmtInt(k.leads)} sub={data.search ? 'encontrados na busca' : 'fizeram a 1ª compra no período'}/>
          <LeadKpi label="LTV médio" value={ldUsd(k.ltvAvg, 2)} sub={`quanto cada um já pagou · total ${ldUsd(k.ltvUsd)}`} tone="var(--money)"/>
          <LeadKpi label="Compraram de novo" value={ldPct(k.repeatRate)} sub={`${fmtInt(k.repeatLeads)} leads voltaram em outro dia`}/>
          <LeadKpi label="Vem do pós-venda" value={ldPct(k.postSaleShare)}
            sub={`${ldUsd(k.postSaleUsd)} do LTV veio de call center e SalesBound`}
            hint={`${fmtInt(k.callcenterLeads)} leads com call center · ${fmtInt(k.salesboundLeads)} com SalesBound`}/>
          <LeadKpi label="Estorno" value={ldPct(k.refundRate)} sub={`${ldUsd(k.refundedUsd)} devolvidos de ${ldUsd(k.grossUsd)} vendidos`}
            tone={(k.refundRate || 0) > 0.15 ? 'var(--danger)' : 'var(--fg1)'}/>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <LeadKpi label="Potes por lead" value={k.bottlesAvg == null ? '—' : k.bottlesAvg.toFixed(1)}
            sub={`${fmtInt(k.bottles)} potes no total${k.bottlesEstimated ? ` · ${fmtInt(k.bottlesEstimated)} estimados (Tauk)` : ''}`}/>
          <LeadKpi label="Ainda têm produto" value={fmtInt(k.leadsWithStock)} sub={k.leads ? `${ldPct(k.leadsWithStock / k.leads)} dos leads` : ''} tone="var(--success)"/>
          <LeadKpi label="Produto acaba em até 15 dias" value={fmtInt(k.stockLowLeads)} sub="clique pra ver quem é" tone="var(--warning)"
            onClick={() => pickSegment(segment === 'stock_low' ? 'all' : 'stock_low')} active={segment === 'stock_low'}/>
          <LeadKpi label="Produto acabou há até 30 dias" value={fmtInt(k.stockOutLeads)} sub="e não compraram de novo · clique pra ver"
            onClick={() => pickSegment(segment === 'stock_out' ? 'all' : 'stock_out')} active={segment === 'stock_out'}/>
        </div>
      </>)}

      {k && k.leads > 0 && !data.search && <LeadLtvCurve k={k}/>}
      {data && !data.search && <LeadGroupsPanel data={data} group={group} setGroup={setGroup}/>}

      <div className="panel" style={{ padding: '10px 14px', marginBottom: 12, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        {LEAD_SEGMENT_GROUPS.map((g) => (
          <div key={g.label} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10.5, color: 'var(--fg5)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{g.label}</span>
            {g.items.map((s) => (
              <button key={s.id} title={s.desc} onClick={() => pickSegment(s.id)} disabled={!!q}
                className={segment === s.id ? 'chip is-active' : 'chip'}>{s.label}</button>
            ))}
          </div>
        ))}
        <div style={{ flex: 1 }}/>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <Icon name="search" size={13}/>
          <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="buscar e-mail, nome ou telefone…" aria-label="Buscar lead" style={{ width: 220 }}/>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--fg4)' }}>
          ordenar por
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenar">
            {LEAD_SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
      </div>

      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ fontSize: 12.5, minWidth: 1040 }}>
            <thead>
              <tr>
                <th>Lead</th>
                <th>Telefone</th>
                <th title="Primeira compra: plataforma, afiliado, data e produto">Veio de</th>
                <th title="Quantas compras e por quais canais">Compras</th>
                <th>Última compra</th>
                <th className="num" title="Potes comprados no total (~ = estimado pelo valor, Tauk)">Potes</th>
                <th title="Quanto tempo de produto ainda resta (30 dias por pote)">Estoque</th>
                <th className="num" title="Tudo o que pagou, menos estornos">LTV</th>
              </tr>
            </thead>
            <tbody>
              {state.loading && !rows.length && <SkelTableRows rows={10} cols={8}/>}
              {!state.loading && rows.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 22, textAlign: 'center', color: 'var(--fg5)' }}>
                  {q ? 'Ninguém com esse e-mail, nome ou telefone.' : 'Nenhum lead neste filtro.'}
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
          Clique num lead para ver a ficha completa: linha do tempo, produtos e estoque por produto.
          {data.computedAt ? ` Lista atualizada ${fmtDateTime(data.computedAt)}.` : ' Lista sendo calculada.'}
        </div>
      )}

      {open && <div className="drawer-backdrop" onClick={() => setOpen(null)}/>}
      {open && <LeadDrawer email={open} onClose={() => setOpen(null)}/>}
    </div>
  );
}

Object.assign(window, { LeadsPage });
