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
const SV_OUTCOME_LABEL = { cs: 'CS liga', recorrencia: 'Assinatura', oferta: 'Kit', cupom: 'Kit + cupom', obrigado: 'Só agradecimento' };
const svOutcome = (r) => (r.outcome === 'cupom' && r.couponPct ? `Kit + cupom ${r.couponPct}%` : SV_OUTCOME_LABEL[r.outcome] || r.outcome);

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

const SV_INPUT = {
  padding: '7px 10px', fontSize: 12.5, color: 'var(--fg1)', background: 'var(--bg)',
  border: '1px solid var(--border)', borderRadius: 6, minWidth: 0, width: '100%',
};
const SV_LABEL = { display: 'block', fontSize: 11, color: 'var(--fg4)', marginBottom: 3 };
const SV_H = { fontSize: 12, fontWeight: 600, color: 'var(--fg2)', margin: '18px 0 8px' };
const svNum = (v) => (v === '' || v == null ? null : Number(v));

function svDraftOf(v) {
  const c = v.config || {};
  const sub = (c.offers && c.offers.assinatura) || {};
  return {
    name: v.name, active: v.active,
    productName: c.productName || '', accent: c.accent || '#2f6fde', image: c.image || '',
    eligible: (c.eligibleBottles || [2, 3]).join(', '), fullPlanFrom: c.fullPlanFrom == null ? '' : String(c.fullPlanFrom),
    sub: { url: sub.url || '', monthlyPrice: sub.monthlyPrice == null ? '' : String(sub.monthlyPrice), firstPrice: sub.firstPrice != null && sub.firstPrice !== sub.monthlyPrice ? String(sub.firstPrice) : '' },
    kits: Object.entries((c.offers && c.offers.kits) || {}).map(([n, k]) => ({ n, url: k.url || '', price: String(k.price ?? ''), every: k.everyMonths == null ? '' : String(k.everyMonths) })),
    fronts: Object.entries(c.frontPrices || {}).map(([n, p]) => ({ n, price: String(p) })),
    coupons: (c.coupons || []).map((x) => ({ pct: String(x.pct), code: x.code || '', kits: x.kits })),
    couponValidDays: String(c.couponValidDays ?? 7),
    // Campos sem formulário (opções da pergunta 4 etc.) passam como estão.
    rest: { planBottles: c.planBottles, daysPerBottle: c.daysPerBottle, trackingParam: c.trackingParam, couponParam: c.couponParam, q4: c.q4 },
    copy: c.copy ? JSON.stringify(c.copy, null, 2) : '',
  };
}

function svConfigOf(d) {
  const copy = d.copy.trim() ? JSON.parse(d.copy) : null;
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
    ...(copy ? { copy } : {}),
  };
}

