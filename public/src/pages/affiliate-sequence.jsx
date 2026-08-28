/* global React, Icon, fmtCurrency, fmtInt, fmtPct, CpaStatusChip, SkelTablePanel, SkelMiniKpis, AaPlat, AaEmpty, downloadCsv */
/* Análise de afiliados — visões em SEQUÊNCIA de janelas (Janela 1..K):
     AaSequenceView   tabela por janela (como as "Semanas" do relatório)
     AaEvolutionView  Evolução · Comentários (tag, barras, ranks, título + texto)
     AaHealthView     Saúde da empresa (linha do tempo, dinâmica da base, risco, reativação)
   Dados: /api/metrics/affiliate-analysis/sequence (fetchAffiliateSequence). */

const { useState: useStateAS, useMemo: useMemoAS } = React;

const AS_TAG = {
  breakout:    { label: '🚀 Breakout',            tone: 'var(--success)' },
  crescimento: { label: '📈 Crescimento',         tone: 'var(--success)' },
  estavel:     { label: '➖ Estável / saudável',   tone: 'var(--accent)' },
  estagnado:   { label: '➖ Estagnado',            tone: 'var(--accent)' },
  volatil:     { label: '🔄 Volátil',              tone: 'var(--warning)' },
  queda:       { label: '📉 Queda',                tone: 'var(--warning)' },
  queda_forte: { label: '🔻 Queda forte',          tone: 'var(--danger)' },
  churn:       { label: '⚠️ Saiu do radar',        tone: 'var(--danger)' },
  novo:        { label: '🆕 Novo entrante',        tone: 'var(--gold)' },
};

function asShortRange(w) {
  const d = (s) => s.slice(8, 10) + '/' + s.slice(5, 7);
  return `${d(w.start)}–${d(w.end)}`;
}

function AsTag({ tag }) {
  const t = AS_TAG[tag] || { label: tag, tone: 'var(--fg4)' };
  return (
    <span style={{
      display: 'inline-block', fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
      padding: '3px 9px', borderRadius: 'var(--r-full)', whiteSpace: 'nowrap',
      color: t.tone, background: `color-mix(in oklab, ${t.tone} 12%, transparent)`, border: `1px solid color-mix(in oklab, ${t.tone} 35%, transparent)`,
    }}>{t.label}</span>
  );
}

// Barras verticais por janela (receita), como no relatório: barra vazia = ausente.
function AaBars({ values, labels, height = 56, format = 'money' }) {
  const nums = values.map((v) => (v == null ? 0 : v));
  const max = Math.max(...nums, 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height }}>
      {nums.map((v, i) => {
        const h = v === 0 ? 3 : Math.max(6, Math.round((v / max) * (height - 14)));
        const present = values[i] != null;
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flex: 1, minWidth: 0 }} title={`${labels[i]}: ${present ? (format === 'money' ? fmtCurrency(values[i], 'USD', 0) : fmtInt(values[i])) : 'ausente'}`}>
            <div style={{ width: '100%', height: h, borderRadius: '3px 3px 0 0', background: present ? 'linear-gradient(180deg, var(--accent), color-mix(in oklab, var(--accent) 60%, var(--bg)))' : 'var(--border)' }}/>
            <div style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--fg5)', whiteSpace: 'nowrap' }}>{labels[i]}</div>
          </div>
        );
      })}
    </div>
  );
}

function AsDelta({ value }) {
  if (value == null) return <span style={{ color: 'var(--fg5)' }}>—</span>;
  const up = value >= 0;
  return <span className="mono" style={{ color: up ? 'var(--success)' : 'var(--danger)' }}>{up ? '▲' : '▼'} {(Math.abs(value) * 100).toFixed(1).replace('.', ',')}%</span>;
}

