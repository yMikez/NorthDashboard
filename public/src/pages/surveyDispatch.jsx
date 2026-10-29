/* global React, Icon, fmtCurrency, fmtInt, fmtPct, fmtDateTime, fmtDateShort, SkelTableRows, Paginated, ReadState */
/* Aba Pesquisas → Disparos: quem está com o estoque acabando, com o link
   pessoal da pesquisa e o telefone pronto pro SMS. Gera os links da janela,
   marca o envio por canal, exporta o lote e mostra quem ainda vai entrar.
   (Morava na aba Recorrências até 29/10/2026.)
   API: /api/metrics/surveys/repurchase */

const { useState: useStateDp, useEffect: useEffectDp } = React;

// Chave antiga de propósito: o texto que cada um salvou continua lá.
const DP_TEMPLATE_KEY = 'ns.recurrences.smsTemplate';
const DP_DEFAULT_TEMPLATE = 'NeuroRecall: Hi {nome}, your bottle is almost done. Take our 1-min check-in and get your returning-customer price: {link} Reply STOP to opt out';
const DP_DAYS = [7, 14, 21, 30];
const DP_STATUS = [
  { id: 'todos', label: 'Todos' },
  { id: 'sem_envio', label: 'Sem envio' },
  { id: 'enviado', label: 'Enviados' },
  { id: 'abriu', label: 'Abriram' },
  { id: 'concluiu', label: 'Concluíram' },
  { id: 'comprou', label: 'Compraram' },
];
const DP_STATUS_LABEL = { pendente: 'Na lista', enviado: 'Enviado', abriu: 'Abriu', respondeu: 'Respondendo', concluiu: 'Concluiu', comprou: 'Comprou' };
const DP_STATUS_TONE = { pendente: 'neutral', enviado: '', abriu: '', respondeu: 'warn', concluiu: 'ok', comprou: 'ok' };
const DP_CHANNELS = [{ id: 'sms', label: 'SMS' }, { id: 'email', label: 'E-mail' }, { id: 'whatsapp', label: 'WhatsApp' }];
const DP_CHANNEL_LABEL = { sms: 'SMS', email: 'E-mail', whatsapp: 'WhatsApp', manual: 'Manual' };
const dpUsd = (n, d = 0) => fmtCurrency(n, 'USD', d);

