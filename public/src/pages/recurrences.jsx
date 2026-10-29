/* global React, Icon, fmtCurrency, fmtInt, fmtPct, fmtDateShort, fmtDateTime, SkelTableRows, Paginated, ReadState, platBadge, downloadCsv */
/* Aba Recorrências — todas as assinaturas, de qualquer plataforma (JVZoo,
   ClickBank, BuyGoods, Digistore, Vupim). Visão geral: quanto entrou de
   renovação, ticket médio, previsão dos próximos meses, ativas, quem encerrou
   e quanto tempo levou, retenção por cobrança e por produto. Assinantes: a
   lista com status, próxima cobrança e exportação.
   O disparo de SMS/e-mail da pesquisa mudou pra aba Pesquisas → Disparos.
   API: GET /api/metrics/recurrences (lib/services/recurrences.ts) */

const { useState: useStateRc, useEffect: useEffectRc } = React;

const RC_SECTION_KEY = 'ns.recurrences.section';
const RC_PLATFORM_NAME = { jvzoo: 'JVZoo', clickbank: 'ClickBank', buygoods: 'BuyGoods', digistore24: 'Digistore24', vupim: 'Vupim', cartpanda: 'Cartpanda' };
const RC_STATUS = [
  { id: 'todas', label: 'Todas' },
  { id: 'active', label: 'Ativas' },
  { id: 'late', label: 'Em atraso' },
  { id: 'ended', label: 'Encerradas' },
];
const RC_STATUS_LABEL = { active: 'Ativa', late: 'Em atraso', ended: 'Encerrada' };
const RC_STATUS_TONE = { active: 'ok', late: 'warn', ended: 'neutral' };
const RC_REASON_LABEL = { pediu: 'pediu cancelamento', reembolso: 'reembolso', sem_pagamento: 'parou de pagar' };
const RC_MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const rcUsd = (n, d = 0) => fmtCurrency(n, 'USD', d);
const rcPlatform = (slug) => RC_PLATFORM_NAME[slug] || slug;
const rcMonthLabel = (m) => `${RC_MONTHS[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const rcDays = (n) => (n == null ? '—' : `${fmtInt(Math.round(n))} dia${Math.round(n) === 1 ? '' : 's'}`);

function rcLoad(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function rcSave(key, value) {
  try { localStorage.setItem(key, value); } catch { /* sem storage: só não lembra */ }
}

function RcPlat({ slug }) {
  const pb = platBadge(slug);
  return <span className={`plat ${pb.cls}`} title={rcPlatform(slug)}>{pb.short}</span>;
}

function RcPanel({ title, sub, children, right, style }) {
  return (
    <div className="panel" style={{ marginBottom: 12, minWidth: 0, ...style }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="panel-title">{title}</div>
          {sub ? <div className="panel-sub" style={{ fontSize: 11, marginBottom: 10 }}>{sub}</div> : <div style={{ height: 8 }}/>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function RcKpis({ items }) {
  return (
    <div className="mini-kpis" style={{ marginBottom: 12 }}>
      {items.map((x) => (
        <div className="mini-kpi" key={x.l} title={x.title}>
          <div className="l">{x.l}</div>
          <div className="v" style={x.money ? { color: 'var(--money)' } : x.tone ? { color: x.tone } : undefined}>{x.v}</div>
          <div className="s">{x.s}</div>
        </div>
      ))}
    </div>
  );
}

/** Barras horizontais: rótulo · barra · valor · detalhe. `share` 0..1 = comprimento. */
function RcBars({ items, empty }) {
  if (!items.some((i) => i.share > 0)) return <div style={{ padding: '10px 0', color: 'var(--fg5)', fontSize: 12 }}>{empty}</div>;
  return (
    <div style={{ display: 'grid', gap: 7 }}>
      {items.map((i) => (
        <div key={i.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 1.1fr) 2fr 52px minmax(70px, auto)', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
          <span style={{ color: 'var(--fg2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={i.label}>{i.label}</span>
          <span style={{ height: 8, background: 'var(--bg-sunken, var(--border-soft))', borderRadius: 4, overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${Math.max(0, Math.min(1, i.share)) * 100}%`, background: 'var(--accent)', borderRadius: 4 }}/>
          </span>
          <span className="mono" style={{ textAlign: 'right', color: 'var(--fg1)' }}>{i.value}</span>
          <span className="mono" style={{ textAlign: 'right', color: 'var(--fg5)', fontSize: 11.5 }}>{i.detail}</span>
        </div>
      ))}
    </div>
  );
}

