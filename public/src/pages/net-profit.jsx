/* global React, Icon, fmtCurrency, fmtInt, fmtDateTime, platBadge, SkelTableRows */
/* Lucro real (admin-only) — redesign 2026-09-16.
   Tela inicial = só o essencial: 4 KPIs, a barra de composição (pra onde
   vai cada dólar) e 4 cards de canal compactos. Detalhe por demanda: clicar
   num canal abre as linhas da fórmula e a desagregação; abas secundárias
   (Afiliados, Projeções) ficam num seletor; parâmetros vivem num drawer
   lateral com campos grandes (recalcula ao digitar, salva como padrão ou
   como projeção). Pendências viram uma faixa discreta.
   API: GET/POST /api/admin/net-profit, PUT …/params, GET/POST/DELETE …/scenarios */

const { useState: useStateNP, useEffect: useEffectNP, useRef: useRefNP, useMemo: useMemoNP } = React;

const NP_CHANNEL_META = {
  front:      { short: 'Front-end',    icon: 'layers',   desc: 'Vendas nas plataformas (BuyGoods, Digistore24, JVZoo…)' },
  callcenter: { short: 'Call centers', icon: 'target',   desc: 'Tauk e Logicall' },
  recovery:   { short: 'Recuperação',  icon: 'refresh',  desc: 'Skill99 (e-mail/SMS) e SMS próprio' },
  salesbound: { short: 'SalesBound',   icon: 'plug',     desc: 'Cross-sell (dado manual até o postback)' },
};
// Cores das deduções na barra de composição (semânticas, fora da paleta de tema).
const NP_COST_COLORS = {
  cpa:        { label: 'CPA',              color: 'var(--accent)' },
  commission: { label: 'Comissões',        color: 'var(--accent2)' },
  refund:     { label: 'Reembolso/CB',     color: 'var(--danger)' },
  fee:        { label: 'Taxa plataforma',  color: 'var(--warning)' },
  product:    { label: 'Custo de produto', color: 'var(--fg4)' },
  allowance:  { label: 'Allowance',        color: 'var(--fg5)' },
};
const NP_SOURCE = {
  observed: { label: 'observado', color: 'var(--success)', hint: 'Medido nos dados do período' },
  manual:   { label: 'manual',    color: 'var(--accent)',  hint: 'Parâmetro informado por você' },
  config:   { label: 'config',    color: 'var(--fg4)',     hint: 'Cadastro (Plataformas / Integrações)' },
  default:  { label: 'padrão',    color: 'var(--fg5)',     hint: 'Valor padrão do sistema' },
  none:     { label: 'faltando',  color: 'var(--warning)', hint: 'Sem dado nem parâmetro — está em 0' },
};

function npMoney(v, cur, digits = 0) { return fmtCurrency(v || 0, cur, digits); }
function npPct(v, digits = 1) { return v == null ? '—' : `${Number(v).toFixed(digits)}%`; }
function npSet(obj, path, value) {
  const out = Array.isArray(obj) ? [...obj] : { ...obj };
  if (path.length === 1) { out[path[0]] = value; return out; }
  out[path[0]] = npSet(obj?.[path[0]] ?? {}, path.slice(1), value);
  return out;
}

function NpSourceChip({ source }) {
  const s = NP_SOURCE[source] || NP_SOURCE.default;
  return (
    <span title={s.hint} style={{ fontFamily: 'var(--f-mono)', fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 'var(--r-full)', color: s.color, background: `color-mix(in oklab, ${s.color} 12%, transparent)`, border: `1px solid color-mix(in oklab, ${s.color} 35%, transparent)`, whiteSpace: 'nowrap' }}>{s.label}</span>
  );
}

// ── Campo numérico ─────────────────────────────────────────────────────
// Rascunho local que só ressincroniza com o valor externo quando o campo
// NÃO está focado — digitar "12." ou "0,5" não é mais engolido a cada
// recálculo. Vazio = null (= usa o observado/cadastrado, mostrado no
// placeholder). Enter/Tab/blur normaliza.
function NpNum({ value, onChange, suffix = '%', placeholder = '', max, size = 'md', step = 1 }) {
  const [draft, setDraft] = useStateNP(value == null ? '' : String(value));
  const [focus, setFocus] = useStateNP(false);
  const focusRef = useRefNP(false);
  const timerRef = useRefNP(null);
  const pendingRef = useRefNP(undefined);   // undefined = nada pendente
  const onChangeRef = useRefNP(onChange);
  onChangeRef.current = onChange;

  // O valor de FORA só reescreve o campo quando ele NÃO está em edição: o
  // recálculo dispara a cada tecla e, sem esta guarda, apagaria o que está
  // sendo digitado ("12," vira "12" no meio da digitação).
  useEffectNP(() => {
    if (!focusRef.current) setDraft(value == null ? '' : String(value));
  }, [value]);

  // Se o campo sumir (fechar o drawer, trocar de aba) com algo pendente,
  // não perde o que foi digitado.
  useEffectNP(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (pendingRef.current !== undefined) onChangeRef.current(pendingRef.current.v);
  }, []);

  // '' → null (usa o observado/cadastrado) · inválido → undefined (ignora,
  // o rascunho continua na tela até o blur).
  const parse = (raw) => {
    const t = String(raw).trim();
    if (t === '') return null;
    const n = Number(t.replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) return undefined;
    const clamped = max != null ? Math.min(n, max) : n;
    return Math.round(clamped * 100) / 100;
  };

  // Propaga com atraso (o pai recalcula a cada mudança) e na hora no
  // blur/Enter/setas.
  const push = (raw, immediate) => {
    const parsed = parse(raw);
    if (parsed === undefined) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (immediate) {
      timerRef.current = null; pendingRef.current = undefined;
      onChangeRef.current(parsed);
      return;
    }
    pendingRef.current = { v: parsed };
    timerRef.current = setTimeout(() => {
      timerRef.current = null; pendingRef.current = undefined;
      onChangeRef.current(parsed);
    }, 350);
  };

  const bump = (dir, big) => {
    const cur = parse(draft);
    const base = cur == null || cur === undefined ? 0 : cur;
    const delta = (big ? step * 10 : step) * dir;
    const next = Math.max(0, max != null ? Math.min(max, base + delta) : base + delta);
    const rounded = String(Math.round(next * 100) / 100);
    setDraft(rounded);
    push(rounded, true);
  };

  const h = size === 'lg' ? 40 : 34;
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', height: h, border: `1px solid ${focus ? 'var(--accent)' : 'var(--border)'}`, boxShadow: focus ? '0 0 0 2px color-mix(in oklab, var(--accent) 22%, transparent)' : 'none', borderRadius: 9, background: 'var(--bg)', padding: '0 10px', minWidth: size === 'lg' ? 150 : 120, transition: 'border-color 120ms, box-shadow 120ms' }}>
      <input
        type="text" inputMode="decimal" autoComplete="off" spellCheck={false}
        value={draft} placeholder={placeholder}
        onFocus={(e) => { focusRef.current = true; setFocus(true); e.target.select(); }}
        onBlur={() => { focusRef.current = false; setFocus(false); push(draft, true); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); push(draft, true); e.currentTarget.blur(); return; }
          if (e.key === 'Escape') { setDraft(value == null ? '' : String(value)); e.currentTarget.blur(); return; }
          if (e.key === 'ArrowUp') { e.preventDefault(); bump(1, e.shiftKey); return; }
          if (e.key === 'ArrowDown') { e.preventDefault(); bump(-1, e.shiftKey); }
        }}
        onChange={(e) => {
          const raw = e.target.value;
          // Aceita vazio, dígitos e UM separador decimal (vírgula ou ponto)
          // — inclusive estados intermediários como "12," e "0.".
          if (raw !== '' && !/^\d*[.,]?\d*$/.test(raw)) return;
          setDraft(raw);
          push(raw, false);
        }}
        style={{ flex: 1, minWidth: 0, background: 'transparent', border: 0, outline: 'none', color: 'var(--fg1)', fontFamily: 'var(--f-mono)', fontSize: size === 'lg' ? 15 : 13, textAlign: 'right', padding: 0 }}/>
      {suffix && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--fg4)', fontFamily: 'var(--f-mono)', flex: 'none' }}>{suffix}</span>}
    </div>
  );
}

