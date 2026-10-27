/* global React, Icon, fmtCurrency, fmtInt, fmtPct, fmtDateTime, SkelTableRows, Paginated, ReadState */
/* Aba Pesquisas — quiz pós-compra (fim do tratamento): quem recebeu, onde
   parou, o que respondeu, a tela final, quem clicou no checkout e quem
   comprou (src=qz_ volta no postback), e a fila do CS (nota 1–2 ou parou por
   médico/mal-estar, prazo 24h). Período = data do convite.
   API: GET/PATCH /api/metrics/surveys */

const { useState: useStateSv, useEffect: useEffectSv } = React;

const SV_CS_STATUS = [
  { id: 'aberto', label: 'Aberto' },
  { id: 'ligado', label: 'Ligado' },
  { id: 'resolvido', label: 'Resolvido' },
];
const SV_OUTCOME_LABEL = { cs: 'CS liga', recorrencia: 'Recorrência', cupom: 'Cupom', obrigado: 'Só agradecimento' };

function svPhone(d) {
  if (!d) return '—';
  if (d.length === 11 && d[0] === '1') return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return `+${d}`;
}

/** Barras simples (rótulo · barra · quantidade · %). total = base do %. */
function SvBars({ items, total }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  if (!items.length || !items.some((i) => i.count > 0)) {
    return <div style={{ padding: '14px 0', color: 'var(--fg5)', fontSize: 12 }}>Sem respostas no período.</div>;
  }
  return (
    <div style={{ display: 'grid', gap: 7 }}>
      {items.map((i) => (
        <div key={i.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1.2fr) 2fr 44px 44px', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
          <span style={{ color: 'var(--fg2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={i.label}>{i.label}</span>
          <span style={{ height: 8, background: 'var(--bg-sunken, var(--border-soft))', borderRadius: 4, overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${(i.count / max) * 100}%`, background: 'var(--accent)', borderRadius: 4 }}/>
          </span>
          <span className="mono" style={{ textAlign: 'right', color: 'var(--fg1)' }}>{fmtInt(i.count)}</span>
          <span className="mono" style={{ textAlign: 'right', color: 'var(--fg5)' }}>{total ? fmtPct(i.count / total, 0) : '—'}</span>
        </div>
      ))}
    </div>
  );
}

function SvPanel({ title, sub, children, style }) {
  return (
    <div className="panel" style={{ marginBottom: 12, ...style }}>
      <div className="panel-title">{title}</div>
      {sub && <div className="panel-sub" style={{ fontSize: 11, marginBottom: 10 }}>{sub}</div>}
      {!sub && <div style={{ height: 8 }}/>}
      {children}
    </div>
  );
}

function SvCsQueue({ rows, onChanged }) {
  const [saving, setSaving] = useStateSv(null);
  const [err, setErr] = useStateSv(null);
  const change = async (id, status) => {
    setSaving(id); setErr(null);
    try { await window.NSApi.patchSurveyCs(id, status); onChanged(); }
    catch (e) { setErr(String(e.message || e)); }
    finally { setSaving(null); }
  };
  const now = Date.now();
  return (
    <div className="panel" style={{ marginBottom: 12, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px' }}>
        <div className="panel-title">Fila do CS</div>
        <div className="panel-sub" style={{ fontSize: 11 }}>Nota 1–2 ou parou por médico/mal-estar. A página promete contato em até 24h. Mostra os abertos e os resolvidos nos últimos 7 dias, de qualquer período.</div>
        {err && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 6 }}>Não salvou: {err}</div>}
      </div>
      {!rows.length ? (
        <div style={{ padding: '0 14px 14px', color: 'var(--fg5)', fontSize: 12 }}>Ninguém na fila.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ fontSize: 12.5, minWidth: 860 }}>
            <thead>
              <tr>
                <th>Cliente</th><th>Contato</th><th>Motivo</th><th className="num">Nota</th>
                <th>Comentário</th><th>Prazo</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const late = r.status === 'aberto' && r.dueAt && new Date(r.dueAt).getTime() < now;
                return (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600 }}>{r.firstName || '—'}</td>
                    <td><div>{r.email}</div><div className="mono" style={{ color: 'var(--fg4)', fontSize: 11.5 }}>{svPhone(r.phone)}</div></td>
                    <td>{r.reason}</td>
                    <td className="num mono">{r.satisfaction != null ? `${r.satisfaction}★` : '—'}</td>
                    <td style={{ maxWidth: 260, whiteSpace: 'normal', color: r.comment ? 'var(--fg2)' : 'var(--fg5)' }}>{r.comment || '—'}</td>
                    <td style={{ color: late ? 'var(--danger)' : 'var(--fg3)', whiteSpace: 'nowrap' }}>
                      {r.dueAt ? fmtDateTime(r.dueAt) : '—'}{late && <div style={{ fontSize: 11 }}>atrasado</div>}
                    </td>
                    <td>
                      <select value={r.status} disabled={saving === r.id} onChange={(e) => change(r.id, e.target.value)}
                        aria-label={`Status do atendimento de ${r.firstName || r.email}`}>
                        {SV_CS_STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SurveysPage({ filters }) {
  const [variant, setVariant] = useStateSv(null);
  const [tests, setTests] = useStateSv(false);
  const [tick, setTick] = useStateSv(0);
  const [state, setState] = useStateSv({ status: 'loading', data: null, error: null });

  useEffectSv(() => {
    let alive = true;
    setState((s) => ({ ...s, status: 'loading' }));
    window.NSApi.fetchSurveys(filters, variant, { tests })
      .then((data) => { if (alive) setState({ status: 'ready', data, error: null }); })
      .catch((e) => { if (alive) setState({ status: 'error', data: null, error: String(e.message || e) }); });
    return () => { alive = false; };
  }, [filters.dateRange.start, filters.dateRange.end, variant, tests, tick]);

  if (state.status === 'error') {
    return <div className="page-in"><ReadState kind="falha" title="Não carregou a aba Pesquisas">{state.error}</ReadState></div>;
  }
  const d = state.data;
  if (!d) return <div className="page-in"><div className="panel"><SkelTableRows rows={6} cols={5}/></div></div>;
  if (!d.variants.length) {
    return <div className="page-in"><ReadState kind="vazio" title="Nenhuma pesquisa cadastrada">A primeira variante entra pela migração do banco.</ReadState></div>;
  }
  const k = d.kpis;
  const current = d.variants.find((v) => v.slug === d.variant) || d.variants[0];
  const answered = d.steps.find((s) => s.id === 'q1')?.count || 0;

  const kpis = [
    { l: 'Convites', v: fmtInt(k.invites), s: `${fmtInt(k.sent)} enviados` },
    { l: 'Abriram', v: fmtInt(k.opened), s: k.invites ? `${fmtPct(k.opened / k.invites, 0)} dos convites` : '—' },
    { l: 'Concluíram', v: fmtInt(k.completed), s: k.opened ? `${fmtPct(k.completed / k.opened, 0)} de quem abriu` : '—' },
    { l: 'Nota média', v: k.satisfactionAvg != null ? `${k.satisfactionAvg.toFixed(1)}★` : '—', s: 'de 1 a 5' },
    { l: 'Clicaram no checkout', v: fmtInt(k.checkoutClicks), s: k.completed ? `${fmtPct(k.checkoutClicks / k.completed, 0)} de quem concluiu` : '—' },
    { l: 'Compraram', v: fmtInt(k.purchases), s: k.purchases ? fmtCurrency(k.revenueUsd, 'USD', 0) : 'venda volta pelo postback', money: true },
  ];

  return (
    <div className="page-in" style={{ opacity: state.status === 'loading' ? 0.6 : 1, transition: 'opacity .15s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {d.variants.length > 1 && d.variants.map((v) => (
          <button key={v.slug} className={v.slug === d.variant ? 'chip is-active' : 'chip'} onClick={() => setVariant(v.slug)}>{v.name}</button>
        ))}
        {d.variants.length === 1 && <span style={{ fontWeight: 600 }}>{current.name}</span>}
        <div style={{ flex: 1 }}/>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--fg4)', cursor: 'pointer' }}>
          <input type="checkbox" checked={tests} onChange={(e) => setTests(e.target.checked)}/> Incluir testes
        </label>
        <a className="btn btn-ghost" href={current.previewUrl} target="_blank" rel="noopener">
          <Icon name="external-link" size={12}/> Ver a página
        </a>
      </div>

      {!current.checkoutReady.recorrencia && (
        <ReadState kind="parcial" title="Links de checkout ainda não cadastrados">
          Sem o link da recorrência{current.checkoutReady.cupom ? '' : ' e do cupom'}, a pesquisa termina no agradecimento e o atalho "Reorder now" não aparece.
        </ReadState>
      )}

      <div className="mini-kpis" style={{ marginBottom: 12 }}>
        {kpis.map((x) => (
          <div className="mini-kpi" key={x.l}>
            <div className="l">{x.l}</div>
            <div className="v" style={x.money && k.purchases ? { color: 'var(--money)' } : undefined}>{x.v}</div>
            <div className="s">{x.s}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12 }}>
        <SvPanel title="Onde as pessoas param" sub="Quantos chegaram em cada pergunta. % sobre quem abriu o link.">
          <SvBars items={d.steps} total={k.opened}/>
        </SvPanel>
        <SvPanel title="Tela final" sub="Decidida pelas respostas: CS → recorrência → cupom → agradecimento.">
          <SvBars items={d.outcomes} total={k.completed}/>
        </SvPanel>
        <SvPanel title="Satisfação" sub="Pergunta 2. Nota 1–2 vai direto pro CS.">
          <SvBars items={d.satisfaction} total={d.satisfaction.reduce((s, i) => s + i.count, 0)}/>
        </SvPanel>
        <SvPanel title="Por que não levou os 6" sub="Pergunta 1 — o motivo da compra menor.">
          <SvBars items={d.q1} total={answered}/>
        </SvPanel>
        <SvPanel title="Constância" sub="Pergunta 3, e por que parou (3b) para quem parou.">
          <SvBars items={d.q3} total={d.q3.reduce((s, i) => s + i.count, 0)}/>
          {d.q3b.some((i) => i.count > 0) && (<>
            <div className="panel-eyebrow" style={{ margin: '14px 0 8px' }}>Por que parou</div>
            <SvBars items={d.q3b} total={d.q3b.reduce((s, i) => s + i.count, 0)}/>
          </>)}
        </SvPanel>
        <SvPanel title="O que notaram" sub="Pergunta 4 — pode marcar várias. % sobre quem respondeu a pergunta.">
          <SvBars items={d.q4} total={d.steps.find((s) => s.id === 'q4')?.count || 0}/>
        </SvPanel>
        <SvPanel title="O que ajudaria a terminar o plano" sub="Pergunta 5 — até 2 opções. % sobre quem respondeu a pergunta.">
          <SvBars items={d.q5} total={d.steps.find((s) => s.id === 'q5')?.count || 0}/>
        </SvPanel>
      </div>

      <SvCsQueue rows={d.csQueue} onChanged={() => setTick((n) => n + 1)}/>

      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px' }}>
          <div className="panel-title">Respostas</div>
          <div className="panel-sub" style={{ fontSize: 11 }}>Mais recentes primeiro. Inclui quem começou e não terminou.</div>
        </div>
        {!d.recent.length ? (
          <div style={{ padding: '0 14px 14px', color: 'var(--fg5)', fontSize: 12 }}>Nenhuma resposta no período.</div>
        ) : (
          <Paginated items={d.recent} label="respostas" resetKey={d.variant}>
            {(rows, pager) => (<>
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl" style={{ fontSize: 12.5, minWidth: 760 }}>
                  <thead>
                    <tr><th>Cliente</th><th className="num">Frascos</th><th className="num">Nota</th><th>Tela final</th><th>Comentário</th><th>Checkout</th><th>Concluiu</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td><div style={{ fontWeight: 600 }}>{r.firstName || '—'}</div><div style={{ color: 'var(--fg4)', fontSize: 11.5 }}>{r.email}</div></td>
                        <td className="num mono">{r.bottles}</td>
                        <td className="num mono">{r.satisfaction != null ? `${r.satisfaction}★` : '—'}</td>
                        <td>{r.outcome ? SV_OUTCOME_LABEL[r.outcome] || r.outcome : <span style={{ color: 'var(--fg5)' }}>não terminou</span>}</td>
                        <td style={{ maxWidth: 280, whiteSpace: 'normal', color: r.comment ? 'var(--fg2)' : 'var(--fg5)' }}>{r.comment || '—'}</td>
                        <td>{r.purchased ? <span style={{ color: 'var(--money)', fontWeight: 600 }}>comprou</span> : r.checkout ? 'clicou' : '—'}</td>
                        <td style={{ whiteSpace: 'nowrap', color: 'var(--fg3)' }}>{r.completedAt ? fmtDateTime(r.completedAt) : '—'}</td>
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

Object.assign(window, { SurveysPage });
