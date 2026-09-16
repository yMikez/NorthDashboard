/* global React, Icon, fmtCurrency, fmtInt, fmtDateTime, platBadge, SkelTableRows */
/* Lucro real (admin-only) — redesign 2026-09-16 + cálculo de margem
   padronizado (calculo_margem_northscale.md, mesmo dia).
   Tela inicial = MARGEM DE CONTRIBUIÇÃO: receita econômica (plataformas +
   parcela NorthScale do backend), custos variáveis, lucro, margem oficial,
   lucro por FE e buffer de risco separado. Detalhe por demanda: clicar num
   canal abre as linhas da fórmula; seletor com Por dia / Por produto /
   Afiliados / Projeções; parâmetros e histórico de premissas num drawer.
   API: GET/POST /api/admin/net-profit, POST …/daily, PUT …/params,
   GET/POST/DELETE …/scenarios, POST /api/admin/salesbound/import */

const { useState: useStateNP, useEffect: useEffectNP, useRef: useRefNP, useMemo: useMemoNP } = React;

const NP_CHANNEL_META = {
  front:      { short: 'Front-end',    icon: 'layers',   desc: 'Vendas nas plataformas (BuyGoods, Digistore24, JVZoo…)' },
  callcenter: { short: 'Call centers', icon: 'target',   desc: 'Tauk e Logicall — entra só a parcela da NorthScale' },
  recovery:   { short: 'Recuperação',  icon: 'refresh',  desc: 'Skill99 (e-mail/SMS) e SMS próprio — vendas de plataforma' },
  salesbound: { short: 'SalesBound',   icon: 'plug',     desc: 'Cross-sell por telefone — entra só a parcela da NorthScale' },
};
// Cores dos custos variáveis na barra de composição (semânticas, fora da paleta de tema).
const NP_COST_COLORS = {
  cpa:        { label: 'Afiliados (CPA)',       color: 'var(--accent)' },
  commission: { label: 'Comissão recuperação',  color: 'var(--accent2)' },
  refund:     { label: 'Reembolso',             color: 'var(--danger)' },
  fee:        { label: 'Fee plataforma',        color: 'var(--warning)' },
  product:    { label: 'Produto + fulfillment', color: 'var(--fg4)' },
  allowance:  { label: 'Reserva',               color: 'var(--fg5)' },
};
const NP_SOURCE = {
  observed: { label: 'observado', color: 'var(--success)', hint: 'Medido nos dados do período' },
  manual:   { label: 'manual',    color: 'var(--accent)',  hint: 'Parâmetro informado por você' },
  config:   { label: 'config',    color: 'var(--fg4)',     hint: 'Cadastro (Plataformas / Integrações)' },
  default:  { label: 'padrão',    color: 'var(--fg5)',     hint: 'Valor padrão do sistema' },
  none:     { label: 'faltando',  color: 'var(--warning)', hint: 'Sem dado nem parâmetro — está em 0' },
};
// Rótulos do histórico de premissas (caminho do parâmetro → texto).
const NP_PARAM_LABELS = {
  refundMode: 'Reembolso: modo', 'refundPct.front': 'Reembolso % (plataformas)', 'refundPct.recovery': 'Reembolso % (recuperação)',
  productCostDefaultPct: 'Produto + fulfillment %', 'productCostPct.recovery': 'Produto % (recuperação)',
  'productCostPct.callcenter': 'Produto % (call centers)', 'productCostPct.salesbound': 'Produto % (SalesBound)',
  includeAllowance: 'Descontar reserva', 'commissionPct.tauk': 'Parcela Tauk %', 'commissionPct.logicall': 'Parcela Logicall %',
  'commissionPct.salesbound': 'Parcela SalesBound %', 'commissionPct.recoveryOverride': 'Comissão recuperação %', 'commissionPct.sms': 'Comissão SMS próprio %',
  'salesbound.grossUsd': 'SalesBound manual: faturamento', 'salesbound.sales': 'SalesBound manual: vendas', 'salesbound.refundsUsd': 'SalesBound manual: estornos',
  backendNetOfRefunds: 'Backend líquido de estornos', riskBufferPct: 'Buffer de risco %', dedupeRecovery: 'Subtrair recuperação do front',
};
function npParamLabel(path) {
  if (NP_PARAM_LABELS[path]) return NP_PARAM_LABELS[path];
  let m;
  if ((m = path.match(/^feePctOverride\.(.+)$/))) return `Fee % ${m[1]}`;
  if ((m = path.match(/^allowancePctOverride\.(.+)$/))) return `Reserva % ${m[1]}`;
  if ((m = path.match(/^productCostPct\.front\.(.+)$/))) return `Produto % (${m[1].toLowerCase()})`;
  return path;
}
function npParamValue(v) {
  if (v === null || v === undefined) return 'vazio';
  if (v === true) return 'sim';
  if (v === false) return 'não';
  return String(v);
}

function npMoney(v, cur, digits = 0) { return fmtCurrency(v || 0, cur, digits); }
function npPct(v, digits = 1) { return v == null ? '—' : `${Number(v).toFixed(digits)}%`; }
function npSet(obj, path, value) {
  const out = Array.isArray(obj) ? [...obj] : { ...obj };
  if (path.length === 1) { out[path[0]] = value; return out; }
  out[path[0]] = npSet(obj?.[path[0]] ?? {}, path.slice(1), value);
  return out;
}
const npTone = (v) => (v >= 0 ? 'var(--money)' : 'var(--danger)');

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

