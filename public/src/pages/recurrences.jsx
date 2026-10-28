/* global React, Icon, fmtCurrency, fmtInt, fmtPct, fmtDateTime, fmtDateShort, SkelTableRows, Paginated, ReadState */
/* Aba Recorrências — antes e depois da recompra.
   Lista de recompra: quem está com o estoque acabando, com o link pessoal da
   pesquisa e o telefone pronto pro SMS; gera os links da janela, marca o
   envio por canal, exporta o lote e mostra quem ainda vai entrar.
   Assinaturas: estado das assinaturas da Vupim (eventos do webhook) — ativas,
   em atraso, próximas cobranças, canceladas, receita mensal recorrente.
   A Vupim não tem API: cancelar/pausar/trocar plano é no painel dela.
   API: /api/metrics/recurrences/{repurchase,subscriptions} */

const { useState: useStateRc, useEffect: useEffectRc } = React;

const RC_SECTION_KEY = 'ns.recurrences.section';
const RC_TEMPLATE_KEY = 'ns.recurrences.smsTemplate';
const RC_DEFAULT_TEMPLATE = 'NeuroRecall: Hi {nome}, your bottle is almost done. Take our 1-min check-in and get your returning-customer price: {link} Reply STOP to opt out';
const RC_DAYS = [7, 14, 21, 30];
const RC_STATUS = [
  { id: 'todos', label: 'Todos' },
  { id: 'sem_envio', label: 'Sem envio' },
  { id: 'enviado', label: 'Enviados' },
  { id: 'abriu', label: 'Abriram' },
  { id: 'concluiu', label: 'Concluíram' },
  { id: 'comprou', label: 'Compraram' },
];
const RC_STATUS_LABEL = { pendente: 'Na lista', enviado: 'Enviado', abriu: 'Abriu', respondeu: 'Respondendo', concluiu: 'Concluiu', comprou: 'Comprou' };
const RC_STATUS_TONE = { pendente: 'neutral', enviado: '', abriu: '', respondeu: 'warn', concluiu: 'ok', comprou: 'ok' };
const RC_CHANNELS = [{ id: 'sms', label: 'SMS' }, { id: 'email', label: 'E-mail' }, { id: 'whatsapp', label: 'WhatsApp' }];
const RC_CHANNEL_LABEL = { sms: 'SMS', email: 'E-mail', whatsapp: 'WhatsApp', manual: 'Manual' };
const rcUsd = (n, d = 0) => fmtCurrency(n, 'USD', d);

