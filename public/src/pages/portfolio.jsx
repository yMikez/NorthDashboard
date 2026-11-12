/* global React, Icon, fmtCurrency, fmtInt, fmtDateShort, platBadge, Paginated, CopyKpi */
/* Carteira de afiliados (2026-11-12): equipe de captação (Gerente > Squad
   Leader > Hunter), dono de cada afiliado (a PESSOA, todas as contas dela),
   fila de afiliados sem dono, pedidos de reivindicação e histórico.
   Dados: GET/POST /api/metrics/portfolio (lib/portfolio/service.ts).

   Quem tem função vê só a própria carteira e a equipe abaixo — aqui e em
   todas as abas de vendas (o servidor recorta). "Ver nas abas" aplica o
   filtro global Afiliado = carteira do captador (chave c:<id>). */

const { useState: useStatePf, useEffect: useEffectPf } = React;

const PF_SECTIONS = [
  { id: 'equipe', label: 'Equipe' },
  { id: 'carteira', label: 'Afiliados da carteira' },
  { id: 'sem-dono', label: 'Sem dono' },
  { id: 'pedidos', label: 'Pedidos' },
  { id: 'historico', label: 'Histórico' },
];
const PF_ROLE_SHORT = { AFF_MANAGER: 'Gerente', SQUAD_LEADER: 'Squad Leader', HUNTER: 'Hunter' };
const PF_KIND = { assign: 'atribuído', transfer: 'transferido', claim: 'pedido aprovado', release: 'liberado', merge: 'unificação de contas' };
const PF_INPUT = {
  padding: '6px 9px', fontSize: 12, color: 'var(--fg1)', background: 'var(--bg)',
  border: '1px solid var(--border)', borderRadius: 6, minWidth: 0,
};

// Navegação COM reload: os filtros globais são lidos da URL só no boot.
function pfGo(route, extra) {
  const params = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(extra)) { if (v == null || v === '') params.delete(k); else params.set(k, v); }
  const qs = params.toString();
  window.location.assign('/' + route + (qs ? '?' + qs : ''));
}

function pfDelta(cur, prev) {
  if (!prev) return cur > 0 ? { text: 'novo', tone: 'var(--success)' } : null;
  const d = (cur - prev) / prev;
  if (Math.abs(d) > 9.99) return null;
  return { text: `${d >= 0 ? '+' : ''}${(d * 100).toFixed(0)}%`, tone: d >= 0 ? 'var(--success)' : 'var(--danger)' };
}
function PfDelta({ cur, prev }) {
  const d = pfDelta(cur, prev);
  if (!d) return <span style={{ color: 'var(--fg5)' }}>—</span>;
  return <span style={{ color: d.tone, fontFamily: 'var(--f-mono)', fontSize: 11 }}>{d.text}</span>;
}
function PfPlats({ list }) {
  return <>{(list || []).map((s) => { const pb = platBadge(s); return <span key={s} className={`plat ${pb.cls}`} style={{ marginRight: 3 }}>{pb.short}</span>; })}</>;
}
function pfDay(iso) { return iso ? fmtDateShort(iso.slice(0, 10)) : '—'; }