// ── Faixa de leituras por unidade + buffer de risco (§2.1, §7, §9) ──────
function NpUnitStrip({ k, cur }) {
  const item = (label, value, tone) => (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, whiteSpace: 'nowrap' }}>
      <span style={{ fontSize: 11, color: 'var(--fg4)' }}>{label}</span>
      <span className="cell-mono" style={{ fontSize: 13, fontWeight: 700, color: tone || 'var(--fg1)' }}>{value}</span>
    </span>
  );
  return (
    <div className="panel" style={{ marginBottom: 14, padding: '10px 18px', display: 'flex', flexWrap: 'wrap', gap: '8px 22px', alignItems: 'center' }}>
      {item('Lucro por FE', k.profitPerFe == null ? '—' : npMoney(k.profitPerFe, cur, 2), k.profitPerFe == null ? undefined : npTone(k.profitPerFe))}
      {item('FEs', fmtInt(k.fes))}
      {item('CPA médio', k.cpaAvg == null ? '—' : npMoney(k.cpaAvg, cur, 2))}
      {item('Backend líquido', npMoney(k.backendNet, cur), 'var(--money)')}
      {k.buffer && (
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap', paddingLeft: 14, borderLeft: '1px solid var(--border-soft)' }}>
          <span style={{ fontSize: 11, color: 'var(--fg4)' }}>Buffer de risco {npPct(k.buffer.pct)}</span>
          <span className="cell-mono" style={{ fontSize: 13, color: 'var(--danger)' }}>−{npMoney(k.buffer.usd, cur)}</span>
          <span style={{ fontSize: 11, color: 'var(--fg4)' }}>→ lucro ajustado</span>
          <span className="cell-mono" style={{ fontSize: 13, fontWeight: 700, color: npTone(k.buffer.adjustedProfit) }}>{npMoney(k.buffer.adjustedProfit, cur)}</span>
          <span className="cell-mono" style={{ fontSize: 11, color: 'var(--fg4)' }}>margem ajustada {npPct(k.buffer.adjustedMarginPct, 2)}</span>
        </span>
      )}
    </div>
  );
}

