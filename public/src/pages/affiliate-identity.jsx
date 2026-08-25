/* global React, Icon, fmtCurrency, fmtInt, fmtPct, SkelDrawerLoading, Sparkline, CpaStatusChip, platBadge, avatarColor, initials */
/* Identidade unificada de afiliados — componentes compartilhados pelas
   abas Afiliados e Análise:
     AaContactForm             formulário de contato (nome/e-mail/telefone/notas)
     AffiliateIdentityDrawer   tela de unificação (sugestões, parceiros, vínculo manual)
     AffiliatePartnerDrawer    desempenho de um parceiro POR PLATAFORMA (aba Afiliados)
   API: /api/admin/affiliate-identity (admin). */

const { useState: useStateAI, useEffect: useEffectAI, useMemo: useMemoAI } = React;

const AI_INPUT = { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', color: 'var(--fg1)', fontFamily: 'var(--f-body)', fontSize: 12, width: '100%' };
const AI_AV = { display: 'inline-grid', placeItems: 'center', borderRadius: '50%', color: '#fff', fontWeight: 700, fontFamily: 'var(--f-mono)', flex: 'none' };
const AI_PLAT = { clickbank: 'CB', digistore24: 'D24', buygoods: 'BG', cartpanda: 'CP', jvzoo: 'JVZ' };
const AI_PLAT_NAMES = { clickbank: 'ClickBank', digistore24: 'Digistore24', buygoods: 'BuyGoods', cartpanda: 'Cartpanda', jvzoo: 'JVZoo' };
// Origem do afiliado (de onde ele veio) — vive no parceiro.
const AI_ORIGIN = {
  INDICACAO:  { label: 'Indicação',  icon: 'users',  refLabel: 'Quem indicou', refPlaceholder: 'nome de quem indicou' },
  INSTAGRAM:  { label: 'Instagram',  icon: 'link',   refLabel: '@perfil (opcional)', refPlaceholder: '@perfil' },
  PLATAFORMA: { label: 'Plataforma', icon: 'plug',   refLabel: 'Qual plataforma', refPlaceholder: '' },
  OUTRO:      { label: 'Outro',      icon: 'info',   refLabel: 'Descreva', refPlaceholder: 'ex.: evento, rede de parceiros' },
};
function aiOriginText(o) {
  if (!o || !o.type) return null;
  const t = AI_ORIGIN[o.type] || { label: o.type };
  const ref = o.type === 'PLATAFORMA' ? (AI_PLAT_NAMES[o.ref] || o.ref) : o.ref;
  return ref ? `${t.label} · ${ref}` : t.label;
}
function AiOriginChip({ origin, size = 10 }) {
  const text = aiOriginText(origin);
  if (!text) return null;
  const t = AI_ORIGIN[origin.type] || { icon: 'info' };
  return (
    <span title={`Origem do afiliado: ${text}`} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'var(--f-mono)', fontSize: size, fontWeight: 600,
      padding: '1px 7px', borderRadius: 'var(--r-full)', whiteSpace: 'nowrap',
      color: 'var(--gold)', background: 'color-mix(in oklab, var(--gold) 12%, transparent)', border: '1px solid color-mix(in oklab, var(--gold) 35%, transparent)',
    }}><Icon name={t.icon} size={size}/> {text}</span>
  );
}
// Lista de plataformas do dashboard (uma vez por sessão) pro select de origem.
let aiPlatformOptionsCache = null;
function useAiPlatformOptions() {
  const [opts, setOpts] = useStateAI(aiPlatformOptionsCache || Object.entries(AI_PLAT_NAMES).map(([slug, name]) => ({ slug, name })));
  useEffectAI(() => {
    if (aiPlatformOptionsCache) return;
    window.NSApi.fetchFilterOptions().then((o) => {
      const raw = (o && (o.platforms || o.platformOptions)) || [];
      const list = raw.map((p) => (typeof p === 'string' ? { slug: p, name: AI_PLAT_NAMES[p] || p } : { slug: p.slug || p.value || p.id, name: p.displayName || p.label || p.name || AI_PLAT_NAMES[p.slug] || p.slug })).filter((p) => p.slug);
      if (list.length) { aiPlatformOptionsCache = list; setOpts(list); }
    }).catch(() => {});
  }, []);
  return opts;
}
const AI_CONF = {
  alta:  { label: 'ALTA · mesmo e-mail',        tone: 'var(--success)', hint: 'O e-mail do afiliado é igual nas duas contas. Quase certeza de ser a mesma pessoa.' },
  media: { label: 'MÉDIA · mesmo nome',         tone: 'var(--warning)', hint: 'Nome/nick idêntico em plataformas diferentes. Confira antes de unificar.' },
  baixa: { label: 'BAIXA · sobrenome em comum', tone: 'var(--fg4)',     hint: 'Só um pedaço do nome coincide (ex.: "Godoy" dentro de "edugodoy…"). Pode ser coincidência.' },
};