function rcLoad(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function rcSave(key, value) {
  try { localStorage.setItem(key, value); } catch { /* sem storage: só não lembra */ }
}

/** Caracteres que cabem no SMS comum (GSM-7). Fora disso, cada parte cai de 153 pra 67. */
const RC_GSM_RE = /^[A-Za-z0-9 \n\r@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/;
function rcSegments(text) {
  const gsm = RC_GSM_RE.test(text);
  const n = text.length;
  const parts = gsm ? (n <= 160 ? 1 : Math.ceil(n / 153)) : (n <= 70 ? 1 : Math.ceil(n / 67));
  return { gsm, n, parts };
}
const rcFill = (tpl, r) => tpl.replace(/\{nome\}/g, r.firstName || 'there').replace(/\{link\}/g, r.link).replace(/\{produto\}/g, r.product);

function rcCsv(rows, tpl) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['convite_id', 'nome', 'telefone', 'telefone_ddi_deduzido', 'email', 'produto', 'frascos', 'estoque_acaba', 'dias_restantes', 'status', 'link', 'mensagem'];
  const lines = rows.map((r) => [
    r.id, r.firstName || '', r.smsPhone || '', r.smsPhoneInferred ? 'sim' : '', r.email, r.product, r.bottles,
    r.stockUntil.slice(0, 10), r.daysLeft, RC_STATUS_LABEL[r.status] || r.status, r.link, rcFill(tpl, r),
  ].map(esc).join(','));
  return '﻿' + [head.join(','), ...lines].join('\n');
}

function rcDownload(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function rcCopy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

function rcDaysText(d) {
  if (d > 1) return `em ${d} dias`;
  if (d === 1) return 'amanhã';
  if (d === 0) return 'hoje';
  return `acabou há ${-d} dia${d === -1 ? '' : 's'}`;
}

function RcKpis({ items }) {
  return (
    <div className="mini-kpis" style={{ marginBottom: 12 }}>
      {items.map((x) => (
        <div className="mini-kpi" key={x.l}>
          <div className="l">{x.l}</div>
          <div className="v" style={x.money ? { color: 'var(--money)' } : x.tone ? { color: x.tone } : undefined}>{x.v}</div>
          <div className="s">{x.s}</div>
        </div>
      ))}
    </div>
  );
}

// ---------- lista de recompra ----------

function rcMatches(r, f) {
  if (f === 'todos') return true;
  if (f === 'sem_envio') return !r.sentAt;
  if (f === 'enviado') return Boolean(r.sentAt);
  if (f === 'abriu') return Boolean(r.openedAt);
  if (f === 'concluiu') return r.status === 'concluiu' || r.status === 'comprou';
  return r.status === f;
}

function RcForecast({ forecast, days }) {
  if (!forecast.length) return null;
  const cols = forecast[0].buckets;
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div className="panel-title">Quem ainda vai entrar</div>
      <div className="panel-sub" style={{ fontSize: 11, marginBottom: 10 }}>
        Pessoas sem link, por quantos dias faltam pro estoque acabar (próximos 30 dias). "Gerar links" traz pra lista quem acaba em até {days} dias.
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl" style={{ fontSize: 12.5, minWidth: 480 }}>
          <thead><tr><th>Pesquisa</th>{cols.map((c) => <th key={c.id} className="num">{c.label}</th>)}</tr></thead>
          <tbody>
            {forecast.map((f) => (
              <tr key={f.variant}>
                <td style={{ fontWeight: 500 }}>{f.name}</td>
                {f.buckets.map((b) => <td key={b.id} className="num mono">{fmtInt(b.count)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RcRepurchase({ user }) {
  const [variant, setVariant] = useStateRc('all');
  const [days, setDays] = useStateRc(14);
  const [tests, setTests] = useStateRc(false);
  const [status, setStatus] = useStateRc('todos');
  const [selected, setSelected] = useStateRc(() => new Set());
  const [channel, setChannel] = useStateRc('sms');
  const [tpl, setTplState] = useStateRc(() => rcLoad(RC_TEMPLATE_KEY, RC_DEFAULT_TEMPLATE));
  const [tick, setTick] = useStateRc(0);
  const [busy, setBusy] = useStateRc(null);
  const [msg, setMsg] = useStateRc(null);
  const [state, setState] = useStateRc({ status: 'loading', data: null, error: null });

  useEffectRc(() => {
    let alive = true;
    setState((s) => ({ ...s, status: 'loading' }));
    window.NSApi.fetchRepurchase(variant, days, { tests })
      .then((data) => { if (alive) setState({ status: 'ready', data, error: null }); })
      .catch((e) => { if (alive) setState({ status: 'error', data: null, error: String(e.message || e) }); });
    return () => { alive = false; };
  }, [variant, days, tests, tick]);

  const setTpl = (v) => { setTplState(v); rcSave(RC_TEMPLATE_KEY, v); };
  const refresh = () => setTick((n) => n + 1);

  if (state.status === 'error') return <ReadState kind="falha" title="Não carregou a lista de recompra">{state.error}</ReadState>;
  const d = state.data;
  if (!d) return <div className="panel"><SkelTableRows rows={6} cols={6}/></div>;

  const rows = d.rows.filter((r) => rcMatches(r, status));
  const chosen = d.rows.filter((r) => selected.has(r.id));
  const target = chosen.length ? chosen : rows;
  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSelected((s) => { const n = new Set(s); rows.forEach((r) => (allOn ? n.delete(r.id) : n.add(r.id))); return n; });
  const longest = target.reduce((m, r) => Math.max(m, rcFill(tpl, r).length), 0);
  const sample = target[0] ? rcFill(tpl, target[0]) : rcFill(tpl, { firstName: 'Elizabeth', link: 'https://checkin.healthnwellnes.com/neurorecall/XXXXXXXXXXXXXXXXXXXXXXXX', product: 'NeuroRecall' });
  const seg = rcSegments(sample.padEnd(Math.max(sample.length, longest), 'x'));

  const generate = async () => {
    setBusy('generate'); setMsg(null);
    try {
      const r = await window.NSApi.postRepurchase({ action: 'generate', variant, withinDays: days });
      setMsg({ ok: r.created ? `${fmtInt(r.created)} link${r.created > 1 ? 's' : ''} novo${r.created > 1 ? 's' : ''} na lista.` : 'Ninguém novo nessa janela: todos já têm link.' });
      refresh();
    } catch (e) { setMsg({ err: String(e.message || e) }); }
    finally { setBusy(null); }
  };
  const markSent = async () => {
    const ids = target.filter((r) => !r.sentAt).map((r) => r.id);
    if (!ids.length) { setMsg({ err: 'Todos os escolhidos já estão marcados como enviados.' }); return; }
    const label = RC_CHANNELS.find((c) => c.id === channel).label;
    if (!window.confirm(`Marcar ${ids.length} pessoa${ids.length > 1 ? 's' : ''} como enviada${ids.length > 1 ? 's' : ''} por ${label}?`)) return;
    setBusy('sent'); setMsg(null);
    try {
      const r = await window.NSApi.postRepurchase({ action: 'sent', ids, channel });
      setMsg({ ok: `${fmtInt(r.marked)} marcado${r.marked > 1 ? 's' : ''} como enviado${r.marked > 1 ? 's' : ''} por ${label}.` });
      setSelected(new Set());
      refresh();
    } catch (e) { setMsg({ err: String(e.message || e) }); }
    finally { setBusy(null); }
  };
  const exportCsv = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    rcDownload(`recompra_${variant}_${days}d_${stamp}.csv`, rcCsv(target, tpl));
  };
  const copyLinks = async () => {
    const ok = await rcCopy(target.map((r) => `${r.firstName || ''}\t${r.smsPhone || ''}\t${r.link}`).join('\n'));
    setMsg(ok ? { ok: `${fmtInt(target.length)} links copiados (nome, telefone e link, um por linha).` } : { err: 'O navegador não deixou copiar.' });
  };

  const k = d.kpis;
  const kpis = [
    { l: 'Na lista', v: fmtInt(k.total), s: `estoque acaba em até ${days} dias ou já acabou` },
    { l: 'Sem envio', v: fmtInt(k.unsent), s: 'ninguém marcou o disparo', tone: k.unsent ? 'var(--warning)' : undefined },
    { l: 'Enviados', v: fmtInt(k.sent), s: k.total ? `${fmtPct(k.sent / k.total, 0)} da lista` : '—' },
    { l: 'Abriram', v: fmtInt(k.opened), s: k.sent ? `${fmtPct(k.opened / k.sent, 0)} dos enviados` : '—' },
    { l: 'Concluíram', v: fmtInt(k.completed), s: k.opened ? `${fmtPct(k.completed / k.opened, 0)} de quem abriu` : '—' },
    { l: 'Compraram', v: fmtInt(k.purchased), s: k.purchased ? rcUsd(k.revenueUsd) : 'venda volta pelo postback', money: k.purchased > 0 },
  ];

  return (
    <div style={{ opacity: state.status === 'loading' ? 0.6 : 1, transition: 'opacity .15s' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <select value={variant} onChange={(e) => { setVariant(e.target.value); setSelected(new Set()); }} aria-label="Pesquisa">
          <option value="all">Todas as pesquisas</option>
          {d.variants.map((v) => <option key={v.slug} value={v.slug}>{v.name}{v.active ? '' : ' (desligada)'}</option>)}
        </select>
        <div className="seg" role="group" aria-label="Janela: dias até o estoque acabar">
          {RC_DAYS.map((n) => <button key={n} className={n === days ? 'is-active' : ''} onClick={() => { setDays(n); setSelected(new Set()); }}>{n} dias</button>)}
        </div>
        <button className="btn" onClick={generate} disabled={busy === 'generate'} title="Cria o link pessoal de quem entrou na janela. Não envia nada.">
          {busy === 'generate' ? 'Gerando…' : `Gerar links (até ${days} dias)`}
        </button>
        <div style={{ flex: 1 }}/>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--fg4)', cursor: 'pointer' }}>
          <input type="checkbox" checked={tests} onChange={(e) => setTests(e.target.checked)}/> Incluir testes
        </label>
      </div>
      {msg && <div style={{ fontSize: 12.5, marginBottom: 10, color: msg.ok ? 'var(--success)' : 'var(--danger)' }}>{msg.ok || `Não deu: ${msg.err}`}</div>}

      <RcKpis items={kpis}/>
      <RcForecast forecast={d.forecast} days={days}/>

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-title">Mensagem do SMS</div>
        <div className="panel-sub" style={{ fontSize: 11, marginBottom: 8 }}>
          Vai na coluna "mensagem" do CSV, já com o nome e o link de cada um. <span className="mono">{'{nome}'}</span> <span className="mono">{'{link}'}</span> <span className="mono">{'{produto}'}</span>. Fica salva neste navegador.
        </div>
        <textarea value={tpl} onChange={(e) => setTpl(e.target.value)} aria-label="Texto do SMS"
          style={{ width: '100%', minHeight: 64, padding: '8px 10px', fontSize: 12.5, color: 'var(--fg1)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, resize: 'vertical' }}/>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--fg4)', marginTop: 4 }}>
          <span>Até {fmtInt(seg.n)} caracteres com nome e link → <b style={{ color: seg.parts > 2 ? 'var(--warning)' : 'var(--fg2)' }}>{seg.parts} parte{seg.parts > 1 ? 's' : ''} de SMS</b></span>
          {!seg.gsm && <span style={{ color: 'var(--warning)' }}>Tem caractere especial (travessão, aspas curvas, emoji…): cada parte cai pra 67 caracteres.</span>}
          {tpl !== RC_DEFAULT_TEMPLATE && <button className="btn btn-ghost" style={{ height: 22, fontSize: 11 }} onClick={() => setTpl(RC_DEFAULT_TEMPLATE)}>Voltar ao padrão</button>}
        </div>
      </div>

      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px', display: 'grid', gap: 10 }}>
          <div className="seg" style={{ flexWrap: 'wrap', height: 'auto', width: 'fit-content' }} role="group" aria-label="Status">
            {RC_STATUS.map((s) => (
              <button key={s.id} className={s.id === status ? 'is-active' : ''} style={{ height: 28 }} onClick={() => setStatus(s.id)}>
                {s.label} ({fmtInt(d.rows.filter((r) => rcMatches(r, s.id)).length)})
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5 }}>
            <span style={{ color: 'var(--fg3)' }}>{chosen.length ? `${fmtInt(chosen.length)} escolhido${chosen.length > 1 ? 's' : ''}` : `Ação vale pros ${fmtInt(rows.length)} da lista abaixo`}</span>
            <button className="btn btn-ghost" onClick={exportCsv} disabled={!target.length}><Icon name="download" size={12}/> Exportar CSV</button>
            <button className="btn btn-ghost" onClick={copyLinks} disabled={!target.length}><Icon name="copy" size={12}/> Copiar links</button>
            <span style={{ width: 1, height: 20, background: 'var(--border)' }}/>
            <select value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Canal do envio">
              {RC_CHANNELS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <button className="btn btn-ghost" onClick={markSent} disabled={busy === 'sent' || !target.some((r) => !r.sentAt)}>
              {busy === 'sent' ? 'Marcando…' : 'Marcar como enviado'}
            </button>
            {chosen.length > 0 && <button className="btn btn-ghost" onClick={() => setSelected(new Set())}>Limpar escolha</button>}
          </div>
        </div>
        {!rows.length ? (
          <div style={{ padding: '0 14px 14px', color: 'var(--fg5)', fontSize: 12 }}>
            {d.rows.length ? 'Ninguém com esse status.' : `Ninguém na lista. Use "Gerar links" pra trazer quem acaba em até ${days} dias.`}
          </div>
        ) : (
          <Paginated items={rows} label="pessoas" resetKey={`${variant}-${days}-${status}-${tests}`}>
            {(page, pager) => (<>
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl" style={{ fontSize: 12.5, minWidth: 940 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 32 }}><input type="checkbox" checked={allOn} onChange={toggleAll} aria-label="Escolher todos da lista"/></th>
                      <th>Cliente</th><th>Telefone</th><th className="num">Frascos</th><th>Estoque acaba</th><th>Status</th><th>Envio</th><th>Link</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.map((r) => (
                      <tr key={r.id}>
                        <td><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Escolher ${r.firstName || r.email}`}/></td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{r.firstName || '—'}{r.isTest && <span className="badge neutral" style={{ marginLeft: 6 }}>teste</span>}</div>
                          <div style={{ color: 'var(--fg4)', fontSize: 11.5 }}>{r.email}</div>
                        </td>
                        <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                          {r.smsPhone || <span style={{ color: 'var(--fg5)' }}>{r.phone ? `${r.phone} (conferir)` : 'sem telefone'}</span>}
                          {r.smsPhoneInferred && <div style={{ fontSize: 10.5, color: 'var(--warning)' }} title="O número veio com 10 dígitos: o +1 foi deduzido">+1 deduzido</div>}
                        </td>
                        <td className="num mono">{r.bottles}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {fmtDateShort(r.stockUntil)}
                          <div style={{ fontSize: 11, color: r.daysLeft < 0 ? 'var(--danger)' : r.daysLeft <= 3 ? 'var(--warning)' : 'var(--fg4)' }}>{rcDaysText(r.daysLeft)}</div>
                        </td>
                        <td>
                          <span className={`badge ${RC_STATUS_TONE[r.status] || ''}`}>{RC_STATUS_LABEL[r.status] || r.status}</span>
                          {r.purchasedUsd > 0 && <div className="mono" style={{ fontSize: 11, color: 'var(--money)', marginTop: 2 }}>{rcUsd(r.purchasedUsd)}</div>}
                        </td>
                        <td style={{ whiteSpace: 'nowrap', color: 'var(--fg3)' }}>
                          {r.sentAt ? <>{RC_CHANNEL_LABEL[r.channel] || r.channel || '—'}<div style={{ fontSize: 11, color: 'var(--fg5)' }}>{fmtDateTime(r.sentAt)}</div></> : '—'}
                        </td>
                        <td><div style={{ display: 'flex', gap: 4 }}>
                          <button className="icon-btn" onClick={() => rcCopy(r.link).then((ok) => setMsg(ok ? { ok: `Link de ${r.firstName || r.email} copiado.` } : { err: 'O navegador não deixou copiar.' }))}
                            aria-label={`Copiar link de ${r.firstName || r.email}`} title="Copiar link"><Icon name="copy" size={12}/></button>
                          <a className="icon-btn" href={r.link} target="_blank" rel="noopener" title="Abrir (conta como aberto pelo cliente — prefira link de teste)"
                            aria-label={`Abrir link de ${r.firstName || r.email}`}
                            onClick={(e) => { if (!r.isTest && !window.confirm('Abrir o link marca como "abriu" na conta do cliente. Abrir mesmo assim?')) e.preventDefault(); }}>
                            <Icon name="external-link" size={12}/>
                          </a>
                        </div></td>
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
    </div>
  );
}

// ---------- assinaturas ----------

const SB_STATUS = [
  { id: 'todas', label: 'Todas' },
  { id: 'active', label: 'Ativas' },
  { id: 'past_due', label: 'Em atraso' },
  { id: 'canceled', label: 'Canceladas' },
];
const SB_STATUS_LABEL = { active: 'Ativa', past_due: 'Em atraso', canceled: 'Cancelada' };
const SB_STATUS_TONE = { active: 'ok', past_due: 'warn', canceled: 'neutral' };

function sbCycle(b) {
  if (!b) return '—';
  return b === 1 ? '1 frasco/mês' : `${b} frascos a cada ${b} meses`;
}

function SbTable({ rows, cols, empty, minWidth = 820 }) {
  if (!rows.length) return <div style={{ padding: '4px 0 6px', color: 'var(--fg5)', fontSize: 12 }}>{empty}</div>;
  const C = {
    cliente: { h: 'Cliente', c: (r) => <><div style={{ fontWeight: 600 }}>{r.name || '—'}{r.fromSurvey && <span className="badge" style={{ marginLeft: 6 }}>pesquisa</span>}</div><div style={{ color: 'var(--fg4)', fontSize: 11.5 }}>{r.email || '—'}</div></> },
    telefone: { h: 'Telefone', c: (r) => <span className="mono">{r.smsPhone || r.phone || '—'}</span> },
    oferta: { h: 'Oferta', c: (r) => <>{r.product || '—'}<div style={{ fontSize: 11, color: 'var(--fg5)' }}>{sbCycle(r.bottles)}</div></> },
    status: { h: 'Status', c: (r) => <span className={`badge ${SB_STATUS_TONE[r.status] || ''}`}>{SB_STATUS_LABEL[r.status] || r.status}</span> },
    valor: { h: 'Cobrança', num: true, c: (r) => <span className="mono">{r.amountUsd != null ? rcUsd(r.amountUsd, 2) : '—'}</span> },
    cobrancas: { h: 'Cobranças', num: true, c: (r) => <span className="mono">{fmtInt(r.chargeCount)}</span> },
    pago: { h: 'Total pago', num: true, c: (r) => <span className="mono" style={{ color: r.totalPaidUsd ? 'var(--money)' : undefined }}>{rcUsd(r.totalPaidUsd)}</span> },
    inicio: { h: 'Início', c: (r) => (r.startedAt ? fmtDateShort(r.startedAt) : '—') },
    proxima: { h: 'Próxima cobrança', c: (r) => (r.nextChargeAt ? <>{fmtDateShort(r.nextChargeAt)}{r.nextChargeEstimated && <div style={{ fontSize: 10.5, color: 'var(--fg5)' }} title="Última cobrança + ciclo da oferta">estimada</div>}</> : '—') },
    falha: { h: 'Falha', c: (r) => <>{r.lastFailedAt ? fmtDateTime(r.lastFailedAt) : '—'}<div style={{ fontSize: 11, color: 'var(--fg5)' }}>{r.lastFailureReason || ''}</div></> },
    tentativa: { h: 'Tentativas', num: true, c: (r) => <span className="mono">{fmtInt(r.failedAttempts)}</span> },
    retry: { h: 'Próxima tentativa', c: (r) => (r.nextRetryAt ? fmtDateTime(r.nextRetryAt) : <span style={{ color: 'var(--fg5)' }}>a Vupim não vai tentar</span>) },
    cancelada: { h: 'Cancelada', c: (r) => (r.canceledAt ? <>{fmtDateShort(r.canceledAt)}<div style={{ fontSize: 11, color: 'var(--fg5)' }}>{r.cancelReason || ''}</div></> : '—') },
  };
  return (
    <Paginated items={rows} label="assinaturas" resetKey={cols.join()}>
      {(page, pager) => (<>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ fontSize: 12.5, minWidth }}>
            <thead><tr>{cols.map((k) => <th key={k} className={C[k].num ? 'num' : undefined}>{C[k].h}</th>)}</tr></thead>
            <tbody>{page.map((r) => <tr key={r.id}>{cols.map((k) => <td key={k} className={C[k].num ? 'num' : undefined}>{C[k].c(r)}</td>)}</tr>)}</tbody>
          </table>
        </div>
        {pager}
      </>)}
    </Paginated>
  );
}

function sbCsv(rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['assinatura', 'status', 'nome', 'email', 'telefone', 'oferta', 'cobranca_usd', 'tentativas', 'falhou_em', 'motivo', 'proxima_tentativa'];
  return '﻿' + [head.join(','), ...rows.map((r) => [
    r.externalId, SB_STATUS_LABEL[r.status], r.name, r.email, r.smsPhone || r.phone, r.product, r.amountUsd,
    r.failedAttempts, r.lastFailedAt, r.lastFailureReason, r.nextRetryAt,
  ].map(esc).join(','))].join('\n');
}

function RcSubscriptions({ filters }) {
  const [status, setStatus] = useStateRc('todas');
  const [q, setQ] = useStateRc('');
  const [state, setState] = useStateRc({ status: 'loading', data: null, error: null });

  useEffectRc(() => {
    let alive = true;
    setState((s) => ({ ...s, status: 'loading' }));
    window.NSApi.fetchSubscriptions(filters)
      .then((data) => { if (alive) setState({ status: 'ready', data, error: null }); })
      .catch((e) => { if (alive) setState({ status: 'error', data: null, error: String(e.message || e) }); });
    return () => { alive = false; };
  }, [filters.dateRange.start, filters.dateRange.end]);

  if (state.status === 'error') return <ReadState kind="falha" title="Não carregou as assinaturas">{state.error}</ReadState>;
  const d = state.data;
  if (!d) return <div className="panel"><SkelTableRows rows={6} cols={6}/></div>;
  const k = d.kpis;

  if (!d.rows.length) {
    return (
      <ReadState kind="vazio" title="Nenhuma assinatura ainda">
        As assinaturas entram sozinhas pelo webhook da Vupim, a partir da primeira cobrança de uma oferta recorrente (as da pesquisa começaram em 28/10).
        No painel da Vupim (Integrações → Webhooks), os eventos <span className="mono">subscription.renewed</span>, <span className="mono">subscription.payment_failed</span> e <span className="mono">subscription.canceled</span> precisam estar marcados.
      </ReadState>
    );
  }

  const needle = q.trim().toLowerCase();
  const rows = d.rows.filter((r) => (status === 'todas' || r.status === status)
    && (!needle || [r.name, r.email, r.smsPhone, r.phone, r.product, r.externalId].some((v) => v && String(v).toLowerCase().includes(needle))));
  const kpis = [
    { l: 'Ativas', v: fmtInt(k.active), s: `${fmtInt(k.fromSurvey)} vieram da pesquisa` },
    { l: 'Receita mensal recorrente', v: rcUsd(k.mrrUsd), s: 'ativas, cobrança ÷ meses do ciclo', money: k.mrrUsd > 0 },
    { l: 'Em atraso', v: fmtInt(k.pastDue), s: 'renovação não cobrada', tone: k.pastDue ? 'var(--warning)' : undefined },
    { l: 'Novas no período', v: fmtInt(k.newInPeriod), s: '1ª cobrança no período' },
    { l: 'Renovações no período', v: fmtInt(k.renewalsInPeriod), s: k.renewalsInPeriod ? rcUsd(k.renewalsUsd) : `${fmtInt(k.failedInPeriod)} com falha`, money: k.renewalsUsd > 0 },
    { l: 'Canceladas no período', v: fmtInt(k.canceledInPeriod), s: k.churn != null ? `churn ${fmtPct(k.churn, 1)} das ativas no início` : '—', tone: k.canceledInPeriod ? 'var(--danger)' : undefined },
  ];

  return (
    <div style={{ opacity: state.status === 'loading' ? 0.6 : 1, transition: 'opacity .15s' }}>
      <RcKpis items={kpis}/>

      <div className="panel" style={{ marginBottom: 12, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="panel-title">Pagamentos que falharam</div>
            <div className="panel-sub" style={{ fontSize: 11 }}>Renovação não cobrada (cartão recusado, sem saldo…). É a lista de recuperação: um SMS pedindo pra atualizar o cartão costuma salvar a assinatura.</div>
          </div>
          <button className="btn btn-ghost" disabled={!d.pastDue.length} onClick={() => rcDownload(`assinaturas_em_atraso_${new Date().toISOString().slice(0, 10)}.csv`, sbCsv(d.pastDue))}>
            <Icon name="download" size={12}/> Exportar
          </button>
        </div>
        <div style={{ padding: '0 14px 12px' }}>
          <SbTable rows={d.pastDue} cols={['cliente', 'telefone', 'oferta', 'valor', 'falha', 'tentativa', 'retry']} empty="Nenhuma assinatura em atraso."/>
        </div>
      </div>

      <div>
        <div className="panel" style={{ marginBottom: 12 }}>
          <div className="panel-title">Próximas cobranças</div>
          <div className="panel-sub" style={{ fontSize: 11, marginBottom: 10 }}>Nos próximos 14 dias. "Estimada" = última cobrança + ciclo da oferta (a Vupim só manda a data no aviso de renovação).</div>
          <SbTable rows={d.upcoming} cols={['cliente', 'oferta', 'valor', 'proxima']} minWidth={0} empty="Nenhuma cobrança nos próximos 14 dias."/>
        </div>
        <div className="panel" style={{ marginBottom: 12 }}>
          <div className="panel-title">Por oferta</div>
          <div className="panel-sub" style={{ fontSize: 11, marginBottom: 10 }}>Situação de agora; total pago desde o início.</div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl" style={{ fontSize: 12.5 }}>
              <thead><tr><th>Oferta</th><th className="num">Ativas</th><th className="num">Em atraso</th><th className="num">Canceladas</th><th className="num">Mensal</th><th className="num">Total pago</th></tr></thead>
              <tbody>
                {d.byOffer.map((o) => (
                  <tr key={o.offer}>
                    <td style={{ fontWeight: 500 }}>{o.offer}</td>
                    <td className="num mono">{fmtInt(o.active)}</td>
                    <td className="num mono">{fmtInt(o.pastDue)}</td>
                    <td className="num mono">{fmtInt(o.canceled)}</td>
                    <td className="num mono" style={{ color: 'var(--money)' }}>{rcUsd(o.mrrUsd)}</td>
                    <td className="num mono">{rcUsd(o.totalPaidUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px', display: 'grid', gap: 10 }}>
          <div>
            <div className="panel-title">Todas as assinaturas</div>
            <div className="panel-sub" style={{ fontSize: 11 }}>Cancelar, pausar ou trocar o plano é no painel da Vupim (ela não tem API). O que mudar lá chega aqui pelo webhook.</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="seg" role="group" aria-label="Status">
              {SB_STATUS.map((s) => (
                <button key={s.id} className={s.id === status ? 'is-active' : ''} onClick={() => setStatus(s.id)}>
                  {s.label} ({fmtInt(s.id === 'todas' ? d.rows.length : d.rows.filter((r) => r.status === s.id).length)})
                </button>
              ))}
            </div>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome, e-mail, telefone, oferta…" aria-label="Buscar assinatura"
              style={{ minWidth: 240, padding: '6px 10px', fontSize: 12.5, color: 'var(--fg1)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6 }}/>
          </div>
        </div>
        <div style={{ padding: '0 14px 12px' }}>
          <SbTable rows={rows} cols={['cliente', 'oferta', 'status', 'valor', 'cobrancas', 'pago', 'inicio', 'proxima', 'cancelada']} empty="Nenhuma assinatura com esse filtro."/>
        </div>
      </div>
    </div>
  );
}

// ---------- página ----------

const RC_SECTIONS = [
  { id: 'recompra', label: 'Lista de recompra' },
  { id: 'assinaturas', label: 'Assinaturas' },
];

function RecurrencesPage({ filters, user }) {
  const [section, setSectionState] = useStateRc(() => rcLoad(RC_SECTION_KEY, 'recompra'));
  const sec = RC_SECTIONS.some((s) => s.id === section) ? section : 'recompra';
  const setSection = (id) => { setSectionState(id); rcSave(RC_SECTION_KEY, id); };
  return (
    <div className="page-in">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="seg" role="tablist" aria-label="Seções da aba Recorrências">
          {RC_SECTIONS.map((s) => (
            <button key={s.id} role="tab" aria-selected={s.id === sec} className={s.id === sec ? 'is-active' : ''} onClick={() => setSection(s.id)}>{s.label}</button>
          ))}
        </div>
        <span style={{ fontSize: 11.5, color: 'var(--fg5)' }}>
          {sec === 'recompra' ? 'Antes da recompra: quem recebe o link da pesquisa. A janela é em dias até o estoque acabar (o período do topo não vale aqui).'
            : 'Depois da recompra: assinaturas da Vupim. O período do topo vale pra novas, renovações e cancelamentos.'}
        </span>
      </div>
      {sec === 'recompra' ? <RcRepurchase user={user}/> : <RcSubscriptions filters={filters}/>}
    </div>
  );
}

Object.assign(window, { RecurrencesPage });