// ── Barra de composição: pra onde vai cada dólar de receita econômica ──
function NpCompositionBar({ result, cur }) {
  const rev = result.kpis.revenue;
  const totals = {};
  for (const ch of result.channels) for (const l of ch.lines) if (l.kind === 'cost') totals[l.key] = (totals[l.key] || 0) + l.usd;
  const segs = Object.entries(NP_COST_COLORS).map(([k, m]) => ({ key: k, ...m, usd: totals[k] || 0 })).filter((s) => s.usd > 0);
  const profit = result.kpis.profit;
  const pct = (v) => (rev > 0 ? Math.max(0, (v / rev) * 100) : 0);
  return (
    <div className="panel" style={{ marginBottom: 14, padding: '14px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10, gap: 12, flexWrap: 'wrap' }}>
        <span className="panel-eyebrow">DE CADA $100 DE RECEITA ECONÔMICA</span>
        <span style={{ fontSize: 11, color: 'var(--fg4)', fontFamily: 'var(--f-mono)' }}>
          custos variáveis {npPct(rev > 0 ? (result.kpis.costs / rev) * 100 : 0)} · lucro <span style={{ color: npTone(profit), fontWeight: 700 }}>{npPct(result.kpis.marginPct, 2)}</span>
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
          Lucro <span className="cell-mono" style={{ color: npTone(profit), fontWeight: 700 }}>{npMoney(profit, cur)}</span>
        </span>
      </div>
    </div>
  );
}

// ── Linhas da fórmula (bruto → fora da receita → receita → custos → lucro) ─
function NpLines({ gross, revenue, lines, profit, marginPct, cur, dense }) {
  const fs = dense ? 11.5 : 12.5;
  const share = lines.filter((l) => l.kind === 'share');
  const costs = lines.filter((l) => l.kind !== 'share');
  const row = (l) => (
    <tr key={l.key}>
      <td style={{ color: 'var(--fg3)' }}>− {l.label}{l.note ? <span style={{ color: 'var(--fg5)', marginLeft: 6, fontSize: 10 }}>{l.note}</span> : null}</td>
      <td className="num cell-mono" style={{ color: l.usd > 0 ? (l.kind === 'share' ? 'var(--fg3)' : 'var(--danger)') : 'var(--fg5)' }}>{l.usd > 0 ? '−' : ''}{npMoney(l.usd, cur)}</td>
      <td className="num cell-mono" style={{ color: 'var(--fg5)' }}>{npPct(l.pctOfGross)}</td>
      <td><NpSourceChip source={l.source}/></td>
    </tr>
  );
  return (
    <table className="tbl" style={{ fontSize: fs }}>
      <tbody>
        <tr>
          <td style={{ fontWeight: 600 }}>{share.length ? 'Bruto do parceiro' : 'Gross'}</td>
          <td className="num cell-mono" style={{ color: 'var(--fg1)', fontWeight: 600 }}>{npMoney(gross, cur)}</td>
          <td className="num cell-mono" style={{ color: 'var(--fg5)', width: 64 }}>100%</td>
          <td style={{ width: 84 }}/>
        </tr>
        {share.map(row)}
        {share.length > 0 && (
          <tr style={{ borderTop: '1px dashed var(--border)' }}>
            <td style={{ fontWeight: 600 }}>= Receita NorthScale</td>
            <td className="num cell-mono" style={{ fontWeight: 600, color: 'var(--money)' }}>{npMoney(revenue, cur)}</td>
            <td className="num cell-mono" style={{ color: 'var(--fg5)' }}>{npPct(gross > 0 ? (revenue / gross) * 100 : null)}</td>
            <td/>
          </tr>
        )}
        {costs.map(row)}
        <tr style={{ borderTop: '1px solid var(--border)' }}>
          <td style={{ fontWeight: 700 }}>= Lucro de contribuição</td>
          <td className="num cell-mono" style={{ fontWeight: 700, color: npTone(profit) }}>{npMoney(profit, cur)}</td>
          {share.length > 0
            ? <td className="num cell-mono" style={{ fontWeight: 600, color: npTone(profit) }} title="lucro ÷ bruto do parceiro">{npPct(gross > 0 ? (profit / gross) * 100 : null)}</td>
            : <td className="num cell-mono" style={{ fontWeight: 600, color: npTone(profit) }} title="lucro ÷ receita econômica">{npPct(marginPct)}</td>}
          <td/>
        </tr>
      </tbody>
    </table>
  );
}

// ── Card compacto de canal (clicável) ───────────────────────────────────
function NpChannelTile({ ch, cur, active, onClick }) {
  const meta = NP_CHANNEL_META[ch.key] || { short: ch.label, icon: 'layers' };
  const backend = ch.type === 'backend';
  const tone = !ch.available ? 'var(--fg5)' : npTone(ch.profit);
  const nsPct = ch.gross > 0 ? (ch.revenue / ch.gross) * 100 : 0;
  const barPct = backend ? nsPct : ch.marginPct;
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
        <span className="cell-mono" style={{ fontSize: 10, color: 'var(--fg5)' }}>{ch.available ? `${npPct(ch.shareOfRevenuePct, 0)} da receita` : 'sem dado'}</span>
      </div>
      <div className="cell-mono" style={{ fontSize: 22, fontWeight: 700, color: tone, letterSpacing: '-0.02em', lineHeight: 1 }}>{ch.available ? npMoney(ch.profit, cur) : '—'}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: 'var(--fg4)', fontFamily: 'var(--f-mono)', gap: 8 }}>
        <span>{backend ? 'bruto' : 'gross'} <span style={{ color: 'var(--fg2)' }}>{npMoney(ch.gross, cur)}</span></span>
        {backend
          ? <span>NS fica <span style={{ color: tone, fontWeight: 600 }}>{ch.available ? npPct(nsPct) : '—'}</span></span>
          : <span>margem <span style={{ color: tone, fontWeight: 600 }}>{ch.available ? npPct(ch.marginPct) : '—'}</span></span>}
      </div>
      <div style={{ height: 4, borderRadius: 2, background: 'color-mix(in oklab, var(--fg5) 18%, transparent)', marginTop: 8, overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(0, Math.min(100, barPct))}%`, height: '100%', background: tone }}/>
      </div>
    </button>
  );
}

function NpChannelDetail({ ch, cur, salesbound, onClose }) {
  const meta = NP_CHANNEL_META[ch.key] || {};
  const [open, setOpen] = useStateNP(null);
  const backend = ch.type === 'backend';
  return (
    <div className="panel" style={{ marginBottom: 14, borderColor: 'color-mix(in oklab, var(--accent) 35%, transparent)' }}>
      <div className="panel-head" style={{ marginBottom: 8 }}>
        <div className="panel-title">
          <span className="panel-eyebrow">{ch.label.toUpperCase()} · COMO O LUCRO É CALCULADO</span>
          <div className="panel-sub">{meta.desc} · {fmtInt(ch.orders)} vendas · {npPct(ch.shareOfRevenuePct)} da receita econômica · {npPct(ch.shareOfProfitPct)} do lucro</div>
          {ch.key === 'salesbound' && salesbound?.mode === 'measured' && salesbound.coverage && (
            <div className="panel-sub" style={{ marginTop: 2 }}>
              export do CRM: {salesbound.coverage.firstAt.slice(0, 10)} → {salesbound.coverage.lastAt.slice(0, 10)} · importado {fmtDateTime(salesbound.coverage.importedAt)}
              {salesbound.voids > 0 ? ` · ${npMoney(salesbound.voids, cur)} em voids já fora do bruto` : ''}
              {salesbound.refundsCohort != null ? ` · estornos das vendas do período (qualquer data): ${npMoney(salesbound.refundsCohort, cur)}` : ''}
            </div>
          )}
        </div>
        <button className="icon-btn" onClick={onClose} title="fechar"><Icon name="x" size={13}/></button>
      </div>
      <div className="tbl-wrap" style={{ margin: 0, padding: 0 }}>
        <NpLines gross={ch.gross} revenue={ch.revenue} lines={ch.lines} profit={ch.profit} marginPct={ch.marginPct} cur={cur}/>
      </div>
      {ch.breakdown.length > 1 && (
        <div style={{ marginTop: 12 }}>
          <div className="f-label" style={{ marginBottom: 6 }}>DESAGREGAÇÃO · {ch.breakdown.length} {ch.key === 'front' ? 'plataformas' : ch.key === 'callcenter' ? 'parceiros' : 'fontes'}</div>
          <div className="tbl-wrap" style={{ margin: 0, padding: 0 }}>
            <table className="tbl" style={{ fontSize: 12 }}>
              <thead><tr><th/><th className="num">{backend ? 'Bruto' : 'Gross'}</th>{backend && <th className="num">Receita NS</th>}<th className="num">Custos</th><th className="num">Lucro</th><th className="num">{backend ? 'NS fica' : 'Margem'}</th><th/></tr></thead>
              <tbody>
                {ch.breakdown.map((b) => {
                  const costs = b.lines.filter((l) => l.kind !== 'share').reduce((s, l) => s + l.usd, 0);
                  const on = open === b.key;
                  return (
                    <React.Fragment key={b.key}>
                      <tr onClick={() => setOpen(on ? null : b.key)} style={{ cursor: 'pointer' }}>
                        <td style={{ fontWeight: 600 }}>{b.label}<span style={{ color: 'var(--fg5)', marginLeft: 6, fontSize: 10 }}>{fmtInt(b.orders)} vendas</span></td>
                        <td className="num cell-mono">{npMoney(b.gross, cur)}</td>
                        {backend && <td className="num cell-mono" style={{ color: 'var(--money)' }}>{npMoney(b.revenue, cur)}</td>}
                        <td className="num cell-mono" style={{ color: costs > 0 ? 'var(--danger)' : 'var(--fg5)' }}>{npMoney(costs, cur)}</td>
                        <td className="num cell-mono" style={{ fontWeight: 700, color: npTone(b.profit) }}>{npMoney(b.profit, cur)}</td>
                        <td className="num cell-mono">{backend ? npPct(b.gross > 0 ? (b.revenue / b.gross) * 100 : null) : npPct(b.marginPct)}</td>
                        <td style={{ width: 24, color: 'var(--fg5)' }}><Icon name={on ? 'chevron-down' : 'chevron-right'} size={11}/></td>
                      </tr>
                      {on && (
                        <tr><td colSpan={backend ? 7 : 6} style={{ padding: '4px 0 10px 16px', background: 'color-mix(in oklab, var(--fg5) 6%, transparent)' }}>
                          <NpLines gross={b.gross} revenue={b.revenue} lines={b.lines} profit={b.profit} marginPct={b.marginPct} cur={cur} dense/>
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

// ── Import do export da SalesBound (CSV) ────────────────────────────────
function NpSalesboundImport({ salesbound, busy, onImport }) {
  const inputRef = useRefNP(null);
  const cov = salesbound?.coverage;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {salesbound?.mode === 'measured' && cov ? (
        <div style={{ fontSize: 12, color: 'var(--fg2)', lineHeight: 1.45 }}>
          <span style={{ color: 'var(--success)', fontWeight: 600 }}>● medido pelo export</span> · cobre {cov.firstAt.slice(0, 10)} → {cov.lastAt.slice(0, 10)} · importado {fmtDateTime(cov.importedAt)}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--fg4)', lineHeight: 1.45 }}>Nenhum export importado — o canal usa os números manuais abaixo.</div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input ref={inputRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) onImport(f); }}/>
        <button className="btn btn-ghost" disabled={busy} onClick={() => inputRef.current && inputRef.current.click()}>
          <Icon name="upload" size={12}/> {busy ? 'importando…' : cov ? 'Importar export novo (CSV)' : 'Importar export (CSV)'}
        </button>
        <span style={{ fontSize: 10.5, color: 'var(--fg5)', lineHeight: 1.35 }}>CRM deles → Reports → Transaction Details → Export. Reimportar não duplica.</span>
      </div>
    </div>
  );
}

// ── Histórico de premissas (§10.5) ──────────────────────────────────────
function NpParamsHistory({ history }) {
  const [all, setAll] = useStateNP(false);
  if (!history || history.length === 0) return <div style={{ fontSize: 12, color: 'var(--fg5)' }}>Nenhuma alteração registrada ainda.</div>;
  const shown = all ? history : history.slice(0, 6);
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {shown.map((h) => (
        <div key={h.id} style={{ fontSize: 12, borderLeft: '2px solid var(--border)', paddingLeft: 10 }}>
          <div className="cell-mono" style={{ fontSize: 11, color: 'var(--fg4)' }}>{fmtDateTime(h.createdAt)}{h.createdBy ? ` · ${h.createdBy}` : ''}</div>
          {h.initial
            ? <div style={{ color: 'var(--fg3)' }}>premissas vigentes antes do histórico</div>
            : h.changes.map((c) => (
              <div key={c.path} style={{ color: 'var(--fg2)' }}>
                {npParamLabel(c.path)}: <span className="cell-mono" style={{ color: 'var(--fg5)', textDecoration: 'line-through' }}>{npParamValue(c.from)}</span> → <span className="cell-mono" style={{ fontWeight: 600 }}>{npParamValue(c.to)}</span>
              </div>
            ))}
        </div>
      ))}
      {history.length > shown.length && <button className="btn btn-ghost" style={{ justifySelf: 'start', fontSize: 11 }} onClick={() => setAll(true)}>ver todas ({history.length})</button>}
    </div>
  );
}

// ── Drawer de parâmetros ────────────────────────────────────────────────
function NpParamsDrawer({ params, setParam, setParams, obs, platforms, salesbound, history, dirty, busy, onSave, onReset, onSaveScenario, onImportSalesbound, onClose }) {
  const [advanced, setAdvanced] = useStateNP(false);
  const [perChannelRefund, setPerChannelRefund] = useStateNP(() => params.refundPct.recovery != null && params.refundPct.recovery !== params.refundPct.front);
  const [perChannelCost, setPerChannelCost] = useStateNP(() => params.productCostPct.callcenter != null || params.productCostPct.recovery != null || params.productCostPct.salesbound != null);
  const [scnName, setScnName] = useStateNP('');
  const grid2 = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 };
  const obsFe = obs?.front?.FRONTEND;
  const nsHint = (pct, fallback) => (pct != null ? `NorthScale fica com ${Math.round((100 - pct) * 100) / 100}%` : fallback);
  const measured = salesbound?.mode === 'measured';
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose}/>
      <div className="drawer" style={{ width: 560, maxWidth: '100vw', display: 'flex', flexDirection: 'column' }}>
        <div className="drawer-head" style={{ alignItems: 'center' }}>
          <div>
            <div className="eyebrow" style={{ fontSize: 10 }}>LUCRO REAL · PARÂMETROS</div>
            <h3 style={{ margin: '4px 0 2px' }}>Premissas do cálculo</h3>
            <div style={{ fontSize: 11.5, color: 'var(--fg4)' }}>Tudo recalcula ao digitar. Campo vazio = usa o valor observado/cadastrado. Salvar registra a data de cada mudança.</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>

        <div style={{ padding: '0 24px', overflowY: 'auto', flex: 1 }}>
          <NpSection title="REEMBOLSO" hint="Incide sobre o gross das plataformas (front e recuperação). Observado = estorno real por data do estorno; % fixo = projeção. O backend usa o estorno informado pelo parceiro.">
            <div className="seg" style={{ marginBottom: 12 }}>
              <button className={params.refundMode === 'observed' ? 'is-active' : ''} onClick={() => setParam(['refundMode'], 'observed')}>observado</button>
              <button className={params.refundMode === 'manual' ? 'is-active' : ''} onClick={() => setParam(['refundMode'], 'manual')}>% fixo</button>
            </div>
            {params.refundMode === 'manual' && (
              perChannelRefund ? (
                <div style={grid2}>
                  <NpField label="Front-end"><NpNum value={params.refundPct.front} onChange={(v) => setParam(['refundPct', 'front'], v)} placeholder="0" max={100}/></NpField>
                  <NpField label="Recuperação" hint="vazio = % do front"><NpNum value={params.refundPct.recovery} onChange={(v) => setParam(['refundPct', 'recovery'], v)} placeholder="front" max={100}/></NpField>
                  <button className="btn btn-ghost" style={{ gridColumn: '1 / -1', justifySelf: 'start', fontSize: 11 }} onClick={() => { setPerChannelRefund(false); setParam(['refundPct', 'recovery'], null); }}>usar um % só</button>
                </div>
              ) : (
                <div style={grid2}>
                  <NpField label="% sobre o gross" hint="front e recuperação"><NpNum value={params.refundPct.front} onChange={(v) => setParam(['refundPct', 'front'], v)} placeholder="ex.: 20" max={100} size="lg"/></NpField>
                  <div style={{ alignSelf: 'end' }}><button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => setPerChannelRefund(true)}>ajustar por canal</button></div>
                </div>
              )
            )}
          </NpSection>

          <NpSection title="PRODUTO + FULFILLMENT" hint="% do gross das plataformas, um valor só (front, upsell, downsell, bump e recuperação). Backend não tem custo — entra a parcela líquida.">
            <div style={grid2}>
              <NpField label="% do gross" hint={obsFe != null ? `vazio = real observado (front ${npPct(obsFe)}${obs?.front?.UPSELL != null ? `, upsell ${npPct(obs.front.UPSELL)}` : ''})` : 'vazio = sem dado (0%)'}>
                <NpNum value={params.productCostDefaultPct} onChange={(v) => setParam(['productCostDefaultPct'], v)} placeholder={obsFe != null ? String(obsFe) : 'ex.: 12'} max={100} size="lg"/>
              </NpField>
              <div style={{ alignSelf: 'end' }}><button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => setPerChannelCost((v) => !v)}>{perChannelCost ? 'ocultar por canal' : 'ajustar por canal'}</button></div>
              {perChannelCost && (
                <>
                  <NpField label="Recuperação" hint="vazio = usa o % único"><NpNum value={params.productCostPct.recovery} onChange={(v) => setParam(['productCostPct', 'recovery'], v)} placeholder="único" max={100}/></NpField>
                  <NpField label="Call centers" hint="vazio = sem custo (parcela líquida)"><NpNum value={params.productCostPct.callcenter} onChange={(v) => setParam(['productCostPct', 'callcenter'], v)} placeholder="0" max={100}/></NpField>
                  <NpField label="SalesBound" hint="vazio = sem custo (parcela líquida)"><NpNum value={params.productCostPct.salesbound} onChange={(v) => setParam(['productCostPct', 'salesbound'], v)} placeholder="0" max={100}/></NpField>
                </>
              )}
            </div>
          </NpSection>

          <NpSection title="PARCELA DOS PARCEIROS · BACKEND" hint="% do bruto que fica com o parceiro — a receita da NorthScale é o resto. Vazio = acordo cadastrado (aba Call Center).">
            <div style={grid2}>
              <NpField label="Tauk" hint={nsHint(params.commissionPct.tauk, 'cadastro')}><NpNum value={params.commissionPct.tauk} onChange={(v) => setParam(['commissionPct', 'tauk'], v)} placeholder="cadastro" max={100}/></NpField>
              <NpField label="Logicall" hint={nsHint(params.commissionPct.logicall, 'cadastro')}><NpNum value={params.commissionPct.logicall} onChange={(v) => setParam(['commissionPct', 'logicall'], v)} placeholder="cadastro" max={100}/></NpField>
              <NpField label="SalesBound" hint={nsHint(params.commissionPct.salesbound, 'obrigatório')}><NpNum value={params.commissionPct.salesbound} onChange={(v) => setParam(['commissionPct', 'salesbound'], v)} placeholder="ex.: 50" max={100}/></NpField>
              <div/>
              <div style={{ gridColumn: '1 / -1' }}>
                <NpSwitch on={params.backendNetOfRefunds} onChange={(v) => setParam(['backendNetOfRefunds'], v)} label="Parcela calculada sobre o bruto menos estornos do parceiro"
                  hint="Logicall e SalesBound informam estorno; a Tauk não. Desligado = bruto × parcela (fórmula literal do cálculo de margem)."/>
              </div>
            </div>
          </NpSection>

          <NpSection title="COMISSÃO DE RECUPERAÇÃO" hint="Entra como custo de afiliados. Vazio = taxa de cada afiliado de recuperação (aba Recuperação).">
            <div style={grid2}>
              <NpField label="Skill99 / recuperação"><NpNum value={params.commissionPct.recoveryOverride} onChange={(v) => setParam(['commissionPct', 'recoveryOverride'], v)} placeholder="por afiliado" max={100}/></NpField>
            </div>
          </NpSection>

          <NpSection title="SALESBOUND · DADOS" hint="Vêm do export de transações do CRM deles (vendas, reembolsos e voids por data). Sem export, use os campos manuais.">
            <NpSalesboundImport salesbound={salesbound} busy={busy} onImport={onImportSalesbound}/>
            {!measured && (
              <div style={{ ...grid2, marginTop: 12 }}>
                <NpField label="Faturamento (manual)" wide><NpNum value={params.salesbound.grossUsd || null} onChange={(v) => setParam(['salesbound', 'grossUsd'], v ?? 0)} suffix="USD" placeholder="0" size="lg"/></NpField>
                <NpField label="Vendas"><NpNum value={params.salesbound.sales} onChange={(v) => setParam(['salesbound', 'sales'], v)} suffix="un." placeholder="0"/></NpField>
                <NpField label="Estornos"><NpNum value={params.salesbound.refundsUsd} onChange={(v) => setParam(['salesbound', 'refundsUsd'], v)} suffix="USD" placeholder="0"/></NpField>
              </div>
            )}
          </NpSection>

          <NpSection title="FEE DA PLATAFORMA E RESERVA" hint="Vazio = cadastro da aba Plataformas. Override vale só neste cálculo.">
            <div style={{ display: 'grid', gap: 10 }}>
              {platforms.map((p) => (
                <div key={p.slug} style={{ display: 'grid', gridTemplateColumns: '44px 1fr 1fr', gap: 10, alignItems: 'end' }}>
                  <span className={`plat ${platBadge(p.slug).cls}`} style={{ justifySelf: 'start', marginBottom: 8 }}>{platBadge(p.slug).short}</span>
                  <NpField label="fee" hint={p.feePct == null ? 'não cadastrada' : `cadastro ${npPct(p.feePct, 2)}`}><NpNum value={params.feePctOverride[p.slug] ?? null} onChange={(v) => setParam(['feePctOverride', p.slug], v)} placeholder={p.feePct == null ? '—' : String(p.feePct)} max={100}/></NpField>
                  <NpField label="reserva" hint={p.allowancePct == null ? 'não cadastrada' : `cadastro ${npPct(p.allowancePct, 2)}`}><NpNum value={params.allowancePctOverride[p.slug] ?? null} onChange={(v) => setParam(['allowancePctOverride', p.slug], v)} placeholder={p.allowancePct == null ? '—' : String(p.allowancePct)} max={100}/></NpField>
                </div>
              ))}
              <NpSwitch on={params.includeAllowance} onChange={(v) => setParam(['includeAllowance'], v)} label="Tratar a reserva como custo" hint="Se um dia for confirmado que a reserva volta inteira, desligue — aí ela é impacto de caixa, não margem."/>
            </div>
          </NpSection>

          <NpSection title="BUFFER DE RISCO" hint="Margem de erro conservadora sobre a receita econômica. Aparece numa linha separada — não altera o lucro nem as taxas reais.">
            <div style={grid2}>
              <NpField label="% da receita econômica" hint="vazio = sem buffer · usual 1–2%"><NpNum value={params.riskBufferPct} onChange={(v) => setParam(['riskBufferPct'], v)} placeholder="0" max={50}/></NpField>
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

          <NpSection title="HISTÓRICO DE PREMISSAS" hint="Cada “Salvar como padrão” registra o que mudou e quando.">
            <NpParamsHistory history={history}/>
          </NpSection>
        </div>

        <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border)', background: 'var(--bg-elev)', display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" disabled={!dirty || busy} onClick={onSave}>{busy ? '…' : 'Salvar como padrão'}</button>
            <button className="btn btn-ghost" disabled={!dirty || busy} onClick={onReset}>Descartar alterações</button>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: dirty ? 'var(--warning)' : 'var(--fg5)', fontFamily: 'var(--f-mono)' }}>{dirty ? '● alterações não salvas' : 'padrão salvo'}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input value={scnName} onChange={(e) => setScnName(e.target.value)} placeholder="nome da projeção (ex.: cenário refund 25%)"
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

// ── Por dia (§10.8: mesma fórmula, dia a dia) ───────────────────────────
function npDayLabel(iso) {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit' });
}
function NpDaily({ filters, params, cur }) {
  const [state, setState] = useStateNP({ status: 'loading', days: [], truncated: false, error: null });
  const paramsKey = JSON.stringify(params);
  useEffectNP(() => {
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading', error: null }));
    const t = setTimeout(() => {
      window.NSApi.computeNetProfitDaily(filters, params)
        .then((d) => { if (!cancelled) setState({ status: 'ready', days: d.days || [], truncated: !!d.truncated, error: null }); })
        .catch((err) => { if (!cancelled) setState({ status: 'error', days: [], truncated: false, error: err.message }); });
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [filters.dateRange.start.getTime(), filters.dateRange.end.getTime(), paramsKey]);

  const days = state.days;
  const hasBuffer = days.some((d) => d.kpis.buffer);
  const maxAbs = Math.max(1, ...days.map((d) => Math.abs(d.kpis.profit)));
  const tot = days.reduce((a, d) => ({ revenue: a.revenue + d.kpis.revenue, costs: a.costs + d.kpis.costs, profit: a.profit + d.kpis.profit, fes: a.fes + d.kpis.fes, adj: a.adj + (d.kpis.buffer ? d.kpis.buffer.adjustedProfit : d.kpis.profit) }), { revenue: 0, costs: 0, profit: 0, fes: 0, adj: 0 });
  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="panel-head">
        <div className="panel-title">
          <span className="panel-eyebrow">MARGEM POR DIA</span>
          <div className="panel-sub">A mesma fórmula aplicada a cada dia do período (dia BRT). Estornos contam pela data do estorno, então um dia fraco pode carregar estornos de vendas antigas.{state.truncated ? ' Mostrando os primeiros 62 dias.' : ''}</div>
        </div>
        {state.status === 'loading' && days.length > 0 && <span style={{ fontSize: 11, color: 'var(--fg5)', fontFamily: 'var(--f-mono)' }}>recalculando…</span>}
      </div>
      {state.status === 'error' && <div style={{ color: 'var(--danger)', fontSize: 12 }}>Erro: {state.error}</div>}
      <div className="tbl-wrap" style={{ margin: 0, padding: 0, maxHeight: 640, overflowY: 'auto' }}>
        <table className="tbl tbl--sticky-first">
          <thead>
            <tr>
              <th>Dia</th>
              <th className="num" title="gross das plataformas + parcela NS do backend">Receita econômica</th>
              <th className="num">Custos variáveis</th>
              <th className="num">Lucro</th>
              <th style={{ width: 120 }}/>
              <th className="num">Margem</th>
              <th className="num">FEs</th>
              <th className="num">Lucro/FE</th>
              {hasBuffer && <th className="num">Lucro ajustado</th>}
            </tr>
          </thead>
          <tbody>
            {state.status === 'loading' && days.length === 0 && <SkelTableRows rows={7} cols={hasBuffer ? 9 : 8}/>}
            {state.status === 'ready' && days.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', padding: 16, opacity: 0.6 }}>Sem dias no período</td></tr>}
            {days.map((d) => {
              const k = d.kpis;
              const w = (Math.abs(k.profit) / maxAbs) * 100;
              return (
                <tr key={d.start}>
                  <td className="cell-mono" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{npDayLabel(d.start)}</td>
                  <td className="num cell-mono" style={{ color: 'var(--fg1)' }}>{npMoney(k.revenue, cur)}</td>
                  <td className="num cell-mono" style={{ color: 'var(--danger)' }}>{npMoney(k.costs, cur)}</td>
                  <td className="num cell-mono" style={{ fontWeight: 700, color: npTone(k.profit) }}>{npMoney(k.profit, cur)}</td>
                  <td>
                    <div style={{ height: 6, borderRadius: 3, background: 'color-mix(in oklab, var(--fg5) 14%, transparent)', overflow: 'hidden' }}>
                      <div style={{ width: `${w}%`, height: '100%', background: npTone(k.profit), opacity: 0.8 }}/>
                    </div>
                  </td>
                  <td className="num cell-mono" style={{ color: npTone(k.profit) }}>{npPct(k.marginPct, 2)}</td>
                  <td className="num cell-mono">{fmtInt(k.fes)}</td>
                  <td className="num cell-mono">{k.profitPerFe == null ? '—' : npMoney(k.profitPerFe, cur, 2)}</td>
                  {hasBuffer && <td className="num cell-mono" style={{ color: npTone(k.buffer ? k.buffer.adjustedProfit : k.profit) }}>{npMoney(k.buffer ? k.buffer.adjustedProfit : k.profit, cur)}</td>}
                </tr>
              );
            })}
            {days.length > 1 && (
              <tr style={{ borderTop: '1px solid var(--border)', fontWeight: 700 }}>
                <td>Soma dos dias</td>
                <td className="num cell-mono">{npMoney(tot.revenue, cur)}</td>
                <td className="num cell-mono" style={{ color: 'var(--danger)' }}>{npMoney(tot.costs, cur)}</td>
                <td className="num cell-mono" style={{ color: npTone(tot.profit) }}>{npMoney(tot.profit, cur)}</td>
                <td/>
                <td className="num cell-mono">{npPct(tot.revenue > 0 ? (tot.profit / tot.revenue) * 100 : 0, 2)}</td>
                <td className="num cell-mono">{fmtInt(tot.fes)}</td>
                <td className="num cell-mono">{tot.fes > 0 ? npMoney(tot.profit / tot.fes, cur, 2) : '—'}</td>
                {hasBuffer && <td className="num cell-mono" style={{ color: npTone(tot.adj) }}>{npMoney(tot.adj, cur)}</td>}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Por produto (família) ───────────────────────────────────────────────
function NpProducts({ rows, cur }) {
  const [q, setQ] = useStateNP('');
  const [detail, setDetail] = useStateNP(false);
  const qn = q.trim().toLowerCase();
  const list = rows.filter((r) => !qn || r.family.toLowerCase().includes(qn));
  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="panel-head" style={{ flexWrap: 'wrap' }}>
        <div className="panel-title">
          <span className="panel-eyebrow">MARGEM POR PRODUTO</span>
          <div className="panel-sub">Vendas de front (plataformas) por família, com o fee e a reserva de cada plataforma. O CPA fica no produto do front-end (upsell não paga CPA), então produto de upsell aparece com margem alta. Recuperação e backend não são alocados por produto.</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="select-btn" style={{ padding: '0 10px', width: 'min(200px, 100%)' }}>
            <Icon name="search" size={13}/>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar família…" style={{ background: 'transparent', border: 0, color: 'var(--fg1)', outline: 'none', flex: 1, fontFamily: 'var(--f-body)', fontSize: 12 }}/>
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
              <th>Família</th>
              <th className="num">Gross</th>
              <th className="num" title="do gross do front">% front</th>
              <th className="num">FEs</th>
              {detail && <>
                <th className="num">Afiliados</th><th className="num">Reembolso</th><th className="num">Fee</th><th className="num">Produto</th><th className="num">Reserva</th>
              </>}
              <th className="num">Lucro</th>
              <th className="num">Margem</th>
              <th className="num">Lucro/FE</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={detail ? 12 : 7} style={{ textAlign: 'center', padding: 20, opacity: 0.6 }}>Nenhum produto</td></tr>}
            {list.map((r) => (
              <tr key={r.family}>
                <td style={{ fontWeight: 600 }}>{r.family === '—' ? <span style={{ color: 'var(--fg4)' }}>sem família no catálogo</span> : r.family}</td>
                <td className="num cell-mono" style={{ color: 'var(--fg1)' }}>{npMoney(r.gross, cur)}</td>
                <td className="num cell-mono">{npPct(r.shareOfFrontPct)}</td>
                <td className="num cell-mono">{fmtInt(r.fes)}</td>
                {detail && <>
                  <td className="num cell-mono">{npMoney(r.cpa, cur)}</td>
                  <td className="num cell-mono">{npMoney(r.refund, cur)}</td>
                  <td className="num cell-mono">{npMoney(r.fee, cur)}</td>
                  <td className="num cell-mono">{npMoney(r.productCost, cur)}</td>
                  <td className="num cell-mono">{npMoney(r.allowance, cur)}</td>
                </>}
                <td className="num cell-mono" style={{ fontWeight: 700, color: npTone(r.profit) }}>{npMoney(r.profit, cur)}</td>
                <td className="num cell-mono" style={{ color: r.marginPct >= 0 ? 'var(--fg1)' : 'var(--danger)' }}>{npPct(r.marginPct)}</td>
                <td className="num cell-mono">{r.profitPerFe == null ? '—' : npMoney(r.profitPerFe, cur, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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
          <span className="panel-eyebrow">MARGEM POR AFILIADO</span>
          <div className="panel-sub">{fmtInt(rows.length)} contas com venda no período · mesma fórmula das plataformas, com o fee e a reserva da plataforma de cada um</div>
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
              <th className="num">Gross</th>
              <th className="num" title="participação na receita econômica total">% receita</th>
              {detail && <>
                <th className="num" title="front: CPA pago · recuperação: comissão">CPA / comissão</th>
                <th className="num">Reembolso</th><th className="num">Fee</th><th className="num">Produto</th><th className="num">Reserva</th>
              </>}
              <th className="num">Lucro</th>
              <th className="num">Margem</th>
              <th className="num">Lucro/FE</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={detail ? 12 : 7} style={{ textAlign: 'center', padding: 20, opacity: 0.6 }}>Nenhum afiliado</td></tr>}
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
                  <td className="num cell-mono" style={{ fontWeight: 700, color: npTone(a.profit) }}>{npMoney(a.profit, cur)}</td>
                  <td className="num cell-mono" style={{ color: a.marginPct >= 0 ? 'var(--fg1)' : 'var(--danger)' }}>{npPct(a.marginPct)}</td>
                  <td className="num cell-mono">{a.profitPerFe == null ? '—' : npMoney(a.profitPerFe, cur, 2)}</td>
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
            <tr><th>Projeção</th><th>Período</th><th>Criada</th><th className="num">Receita</th><th className="num">Custos</th><th className="num">Lucro</th><th className="num">Margem</th><th/></tr>
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
  const [history, setHistory] = useStateNP([]);
  const [platforms, setPlatforms] = useStateNP([]);
  const [computing, setComputing] = useStateNP(false);
  const [busy, setBusy] = useStateNP(false);
  const [msg, setMsg] = useStateNP(null);
  const [drawer, setDrawer] = useStateNP(false);
  const [view, setView] = useStateNP('canais');
  const [openChannel, setOpenChannel] = useStateNP(null);
  const [recomputeTick, setRecomputeTick] = useStateNP(0);
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
        setParams(d.params); setSavedParams(d.params); setResult(d.result); setNeeds(d.needs || []); setScenarios(d.scenarios || []); setHistory(d.history || []);
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
  }, [params, recomputeTick]);

  useEffectNP(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 6000); return () => clearTimeout(t); }, [msg]);

  const dirty = useMemoNP(() => JSON.stringify(params) !== JSON.stringify(savedParams), [params, savedParams]);
  const setParam = (path, value) => setParams((p) => npSet(p, path, value));

  async function saveParams() {
    setBusy(true);
    try {
      const r = await window.NSApi.adminSaveNetProfitParams(params);
      setSavedParams(r.params); setParams(r.params);
      const d = await window.NSApi.fetchNetProfit(filters).catch(() => null);
      if (d) setHistory(d.history || []);
      setMsg({ ok: true, text: 'parâmetros salvos como padrão (mudança registrada no histórico)' });
    }
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
  async function importSalesbound(file) {
    setBusy(true);
    try {
      const r = await window.NSApi.adminImportSalesbound(await file.text());
      const s = r.import.success;
      setMsg({ ok: true, text: `SalesBound: ${fmtInt(r.import.parsed)} transações (${fmtInt(r.import.inserted)} novas) · ${fmtInt(s.sales)} vendas ${npMoney(s.salesUsd, cur)} · estornos ${npMoney(s.refundsUsd, cur)}` });
      setRecomputeTick((t) => t + 1);
    }
    catch (e) { setMsg({ ok: false, text: `import SalesBound: ${e.message}` }); }
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
          <span className="sub">Margem de contribuição: plataformas + parcela NorthScale do backend, menos os custos variáveis · sem OPEX fixo · período da barra acima{computing ? ' · recalculando…' : ''}</span>
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
        <NpKpi label="Receita econômica" value={loading ? '…' : npMoney(k.revenue, cur)} money sub={loading ? '' : `plataformas ${npMoney(k.platformGross, cur)} + backend líquido ${npMoney(k.backendNet, cur)}`}/>
        <NpKpi label="Custos variáveis" value={loading ? '…' : npMoney(k.costs, cur)} accent="var(--danger)" sub={loading ? '' : `${npPct(k.revenue > 0 ? (k.costs / k.revenue) * 100 : 0)} da receita · afiliados, reembolso, fee, reserva, produto`}/>
        <NpKpi label="Lucro de contribuição" value={loading ? '…' : npMoney(k.profit, cur)} accent={!loading && k.profit < 0 ? 'var(--danger)' : 'var(--money)'} sub={loading ? '' : `${k.profitPerFe == null ? '—' : npMoney(k.profitPerFe, cur, 2)} por FE`}/>
        <NpKpi label="Margem oficial" value={loading ? '…' : npPct(k.marginPct, 2)} accent={!loading && (k.marginPct >= 15 ? 'var(--success)' : k.marginPct >= 5 ? 'var(--warning)' : 'var(--danger)')} sub={loading ? '' : `lucro ÷ receita econômica · sobre o gross ${npPct(k.marginOnGrossPct, 2)}`}/>
      </div>

      {!loading && <NpUnitStrip k={k} cur={cur}/>}
      {!loading && <NpCompositionBar result={result} cur={cur}/>}
      {!loading && <NpNeedsStrip needs={needs}/>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div className="seg">
          <button className={view === 'canais' ? 'is-active' : ''} onClick={() => setView('canais')}>Canais</button>
          <button className={view === 'dias' ? 'is-active' : ''} onClick={() => setView('dias')}>Por dia</button>
          <button className={view === 'produtos' ? 'is-active' : ''} onClick={() => setView('produtos')}>Por produto{!loading && result.products ? <span style={{ marginLeft: 6, opacity: 0.55 }}>{fmtInt(result.products.length)}</span> : null}</button>
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
          {openCh && <NpChannelDetail ch={openCh} cur={cur} salesbound={result.salesbound} onClose={() => setOpenChannel(null)}/>}
          {!loading && result.warnings?.length > 0 && (
            <div className="panel" style={{ marginBottom: 14, fontSize: 12, color: 'var(--warning)' }}>
              {result.warnings.map((w) => <div key={w}>⚠ {w}</div>)}
            </div>
          )}
        </>
      )}
      {view === 'dias' && !loading && params && <NpDaily filters={filters} params={params} cur={cur}/>}
      {view === 'produtos' && !loading && <NpProducts rows={result.products || []} cur={cur}/>}
      {view === 'afiliados' && !loading && <NpAffiliates rows={result.affiliates} cur={cur}/>}
      {view === 'projecoes' && !loading && (
        <NpScenarios scenarios={scenarios} current={k} cur={cur} busy={busy} onDelete={deleteScenario}
          onApply={(p) => { setParams(p); setDrawer(true); setMsg({ ok: true, text: 'parâmetros da projeção carregados (não salvos)' }); }}/>
      )}

      {drawer && params && (
        <NpParamsDrawer params={params} setParam={setParam} setParams={setParams} obs={result?.observedProductCostPct} platforms={platforms}
          salesbound={result?.salesbound} history={history}
          dirty={dirty} busy={busy} onSave={saveParams} onSaveScenario={saveScenario} onImportSalesbound={importSalesbound}
          onReset={() => setParams(savedParams)} onClose={() => setDrawer(false)}/>
      )}
    </div>
  );
}

Object.assign(window, { NetProfitPage });