function AiPlat({ slug, title }) {
  const pb = typeof platBadge === 'function' ? platBadge(slug) : null;
  if (pb) return <span className={`plat ${pb.cls}`} title={title || slug}>{pb.short}</span>;
  return (
    <span title={title || slug} style={{
      fontFamily: 'var(--f-mono)', fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 6,
      color: 'var(--fg3)', background: 'color-mix(in oklab, var(--fg4) 12%, transparent)', border: '1px solid var(--border-soft)',
    }}>{AI_PLAT[slug] || slug}</span>
  );
}

function aiDaysAgo(iso) {
  if (!iso) return null;
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? 'hoje' : d === 1 ? 'ontem' : `${d}d atrás`;
}

// Linha compacta de uma conta (usada em sugestões, parceiros e busca).
function AiAccount({ a, extra, onRemove, dense }) {
  const name = a.nickname || a.externalId;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, padding: dense ? '2px 0' : '4px 0' }}>
      <span style={{ ...AI_AV, background: avatarColor(a.externalId), width: 24, height: 24, fontSize: 9 }}>{initials(name)}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <AiPlat slug={a.platformSlug}/>
          <span style={{ fontWeight: 600, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
          {a.internal && <span style={{ fontSize: 9, color: 'var(--fg5)', border: '1px dashed var(--border)', borderRadius: 6, padding: '0 5px' }}>interno</span>}
        </div>
        <div style={{ fontSize: 10, color: 'var(--fg5)', fontFamily: 'var(--f-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          ID {a.externalId}{a.email ? ` · ${a.email}` : ''}{a.revenue30d != null ? ` · ${fmtCurrency(a.revenue30d, 'USD', 0)} 30d` : ''}{a.lastOrderAt ? ` · última venda ${aiDaysAgo(a.lastOrderAt)}` : ''}
          {extra ? ` · ${extra}` : ''}
        </div>
      </div>
      {onRemove && (
        <button className="btn btn-ghost" style={{ padding: '0 6px', flex: 'none' }} title="Desvincular esta conta" onClick={(e) => { e.stopPropagation(); onRemove(); }}>
          <Icon name="x" size={11}/>
        </button>
      )}
    </div>
  );
}

// ── Formulário de contato ───────────────────────────────────────────────
// Campo fora do componente do form: definido DENTRO do render, o React via
// um tipo novo a cada tecla e remontava o <input> (perdia o foco).
function AiField({ label, k, placeholder, type = 'text', f, setF, onEnter }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10, color: 'var(--fg5)', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 }}>
      {label}
      <input type={type} style={AI_INPUT} placeholder={placeholder} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter?.(); } }}/>
    </label>
  );
}