// ---------- mês a mês ----------

const RC_FILL = 'var(--money)';
const RC_FILL_SOFT = 'color-mix(in oklab, var(--money) 28%, transparent)';
const RC_LINE_SOFT = 'color-mix(in oklab, var(--money) 55%, transparent)';

function rcMonthTip(m) {
  const label = rcMonthLabel(m.month);
  if (m.kind === 'past') return `${label}: recebido ${rcUsd(m.renewalsUsd)} em ${fmtInt(m.renewals)} renovações`;
  const prev = `previsto ${rcUsd(m.expectedUsd)} (até ${rcUsd(m.maxUsd)} se ninguém cancelar)`;
  return m.kind === 'current' ? `${label}: recebido até agora ${rcUsd(m.renewalsUsd)} + ${prev}` : `${label}: ${prev}`;
}

function RcMonths({ months }) {
  const top = Math.max(1, ...months.map((m) => m.renewalsUsd + m.maxUsd));
  if (!months.some((m) => m.renewalsUsd || m.maxUsd)) {
    return <div style={{ padding: '14px 0', color: 'var(--fg5)', fontSize: 12 }}>Nenhuma renovação recebida nem prevista nesses meses.</div>;
  }
  const h = (v) => `${(v / top) * 100}%`;
  return (
    <div>
      <div role="img" aria-label={`Renovações por mês: ${months.map(rcMonthTip).join('; ')}`}
        style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 170, padding: '18px 0 0', borderBottom: '1px solid var(--border)' }}>
        {months.map((m) => (
          <div key={m.month} title={rcMonthTip(m)} style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center' }}>
            <div style={{ width: '100%', maxWidth: 34, height: h(m.renewalsUsd + m.maxUsd), minHeight: m.renewalsUsd || m.maxUsd ? 2 : 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
              border: m.maxUsd ? `1px dashed ${RC_LINE_SOFT}` : 'none', borderBottom: 'none', borderRadius: '3px 3px 0 0', boxSizing: 'border-box' }}>
              {m.expectedUsd > 0 && <span style={{ display: 'block', height: `${(m.expectedUsd / (m.renewalsUsd + m.maxUsd)) * 100}%`, background: RC_FILL_SOFT }}/>}
              {m.renewalsUsd > 0 && <span style={{ display: 'block', height: `${(m.renewalsUsd / (m.renewalsUsd + m.maxUsd)) * 100}%`, background: RC_FILL, borderRadius: m.maxUsd ? 0 : '3px 3px 0 0' }}/>}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        {months.map((m, i) => (
          <span key={m.month} style={{ flex: 1, minWidth: 0, fontSize: 10, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden',
            color: m.kind === 'current' ? 'var(--fg1)' : 'var(--fg5)', fontWeight: m.kind === 'current' ? 600 : 400 }}>
            {months.length > 12 && i % 2 && m.kind !== 'current' ? '' : rcMonthLabel(m.month)}
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10, fontSize: 11.5, color: 'var(--fg4)' }}>
        <span><i style={{ display: 'inline-block', width: 10, height: 10, background: RC_FILL, borderRadius: 2, marginRight: 5 }}/>Recebido</span>
        <span><i style={{ display: 'inline-block', width: 10, height: 10, background: RC_FILL_SOFT, borderRadius: 2, marginRight: 5 }}/>Previsto (com a retenção medida)</span>
        <span><i style={{ display: 'inline-block', width: 10, height: 10, border: `1px dashed ${RC_LINE_SOFT}`, borderRadius: 2, marginRight: 5 }}/>Se ninguém cancelar</span>
      </div>
      <details style={{ marginTop: 10 }}>
        <summary style={{ fontSize: 12, color: 'var(--fg4)', cursor: 'pointer' }}>Ver em tabela</summary>
        <div style={{ overflowX: 'auto', marginTop: 8 }}>
          <table className="tbl" style={{ fontSize: 12.5, minWidth: 640 }}>
            <thead>
              <tr><th>Mês</th><th className="num">Renovações</th><th className="num">Recebido</th><th className="num">Estornado</th><th className="num">Novas</th><th className="num">Encerradas</th><th className="num">Previsto</th><th className="num">Se ninguém cancelar</th></tr>
            </thead>
            <tbody>
              {[...months].reverse().map((m) => (
                <tr key={m.month}>
                  <td style={{ fontWeight: m.kind === 'current' ? 600 : 400 }}>{rcMonthLabel(m.month)}{m.kind === 'current' ? ' (este mês)' : m.kind === 'future' ? ' · previsão' : ''}</td>
                  <td className="num mono">{m.kind === 'future' ? '—' : fmtInt(m.renewals)}</td>
                  <td className="num mono" style={m.renewalsUsd ? { color: 'var(--money)' } : undefined}>{m.kind === 'future' ? '—' : rcUsd(m.renewalsUsd)}</td>
                  <td className="num mono">{m.kind === 'future' ? '—' : rcUsd(m.refundedUsd)}</td>
                  <td className="num mono">{m.kind === 'future' ? '—' : fmtInt(m.newSubs)}</td>
                  <td className="num mono">{m.kind === 'future' ? '—' : fmtInt(m.ended)}</td>
                  <td className="num mono">{m.kind === 'past' ? '—' : `${rcUsd(m.expectedUsd)} · ${fmtInt(m.expectedCharges)}`}</td>
                  <td className="num mono">{m.kind === 'past' ? '—' : rcUsd(m.maxUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

// ---------- visão geral ----------

function RcOverview({ d }) {
  const k = d.kpis;
  const endedSplit = [
    k.endedPediu && `${fmtInt(k.endedPediu)} pediram`,
    k.endedSemPagamento && `${fmtInt(k.endedSemPagamento)} pararam de pagar`,
    k.endedReembolso && `${fmtInt(k.endedReembolso)} reembolso`,
  ].filter(Boolean).join(' · ');
  const kpis = [
    { l: 'Recebido de renovação', v: rcUsd(k.renewalsUsd), money: k.renewalsUsd > 0,
      s: `${fmtInt(k.renewals)} renovações · desde o início ${rcUsd(k.renewalsAllTimeUsd)}`,
      title: 'Cobranças depois da 1ª (a compra) no período, sem as estornadas.' },
    { l: 'Ticket médio da renovação', v: k.avgTicketUsd != null ? rcUsd(k.avgTicketUsd, 2) : '—',
      s: k.avgTicketAllTimeUsd != null ? `desde o início ${rcUsd(k.avgTicketAllTimeUsd, 2)}` : 'sem renovação ainda' },
    { l: 'Previsto 30 dias', v: rcUsd(k.forecast30Usd), money: k.forecast30Usd > 0,
      s: k.forecastHasHistory ? `~${fmtInt(k.forecast30Charges)} cobranças · até ${rcUsd(k.forecast30MaxUsd)} se ninguém cancelar` : 'sem histórico de retenção: conta que todos pagam',
      title: 'Próximas cobranças de quem está ativo ou em atraso × a chance de continuar medida nas assinaturas mais antigas.' },
    { l: 'Receita mensal recorrente', v: rcUsd(k.mrrUsd), money: k.mrrUsd > 0, s: 'ativas e em atraso, renovação ÷ ciclo em meses' },
    { l: 'Assinaturas ativas', v: fmtInt(k.active), s: k.late ? `+ ${fmtInt(k.late)} em atraso` : 'nenhuma em atraso' },
    { l: 'Novas no período', v: fmtInt(k.newSubs), s: k.newSubs ? `${rcUsd(k.newSubsUsd)} na 1ª cobrança` : '1ª cobrança no período' },
    { l: 'Encerradas no período', v: fmtInt(k.ended), tone: k.ended ? 'var(--danger)' : undefined,
      s: [k.churn != null ? `${fmtPct(k.churn, 1)} das ativas no início` : null, endedSplit].filter(Boolean).join(' · ') || '—' },
    { l: 'Tempo até encerrar', v: rcDays(k.avgDaysToEnd),
      s: k.avgCyclesToEnd != null ? `${k.avgCyclesToEnd.toFixed(1)} cobranças pagas · desde o início ${rcDays(k.avgDaysToEndAll)}` : k.avgDaysToEndAll != null ? `desde o início ${rcDays(k.avgDaysToEndAll)}` : 'ninguém encerrou ainda',
      title: 'Média de dias entre a 1ª cobrança e o encerramento, de quem encerrou no período.' },
  ];

  const ret = d.retention.filter((r) => r.n > 1 && r.eligible > 0);
  const endedAll = d.endTiming.reduce((s, b) => s + b.count, 0);

  return (<>
    <RcKpis items={kpis}/>

    <RcPanel title="Mês a mês" sub="Renovações recebidas nos últimos 12 meses (mês BRT) e a previsão dos próximos 5. Previsto = próximas cobranças de cada assinatura ativa × a chance de continuar medida nas mais antigas.">
      <RcMonths months={d.months}/>
    </RcPanel>

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', gap: 12 }}>
      <RcPanel title="Quantos chegam em cada cobrança" sub="Das assinaturas que já tiveram tempo de pagar a cobrança (início + ciclos + 15 dias de folga), quantas pagaram. A 1ª é a compra.">
        <RcBars empty="Ainda ninguém teve tempo de chegar na 2ª cobrança."
          items={ret.map((r) => ({ id: r.n, label: `${r.n}ª cobrança`, share: r.pct ?? 0, value: r.pct != null ? fmtPct(r.pct, 0) : '—', detail: `${fmtInt(r.reached)} de ${fmtInt(r.eligible)}` }))}/>
      </RcPanel>
      <RcPanel title="Quando encerram" sub={`Desde o início: ${fmtInt(endedAll)} encerradas, em média ${rcDays(d.kpis.avgDaysToEndAll)} depois da compra${d.kpis.ltvUsd != null ? `, pagando ${rcUsd(d.kpis.ltvUsd)} cada` : ''}. Quem continua não entra na média — a retenção ao lado mostra o quadro todo.`}>
        <RcBars empty="Ninguém encerrou ainda."
          items={d.endTiming.map((b) => ({ id: b.id, label: b.label, share: endedAll ? b.count / endedAll : 0, value: fmtInt(b.count), detail: endedAll ? fmtPct(b.count / endedAll, 0) : '—' }))}/>
      </RcPanel>
    </div>

    <RcPanel title="Por produto" sub="Situação de agora; novas e renovações no período; ticket, chegam na 2ª, tempo até encerrar e valor por assinante (média das encerradas) desde o início.">
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl" style={{ fontSize: 12.5, minWidth: 1040 }}>
          <thead>
            <tr>
              <th>Produto</th><th className="num">Ativas</th><th className="num">Em atraso</th><th className="num">Encerradas</th>
              <th className="num">Novas</th><th className="num">Renovações</th><th className="num">Ticket médio</th><th className="num">Chegam na 2ª</th>
              <th className="num">Tempo até encerrar</th><th className="num">Valor por assinante</th><th className="num">Mensal</th><th className="num">Ciclo</th>
            </tr>
          </thead>
          <tbody>
            {d.byProduct.map((p) => (
              <tr key={p.key}>
                <td style={{ fontWeight: 500 }}><RcPlat slug={p.platform}/> {p.label}</td>
                <td className="num mono">{fmtInt(p.active)}</td>
                <td className="num mono" style={p.late ? { color: 'var(--warning)' } : undefined}>{fmtInt(p.late)}</td>
                <td className="num mono">{fmtInt(p.ended)}</td>
                <td className="num mono">{fmtInt(p.newSubs)}</td>
                <td className="num mono" style={p.renewalsUsd ? { color: 'var(--money)' } : undefined}>{rcUsd(p.renewalsUsd)}<div style={{ fontSize: 10.5, color: 'var(--fg5)' }}>{fmtInt(p.renewals)}×</div></td>
                <td className="num mono">{p.avgTicketUsd != null ? rcUsd(p.avgTicketUsd, 2) : '—'}</td>
                <td className="num mono" title={`${fmtInt(p.retention2Eligible)} já tiveram tempo de pagar a 2ª`}>{p.retention2 != null ? fmtPct(p.retention2, 0) : '—'}</td>
                <td className="num mono">{rcDays(p.avgDaysToEnd)}</td>
                <td className="num mono">{p.ltvUsd != null ? rcUsd(p.ltvUsd) : '—'}</td>
                <td className="num mono">{rcUsd(p.mrrUsd)}</td>
                <td className="num mono">{p.cycleDays != null ? `${fmtInt(p.cycleDays)} d` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </RcPanel>

    {d.byPlatform.length > 1 && (
      <RcPanel title="Por plataforma" sub="Situação de agora; renovações recebidas no período.">
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ fontSize: 12.5, minWidth: 520 }}>
            <thead><tr><th>Plataforma</th><th className="num">Assinaturas</th><th className="num">Ativas</th><th className="num">Em atraso</th><th className="num">Encerradas</th><th className="num">Renovações</th><th className="num">Mensal</th></tr></thead>
            <tbody>
              {d.byPlatform.map((p) => (
                <tr key={p.platform}>
                  <td style={{ fontWeight: 500 }}><RcPlat slug={p.platform}/> {rcPlatform(p.platform)}</td>
                  <td className="num mono">{fmtInt(p.total)}</td>
                  <td className="num mono">{fmtInt(p.active)}</td>
                  <td className="num mono">{fmtInt(p.late)}</td>
                  <td className="num mono">{fmtInt(p.ended)}</td>
                  <td className="num mono" style={p.renewalsUsd ? { color: 'var(--money)' } : undefined}>{rcUsd(p.renewalsUsd)}</td>
                  <td className="num mono">{rcUsd(p.mrrUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </RcPanel>
    )}

    <details className="panel" style={{ marginBottom: 12 }}>
      <summary style={{ cursor: 'pointer', fontSize: 12.5, color: 'var(--fg3)' }}>Como a aba conta</summary>
      <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--fg3)', lineHeight: 1.6 }}>
        <li><b>Assinatura</b> = mesmo cliente (e-mail) + mesmo produto recorrente na mesma plataforma. A 1ª cobrança é a compra; as seguintes são renovações.</li>
        <li><b>Produto recorrente</b> entra sozinho quando aparece a 1ª renovação (ou o 1º aviso de cancelamento/falha de recorrência) de qualquer plataforma. A Vupim entra pelo webhook de assinatura.</li>
        <li><b>Ciclo</b> = intervalo entre as cobranças do próprio assinante; sem renovação ainda, o do produto (ou da oferta, na Vupim); sem nada, 30 dias.</li>
        <li><b>Em atraso</b> = a cobrança esperada não veio há mais de 3 dias, ou a plataforma avisou falha de pagamento.</li>
        <li><b>Encerrada</b>: pediu cancelamento (a plataforma avisou), reembolso da última cobrança, ou parou de pagar (15 dias sem a cobrança esperada, mesmo sem aviso — a data é a da cobrança que não veio).</li>
        <li><b>Previsto</b> = cobranças futuras de quem não encerrou, no valor da última renovação, vezes a chance de continuar medida em quem já teve tempo de pagar. Sem histórico suficiente, mostra só o "se ninguém cancelar".</li>
        <li>Lê os avisos (IPN) das plataformas: produto JVZoo sem IPN cadastrado não aparece aqui.</li>
      </ul>
    </details>
  </>);
}

// ---------- assinantes ----------

function rcCsv(rows) {
  const stamp = new Date().toISOString().slice(0, 10);
  downloadCsv(`assinaturas_${stamp}.csv`,
    ['plataforma', 'produto', 'nome', 'email', 'telefone', 'status', 'motivo', 'inicio', 'ultima_cobranca', 'cobrancas', 'total_pago_usd', 'renovacao_usd', 'ciclo_dias', 'proxima_cobranca', 'encerrou_em', 'dias_ate_encerrar'],
    rows.map((r) => [
      rcPlatform(r.platform), r.product, r.name || '', r.email || '', r.phone || '', RC_STATUS_LABEL[r.status], r.endReason ? RC_REASON_LABEL[r.endReason] : (r.failureReason || ''),
      r.startedAt.slice(0, 10), r.lastChargeAt.slice(0, 10), r.cycles, r.totalPaidUsd, r.renewalUsd, r.cycleDays,
      r.nextChargeAt ? r.nextChargeAt.slice(0, 10) : '', r.endedAt ? r.endedAt.slice(0, 10) : '', r.daysToEnd ?? '',
    ]));
}

function RcSubscribers({ d }) {
  const [status, setStatus] = useStateRc('todas');
  const [q, setQ] = useStateRc('');
  const needle = q.trim().toLowerCase();
  const rows = d.rows.filter((r) => (status === 'todas' || r.status === status)
    && (!needle || [r.name, r.email, r.phone, r.product, r.externalId].some((v) => v && String(v).toLowerCase().includes(needle))));
  const count = (id) => (id === 'todas' ? d.rows.length : d.rows.filter((r) => r.status === id).length);

  return (
    <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px', display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="seg" role="group" aria-label="Status" style={{ flexWrap: 'wrap', height: 'auto' }}>
            {RC_STATUS.map((s) => (
              <button key={s.id} className={s.id === status ? 'is-active' : ''} style={{ height: 28 }} onClick={() => setStatus(s.id)}>{s.label} ({fmtInt(count(s.id))})</button>
            ))}
          </div>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome, e-mail, telefone, produto…" aria-label="Buscar assinatura"
            style={{ flex: '1 1 220px', maxWidth: 320, padding: '6px 10px', fontSize: 12.5, color: 'var(--fg1)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6 }}/>
          <div style={{ flex: 1 }}/>
          <button className="btn btn-ghost" disabled={!rows.length} onClick={() => rcCsv(rows)}><Icon name="download" size={12}/> Exportar CSV</button>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--fg5)' }}>Cancelar, pausar ou trocar plano é no painel de cada plataforma. Próxima cobrança "estimada" = última cobrança + ciclo.</div>
      </div>
      {!rows.length ? (
        <div style={{ padding: '0 14px 14px', color: 'var(--fg5)', fontSize: 12 }}>Nenhuma assinatura com esse filtro.</div>
      ) : (
        <Paginated items={rows} label="assinaturas" resetKey={`${status}-${needle}-${d.filters.platform}-${d.filters.product}`}>
          {(page, pager) => (<>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl" style={{ fontSize: 12.5, minWidth: 980 }}>
                <thead>
                  <tr><th>Cliente</th><th>Produto</th><th>Status</th><th className="num">Cobranças</th><th className="num">Total pago</th><th>Início</th><th>Última cobrança</th><th>Próxima / encerrou</th></tr>
                </thead>
                <tbody>
                  {page.map((r) => (
                    <tr key={r.key}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{r.name || '—'}{r.fromSurvey && <span className="badge" style={{ marginLeft: 6 }}>pesquisa</span>}</div>
                        <div style={{ color: 'var(--fg4)', fontSize: 11.5 }}>{r.email || '—'}</div>
                      </td>
                      <td>
                        <RcPlat slug={r.platform}/> {r.product}
                        <div style={{ fontSize: 11, color: 'var(--fg5)' }}>a cada {fmtInt(r.cycleDays)} dias{r.cycleSource !== 'cobrancas' ? ` (${r.cycleSource === 'oferta' ? 'pela oferta' : r.cycleSource === 'produto' ? 'pelo produto' : 'padrão'})` : ''} · {rcUsd(r.renewalUsd, 2)}</div>
                      </td>
                      <td>
                        <span className={`badge ${RC_STATUS_TONE[r.status] || ''}`}>{RC_STATUS_LABEL[r.status]}</span>
                        {(r.endReason || r.failureReason) && <div style={{ fontSize: 11, color: 'var(--fg5)', marginTop: 2 }}>{r.endReason ? RC_REASON_LABEL[r.endReason] : `falha: ${r.failureReason}`}</div>}
                      </td>
                      <td className="num mono">{fmtInt(r.cycles)}</td>
                      <td className="num mono" style={r.totalPaidUsd ? { color: 'var(--money)' } : undefined}>{rcUsd(r.totalPaidUsd)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDateShort(r.startedAt)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDateShort(r.lastChargeAt)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {r.status === 'ended'
                          ? <>{fmtDateShort(r.endedAt)}<div style={{ fontSize: 11, color: 'var(--fg5)' }}>após {rcDays(r.daysToEnd)}</div></>
                          : r.nextChargeAt
                            ? <>{fmtDateShort(r.nextChargeAt)}{r.nextEstimated && <div style={{ fontSize: 10.5, color: 'var(--fg5)' }}>estimada</div>}{r.lastFailedAt && <div style={{ fontSize: 10.5, color: 'var(--warning)' }} title={fmtDateTime(r.lastFailedAt)}>falhou {fmtDateShort(r.lastFailedAt)}</div>}</>
                            : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pager}
          </>)}
        </Paginated>
      )}
    </div>
  );
}

// ---------- página ----------

const RC_SECTIONS = [
  { id: 'geral', label: 'Visão geral' },
  { id: 'assinantes', label: 'Assinantes' },
];

function RecurrencesPage({ filters }) {
  const [section, setSectionState] = useStateRc(() => rcLoad(RC_SECTION_KEY, 'geral'));
  const [platform, setPlatform] = useStateRc('');
  const [product, setProduct] = useStateRc('');
  const [state, setState] = useStateRc({ status: 'loading', data: null, error: null });
  const sec = RC_SECTIONS.some((s) => s.id === section) ? section : 'geral';
  const setSection = (id) => { setSectionState(id); rcSave(RC_SECTION_KEY, id); };

  useEffectRc(() => {
    let alive = true;
    setState((s) => ({ ...s, status: 'loading' }));
    window.NSApi.fetchRecurrences(filters, { platform: platform || null, product: product || null })
      .then((data) => { if (alive) setState({ status: 'ready', data, error: null }); })
      .catch((e) => { if (alive) setState({ status: 'error', data: null, error: String(e.message || e) }); });
    return () => { alive = false; };
  }, [filters.dateRange.start, filters.dateRange.end, platform, product]);

  if (state.status === 'error') return <div className="page-in"><ReadState kind="falha" title="Não carregou as recorrências">{state.error}</ReadState></div>;
  const d = state.data;
  if (!d) return <div className="page-in"><div className="panel"><SkelTableRows rows={6} cols={6}/></div></div>;
  if (!d.platforms.length) {
    return (
      <div className="page-in">
        <ReadState kind="vazio" title="Nenhuma recorrência ainda">
          Um produto entra aqui sozinho quando aparece a 1ª renovação (ou o 1º aviso de cancelamento de recorrência) em qualquer plataforma. A Vupim entra pelo webhook de assinatura.
        </ReadState>
      </div>
    );
  }
  const products = d.products.filter((p) => !platform || p.platform === platform);

  return (
    <div className="page-in" style={{ opacity: state.status === 'loading' ? 0.6 : 1, transition: 'opacity .15s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="seg" role="tablist" aria-label="Seções da aba Recorrências">
          {RC_SECTIONS.map((s) => (
            <button key={s.id} role="tab" aria-selected={s.id === sec} className={s.id === sec ? 'is-active' : ''} onClick={() => setSection(s.id)}>{s.label}</button>
          ))}
        </div>
        <select value={platform} onChange={(e) => { setPlatform(e.target.value); setProduct(''); }} aria-label="Plataforma">
          <option value="">Todas as plataformas</option>
          {d.platforms.map((p) => <option key={p.id} value={p.id}>{rcPlatform(p.id)} ({fmtInt(p.count)})</option>)}
        </select>
        <select value={product} onChange={(e) => setProduct(e.target.value)} aria-label="Produto" style={{ maxWidth: 320 }}>
          <option value="">Todos os produtos</option>
          {products.map((p) => <option key={p.key} value={p.key}>{platform ? '' : `${platBadge(p.platform).short} · `}{p.label} ({fmtInt(p.count)})</option>)}
        </select>
        <span style={{ fontSize: 11.5, color: 'var(--fg5)', flex: '1 1 260px' }}>
          O período do topo vale pra renovações recebidas, novas e encerradas. Ativas, receita mensal e previsão são de agora.
        </span>
      </div>
      {sec === 'geral' ? <RcOverview d={d}/> : <RcSubscribers d={d}/>}
    </div>
  );
}

Object.assign(window, { RecurrencesPage });
