/* global React, ReactDOM, Icon, Paginated, fmtInt */
/* Aba Decisões (2026-11-24): o que a liderança decidiu nos canais do ClickUp
   (lido pela IA nas threads) contra as métricas que cada decisão podia mexer.
   A comparação é do dash: média dos dias desde a decisão × os mesmos tantos
   dias antes — CORRELAÇÃO, nunca causa (o aviso aparece em todo cartão).
   Dados: /api/metrics/decisions (lib/decisions/service.ts); configuração do
   ClickUp (admin): /api/admin/clickup. */

const { useState: useStateDc, useEffect: useEffectDc } = React;

const DC_METRICS = [
  ['faturamento', 'Faturamento'], ['pedidos', 'Pedidos'], ['aov', 'AOV'], ['net_after_cpa', 'Net after CPA'],
  ['aprovacao', 'Aprovação'], ['reembolso', 'Reembolso'], ['chargeback', 'Chargeback'],
];
const DC_METRIC_LABEL = Object.fromEntries(DC_METRICS);
const DC_EXPECTED = { subir: '↑ subir', cair: '↓ cair', incerto: '↕ incerto' };
const DC_VERDICT = {
  esperado: ['na direção esperada', 'var(--success)'],
  contrario: ['contra o esperado', 'var(--danger)'],
  estavel: ['estável', 'var(--fg4)'],
  sem_base: ['sem base', 'var(--fg5)'],
};
const DC_STATUS = { DETECTED: ['a revisar', 'var(--warning)'], CONFIRMED: ['confirmada', 'var(--success)'], DISCARDED: ['descartada', 'var(--fg5)'] };
const DC_LEVEL = { ampla: 'abrangência ampla', setor: 'um setor' };
const DC_FILTERS = [['', 'Ativas'], ['DETECTED', 'A revisar'], ['CONFIRMED', 'Confirmadas'], ['DISCARDED', 'Descartadas']];
const DC_INPUT = {
  padding: '7px 9px', fontSize: 13, color: 'var(--fg1)', background: 'var(--bg)',
  border: '1px solid var(--border)', borderRadius: 6, minWidth: 0, width: '100%',
};