function AaContactForm({ title = 'CONTATO', initial, onSave, onCancel, busy, submitLabel = 'Salvar', showName = true, compact = false }) {
  const blank = { displayName: '', email: '', phone: '', notes: '', originType: '', originRef: '' };
  const [f, setF] = useStateAI({ ...blank, ...(initial || {}) });
  useEffectAI(() => { setF({ ...blank, ...(initial || {}) }); }, [initial?.displayName, initial?.email, initial?.phone, initial?.notes, initial?.originType, initial?.originRef]);
  const common = { f, setF, onEnter: () => onSave?.(f) };
  const platforms = useAiPlatformOptions();
  const originMeta = f.originType ? AI_ORIGIN[f.originType] : null;
  const labelStyle = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10, color: 'var(--fg5)', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 };
  return (
    <div className={compact ? '' : 'panel'} style={compact ? {} : { marginBottom: 12 }}>
      {title && <div className="panel-eyebrow" style={{ marginBottom: 8 }}>{title}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
        {showName && <AiField label="Nome do parceiro" k="displayName" placeholder="ex.: Eduardo Godoy" {...common}/>}
        <AiField label="E-mail principal" k="email" placeholder="opcional" type="email" {...common}/>
        <AiField label="Telefone / WhatsApp" k="phone" placeholder="opcional" {...common}/>
        <AiField label="Notas" k="notes" placeholder="opcional (ex.: gerente, fuso, condições)" {...common}/>
        <label style={labelStyle}>
          Origem do afiliado
          <select style={AI_INPUT} value={f.originType} onChange={(e) => setF({ ...f, originType: e.target.value, originRef: '' })}>
            <option value="">— sem origem —</option>
            {Object.entries(AI_ORIGIN).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        {originMeta && f.originType === 'PLATAFORMA' && (
          <label style={labelStyle}>
            {originMeta.refLabel}
            <select style={AI_INPUT} value={f.originRef} onChange={(e) => setF({ ...f, originRef: e.target.value })}>
              <option value="">— escolha —</option>
              {platforms.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
            </select>
          </label>
        )}
        {originMeta && f.originType !== 'PLATAFORMA' && (
          <AiField label={originMeta.refLabel} k="originRef" placeholder={originMeta.refPlaceholder} {...common}/>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center' }}>
        <button className="btn" disabled={busy} onClick={() => onSave?.(f)}>{busy ? '…' : submitLabel}</button>
        {onCancel && <button className="btn btn-ghost" onClick={onCancel}>Cancelar</button>}
        <span style={{ fontSize: 10, color: 'var(--fg5)', marginLeft: 'auto' }}>tudo opcional · Enter salva</span>
      </div>
    </div>
  );
}

function AiToast({ msg }) {
  if (!msg) return null;
  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 2, marginBottom: 10, padding: '8px 12px', borderRadius: 10, fontSize: 12,
      color: msg.ok ? 'var(--success)' : 'var(--danger)',
      background: `color-mix(in oklab, ${msg.ok ? 'var(--success)' : 'var(--danger)'} 10%, var(--bg-elev))`,
      border: `1px solid color-mix(in oklab, ${msg.ok ? 'var(--success)' : 'var(--danger)'} 35%, transparent)`,
    }}>{msg.text}</div>
  );
}

function AiEmpty({ children }) {
  return <div style={{ padding: '22px 12px', textAlign: 'center', color: 'var(--fg5)', fontSize: 12, border: '1px dashed var(--border)', borderRadius: 12 }}>{children}</div>;
}

function useIdentityActions(onChanged, reload) {
  const [busy, setBusy] = useStateAI(false);
  const [msg, setMsg] = useStateAI(null);
  useEffectAI(() => {
    if (!msg || !msg.ok) return undefined; // erro fica visível até a próxima ação
    const t = setTimeout(() => setMsg(null), 4500);
    return () => clearTimeout(t);
  }, [msg]);
  const act = async (fn, okMsg) => {
    setBusy(true); setMsg(null);
    try {
      const r = await fn();
      setMsg({ ok: true, text: typeof okMsg === 'function' ? okMsg(r) : okMsg });
      reload?.(); onChanged?.();
      return r;
    } catch (err) {
      setMsg({ ok: false, text: err.message || String(err) });
      return null;
    } finally { setBusy(false); }
  };
  return { busy, msg, act };
}

// ── Tela de identidades ─────────────────────────────────────────────────
function AffiliateIdentityDrawer({ onClose, onChanged, initialTab = 'sugestoes' }) {
  const [state, setState] = useStateAI({ status: 'loading', data: null, error: null });
  const [tick, setTick] = useStateAI(0);
  const [tab, setTab] = useStateAI(initialTab);
  const { busy, msg, act } = useIdentityActions(onChanged, () => setTick((t) => t + 1));

  useEffectAI(() => {
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading' }));
    window.NSApi.adminListAffiliateIdentity()
      .then((data) => { if (!cancelled) setState({ status: 'ready', data, error: null }); })
      .catch((err) => { if (!cancelled) setState({ status: 'error', data: null, error: err.message }); });
    return () => { cancelled = true; };
  }, [tick]);

  const d = state.data;
  const allAccounts = useMemoAI(() => {
    if (!d) return [];
    const linked = d.partners.flatMap((p) => p.accounts.map((a) => ({ ...a, partnerName: p.displayName, partnerId: p.id })));
    return [...d.unlinked, ...linked];
  }, [d]);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose}/>
      <div className="drawer" style={{ width: 880, maxWidth: '100vw' }}>
        <div className="drawer-head" style={{ alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow" style={{ fontSize: 10 }}>AFILIADOS · IDENTIDADES</div>
            <h3 style={{ margin: '4px 0 6px' }}>Uma pessoa, várias contas</h3>
            <div style={{ fontSize: 12, color: 'var(--fg4)', maxWidth: 560, lineHeight: 1.45 }}>
              Cada plataforma cria uma conta própria pro mesmo afiliado. Unifique aqui e as abas Afiliados e Análise passam a somar as contas — e você guarda o contato num lugar só.
            </div>
            {d && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {[
                  [d.stats.partners, 'parceiros'], [d.stats.linkedAccounts, 'contas vinculadas'], [d.stats.unlinkedAccounts, 'soltas'],
                  [d.stats.withEmail, 'com e-mail'], [d.stats.internal, 'internas'],
                ].map(([n, l]) => (
                  <span key={l} className="badge neutral" style={{ fontFamily: 'var(--f-mono)', fontSize: 10 }}><b style={{ color: 'var(--fg1)' }}>{fmtInt(n)}</b>&nbsp;{l}</span>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
            <button className="btn btn-ghost" disabled={busy} title="Lê o e-mail do afiliado nas vendas da JVZoo (única plataforma que manda) e junta automaticamente contas com o mesmo e-mail"
              onClick={() => act(() => window.NSApi.adminAffiliateIdentity('backfill', {}), (r) => `✓ ${r.updated} e-mails importados · ${r.linked} contas vinculadas · ${r.partnersCreated} parceiros novos`)}>
              <Icon name="refresh" size={12}/> Importar e-mails
            </button>
            <button className="icon-btn" onClick={onClose}><Icon name="x" size={14}/></button>
          </div>
        </div>
        <div className="drawer-body">
          <AiToast msg={msg}/>
          {state.status === 'loading' && !d && <SkelDrawerLoading/>}
          {state.status === 'error' && (
            <div style={{ color: 'var(--danger)', fontSize: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
              Erro: {state.error}
              <button className="btn btn-ghost" onClick={() => setTick((t) => t + 1)}><Icon name="refresh" size={11}/> tentar de novo</button>
            </div>
          )}
          {d && (
            <div style={{ opacity: state.status === 'loading' ? 0.5 : 1, transition: 'opacity .2s' }}>
              <div className="seg" style={{ marginBottom: 14 }}>
                {[['sugestoes', `Sugestões · ${d.suggestions.length}`], ['parceiros', `Parceiros · ${d.partners.length}`], ['manual', 'Vincular manualmente']].map(([k, l]) => (
                  <button key={k} className={tab === k ? 'is-active' : ''} onClick={() => setTab(k)}>{l}</button>
                ))}
              </div>
              {tab === 'sugestoes' && <AiSuggestions d={d} busy={busy} act={act}/>}
              {tab === 'parceiros' && <AiPartners d={d} allAccounts={allAccounts} busy={busy} act={act}/>}
              {tab === 'manual' && <AiManualLink allAccounts={allAccounts} busy={busy} act={act}/>}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function AiSuggestions({ d, busy, act }) {
  const groups = ['alta', 'media', 'baixa'].map((c) => ({ c, items: d.suggestions.filter((s) => s.confidence === c) })).filter((g) => g.items.length);
  const link = (s) => {
    if (s.a.partnerId && s.b.partnerId && s.a.partnerId !== s.b.partnerId) {
      if (!window.confirm(`As duas contas já estão em parceiros diferentes. Unificar vai FUNDIR os dois parceiros (o de "${s.a.nickname || s.a.externalId}" fica; o outro some, com contato/notas). Continuar?`)) return;
    }
    return act(() => window.NSApi.adminAffiliateIdentity('link', { affiliateIds: [s.a.id, s.b.id] }), `✓ "${s.a.nickname || s.a.externalId}" e "${s.b.nickname || s.b.externalId}" agora são um parceiro`);
  };
  const dismiss = (s) => act(() => window.NSApi.adminAffiliateIdentity('dismiss', { affiliateIds: [s.a.id, s.b.id] }), '✓ sugestão ignorada (não aparece mais)');
  return (
    <>
      {groups.length === 0 && (
        <AiEmpty>
          Nenhuma sugestão pendente{d.dismissedCount ? ` (${d.dismissedCount} ignoradas)` : ''}.<br/>
          <span style={{ fontSize: 11 }}>Quando a heurística não pega, use <b>Vincular manualmente</b>.</span>
          {d.dismissedCount > 0 && (
            <div style={{ marginTop: 8 }}><button className="btn btn-ghost" disabled={busy} onClick={() => act(() => window.NSApi.adminAffiliateIdentity('restore_dismissed', {}), (r) => `✓ ${r.restored} sugestões restauradas`)}>Restaurar ignoradas</button></div>
          )}
        </AiEmpty>
      )}
      {groups.map((g) => (
        <div key={g.c} style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{
              fontFamily: 'var(--f-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', padding: '2px 8px', borderRadius: 'var(--r-full)',
              color: AI_CONF[g.c].tone, background: `color-mix(in oklab, ${AI_CONF[g.c].tone} 12%, transparent)`, border: `1px solid color-mix(in oklab, ${AI_CONF[g.c].tone} 35%, transparent)`,
            }}>{AI_CONF[g.c].label}</span>
            <span style={{ fontSize: 11, color: 'var(--fg5)' }}>{AI_CONF[g.c].hint}</span>
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {g.items.map((s, i) => (
              <div key={i} className="panel" style={{ padding: '10px 12px', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 28px minmax(0,1fr) auto', gap: 10, alignItems: 'center' }}>
                <AiAccount a={s.a} extra={s.a.partnerId ? 'já em parceiro' : null} dense/>
                <div style={{ textAlign: 'center', color: 'var(--fg5)' }}><Icon name="link" size={14}/></div>
                <AiAccount a={s.b} extra={s.b.partnerId ? 'já em parceiro' : null} dense/>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'stretch' }}>
                  <button className="btn" disabled={busy} onClick={() => link(s)}>Unificar</button>
                  <button className="btn btn-ghost" disabled={busy} style={{ fontSize: 11 }} onClick={() => dismiss(s)}>Ignorar</button>
                </div>
                <div style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--fg4)', borderTop: '1px solid var(--border-soft)', paddingTop: 6 }}>
                  <Icon name="info" size={11}/> {s.evidence}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {groups.length > 0 && d.dismissedCount > 0 && (
        <div style={{ fontSize: 11, color: 'var(--fg5)', display: 'flex', gap: 8, alignItems: 'center' }}>
          {d.dismissedCount} sugestões ignoradas
          <button className="btn btn-ghost" style={{ fontSize: 11 }} disabled={busy} onClick={() => act(() => window.NSApi.adminAffiliateIdentity('restore_dismissed', {}), (r) => `✓ ${r.restored} restauradas`)}>restaurar</button>
        </div>
      )}
    </>
  );
}

function AiAccountSearch({ allAccounts, exclude = [], onPick, placeholder = 'buscar conta por nome, ID ou e-mail…', autoFocus }) {
  const [q, setQ] = useStateAI('');
  const hits = useMemoAI(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    const ex = new Set(exclude);
    return allAccounts
      .filter((a) => !ex.has(a.id) && ((a.nickname || '').toLowerCase().includes(s) || a.externalId.toLowerCase().includes(s) || (a.email || '').toLowerCase().includes(s)))
      .slice(0, 10);
  }, [q, allAccounts, exclude.join(',')]);
  return (
    <div>
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 9, top: 8, color: 'var(--fg5)' }}><Icon name="search" size={12}/></span>
        <input style={{ ...AI_INPUT, paddingLeft: 26 }} placeholder={placeholder} value={q} autoFocus={autoFocus} onChange={(e) => setQ(e.target.value)}/>
      </div>
      {q.trim().length >= 2 && (
        <div style={{ marginTop: 6, border: '1px solid var(--border-soft)', borderRadius: 10, overflow: 'hidden' }}>
          {hits.length === 0 && <div style={{ padding: 10, fontSize: 11, color: 'var(--fg5)' }}>nada encontrado</div>}
          {hits.map((a) => (
            <button key={a.id} className="btn btn-ghost" style={{ display: 'block', width: '100%', textAlign: 'left', borderRadius: 0, padding: '4px 10px', borderBottom: '1px solid var(--border-soft)' }} onClick={() => { onPick(a); setQ(''); }}>
              <AiAccount a={a} extra={a.partnerName ? `parceiro: ${a.partnerName}` : null} dense/>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AiPartners({ d, allAccounts, busy, act }) {
  const [editing, setEditing] = useStateAI(null);   // partnerId em edição de contato
  const [adding, setAdding] = useStateAI(null);     // partnerId recebendo conta
  const [q, setQ] = useStateAI('');
  const list = useMemoAI(() => {
    const s = q.trim().toLowerCase();
    if (!s) return d.partners;
    return d.partners.filter((p) => p.displayName.toLowerCase().includes(s) || (p.email || '').toLowerCase().includes(s) || p.accounts.some((a) => (a.nickname || '').toLowerCase().includes(s) || a.externalId.toLowerCase().includes(s)));
  }, [d, q]);
  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <input style={{ ...AI_INPUT, maxWidth: 320 }} placeholder="filtrar parceiros…" value={q} onChange={(e) => setQ(e.target.value)}/>
        <span style={{ fontSize: 11, color: 'var(--fg5)' }}>{list.length} de {d.partners.length} · ordenados por receita 30d</span>
      </div>
      {d.partners.length === 0 && <AiEmpty>Nenhum parceiro ainda. Unifique contas nas <b>Sugestões</b> ou em <b>Vincular manualmente</b>.</AiEmpty>}
      <div style={{ display: 'grid', gap: 10 }}>
        {list.map((p) => (
          <div key={p.id} className="panel" style={{ padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ ...AI_AV, background: avatarColor(p.id), width: 34, height: 34, fontSize: 12 }}>{initials(p.displayName)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{p.displayName}</span>
                  {p.accounts.map((a) => <AiPlat key={a.id} slug={a.platformSlug} title={a.nickname || a.externalId}/>)}
                  <AiOriginChip origin={p.origin}/>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--money)', marginLeft: 'auto' }}>{fmtCurrency(p.revenue30d, 'USD', 0)} <span style={{ color: 'var(--fg5)' }}>30d</span></span>
                </div>
                {editing !== p.id && (
                  <div style={{ fontSize: 11, color: 'var(--fg4)', fontFamily: 'var(--f-mono)', marginTop: 2, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    {p.email ? <span><Icon name="mail" size={11}/> {p.email}</span> : <span style={{ color: 'var(--fg5)' }}>sem e-mail</span>}
                    {p.phone && <span><Icon name="user" size={11}/> {p.phone}</span>}
                    {p.notes && <span style={{ color: 'var(--fg5)' }}>· {p.notes}</span>}
                    <button className="btn btn-ghost" style={{ fontSize: 10, padding: '1px 6px' }} onClick={() => setEditing(p.id)}><Icon name="edit" size={10}/> {p.email || p.phone ? 'editar' : 'adicionar contato'}</button>
                  </div>
                )}
              </div>
            </div>
            {editing === p.id && (
              <div style={{ marginTop: 10 }}>
                <AaContactForm compact title={null} initial={{ displayName: p.displayName, email: p.email || '', phone: p.phone || '', notes: p.notes || '', originType: p.origin?.type || '', originRef: p.origin?.ref || '' }} busy={busy}
                  onCancel={() => setEditing(null)}
                  onSave={(f) => act(async () => { await window.NSApi.adminAffiliateIdentity('update', { partnerId: p.id, displayName: f.displayName, email: f.email || null, phone: f.phone || null, notes: f.notes || null, originType: f.originType || null, originRef: f.originRef || null }); setEditing(null); }, '✓ contato salvo')}/>
              </div>
            )}
            <div style={{ marginTop: 8, borderTop: '1px solid var(--border-soft)', paddingTop: 6 }}>
              {p.accounts.map((a) => (
                <AiAccount key={a.id} a={a} dense onRemove={p.accounts.length > 1 ? () => act(() => window.NSApi.adminAffiliateIdentity('unlink', { affiliateId: a.id }), `✓ "${a.nickname || a.externalId}" desvinculada`) : null}/>
              ))}
              {adding === p.id ? (
                <div style={{ marginTop: 6 }}>
                  <AiAccountSearch autoFocus allAccounts={allAccounts} exclude={p.accounts.map((a) => a.id)} placeholder="adicionar conta a este parceiro…"
                    onPick={(a) => act(async () => { await window.NSApi.adminAffiliateIdentity('link', { affiliateIds: [a.id], partnerId: p.id }); setAdding(null); }, `✓ "${a.nickname || a.externalId}" adicionada a ${p.displayName}`)}/>
                  <button className="btn btn-ghost" style={{ fontSize: 11, marginTop: 4 }} onClick={() => setAdding(null)}>cancelar</button>
                </div>
              ) : (
                <button className="btn btn-ghost" style={{ fontSize: 11, marginTop: 4 }} onClick={() => setAdding(p.id)}><Icon name="plus" size={11}/> adicionar conta</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function AiManualLink({ allAccounts, busy, act }) {
  const [pick, setPick] = useStateAI([]);
  const [contact, setContact] = useStateAI({ displayName: '', email: '', phone: '' });
  // Se a base mudou (ex.: "Importar e-mails" vinculou uma conta selecionada),
  // re-sincroniza os objetos selecionados com a lista nova.
  useEffectAI(() => {
    setPick((p) => p.map((a) => allAccounts.find((x) => x.id === a.id) || a).filter((a) => allAccounts.some((x) => x.id === a.id)));
  }, [allAccounts]);
  const partnersInPick = [...new Map(pick.filter((a) => a.partnerId).map((a) => [a.partnerId, a.partnerName])).entries()];
  const target = partnersInPick.length === 1 ? { partnerId: partnersInPick[0][0], partnerName: partnersInPick[0][1] } : null;
  const merging = partnersInPick.length > 1;
  const create = () => act(async () => {
    const body = { affiliateIds: pick.map((a) => a.id) };
    // Alvo único → move só as contas selecionadas pra ele (nada é fundido).
    if (target) body.partnerId = target.partnerId;
    // Contato só quando preenchido — vazio NÃO apaga o que o parceiro já tem.
    if (contact.displayName.trim()) body.displayName = contact.displayName.trim();
    if (contact.email.trim()) body.email = contact.email.trim();
    if (contact.phone.trim()) body.phone = contact.phone.trim();
    await window.NSApi.adminAffiliateIdentity('link', body);
    setPick([]); setContact({ displayName: '', email: '', phone: '' });
  }, target ? `✓ contas adicionadas a ${target.partnerName}` : merging ? `✓ parceiros fundidos em ${partnersInPick[0][1]}` : '✓ parceiro criado');
  return (
    <div className="panel">
      <div className="panel-eyebrow">VÍNCULO MANUAL</div>
      <ol style={{ fontSize: 12, color: 'var(--fg4)', margin: '6px 0 12px', paddingLeft: 18, lineHeight: 1.6 }}>
        <li>Busque e selecione as contas (qualquer plataforma) que são a mesma pessoa.</li>
        <li>Opcional: dê um nome e contato. Se alguma conta já tiver parceiro, as outras entram nele.</li>
        <li>Clique em <b>Vincular</b>.</li>
      </ol>
      <AiAccountSearch allAccounts={allAccounts} exclude={pick.map((a) => a.id)} onPick={(a) => setPick((p) => [...p, a])}/>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '10px 0' }}>
        {pick.length === 0 && <span style={{ fontSize: 11, color: 'var(--fg5)' }}>nenhuma conta selecionada</span>}
        {pick.map((a) => (
          <span key={a.id} className="badge neutral" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', padding: '4px 8px' }}>
            <AiPlat slug={a.platformSlug}/> {a.nickname || a.externalId}{a.partnerName ? <span style={{ color: 'var(--accent)' }}>({a.partnerName})</span> : null}
            <button className="btn btn-ghost" style={{ padding: '0 4px' }} onClick={() => setPick((p) => p.filter((x) => x.id !== a.id))}>×</button>
          </span>
        ))}
      </div>
      {merging && (
        <div style={{ fontSize: 12, color: 'var(--warning)', marginBottom: 10, padding: '8px 10px', border: '1px solid color-mix(in oklab, var(--warning) 35%, transparent)', borderRadius: 10 }}>
          <Icon name="alert-triangle" size={12}/> Isso vai <b>fundir</b> os parceiros {partnersInPick.map(([, n]) => `"${n}"`).join(' e ')}: todas as contas ficam em <b>{partnersInPick[0][1]}</b> (o primeiro selecionado) e os outros parceiros somem. Contato/notas dos outros se perdem.
        </div>
      )}
      {!target && !merging && pick.length >= 1 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8, marginBottom: 10 }}>
          <input style={AI_INPUT} placeholder="nome do parceiro (opcional)" value={contact.displayName} onChange={(e) => setContact({ ...contact, displayName: e.target.value })}/>
          <input style={AI_INPUT} placeholder="e-mail (opcional)" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })}/>
          <input style={AI_INPUT} placeholder="telefone (opcional)" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })}/>
        </div>
      )}
      <button className="btn" disabled={busy || (pick.length < 2 && !(pick.length === 1 && (target || contact.displayName.trim() || contact.email.trim() || contact.phone.trim())))} onClick={create}>
        {merging ? `Fundir ${partnersInPick.length} parceiros` : target ? `Adicionar a ${target.partnerName}` : pick.length >= 2 ? `Vincular ${pick.length} contas` : 'Vincular (selecione 2+ contas, ou 1 + contato)'}
      </button>
    </div>
  );
}

// ── Desempenho do parceiro por plataforma (aba Afiliados) ───────────────
function AffiliatePartnerDrawer({ row, filters, isAdmin, onClose, onOpenAccount, onChanged }) {
  const cur = filters.currency || 'USD';
  const [editing, setEditing] = useStateAI(false);
  const { busy, msg, act } = useIdentityActions(onChanged, null);
  const accounts = row.accounts || [];
  const total = accounts.reduce((n, a) => n + a.revenue, 0) || 1;
  const aov = (a) => (a.feApprovedCount > 0 ? a.revenue / a.feApprovedCount : 0);
  const name = row.partnerName || row.nickname || row.externalId;
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose}/>
      <div className="drawer" style={{ width: 900, maxWidth: '100vw' }}>
        <div className="drawer-head">
          <div className="drawer-aff">
            <div className="av-lg" style={{ background: avatarColor(row.key || name) }}>{initials(name)}</div>
            <div>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {name}
                <span title="contas unificadas" style={{ color: 'var(--accent)' }}><Icon name="link" size={13}/></span>
              </h3>
              <div className="sub" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {accounts.map((a) => <AiPlat key={`${a.platformSlug}:${a.externalId}`} slug={a.platformSlug} title={a.nickname || a.externalId}/>)}
                <span>{accounts.length} contas</span>
                <AiOriginChip origin={row.origin}/>
                {isAdmin && row.contact && (row.contact.email || row.contact.phone) && !editing && (
                  <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11 }}>
                    {row.contact.email && <span><Icon name="mail" size={11}/> {row.contact.email}</span>}
                    {row.contact.phone && <span style={{ marginLeft: 8 }}><Icon name="user" size={11}/> {row.contact.phone}</span>}
                  </span>
                )}
                {isAdmin && !editing && <button className="btn btn-ghost" style={{ fontSize: 10, padding: '1px 6px' }} onClick={() => setEditing(true)}><Icon name="edit" size={10}/> contato</button>}
              </div>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>
        <div className="drawer-body">
          <AiToast msg={msg}/>
          {isAdmin && editing && row.partnerId && (
            <AaContactForm title="CONTATO DO PARCEIRO (opcional)" busy={busy}
              initial={{ displayName: name, email: row.contact?.email || '', phone: row.contact?.phone || '', notes: row.contact?.notes || '', originType: row.origin?.type || '', originRef: row.origin?.ref || '' }}
              onCancel={() => setEditing(false)}
              onSave={(f) => act(async () => { await window.NSApi.adminAffiliateIdentity('update', { partnerId: row.partnerId, displayName: f.displayName, email: f.email || null, phone: f.phone || null, notes: f.notes || null, originType: f.originType || null, originRef: f.originRef || null }); setEditing(false); }, '✓ contato salvo')}/>
          )}

          <div className="mini-kpis">
            <div className="mini-kpi"><div className="l">Receita · período</div><div className="v" style={{ color: 'var(--money)' }}>{fmtCurrency(row.revenue, cur, 0)}</div><div className="s">{fmtInt(row.orders)} pedidos · {fmtInt(row.feApprovedCount)} FEs</div></div>
            <div className="mini-kpi"><div className="l">AOV</div><div className="v">{aov(row) > 0 ? fmtCurrency(aov(row), cur, 0) : '—'}</div><div className="s">NET AOV {row.netAovUsd > 0 ? fmtCurrency(row.netAovUsd, cur, 0) : '—'}</div></div>
            <div className="mini-kpi"><div className="l">Aprovação · Reembolso</div><div className="v">{fmtPct(row.approvalRate, 1)}</div><div className="s">reembolso obs. {fmtPct(row.refundRate, 1)} · CB {fmtPct(row.cbRate, 2)}</div></div>
            <div className="mini-kpi"><div className="l">Net after CPA</div><div className="v" style={{ color: row.netAfterCpaUsd == null ? 'var(--fg5)' : row.netAfterCpaUsd < 0 ? 'var(--danger)' : 'var(--money)' }}>{row.netAfterCpaUsd != null ? fmtCurrency(row.netAfterCpaUsd, cur, 0) : '—'}</div><div className="s">CPA/venda {row.cpaPerFe > 0 ? fmtCurrency(row.cpaPerFe, cur, 0) : '—'} · total {row.netAfterCpaTotalUsd != null ? fmtCurrency(row.netAfterCpaTotalUsd, cur, 0) : '—'}</div></div>
          </div>

          <div className="panel" style={{ padding: 0, marginTop: 12 }}>
            <div className="panel-head" style={{ padding: '12px 16px 6px' }}>
              <div className="panel-title">
                <span className="panel-eyebrow">DESEMPENHO POR PLATAFORMA</span>
                <span className="panel-sub">cada conta com os próprios números no período · "Detalhe" abre o drill-down completo da conta (série diária, ofertas, países)</span>
              </div>
            </div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr>
                  <th>Plataforma</th><th>Conta</th>
                  <th className="num">Pedidos</th><th className="num">Receita</th><th style={{ minWidth: 90 }}>Share</th>
                  <th className="num">AOV</th><th className="num">Aprov.</th><th className="num">Reemb. obs</th>
                  <th className="num">CPA/venda</th><th className="num">NET AOV</th><th className="num">Net after CPA</th><th>Status</th><th>30d</th><th></th>
                </tr></thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={`${a.platformSlug}:${a.externalId}`} onClick={() => onOpenAccount?.(a)} style={{ cursor: 'pointer' }}>
                      <td><AiPlat slug={a.platformSlug}/></td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{a.nickname || a.externalId}</div>
                        <div style={{ fontSize: 10, color: 'var(--fg5)', fontFamily: 'var(--f-mono)' }}>ID {a.externalId}</div>
                      </td>
                      <td className="num cell-mono">{fmtInt(a.orders)}</td>
                      <td className="num cell-mono" style={{ color: 'var(--money)', fontWeight: 600 }}>{fmtCurrency(a.revenue, cur, 0)}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ flex: 1, height: 6, borderRadius: 4, background: 'color-mix(in oklab, var(--fg4) 15%, transparent)', overflow: 'hidden' }}>
                            <div style={{ width: `${Math.max(2, a.revenue / total * 100)}%`, height: '100%', background: 'var(--accent)' }}/>
                          </div>
                          <span className="mono" style={{ fontSize: 10, color: 'var(--fg4)', minWidth: 32, textAlign: 'right' }}>{fmtPct(a.revenue / total, 0)}</span>
                        </div>
                      </td>
                      <td className="num cell-mono">{aov(a) > 0 ? fmtCurrency(aov(a), cur, 0) : '—'}</td>
                      <td className="num cell-mono">{fmtPct(a.approvalRate, 1)}</td>
                      <td className="num cell-mono" style={{ color: a.refundRate > 0.12 ? 'var(--danger)' : undefined }}>{fmtPct(a.refundRate, 1)}</td>
                      <td className="num cell-mono">{a.cpaPerFe > 0 ? fmtCurrency(a.cpaPerFe, cur, 0) : '—'}</td>
                      <td className="num cell-mono">{a.netAovUsd > 0 ? fmtCurrency(a.netAovUsd, cur, 0) : '—'}</td>
                      <td className="num cell-mono" style={{ fontWeight: 700, color: a.netAfterCpaUsd == null ? 'var(--fg5)' : a.netAfterCpaUsd < 0 ? 'var(--danger)' : 'var(--money)' }}>{a.netAfterCpaUsd != null ? fmtCurrency(a.netAfterCpaUsd, cur, 0) : '—'}</td>
                      <td><CpaStatusChip status={a.cpaStatus}/></td>
                      <td><Sparkline data={a.sparkline || []} width={64} height={18}/></td>
                      <td><button className="btn btn-ghost" style={{ fontSize: 11, whiteSpace: 'nowrap' }} onClick={(e) => { e.stopPropagation(); onOpenAccount?.(a); }}>Detalhe →</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg5)', marginTop: 10 }}>
            Os números do parceiro são as contas somadas: taxas re-derivadas dos totais; NET AOV, CPA/venda e Net after CPA calculados sobre as contas com CPA conhecido (total = por FE × FEs dessas contas); o refund&CB% é a média ponderada — o override é por conta (abra "Detalhe" ou desligue "contas unificadas"). Gerencie as contas em <b>Identidades</b> (botão no topo da aba).
          </div>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { AaContactForm, AffiliateIdentityDrawer, AffiliatePartnerDrawer, AiOriginChip });