function PortfolioPage() {
  const [state, setState] = useStatePf({ status: 'loading', data: null, error: null });
  const [section, setSection] = useStatePf('equipe');
  const [bump, setBump] = useStatePf(0);
  const [busy, setBusy] = useStatePf(null);
  const [msg, setMsg] = useStatePf(null);

  useEffectPf(() => {
    let cancelled = false;
    window.NSApi.fetchPortfolio()
      .then((data) => { if (!cancelled) setState({ status: 'ready', data, error: null }); })
      .catch((err) => { if (!cancelled) setState({ status: 'error', data: null, error: err.message }); });
    return () => { cancelled = true; };
  }, [bump]);

  async function act(body, done) {
    setBusy(body.claimId || body.key || body.action);
    setMsg(null);
    try {
      await window.NSApi.portfolioAction(body);
      setMsg({ ok: true, text: done });
      setBump((n) => n + 1);
    } catch (err) {
      setMsg({ ok: false, text: err.message || 'falhou' });
    } finally {
      setBusy(null);
    }
  }

  if (state.status === 'loading' && !state.data) {
    return <div className="page-in"><div className="panel" style={{ color: 'var(--fg5)', fontSize: 12 }}>Carregando a carteira…</div></div>;
  }
  if (state.status === 'error') {
    return <div className="page-in"><div className="panel" style={{ color: 'var(--danger)' }}><Icon name="alert-triangle" size={14}/> Erro: {state.error}</div></div>;
  }
  const d = state.data;
  const pending = d.claims.filter((c) => c.status === 'PENDING');
  const toDecide = pending.filter((c) => c.canDecide).length;
  const counts = {
    equipe: d.members.length, carteira: d.affiliates.length, 'sem-dono': d.unowned.length,
    pedidos: pending.length, historico: d.history.length,
  };

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">{d.me.scoped ? `${d.me.roleLabel} · sua carteira e a equipe abaixo` : 'Operação · todas as carteiras'}</span>
          <h2>Carteira <em>de afiliados</em></h2>
          <span className="sub">
            Vendas aprovadas, sem venda de rede · últimos 30 dias até {pfDay(d.range.end)} (vs os 30 anteriores)
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 12 }}>
        <CopyKpi label="Afiliados na carteira" value={fmtInt(d.totals.affiliates)} sub={`${fmtInt(d.totals.active30d)} venderam nos 30 dias`}/>
        <CopyKpi label="Receita 30 dias" value={fmtCurrency(d.totals.revenue30d, 'USD', 0)}
          sub={(() => { const x = pfDelta(d.totals.revenue30d, d.totals.revenuePrev30d); return x ? `${x.text} vs 30 anteriores` : 'sem base anterior'; })()}/>
        <CopyKpi label="Receita 7 dias" value={fmtCurrency(d.totals.revenue7d, 'USD', 0)} sub={`${fmtInt(d.totals.fe30d)} vendas de front em 30 dias`}/>
        <CopyKpi label="Sem dono (90 dias)" value={fmtInt(d.unowned.length)} sub={d.me.canClaim ? 'peça os que você trouxe' : 'atribua a um captador'}/>
        <CopyKpi label="Pedidos em análise" value={fmtInt(pending.length)} tone={toDecide ? 'danger' : undefined}
          sub={toDecide ? `${fmtInt(toDecide)} esperando você` : 'nada esperando você'}/>
      </div>

      <div className="seg" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        {PF_SECTIONS.map((s) => (
          <button key={s.id} className={section === s.id ? 'is-active' : ''} onClick={() => setSection(s.id)}>
            {s.label}{counts[s.id] ? ` · ${fmtInt(counts[s.id])}` : ''}
          </button>
        ))}
      </div>

      {msg && (
        <div className="panel" style={{ marginBottom: 10, padding: '8px 12px', fontSize: 12, color: msg.ok ? 'var(--success)' : 'var(--danger)' }}>
          {msg.text}
        </div>
      )}

      {section === 'equipe' && <PfTeam d={d}/>}
      {section === 'carteira' && <PfAffiliates d={d} busy={busy} act={act}/>}
      {section === 'sem-dono' && <PfUnowned d={d} busy={busy} act={act}/>}
      {section === 'pedidos' && <PfClaims d={d} busy={busy} act={act}/>}
      {section === 'historico' && <PfHistory d={d}/>}
    </div>
  );
}