function dcDay(iso) { return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—'; }
function dcAgo(iso) {
  if (!iso) return 'nunca';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} d`;
}

function DecisionsPage({ user }) {
  const [status, setStatus] = useStateDc('');
  const [channel, setChannel] = useStateDc('');
  const [state, setState] = useStateDc({ status: 'loading', data: null, error: null });
  const [bump, setBump] = useStateDc(0);
  const [busy, setBusy] = useStateDc(null);
  const [msg, setMsg] = useStateDc(null);
  const [editing, setEditing] = useStateDc(null); // decisão | 'new'
  const [settingsOpen, setSettingsOpen] = useStateDc(false);
  const isAdmin = user && user.role === 'ADMIN';

  useEffectDc(() => {
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading' }));
    window.NSApi.fetchDecisions({ status: status || undefined, channel: channel || undefined })
      .then((data) => { if (!cancelled) setState({ status: 'ready', data, error: null }); })
      .catch((err) => { if (!cancelled) setState({ status: 'error', data: null, error: err.message }); });
    return () => { cancelled = true; };
  }, [status, channel, bump]);

  async function act(body, done) {
    setBusy(body.id || body.action);
    setMsg(null);
    try {
      await window.NSApi.decisionAction(body);
      setMsg({ ok: true, text: done });
      setBump((n) => n + 1);
      return true;
    } catch (err) {
      setMsg({ ok: false, text: err.message || 'falhou' });
      return false;
    } finally { setBusy(null); }
  }

  const d = state.data;
  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">ClickUp · IA · métricas do dash</span>
          <h2>Decisões <em>e o que veio depois</em></h2>
          <span className="sub">
            O que a liderança decidiu nas threads do ClickUp e como as métricas que a decisão podia mexer andaram desde então.
          </span>
        </div>
        <div className="page-head-actions" style={{ flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" onClick={() => setEditing('new')}><Icon name="plus" size={12}/> Registrar decisão</button>
          {isAdmin && <button className="btn btn-ghost" onClick={() => setSettingsOpen(true)}><Icon name="settings" size={12}/> Configurar ClickUp</button>}
        </div>
      </div>

      {d && (
        <div className="panel" style={{ marginBottom: 12, padding: '10px 14px', fontSize: 12, color: 'var(--fg3)', display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          {!d.configured
            ? <span><Icon name="info" size={12}/> ClickUp ainda não conectado. {isAdmin ? 'Abra "Configurar ClickUp" e cole o token.' : 'Peça ao admin pra conectar.'}</span>
            : <>
                <span>Última leitura do ClickUp: <strong>{dcAgo(d.sync && d.sync.at)}</strong></span>
                {d.sync && <span>{fmtInt(d.sync.messages)} mensagens e {fmtInt(d.sync.replies)} respostas lidas na última rodada</span>}
                <span>{fmtInt(d.queue.threadsToRead)} threads na fila da IA</span>
                {d.sync && d.sync.errors && d.sync.errors.length > 0 && <span style={{ color: 'var(--warning)' }}>{d.sync.errors.length} canal(is) com erro</span>}
              </>}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <div className="seg">
          {DC_FILTERS.map(([k, l]) => (
            <button key={k || 'ativas'} className={status === k ? 'is-active' : ''} onClick={() => setStatus(k)}>
              {l}{d && k === 'DETECTED' && d.counts.detected ? ` · ${d.counts.detected}` : ''}
            </button>
          ))}
        </div>
        {d && d.channels.length > 0 && (
          <select value={channel} onChange={(e) => setChannel(e.target.value)} style={{ ...DC_INPUT, width: 'auto' }}>
            <option value="">Todos os canais</option>
            {d.channels.map((c) => <option key={c.id} value={c.id}>{c.name || c.id}</option>)}
          </select>
        )}
      </div>

      {msg && <div className="panel" style={{ marginBottom: 10, padding: '8px 12px', fontSize: 12, color: msg.ok ? 'var(--success)' : 'var(--danger)' }}>{msg.text}</div>}
      {state.status === 'error' && <div className="panel" style={{ color: 'var(--danger)' }}>Erro: {state.error}</div>}
      {state.status === 'loading' && !d && <div className="panel" style={{ fontSize: 12, color: 'var(--fg5)' }}>Carregando…</div>}

      {d && d.decisions.length === 0 && (
        <div className="panel" style={{ fontSize: 13, color: 'var(--fg4)' }}>
          Nenhuma decisão {status ? 'nesse filtro' : 'ainda'}. {d.configured ? 'A IA lê as threads novas a cada 30 minutos.' : ''}
        </div>
      )}

      {d && d.decisions.length > 0 && (
        <Paginated items={d.decisions} label="decisões" resetKey={`${status}|${channel}`}>
          {(page, pager) => (<>
            <div style={{ display: 'grid', gap: 12 }}>
              {page.map((dec) => (
                <DcCard key={dec.id} dec={dec} busy={busy === dec.id} disclaimer={d.disclaimer}
                  onAct={act} onEdit={() => setEditing(dec)}/>
              ))}
            </div>
            {pager}
          </>)}
        </Paginated>
      )}

      {editing && <DcEditor dec={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
        onSave={async (body) => { if (await act(body, body.action === 'create' ? 'Decisão registrada.' : 'Decisão atualizada.')) setEditing(null); }}/>}
      {settingsOpen && <DcClickUpSettings onClose={() => { setSettingsOpen(false); setBump((n) => n + 1); }}/>}
    </div>
  );
}

function DcCard({ dec, busy, disclaimer, onAct, onEdit }) {
  const [showSources, setShowSources] = useStateDc(false);
  const c = dec.correlation;
  const [stLabel, stColor] = DC_STATUS[dec.status] || ['', 'var(--fg4)'];
  return (
    <div className="panel" style={{ padding: '14px 16px', opacity: dec.status === 'DISCARDED' ? 0.6 : 1 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ flexShrink: 0, minWidth: 74, textAlign: 'center', padding: '6px 4px', border: '1px solid var(--border-soft)', borderRadius: 6 }}>
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 18, fontWeight: 600, color: 'var(--accent)' }}>{dec.decidedAt.slice(8, 10)}/{dec.decidedAt.slice(5, 7)}</div>
          <div style={{ fontSize: 11, color: 'var(--fg5)' }}>{dec.decidedAt.slice(0, 4)}</div>
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: 16, color: 'var(--fg1)' }}>{dec.title}</h3>
            <span style={{ fontSize: 11, color: stColor }}>{stLabel}</span>
            {dec.confidence !== 'alta' && dec.status === 'DETECTED' && <span style={{ fontSize: 11, color: 'var(--fg5)' }}>confiança {dec.confidence}</span>}
            {dec.scope && dec.scope.impact && (
              <span style={{ fontSize: 11, color: 'var(--fg4)' }}>impacto {dec.scope.impact}{DC_LEVEL[dec.scope.level] ? ` · ${DC_LEVEL[dec.scope.level]}` : ''}</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg4)', marginTop: 2 }}>
            {dec.manual ? 'registrada à mão' : (dec.channel && (dec.channel.name || dec.channel.id))}
            {dec.decidedBy ? ` · ${dec.decidedBy}` : ''}
            {dec.scope && (dec.scope.platforms.length > 0 || dec.scope.families.length > 0)
              ? ` · escopo: ${[...dec.scope.platforms, ...dec.scope.families].join(', ')}` : ' · operação toda'}
            {dec.scope && dec.scope.note ? ` (${dec.scope.note})` : ''}
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: '21px', color: 'var(--fg2)' }}>{dec.summary}</p>

          {c && (
            <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 6, background: 'var(--bg-subtle)', border: '1px solid var(--border-soft)' }}>
              <div style={{ fontSize: 13, lineHeight: '21px', color: 'var(--fg1)' }}>{c.narrative}</div>
              {c.shifts && c.shifts.length > 0 && (
                <div className="tbl-wrap" style={{ margin: '8px 0 0' }}>
                  <table className="tbl">
                    <thead><tr><th>Métrica</th><th>Esperado</th><th className="num">{c.before.days} dias antes</th><th className="num">Desde então</th><th className="num">Variação</th><th>Leitura</th></tr></thead>
                    <tbody>
                      {c.shifts.map((s) => {
                        const [vLabel, vColor] = DC_VERDICT[s.verdict] || ['', 'var(--fg4)'];
                        return (
                          <tr key={s.metric}>
                            <td>{s.label}</td>
                            <td style={{ color: 'var(--fg4)' }}>{DC_EXPECTED[s.expected]}</td>
                            <td className="num">{s.beforeFmt}</td>
                            <td className="num">{s.afterFmt}</td>
                            <td className="num" style={{ color: s.good == null ? 'var(--fg4)' : s.good ? 'var(--success)' : 'var(--danger)' }}>{s.deltaFmt}</td>
                            <td style={{ color: vColor }}>{vLabel}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--fg5)', marginTop: 6 }}>
                {c.scopeLabel} · {dcDay(c.before.from)}–{dcDay(c.before.to)} × {dcDay(c.after.from)}–{dcDay(c.after.to)} · {c.disclaimer || disclaimer}
              </div>
            </div>
          )}
          {!c && dec.metrics.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--fg4)', marginTop: 8 }}>
              Pode mexer em: {dec.metrics.map((m) => `${DC_METRIC_LABEL[m.metric] || m.metric} (${DC_EXPECTED[m.expected]})`).join(', ')} — comparação sai na próxima leitura.
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
            {dec.status !== 'CONFIRMED' && <button className="btn btn-ghost" style={{ padding: '3px 10px' }} disabled={busy} onClick={() => onAct({ action: 'confirm', id: dec.id }, 'Decisão confirmada.')}><Icon name="check" size={11}/> Confirmar</button>}
            {dec.status !== 'DISCARDED'
              ? <button className="btn btn-ghost" style={{ padding: '3px 10px' }} disabled={busy} onClick={() => onAct({ action: 'discard', id: dec.id }, 'Descartada — some do briefing e das análises.')}><Icon name="x" size={11}/> Não é decisão</button>
              : <button className="btn btn-ghost" style={{ padding: '3px 10px' }} disabled={busy} onClick={() => onAct({ action: 'restore', id: dec.id }, 'Decisão restaurada.')}>Restaurar</button>}
            <button className="btn btn-ghost" style={{ padding: '3px 10px' }} disabled={busy} onClick={onEdit}><Icon name="pencil" size={11}/> Editar</button>
            <button className="btn btn-ghost" style={{ padding: '3px 10px', color: 'var(--fg4)' }} disabled={busy} onClick={() => onAct({ action: 'recompute', id: dec.id }, 'Comparação recalculada.')}><Icon name="refresh" size={11}/> Recalcular</button>
            {dec.sources.length > 0 && <button className="btn btn-ghost" style={{ padding: '3px 10px', color: 'var(--fg4)' }} onClick={() => setShowSources((v) => !v)}>{showSources ? 'Esconder' : 'Ver'} mensagens ({dec.sources.length})</button>}
            {dec.link && <a className="btn btn-ghost" style={{ padding: '3px 10px' }} href={dec.link} target="_blank" rel="noopener noreferrer"><Icon name="external-link" size={11}/> Abrir no ClickUp</a>}
          </div>
          {showSources && (
            <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
              {dec.sources.map((s) => (
                <div key={s.id} style={{ fontSize: 12, lineHeight: '19px', color: 'var(--fg3)', borderLeft: '2px solid var(--border)', paddingLeft: 10 }}>
                  <strong style={{ color: 'var(--fg2)' }}>{s.userName || 'alguém'}</strong> · {dcDay(s.postedAt.slice(0, 10))}: {s.excerpt}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DcEditor({ dec, onClose, onSave }) {
  const [title, setTitle] = useStateDc(dec ? dec.title : '');
  const [summary, setSummary] = useStateDc(dec ? dec.summary : '');
  const [day, setDay] = useStateDc(dec ? dec.decidedAt.slice(0, 10) : new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10));
  const [metrics, setMetrics] = useStateDc(() => Object.fromEntries((dec ? dec.metrics : []).map((m) => [m.metric, m.expected])));
  const [platforms, setPlatforms] = useStateDc(dec ? dec.scope.platforms.join(', ') : '');
  const [families, setFamilies] = useStateDc(dec ? dec.scope.families.join(', ') : '');
  const [note, setNote] = useStateDc(dec && dec.scope.note ? dec.scope.note : '');
  const split = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
  function submit() {
    onSave({
      action: dec ? 'edit' : 'create', id: dec ? dec.id : undefined,
      title, summary, decidedAt: day,
      metrics: Object.entries(metrics).filter(([, v]) => v).map(([metric, expected]) => ({ metric, expected })),
      platforms: split(platforms), families: split(families), note,
    });
  }
  return ReactDOM.createPortal((
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" role="dialog" aria-label={dec ? 'Editar decisão' : 'Registrar decisão'} onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
        <div className="modal-head">
          <div><span className="eyebrow">{dec ? 'Editar decisão' : 'Registrar decisão'}</span>
            <h3 style={{ margin: '4px 0', fontSize: 18, color: 'var(--fg1)' }}>{dec ? dec.title : 'Decisão tomada fora do ClickUp'}</h3></div>
          <button className="icon-btn" onClick={onClose} title="Fechar"><Icon name="x" size={14}/></button>
        </div>
        <div className="modal-body" style={{ display: 'grid', gap: 10 }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--fg3)' }}>Título<input value={title} onChange={(e) => setTitle(e.target.value)} style={DC_INPUT}/></label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--fg3)' }}>O que foi decidido<textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} style={{ ...DC_INPUT, resize: 'vertical' }}/></label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--fg3)' }}>Desde quando vale<input type="date" value={day} onChange={(e) => setDay(e.target.value)} style={{ ...DC_INPUT, width: 180 }}/></label>
          <div style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--fg3)' }}>Métricas que pode mexer</span>
            {DC_METRICS.map(([k, l]) => (
              <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                <span style={{ width: 120 }}>{l}</span>
                <select value={metrics[k] || ''} onChange={(e) => setMetrics((m) => ({ ...m, [k]: e.target.value }))} style={{ ...DC_INPUT, width: 150 }}>
                  <option value="">não mexe</option>
                  <option value="subir">deve subir</option>
                  <option value="cair">deve cair</option>
                  <option value="incerto">pode mexer</option>
                </select>
              </div>
            ))}
          </div>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--fg3)' }}>Plataformas (slugs, vazio = todas)<input value={platforms} onChange={(e) => setPlatforms(e.target.value)} placeholder="jvzoo, buygoods" style={DC_INPUT}/></label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--fg3)' }}>Famílias de produto (vazio = todas)<input value={families} onChange={(e) => setFamilies(e.target.value)} placeholder="NeuroRecall" style={DC_INPUT}/></label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--fg3)' }}>Observação de escopo<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex.: só afiliados do Brasil" style={DC_INPUT}/></label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button className="btn btn-primary" onClick={submit} disabled={!title.trim() || !day}>Salvar</button>
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}

function DcClickUpSettings({ onClose }) {
  const [state, setState] = useStateDc({ status: 'loading', data: null, error: null });
  const [token, setToken] = useStateDc('');
  const [bump, setBump] = useStateDc(0);
  const [busy, setBusy] = useStateDc(false);
  const [msg, setMsg] = useStateDc(null);

  useEffectDc(() => {
    let cancelled = false;
    window.NSApi.fetchClickUpAdmin()
      .then((data) => { if (!cancelled) setState({ status: 'ready', data, error: null }); })
      .catch((err) => { if (!cancelled) setState({ status: 'error', data: null, error: err.message }); });
    return () => { cancelled = true; };
  }, [bump]);

  // Lendo em segundo plano: atualiza o painel até terminar.
  const running = state.data && state.data.run && !state.data.run.finishedAt;
  useEffectDc(() => {
    if (!running) return undefined;
    const id = setTimeout(() => setBump((n) => n + 1), 5000);
    return () => clearTimeout(id);
  }, [running, state.data]);

  async function send(body, done) {
    setBusy(true); setMsg(null);
    try { await window.NSApi.clickUpAdminAction(body); setMsg({ ok: true, text: done }); setBump((n) => n + 1); return true; }
    catch (err) { setMsg({ ok: false, text: err.message || 'falhou' }); return false; }
    finally { setBusy(false); }
  }

  const d = state.data;
  return ReactDOM.createPortal((
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" role="dialog" aria-label="Configurar ClickUp" style={{ maxWidth: 760, width: 'min(760px, 96vw)' }}
        onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
        <div className="modal-head">
          <div><span className="eyebrow">Admin · ClickUp</span><h3 style={{ margin: '4px 0', fontSize: 18, color: 'var(--fg1)' }}>Leitura do chat</h3></div>
          <button className="icon-btn" onClick={onClose} title="Fechar"><Icon name="x" size={14}/></button>
        </div>
        <div className="modal-body" style={{ display: 'grid', gap: 12 }}>
          {state.status === 'error' && <div style={{ color: 'var(--danger)', fontSize: 12 }}>Erro: {state.error}</div>}
          {msg && <div style={{ fontSize: 12, color: msg.ok ? 'var(--success)' : 'var(--danger)' }}>{msg.text}</div>}
          {d && (<>
            <div style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--fg3)' }}>
                Token pessoal do ClickUp (Configurações → Apps → API Token). O dash lê o que o dono do token enxerga —
                use o de alguém que está nos canais de liderança. {d.tokenFromEnv ? 'Hoje vem do .env do servidor.' : d.tokenMasked ? `Gravado: ${d.tokenMasked}` : 'Nenhum gravado.'}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="pk_…" autoComplete="off" style={DC_INPUT}/>
                <button className="btn btn-primary" disabled={busy || !token.trim()} onClick={async () => { if (await send({ action: 'save', token }, 'Token conferido no ClickUp e gravado.')) setToken(''); }}>Salvar</button>
              </div>
              {d.workspaces.length > 1 && (
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--fg3)' }}>
                  Workspace
                  <select value={d.workspaceId || ''} onChange={(e) => send({ action: 'save', workspaceId: e.target.value }, 'Workspace gravado.')} style={{ ...DC_INPUT, width: 'auto' }}>
                    <option value="">escolher…</option>
                    {d.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </label>
              )}
              {d.workspaceError && <span style={{ fontSize: 12, color: 'var(--danger)' }}>{d.workspaceError}</span>}
            </div>

            {d.configured && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, color: 'var(--fg3)' }}>
                <button className="btn btn-primary" disabled={busy || running} onClick={() => send({ action: 'run' }, 'Lendo em segundo plano — leva alguns minutos.')}>
                  <Icon name="refresh" size={12}/> {running ? 'Lendo…' : 'Ler agora'}
                </button>
                <span>Última leitura: {dcAgo(d.sync && d.sync.at)}{d.sync ? ` · ${fmtInt(d.sync.calls)} chamadas · ${fmtInt(d.sync.historyPending)} canais com histórico pendente` : ''}</span>
                {d.run && d.run.error && <span style={{ color: 'var(--danger)' }}>{d.run.error}</span>}
              </div>
            )}

            {d.channels.length > 0 && (
              <div className="tbl-wrap" style={{ margin: 0, maxHeight: 360, overflow: 'auto' }}>
                <table className="tbl">
                  <thead><tr><th>Canal</th><th>Ler</th><th>Liderança</th><th className="num">Mensagens</th><th className="num">Decisões</th><th>Histórico</th></tr></thead>
                  <tbody>
                    {d.channels.map((c) => (
                      <tr key={c.id} style={{ opacity: c.type === 'CHANNEL' ? 1 : 0.6 }}>
                        <td>{c.name || (c.type === 'DM' ? 'conversa privada' : c.type)}{c.visibility === 'PRIVATE' && c.type === 'CHANNEL' ? <span style={{ fontSize: 11, color: 'var(--fg5)' }}> · privado</span> : null}</td>
                        <td><input type="checkbox" checked={c.enabled} disabled={busy} onChange={(e) => send({ action: 'channels', updates: [{ id: c.id, enabled: e.target.checked }] }, 'Canal atualizado.')}/></td>
                        <td><input type="checkbox" checked={c.leadership} disabled={busy} onChange={(e) => send({ action: 'channels', updates: [{ id: c.id, leadership: e.target.checked }] }, 'Canal atualizado.')}/></td>
                        <td className="num">{fmtInt(c.messages)}</td>
                        <td className="num">{fmtInt(c.decisions)}</td>
                        <td style={{ fontSize: 11, color: 'var(--fg4)' }}>{!c.enabled ? '—' : c.historyDone ? 'completo' : c.lastSyncedAt ? 'lendo' : 'na fila'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ fontSize: 11, color: 'var(--fg5)' }}>
              Conversas privadas (DM e grupo) ficam desligadas por padrão. A cada 30 minutos o dash lê o que mudou e a IA lê até 20 threads novas (liderança primeiro).
            </div>
          </>)}
        </div>
      </div>
    </div>
  ), document.body);
}

Object.assign(window, { DecisionsPage });