function dpLoad(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function dpSave(key, value) {
  try { localStorage.setItem(key, value); } catch { /* sem storage: só não lembra */ }
}

/** Caracteres que cabem no SMS comum (GSM-7). Fora disso, cada parte cai de 153 pra 67. */
const DP_GSM_RE = /^[A-Za-z0-9 \n\r@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/;
function dpSegments(text) {
  const gsm = DP_GSM_RE.test(text);
  const n = text.length;
  const parts = gsm ? (n <= 160 ? 1 : Math.ceil(n / 153)) : (n <= 70 ? 1 : Math.ceil(n / 67));
  return { gsm, n, parts };
}
const dpFill = (tpl, r) => tpl.replace(/\{nome\}/g, r.firstName || 'there').replace(/\{link\}/g, r.link).replace(/\{produto\}/g, r.product);

function dpCsv(rows, tpl) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['convite_id', 'nome', 'telefone', 'telefone_ddi_deduzido', 'email', 'produto', 'frascos', 'estoque_acaba', 'dias_restantes', 'status', 'link', 'mensagem'];
  const lines = rows.map((r) => [
    r.id, r.firstName || '', r.smsPhone || '', r.smsPhoneInferred ? 'sim' : '', r.email, r.product, r.bottles,
    r.stockUntil.slice(0, 10), r.daysLeft, DP_STATUS_LABEL[r.status] || r.status, r.link, dpFill(tpl, r),
  ].map(esc).join(','));
  return '﻿' + [head.join(','), ...lines].join('\n');
}

function dpDownload(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function dpCopy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

function dpDaysText(d) {
  if (d > 1) return `em ${d} dias`;
  if (d === 1) return 'amanhã';
  if (d === 0) return 'hoje';
  return `acabou há ${-d} dia${d === -1 ? '' : 's'}`;
}

function DpKpis({ items }) {
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

function dpMatches(r, f) {
  if (f === 'todos') return true;
  if (f === 'sem_envio') return !r.sentAt;
  if (f === 'enviado') return Boolean(r.sentAt);
  if (f === 'abriu') return Boolean(r.openedAt);
  if (f === 'concluiu') return r.status === 'concluiu' || r.status === 'comprou';
  return r.status === f;
}

function DpForecast({ forecast, days }) {
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

function SvDispatch() {
  const [variant, setVariant] = useStateDp('all');
  const [days, setDays] = useStateDp(14);
  const [tests, setTests] = useStateDp(false);
  const [status, setStatus] = useStateDp('todos');
  const [selected, setSelected] = useStateDp(() => new Set());
  const [channel, setChannel] = useStateDp('sms');
  const [tpl, setTplState] = useStateDp(() => dpLoad(DP_TEMPLATE_KEY, DP_DEFAULT_TEMPLATE));
  const [tick, setTick] = useStateDp(0);
  const [busy, setBusy] = useStateDp(null);
  const [msg, setMsg] = useStateDp(null);
  const [state, setState] = useStateDp({ status: 'loading', data: null, error: null });

  useEffectDp(() => {
    let alive = true;
    setState((s) => ({ ...s, status: 'loading' }));
    window.NSApi.fetchRepurchase(variant, days, { tests })
      .then((data) => { if (alive) setState({ status: 'ready', data, error: null }); })
      .catch((e) => { if (alive) setState({ status: 'error', data: null, error: String(e.message || e) }); });
    return () => { alive = false; };
  }, [variant, days, tests, tick]);

  const setTpl = (v) => { setTplState(v); dpSave(DP_TEMPLATE_KEY, v); };
  const refresh = () => setTick((n) => n + 1);

  if (state.status === 'error') return <ReadState kind="falha" title="Não carregou a lista de recompra">{state.error}</ReadState>;
  const d = state.data;
  if (!d) return <div className="panel"><SkelTableRows rows={6} cols={6}/></div>;

  const rows = d.rows.filter((r) => dpMatches(r, status));
  const chosen = d.rows.filter((r) => selected.has(r.id));
  const target = chosen.length ? chosen : rows;
  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSelected((s) => { const n = new Set(s); rows.forEach((r) => (allOn ? n.delete(r.id) : n.add(r.id))); return n; });
  const longest = target.reduce((m, r) => Math.max(m, dpFill(tpl, r).length), 0);
  const sample = target[0] ? dpFill(tpl, target[0]) : dpFill(tpl, { firstName: 'Elizabeth', link: 'https://checkin.healthnwellnes.com/neurorecall/XXXXXXXXXXXXXXXXXXXXXXXX', product: 'NeuroRecall' });
  const seg = dpSegments(sample.padEnd(Math.max(sample.length, longest), 'x'));

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
    const label = DP_CHANNELS.find((c) => c.id === channel).label;
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
    dpDownload(`recompra_${variant}_${days}d_${stamp}.csv`, dpCsv(target, tpl));
  };
  const copyLinks = async () => {
    const ok = await dpCopy(target.map((r) => `${r.firstName || ''}\t${r.smsPhone || ''}\t${r.link}`).join('\n'));
    setMsg(ok ? { ok: `${fmtInt(target.length)} links copiados (nome, telefone e link, um por linha).` } : { err: 'O navegador não deixou copiar.' });
  };

  const k = d.kpis;
  const kpis = [
    { l: 'Na lista', v: fmtInt(k.total), s: `estoque acaba em até ${days} dias ou já acabou` },
    { l: 'Sem envio', v: fmtInt(k.unsent), s: 'ninguém marcou o disparo', tone: k.unsent ? 'var(--warning)' : undefined },
    { l: 'Enviados', v: fmtInt(k.sent), s: k.total ? `${fmtPct(k.sent / k.total, 0)} da lista` : '—' },
    { l: 'Abriram', v: fmtInt(k.opened), s: k.sent ? `${fmtPct(k.opened / k.sent, 0)} dos enviados` : '—' },
    { l: 'Concluíram', v: fmtInt(k.completed), s: k.opened ? `${fmtPct(k.completed / k.opened, 0)} de quem abriu` : '—' },
    { l: 'Compraram', v: fmtInt(k.purchased), s: k.purchased ? dpUsd(k.revenueUsd) : 'venda volta pelo postback', money: k.purchased > 0 },
  ];

  return (
    <div style={{ opacity: state.status === 'loading' ? 0.6 : 1, transition: 'opacity .15s' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <select value={variant} onChange={(e) => { setVariant(e.target.value); setSelected(new Set()); }} aria-label="Pesquisa">
          <option value="all">Todas as pesquisas</option>
          {d.variants.map((v) => <option key={v.slug} value={v.slug}>{v.name}{v.active ? '' : ' (desligada)'}</option>)}
        </select>
        <div className="seg" role="group" aria-label="Janela: dias até o estoque acabar">
          {DP_DAYS.map((n) => <button key={n} className={n === days ? 'is-active' : ''} onClick={() => { setDays(n); setSelected(new Set()); }}>{n} dias</button>)}
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

      <DpKpis items={kpis}/>
      <DpForecast forecast={d.forecast} days={days}/>

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
          {tpl !== DP_DEFAULT_TEMPLATE && <button className="btn btn-ghost" style={{ height: 22, fontSize: 11 }} onClick={() => setTpl(DP_DEFAULT_TEMPLATE)}>Voltar ao padrão</button>}
        </div>
      </div>

      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px', display: 'grid', gap: 10 }}>
          <div className="seg" style={{ flexWrap: 'wrap', height: 'auto', width: 'fit-content' }} role="group" aria-label="Status">
            {DP_STATUS.map((s) => (
              <button key={s.id} className={s.id === status ? 'is-active' : ''} style={{ height: 28 }} onClick={() => setStatus(s.id)}>
                {s.label} ({fmtInt(d.rows.filter((r) => dpMatches(r, s.id)).length)})
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5 }}>
            <span style={{ color: 'var(--fg3)' }}>{chosen.length ? `${fmtInt(chosen.length)} escolhido${chosen.length > 1 ? 's' : ''}` : `Ação vale pros ${fmtInt(rows.length)} da lista abaixo`}</span>
            <button className="btn btn-ghost" onClick={exportCsv} disabled={!target.length}><Icon name="download" size={12}/> Exportar CSV</button>
            <button className="btn btn-ghost" onClick={copyLinks} disabled={!target.length}><Icon name="copy" size={12}/> Copiar links</button>
            <span style={{ width: 1, height: 20, background: 'var(--border)' }}/>
            <select value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Canal do envio">
              {DP_CHANNELS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
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
                          <div style={{ fontSize: 11, color: r.daysLeft < 0 ? 'var(--danger)' : r.daysLeft <= 3 ? 'var(--warning)' : 'var(--fg4)' }}>{dpDaysText(r.daysLeft)}</div>
                        </td>
                        <td>
                          <span className={`badge ${DP_STATUS_TONE[r.status] || ''}`}>{DP_STATUS_LABEL[r.status] || r.status}</span>
                          {r.purchasedUsd > 0 && <div className="mono" style={{ fontSize: 11, color: 'var(--money)', marginTop: 2 }}>{dpUsd(r.purchasedUsd)}</div>}
                        </td>
                        <td style={{ whiteSpace: 'nowrap', color: 'var(--fg3)' }}>
                          {r.sentAt ? <>{DP_CHANNEL_LABEL[r.channel] || r.channel || '—'}<div style={{ fontSize: 11, color: 'var(--fg5)' }}>{fmtDateTime(r.sentAt)}</div></> : '—'}
                        </td>
                        <td><div style={{ display: 'flex', gap: 4 }}>
                          <button className="icon-btn" onClick={() => dpCopy(r.link).then((ok) => setMsg(ok ? { ok: `Link de ${r.firstName || r.email} copiado.` } : { err: 'O navegador não deixou copiar.' }))}
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

Object.assign(window, { SvDispatch });
