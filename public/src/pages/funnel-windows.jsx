/* global React, Icon, fmtCurrency, fmtInt, fmtPct, SkelMiniKpis, SkelTablePanel, FunnelChart */
/* Funil por JANELAS (Janela 1..K de N dias até uma data): cards por janela,
   comparativo entre janelas com a leitura da causa (volume de FEs × AOV de
   sessão + estágio que mais mexeu) e tabela etapa × janela.
   Dados: /api/metrics/funnel/sequence (fetchFunnelSequence). */

const { useState: useStateFW, useEffect: useEffectFW } = React;

const FW_WINDOWS = [3, 7, 15, 30, 60];
const FW_INPUT = { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 9px', color: 'var(--fg1)', fontFamily: 'var(--f-body)', fontSize: 12 };

function fwShort(w) { const d = (s) => s.slice(8, 10) + '/' + s.slice(5, 7); return `${d(w.start)}–${d(w.end)}`; }
function fwPp(f) { return (f >= 0 ? '+' : '−') + (Math.abs(f) * 100).toFixed(1).replace('.', ',') + ' pp'; }
function FwDelta({ value, kind = 'rel' }) {
  if (value == null) return <span style={{ color: 'var(--fg5)' }}>—</span>;
  const up = value >= 0;
  const text = kind === 'pp' ? fwPp(value).slice(1) : kind === 'money' ? fmtCurrency(Math.abs(value), 'USD', 0) : (Math.abs(value) * 100).toFixed(1).replace('.', ',') + '%';
  const flat = Math.abs(value) < (kind === 'pp' ? 0.0005 : kind === 'money' ? 0.5 : 0.002);
  return <span className="mono" style={{ color: flat ? 'var(--fg4)' : up ? 'var(--success)' : 'var(--danger)', whiteSpace: 'nowrap' }}>{flat ? '■' : up ? '▲' : '▼'} {text}</span>;
}

function FunnelWindowsView({ filters, family }) {
  const [win, setWin] = useStateFW(7);
  const [customWin, setCustomWin] = useStateFW('');
  const [count, setCount] = useStateFW(3);
  const [anchor, setAnchor] = useStateFW('');
  const [anchorInput, setAnchorInput] = useStateFW('');
  const [today, setToday] = useStateFW(false);
  const [state, setState] = useStateFW({ status: 'loading', data: null, error: null });
  const cur = filters.currency || 'USD';
  const platformsKey = Array.from(filters.platforms || []).join(',');
  const familiesKey = Array.from(filters.families || []).join(',');
  const countriesKey = Array.from(filters.countries || []).join(',');
  const funnelsKey = Array.from(filters.funnels || []).join(',');

  useEffectFW(() => {
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading' }));
    window.NSApi.fetchFunnelSequence(filters, { window: win, count, anchor: anchor || null, today })
      .then((data) => { if (!cancelled) setState({ status: 'ready', data, error: null }); })
      .catch((err) => { if (!cancelled) setState({ status: 'error', data: null, error: err.message }); });
    return () => { cancelled = true; };
  }, [win, count, anchor, today, platformsKey, familiesKey, countriesKey, funnelsKey]);

  const seq = state.data;
  const scopeKey = family && family !== 'all' ? family : 'all';
  const scope = seq ? (seq.scopes[scopeKey] || seq.scopes.all) : null;
  const scopeOf = (w) => (scopeKey === 'all' ? w.all : (w.byFamily[scopeKey] || { stages: [], summary: { feGroups: 0, totalGroups: 0, totalRevenue: 0, aov: 0, aovFEOnly: 0, aovWithUpsell: 0, revenueLiftFromUpsells: 0 } }));
  const backend = (stages) => stages.filter((s) => !/^(fe|frontend|front)$/i.test(s.id) && !/^front/i.test(s.label));
  const toneColor = { pos: 'var(--success)', neg: 'var(--danger)', neutral: 'var(--fg4)' };
  const sectionTitle = (x) => <div className="eyebrow" style={{ fontSize: 10, margin: '16px 0 8px', color: 'var(--accent)' }}>{x}</div>;
  const todayBrt = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);

  return (
    <>
      <div className="panel" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '10px 14px', marginBottom: 14 }}>
        <span className="f-label">JANELA</span>
        <div className="seg">
          {FW_WINDOWS.map((w) => <button key={w} className={win === w ? 'is-active' : ''} onClick={() => { setWin(w); setCustomWin(''); }}>{w}d</button>)}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg4)' }} title="Qualquer tamanho de 1 a 90 dias">
          personalizada
          <input type="number" min={1} max={90} value={customWin} placeholder="N dias" style={{ ...FW_INPUT, width: 78 }}
            onChange={(e) => setCustomWin(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { const n = parseInt(customWin, 10); if (n >= 1 && n <= 90) setWin(n); } }}
            onBlur={() => { const n = parseInt(customWin, 10); if (n >= 1 && n <= 90) setWin(n); }}/>
          {!FW_WINDOWS.includes(win) && <span className="mono" style={{ color: 'var(--accent)' }}>{win}d ativa</span>}
          {customWin !== '' && !(parseInt(customWin, 10) >= 1 && parseInt(customWin, 10) <= 90) && <span style={{ color: 'var(--warning)' }}>use 1 a 90</span>}
        </label>
        <span className="f-label" style={{ marginLeft: 6 }}>ATÉ O DIA</span>
        <input type="date" value={anchorInput} min="2024-01-01" max={todayBrt} style={{ ...FW_INPUT, width: 150 }}
          onChange={(e) => { const v = e.target.value; setAnchorInput(v); if (!v) { setAnchor(''); return; } if (/^\d{4}-\d{2}-\d{2}$/.test(v) && parseInt(v.slice(0, 4), 10) >= 2024 && v <= todayBrt) setAnchor(v); }}/>
        {anchor
          ? <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => { setAnchor(''); setAnchorInput(''); }}>× voltar pra {today ? 'hoje' : 'ontem'}</button>
          : <span style={{ fontSize: 11, color: 'var(--fg5)' }}>{today ? 'hoje (parcial)' : 'ontem (último dia completo)'}</span>}
        {!anchor && (
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: 'var(--fg4)', cursor: 'pointer' }}>
            <input type="checkbox" checked={today} onChange={(e) => setToday(e.target.checked)}/> incluir hoje (parcial)
          </label>
        )}
        <span className="f-label" style={{ marginLeft: 6 }}>QUANTAS JANELAS</span>
        <div className="seg">{[2, 3, 4, 6, 8].map((k) => <button key={k} className={count === k ? 'is-active' : ''} onClick={() => setCount(k)}>{k}</button>)}</div>
        <span style={{ fontSize: 11, color: 'var(--fg5)' }}>= {count} × {win} dias, a última terminando {seq?.anchor || anchor || (today ? 'hoje' : 'ontem')}{scopeKey !== 'all' ? ` · funil ${scopeKey}` : ''}</span>
      </div>

      {state.status === 'error' && <div className="panel" style={{ color: 'var(--danger)', fontSize: 12 }}>Erro ao carregar: {state.error}</div>}
      {!seq && state.status === 'loading' && <><SkelMiniKpis n={4}/><SkelTablePanel rows={6} cols={6} title="Funil por janela"/></>}

      {seq && scope && (
        <div style={{ opacity: state.status === 'loading' ? 0.45 : 1, transition: 'opacity .2s' }}>
          {sectionTitle(`COMO CADA JANELA SE COMPORTOU (${seq.count} × ${seq.window} DIAS)`)}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
            {seq.windows.map((w) => {
              const s = scopeOf(w); const n = scope.notes[w.index];
              return (
                <div key={w.index} className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg5)', letterSpacing: '0.08em' }}>{w.label.toUpperCase()} · {w.start} → {w.end}</div>
                  {n && <div style={{ fontWeight: 700, fontSize: 13, color: toneColor[n.tone] }}>{n.title}</div>}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {[[fmtInt(s.summary.feGroups), 'FEs (topo)'], [fmtCurrency(s.summary.totalRevenue, cur, 0), 'Receita'], [fmtCurrency(s.summary.aov, cur, 0), 'AOV de sessão'], [s.summary.aovFEOnly > 0 ? `+${(s.summary.revenueLiftFromUpsells * 100).toFixed(0)}%` : '—', 'Lift de upsells']].map(([v, l]) => (
                      <div key={l}><div className="mono" style={{ fontSize: 16, fontWeight: 700 }}>{v}</div><div style={{ fontSize: 10, color: 'var(--fg5)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{l}</div></div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {backend(s.stages).map((st) => (
                      <span key={st.id} title={`${st.label}: ${fmtInt(st.volume)} pedidos · ${fmtCurrency(st.revenue, cur, 0)}`} style={{ fontFamily: 'var(--f-mono)', fontSize: 10, padding: '2px 7px', borderRadius: 'var(--r-full)', background: 'color-mix(in oklab, var(--accent) 10%, transparent)', color: 'var(--fg2)' }}>
                        {st.label} <b>{fmtPct(st.takeRate, 1)}</b>
                      </span>
                    ))}
                  </div>
                  {n && <div style={{ fontSize: 12, color: 'var(--fg3)', lineHeight: 1.55 }}>{n.text}</div>}
                </div>
              );
            })}
          </div>

          {sectionTitle('FUNIL EM BARRAS · UMA JANELA AO LADO DA OUTRA')}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${seq.windows.length > 3 ? 300 : 360}px, 1fr))`, gap: 12 }}>
            {seq.windows.map((w) => {
              const sc = scopeOf(w);
              return (
                <div key={w.index} className="panel" style={{ padding: '10px 12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 12 }}>{w.label}</div>
                      <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg5)' }}>{fwShort(w)}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="mono" style={{ fontSize: 12, color: 'var(--money)', fontWeight: 700 }}>{fmtCurrency(sc.summary.totalRevenue, cur, 0)}</div>
                      <div style={{ fontSize: 10, color: 'var(--fg5)' }}>{fmtInt(sc.summary.feGroups)} FEs · AOV {fmtCurrency(sc.summary.aov, cur, 0)}</div>
                    </div>
                  </div>
                  <FunnelChart stages={sc.stages.map((st) => ({ label: st.label, volume: st.volume, revenue: st.revenue }))} currency={cur}/>
                </div>
              );
            })}
          </div>

          {scope.transitions.length > 0 && (
            <>
              {sectionTitle('COMPARATIVO JANELA A JANELA — DE ONDE VEIO A VARIAÇÃO')}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
                {scope.transitions.map((t) => {
                  const Row = ({ l, v, color }) => <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--border-soft)' }}><span style={{ color: 'var(--fg4)' }}>{l}</span><b className="mono" style={{ color }}>{v}</b></div>;
                  return (
                    <div key={t.to} className="panel">
                      <h5 style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--accent)' }}>Janela {t.from + 1} → {t.to + 1}</h5>
                      <Row l="Receita" v={<>{fmtCurrency(t.prevRevenue, cur, 0)} → {fmtCurrency(t.revenue, cur, 0)} <FwDelta value={t.revenuePct}/></>}/>
                      <Row l="FEs (volume)" v={<>{fmtInt(t.prevFeGroups)} → {fmtInt(t.feGroups)} <FwDelta value={t.fePct}/></>}/>
                      <Row l="AOV de sessão" v={<>{fmtCurrency(t.prevAov, cur, 0)} → {fmtCurrency(t.aov, cur, 0)} <FwDelta value={t.aovPct}/></>}/>
                      <Row l="Efeito do volume" v={<FwDelta value={t.volumeEffect} kind="money"/>}/>
                      <Row l="Efeito do AOV" v={<FwDelta value={t.aovEffect} kind="money"/>}/>
                      <Row l="Lift de upsells" v={<>{(t.prevLift * 100).toFixed(0)}% → {(t.lift * 100).toFixed(0)}% <FwDelta value={t.lift - t.prevLift} kind="pp"/></>}/>
                      {t.stages.length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ fontSize: 10, color: 'var(--fg5)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>Take rate por estágio</div>
                          {t.stages.map((s) => (
                            <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '60px 1fr auto auto', gap: 8, fontSize: 12, padding: '2px 0', color: t.topStage && t.topStage.id === s.id ? 'var(--fg1)' : 'var(--fg3)', fontWeight: t.topStage && t.topStage.id === s.id ? 700 : 400 }}>
                              <span>{s.label}</span>
                              <span className="mono">{fmtPct(s.prevTakeRate, 1)} → {fmtPct(s.takeRate, 1)}</span>
                              <FwDelta value={s.takePp} kind="pp"/>
                              <FwDelta value={s.takeEffectUsd} kind="money"/>
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{ fontSize: 12, color: 'var(--fg3)', lineHeight: 1.55, marginTop: 8 }}>{t.note}</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {sectionTitle('TAKE RATE POR ETAPA · JANELA A JANELA')}
          <div className="panel">
            <div style={{ fontSize: 11, color: 'var(--fg4)', marginBottom: 10 }}>Uma barra por janela em cada etapa (J1 = mais antiga, última em destaque). Comprimento = take rate relativa às FEs da própria janela.</div>
            {(() => {
              const ids = [];
              for (const w of seq.windows) for (const st of backend(scopeOf(w).stages)) if (!ids.some((x) => x.id === st.id)) ids.push({ id: st.id, label: st.label });
              const maxTake = Math.max(0.05, ...seq.windows.flatMap((w) => backend(scopeOf(w).stages).map((st) => st.takeRate)));
              const K = seq.windows.length;
              if (!ids.length) return <div style={{ fontSize: 12, color: 'var(--fg5)' }}>Sem etapas de backend nas janelas.</div>;
              return ids.map((st) => (
                <div key={st.id} style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 12, alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--border-soft)' }}>
                  <div style={{ fontWeight: 700, fontSize: 12 }}>{st.label}</div>
                  <div style={{ display: 'grid', gap: 3 }}>
                    {seq.windows.map((w, i) => {
                      const x = scopeOf(w).stages.find((y) => y.id === st.id);
                      const take = x ? x.takeRate : 0;
                      const prev = i > 0 ? (scopeOf(seq.windows[i - 1]).stages.find((y) => y.id === st.id) || null) : null;
                      const last = i === K - 1;
                      return (
                        <div key={w.index} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 150px', gap: 8, alignItems: 'center' }}>
                          <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: last ? 'var(--accent)' : 'var(--fg5)', fontWeight: last ? 700 : 400 }}>J{i + 1}</span>
                          <div style={{ height: 12, borderRadius: 4, background: 'color-mix(in oklab, var(--fg4) 12%, transparent)', overflow: 'hidden' }}>
                            <div style={{ width: `${Math.max(1, (take / maxTake) * 100)}%`, height: '100%', borderRadius: 4, background: last ? 'var(--accent)' : 'color-mix(in oklab, var(--accent) 55%, var(--bg))' }}/>
                          </div>
                          <span className="mono" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                            {fmtPct(take, 1)} <span style={{ color: 'var(--fg5)' }}>· {fmtInt(x ? x.volume : 0)}</span>
                            {prev && <span style={{ marginLeft: 6 }}><FwDelta value={take - prev.takeRate} kind="pp"/></span>}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ));
            })()}
          </div>

          {sectionTitle('ETAPA × JANELA')}
          <div className="panel" style={{ padding: 0 }}>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr>
                  <th>Etapa</th>
                  {seq.windows.map((w) => <th key={w.index} className="num">{w.label}<div style={{ fontSize: 9, color: 'var(--fg5)', fontWeight: 400 }}>{fwShort(w)}</div></th>)}
                </tr></thead>
                <tbody>
                  {(() => {
                    const ids = [];
                    for (const w of seq.windows) for (const s of scopeOf(w).stages) if (!ids.some((x) => x.id === s.id)) ids.push({ id: s.id, label: s.label });
                    return ids.map((st) => (
                      <tr key={st.id}>
                        <td style={{ fontWeight: 600 }}>{st.label}</td>
                        {seq.windows.map((w, i) => {
                          const s = scopeOf(w).stages.find((x) => x.id === st.id);
                          const p = i > 0 ? scopeOf(seq.windows[i - 1]).stages.find((x) => x.id === st.id) : null;
                          const isFe = /^(fe|frontend|front)$/i.test(st.id) || /^front/i.test(st.label);
                          return (
                            <td key={w.index} className="num cell-mono">
                              {s ? (isFe ? fmtInt(s.volume) : fmtPct(s.takeRate, 1)) : '—'}
                              <div style={{ fontSize: 10, color: 'var(--money)' }}>{s ? fmtCurrency(s.revenue, cur, 0) : ''}</div>
                              {s && p && !isFe && <div style={{ fontSize: 10 }}><FwDelta value={s.takeRate - p.takeRate} kind="pp"/></div>}
                              {s && p && isFe && <div style={{ fontSize: 10 }}><FwDelta value={p.volume ? (s.volume - p.volume) / p.volume : null}/></div>}
                            </td>
                          );
                        })}
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg5)', marginTop: 8 }}>Mesmos números do funil da aba (mesma função por janela). FE mostra pedidos e Δ de volume; backends mostram take rate relativa às FEs e Δ em pontos percentuais. "Efeito" em $ = Δtake × FEs da janela × ticket do estágio.</div>
        </div>
      )}
    </>
  );
}

Object.assign(window, { FunnelWindowsView });