// ── Janelas (tabela por janela) ─────────────────────────────────────────
function AaSequenceView({ seq, onOpen, cur = 'USD' }) {
  const [idx, setIdx] = useStateAS(seq.windows.length - 1);
  const sectionTitle = (x) => <div className="eyebrow" style={{ fontSize: 10, margin: '4px 0 8px', color: 'var(--accent)' }}>{x}</div>;
  const [showAll, setShowAll] = useStateAS(false);
  const w = seq.windows[Math.min(idx, seq.windows.length - 1)];
  const rows = showAll ? w.rows : w.rows.slice(0, 25);
  const prevRank = useMemoAS(() => {
    const p = seq.windows[w.index - 1];
    return p ? new Map(p.rows.map((r) => [r.key, r.rank])) : null;
  }, [seq, w.index]);
  const tone = (n) => (n == null ? 'var(--fg5)' : n < 0 ? 'var(--danger)' : 'var(--money)');
  return (
    <>
      {sectionTitle(`COMO CADA JANELA SE COMPORTOU (${seq.count} × ${seq.window} DIAS)`)}
      <AaWindowCards seq={seq} cur={cur}/>
      {seq.transitions.length > 0 && (
        <>
          <div style={{ height: 14 }}/>
          {sectionTitle('COMPARATIVO ENTRE JANELAS — DE ONDE VEIO A VARIAÇÃO')}
          <AaTransitionCards seq={seq} cur={cur}/>
        </>
      )}
      <div style={{ height: 18 }}/>
      {sectionTitle('TABELA POR JANELA — escolha a janela')}
      <div className="seg" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        {seq.windows.map((x) => (
          <button key={x.index} className={x.index === w.index ? 'is-active' : ''} onClick={() => { setIdx(x.index); setShowAll(false); }}>
            {x.label} · {asShortRange(x)}
          </button>
        ))}
      </div>
      <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
        {[
          ['Receita — afiliados', fmtCurrency(w.totals.revenue, cur, 0), true],
          ['Pedidos aprovados', fmtInt(w.totals.sales), false],
          ['FEs aprovadas · AOV', `${fmtInt(w.totals.feApproved)} · ${fmtCurrency(w.totals.aov, cur, 0)}`, false],
          ['Concentração do Top 10', fmtPct(w.concentrationTop10, 1), false],
          ['Afiliados ativos', fmtInt(w.active), false],
          ['Net após CPA (total)', w.totals.netAfterCpaTotal == null ? '—' : fmtCurrency(w.totals.netAfterCpaTotal, cur, 0), true],
        ].map(([l, v, money]) => (
          <div key={l} className="panel" style={{ padding: '12px 14px' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--fg5)', fontWeight: 600, marginBottom: 4 }}>{l}</div>
            <div className="mono" style={{ fontFamily: 'var(--f-display)', fontSize: 22, fontWeight: 700, color: money ? 'var(--money)' : 'var(--fg1)' }}>{v}</div>
          </div>
        ))}
      </div>
      <div className="panel" style={{ padding: 0 }}>
        <div className="panel-head" style={{ padding: '12px 16px 6px' }}>
          <div className="panel-title">
            <span className="panel-eyebrow">{w.label.toUpperCase()} · {w.start} → {w.end}</span>
            <span className="panel-sub">{fmtInt(w.rows.length)} com venda · Δ posição vs a janela anterior · clique pra ver o porquê desta janela</span>
          </div>
        </div>
        <div className="tbl-wrap" style={{ maxHeight: 640 }}>
          <table className="tbl tbl--sticky-first">
            <thead><tr>
              <th>#</th><th>Afiliado</th><th>Plat.</th>
              <th className="num">Vendas</th><th className="num">Receita</th><th className="num">AOV</th>
              <th className="num">Aprov.</th><th className="num">Reemb.</th>
              <th className="num">CPA pago</th><th className="num">CPA/venda</th><th className="num">Net pós-CPA</th><th>Status</th>
            </tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={12}><AaEmpty>Nenhum afiliado com venda nesta janela.</AaEmpty></td></tr>}
              {rows.map((r) => {
                const pr = prevRank ? prevRank.get(r.key) : undefined;
                const d = pr != null ? pr - r.rank : null;
                return (
                  <tr key={r.key} onClick={() => onOpen?.(r.key, w.end)} style={{ cursor: 'pointer' }}>
                    <td className="cell-mono" style={{ whiteSpace: 'nowrap' }}>
                      #{r.rank}
                      {d != null && d !== 0 && <span style={{ marginLeft: 4, fontSize: 9, color: d > 0 ? 'var(--success)' : 'var(--danger)' }}>{d > 0 ? '▲' : '▼'}{Math.abs(d)}</span>}
                      {prevRank && pr == null && <span style={{ marginLeft: 4, fontSize: 9, color: 'var(--accent)' }}>novo</span>}
                    </td>
                    <td style={{ maxWidth: 220 }}>
                      <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.kind === 'partner' && <span style={{ color: 'var(--accent)', marginRight: 4 }}><Icon name="link" size={10}/></span>}{r.name}</div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{r.platforms.map((p) => <span key={p} style={{ marginRight: 3 }}><AaPlat slug={p}/></span>)}</td>
                    <td className="num cell-mono">{fmtInt(r.m.sales)}</td>
                    <td className="num cell-mono" style={{ color: 'var(--money)', fontWeight: 600 }}>{fmtCurrency(r.m.revenue, cur, 2)}</td>
                    <td className="num cell-mono">{fmtCurrency(r.m.aov, cur, 2)}</td>
                    <td className="num cell-mono">{fmtPct(r.m.approvalRate, 1)}</td>
                    <td className="num cell-mono" style={{ color: r.m.refundRate > 0.15 ? 'var(--danger)' : undefined }}>{fmtPct(r.m.refundRate, 1)}</td>
                    <td className="num cell-mono">{fmtCurrency(r.m.cpaPaid, cur, 0)}</td>
                    <td className="num cell-mono">{r.m.cpaPerFe > 0 ? fmtCurrency(r.m.cpaPerFe, cur, 2) : '—'}</td>
                    <td className="num cell-mono" style={{ fontWeight: 700, color: tone(r.m.netAfterCpa) }}>{r.m.netAfterCpa == null ? '—' : fmtCurrency(r.m.netAfterCpa, cur, 2)}</td>
                    <td><CpaStatusChip status={r.m.cpaStatus}/></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {w.rows.length > 25 && (
          <div style={{ padding: 10, textAlign: 'center' }}>
            <button className="btn btn-ghost" onClick={() => setShowAll((v) => !v)}>{showAll ? 'mostrar só o top 25' : `mostrar todos (${w.rows.length})`}</button>
          </div>
        )}
      </div>
      {(w.internalExcluded > 0) && (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--fg4)', lineHeight: 1.6, padding: '12px 14px', border: '1px solid var(--border-soft)', borderRadius: 12 }}>
          <b>Nota metodológica:</b> {w.internalExcluded} contas de tracking interno/orgânico (ex.: <i>neuromindpro12</i>, ID "0") foram excluídas desta janela — juntas somam {fmtCurrency(w.internalRevenueExcluded, cur, 0)}. Não são parceiros reais; ligue "incluir internos" pra vê-las.
        </div>
      )}
    </>
  );
}


// ── Tops por janela (abaixo do ranking) ─────────────────────────────────
function AaTopsByWindow({ seq, onOpen, cur = 'USD', top = 10 }) {
  return (
    <div className="panel" style={{ marginTop: 14 }}>
      <div className="panel-head">
        <div className="panel-title">
          <span className="panel-eyebrow">TOPS POR JANELA · {seq.count} × {seq.window} DIAS</span>
          <span className="panel-sub">top {top} por receita em cada janela, da mais antiga pra mais recente · clique pra ver o porquê daquela janela · ajuste "quantas janelas" na barra acima</span>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(220px, 1fr))`, gap: 12 }}>
        {seq.windows.map((w) => {
          const prev = seq.windows[w.index - 1];
          const prevRank = prev ? new Map(prev.rows.map((r) => [r.key, r.rank])) : null;
          return (
            <div key={w.index} style={{ border: '1px solid var(--border-soft)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-soft)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 12 }}>{w.label}</div>
                  <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg5)' }}>{asShortRange(w)}</div>
                </div>
                <div className="mono" style={{ fontSize: 12, color: 'var(--money)', fontWeight: 700 }}>{fmtCurrency(w.totals.revenue, cur, 0)}</div>
              </div>
              {w.rows.length === 0 && <div style={{ padding: 12, fontSize: 11, color: 'var(--fg5)' }}>sem vendas</div>}
              {w.rows.slice(0, top).map((r) => {
                const pr = prevRank ? prevRank.get(r.key) : undefined;
                const d = pr != null ? pr - r.rank : null;
                return (
                  <div key={r.key} onClick={() => onOpen?.(r.key, w.end)} style={{ display: 'grid', gridTemplateColumns: '28px 1fr auto', gap: 8, alignItems: 'center', padding: '5px 12px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid var(--border-soft)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in oklab, var(--accent) 8%, transparent)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                    <span className="mono" style={{ color: 'var(--fg5)', fontSize: 11 }}>#{r.rank}</span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{r.name}</span>
                      <span style={{ fontSize: 10, color: 'var(--fg5)', display: 'flex', gap: 4, alignItems: 'center' }}>
                        {r.platforms.map((p) => <AaPlat key={p} slug={p}/>)}
                        <span>{fmtInt(r.m.sales)} vendas</span>
                        {d != null && d !== 0 && <span style={{ color: d > 0 ? 'var(--success)' : 'var(--danger)' }}>{d > 0 ? '▲' : '▼'}{Math.abs(d)}</span>}
                        {prevRank && pr == null && <span style={{ color: 'var(--accent)' }}>novo</span>}
                      </span>
                    </span>
                    <span className="mono" style={{ color: 'var(--money)', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtCurrency(r.m.revenue, cur, 0)}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Quem está parando de rodar (Evolução) ───────────────────────────────
function AaSlowingPanel({ seq, onOpen, cur = 'USD' }) {
  const [show, setShow] = useStateAS('all'); // all | parou | caindo
  const list = (seq.slowing || []).filter((r) => show === 'all' || r.state === show);
  const labels = seq.windows.map((w) => `J${w.index + 1}`);
  const nParou = (seq.slowing || []).filter((r) => r.state === 'parou').length;
  const nCaindo = (seq.slowing || []).filter((r) => r.state === 'caindo').length;
  const exportCsv = () => {
    const wLabel = (i) => { const w = seq.windows[i]; return w ? `J${i + 1} (${w.start} a ${w.end})` : `J${i + 1}`; };
    const headers = ['Afiliado', 'Tipo', 'Plataformas', 'Estado', 'Última venda', 'Pico $', 'Janela do pico', 'Última janela $', 'Última janela vendas', 'vs pico %',
      ...seq.windows.map((_, i) => `Receita ${wLabel(i)}`)];
    const body = list.map((r) => [r.name, r.kind === 'partner' ? 'parceiro' : 'conta', r.platforms.join('+'),
      r.state, `J${r.lastActiveIndex + 1}`, Math.round(r.peakRevenue), `J${r.peakIndex + 1}`,
      Math.round(r.lastRevenue), r.lastSales, Math.round(Math.abs(r.dropPct) * 100),
      ...r.revenue.map((v) => (v == null ? '' : Math.round(v)))]);
    downloadCsv(`parando-de-rodar-${show}-${seq.window}d-${seq.anchor}.csv`, headers, body);
  };
  return (
    <div className="panel" style={{ marginBottom: 14, padding: 0, border: '1px solid color-mix(in oklab, var(--danger) 30%, var(--border))' }}>
      <div className="panel-head" style={{ padding: '12px 16px 6px', flexWrap: 'wrap', gap: 8 }}>
        <div className="panel-title">
          <span className="panel-eyebrow" style={{ color: 'var(--danger)' }}>⚠ QUEM ESTÁ PARANDO DE RODAR</span>
          <span className="panel-sub">pico ≥ $500 em alguma janela e, na última, <b>parou</b> (zero vendas) ou está <b>caindo</b> (≤ 50% do pico e ainda descendo) · clique pra ver o porquê</span>
        </div>
        <div className="seg">
          {[['all', `Todos · ${(seq.slowing || []).length}`], ['parou', `Parou · ${nParou}`], ['caindo', `Caindo · ${nCaindo}`]].map(([k, l]) => (
            <button key={k} className={show === k ? 'is-active' : ''} onClick={() => setShow(k)}>{l}</button>
          ))}
        </div>
        <button className="btn btn-ghost" style={{ fontSize: 11, whiteSpace: 'nowrap' }} onClick={exportCsv} disabled={list.length === 0} title="Baixa a lista do filtro ativo em CSV (abre no Excel/Sheets)">
          <Icon name="download" size={12}/> Exportar CSV
        </button>
      </div>
      {list.length === 0 && <div style={{ padding: 16 }}><AaEmpty>Ninguém parando de rodar nas janelas escolhidas — base saudável.</AaEmpty></div>}
      {list.length > 0 && (
        <div className="tbl-wrap" style={{ maxHeight: 420 }}>
          <table className="tbl">
            <thead><tr><th>Afiliado</th><th>Plat.</th><th>Estado</th><th className="num">Pico</th><th className="num">Última janela</th><th className="num">vs pico</th><th>Receita por janela</th></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.key} onClick={() => onOpen?.(r.key, seq.windows[r.state === 'parou' ? r.lastActiveIndex : seq.windows.length - 1]?.end)} style={{ cursor: 'pointer' }}>
                  <td style={{ fontWeight: 600 }}>{r.kind === 'partner' && <span style={{ color: 'var(--accent)', marginRight: 4 }}><Icon name="link" size={10}/></span>}{r.name}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.platforms.map((p) => <span key={p} style={{ marginRight: 3 }}><AaPlat slug={p}/></span>)}</td>
                  <td>
                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--r-full)', color: r.state === 'parou' ? 'var(--danger)' : 'var(--warning)', background: `color-mix(in oklab, ${r.state === 'parou' ? 'var(--danger)' : 'var(--warning)'} 12%, transparent)` }}>
                      {r.state === 'parou' ? `● parou (última venda J${r.lastActiveIndex + 1})` : '● caindo'}
                    </span>
                  </td>
                  <td className="num cell-mono" style={{ color: 'var(--money)' }}>{fmtCurrency(r.peakRevenue, cur, 0)} <span style={{ color: 'var(--fg5)', fontSize: 10 }}>J{r.peakIndex + 1}</span></td>
                  <td className="num cell-mono">{fmtCurrency(r.lastRevenue, cur, 0)} <span style={{ color: 'var(--fg5)', fontSize: 10 }}>{fmtInt(r.lastSales)} vendas</span></td>
                  <td className="num cell-mono" style={{ color: 'var(--danger)' }}>▼ {(Math.abs(r.dropPct) * 100).toFixed(0)}%</td>
                  <td style={{ minWidth: 120 }}><AaBars values={r.revenue} labels={labels} height={32}/></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Evolução · Comentários ──────────────────────────────────────────────
function AaEvolutionView({ seq, onOpen, cur = 'USD' }) {
  const [filter, setFilter] = useStateAS('all');
  const labels = seq.windows.map((w) => `J${w.index + 1}`);
  const counts = useMemoAS(() => {
    const c = {};
    for (const e of seq.evolution) c[e.tag] = (c[e.tag] || 0) + 1;
    return c;
  }, [seq]);
  const list = filter === 'all' ? seq.evolution : seq.evolution.filter((e) => e.tag === filter);
  return (
    <>
      <div style={{ fontSize: 12, color: 'var(--fg4)', lineHeight: 1.6, padding: '12px 14px', border: '1px solid var(--border-soft)', borderRadius: 12, marginBottom: 12 }}>
        Todo afiliado que esteve no <b>Top 10</b> em pelo menos uma das {seq.windows.length} janelas está listado abaixo, ordenado por relevância. As barras mostram a receita em {labels.join(' / ')} (barra vazia = não vendeu naquela janela). Os comentários são gerados pelas regras da própria análise — números, ranks, aprovação e Net após CPA.
      </div>
      <AaSlowingPanel seq={seq} onOpen={onOpen} cur={cur}/>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
        <button className={`btn btn-ghost ${filter === 'all' ? 'is-active' : ''}`} style={{ fontSize: 11 }} onClick={() => setFilter('all')}>Todos · {seq.evolution.length}</button>
        {Object.entries(AS_TAG).filter(([k]) => counts[k]).map(([k, t]) => (
          <button key={k} className="btn btn-ghost" style={{ fontSize: 11, color: t.tone, opacity: filter === 'all' || filter === k ? 1 : 0.5 }} onClick={() => setFilter(filter === k ? 'all' : k)}>{t.label} · {counts[k]}</button>
        ))}
      </div>
      {list.length === 0 && <AaEmpty>Nenhum afiliado no Top 10 das janelas escolhidas.</AaEmpty>}
      <div style={{ display: 'grid', gap: 12 }}>
        {list.map((e) => {
          const last = e.per[e.per.length - 1];
          return (
            <div key={e.key} className="panel" style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 240px) 1fr', gap: 18, cursor: 'pointer' }} onClick={() => onOpen?.(e.key)}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.kind === 'partner' && <span style={{ color: 'var(--accent)', marginRight: 4 }}><Icon name="link" size={11}/></span>}{e.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--fg5)', fontFamily: 'var(--f-mono)', display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                    {e.platforms.map((p) => <AaPlat key={p} slug={p}/>)}
                    {e.bestRank != null && <span>melhor #{e.bestRank}</span>}
                  </div>
                </div>
                <AsTag tag={e.tag}/>
                <AaBars values={e.per.map((p) => (p ? p.revenue : null))} labels={labels}/>
              </div>
              <div style={{ minWidth: 0 }}>
                <h4 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 700, color: 'var(--accent)' }}>{e.title}</h4>
                <p style={{ margin: '0 0 10px', fontSize: 13, lineHeight: 1.65, color: 'var(--fg3)' }}>{e.text}</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 12, color: 'var(--fg5)' }}>
                  <div>Rank: <b className="mono" style={{ color: 'var(--fg1)' }}>{e.per.map((p) => (p && p.rank != null ? `#${p.rank}` : '—')).join(' → ')}</b></div>
                  <div>Variação: {e.deltas.slice(1).map((d, i) => <span key={i} style={{ marginLeft: i ? 8 : 0 }}><AsDelta value={d}/></span>)}</div>
                  {last && <div>Última: <b className="mono" style={{ color: 'var(--money)' }}>{fmtCurrency(last.revenue, cur, 0)}</b> · {fmtInt(last.sales)} pedidos{last.netAfterCpa != null ? <> · Net pós-CPA <b className="mono" style={{ color: last.netAfterCpa < 0 ? 'var(--danger)' : 'var(--fg1)' }}>{fmtCurrency(last.netAfterCpa, cur, 2)}</b></> : null}</div>}
                  {last && <CpaStatusChip status={last.cpaStatus}/>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}


// Cards por janela (linha do tempo) — usados em Janelas e Saúde.
function AaWindowCards({ seq, cur = 'USD' }) {
  const toneColor = { pos: 'var(--success)', neg: 'var(--danger)', neutral: 'var(--fg4)' };
  return (
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(240px, 1fr))`, gap: 12 }}>
      {seq.windows.map((w) => {
        const n = seq.health.notes.find((x) => x.index === w.index);
        return (
          <div key={w.index} className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg5)', letterSpacing: '0.08em' }}>{w.label.toUpperCase()} · {w.start} → {w.end}</div>
            {n && <div style={{ fontWeight: 700, fontSize: 13, color: toneColor[n.tone] }}>{n.title}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[[fmtCurrency(w.totals.revenue, cur, 0), 'Receita'], [fmtInt(w.totals.sales), 'Pedidos'], [fmtInt(w.active), 'Afiliados ativos'], [fmtPct(w.concentrationTop10, 1), 'Concentração Top 10']].map(([v, l]) => (
                <div key={l}><div className="mono" style={{ fontSize: 16, fontWeight: 700 }}>{v}</div><div style={{ fontSize: 10, color: 'var(--fg5)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{l}</div></div>
              ))}
            </div>
            {n && <div style={{ fontSize: 12, color: 'var(--fg3)', lineHeight: 1.55 }}>{n.text}</div>}
          </div>
        );
      })}
    </div>
  );
}

// Transições Janela i → i+1 (retidos / novos / churn) com a leitura da causa.
function AaTransitionCards({ seq, cur = 'USD' }) {
  return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
      {seq.transitions.map((t) => {
        const up = (t.retainedChangePct ?? 0) >= 0;
        const Row = ({ l, v, color }) => <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--border-soft)' }}><span style={{ color: 'var(--fg4)' }}>{l}</span><b className="mono" style={{ color }}>{v}</b></div>;
        return (
          <div key={t.to} className="panel">
            <h5 style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--accent)' }}>Janela {t.from + 1} → {t.to + 1}</h5>
            <Row l="Afiliados retidos (ativos nas duas janelas)" v={fmtInt(t.retained)}/>
            <Row l="Novos afiliados" v={`+${fmtInt(t.newCount)}`} color="var(--success)"/>
            <Row l="Afiliados que sumiram (churn)" v={`−${fmtInt(t.churnCount)}`} color="var(--danger)"/>
            <Row l="Receita trazida por novos" v={fmtCurrency(t.revenueNew, cur, 0)}/>
            <Row l="Receita perdida com churn" v={fmtCurrency(t.revenueChurn, cur, 0)}/>
            <Row l="Receita dos retidos (antes → depois)" v={`${fmtCurrency(t.revenueRetainedBefore, cur, 0)} → ${fmtCurrency(t.revenueRetainedAfter, cur, 0)}`}/>
            <Row l="Variação de receita dos retidos" v={t.retainedChangePct == null ? '—' : `${up ? '▲' : '▼'} ${(Math.abs(t.retainedChangePct) * 100).toFixed(1).replace('.', ',')}%`} color={up ? 'var(--success)' : 'var(--danger)'}/>
            <div style={{ fontSize: 12, color: 'var(--fg3)', lineHeight: 1.55, marginTop: 8 }}>{t.note}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── Saúde da empresa ────────────────────────────────────────────────────
function AaHealthView({ seq, onOpen, cur = 'USD' }) {
  const toneColor = { pos: 'var(--success)', neg: 'var(--danger)', neutral: 'var(--fg4)' };
  const warm = seq.reactivation.filter((r) => r.windowsAgo === 1);
  const cold = seq.reactivation.filter((r) => r.windowsAgo > 1);
  const sectionTitle = (t) => <div className="eyebrow" style={{ fontSize: 10, margin: '18px 0 8px', color: 'var(--accent)' }}>{t}</div>;
  const exportReactivation = () => {
    const wLabel = (i) => { const w = seq.windows[i]; return w ? `J${i + 1} (${w.start} a ${w.end})` : `J${i + 1}`; };
    const headers = ['Afiliado', 'Plataformas', 'Temperatura', 'Parou há (janelas)', 'Última venda', 'Pico pedidos', 'Pico receita $',
      ...seq.windows.map((_, i) => `Receita ${wLabel(i)}`)];
    const body = [...warm, ...cold].map((r) => [r.name, r.platforms.join('+'),
      r.windowsAgo === 1 ? 'morno' : 'frio', r.windowsAgo, `J${r.lastActiveIndex + 1}`,
      r.peakSales, Math.round(r.peakRevenue),
      ...r.revenue.map((v) => (v == null ? '' : Math.round(v)))]);
    downloadCsv(`reativar-${seq.window}d-${seq.anchor}.csv`, headers, body);
  };
  return (
    <>
      {sectionTitle(`LINHA DO TEMPO — COMO CADA JANELA SE COMPORTOU (${seq.window} DIAS CADA)`)}
      <AaWindowCards seq={seq} cur={cur}/>

      {sectionTitle('DINÂMICA DA BASE DE AFILIADOS')}
      <AaTransitionCards seq={seq} cur={cur}/>

      <div style={{ marginTop: 14, padding: '14px 16px', borderRadius: 12, border: '1px solid color-mix(in oklab, var(--danger) 35%, transparent)', background: 'color-mix(in oklab, var(--danger) 6%, transparent)', fontSize: 13, lineHeight: 1.65, color: 'var(--fg2)' }}>
        <b style={{ color: 'var(--danger)' }}>Risco estrutural de concentração:</b> {seq.health.risk.replace(/^Risco estrutural de concentração:\s*/, '')}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        {sectionTitle('QUEM VALE A PENA REATIVAR')}
        <button className="btn btn-ghost" style={{ fontSize: 11, whiteSpace: 'nowrap' }} onClick={exportReactivation} disabled={seq.reactivation.length === 0} title="Baixa a lista (mornos + frios) em CSV — abre no Excel/Sheets">
          <Icon name="download" size={12}/> Exportar CSV
        </button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--fg4)', marginBottom: 8 }}>
        Afiliados que venderam em alguma janela e sumiram na última. <span style={{ color: 'var(--warning)' }}>● Mornos</span> pararam na última transição — contato rápido tem mais chance; <span style={{ color: 'var(--fg5)' }}>● frios</span> pararam há mais tempo. Ordenados pelo pico de receita.
      </div>
      {seq.reactivation.length === 0 && <AaEmpty>Ninguém sumiu na última janela — base estável.</AaEmpty>}
      {seq.reactivation.length > 0 && (
        <div className="panel" style={{ padding: 0 }}>
          <div className="tbl-wrap" style={{ maxHeight: 520 }}>
            <table className="tbl">
              <thead><tr><th>Afiliado</th><th>Plat.</th><th>Parou</th><th className="num">Pico · pedidos</th><th className="num">Pico · receita</th><th>Receita por janela</th></tr></thead>
              <tbody>
                {[...warm, ...cold].map((r) => (
                  <tr key={r.key} onClick={() => onOpen?.(r.key, seq.windows[r.lastActiveIndex]?.end)} style={{ cursor: 'pointer' }}>
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{r.platforms.map((p) => <span key={p} style={{ marginRight: 3 }}><AaPlat slug={p}/></span>)}</td>
                    <td>
                      <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--r-full)', color: r.windowsAgo === 1 ? 'var(--warning)' : 'var(--fg5)', background: `color-mix(in oklab, ${r.windowsAgo === 1 ? 'var(--warning)' : 'var(--fg5)'} 12%, transparent)` }}>
                        ● {r.windowsAgo === 1 ? 'há 1 janela' : `há ${r.windowsAgo} janelas`}
                      </span>
                    </td>
                    <td className="num cell-mono">{fmtInt(r.peakSales)}</td>
                    <td className="num cell-mono" style={{ fontWeight: 700, color: 'var(--money)' }}>{fmtCurrency(r.peakRevenue, cur, 2)}</td>
                    <td style={{ minWidth: 120 }}><AaBars values={r.revenue} labels={seq.windows.map((w) => `J${w.index + 1}`)} height={32}/></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

Object.assign(window, { AaSequenceView, AaEvolutionView, AaHealthView, AaBars, AaTopsByWindow, AaSlowingPanel });