// Rótulo + campo + dica (o que vale quando vazio).
function NpField({ label, hint, children, wide }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0, gridColumn: wide ? '1 / -1' : undefined }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg2)' }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 10.5, color: 'var(--fg5)', fontFamily: 'var(--f-mono)', lineHeight: 1.3 }}>{hint}</span>}
    </label>
  );
}

// ATENÇÃO: componentes usados dentro de um render NUNCA podem ser
// declarados dentro dele — a cada render vira um "tipo" novo, o React
// desmonta/remonta a subárvore e os inputs perdem o foco a cada tecla
// (mesmo tropeço do AiField em affiliate-identity.jsx).
function NpSection({ title, hint, children }) {
  return (
    <section style={{ padding: '16px 0', borderBottom: '1px solid var(--border-soft)' }}>
      <div style={{ marginBottom: 10 }}>
        <div className="f-label">{title}</div>
        {hint && <div style={{ fontSize: 11, color: 'var(--fg5)', marginTop: 2, lineHeight: 1.4 }}>{hint}</div>}
      </div>
      {children}
    </section>
  );
}

function NpSwitch({ on, onChange, label, hint }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
      <span onClick={(e) => { e.preventDefault(); onChange(!on); }} role="switch" aria-checked={on}
        style={{ flex: 'none', width: 34, height: 20, borderRadius: 10, marginTop: 1, background: on ? 'var(--accent)' : 'color-mix(in oklab, var(--fg5) 40%, transparent)', position: 'relative', transition: 'background 150ms' }}>
        <span style={{ position: 'absolute', top: 2, left: on ? 16 : 2, width: 16, height: 16, borderRadius: 8, background: '#fff', transition: 'left 150ms', boxShadow: '0 1px 2px rgba(0,0,0,.25)' }}/>
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg2)' }}>{label}</span>
        {hint && <span style={{ fontSize: 10.5, color: 'var(--fg5)', lineHeight: 1.35 }}>{hint}</span>}
      </span>
    </label>
  );
}

function NpKpi({ label, value, sub, accent, money }) {
  return (
    <div className="mini-kpi" style={accent ? { borderColor: `color-mix(in oklab, ${accent} 30%, transparent)` } : undefined}>
      <div className="l">{label}</div>
      <div className="v" style={{ color: accent || (money ? 'var(--money)' : undefined) }}>{value}</div>
      {sub && <div className="s">{sub}</div>}
    </div>
  );
}

