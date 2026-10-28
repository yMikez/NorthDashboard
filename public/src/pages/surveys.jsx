/* global React, Icon, fmtCurrency, fmtInt, fmtPct, fmtDateTime, fmtDateShort, SkelTableRows, Paginated, ReadState */
/* Aba Pesquisas — quiz pós-compra (fim do tratamento). Uma pesquisa por
   produto (slug próprio em checkin.healthnwellnes.com), cada uma com teste
   A/B opcional. Seções: visão geral (funil, dia a dia, todas as pesquisas),
   vendas (tela final, botão, público, quando abriu, canal), respostas (cada
   pergunta e resposta → compra), testes A/B, fila do CS e, pro admin,
   configuração (ofertas, textos, pesquisa nova, link de teste).
   Período = data do convite; testes A/B têm o período deles.
   API: GET/PATCH /api/metrics/surveys · /api/admin/surveys/{variants,experiments,invites} */

const { useState: useStateSv, useEffect: useEffectSv } = React;

const SV_CS_STATUS = [
  { id: 'aberto', label: 'Aberto' },
  { id: 'ligado', label: 'Ligado' },
  { id: 'resolvido', label: 'Resolvido' },
];
const SV_OUTCOME_LABEL = { cs: 'CS liga', recorrencia: 'Assinatura', oferta: 'Kit', cupom: 'Kit + cupom', obrigado: 'Só agradecimento' };
const svOutcome = (r) => (r.outcome === 'cupom' && r.couponPct ? `Kit + cupom ${r.couponPct}%` : SV_OUTCOME_LABEL[r.outcome] || r.outcome);
const svUsd = (n, digits = 0) => fmtCurrency(n, 'USD', digits);
const SV_SECTION_KEY = 'ns.surveys.section';

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