/** Admin: links, preços, ciclo de cobrança, cupons e frases da pesquisa. Salvar publica na hora. */
function SvVariantEditor({ slug, onSaved }) {
  const [open, setOpen] = useStateSv(false);
  const [state, setState] = useStateSv({ status: 'idle', error: null, version: null });
  const [draft, setDraft] = useStateSv(null);
  const [saving, setSaving] = useStateSv(false);
  const [msg, setMsg] = useStateSv(null);

  useEffectSv(() => {
    if (!open) return undefined;
    let alive = true;
    setState({ status: 'loading', error: null, version: null });
    window.NSApi.fetchSurveyVariantsAdmin()
      .then((d) => {
        if (!alive) return;
        const v = d.variants.find((x) => x.slug === slug);
        if (!v) { setState({ status: 'error', error: 'pesquisa não encontrada', version: null }); return; }
        setDraft(svDraftOf(v));
        setState({ status: 'ready', error: null, version: v.version });
      })
      .catch((e) => alive && setState({ status: 'error', error: String(e.message || e), version: null }));
    return () => { alive = false; };
  }, [slug, open]);

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const setRow = (key, i, patch) => setDraft((d) => ({ ...d, [key]: d[key].map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const addRow = (key, row) => setDraft((d) => ({ ...d, [key]: [...d[key], row] }));
  const delRow = (key, i) => setDraft((d) => ({ ...d, [key]: d[key].filter((_, j) => j !== i) }));

  const save = async () => {
    let config;
    try { config = svConfigOf(draft); } catch { setMsg({ err: 'Textos: o JSON está inválido.' }); return; }
    setSaving(true); setMsg(null);
    try {
      const r = await window.NSApi.saveSurveyVariant(slug, { name: draft.name, active: draft.active, config });
      setState((s) => ({ ...s, version: r.variant.version }));
      setDraft(svDraftOf(r.variant));
      setMsg({ ok: `Salvo (versão ${r.variant.version}). A página já usa os valores novos.` });
      onSaved();
    } catch (e) { setMsg({ err: String(e.message || e) }); }
    finally { setSaving(false); }
  };

  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div className="panel-title">Ofertas e textos</div>
          <div className="panel-sub" style={{ fontSize: 11 }}>Links de checkout, preços, ciclo de cobrança, cupons e frases da página. Salvar publica na hora.</div>
        </div>
        <button className="btn btn-ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? 'Fechar' : 'Editar'}</button>
      </div>
      {open && state.status === 'loading' && <div style={{ marginTop: 12 }}><SkelTableRows rows={4} cols={4}/></div>}
      {open && state.status === 'error' && <div style={{ marginTop: 12, color: 'var(--danger)', fontSize: 12 }}>Não carregou: {state.error}</div>}
      {open && state.status === 'ready' && draft && (
        <div style={{ marginTop: 6 }}>
          <div style={SV_H}>Página</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            <label><span style={SV_LABEL}>Nome da pesquisa (só no dash)</span><input style={SV_INPUT} value={draft.name} onChange={(e) => set({ name: e.target.value })}/></label>
            <label><span style={SV_LABEL}>Nome do produto na página</span><input style={SV_INPUT} value={draft.productName} onChange={(e) => set({ productName: e.target.value })}/></label>
            <label><span style={SV_LABEL}>Cor de destaque</span>
              <span style={{ display: 'flex', gap: 6 }}>
                <input type="color" value={/^#[0-9a-f]{6}$/i.test(draft.accent) ? draft.accent : '#2f6fde'} onChange={(e) => set({ accent: e.target.value })} aria-label="Escolher cor" style={{ width: 36, height: 32, padding: 0, border: 'none', background: 'none' }}/>
                <input style={SV_INPUT} value={draft.accent} onChange={(e) => set({ accent: e.target.value })}/>
              </span>
            </label>
            <label><span style={SV_LABEL}>Foto dos frascos</span><input style={SV_INPUT} value={draft.image} onChange={(e) => set({ image: e.target.value })} placeholder="/survey-assets/produto.webp"/></label>
            <label><span style={SV_LABEL}>Recebe quem comprou (frascos)</span><input style={SV_INPUT} value={draft.eligible} onChange={(e) => set({ eligible: e.target.value })} placeholder="2, 3"/></label>
            <label><span style={SV_LABEL}>E quem comprou a partir de (frascos)</span><input style={SV_INPUT} inputMode="numeric" value={draft.fullPlanFrom} onChange={(e) => set({ fullPlanFrom: e.target.value })} placeholder="6 (vazio = não)"/></label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'end', fontSize: 12.5 }}>
              <input type="checkbox" checked={draft.active} onChange={(e) => set({ active: e.target.checked })}/> Pesquisa no ar
            </label>
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
                    <td className="num mono">{Number(r.n) > 0 && Number(r.price) > 0 ? fmtCurrency(Number(r.price) / Number(r.n), 'USD', 2) : '—'}</td>
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

          <div style={SV_H}>Frases reescritas <span style={{ fontWeight: 400, color: 'var(--fg5)' }}>· opcional; chave + "@completo" vale só pra quem comprou 6+</span></div>
          <textarea style={{ ...SV_INPUT, fontFamily: 'var(--f-mono)', minHeight: 110, resize: 'vertical' }} value={draft.copy} onChange={(e) => set({ copy: e.target.value })}
            placeholder={'{\n  "end.oferta.title": "Don\'t stop at month {frascos}",\n  "end.oferta.title@completo": "Make up for the days you missed"\n}'} aria-label="Frases reescritas (JSON)"/>

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
function SvTestInvite({ variant, onCreated }) {
  const [form, setForm] = useStateSv({ email: '', firstName: 'John', bottles: '3' });
  const [busy, setBusy] = useStateSv(false);
  const [out, setOut] = useStateSv(null);
  const [err, setErr] = useStateSv(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null); setOut(null);
    try {
      const r = await window.NSApi.createSurveyTestInvite(variant, { email: form.email, firstName: form.firstName, bottles: Number(form.bottles) });
      setOut(r); onCreated();
    } catch (e2) { setErr(String(e2.message || e2)); }
    finally { setBusy(false); }
  };
  // Enquanto o DNS do domínio público não existe, o mesmo link abre pelo dash.
  const viaDash = out ? `/api/survey/page?slug=${encodeURIComponent(variant)}&t=${encodeURIComponent(out.link.split('/').pop())}` : null;
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
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Gerando…' : 'Gerar link de teste'}</button>
      </form>
      {err && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>Não gerou: {err}</div>}
      {out && (
        <div style={{ fontSize: 12.5, marginTop: 10, display: 'grid', gap: 4 }}>
          <div>Link do cliente: <a href={out.link} target="_blank" rel="noopener" className="mono">{out.link}</a></div>
          <div style={{ color: 'var(--fg4)' }}>Se o domínio ainda não abrir: <a href={viaDash} target="_blank" rel="noopener">abrir o mesmo link pelo dash</a></div>
        </div>
      )}
    </div>
  );
}

function SurveysPage({ filters, user }) {
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
        <a className="btn btn-ghost" href={`${current.previewUrl}&bottles=3`} target="_blank" rel="noopener" title="Quem comprou 2 ou 3 frascos: copy de completar o plano de 6 meses">
          <Icon name="external-link" size={12}/> Ver página · 2–3 frascos
        </a>
        <a className="btn btn-ghost" href={`${current.previewUrl}&bottles=6`} target="_blank" rel="noopener" title="Quem comprou 6 ou mais: copy de uso sem constância (doses perdidas)">
          <Icon name="external-link" size={12}/> 6+ frascos
        </a>
      </div>

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
        <SvPanel title="Tela final" sub="Decidida pelas respostas: CS (nota 1, médico, mal-estar) → assinatura → kit com cupom (10/15/20% pela objeção) → kit no preço de recompra.">
          <SvBars items={d.outcomes} total={k.completed}/>
        </SvPanel>
        <SvPanel title="Satisfação" sub="Pergunta 2. Nota 1 vai pro CS sem oferta; nota 2 recebe o cupom de 20%.">
          <SvBars items={d.satisfaction} total={d.satisfaction.reduce((s, i) => s + i.count, 0)}/>
        </SvPanel>
        <SvPanel title="Por que não levou os 6" sub="Pergunta 1 — o motivo da compra menor (só quem comprou 2 ou 3).">
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

      {user?.role === 'ADMIN' && (<>
        <SvVariantEditor slug={d.variant} onSaved={() => setTick((n) => n + 1)}/>
        <SvNetworkCatalog productName={current.name.split(' · ')[0]}/>
        <SvTestInvite variant={d.variant} onCreated={() => { setTests(true); setTick((n) => n + 1); }}/>
      </>)}

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
    </div>
  );
}

Object.assign(window, { SurveysPage });