// ---------- Equipe: desempenho por captador ----------
function PfTeam({ d }) {
  const stats = new Map(d.members.map((m) => [m.userId, m]));
  const rows = [];
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      rows.push({ node: n, depth, m: stats.get(n.id) });
      walk(n.children, depth + 1);
    }
  };
  walk(d.team, 0);
  if (!rows.length) {
    return (
      <div className="panel" style={{ fontSize: 12, color: 'var(--fg4)' }}>
        Ninguém tem função na carteira ainda. Em <strong>Usuários</strong>, marque a função (Gerente, Squad Leader ou Hunter),
        a quem a pessoa responde e a região.
      </div>
    );
  }
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="panel-head" style={{ padding: '12px 14px 0' }}>
        <div className="panel-title">Desempenho por captador</div>
      </div>
      <div style={{ padding: '2px 14px 8px', fontSize: 11, color: 'var(--fg5)' }}>
        "Com equipe" soma o captador e todos abaixo dele. "Ver" abre a Análise filtrada pela carteira dele.
      </div>
      <Paginated items={rows} label="captadores">
        {(page, pager) => (<>
          <div className="tbl-wrap" style={{ margin: 0, padding: '0 4px' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Captador</th>
                  <th className="num">Afiliados</th>
                  <th className="num">Venderam 30d</th>
                  <th className="num">Receita 30d</th>
                  <th className="num">vs anterior</th>
                  <th className="num">Receita 7d</th>
                  <th className="num">Com equipe 30d</th>
                  <th className="num">Novos 30d</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {page.map(({ node, depth, m }) => (
                  <tr key={node.id} style={{ opacity: node.active ? 1 : 0.55 }}>
                    <td>
                      <div style={{ paddingLeft: depth * 18, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {depth > 0 && <span style={{ color: 'var(--fg5)' }}>└</span>}
                        <span style={{ fontWeight: 600 }}>{node.name}</span>
                        <span className="badge" style={{ color: 'var(--fg3)', borderColor: 'var(--border)' }}>{PF_ROLE_SHORT[node.role]}</span>
                        {node.region && <span style={{ fontSize: 11, color: 'var(--fg4)' }}>{node.region}</span>}
                        {!node.active && <span style={{ fontSize: 11, color: 'var(--warning)' }}>inativo</span>}
                      </div>
                    </td>
                    <td className="num">{m ? fmtInt(m.affiliates) : '—'}{m && m.team.affiliates !== m.affiliates ? <span style={{ color: 'var(--fg5)', fontSize: 11 }}> / {fmtInt(m.team.affiliates)}</span> : null}</td>
                    <td className="num">{m ? fmtInt(m.active30d) : '—'}</td>
                    <td className="num" style={{ color: 'var(--money)' }}>{m ? fmtCurrency(m.revenue30d, 'USD', 0) : '—'}</td>
                    <td className="num">{m ? <PfDelta cur={m.revenue30d} prev={m.revenuePrev30d}/> : '—'}</td>
                    <td className="num">{m ? fmtCurrency(m.revenue7d, 'USD', 0) : '—'}</td>
                    <td className="num">
                      {m ? <>{fmtCurrency(m.team.revenue30d, 'USD', 0)} <PfDelta cur={m.team.revenue30d} prev={m.team.revenuePrev30d}/></> : '—'}
                    </td>
                    <td className="num">{m ? fmtInt(m.added30d) : '—'}</td>
                    <td>
                      <button className="btn btn-ghost" style={{ padding: '3px 8px' }} title="Abrir a Análise filtrada pela carteira dele (e da equipe abaixo)"
                        onClick={() => pfGo('affiliate-analysis', { aff: `c:${node.id}` })}>Ver</button>
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
  );
}

// ---------- Afiliados da carteira ----------
function PfOwnerSelect({ d, value, onChange, exclude }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...PF_INPUT, maxWidth: 190 }}>
      <option value="">escolher captador…</option>
      {d.assignable.filter((a) => a.id !== exclude).map((a) => <option key={a.id} value={a.id}>{a.name} · {a.roleLabel}</option>)}
    </select>
  );
}

function PfAffiliates({ d, busy, act }) {
  const [q, setQ] = useStatePf('');
  const [owner, setOwner] = useStatePf('');
  const [target, setTarget] = useStatePf({});
  const owners = Array.from(new Map(d.affiliates.map((a) => [a.ownerId, a.ownerName])).entries()).sort((a, b) => a[1].localeCompare(b[1]));
  const ql = q.trim().toLowerCase();
  const rows = d.affiliates.filter((a) => (!owner || a.ownerId === owner) && (!ql || a.name.toLowerCase().includes(ql)));
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div style={{ display: 'flex', gap: 8, padding: '12px 14px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar afiliado" style={{ ...PF_INPUT, width: 220 }}/>
        {owners.length > 1 && (
          <select value={owner} onChange={(e) => setOwner(e.target.value)} style={PF_INPUT}>
            <option value="">Todos os captadores</option>
            {owners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}
        <span style={{ fontSize: 11, color: 'var(--fg5)' }}>Dono = a pessoa: todas as contas dela, em qualquer plataforma.</span>
      </div>
      {rows.length === 0
        ? <div style={{ padding: '0 14px 14px', fontSize: 12, color: 'var(--fg4)' }}>Nenhum afiliado {d.affiliates.length ? 'nesse filtro' : 'na carteira ainda — veja a aba Sem dono'}.</div>
        : (
          <Paginated items={rows} label="afiliados" resetKey={`${q}|${owner}`}>
            {(page, pager) => (<>
              <div className="tbl-wrap" style={{ margin: 0, padding: '0 4px' }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Afiliado</th><th>Dono</th><th>Desde</th>
                      <th className="num">Receita 30d</th><th className="num">vs anterior</th><th className="num">7d</th>
                      <th>Última venda</th>{d.me.canAssign && <th>Transferir</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {page.map((a) => (
                      <tr key={a.partnerId}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{a.name}</div>
                          <div><PfPlats list={a.platforms}/>{a.accounts > 1 && <span style={{ fontSize: 11, color: 'var(--fg5)' }}>{a.accounts} contas</span>}</div>
                        </td>
                        <td>{a.ownerName}</td>
                        <td className="cell-mono" style={{ fontSize: 11 }}>{pfDay(a.ownerSince)}</td>
                        <td className="num" style={{ color: 'var(--money)' }}>{fmtCurrency(a.revenue30d, 'USD', 0)}</td>
                        <td className="num"><PfDelta cur={a.revenue30d} prev={a.revenuePrev30d}/></td>
                        <td className="num">{fmtCurrency(a.revenue7d, 'USD', 0)}</td>
                        <td className="cell-mono" style={{ fontSize: 11 }}>{pfDay(a.lastSaleAt)}</td>
                        {d.me.canAssign && (
                          <td>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <PfOwnerSelect d={d} value={target[a.partnerId] || ''} exclude={a.ownerId}
                                onChange={(v) => setTarget((t) => ({ ...t, [a.partnerId]: v }))}/>
                              <button className="btn btn-ghost" style={{ padding: '3px 8px' }}
                                disabled={!target[a.partnerId] || busy === `partner:${a.partnerId}`}
                                onClick={() => act({ action: 'assign', key: `partner:${a.partnerId}`, ownerUserId: target[a.partnerId] }, `${a.name} transferido.`)}>
                                Mover
                              </button>
                              <button className="btn btn-ghost" style={{ padding: '3px 8px', color: 'var(--fg4)' }} title="Tirar da carteira (volta pra Sem dono)"
                                disabled={busy === `partner:${a.partnerId}`}
                                onClick={() => { if (window.confirm(`Tirar ${a.name} da carteira de ${a.ownerName}?`)) act({ action: 'release', key: `partner:${a.partnerId}` }, `${a.name} voltou pra Sem dono.`); }}>
                                Liberar
                              </button>
                            </div>
                          </td>
                        )}
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

// ---------- Sem dono: pedir ou atribuir ----------
function PfUnowned({ d, busy, act }) {
  const [q, setQ] = useStatePf('');
  const [target, setTarget] = useStatePf({});
  const ql = q.trim().toLowerCase();
  const rows = d.unowned.filter((u) => !ql || u.name.toLowerCase().includes(ql));
  const selfAssign = d.me.scoped && d.me.canAssign; // SL/Gerente pegam direto pra si
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div style={{ display: 'flex', gap: 8, padding: '12px 14px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar afiliado" style={{ ...PF_INPUT, width: 220 }}/>
        <span style={{ fontSize: 11, color: 'var(--fg5)' }}>
          Afiliados com venda nos últimos 90 dias e sem captador. Afiliado só aparece aqui depois da 1ª venda.
          {d.me.scoped && !d.me.canAssign && ' Seu pedido vai pro seu Squad Leader aprovar.'}
        </span>
      </div>
      {rows.length === 0
        ? <div style={{ padding: '0 14px 14px', fontSize: 12, color: 'var(--fg4)' }}>Nenhum afiliado sem dono{ql ? ' nessa busca' : ''}.</div>
        : (
          <Paginated items={rows} label="afiliados" resetKey={q}>
            {(page, pager) => (<>
              <div className="tbl-wrap" style={{ margin: 0, padding: '0 4px' }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Afiliado</th><th>1ª venda</th><th>Última venda</th>
                      {!d.me.scoped && <th className="num">Receita 30d</th>}
                      <th>Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.map((u) => (
                      <tr key={u.key}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{u.name}</div>
                          <div><PfPlats list={u.platforms}/>{u.accounts > 1 && <span style={{ fontSize: 11, color: 'var(--fg5)' }}>{u.accounts} contas</span>}</div>
                        </td>
                        <td className="cell-mono" style={{ fontSize: 11 }}>{pfDay(u.firstSeenAt)}</td>
                        <td className="cell-mono" style={{ fontSize: 11 }}>{pfDay(u.lastSaleAt)}</td>
                        {!d.me.scoped && <td className="num" style={{ color: 'var(--money)' }}>{fmtCurrency(u.revenue30d || 0, 'USD', 0)}</td>}
                        <td>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                            {u.pendingClaim && (
                              <span style={{ fontSize: 11, color: 'var(--warning)' }}>pedido de {u.pendingClaim.userName}</span>
                            )}
                            {d.me.canClaim && !selfAssign && !u.pendingClaim && (
                              <button className="btn btn-primary" style={{ padding: '3px 10px' }} disabled={busy === u.key}
                                onClick={() => {
                                  const note = window.prompt(`Pedir ${u.name} pra sua carteira. Como você trouxe esse afiliado? (opcional)`, '');
                                  if (note === null) return;
                                  act({ action: 'claim', key: u.key, note }, `Pedido de ${u.name} enviado pro seu líder.`);
                                }}>
                                Pedir
                              </button>
                            )}
                            {selfAssign && (
                              <button className="btn btn-primary" style={{ padding: '3px 10px' }} disabled={busy === u.key}
                                onClick={() => act({ action: 'assign', key: u.key, ownerUserId: d.me.id }, `${u.name} entrou na sua carteira.`)}>
                                Pegar pra mim
                              </button>
                            )}
                            {d.me.canAssign && (
                              <>
                                <PfOwnerSelect d={d} value={target[u.key] || ''} exclude={d.me.scoped ? d.me.id : null}
                                  onChange={(v) => setTarget((t) => ({ ...t, [u.key]: v }))}/>
                                <button className="btn btn-ghost" style={{ padding: '3px 8px' }} disabled={!target[u.key] || busy === u.key}
                                  onClick={() => act({ action: 'assign', key: u.key, ownerUserId: target[u.key] }, `${u.name} atribuído.`)}>
                                  Atribuir
                                </button>
                              </>
                            )}
                          </div>
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

// ---------- Pedidos ----------
function PfClaims({ d, busy, act }) {
  const pending = d.claims.filter((c) => c.status === 'PENDING');
  const decided = d.claims.filter((c) => c.status !== 'PENDING');
  const STATUS = { APPROVED: ['aprovado', 'var(--success)'], REJECTED: ['recusado', 'var(--danger)'], CANCELED: ['cancelado', 'var(--fg5)'] };
  const decide = (c, action) => {
    const note = window.prompt(action === 'approve' ? `Aprovar ${c.partnerName} pra ${c.userName}? Observação (opcional):` : `Recusar o pedido de ${c.userName}? Motivo:`, '');
    if (note === null) return;
    act({ action, claimId: c.id, note }, action === 'approve' ? `${c.partnerName} entrou na carteira de ${c.userName}.` : 'Pedido recusado.');
  };
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="panel" style={{ padding: 0 }}>
        <div className="panel-head" style={{ padding: '12px 14px 6px' }}><div className="panel-title">Em análise · {fmtInt(pending.length)}</div></div>
        {pending.length === 0
          ? <div style={{ padding: '0 14px 14px', fontSize: 12, color: 'var(--fg4)' }}>Nenhum pedido esperando.</div>
          : (
            <div className="tbl-wrap" style={{ margin: 0, padding: '0 4px' }}>
              <table className="tbl">
                <thead><tr><th>Afiliado</th><th>Quem pediu</th><th>Como trouxe</th><th>Quando</th><th></th></tr></thead>
                <tbody>
                  {pending.map((c) => (
                    <tr key={c.id}>
                      <td style={{ fontWeight: 600 }}>{c.partnerName}</td>
                      <td>{c.userName}</td>
                      <td style={{ fontSize: 12, color: 'var(--fg3)', maxWidth: 320 }}>{c.note || '—'}</td>
                      <td className="cell-mono" style={{ fontSize: 11 }}>{pfDay(c.createdAt)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {c.canDecide && <button className="btn btn-primary" style={{ padding: '3px 10px' }} disabled={busy === c.id} onClick={() => decide(c, 'approve')}>Aprovar</button>}
                          {c.canDecide && <button className="btn btn-ghost" style={{ padding: '3px 8px' }} disabled={busy === c.id} onClick={() => decide(c, 'reject')}>Recusar</button>}
                          {c.mine && <button className="btn btn-ghost" style={{ padding: '3px 8px', color: 'var(--fg4)' }} disabled={busy === c.id}
                            onClick={() => act({ action: 'cancel', claimId: c.id }, 'Pedido cancelado.')}>Cancelar</button>}
                          {!c.canDecide && !c.mine && <span style={{ fontSize: 11, color: 'var(--fg5)' }}>com o líder dele</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
      {decided.length > 0 && (
        <div className="panel" style={{ padding: 0 }}>
          <div className="panel-head" style={{ padding: '12px 14px 6px' }}><div className="panel-title">Decididos nos últimos 30 dias</div></div>
          <Paginated items={decided} label="pedidos">
            {(page, pager) => (<>
              <div className="tbl-wrap" style={{ margin: 0, padding: '0 4px' }}>
                <table className="tbl">
                  <thead><tr><th>Afiliado</th><th>Quem pediu</th><th>Decisão</th><th>Por</th><th>Quando</th></tr></thead>
                  <tbody>
                    {page.map((c) => (
                      <tr key={c.id}>
                        <td style={{ fontWeight: 600 }}>{c.partnerName}</td>
                        <td>{c.userName}</td>
                        <td><span style={{ color: STATUS[c.status][1] }}>{STATUS[c.status][0]}</span>{c.decisionNote ? <span style={{ fontSize: 11, color: 'var(--fg4)' }}> · {c.decisionNote}</span> : null}</td>
                        <td>{c.decidedByName || '—'}</td>
                        <td className="cell-mono" style={{ fontSize: 11 }}>{pfDay(c.decidedAt)}</td>
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
    </div>
  );
}

// ---------- Histórico de donos ----------
function PfHistory({ d }) {
  if (!d.history.length) return <div className="panel" style={{ fontSize: 12, color: 'var(--fg4)' }}>Nenhuma troca de dono ainda.</div>;
  return (
    <div className="panel" style={{ padding: 0 }}>
      <Paginated items={d.history} label="trocas">
        {(page, pager) => (<>
          <div className="tbl-wrap" style={{ margin: 0, padding: '0 4px' }}>
            <table className="tbl">
              <thead><tr><th>Quando</th><th>Afiliado</th><th>O quê</th><th>De</th><th>Para</th><th>Por</th></tr></thead>
              <tbody>
                {page.map((e, i) => (
                  <tr key={`${e.partnerId}-${e.at}-${i}`}>
                    <td className="cell-mono" style={{ fontSize: 11 }}>{pfDay(e.at)}</td>
                    <td style={{ fontWeight: 600 }}>{e.partnerName}</td>
                    <td>{PF_KIND[e.kind] || e.kind}{e.note ? <span style={{ fontSize: 11, color: 'var(--fg4)' }}> · {e.note}</span> : null}</td>
                    <td>{e.fromName || '—'}</td>
                    <td>{e.toName || '—'}</td>
                    <td>{e.byName || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pager}
        </>)}
      </Paginated>
    </div>
  );
}

Object.assign(window, { PortfolioPage });