// ── Barra de composição: pra onde vai cada dólar faturado ─────────────
function NpCompositionBar({ result, cur }) {
  const rev = result.kpis.revenue;
  const totals = {};
  for (const ch of result.channels) for (const l of ch.lines) totals[l.key] = (totals[l.key] || 0) + l.usd;
  const segs = Object.entries(NP_COST_COLORS).map(([k, m]) => ({ key: k, ...m, usd: totals[k] || 0 })).filter((s) => s.usd > 0);
  const profit = result.kpis.profit;
  const pct = (v) => (rev > 0 ? Math.max(0, (v / rev) * 100) : 0);
  return (
    <div className="panel" style={{ marginBottom: 14, padding: '14px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10, gap: 12, flexWrap: 'wrap' }}>
        <span className="panel-eyebrow">DE CADA $100 FATURADOS</span>
        <span style={{ fontSize: 11, color: 'var(--fg4)', fontFamily: 'var(--f-mono)' }}>
          custos {npPct(rev > 0 ? (result.kpis.costs / rev) * 100 : 0)} · lucro <span style={{ color: profit >= 0 ? 'var(--money)' : 'var(--danger)', fontWeight: 700 }}>{npPct(result.kpis.marginPct)}</span>
        </span>
      </div>
      <div style={{ display: 'flex', height: 18, borderRadius: 9, overflow: 'hidden', background: 'color-mix(in oklab, var(--fg5) 15%, transparent)' }}>
        {segs.map((s) => (
          <div key={s.key} title={`${s.label}: ${npMoney(s.usd, cur)} (${npPct(pct(s.usd))})`} style={{ width: `${pct(s.usd)}%`, background: s.color, opacity: 0.85 }}/>
        ))}
        {profit > 0 && <div title={`Lucro: ${npMoney(profit, cur)} (${npPct(pct(profit))})`} style={{ width: `${pct(profit)}%`, background: 'var(--money)' }}/>}
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10 }}>
        {segs.map((s) => (
          <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg3)' }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: s.color, opacity: 0.85 }}/>
            {s.label} <span className="cell-mono" style={{ color: 'var(--fg1)' }}>{npMoney(s.usd, cur)}</span><span className="cell-mono" style={{ color: 'var(--fg5)' }}>{npPct(pct(s.usd))}</span>
          </span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg3)' }}>
          <span style={{ width: 9, height: 9, borderRadius: 3, background: 'var(--money)' }}/>
          Lucro <span className="cell-mono" style={{ color: profit >= 0 ? 'var(--money)' : 'var(--danger)', fontWeight: 700 }}>{npMoney(profit, cur)}</span>
        </span>
      </div>
    </div>
  );
}

// ── Linhas da fórmula (faturamento → deduções → lucro) ──────────────────
function NpLines({ gross, lines, profit, marginPct, cur, dense }) {
  const fs = dense ? 11.5 : 12.5;
  return (
    <table className="tbl" style={{ fontSize: fs }}>
      <tbody>
        <tr>
          <td style={{ fontWeight: 600 }}>Faturamento</td>
          <td className="num cell-mono" style={{ color: 'var(--fg1)', fontWeight: 600 }}>{npMoney(gross, cur)}</td>
          <td className="num cell-mono" style={{ color: 'var(--fg5)', width: 64 }}>100%</td>
          <td style={{ width: 84 }}/>
        </tr>
        {lines.map((l) => (
          <tr key={l.key}>
            <td style={{ color: 'var(--fg3)' }}>− {l.label}{l.note ? <span style={{ color: 'var(--fg5)', marginLeft: 6, fontSize: 10 }}>{l.note}</span> : null}</td>
            <td className="num cell-mono" style={{ color: l.usd > 0 ? 'var(--danger)' : 'var(--fg5)' }}>{l.usd > 0 ? '−' : ''}{npMoney(l.usd, cur)}</td>
            <td className="num cell-mono" style={{ color: 'var(--fg5)' }}>{npPct(l.pctOfGross)}</td>
            <td><NpSourceChip source={l.source}/></td>
          </tr>
        ))}
        <tr style={{ borderTop: '1px solid var(--border)' }}>
          <td style={{ fontWeight: 700 }}>= Lucro</td>
          <td className="num cell-mono" style={{ fontWeight: 700, color: profit >= 0 ? 'var(--money)' : 'var(--danger)' }}>{npMoney(profit, cur)}</td>
          <td className="num cell-mono" style={{ fontWeight: 600, color: profit >= 0 ? 'var(--money)' : 'var(--danger)' }}>{npPct(marginPct)}</td>
          <td/>
        </tr>
      </tbody>
    </table>
  );
}

// ── Card compacto de canal (clicável) ───────────────────────────────────
function NpChannelTile({ ch, cur, active, onClick }) {
  const meta = NP_CHANNEL_META[ch.key] || { short: ch.label, icon: 'layers' };
  const tone = !ch.available ? 'var(--fg5)' : ch.profit < 0 ? 'var(--danger)' : 'var(--money)';
  return (
    <button onClick={onClick} className="panel" style={{
      textAlign: 'left', cursor: 'pointer', padding: '14px 16px', margin: 0, width: '100%',
      borderColor: active ? 'var(--accent)' : undefined, boxShadow: active ? '0 0 0 2px color-mix(in oklab, var(--accent) 22%, transparent)' : undefined,
      opacity: ch.available ? 1 : 0.55, transition: 'border-color 120ms, box-shadow 120ms, transform 120ms',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, color: 'var(--fg1)' }}>
          <span style={{ width: 26, height: 26, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'var(--accent-soft, color-mix(in oklab, var(--accent) 12%, transparent))', color: 'var(--accent)' }}><Icon name={meta.icon} size={13}/></span>
          {meta.short}
        </span>
        <span className="cell-mono" style={{ fontSize: 10, color: 'var(--fg5)' }}>{ch.available ? `${npPct(ch.shareOfRevenuePct, 0)} do fat.` : 'sem dado'}</span>
      </div>
      <div className="cell-mono" style={{ fontSize: 22, fontWeight: 700, color: tone, letterSpacing: '-0.02em', lineHeight: 1 }}>{ch.available ? npMoney(ch.profit, cur) : '—'}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: 'var(--fg4)', fontFamily: 'var(--f-mono)' }}>
        <span>fat. <span style={{ color: 'var(--fg2)' }}>{npMoney(ch.gross, cur)}</span></span>
        <span>margem <span style={{ color: tone, fontWeight: 600 }}>{ch.available ? npPct(ch.marginPct) : '—'}</span></span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: 'color-mix(in oklab, var(--fg5) 18%, transparent)', marginTop: 8, overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(0, Math.min(100, ch.marginPct))}%`, height: '100%', background: tone }}/>
      </div>
    </button>
  );
}

function NpChannelDetail({ ch, cur, onClose }) {
  const meta = NP_CHANNEL_META[ch.key] || {};
  const [open, setOpen] = useStateNP(null);
  return (
    <div className="panel" style={{ marginBottom: 14, borderColor: 'color-mix(in oklab, var(--accent) 35%, transparent)' }}>
      <div className="panel-head" style={{ marginBottom: 8 }}>
        <div className="panel-title">
          <span className="panel-eyebrow">{ch.label.toUpperCase()} · COMO O LUCRO É CALCULADO</span>
          <div className="panel-sub">{meta.desc} · {fmtInt(ch.orders)} vendas · {npPct(ch.shareOfRevenuePct)} do faturamento · {npPct(ch.shareOfProfitPct)} do lucro</div>
        </div>
        <button className="icon-btn" onClick={onClose} title="fechar"><Icon name="x" size={13}/></button>
      </div>
      <div className="tbl-wrap" style={{ margin: 0, padding: 0 }}>
        <NpLines gross={ch.gross} lines={ch.lines} profit={ch.profit} marginPct={ch.marginPct} cur={cur}/>
      </div>
      {ch.breakdown.length > 1 && (
        <div style={{ marginTop: 12 }}>
          <div className="f-label" style={{ marginBottom: 6 }}>DESAGREGAÇÃO · {ch.breakdown.length} {ch.key === 'front' ? 'plataformas' : ch.key === 'callcenter' ? 'parceiros' : 'fontes'}</div>
          <div className="tbl-wrap" style={{ margin: 0, padding: 0 }}>
            <table className="tbl" style={{ fontSize: 12 }}>
              <thead><tr><th/><th className="num">Faturamento</th><th className="num">% do canal</th><th className="num">Custos</th><th className="num">Lucro</th><th className="num">Margem</th><th/></tr></thead>
              <tbody>
                {ch.breakdown.map((b) => {
                  const costs = b.lines.reduce((s, l) => s + l.usd, 0);
                  const on = open === b.key;
                  return (
                    <React.Fragment key={b.key}>
                      <tr onClick={() => setOpen(on ? null : b.key)} style={{ cursor: 'pointer' }}>
                        <td style={{ fontWeight: 600 }}>{b.label}<span style={{ color: 'var(--fg5)', marginLeft: 6, fontSize: 10 }}>{fmtInt(b.orders)} vendas</span></td>
                        <td className="num cell-mono">{npMoney(b.gross, cur)}</td>
                        <td className="num cell-mono" style={{ color: 'var(--fg5)' }}>{npPct(ch.gross > 0 ? (b.gross / ch.gross) * 100 : 0)}</td>
                        <td className="num cell-mono" style={{ color: 'var(--danger)' }}>{npMoney(costs, cur)}</td>
                        <td className="num cell-mono" style={{ fontWeight: 700, color: b.profit >= 0 ? 'var(--money)' : 'var(--danger)' }}>{npMoney(b.profit, cur)}</td>
                        <td className="num cell-mono">{npPct(b.marginPct)}</td>
                        <td style={{ width: 24, color: 'var(--fg5)' }}><Icon name={on ? 'chevron-down' : 'chevron-right'} size={11}/></td>
                      </tr>
                      {on && (
                        <tr><td colSpan={7} style={{ padding: '4px 0 10px 16px', background: 'color-mix(in oklab, var(--fg5) 6%, transparent)' }}>
                          <NpLines gross={b.gross} lines={b.lines} profit={b.profit} marginPct={b.marginPct} cur={cur} dense/>
                        </td></tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pendências (faixa discreta, expande) ────────────────────────────────
function NpNeedsStrip({ needs }) {
  const [open, setOpen] = useStateNP(false);
  if (!needs || needs.length === 0) return null;
  const req = needs.filter((n) => n.severity === 'required');
  const tone = req.length ? 'var(--danger)' : 'var(--warning)';
  return (
    <div className="panel" style={{ marginBottom: 14, padding: '10px 16px', borderColor: `color-mix(in oklab, ${tone} 35%, transparent)` }}>
      <button onClick={() => setOpen((v) => !v)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'var(--fg1)', textAlign: 'left' }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: tone, flex: 'none' }}/>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{req.length ? `${req.length} informação(ões) faltando` : `${needs.length} sugestão(ões)`}</span>
        <span style={{ fontSize: 11, color: 'var(--fg4)' }}>— o cálculo roda mesmo assim, com o fallback indicado</span>
        <span style={{ marginLeft: 'auto', color: 'var(--fg5)' }}><Icon name={open ? 'chevron-down' : 'chevron-right'} size={12}/></span>
      </button>
      {open && (
        <div style={{ display: 'grid', gap: 10, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border-soft)' }}>
          {[...req, ...needs.filter((n) => n.severity !== 'required')].map((n) => (
            <div key={n.key} style={{ display: 'grid', gridTemplateColumns: '10px 1fr', gap: 8, fontSize: 12 }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, marginTop: 5, background: n.severity === 'required' ? 'var(--danger)' : 'var(--warning)' }}/>
              <div>
                <div style={{ fontWeight: 600 }}>{n.title}</div>
                <div style={{ color: 'var(--fg4)', lineHeight: 1.45 }}>{n.detail}</div>
                <div className="cell-mono" style={{ fontSize: 11, color: 'var(--accent)', marginTop: 2 }}>→ {n.format}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Drawer de parâmetros ────────────────────────────────────────────────
function NpParamsDrawer({ params, setParam, setParams, obs, platforms, dirty, busy, onSave, onReset, onSaveScenario, onClose }) {
  const [advanced, setAdvanced] = useStateNP(false);
  const [perChannelRefund, setPerChannelRefund] = useStateNP(() => {
    const v = Object.values(params.refundPct); return new Set(v.map((x) => (x == null ? '∅' : String(x)))).size > 1;
  });
  const [perChannelCost, setPerChannelCost] = useStateNP(() => params.productCostPct.callcenter != null || params.productCostPct.recovery != null || params.productCostPct.salesbound != null);
  const [scnName, setScnName] = useStateNP('');
  const grid2 = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 };
  const refundAll = params.refundPct.front;
  const setRefundAll = (v) => setParams((p) => ({ ...p, refundPct: { front: v, callcenter: v, recovery: v, salesbound: v } }));
  const obsFe = obs?.front?.FRONTEND;
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose}/>
      <div className="drawer" style={{ width: 560, maxWidth: '100vw', display: 'flex', flexDirection: 'column' }}>
        <div className="drawer-head" style={{ alignItems: 'center' }}>
          <div>
            <div className="eyebrow" style={{ fontSize: 10 }}>LUCRO REAL · PARÂMETROS</div>
            <h3 style={{ margin: '4px 0 2px' }}>Premissas do cálculo</h3>
            <div style={{ fontSize: 11.5, color: 'var(--fg4)' }}>Tudo recalcula ao digitar. Campo vazio = usa o valor observado/cadastrado.</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>

        <div style={{ padding: '0 24px', overflowY: 'auto', flex: 1 }}>
          <NpSection title="REEMBOLSO / CHARGEBACK" hint="Observado = valor real por data do estorno, já calculado no dashboard. % fixo = projeção.">
            <div className="seg" style={{ marginBottom: 12 }}>
              <button className={params.refundMode === 'observed' ? 'is-active' : ''} onClick={() => setParam(['refundMode'], 'observed')}>observado</button>
              <button className={params.refundMode === 'manual' ? 'is-active' : ''} onClick={() => setParam(['refundMode'], 'manual')}>% fixo</button>
            </div>
            {params.refundMode === 'manual' && (
              perChannelRefund ? (
                <div style={grid2}>
                  {[['front', 'Front-end'], ['callcenter', 'Call centers'], ['recovery', 'Recuperação'], ['salesbound', 'SalesBound']].map(([k, l]) => (
                    <NpField key={k} label={l}><NpNum value={params.refundPct[k]} onChange={(v) => setParam(['refundPct', k], v)} placeholder="0" max={100}/></NpField>
                  ))}
                  <button className="btn btn-ghost" style={{ gridColumn: '1 / -1', justifySelf: 'start', fontSize: 11 }} onClick={() => { setPerChannelRefund(false); setRefundAll(refundAll); }}>usar um % só</button>
                </div>
              ) : (
                <div style={grid2}>
                  <NpField label="% sobre o faturamento" hint="vale pra todos os canais"><NpNum value={refundAll} onChange={setRefundAll} placeholder="ex.: 13" max={100} size="lg"/></NpField>
                  <div style={{ alignSelf: 'end' }}><button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => setPerChannelRefund(true)}>ajustar por canal</button></div>
                </div>
              )
            )}
          </NpSection>

          <NpSection title="CUSTO DE PRODUTO" hint="% do faturamento, um valor só (front, upsell, downsell e bump são a mesma etapa).">
            <div style={grid2}>
              <NpField label="% do faturamento" hint={obsFe != null ? `vazio = real observado (front ${npPct(obsFe)}${obs?.front?.UPSELL != null ? `, upsell ${npPct(obs.front.UPSELL)}` : ''})` : 'vazio = sem dado (0%)'}>
                <NpNum value={params.productCostDefaultPct} onChange={(v) => setParam(['productCostDefaultPct'], v)} placeholder={obsFe != null ? String(obsFe) : 'ex.: 12'} max={100} size="lg"/>
              </NpField>
              <div style={{ alignSelf: 'end' }}><button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => setPerChannelCost((v) => !v)}>{perChannelCost ? 'ocultar por canal' : 'ajustar por canal'}</button></div>
              {perChannelCost && (
                <>
                  <NpField label="Call centers" hint="vazio = usa o % único"><NpNum value={params.productCostPct.callcenter} onChange={(v) => setParam(['productCostPct', 'callcenter'], v)} placeholder="único" max={100}/></NpField>
                  <NpField label="Recuperação" hint="vazio = usa o % único"><NpNum value={params.productCostPct.recovery} onChange={(v) => setParam(['productCostPct', 'recovery'], v)} placeholder="único" max={100}/></NpField>
                  <NpField label="SalesBound" hint="vazio = usa o % único"><NpNum value={params.productCostPct.salesbound} onChange={(v) => setParam(['productCostPct', 'salesbound'], v)} placeholder="único" max={100}/></NpField>
                </>
              )}
            </div>
          </NpSection>

          <NpSection title="COMISSÕES" hint="Vazio = acordo cadastrado (aba Call Center / Recuperação).">
            <div style={grid2}>
              <NpField label="Tauk"><NpNum value={params.commissionPct.tauk} onChange={(v) => setParam(['commissionPct', 'tauk'], v)} placeholder="cadastro" max={100}/></NpField>
              <NpField label="Logicall"><NpNum value={params.commissionPct.logicall} onChange={(v) => setParam(['commissionPct', 'logicall'], v)} placeholder="cadastro" max={100}/></NpField>
              <NpField label="Skill99 / recuperação" hint="sobrescreve a taxa de cada afiliado de recuperação"><NpNum value={params.commissionPct.recoveryOverride} onChange={(v) => setParam(['commissionPct', 'recoveryOverride'], v)} placeholder="por afiliado" max={100}/></NpField>
              <NpField label="SalesBound"><NpNum value={params.commissionPct.salesbound} onChange={(v) => setParam(['commissionPct', 'salesbound'], v)} placeholder="ex.: 65" max={100}/></NpField>
            </div>
          </NpSection>

          <NpSection title="SALESBOUND · DADOS DO PERÍODO" hint="Informado manualmente enquanto o postback não traz eventos. Estornos vazio = usa o % de reembolso acima.">
            <div style={grid2}>
              <NpField label="Faturamento" wide><NpNum value={params.salesbound.grossUsd || null} onChange={(v) => setParam(['salesbound', 'grossUsd'], v ?? 0)} suffix="USD" placeholder="0" size="lg"/></NpField>
              <NpField label="Vendas"><NpNum value={params.salesbound.sales} onChange={(v) => setParam(['salesbound', 'sales'], v)} suffix="un." placeholder="0"/></NpField>
              <NpField label="Estornos"><NpNum value={params.salesbound.refundsUsd} onChange={(v) => setParam(['salesbound', 'refundsUsd'], v)} suffix="USD" placeholder="% acima"/></NpField>
            </div>
          </NpSection>

          <NpSection title="TAXA DA PLATAFORMA E ALLOWANCE" hint="Vazio = cadastro da aba Plataformas. Override vale só nesta projeção.">
            <div style={{ display: 'grid', gap: 10 }}>
              {platforms.map((p) => (
                <div key={p.slug} style={{ display: 'grid', gridTemplateColumns: '44px 1fr 1fr', gap: 10, alignItems: 'end' }}>
                  <span className={`plat ${platBadge(p.slug).cls}`} style={{ justifySelf: 'start', marginBottom: 8 }}>{platBadge(p.slug).short}</span>
                  <NpField label="taxa" hint={p.feePct == null ? 'não cadastrada' : `cadastro ${npPct(p.feePct, 2)}`}><NpNum value={params.feePctOverride[p.slug] ?? null} onChange={(v) => setParam(['feePctOverride', p.slug], v)} placeholder={p.feePct == null ? '—' : String(p.feePct)} max={100}/></NpField>
                  <NpField label="allowance" hint={p.allowancePct == null ? 'não cadastrado' : `cadastro ${npPct(p.allowancePct, 2)}`}><NpNum value={params.allowancePctOverride[p.slug] ?? null} onChange={(v) => setParam(['allowancePctOverride', p.slug], v)} placeholder={p.allowancePct == null ? '—' : String(p.allowancePct)} max={100}/></NpField>
                </div>
              ))}
              <NpSwitch on={params.includeAllowance} onChange={(v) => setParam(['includeAllowance'], v)} label="Descontar allowance do lucro do front" hint="reserva retida pela plataforma (rolling reserve)"/>
            </div>
          </NpSection>

          <NpSection title="AVANÇADO">
            <button className="btn btn-ghost" style={{ fontSize: 11, marginBottom: advanced ? 12 : 0 }} onClick={() => setAdvanced((v) => !v)}>{advanced ? 'ocultar' : 'mostrar'} opções avançadas</button>
            {advanced && (
              <div style={{ display: 'grid', gap: 14 }}>
                <NpSwitch on={params.dedupeRecovery} onChange={(v) => setParam(['dedupeRecovery'], v)} label="Subtrair recuperação/SMS do front-end" hint="essas vendas também passam pelas plataformas — ligado evita contar duas vezes"/>
                <div style={grid2}>
                  <NpField label="Comissão SMS próprio" hint="Mautic/Twilio; padrão 0%"><NpNum value={params.commissionPct.sms} onChange={(v) => setParam(['commissionPct', 'sms'], v ?? 0)} placeholder="0" max={100}/></NpField>
                </div>
              </div>
            )}
          </NpSection>
        </div>

        <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border)', background: 'var(--bg-elev)', display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" disabled={!dirty || busy} onClick={onSave}>{busy ? '…' : 'Salvar como padrão'}</button>
            <button className="btn btn-ghost" disabled={!dirty || busy} onClick={onReset}>Descartar alterações</button>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: dirty ? 'var(--warning)' : 'var(--fg5)', fontFamily: 'var(--f-mono)' }}>{dirty ? '● alterações não salvas' : 'padrão salvo'}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input value={scnName} onChange={(e) => setScnName(e.target.value)} placeholder="nome da projeção (ex.: cenário CPA 20%)"
              autoComplete="off"
              onKeyDown={(e) => { if (e.key === 'Enter' && scnName.trim()) { onSaveScenario(scnName.trim()); setScnName(''); } }}
              style={{ flex: 1, height: 34, padding: '0 10px', fontSize: 12, color: 'var(--fg1)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 9, fontFamily: 'var(--f-body)', outline: 'none' }}/>
            <button className="btn btn-ghost" disabled={busy || !scnName.trim()} onClick={() => { onSaveScenario(scnName.trim()); setScnName(''); }}>Salvar projeção</button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Afiliados ───────────────────────────────────────────────────────────
function NpAffiliates({ rows, cur }) {
  const [q, setQ] = useStateNP('');
  const [detail, setDetail] = useStateNP(false);
  const [showAll, setShowAll] = useStateNP(false);
  const qn = q.trim().toLowerCase();
  const list = rows.filter((a) => !qn || (a.nickname || '').toLowerCase().includes(qn) || a.externalId.toLowerCase().includes(qn) || (a.mappedName || '').toLowerCase().includes(qn));
  const shown = showAll ? list : list.slice(0, 50);
  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="panel-head" style={{ flexWrap: 'wrap' }}>
        <div className="panel-title">
          <span className="panel-eyebrow">LUCRO POR AFILIADO</span>
          <div className="panel-sub">{fmtInt(rows.length)} contas com venda no período · mesma fórmula do canal, com a taxa e o allowance da plataforma de cada um</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="select-btn" style={{ padding: '0 10px', width: 'min(220px, 100%)' }}>
            <Icon name="search" size={13}/>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar afiliado…" style={{ background: 'transparent', border: 0, color: 'var(--fg1)', outline: 'none', flex: 1, fontFamily: 'var(--f-body)', fontSize: 12 }}/>
          </div>
          <div className="seg">
            <button className={!detail ? 'is-active' : ''} onClick={() => setDetail(false)}>resumo</button>
            <button className={detail ? 'is-active' : ''} onClick={() => setDetail(true)}>linha a linha</button>
          </div>
        </div>
      </div>
      <div className="tbl-wrap" style={{ margin: 0, padding: 0, maxHeight: 640, overflowY: 'auto' }}>
        <table className="tbl tbl--sticky-first">
          <thead>
            <tr>
              <th>Afiliado</th><th>Plat.</th>
              <th className="num">Faturamento</th>
              <th className="num" title="participação no faturamento TOTAL (todos os canais)">% total</th>
              {detail && <>
                <th className="num" title="front: CPA pago · recuperação: comissão">CPA / comissão</th>
                <th className="num">Reembolso</th><th className="num">Taxa</th><th className="num">Custo prod.</th><th className="num">Allowance</th>
              </>}
              <th className="num">Lucro</th>
              <th className="num">Margem</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={detail ? 11 : 6} style={{ textAlign: 'center', padding: 20, opacity: 0.6 }}>Nenhum afiliado</td></tr>}
            {shown.map((a) => {
              const pb = platBadge(a.platformSlug);
              return (
                <tr key={a.affiliateId}>
                  <td>
                    <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>{a.nickname || a.externalId}{a.channel === 'recovery' && <span className="badge warn" style={{ fontSize: 8 }}>RECUPERAÇÃO</span>}</div>
                    <div className="cell-mono" style={{ fontSize: 10, color: 'var(--fg5)' }}>{a.externalId}{a.mappedName ? ` · ${a.mappedName}` : ''}</div>
                  </td>
                  <td><span className={`plat ${pb.cls}`}>{pb.short}</span></td>
                  <td className="num cell-mono" style={{ color: 'var(--fg1)' }}>{npMoney(a.gross, cur)}</td>
                  <td className="num cell-mono">{npPct(a.shareOfRevenuePct)}</td>
                  {detail && <>
                    <td className="num cell-mono">{npMoney(a.cpa, cur)}</td>
                    <td className="num cell-mono">{npMoney(a.refund, cur)}</td>
                    <td className="num cell-mono">{npMoney(a.fee, cur)}</td>
                    <td className="num cell-mono">{npMoney(a.productCost, cur)}</td>
                    <td className="num cell-mono">{npMoney(a.allowance, cur)}</td>
                  </>}
                  <td className="num cell-mono" style={{ fontWeight: 700, color: a.profit >= 0 ? 'var(--money)' : 'var(--danger)' }}>{npMoney(a.profit, cur)}</td>
                  <td className="num cell-mono" style={{ color: a.marginPct >= 0 ? 'var(--fg1)' : 'var(--danger)' }}>{npPct(a.marginPct)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {list.length > shown.length && (
        <div style={{ marginTop: 8 }}><button className="btn btn-ghost" onClick={() => setShowAll(true)}>ver todos ({fmtInt(list.length)})</button></div>
      )}
    </div>
  );
}

// ── Projeções ───────────────────────────────────────────────────────────
function NpDelta({ v, money, cur }) {
  return (
    <span className="cell-mono" style={{ fontSize: 10, marginLeft: 6, color: v > 0 ? 'var(--success)' : v < 0 ? 'var(--danger)' : 'var(--fg5)' }}>
      {v > 0 ? '+' : ''}{money ? npMoney(v, cur) : `${v.toFixed(1)} pp`}
    </span>
  );
}

function NpScenarios({ scenarios, current, cur, onApply, onDelete, busy }) {
  const [compare, setCompare] = useStateNP(null);
  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="panel-head">
        <div className="panel-title">
          <span className="panel-eyebrow">PROJEÇÕES SALVAS</span>
          <div className="panel-sub">Cada projeção guarda os parâmetros e o resultado do momento. "Comparar" mostra o Δ contra o cálculo atual; "aplicar" carrega os parâmetros no drawer (sem salvar). Salve novas em Parâmetros → "Salvar projeção".</div>
        </div>
      </div>
      <div className="tbl-wrap" style={{ margin: 0, padding: 0 }}>
        <table className="tbl">
          <thead>
            <tr><th>Projeção</th><th>Período</th><th>Criada</th><th className="num">Faturado</th><th className="num">Custos</th><th className="num">Lucro</th><th className="num">Margem</th><th/></tr>
          </thead>
          <tbody>
            {scenarios.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 16, opacity: 0.6 }}>Nenhuma projeção salva ainda</td></tr>}
            {scenarios.map((s) => {
              const on = compare === s.id;
              return (
                <tr key={s.id} style={on ? { background: 'color-mix(in oklab, var(--accent) 8%, transparent)' } : undefined}>
                  <td><div style={{ fontWeight: 600 }}>{s.name}</div>{s.note && <div style={{ fontSize: 10, color: 'var(--fg5)' }}>{s.note}</div>}</td>
                  <td className="cell-mono" style={{ fontSize: 11 }}>{s.periodStart.slice(0, 10)} → {s.periodEnd.slice(0, 10)}</td>
                  <td className="cell-mono" style={{ fontSize: 11 }}>{fmtDateTime(s.createdAt)}</td>
                  <td className="num cell-mono">{npMoney(s.summary.revenue, cur)}{on && current && <NpDelta v={s.summary.revenue - current.revenue} money cur={cur}/>}</td>
                  <td className="num cell-mono">{npMoney(s.summary.costs, cur)}{on && current && <NpDelta v={s.summary.costs - current.costs} money cur={cur}/>}</td>
                  <td className="num cell-mono" style={{ color: 'var(--money)', fontWeight: 600 }}>{npMoney(s.summary.profit, cur)}{on && current && <NpDelta v={s.summary.profit - current.profit} money cur={cur}/>}</td>
                  <td className="num cell-mono">{npPct(s.summary.marginPct)}{on && current && <NpDelta v={s.summary.marginPct - current.marginPct} cur={cur}/>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-ghost" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => setCompare(on ? null : s.id)}>{on ? 'ocultar Δ' : 'comparar'}</button>
                    <button className="btn btn-ghost" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => onApply(s.params)}>aplicar</button>
                    <button className="btn btn-ghost" style={{ fontSize: 10, padding: '2px 6px', color: 'var(--danger)' }} disabled={busy} onClick={() => { if (confirm(`Excluir a projeção "${s.name}"?`)) onDelete(s.id); }}>excluir</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Página ─────────────────────────────────────────────────────────────
function NetProfitPage({ filters }) {
  const cur = filters.currency || 'USD';
  const [state, setState] = useStateNP({ status: 'loading', error: null });
  const [params, setParams] = useStateNP(null);
  const [savedParams, setSavedParams] = useStateNP(null);
  const [result, setResult] = useStateNP(null);
  const [needs, setNeeds] = useStateNP([]);
  const [scenarios, setScenarios] = useStateNP([]);
  const [platforms, setPlatforms] = useStateNP([]);
  const [computing, setComputing] = useStateNP(false);
  const [busy, setBusy] = useStateNP(false);
  const [msg, setMsg] = useStateNP(null);
  const [drawer, setDrawer] = useStateNP(false);
  const [view, setView] = useStateNP('canais');
  const [openChannel, setOpenChannel] = useStateNP(null);
  const skipCompute = useRefNP(true);
  const timer = useRefNP(null);
  const seq = useRefNP(0);
  const periodKey = `${filters.dateRange.start.getTime()}|${filters.dateRange.end.getTime()}`;

  useEffectNP(() => {
    let cancelled = false;
    setState({ status: 'loading', error: null });
    skipCompute.current = true;
    window.NSApi.fetchNetProfit(filters)
      .then((d) => {
        if (cancelled) return;
        setParams(d.params); setSavedParams(d.params); setResult(d.result); setNeeds(d.needs || []); setScenarios(d.scenarios || []);
        const front = d.result?.channels?.find((c) => c.key === 'front');
        const pct = (l) => (l && l.note && /^[\d.]+%$/.test(l.note) ? Number(l.note.replace('%', '')) : null);
        setPlatforms((front?.breakdown || []).map((b) => ({ slug: b.key, displayName: b.label, feePct: pct(b.lines.find((l) => l.key === 'fee')), allowancePct: pct(b.lines.find((l) => l.key === 'allowance')) })));
        setState({ status: 'ready', error: null });
      })
      .catch((err) => { if (!cancelled) setState({ status: 'error', error: err.message }); });
    return () => { cancelled = true; };
  }, [periodKey]);

  useEffectNP(() => {
    if (!params) return;
    if (skipCompute.current) { skipCompute.current = false; return; }
    if (timer.current) clearTimeout(timer.current);
    const mySeq = ++seq.current;
    timer.current = setTimeout(() => {
      setComputing(true);
      window.NSApi.computeNetProfit(filters, params)
        .then((d) => { if (mySeq === seq.current) { setResult(d.result); setNeeds(d.needs || []); } })
        .catch((err) => setMsg({ ok: false, text: err.message }))
        .finally(() => { if (mySeq === seq.current) setComputing(false); });
    }, 150);   // o campo já segura 350ms antes de propagar
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [params]);

  useEffectNP(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 4000); return () => clearTimeout(t); }, [msg]);

  const dirty = useMemoNP(() => JSON.stringify(params) !== JSON.stringify(savedParams), [params, savedParams]);
  const setParam = (path, value) => setParams((p) => npSet(p, path, value));

  async function saveParams() {
    setBusy(true);
    try { const r = await window.NSApi.adminSaveNetProfitParams(params); setSavedParams(r.params); setParams(r.params); setMsg({ ok: true, text: 'parâmetros salvos como padrão da aba' }); }
    catch (e) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(false); }
  }
  async function saveScenario(name) {
    setBusy(true);
    try { await window.NSApi.adminSaveNetProfitScenario({ name, note: '', params, filters }); setScenarios((await window.NSApi.adminListNetProfitScenarios()).scenarios); setMsg({ ok: true, text: `projeção "${name}" salva` }); setView('projecoes'); }
    catch (e) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(false); }
  }
  async function deleteScenario(id) {
    setBusy(true);
    try { await window.NSApi.adminDeleteNetProfitScenario(id); setScenarios((await window.NSApi.adminListNetProfitScenarios()).scenarios); }
    catch (e) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(false); }
  }

  if (state.status === 'error') {
    return <div className="page-in"><div className="panel" style={{ color: 'var(--danger)' }}>Erro ao carregar: {state.error}</div></div>;
  }
  const loading = state.status === 'loading' || !result;
  const k = result?.kpis;
  const requiredNeeds = needs.filter((n) => n.severity === 'required').length;
  const openCh = !loading && openChannel ? result.channels.find((c) => c.key === openChannel) : null;

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">ADMIN · LUCRO REAL</span>
          <h2>Quanto <em>sobra de verdade</em>.</h2>
          <span className="sub">Plataformas + call centers + recuperação + SalesBound, líquido de todos os custos · período da barra acima{computing ? ' · recalculando…' : ''}</span>
        </div>
        <div className="page-head-actions" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          {msg && <span style={{ fontSize: 11, fontFamily: 'var(--f-mono)', color: msg.ok ? 'var(--success)' : 'var(--danger)' }}>{msg.text}</span>}
          {dirty && !loading && <span title="há parâmetros alterados e não salvos" style={{ fontSize: 11, color: 'var(--warning)', fontFamily: 'var(--f-mono)' }}>● não salvo</span>}
          <button className={`btn ${dirty ? 'btn-primary' : 'btn-ghost'}`} disabled={loading} onClick={() => setDrawer(true)}>
            <Icon name="sliders" size={12}/> Parâmetros{requiredNeeds > 0 ? ` (${requiredNeeds})` : ''}
          </button>
        </div>
      </div>

      <div className="mini-kpis" style={{ marginBottom: 14 }}>
        <NpKpi label="Total faturado" value={loading ? '…' : npMoney(k.revenue, cur)} money sub="todos os canais, vendas aprovadas"/>
        <NpKpi label="Total de custos" value={loading ? '…' : npMoney(k.costs, cur)} accent="var(--danger)" sub={loading ? '' : `${npPct(k.revenue > 0 ? (k.costs / k.revenue) * 100 : 0)} do faturamento`}/>
        <NpKpi label="Lucro líquido" value={loading ? '…' : npMoney(k.profit, cur)} accent={!loading && k.profit < 0 ? 'var(--danger)' : 'var(--money)'} sub="soma dos lucros por canal"/>
        <NpKpi label="Margem" value={loading ? '…' : npPct(k.marginPct)} accent={!loading && (k.marginPct >= 15 ? 'var(--success)' : k.marginPct >= 5 ? 'var(--warning)' : 'var(--danger)')} sub="lucro ÷ faturamento"/>
      </div>

      {!loading && <NpCompositionBar result={result} cur={cur}/>}
      {!loading && <NpNeedsStrip needs={needs}/>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div className="seg">
          <button className={view === 'canais' ? 'is-active' : ''} onClick={() => setView('canais')}>Canais</button>
          <button className={view === 'afiliados' ? 'is-active' : ''} onClick={() => setView('afiliados')}>Afiliados{!loading ? <span style={{ marginLeft: 6, opacity: 0.55 }}>{fmtInt(result.affiliates.length)}</span> : null}</button>
          <button className={view === 'projecoes' ? 'is-active' : ''} onClick={() => setView('projecoes')}>Projeções{scenarios.length ? <span style={{ marginLeft: 6, opacity: 0.55 }}>{scenarios.length}</span> : null}</button>
        </div>
        {view === 'canais' && !loading && <span style={{ fontSize: 11, color: 'var(--fg5)' }}>clique num canal pra ver a conta linha a linha</span>}
      </div>

      {view === 'canais' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12, marginBottom: 14 }}>
            {loading ? [0, 1, 2, 3].map((i) => <div key={i} className="panel" style={{ margin: 0, minHeight: 120 }}/>)
              : result.channels.map((ch) => <NpChannelTile key={ch.key} ch={ch} cur={cur} active={openChannel === ch.key} onClick={() => setOpenChannel(openChannel === ch.key ? null : ch.key)}/>)}
          </div>
          {openCh && <NpChannelDetail ch={openCh} cur={cur} onClose={() => setOpenChannel(null)}/>}
          {!loading && result.warnings?.length > 0 && (
            <div className="panel" style={{ marginBottom: 14, fontSize: 12, color: 'var(--warning)' }}>
              {result.warnings.map((w) => <div key={w}>⚠ {w}</div>)}
            </div>
          )}
        </>
      )}
      {view === 'afiliados' && !loading && <NpAffiliates rows={result.affiliates} cur={cur}/>}
      {view === 'projecoes' && !loading && (
        <NpScenarios scenarios={scenarios} current={k} cur={cur} busy={busy} onDelete={deleteScenario}
          onApply={(p) => { setParams(p); setDrawer(true); setMsg({ ok: true, text: 'parâmetros da projeção carregados (não salvos)' }); }}/>
      )}

      {drawer && params && (
        <NpParamsDrawer params={params} setParam={setParam} setParams={setParams} obs={result?.observedProductCostPct} platforms={platforms}
          dirty={dirty} busy={busy} onSave={saveParams} onSaveScenario={saveScenario}
          onReset={() => setParams(savedParams)} onClose={() => setDrawer(false)}/>
      )}
    </div>
  );
}

Object.assign(window, { NetProfitPage });