function SvPanel({ title, sub, children, style, right }) {
  return (
    <div className="panel" style={{ marginBottom: 12, ...style }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="panel-title">{title}</div>
          {sub && <div className="panel-sub" style={{ fontSize: 11, marginBottom: 10 }}>{sub}</div>}
          {!sub && <div style={{ height: 8 }}/>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

/** Quantidade + % sobre a base, lado a lado. */
function SvNumPct({ n, of, money }) {
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      <span className="mono" style={money && n > 0 ? { color: 'var(--money)', fontWeight: 600 } : undefined}>{fmtInt(n)}</span>
      <span className="mono" style={{ color: 'var(--fg5)', marginLeft: 6, fontSize: 11 }}>{of ? fmtPct(n / of, 0) : '—'}</span>
    </span>
  );
}

const SV_SALES_COLS = {
  invited: { h: 'Convites', cell: (r) => <span className="mono">{fmtInt(r.invited || 0)}</span> },
  base: { h: null, cell: (r) => <span className="mono">{fmtInt(r.base)}</span> },
  completed: { h: 'Concluíram', cell: (r) => <SvNumPct n={r.completed} of={r.base}/> },
  clicked: { h: 'Clicaram', cell: (r) => <SvNumPct n={r.clicked} of={r.base}/> },
  purchases: { h: 'Compraram', cell: (r) => <SvNumPct n={r.purchases} of={r.base} money/> },
  revenue: { h: 'Receita', cell: (r) => <span className="mono" style={r.revenueUsd > 0 ? { color: 'var(--money)' } : undefined}>{svUsd(r.revenueUsd)}</span> },
  rpv: { h: 'Receita / pessoa', cell: (r) => <span className="mono">{r.base ? svUsd(r.revenueUsd / r.base, 2) : '—'}</span> },
};

/** Tabela "→ venda": % sempre sobre a base da linha (baseLabel diz qual é). */
function SvSalesTable({ rows, baseLabel, cols = ['base', 'completed', 'clicked', 'purchases', 'revenue', 'rpv'], empty = 'Sem dados no período.' }) {
  if (!rows.length || !rows.some((r) => r.base > 0 || r.invited > 0)) {
    return <div style={{ padding: '6px 0 4px', color: 'var(--fg5)', fontSize: 12 }}>{empty}</div>;
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="tbl" style={{ fontSize: 12.5, minWidth: 520 }}>
        <thead>
          <tr>
            <th/>
            {cols.map((c) => <th key={c} className="num" title={c === 'rpv' ? `Receita ÷ ${baseLabel.toLowerCase()}` : undefined}>{c === 'base' ? baseLabel : SV_SALES_COLS[c].h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={{ fontWeight: 500 }}>{r.label}</td>
              {cols.map((c) => <td key={c} className="num">{SV_SALES_COLS[c].cell(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Do convite à compra: cada passo com % do anterior e % dos convites. */
function SvFunnel({ k }) {
  const steps = [
    { l: 'Convites', n: k.invites },
    { l: 'Enviados', n: k.sent, note: 'quem dispara marca o envio' },
    { l: 'Abriram o link', n: k.opened, prev: k.sent || k.invites },
    { l: 'Começaram a responder', n: k.started },
    { l: 'Concluíram', n: k.completed },
    { l: 'Clicaram no checkout', n: k.checkoutClicks },
    { l: 'Compraram', n: k.purchases, money: true },
  ];
  const max = Math.max(1, k.invites);
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(130px, 1.3fr) 2fr 56px 64px 64px', gap: 8, fontSize: 10.5, color: 'var(--fg5)' }}>
        <span/><span/><span style={{ textAlign: 'right' }}>pessoas</span><span style={{ textAlign: 'right' }}>do passo anterior</span><span style={{ textAlign: 'right' }}>dos convites</span>
      </div>
      {steps.map((s, i) => {
        const prev = s.prev != null ? s.prev : i ? steps[i - 1].n : null;
        return (
          <div key={s.l} style={{ display: 'grid', gridTemplateColumns: 'minmax(130px, 1.3fr) 2fr 56px 64px 64px', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
            <span style={{ color: 'var(--fg2)' }} title={s.note}>{s.l}</span>
            <span style={{ height: 10, background: 'var(--bg-sunken, var(--border-soft))', borderRadius: 4, overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', width: `${(s.n / max) * 100}%`, background: s.money ? 'var(--money)' : 'var(--accent)', borderRadius: 4 }}/>
            </span>
            <span className="mono" style={{ textAlign: 'right', color: s.money && s.n ? 'var(--money)' : 'var(--fg1)', fontWeight: s.money ? 600 : 400 }}>{fmtInt(s.n)}</span>
            <span className="mono" style={{ textAlign: 'right', color: 'var(--fg4)' }}>{i && prev ? fmtPct(s.n / prev, 0) : '—'}</span>
            <span className="mono" style={{ textAlign: 'right', color: 'var(--fg5)' }}>{i && k.invites ? fmtPct(s.n / k.invites, 0) : '—'}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Mais de 45 dias vira semana (segunda-feira). */
function svBucketDays(rows) {
  if (rows.length <= 45) return rows.map((r) => ({ ...r, label: fmtDateShort(`${r.date}T00:00:00Z`) }));
  const weeks = new Map();
  for (const r of rows) {
    const d = new Date(`${r.date}T00:00:00Z`);
    const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
    const w = weeks.get(monday) || { date: monday, label: `sem. ${fmtDateShort(`${monday}T00:00:00Z`)}`, opened: 0, completed: 0, clicked: 0, purchases: 0, revenueUsd: 0 };
    w.opened += r.opened; w.completed += r.completed; w.clicked += r.clicked; w.purchases += r.purchases; w.revenueUsd += r.revenueUsd;
    weeks.set(monday, w);
  }
  return [...weeks.values()];
}

function SvDaily({ rows }) {
  const data = svBucketDays(rows || []);
  if (!data.some((r) => r.opened || r.completed || r.purchases)) {
    return <div style={{ padding: '14px 0', color: 'var(--fg5)', fontSize: 12 }}>Ninguém abriu o link no período.</div>;
  }
  const max = Math.max(1, ...data.map((r) => r.opened));
  const tip = (r) => `${r.label}: ${r.opened} abriram · ${r.completed} concluíram · ${r.clicked} clicaram · ${r.purchases} compras${r.revenueUsd ? ` (${svUsd(r.revenueUsd)})` : ''}`;
  const tick = Math.max(1, Math.ceil(data.length / 6));
  return (
    <div>
      <div role="img" aria-label={`Por dia: ${data.map(tip).join('; ')}`}
        style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 150, padding: '16px 0 0', borderBottom: '1px solid var(--border)' }}>
        {data.map((r) => (
          <div key={r.date} title={tip(r)} style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center' }}>
            {r.purchases > 0 && <span className="mono" style={{ fontSize: 10, color: 'var(--money)', fontWeight: 600, marginBottom: 2 }}>{r.purchases}</span>}
            <div style={{ width: '100%', maxWidth: 26, display: 'flex', alignItems: 'flex-end', gap: 1, height: `${(r.opened / max) * 100}%`, minHeight: r.opened ? 2 : 0 }}>
              <span style={{ flex: 1, height: '100%', background: 'color-mix(in oklab, var(--accent) 30%, transparent)', borderRadius: '2px 2px 0 0' }}/>
              <span style={{ flex: 1, height: `${r.opened ? (r.completed / r.opened) * 100 : 0}%`, background: 'var(--accent)', borderRadius: '2px 2px 0 0' }}/>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 2, marginTop: 4 }}>
        {data.map((r, i) => (
          <span key={r.date} style={{ flex: 1, minWidth: 0, fontSize: 10, color: 'var(--fg5)', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'visible' }}>
            {i % tick === 0 ? r.label : ''}
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10, fontSize: 11.5, color: 'var(--fg4)' }}>
        <span><i style={{ display: 'inline-block', width: 10, height: 10, background: 'color-mix(in oklab, var(--accent) 30%, transparent)', borderRadius: 2, marginRight: 5 }}/>Abriram</span>
        <span><i style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--accent)', borderRadius: 2, marginRight: 5 }}/>Concluíram</span>
        <span><b className="mono" style={{ color: 'var(--money)', marginRight: 5 }}>n</b>Compras no dia</span>
      </div>
      <details style={{ marginTop: 10 }}>
        <summary style={{ fontSize: 12, color: 'var(--fg4)', cursor: 'pointer' }}>Ver em tabela</summary>
        <div style={{ overflowX: 'auto', marginTop: 8 }}>
          <table className="tbl" style={{ fontSize: 12.5, minWidth: 480 }}>
            <thead><tr><th>{rows.length > 45 ? 'Semana' : 'Dia'}</th><th className="num">Abriram</th><th className="num">Concluíram</th><th className="num">Clicaram</th><th className="num">Compras</th><th className="num">Receita</th></tr></thead>
            <tbody>
              {[...data].reverse().filter((r) => r.opened || r.completed || r.clicked || r.purchases).map((r) => (
                <tr key={r.date}>
                  <td>{r.label}</td>
                  <td className="num mono">{fmtInt(r.opened)}</td>
                  <td className="num mono">{fmtInt(r.completed)}</td>
                  <td className="num mono">{fmtInt(r.clicked)}</td>
                  <td className="num mono" style={r.purchases ? { color: 'var(--money)', fontWeight: 600 } : undefined}>{fmtInt(r.purchases)}</td>
                  <td className="num mono">{svUsd(r.revenueUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
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
        <div className="panel-sub" style={{ fontSize: 11 }}>Nota 1 ou parou por médico/mal-estar (sem oferta). A página promete contato em até 24h. Mostra os abertos e os resolvidos nos últimos 7 dias, de qualquer período.</div>
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

// ---------- configuração (ofertas, textos) — usada pela pesquisa e pelas versões do teste A/B ----------

const SV_INPUT = {
  padding: '7px 10px', fontSize: 12.5, color: 'var(--fg1)', background: 'var(--bg)',
  border: '1px solid var(--border)', borderRadius: 6, minWidth: 0, width: '100%',
};
const SV_LABEL = { display: 'block', fontSize: 11, color: 'var(--fg4)', marginBottom: 3 };
const SV_H = { fontSize: 12, fontWeight: 600, color: 'var(--fg2)', margin: '18px 0 8px' };
const svNum = (v) => (v === '' || v == null ? null : Number(v));
const SV_SEGMENTS = [
  { id: '', label: 'Todos' },
  { id: 'completo', label: 'Só quem comprou 6+' },
  { id: 'completo_constante', label: 'Só 6+ que tomou todo dia' },
];

let svFamiliesCache = null;
/** Produtos do catálogo (famílias) pra escolher quem recebe a pesquisa. */
function useSvFamilies() {
  const [families, setFamilies] = useStateSv(svFamiliesCache);
  useEffectSv(() => {
    if (svFamiliesCache) return undefined;
    let alive = true;
    window.NSApi.fetchFilterOptions()
      .then((o) => { svFamiliesCache = (o.families || []).map((f) => f.id).sort((a, b) => a.localeCompare(b)); if (alive) setFamilies(svFamiliesCache); })
      .catch(() => alive && setFamilies([]));
    return () => { alive = false; };
  }, []);
  return families;
}

function svSlugId(label, taken) {
  const base = String(label || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'opcao';
  let id = base;
  for (let n = 2; taken.has(id) || id === 'nada' || id === 'cedo'; n++) id = `${base}_${n}`;
  taken.add(id);
  return id;
}

/** Config (JSON da pesquisa) → rascunho do formulário. */
function svCfgDraft(c) {
  c = c || {};
  const sub = (c.offers && c.offers.assinatura) || {};
  return {
    productName: c.productName || '', accent: c.accent || '#2f6fde', image: c.image || '',
    eligible: (c.eligibleBottles || [2, 3]).join(', '), fullPlanFrom: c.fullPlanFrom == null ? '' : String(c.fullPlanFrom),
    sub: { url: sub.url || '', monthlyPrice: sub.monthlyPrice == null ? '' : String(sub.monthlyPrice), firstPrice: sub.firstPrice != null && sub.firstPrice !== sub.monthlyPrice ? String(sub.firstPrice) : '' },
    kits: Object.entries((c.offers && c.offers.kits) || {}).map(([n, k]) => ({ n, url: k.url || '', price: String(k.price ?? ''), every: k.everyMonths == null ? '' : String(k.everyMonths) })),
    fronts: Object.entries(c.frontPrices || {}).map(([n, p]) => ({ n, price: String(p) })),
    coupons: (c.coupons || []).map((x) => ({ pct: String(x.pct), code: x.code || '', kits: x.kits })),
    couponValidDays: String(c.couponValidDays ?? 7),
    q4: (c.q4 || []).map((o) => ({ id: o.id, label: o.label })),
    // Campos sem formulário passam como estão.
    rest: { planBottles: c.planBottles, daysPerBottle: c.daysPerBottle, trackingParam: c.trackingParam, couponParam: c.couponParam },
    copy: Object.entries(c.copy || {}).map(([k, text]) => ({ base: k.split('@')[0], seg: k.split('@')[1] || '', text })),
  };
}

/** Rascunho → config pra mandar ao servidor (que valida de novo). */
function svCfgOf(d) {
  const taken = new Set(d.q4.filter((o) => o.id).map((o) => o.id));
  return {
    ...d.rest,
    productName: d.productName, accent: d.accent, image: d.image || null,
    eligibleBottles: d.eligible.split(/[,\s]+/).filter(Boolean).map(Number),
    fullPlanFrom: svNum(d.fullPlanFrom),
    frontPrices: Object.fromEntries(d.fronts.filter((r) => r.n !== '').map((r) => [r.n, svNum(r.price)])),
    offers: {
      assinatura: d.sub.url || d.sub.monthlyPrice !== ''
        ? { url: d.sub.url || null, monthlyPrice: svNum(d.sub.monthlyPrice), firstPrice: svNum(d.sub.firstPrice) }
        : null,
      kits: Object.fromEntries(d.kits.filter((r) => r.n !== '').map((r) => [r.n, { url: r.url || null, price: svNum(r.price), everyMonths: svNum(r.every) }])),
    },
    coupons: d.coupons.filter((c) => c.pct !== '').map((c) => ({ pct: svNum(c.pct), code: c.code || null, ...(c.kits ? { kits: c.kits } : {}) })),
    couponValidDays: svNum(d.couponValidDays),
    q4: d.q4.filter((o) => o.label.trim()).map((o) => ({ id: o.id || svSlugId(o.label, taken), label: o.label.trim() })),
    copy: Object.fromEntries(d.copy.filter((r) => r.base && r.text.trim()).map((r) => [r.seg ? `${r.base}@${r.seg}` : r.base, r.text.trim()])),
  };
}

/** Frases reescritas: escolhe a frase, o público e escreve por cima do padrão. */
function SvCopyRows({ rows, defaults, onChange }) {
  const keys = Object.keys(defaults || {}).filter((k) => !k.includes('@'));
  const groups = [];
  for (const k of keys) {
    const g = k.split('.')[0];
    const last = groups[groups.length - 1];
    if (last && last.g === g) last.keys.push(k); else groups.push({ g, keys: [k] });
  }
  const set = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const def = (r) => (defaults || {})[r.seg ? `${r.base}@${r.seg}` : r.base] || (defaults || {})[r.base] || '';
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) minmax(150px, 0.7fr) minmax(240px, 2fr) 32px', gap: 8, alignItems: 'start' }}>
          <select style={SV_INPUT} value={r.base} onChange={(e) => set(i, { base: e.target.value })} aria-label="Frase">
            <option value="">Escolha a frase…</option>
            {groups.map((g) => (
              <optgroup key={g.g} label={g.g}>
                {g.keys.map((k) => <option key={k} value={k}>{k}</option>)}
              </optgroup>
            ))}
          </select>
          <select style={SV_INPUT} value={r.seg} onChange={(e) => set(i, { seg: e.target.value })} aria-label="Pra quem vale">
            {SV_SEGMENTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <div>
            <textarea style={{ ...SV_INPUT, minHeight: 54, resize: 'vertical' }} value={r.text} onChange={(e) => set(i, { text: e.target.value })}
              placeholder={def(r)} aria-label={`Texto novo de ${r.base || 'frase'}`}/>
            {r.base && <div style={{ fontSize: 11, color: 'var(--fg5)', marginTop: 3 }}>Padrão: {def(r) || '—'}</div>}
          </div>
          <button className="icon-btn" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Remover frase" title="Remover"><Icon name="x" size={12}/></button>
        </div>
      ))}
      <div>
        <button className="btn btn-ghost" onClick={() => onChange([...rows, { base: '', seg: '', text: '' }])}>+ Frase</button>
        <span style={{ fontSize: 11, color: 'var(--fg5)', marginLeft: 10 }}>Variáveis: {'{nome} {produto} {frascos} {dias} {plano} {preco_kit} {preco_pote} {preco_mes} {desconto} {cupom} {validade}'}</span>
      </div>
    </div>
  );
}

/**
 * Campos da configuração. armMode = versão de teste A/B: público e rastreio
 * são da pesquisa e não aparecem.
 */
function SvConfigFields({ draft, onChange, defaults, armMode }) {
  const set = (patch) => onChange((d) => ({ ...d, ...patch }));
  const setRow = (key, i, patch) => onChange((d) => ({ ...d, [key]: d[key].map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const addRow = (key, row) => onChange((d) => ({ ...d, [key]: [...d[key], row] }));
  const delRow = (key, i) => onChange((d) => ({ ...d, [key]: d[key].filter((_, j) => j !== i) }));
  return (
    <div>
      <div style={SV_H}>Página</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
        <label><span style={SV_LABEL}>Nome do produto na página</span><input style={SV_INPUT} value={draft.productName} onChange={(e) => set({ productName: e.target.value })}/></label>
        <label><span style={SV_LABEL}>Cor de destaque</span>
          <span style={{ display: 'flex', gap: 6 }}>
            <input type="color" value={/^#[0-9a-f]{6}$/i.test(draft.accent) ? draft.accent : '#2f6fde'} onChange={(e) => set({ accent: e.target.value })} aria-label="Escolher cor" style={{ width: 36, height: 32, padding: 0, border: 'none', background: 'none' }}/>
            <input style={SV_INPUT} value={draft.accent} onChange={(e) => set({ accent: e.target.value })}/>
          </span>
        </label>
        <label><span style={SV_LABEL}>Foto dos frascos</span><input style={SV_INPUT} value={draft.image} onChange={(e) => set({ image: e.target.value })} placeholder="/survey-assets/produto.webp"/></label>
        {!armMode && (<>
          <label><span style={SV_LABEL}>Recebe quem comprou (frascos)</span><input style={SV_INPUT} value={draft.eligible} onChange={(e) => set({ eligible: e.target.value })} placeholder="2, 3"/></label>
          <label><span style={SV_LABEL}>E quem comprou a partir de (frascos)</span><input style={SV_INPUT} inputMode="numeric" value={draft.fullPlanFrom} onChange={(e) => set({ fullPlanFrom: e.target.value })} placeholder="6 (vazio = não)"/></label>
        </>)}
      </div>

      <div style={SV_H}>Assinatura de 1 frasco por mês</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 3fr) repeat(2, minmax(110px, 1fr))', gap: 10 }}>
        <label><span style={SV_LABEL}>Link do checkout</span><input style={SV_INPUT} value={draft.sub.url} onChange={(e) => set({ sub: { ...draft.sub, url: e.target.value } })} placeholder="https://vupim.com/c/…"/></label>
        <label><span style={SV_LABEL}>Preço por mês (US$)</span><input style={SV_INPUT} inputMode="decimal" value={draft.sub.monthlyPrice} onChange={(e) => set({ sub: { ...draft.sub, monthlyPrice: e.target.value } })}/></label>
        <label><span style={SV_LABEL} title="Deixe vazio se a 1ª cobrança é igual às outras">1ª cobrança, se diferente</span><input style={SV_INPUT} inputMode="decimal" value={draft.sub.firstPrice} onChange={(e) => set({ sub: { ...draft.sub, firstPrice: e.target.value } })} placeholder="igual"/></label>
      </div>

      <div style={SV_H}>Kits de recompra</div>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl" style={{ fontSize: 12.5, minWidth: 640 }}>
          <thead><tr><th style={{ width: 80 }}>Frascos</th><th>Link do checkout</th><th style={{ width: 110 }}>Preço (US$)</th><th style={{ width: 130 }} title="De quantos em quantos meses a Vupim entrega e cobra de novo. Vazio = compra única.">Cobra a cada (meses)</th><th style={{ width: 90 }} className="num">Por frasco</th><th style={{ width: 40 }}/></tr></thead>
          <tbody>
            {draft.kits.map((r, i) => (
              <tr key={i}>
                <td><input style={SV_INPUT} inputMode="numeric" value={r.n} onChange={(e) => setRow('kits', i, { n: e.target.value })} aria-label="Frascos do kit"/></td>
                <td><input style={SV_INPUT} value={r.url} onChange={(e) => setRow('kits', i, { url: e.target.value })} placeholder="https://vupim.com/c/…" aria-label="Link do kit"/></td>
                <td><input style={SV_INPUT} inputMode="decimal" value={r.price} onChange={(e) => setRow('kits', i, { price: e.target.value })} aria-label="Preço do kit"/></td>
                <td><input style={SV_INPUT} inputMode="numeric" value={r.every} onChange={(e) => setRow('kits', i, { every: e.target.value })} placeholder="única" aria-label="Ciclo de cobrança em meses"/></td>
                <td className="num mono">{Number(r.n) > 0 && Number(r.price) > 0 ? svUsd(Number(r.price) / Number(r.n), 2) : '—'}</td>
                <td><button className="icon-btn" onClick={() => delRow('kits', i)} aria-label="Remover kit" title="Remover"><Icon name="x" size={12}/></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn btn-ghost" style={{ marginTop: 6 }} onClick={() => addRow('kits', { n: '', url: '', price: '', every: '' })}>+ Kit</button>

      <div style={SV_H}>Cupons <span style={{ fontWeight: 400, color: 'var(--fg5)' }}>· 10% hesitante, 15% objeção de preço, 20% quase desistindo</span></div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {draft.coupons.map((c, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
            <label style={{ width: 70 }}><span style={SV_LABEL}>%</span><input style={SV_INPUT} inputMode="numeric" value={c.pct} onChange={(e) => setRow('coupons', i, { pct: e.target.value })}/></label>
            <label style={{ width: 140 }}><span style={SV_LABEL}>Código</span><input style={SV_INPUT} value={c.code} onChange={(e) => setRow('coupons', i, { code: e.target.value.toUpperCase() })} placeholder="sem código = desligado"/></label>
            <button className="icon-btn" onClick={() => delRow('coupons', i)} aria-label="Remover cupom" title="Remover"><Icon name="x" size={12}/></button>
          </div>
        ))}
        <button className="btn btn-ghost" onClick={() => addRow('coupons', { pct: '', code: '' })}>+ Cupom</button>
        <label style={{ width: 150 }}><span style={SV_LABEL}>Reservado por (dias)</span><input style={SV_INPUT} inputMode="numeric" value={draft.couponValidDays} onChange={(e) => set({ couponValidDays: e.target.value })}/></label>
      </div>

      <div style={SV_H}>Preço normal do front <span style={{ fontWeight: 400, color: 'var(--fg5)' }}>· a copy compara o preço por frasco com ele</span></div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {draft.fronts.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
            <label style={{ width: 70 }}><span style={SV_LABEL}>Frascos</span><input style={SV_INPUT} inputMode="numeric" value={r.n} onChange={(e) => setRow('fronts', i, { n: e.target.value })}/></label>
            <label style={{ width: 100 }}><span style={SV_LABEL}>Preço (US$)</span><input style={SV_INPUT} inputMode="decimal" value={r.price} onChange={(e) => setRow('fronts', i, { price: e.target.value })}/></label>
            <button className="icon-btn" onClick={() => delRow('fronts', i)} aria-label="Remover preço" title="Remover"><Icon name="x" size={12}/></button>
          </div>
        ))}
        <button className="btn btn-ghost" onClick={() => addRow('fronts', { n: '', price: '' })}>+ Preço</button>
      </div>

      <div style={SV_H}>Pergunta 4 · o que a pessoa notou <span style={{ fontWeight: 400, color: 'var(--fg5)' }}>· opções do produto (em inglês); "Nada ainda" e "Cedo demais" entram sempre</span></div>
      <div style={{ display: 'grid', gap: 6 }}>
        {draft.q4.map((o, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input style={SV_INPUT} value={o.label} onChange={(e) => setRow('q4', i, { label: e.target.value })} placeholder="Feeling more focused" aria-label={`Opção ${i + 1} da pergunta 4`}/>
            {o.id && <span className="mono" style={{ fontSize: 11, color: 'var(--fg5)', whiteSpace: 'nowrap' }} title="Identificador gravado nas respostas">{o.id}</span>}
            <button className="icon-btn" onClick={() => delRow('q4', i)} aria-label="Remover opção" title="Remover"><Icon name="x" size={12}/></button>
          </div>
        ))}
        <div><button className="btn btn-ghost" onClick={() => addRow('q4', { id: '', label: '' })} disabled={draft.q4.length >= 8}>+ Opção</button></div>
      </div>

      <div style={SV_H}>Frases reescritas <span style={{ fontWeight: 400, color: 'var(--fg5)' }}>· opcional; o que não estiver aqui usa o texto padrão</span></div>
      <SvCopyRows rows={draft.copy} defaults={defaults} onChange={(copy) => set({ copy })}/>
    </div>
  );
}

/** Admin: a pesquisa em si — produto, no ar, ofertas e textos. Salvar publica na hora. */
function SvVariantEditor({ slug, experiment, onSaved }) {
  const families = useSvFamilies();
  const [state, setState] = useStateSv({ status: 'loading', error: null, version: null, defaults: null });
  const [page, setPage] = useStateSv(null);
  const [draft, setDraft] = useStateSv(null);
  const [saving, setSaving] = useStateSv(false);
  const [msg, setMsg] = useStateSv(null);

  useEffectSv(() => {
    let alive = true;
    setState({ status: 'loading', error: null, version: null, defaults: null }); setMsg(null);
    window.NSApi.fetchSurveyVariantsAdmin()
      .then((d) => {
        if (!alive) return;
        const v = d.variants.find((x) => x.slug === slug);
        if (!v) { setState({ status: 'error', error: 'pesquisa não encontrada', version: null, defaults: null }); return; }
        setPage({ name: v.name, active: v.active, family: v.family || '' });
        setDraft(svCfgDraft(v.config));
        setState({ status: 'ready', error: null, version: v.version, defaults: d.copyDefaults });
      })
      .catch((e) => alive && setState({ status: 'error', error: String(e.message || e), version: null, defaults: null }));
    return () => { alive = false; };
  }, [slug]);

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      const r = await window.NSApi.saveSurveyVariant(slug, { name: page.name, active: page.active, family: page.family || undefined, config: svCfgOf(draft) });
      setState((s) => ({ ...s, version: r.variant.version }));
      setDraft(svCfgDraft(r.variant.config));
      setPage({ name: r.variant.name, active: r.variant.active, family: r.variant.family || '' });
      setMsg({ ok: `Salvo (versão ${r.variant.version}). A página já usa os valores novos.` });
      onSaved();
    } catch (e) { setMsg({ err: String(e.message || e) }); }
    finally { setSaving(false); }
  };

  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div className="panel-title">Pesquisa, ofertas e textos</div>
      <div className="panel-sub" style={{ fontSize: 11 }}>
        Endereço: <span className="mono">checkin.healthnwellnes.com/{slug}/…</span> · links de checkout, preços, cupons e frases. Salvar publica na hora.
      </div>
      {experiment && (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--warning)' }}>
          Teste A/B no ar ("{experiment.name}"): o que você salvar aqui é a versão A. As outras versões só seguem o público e o rastreio daqui.
        </div>
      )}
      {state.status === 'loading' && <div style={{ marginTop: 12 }}><SkelTableRows rows={4} cols={4}/></div>}
      {state.status === 'error' && <div style={{ marginTop: 12, color: 'var(--danger)', fontSize: 12 }}>Não carregou: {state.error}</div>}
      {state.status === 'ready' && draft && page && (
        <div style={{ marginTop: 6 }}>
          <div style={SV_H}>Pesquisa</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            <label><span style={SV_LABEL}>Nome da pesquisa (só no dash)</span><input style={SV_INPUT} value={page.name} onChange={(e) => setPage({ ...page, name: e.target.value })}/></label>
            <label><span style={SV_LABEL}>Produto (quem recebe)</span>
              <select style={SV_INPUT} value={page.family} onChange={(e) => setPage({ ...page, family: e.target.value })}>
                {!page.family && <option value="">— escolha —</option>}
                {(families || (page.family ? [page.family] : [])).map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'end', fontSize: 12.5 }}>
              <input type="checkbox" checked={page.active} onChange={(e) => setPage({ ...page, active: e.target.checked })}/> Pesquisa no ar (gera convites)
            </label>
          </div>
          <SvConfigFields draft={draft} onChange={setDraft} defaults={state.defaults}/>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <button className="btn" onClick={save} disabled={saving}>{saving ? 'Salvando…' : 'Salvar e publicar'}</button>
            <span style={{ fontSize: 11.5, color: 'var(--fg5)' }}>Versão atual: {state.version}. Cada resposta guarda a versão que viu.</span>
            {msg && msg.ok && <span style={{ fontSize: 12, color: 'var(--success)' }}>{msg.ok}</span>}
            {msg && msg.err && <span style={{ fontSize: 12, color: 'var(--danger)' }}>Não salvou: {msg.err}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Endereço enquanto digita: deixa o hífen do fim (vai ser seguido de mais letras). */
const svSlugInput = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 60);
const svSlugify = (s) => svSlugInput(s).replace(/-+$/, '');

/** Admin: pesquisa nova copiada de outra. Nasce desligada. */
function SvNewSurvey({ variants, from, onCreated, onCancel }) {
  const families = useSvFamilies();
  const [form, setForm] = useStateSv({ name: '', slug: '', slugEdited: false, family: '', productName: '', from: from || '' });
  const [busy, setBusy] = useStateSv(false);
  const [err, setErr] = useStateSv(null);
  const source = variants.find((v) => v.slug === form.from);
  const otherProduct = !source || !form.family || source.family !== form.family;
  const taken = variants.find((v) => v.active && v.family && v.family === form.family);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await window.NSApi.createSurveyVariant({ slug: svSlugify(form.slug), name: form.name, family: form.family, productName: form.productName || form.family, from: form.from || undefined });
      onCreated(r.variant.slug);
    } catch (e2) { setErr(String(e2.message || e2)); }
    finally { setBusy(false); }
  };
  return (
    <form className="panel" style={{ marginBottom: 12 }} onSubmit={submit}>
      <div className="panel-title">Nova pesquisa</div>
      <div className="panel-sub" style={{ fontSize: 11, marginBottom: 10 }}>
        Mesmas perguntas, com produto, ofertas, foto e textos próprios. Nasce <b>desligada</b>: revise em Configurar e ligue quando estiver pronta.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
        <label><span style={SV_LABEL}>Nome (só no dash)</span>
          <input style={SV_INPUT} required value={form.name} placeholder="GlycoPulse · fim do tratamento"
            onChange={(e) => setForm({ ...form, name: e.target.value, slug: form.slugEdited ? form.slug : svSlugify(e.target.value.split('·')[0]) })}/>
        </label>
        <label><span style={SV_LABEL}>Endereço</span>
          <input style={SV_INPUT} required value={form.slug} title="letras minúsculas, números e hífen"
            onChange={(e) => setForm({ ...form, slug: svSlugInput(e.target.value), slugEdited: true })}/>
          <span style={{ fontSize: 11, color: 'var(--fg5)' }} className="mono">checkin.healthnwellnes.com/{form.slug || '…'}/…</span>
        </label>
        <label><span style={SV_LABEL}>Produto (quem recebe)</span>
          <select style={SV_INPUT} required value={form.family} onChange={(e) => setForm({ ...form, family: e.target.value, productName: form.productName || e.target.value })}>
            <option value="">{families ? '— escolha —' : 'Carregando…'}</option>
            {(families || []).map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label><span style={SV_LABEL}>Nome do produto na página</span><input style={SV_INPUT} value={form.productName} onChange={(e) => setForm({ ...form, productName: e.target.value })} placeholder={form.family || 'GlycoPulse'}/></label>
        <label><span style={SV_LABEL}>Copiar de</span>
          <select style={SV_INPUT} value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })}>
            {variants.map((v) => <option key={v.slug} value={v.slug}>{v.name}</option>)}
          </select>
        </label>
      </div>
      <div style={{ fontSize: 12, color: 'var(--fg4)', marginTop: 10, display: 'grid', gap: 4 }}>
        {otherProduct
          ? <span>Produto diferente da origem: vêm os preços, cupons (sem código) e textos; <b>links de checkout, códigos de cupom e foto ficam vazios</b> pra não mandar ninguém pro checkout de outro produto.</span>
          : <span>Mesmo produto da origem: vem tudo, inclusive os links. Pra comparar versões do mesmo produto, prefira um teste A/B dentro da pesquisa.</span>}
        {taken && <span style={{ color: 'var(--warning)' }}>Já existe uma pesquisa no ar pra {form.family} ("{taken.name}"). Esta só pode ser ligada depois que aquela for desligada.</span>}
      </div>
      {err && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>Não criou: {err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Criando…' : 'Criar pesquisa'}</button>
        <button className="btn btn-ghost" type="button" onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}

// ---------- teste A/B ----------

/** Confiança arredondada: 99,5% ou mais vira ">99%" (100% nunca é verdade). */
const svConf = (c) => (c >= 0.995 ? '>99%' : fmtPct(c, 0));

function svLift(t) {
  if (!t) return '—';
  return t.lift == null ? 'A tem 0' : `${t.lift >= 0 ? '+' : ''}${fmtPct(t.lift, 0)}`;
}

/** Célula "vs A": diferença na taxa + confiança, com cor só quando passa de 95%. */
function SvVsControl({ t }) {
  if (!t) return <span style={{ color: 'var(--fg5)' }}>—</span>;
  const strong = t.confidence >= 0.95;
  const up = t.lift == null || t.lift > 0;
  const color = strong ? (up ? 'var(--success)' : 'var(--danger)') : t.confidence >= 0.8 ? 'var(--warning)' : 'var(--fg4)';
  return (
    <span style={{ whiteSpace: 'nowrap' }} title={`Confiança de que a diferença é real: ${fmtPct(t.confidence, 1)}`}>
      <span className="mono" style={{ color, fontWeight: strong ? 600 : 400 }}>{svLift(t)}</span>
      <span className="mono" style={{ color: 'var(--fg5)', marginLeft: 6, fontSize: 11 }}>{svConf(t.confidence)}</span>
    </span>
  );
}

/** Leitura em português do resultado: pouca gente, diferença confiável ou ainda não. */
function svVerdict(exp) {
  const ctl = exp.arms.find((a) => a.key === 'A');
  const others = exp.arms.filter((a) => a !== ctl);
  if (!ctl || !others.length) return null;
  const minOpened = Math.min(...exp.arms.map((a) => a.opened));
  if (minOpened < 30) {
    return { tone: 'neutral', text: `Pouca gente ainda: a versão com menos visitas tem ${fmtInt(minOpened)}. Espere pelo menos 30 em cada (o ideal é 100+) antes de decidir.` };
  }
  const conf = (a, k) => (a.vsControl && a.vsControl[k] ? a.vsControl[k].confidence : 0);
  const byBuy = [...others].sort((x, y) => conf(y, 'purchase') - conf(x, 'purchase'))[0];
  const pb = byBuy.vsControl && byBuy.vsControl.purchase;
  if (pb && pb.confidence >= 0.95) {
    const up = pb.lift == null || pb.lift > 0;
    return {
      tone: up ? 'ok' : 'bad',
      text: `${byBuy.key} (${byBuy.name}) ${up ? 'vende mais' : 'vende menos'} que A: ${svLift(pb)} na taxa de compra, com ${svConf(pb.confidence)} de confiança. Dá pra decidir.`,
    };
  }
  const byClick = [...others].sort((x, y) => conf(y, 'click') - conf(x, 'click'))[0];
  const pc = byClick.vsControl && byClick.vsControl.click;
  if (pc && pc.confidence >= 0.95) {
    return { tone: 'warn', text: `${byClick.key} muda o clique no checkout (${svLift(pc)}, ${svConf(pc.confidence)} de confiança), mas a compra ainda não tem diferença confiável. Espere mais vendas.` };
  }
  return { tone: 'neutral', text: `Sem diferença confiável ainda (maior confiança: ${svConf(Math.max(conf(byBuy, 'purchase'), conf(byClick, 'click')))}). Deixe rodando.` };
}

function SvExperimentCard({ exp, previewUrl, admin, onEdit, onChanged }) {
  const [busy, setBusy] = useStateSv(false);
  const [err, setErr] = useStateSv(null);
  const running = exp.status === 'running';
  const verdict = svVerdict(exp);
  const days = Math.max(1, Math.round(((exp.endedAt ? new Date(exp.endedAt) : new Date()) - new Date(exp.startedAt)) / 86400000));
  const totalW = exp.arms.reduce((s, a) => s + a.weight, 0) || 1;

  const stop = async (winner) => {
    const arm = exp.arms.find((a) => a.key === winner);
    const q = winner && winner !== 'A'
      ? `Encerrar o teste e publicar a versão ${winner} (${arm ? arm.name : ''})? A pesquisa passa a usar a configuração dela pra todo mundo.`
      : 'Encerrar o teste e manter a pesquisa como está (versão A)?';
    if (!window.confirm(q)) return;
    setBusy(true); setErr(null);
    try { await window.NSApi.patchSurveyExperiment({ id: exp.id, action: 'stop', winner: winner || 'A' }); onChanged(); }
    catch (e) { setErr(String(e.message || e)); }
    finally { setBusy(false); }
  };

  const toneColor = { ok: 'var(--success)', bad: 'var(--danger)', warn: 'var(--warning)', neutral: 'var(--fg3)' };
  return (
    <div className="panel" style={{ marginBottom: 12, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="panel-title">{exp.name}</span>
            <span className={running ? 'badge ok' : 'badge neutral'}>{running ? 'no ar' : 'encerrado'}</span>
          </div>
          <div className="panel-sub" style={{ fontSize: 11 }}>
            {running ? 'Desde' : 'De'} {fmtDateTime(exp.startedAt)}{exp.endedAt ? ` até ${fmtDateTime(exp.endedAt)}` : ''} · {days} dia{days > 1 ? 's' : ''}
            {!running && (exp.winner && exp.winner !== 'A' ? ` · versão ${exp.winner} publicada` : ' · ficou a versão A')}
            {' · '}conta quem abriu o link durante o teste, de qualquer período
          </div>
        </div>
        {admin && running && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" onClick={onEdit} disabled={busy}>Editar versões</button>
            {exp.arms.filter((a) => a.key !== 'A').map((a) => (
              <button key={a.key} className="btn btn-ghost" onClick={() => stop(a.key)} disabled={busy}>Encerrar e publicar {a.key}</button>
            ))}
            <button className="btn btn-ghost" onClick={() => stop('A')} disabled={busy}>Encerrar e manter A</button>
          </div>
        )}
      </div>
      {err && <div style={{ color: 'var(--danger)', fontSize: 12, padding: '0 14px 8px' }}>Não encerrou: {err}</div>}
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl" style={{ fontSize: 12.5, minWidth: 980 }}>
          <thead>
            <tr>
              <th>Versão</th><th>O que muda</th>
              <th className="num">Abriram</th><th className="num">Concluíram</th><th className="num">Clicaram</th><th className="num">Compraram</th>
              <th className="num">Receita</th><th className="num" title="Receita ÷ quem abriu">Receita / visita</th><th className="num">Nota</th>
              <th className="num" title="Taxa de clique no checkout contra a versão A · confiança">Clique vs A</th>
              <th className="num" title="Taxa de compra contra a versão A · confiança">Compra vs A</th>
            </tr>
          </thead>
          <tbody>
            {exp.arms.map((a) => (
              <tr key={a.key} style={!running && exp.winner === a.key ? { background: 'color-mix(in oklab, var(--success) 6%, transparent)' } : undefined}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <div style={{ fontWeight: 600 }}>{a.key} · {a.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--fg5)' }}>{fmtPct(a.weight / totalW, 0)} do sorteio</div>
                  {running && previewUrl && (
                    <div style={{ fontSize: 11, marginTop: 2 }}>
                      <a href={`${previewUrl}&exp=${encodeURIComponent(exp.id)}&arm=${a.key}&bottles=3`} target="_blank" rel="noopener">ver 2–3</a>
                      {' · '}
                      <a href={`${previewUrl}&exp=${encodeURIComponent(exp.id)}&arm=${a.key}&bottles=6`} target="_blank" rel="noopener">6+</a>
                    </div>
                  )}
                </td>
                <td style={{ maxWidth: 300, whiteSpace: 'normal', fontSize: 12, color: a.changes.length ? 'var(--fg2)' : 'var(--fg5)' }}>
                  {a.key === 'A' ? 'A pesquisa como está' : a.changes.length ? a.changes.join(' · ') : 'Nada (igual à A)'}
                </td>
                <td className="num mono">{fmtInt(a.opened)}</td>
                <td className="num"><SvNumPct n={a.completed} of={a.opened}/></td>
                <td className="num"><SvNumPct n={a.clicked} of={a.opened}/></td>
                <td className="num"><SvNumPct n={a.purchases} of={a.opened} money/></td>
                <td className="num mono">{svUsd(a.revenueUsd)}</td>
                <td className="num mono">{a.opened ? svUsd(a.revenueUsd / a.opened, 2) : '—'}</td>
                <td className="num mono">{a.satisfactionAvg != null ? `${a.satisfactionAvg.toFixed(1)}★` : '—'}</td>
                <td className="num">{a.key === 'A' ? '' : <SvVsControl t={a.vsControl && a.vsControl.click}/>}</td>
                <td className="num">{a.key === 'A' ? '' : <SvVsControl t={a.vsControl && a.vsControl.purchase}/>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {verdict && <div style={{ padding: '10px 14px 12px', fontSize: 12.5, color: toneColor[verdict.tone] }}>{verdict.text}</div>}
    </div>
  );
}

/** Admin: cria ou edita um teste. A = pesquisa como está; B, C, D = cópias editáveis. */
function SvExperimentEditor({ slug, expId, onDone, onCancel }) {
  const [state, setState] = useStateSv({ status: 'loading', error: null, defaults: null, base: null });
  const [name, setName] = useStateSv('');
  const [arms, setArms] = useStateSv([]);
  const [open, setOpen] = useStateSv(1);
  const [busy, setBusy] = useStateSv(false);
  const [err, setErr] = useStateSv(null);
  const editing = Boolean(expId);

  useEffectSv(() => {
    let alive = true;
    Promise.all([window.NSApi.fetchSurveyVariantsAdmin(), editing ? window.NSApi.fetchSurveyExperiments(slug) : Promise.resolve(null)])
      .then(([vd, ed]) => {
        if (!alive) return;
        const v = vd.variants.find((x) => x.slug === slug);
        if (!v) throw new Error('pesquisa não encontrada');
        if (editing) {
          const e = ed.experiments.find((x) => x.id === expId);
          if (!e) throw new Error('teste não encontrado');
          setName(e.name);
          setArms(e.arms.map((a) => ({ name: a.name, weight: String(a.weight), draft: a.config ? svCfgDraft(a.config) : null })));
        } else {
          setName('');
          setArms([{ name: 'Atual', weight: '50', draft: null }, { name: 'Versão B', weight: '50', draft: svCfgDraft(v.config) }]);
        }
        setState({ status: 'ready', error: null, defaults: vd.copyDefaults, base: v.config });
      })
      .catch((e) => alive && setState({ status: 'error', error: String(e.message || e), defaults: null, base: null }));
    return () => { alive = false; };
  }, [slug, expId]);

  const setArm = (i, patch) => setArms((as) => as.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const setDraft = (i) => (fn) => setArms((as) => as.map((a, j) => (j === i ? { ...a, draft: typeof fn === 'function' ? fn(a.draft) : fn } : a)));
  const totalW = arms.reduce((s, a) => s + (Number(a.weight) || 0), 0) || 1;

  const save = async () => {
    setBusy(true); setErr(null);
    const payload = arms.map((a, i) => (i === 0 ? { name: a.name, weight: Number(a.weight) } : { name: a.name, weight: Number(a.weight), config: svCfgOf(a.draft) }));
    try {
      if (editing) await window.NSApi.patchSurveyExperiment({ id: expId, name, arms: payload });
      else await window.NSApi.createSurveyExperiment({ variant: slug, name, arms: payload });
      onDone();
    } catch (e) { setErr(String(e.message || e)); }
    finally { setBusy(false); }
  };

  if (state.status === 'loading') return <div className="panel" style={{ marginBottom: 12 }}><SkelTableRows rows={4} cols={4}/></div>;
  if (state.status === 'error') return <div className="panel" style={{ marginBottom: 12, color: 'var(--danger)', fontSize: 12 }}>Não carregou: {state.error}</div>;
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div className="panel-title">{editing ? 'Editar teste A/B' : 'Novo teste A/B'}</div>
      <div className="panel-sub" style={{ fontSize: 11, marginBottom: 10 }}>
        Cada pessoa é sorteada na primeira vez que abre o link e fica sempre na mesma versão. Quem já tinha começado a responder antes do teste fica de fora.
        {editing && ' Editar com o teste no ar vale pra quem abrir daqui pra frente — mudar o que está sendo testado no meio embaralha o resultado; prefira só corrigir link ou peso.'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
        <label><span style={SV_LABEL}>Nome do teste</span><input style={SV_INPUT} value={name} onChange={(e) => setName(e.target.value)} placeholder="Assinatura US$ 59 × US$ 69"/></label>
      </div>
      <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
        {arms.map((a, i) => (
          <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <span className="mono" style={{ fontWeight: 700, fontSize: 14, alignSelf: 'center', width: 18 }}>{'ABCD'[i]}</span>
              <label style={{ flex: 1, minWidth: 160 }}><span style={SV_LABEL}>Nome da versão</span><input style={SV_INPUT} value={a.name} onChange={(e) => setArm(i, { name: e.target.value })}/></label>
              <label style={{ width: 110 }}><span style={SV_LABEL}>Peso no sorteio</span><input style={SV_INPUT} inputMode="numeric" value={a.weight} onChange={(e) => setArm(i, { weight: e.target.value })}/></label>
              <span className="mono" style={{ fontSize: 12, color: 'var(--fg4)', paddingBottom: 8, width: 44 }}>{fmtPct((Number(a.weight) || 0) / totalW, 0)}</span>
              {i === 0
                ? <span style={{ fontSize: 12, color: 'var(--fg4)', paddingBottom: 8 }}>A pesquisa como está (edite em Configurar)</span>
                : <button className="btn btn-ghost" onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i}>{open === i ? 'Fechar' : 'Editar o que muda'}</button>}
              {i > 1 && !editing && (
                <button className="icon-btn" onClick={() => { setArms(arms.filter((_, j) => j !== i)); setOpen(1); }} aria-label={`Remover versão ${'ABCD'[i]}`} title="Remover"><Icon name="x" size={12}/></button>
              )}
            </div>
            {i > 0 && open === i && a.draft && (
              <div style={{ marginTop: 4 }}>
                <SvConfigFields draft={a.draft} onChange={setDraft(i)} defaults={state.defaults} armMode/>
              </div>
            )}
          </div>
        ))}
      </div>
      {!editing && arms.length < 4 && (
        <button className="btn btn-ghost" style={{ marginTop: 8 }}
          onClick={() => { setArms([...arms, { name: `Versão ${'ABCD'[arms.length]}`, weight: '50', draft: svCfgDraft(state.base) }]); setOpen(arms.length); }}>
          + Versão {'ABCD'[arms.length]}
        </button>
      )}
      {err && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 10 }}>Não salvou: {err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn" onClick={save} disabled={busy || !name.trim()}>{busy ? 'Salvando…' : editing ? 'Salvar teste' : 'Começar teste'}</button>
        <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancelar</button>
      </div>
    </div>
  );
}

function SvExperiments({ d, current, admin, onChanged }) {
  const [editor, setEditor] = useStateSv(null); // null | 'new' | id
  const running = d.experiments.find((e) => e.status === 'running');
  const past = d.experiments.filter((e) => e.status !== 'running');
  const done = () => { setEditor(null); onChanged(); };
  return (
    <div>
      {editor && <SvExperimentEditor slug={d.variant} expId={editor === 'new' ? null : editor} onDone={done} onCancel={() => setEditor(null)}/>}
      {!editor && running && <SvExperimentCard exp={running} previewUrl={current.previewUrl} admin={admin} onEdit={() => setEditor(running.id)} onChanged={onChanged}/>}
      {!editor && !running && (
        <div className="panel" style={{ marginBottom: 12 }}>
          <div className="panel-title">Nenhum teste no ar</div>
          <div className="panel-sub" style={{ fontSize: 11, marginBottom: admin ? 10 : 0 }}>
            Um teste compara versões da mesma pesquisa: preço, cupom, texto, foto. Cada pessoa é sorteada ao abrir o link e fica sempre na mesma versão; a aba mostra quem conclui, clica e compra em cada uma, e a confiança da diferença.
          </div>
          {admin && <button className="btn" onClick={() => setEditor('new')}>Novo teste A/B</button>}
        </div>
      )}
      {past.length > 0 && (<>
        <div className="panel-eyebrow" style={{ margin: '18px 0 8px' }}>Testes encerrados</div>
        {past.map((e) => <SvExperimentCard key={e.id} exp={e} admin={false} onChanged={onChanged}/>)}
      </>)}
    </div>
  );
}

// ---------- materiais e link de teste ----------

const SV_NA_KEY = 'northaffiliates.network.apiKey';
const svNameKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Admin: chave e catálogo da rede no NorthAffiliates (produtos, mockups dos kits, VSLs). */
function SvNetworkCatalog({ productName }) {
  const [open, setOpen] = useStateSv(false);
  const [keyInfo, setKeyInfo] = useStateSv({ status: 'loading', value: null });
  const [keyInput, setKeyInput] = useStateSv('');
  const [cat, setCat] = useStateSv({ status: 'idle', data: null, error: null });
  const [busy, setBusy] = useStateSv(false);

  const loadKey = () => window.NSApi.adminListIntegrationSettings()
    .then((d) => {
      const row = (d.settings || []).find((x) => x.key === SV_NA_KEY);
      const env = d.envOverrides && d.envOverrides[SV_NA_KEY];
      setKeyInfo({ status: 'ready', value: env ? 'definida por env' : row ? row.value : null });
    })
    .catch(() => setKeyInfo({ status: 'ready', value: null }));
  useEffectSv(() => { if (open) loadKey(); }, [open]);

  const loadCatalog = () => {
    setCat({ status: 'loading', data: null, error: null });
    window.NSApi.fetchNetworkCatalog()
      .then((data) => setCat({ status: 'ready', data, error: null }))
      .catch((e) => setCat({ status: 'error', data: null, error: e.code === 'not_configured' ? 'Cole a chave da API primeiro.' : String(e.message || e) }));
  };
  const saveKey = async () => {
    setBusy(true);
    try { await window.NSApi.adminSaveIntegrationSetting(SV_NA_KEY, keyInput.trim()); setKeyInput(''); await loadKey(); loadCatalog(); }
    catch (e) { setCat({ status: 'error', data: null, error: String(e.message || e) }); }
    finally { setBusy(false); }
  };

  const mine = svNameKey(productName);
  const products = cat.data ? [...cat.data.products].sort((a, b) => (svNameKey(b.name) === mine) - (svNameKey(a.name) === mine) || a.name.localeCompare(b.name)) : [];
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div className="panel-title">Materiais do NorthAffiliates</div>
          <div className="panel-sub" style={{ fontSize: 11 }}>Catálogo da rede (chave só de leitura): foto do produto, mockups dos kits, versões da VSL e materiais. Os links das imagens valem 30 minutos.</div>
        </div>
        <button className="btn btn-ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? 'Fechar' : 'Abrir'}</button>
      </div>
      {open && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--fg4)' }}>Chave da API:</span>
            <span className="mono" style={{ fontSize: 12 }}>{keyInfo.status === 'loading' ? '…' : keyInfo.value || 'não configurada'}</span>
            <input type="password" style={{ ...SV_INPUT, width: 280 }} value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder="nsk_…" aria-label="Chave da API do NorthAffiliates"/>
            <button className="btn btn-ghost" onClick={saveKey} disabled={busy || !/^nsk_\S{10,}$/.test(keyInput.trim())}>Salvar chave</button>
            <button className="btn btn-ghost" onClick={loadCatalog} disabled={cat.status === 'loading'}>{cat.status === 'loading' ? 'Lendo…' : 'Ver catálogo'}</button>
          </div>
          {cat.status === 'error' && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>{cat.error}</div>}
          {cat.status === 'ready' && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11.5, color: 'var(--fg5)', marginBottom: 6 }}>
                Rede {cat.data.network || '—'} · {fmtInt(products.length)} produtos{!products.some((p) => svNameKey(p.name) === mine) && ` · ${productName} não está no catálogo (a foto vem do Atlas)`}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl" style={{ fontSize: 12.5, minWidth: 680 }}>
                  <thead><tr><th style={{ width: 52 }}/><th>Produto</th><th>Nicho</th><th>Mockups de kit</th><th className="num">Versões da VSL</th><th>Materiais</th></tr></thead>
                  <tbody>
                    {products.map((p) => (
                      <tr key={p.id}>
                        <td>{p.image ? <img src={p.image} alt="" width="40" height="40" loading="lazy" style={{ objectFit: 'contain', display: 'block' }}/> : null}</td>
                        <td style={{ fontWeight: 600 }}>{p.name}{svNameKey(p.name) === mine && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--accent)' }}>esta pesquisa</span>}{p.status === 'paused' && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--warning)' }}>pausado</span>}</td>
                        <td>{p.niche || '—'}</td>
                        <td>{p.kits.length ? p.kits.map((k) => <a key={k.packSize} href={k.url} target="_blank" rel="noopener" style={{ marginRight: 8 }}>{k.packSize} frascos</a>) : '—'}</td>
                        <td className="num mono">{fmtInt(p.offers)}</td>
                        <td style={{ color: 'var(--fg4)' }}>{Object.entries(p.materials).map(([t, n]) => `${t} ${n}`).join(' · ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Admin: gera um link de teste pra percorrer a pesquisa de verdade (grava, fora dos números). */
function SvTestInvite({ variant, experiment, onCreated }) {
  const [form, setForm] = useStateSv({ email: '', firstName: 'John', bottles: '3', arm: '' });
  const [busy, setBusy] = useStateSv(false);
  const [out, setOut] = useStateSv(null);
  const [err, setErr] = useStateSv(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null); setOut(null);
    try {
      const r = await window.NSApi.createSurveyTestInvite(variant, { email: form.email, firstName: form.firstName, bottles: Number(form.bottles), arm: form.arm || undefined });
      setOut(r); onCreated();
    } catch (e2) { setErr(String(e2.message || e2)); }
    finally { setBusy(false); }
  };
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div className="panel-title">Testar a pesquisa</div>
      <div className="panel-sub" style={{ fontSize: 11, marginBottom: 10 }}>Gera um link de verdade (grava respostas e entra na fila do CS se for o caso), marcado como teste: só aparece com "Incluir testes" ligado.</div>
      <form onSubmit={submit} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="email" required placeholder="e-mail" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={{ minWidth: 220 }} aria-label="E-mail do teste"/>
        <input placeholder="primeiro nome" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} style={{ width: 140 }} aria-label="Primeiro nome"/>
        <select value={form.bottles} onChange={(e) => setForm({ ...form, bottles: e.target.value })} aria-label="Frascos comprados">
          <option value="2">2 frascos</option><option value="3">3 frascos</option><option value="6">6 frascos (plano completo)</option>
        </select>
        {experiment && (
          <select value={form.arm} onChange={(e) => setForm({ ...form, arm: e.target.value })} aria-label="Versão do teste A/B">
            <option value="">Versão: sortear</option>
            {experiment.arms.map((a) => <option key={a.key} value={a.key}>Versão {a.key} · {a.name}</option>)}
          </select>
        )}
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Gerando…' : 'Gerar link de teste'}</button>
      </form>
      {err && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>Não gerou: {err}</div>}
      {out && (
        <div style={{ fontSize: 12.5, marginTop: 10 }}>
          Link do cliente: <a href={out.link} target="_blank" rel="noopener" className="mono">{out.link}</a>
          {out.arm && <span style={{ color: 'var(--fg4)' }}> · versão {out.arm}</span>}
        </div>
      )}
    </div>
  );
}

// ---------- página ----------

const SV_SECTIONS = [
  { id: 'geral', label: 'Visão geral' },
  { id: 'vendas', label: 'Vendas' },
  { id: 'respostas', label: 'Respostas' },
  { id: 'ab', label: 'Testes A/B' },
  { id: 'cs', label: 'CS' },
  { id: 'config', label: 'Configurar', admin: true },
];

function svSavedSection() {
  try { return localStorage.getItem(SV_SECTION_KEY) || 'geral'; } catch { return 'geral'; }
}

function SvAnswerSales({ groups }) {
  const [q, setQ] = useStateSv(null);
  if (!groups.length) return <div style={{ color: 'var(--fg5)', fontSize: 12 }}>Ninguém concluiu no período.</div>;
  const g = groups.find((x) => x.id === q) || groups[0];
  return (
    <div>
      <div className="seg" style={{ marginBottom: 10, flexWrap: 'wrap', height: 'auto' }}>
        {groups.map((x) => <button key={x.id} className={x.id === g.id ? 'is-active' : ''} onClick={() => setQ(x.id)} style={{ height: 28 }}>{x.title.split(' (')[0]}</button>)}
      </div>
      <SvSalesTable rows={g.rows} baseLabel="Responderam" cols={['base', 'clicked', 'purchases', 'revenue', 'rpv']}/>
    </div>
  );
}

function SurveysPage({ filters, user }) {
  const admin = user?.role === 'ADMIN';
  const [variant, setVariant] = useStateSv(null);
  const [tests, setTests] = useStateSv(false);
  const [tick, setTick] = useStateSv(0);
  const [section, setSectionState] = useStateSv(svSavedSection);
  const [creating, setCreating] = useStateSv(false);
  const [state, setState] = useStateSv({ status: 'loading', data: null, error: null });

  const setSection = (id) => {
    setSectionState(id);
    try { localStorage.setItem(SV_SECTION_KEY, id); } catch { /* sem storage: só não lembra */ }
  };
  const refresh = () => setTick((n) => n + 1);

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
  const sections = SV_SECTIONS.filter((s) => !s.admin || admin);
  const sec = sections.some((s) => s.id === section) ? section : 'geral';
  const csOpen = d.csQueue.filter((r) => r.status !== 'resolvido').length;
  const running = d.experiments.find((e) => e.status === 'running');
  const hasArms = d.recent.some((r) => r.arm);

  const kpis = [
    { l: 'Convites', v: fmtInt(k.invites), s: `${fmtInt(k.sent)} enviados` },
    { l: 'Abriram', v: fmtInt(k.opened), s: k.invites ? `${fmtPct(k.opened / k.invites, 0)} dos convites` : '—' },
    { l: 'Concluíram', v: fmtInt(k.completed), s: k.opened ? `${fmtPct(k.completed / k.opened, 0)} de quem abriu` : '—' },
    { l: 'Nota média', v: k.satisfactionAvg != null ? `${k.satisfactionAvg.toFixed(1)}★` : '—', s: 'de 1 a 5' },
    { l: 'Clicaram no checkout', v: fmtInt(k.checkoutClicks), s: k.completed ? `${fmtPct(k.checkoutClicks / k.completed, 0)} de quem concluiu` : '—' },
    { l: 'Compraram', v: fmtInt(k.purchases), s: k.purchases ? `${svUsd(k.revenueUsd)} · ${fmtPct(k.purchases / Math.max(1, k.opened), 1)} de quem abriu` : 'venda volta pelo postback', money: true },
  ];

  return (
    <div className="page-in" style={{ opacity: state.status === 'loading' ? 0.6 : 1, transition: 'opacity .15s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {d.variants.map((v) => (
          <button key={v.slug} className={v.slug === d.variant ? 'chip is-active' : 'chip'} onClick={() => { setVariant(v.slug); setCreating(false); }}
            title={`checkin.healthnwellnes.com/${v.slug}`}>
            {v.name}
            {!v.active && <span style={{ marginLeft: 6, fontSize: 10.5, color: 'var(--fg5)' }}>desligada</span>}
            {v.experiment && <span style={{ marginLeft: 6, fontSize: 10.5, color: 'var(--accent)' }}>A/B</span>}
          </button>
        ))}
        {admin && <button className="btn btn-ghost" onClick={() => setCreating((c) => !c)} aria-expanded={creating}>+ Nova pesquisa</button>}
        <div style={{ flex: 1 }}/>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--fg4)', cursor: 'pointer' }}>
          <input type="checkbox" checked={tests} onChange={(e) => setTests(e.target.checked)}/> Incluir testes
        </label>
        <a className="btn btn-ghost" href={`${current.previewUrl}&bottles=3`} target="_blank" rel="noopener" title="Quem comprou 2 ou 3 frascos: copy de completar o plano de 6 meses">
          <Icon name="external-link" size={12}/> Ver página · 2–3 frascos
        </a>
        <a className="btn btn-ghost" href={`${current.previewUrl}&bottles=6`} target="_blank" rel="noopener" title="Quem comprou 6 ou mais: copy de uso sem constância (doses perdidas)">
          <Icon name="external-link" size={12}/> 6+ frascos
        </a>
      </div>

      {creating && admin && (
        <SvNewSurvey variants={d.variants} from={d.variant} onCancel={() => setCreating(false)}
          onCreated={(slug) => { setCreating(false); setVariant(slug); setSection('config'); refresh(); }}/>
      )}

      <div className="seg" style={{ marginBottom: 12, flexWrap: 'wrap', height: 'auto' }} role="tablist" aria-label="Seções da aba Pesquisas">
        {sections.map((s) => (
          <button key={s.id} role="tab" aria-selected={s.id === sec} className={s.id === sec ? 'is-active' : ''} onClick={() => setSection(s.id)} style={{ height: 28 }}>
            {s.label}{s.id === 'cs' && csOpen ? ` (${csOpen})` : ''}{s.id === 'ab' && running ? ' · no ar' : ''}
          </button>
        ))}
      </div>

      {sec === 'geral' && (<>
        {!current.active && (
          <ReadState kind="parcial" title="Pesquisa desligada">Não gera convites nem abre pro cliente. {admin ? 'Revise em Configurar e marque "Pesquisa no ar".' : ''}</ReadState>
        )}
        {(!current.checkoutReady.assinatura || !current.checkoutReady.kits) && (
          <ReadState kind="parcial" title="Ofertas da Vupim ainda não cadastradas">
            {!current.checkoutReady.assinatura && !current.checkoutReady.kits
              ? 'Sem os links da assinatura e dos kits, a pesquisa termina no agradecimento e o atalho "Reorder now" não aparece.'
              : !current.checkoutReady.assinatura
                ? 'Falta o link da assinatura mensal: quem pedir "1 frasco por mês" recebe o kit.'
                : 'Faltam os links dos kits: todo mundo recebe a assinatura mensal, sem cupom.'}
            {current.checkoutReady.kits > 0 && !current.checkoutReady.cupons && ' Sem códigos de cupom, quem tem objeção de preço recebe o kit no preço de recompra.'}
          </ReadState>
        )}
        {running && (
          <div className="panel" style={{ marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="badge ok">A/B no ar</span>
            <span style={{ fontSize: 12.5, flex: 1 }}>{running.name} · {running.arms.map((a) => `${a.key}: ${fmtInt(a.opened)} visitas, ${fmtInt(a.purchases)} compras`).join(' · ')}</span>
            <button className="btn btn-ghost" onClick={() => setSection('ab')}>Ver resultado</button>
          </div>
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

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 12 }}>
          <SvPanel title="Do convite à compra" sub="Cada passo: quantas pessoas, % do passo anterior e % dos convites. Abriram é sobre os enviados (ou os convites, se ninguém marcou envio).">
            <SvFunnel k={k}/>
          </SvPanel>
          <SvPanel title="Dia a dia" sub="Por dia do evento (BRT), dos convites do período. Passando de 45 dias, agrupa por semana.">
            <SvDaily rows={d.daily}/>
          </SvPanel>
        </div>

        {d.compare.length > 1 && (
          <SvPanel title="Todas as pesquisas" sub="Convites criados no período, por pesquisa. % sobre quem abriu.">
            <SvSalesTable rows={d.compare.map((r) => ({ ...r, label: r.active ? r.label : `${r.label} (desligada)` }))} baseLabel="Abriram"
              cols={['invited', 'base', 'completed', 'clicked', 'purchases', 'revenue', 'rpv']}/>
          </SvPanel>
        )}
      </>)}

      {sec === 'vendas' && (<>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))', gap: 12 }}>
          <SvPanel title="Tela final → venda" sub="Qual oferta a pesquisa mostrou no fim e quanto cada uma vendeu. % sobre quem viu aquela tela.">
            <SvSalesTable rows={d.outcomeSales} baseLabel="Viram" cols={['base', 'clicked', 'purchases', 'revenue', 'rpv']}/>
          </SvPanel>
          <SvPanel title="Botão clicado → venda" sub="Em qual checkout a pessoa clicou por último (inclui quem trocou de plano em “See all plans”). % sobre quem clicou.">
            <SvSalesTable rows={d.offerSales} baseLabel="Clicaram" cols={['base', 'purchases', 'revenue', 'rpv']} empty="Ninguém clicou no checkout no período."/>
          </SvPanel>
          <SvPanel title="Público" sub="Quem comprou 2–3 frascos (copy de completar o plano) × 6+ (copy de constância). % sobre quem abriu.">
            <SvSalesTable rows={d.segments} baseLabel="Abriram" cols={['invited', 'base', 'completed', 'clicked', 'purchases', 'revenue']}/>
          </SvPanel>
          <SvPanel title="Quando abriu" sub="Quantos dias faltavam pro estoque acabar quando a pessoa abriu o link — mostra o melhor momento de disparar. % sobre quem abriu.">
            <SvSalesTable rows={d.timing} baseLabel="Abriram" cols={['base', 'completed', 'clicked', 'purchases', 'revenue']}/>
          </SvPanel>
          <SvPanel title="Canal" sub="Por onde o convite saiu (quem dispara marca o canal). % sobre quem abriu.">
            <SvSalesTable rows={d.channels} baseLabel="Abriram" cols={['invited', 'base', 'completed', 'clicked', 'purchases', 'revenue']}/>
          </SvPanel>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--fg5)', marginTop: -4 }}>
          Venda = pedido aprovado com o rastreio da pesquisa (src=qz_…). A receita soma todos os pedidos aprovados com esse rastreio, inclusive renovações da assinatura se a Vupim repassar o mesmo rastreio.
        </div>
      </>)}

      {sec === 'respostas' && (<>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12 }}>
          <SvPanel title="Onde as pessoas param" sub="Quantos chegaram em cada pergunta. % sobre quem abriu o link.">
            <SvBars items={d.steps} total={k.opened}/>
          </SvPanel>
          <SvPanel title="Tela final" sub="Decidida pelas respostas: CS (nota 1, médico, mal-estar) → assinatura → kit com cupom (10/15/20% pela objeção) → kit no preço de recompra.">
            <SvBars items={d.outcomes} total={k.completed}/>
          </SvPanel>
          <SvPanel title="Satisfação" sub="Pergunta 2. Nota 1 vai pro CS sem oferta; nota 2 recebe o cupom de 20%.">
            <SvBars items={d.satisfaction} total={d.satisfaction.reduce((s, i) => s + i.count, 0)}/>
          </SvPanel>
          <SvPanel title="Por que não levou os 6" sub="Pergunta 1 — o motivo da compra menor (só quem comprou 2 ou 3).">
            <SvBars items={d.q1} total={d.steps.find((s) => s.id === 'q1')?.count || 0}/>
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

        <SvPanel title="Resposta → venda" sub="De quem concluiu, quanto cada resposta clicou e comprou. Mostra quem compra e quem só reclama.">
          <SvAnswerSales groups={d.answerSales}/>
        </SvPanel>

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
                      <tr><th>Cliente</th><th className="num">Frascos</th>{hasArms && <th>Versão</th>}<th className="num">Nota</th><th>Tela final</th><th>Comentário</th><th>Checkout</th><th>Concluiu</th></tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id}>
                          <td><div style={{ fontWeight: 600 }}>{r.firstName || '—'}</div><div style={{ color: 'var(--fg4)', fontSize: 11.5 }}>{r.email}</div></td>
                          <td className="num mono">{r.bottles}</td>
                          {hasArms && <td className="mono">{r.arm || '—'}</td>}
                          <td className="num mono">{r.satisfaction != null ? `${r.satisfaction}★` : '—'}</td>
                          <td>{r.outcome ? svOutcome(r) : <span style={{ color: 'var(--fg5)' }}>não terminou</span>}</td>
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
      </>)}

      {sec === 'ab' && <SvExperiments key={d.variant} d={d} current={current} admin={admin} onChanged={refresh}/>}

      {sec === 'cs' && <SvCsQueue rows={d.csQueue} onChanged={refresh}/>}

      {sec === 'config' && admin && (<>
        <SvVariantEditor key={d.variant} slug={d.variant} experiment={current.experiment} onSaved={refresh}/>
        <SvTestInvite variant={d.variant} experiment={current.experiment} onCreated={() => { setTests(true); refresh(); }}/>
        <SvNetworkCatalog productName={current.name.split(' · ')[0]}/>
      </>)}
    </div>
  );
}

Object.assign(window, { SurveysPage });
