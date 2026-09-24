/* global React, Icon, fmtCurrency, fmtInt, fmtDateTime, fmtDateShort, SkelTableRows */
/* CRM de afiliados (WhatsApp) — a régua do playbook virada em fila de
   trabalho. O disparo é MANUAL: aqui o operador vê quem está devendo qual
   toque, baixa o CSV pra ferramenta de disparo e marca o que enviou.
   O que ele marca vira o "já tocado NESTE ciclo" — e quem vendeu de novo
   sai da fila sozinho, porque o ciclo é ancorado no dia da última venda.
   API: GET/POST /api/admin/affiliate-crm, GET …/export */

const { useState: useStateCrm, useEffect: useEffectCrm, useMemo: useMemoCrm, useCallback: useCallbackCrm } = React;

const CRM_SEGMENTS = [
  { id: 'dormente',   label: 'Dormentes',  desc: 'Passaram do limiar do tier sem vender' },
  { id: 'em_risco',   label: 'Em risco',   desc: 'Caíram frente à própria média, mas ainda vendem' },
  { id: 'onboarding', label: 'Onboarding', desc: 'Cadastro novo — até a primeira venda engrenar' },
  { id: 'upgrade',    label: 'Upgrade',    desc: 'Sustentam volume do tier de cima' },
  { id: 'ativo',      label: 'Ativos',     desc: 'Vendendo no ritmo' },
  { id: 'frio',       label: 'Frios',      desc: 'Passaram do limite da régua' },
  { id: 'fora',       label: 'Fora',       desc: 'Opt-out ou inativos no sistema' },
];
const CRM_TIERS = [
  { id: 'BASE', label: 'Base' },
  { id: 'ASCENDENTE', label: 'Ascendente' },
  { id: 'NORTH', label: 'North' },
];
const CRM_TIER_COLOR = { BASE: 'var(--fg4)', ASCENDENTE: 'var(--accent)', NORTH: '#C29B3C' };
const CRM_PRIORITY = {
  alta:  { label: 'Alta',  color: 'var(--danger)' },
  media: { label: 'Média', color: 'var(--warning)' },
  baixa: { label: 'Baixa', color: 'var(--fg5)' },
};
const CRM_ALERTS = {
  sem_whatsapp:        { label: 'sem WhatsApp',    hint: 'Não dá pra contatar: falta o número (cadastre à mão ou peça pro sistema de afiliados mandar).' },
  tier_indefinido:     { label: 'tier indefinido', hint: 'Sem tier da plataforma e sem CPA conhecido — está caindo em Base.' },
  prejuizo:            { label: 'prejuízo',        hint: 'Net após CPA negativo no mês. Reativar aumenta a perda: trate como negociação, não como régua.' },
  cpa_acima_do_volume: { label: 'CPA alto p/ volume', hint: 'Recebe CPA de North sem entregar volume de North — conversa de CPA.' },
  opt_out:             { label: 'não contatar',    hint: 'Marcado como opt-out.' },
};

function crmDias(n) { return n == null ? '—' : `${n}d`; }
function crmPhone(p) {
  if (!p) return null;
  return p.length > 11 ? `+${p.slice(0, p.length - 11)} ${p.slice(-11, -8)} ${p.slice(-8)}` : p;
}

function CrmKpi({ label, value, sub, tone }) {
  return (
    <div className="panel" style={{ padding: '12px 16px', flex: '1 1 150px', minWidth: 140 }}>
      <div className="panel-eyebrow" style={{ fontSize: 10 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: tone || 'var(--fg1)', lineHeight: 1.15, marginTop: 2 }}>{value}</div>
      {sub && <div className="panel-sub" style={{ fontSize: 11, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function CrmChip({ children, color, title }) {
  return (
    <span title={title} style={{
      display: 'inline-block', padding: '1px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600,
      color, background: `color-mix(in oklab, ${color} 12%, transparent)`, whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

/** Linha da tabela. Tudo que dá pra agir sai daqui pro drawer. */
function CrmRow({ r, checked, onCheck, onOpen, onTouch }) {
  const tone = CRM_TIER_COLOR[r.tier] || 'var(--fg4)';
  const prio = CRM_PRIORITY[r.priority] || CRM_PRIORITY.baixa;
  return (
    <tr style={{ cursor: 'pointer' }} onClick={() => onOpen(r)}>
      <td onClick={(e) => e.stopPropagation()} style={{ width: 28 }}>
        <input type="checkbox" checked={checked} disabled={!r.pending} onChange={(e) => onCheck(r.key, e.target.checked)}/>
      </td>
      <td>
        <div style={{ fontWeight: 600, color: 'var(--fg1)' }}>{r.name}</div>
        <div style={{ fontSize: 11, color: 'var(--fg5)' }}>
          {r.platforms.length ? r.platforms.join(' · ') : 'só no sistema de afiliados'}
          {r.mainFamily ? ` · ${r.mainFamily}` : ''}
        </div>
      </td>
      <td><CrmChip color={tone} title={`tier ${r.tierSource === 'manual' ? 'definido à mão' : r.tierSource === 'plataforma' ? 'vindo do sistema de afiliados' : r.tierSource === 'cpa' ? 'inferido pelo CPA pago' : 'padrão (sem dado)'}`}>
        {(CRM_TIERS.find((t) => t.id === r.tier) || {}).label}{r.tierSource === 'cpa' ? '?' : ''}
      </CrmChip></td>
      <td className="num cell-mono">{crmDias(r.daysSinceLastSale)}</td>
      <td className="num cell-mono">{r.cpaAtual != null ? fmtCurrency(r.cpaAtual, 'USD', 0) : '—'}</td>
      <td className="num cell-mono" style={{ color: 'var(--money)' }}>{fmtCurrency(r.valueUsd, 'USD', 0)}</td>
      <td style={{ fontSize: 11 }}>
        {r.phone
          ? <span style={{ color: 'var(--fg2)' }}>{crmPhone(r.phone)}</span>
          : <span style={{ color: 'var(--warning)' }}>falta</span>}
      </td>
      <td>
        {r.nextTouch
          ? <CrmChip color="var(--accent)" title={r.nextTouch.tag}>● {r.nextTouch.label}{r.nextTouch.overdueDays > 0 ? ` · ${r.nextTouch.overdueDays}d atrasado` : ''}</CrmChip>
          : <span style={{ fontSize: 11, color: 'var(--fg5)' }}>em dia</span>}
      </td>
      <td><CrmChip color={prio.color}>{prio.label}</CrmChip></td>
      <td style={{ maxWidth: 160 }}>
        {r.alerts.filter((a) => a !== 'sem_whatsapp').map((a) => (
          <CrmChip key={a} color="var(--warning)" title={(CRM_ALERTS[a] || {}).hint}>{(CRM_ALERTS[a] || { label: a }).label}</CrmChip>
        ))}
      </td>
      <td onClick={(e) => e.stopPropagation()} style={{ width: 92 }}>
        {r.pending && (
          <button className="btn btn-ghost" title="Registrar que este toque foi enviado" onClick={() => onTouch(r, r.nextTouch.id, r.nextTouch.tag)}>
            <Icon name="check" size={13}/> enviei
          </button>
        )}
      </td>
    </tr>
  );
}

/** Drawer do afiliado: contato, tier, histórico e as ações do ciclo. */
function CrmDrawer({ row, onClose, onSave, onTouch, onUntouch, busy }) {
  const [phone, setPhone] = useStateCrm(row.phone || '');
  const [tier, setTier] = useStateCrm(row.tierSource === 'manual' ? row.tier : '');
  const [notes, setNotes] = useStateCrm('');
  const [optOut, setOptOut] = useStateCrm(!!row.optOut);
  useEffectCrm(() => {
    setPhone(row.phone || ''); setTier(row.tierSource === 'manual' ? row.tier : ''); setOptOut(!!row.optOut); setNotes('');
  }, [row.key]);

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(440px, 100vw)', background: 'var(--card)',
      borderLeft: '1px solid var(--line)', boxShadow: 'var(--shadow)', padding: 20, overflowY: 'auto', zIndex: 60,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{row.name}</div>
          <div className="panel-sub" style={{ fontSize: 12 }}>{row.reason}</div>
        </div>
        <button className="btn btn-ghost" onClick={onClose}><Icon name="x" size={14}/></button>
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', margin: '14px 0', fontSize: 12 }}>
        <div><div className="panel-eyebrow" style={{ fontSize: 10 }}>ÚLTIMA VENDA</div>{row.lastSaleDay ? fmtDateShort(row.lastSaleDay) : 'nunca'}</div>
        <div><div className="panel-eyebrow" style={{ fontSize: 10 }}>7 DIAS</div>{fmtInt(row.sales7)} vendas</div>
        <div><div className="panel-eyebrow" style={{ fontSize: 10 }}>30 DIAS</div>{fmtInt(row.sales30)} vendas · {fmtCurrency(row.revenue30, 'USD', 0)}</div>
        <div><div className="panel-eyebrow" style={{ fontSize: 10 }}>NET APÓS CPA (30D)</div>
          <span style={{ color: row.netAfterCpa30 == null ? 'var(--fg5)' : row.netAfterCpa30 < 0 ? 'var(--danger)' : 'var(--money)' }}>
            {row.netAfterCpa30 == null ? '—' : fmtCurrency(row.netAfterCpa30, 'USD', 0)}
          </span>
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--fg5)', marginBottom: 12 }}>
        Vendas por semana (mais recente por último): {row.weeklySales.join(' · ')}
      </div>

      {row.alerts.length > 0 && (
        <div className="panel" style={{ padding: '10px 12px', marginBottom: 14 }}>
          {row.alerts.map((a) => (
            <div key={a} style={{ fontSize: 11, color: 'var(--fg3)', marginBottom: 3 }}>
              <Icon name="alert-triangle" size={12}/> <strong>{(CRM_ALERTS[a] || { label: a }).label}</strong> — {(CRM_ALERTS[a] || {}).hint}
            </div>
          ))}
        </div>
      )}

      <div className="panel-eyebrow" style={{ fontSize: 10, marginBottom: 6 }}>CONTATO E TIER</div>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--fg4)' }}>WhatsApp (só números, com DDI)</label>
      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="5511988887777"
        style={{ width: '100%', marginBottom: 8 }}/>
      <div style={{ fontSize: 11, color: 'var(--fg5)', marginBottom: 8 }}>
        {row.phoneSource === 'plataforma' ? 'Veio do sistema de afiliados.'
          : row.phoneSource === 'identidade' ? 'Veio do cadastro de identidade do dash.'
          : row.phoneSource === 'manual' ? 'Preenchido à mão aqui.'
          : 'Nenhuma fonte tem o número desse afiliado.'}
      </div>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--fg4)' }}>Tier</label>
      <select value={tier} onChange={(e) => setTier(e.target.value)} style={{ width: '100%', marginBottom: 6 }}>
        <option value="">— usar o da plataforma / inferido ({(CRM_TIERS.find((t) => t.id === row.tier) || {}).label})</option>
        {CRM_TIERS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
      </select>
      {row.tierPlatformRaw && <div style={{ fontSize: 11, color: 'var(--fg5)' }}>Plataforma manda: <code>{row.tierPlatformRaw}</code></div>}

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, margin: '10px 0' }}>
        <input type="checkbox" checked={optOut} onChange={(e) => setOptOut(e.target.checked)}/>
        Não contatar (tira da régua)
      </label>
      <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="observação (opcional)" style={{ width: '100%', marginBottom: 8 }}/>
      <button className="btn btn-primary" disabled={busy} onClick={() => onSave({ crmKey: row.key, phone: phone.trim() || null, tier: tier || null, optOut, notes: notes.trim() || null })}>
        Salvar contato
      </button>

      <div className="panel-eyebrow" style={{ fontSize: 10, margin: '18px 0 6px' }}>TOQUES DESTE CICLO</div>
      <div style={{ fontSize: 11, color: 'var(--fg5)', marginBottom: 8 }}>
        Ciclo <code>{row.cycleKey}</code> — reinicia sozinho quando ele vender de novo.
      </div>
      {row.touchesInCycle.length === 0 && <div style={{ fontSize: 12, color: 'var(--fg5)' }}>Nenhum toque registrado ainda.</div>}
      {row.touchesInCycle.map((t) => (
        <div key={t.touchpoint} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '4px 0', borderBottom: '1px dashed var(--line)' }}>
          <span><strong>{t.touchpoint}</strong> {t.tag ? <code style={{ fontSize: 11 }}>{t.tag}</code> : null}</span>
          <span style={{ color: 'var(--fg5)', fontSize: 11 }}>{fmtDateTime(t.sentAt)}</span>
          <button className="btn btn-ghost" disabled={busy} title="desfazer" onClick={() => onUntouch(row, t.touchpoint)}><Icon name="x" size={12}/></button>
        </div>
      ))}

      {row.nextTouch && (
        <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" disabled={busy} onClick={() => onTouch(row, row.nextTouch.id, row.nextTouch.tag)}>
            Marquei o {row.nextTouch.label} como enviado
          </button>
          <button className="btn btn-ghost" disabled={busy} title="tira da fila só neste ciclo" onClick={() => onTouch(row, 'SKIP', null)}>
            pular este ciclo
          </button>
        </div>
      )}
    </div>
  );
}

/** Parâmetros da régua (admin) — os "a confirmar" do playbook. */
function CrmParams({ config, onSave, onClose, busy }) {
  const [f, setF] = useStateCrm({
    dormantDaysBase: config.dormantDays.BASE,
    dormantDaysAscendente: config.dormantDays.ASCENDENTE,
    dormantDaysNorth: config.dormantDays.NORTH,
    coldDays: config.coldDays,
    onboardingDays: config.onboardingDays,
    atRiskDropPct: config.atRiskDropPct,
    atRiskWeeks: config.atRiskWeeks,
    upgradeWeeks: config.upgradeWeeks,
    upgradeSalesAscendente: config.upgradeSales.ASCENDENTE,
    upgradeSalesNorth: config.upgradeSales.NORTH,
    tierCpaAscendenteMin: config.tierCpaMin.ASCENDENTE,
    tierCpaNorthMin: config.tierCpaMin.NORTH,
    minValueUsd: config.minValueUsd,
  });
  const set = (k) => (e) => setF({ ...f, [k]: Number(e.target.value) });
  const Field = ({ k, label, hint }) => (
    <div style={{ marginBottom: 10 }}>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--fg4)' }}>{label}</label>
      <input type="number" value={f[k]} onChange={set(k)} style={{ width: '100%' }}/>
      {hint && <div style={{ fontSize: 10, color: 'var(--fg5)', marginTop: 2 }}>{hint}</div>}
    </div>
  );
  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(420px, 100vw)', background: 'var(--card)',
      borderLeft: '1px solid var(--line)', boxShadow: 'var(--shadow)', padding: 20, overflowY: 'auto', zIndex: 60,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Parâmetros da régua</div>
        <button className="btn btn-ghost" onClick={onClose}><Icon name="x" size={14}/></button>
      </div>
      <div className="panel-sub" style={{ fontSize: 11, marginBottom: 14 }}>
        Estes são os números que o playbook deixou "a confirmar". Mudar aqui muda a classificação de todo mundo na hora.
      </div>
      <Field k="dormantDaysBase" label="Dormência — Base (dias)"/>
      <Field k="dormantDaysAscendente" label="Dormência — Ascendente (dias)"/>
      <Field k="dormantDaysNorth" label="Dormência — North (dias)" hint="North some antes: perder um dele custa mais."/>
      <Field k="coldDays" label="Vira frio em (dias)"/>
      <Field k="onboardingDays" label="Janela de onboarding (dias)"/>
      <Field k="atRiskDropPct" label="Em risco: queda de (%)" hint="Frente à média semanal dele mesmo."/>
      <Field k="atRiskWeeks" label="Em risco: semanas da média"/>
      <Field k="upgradeWeeks" label="Upgrade: semanas seguidas"/>
      <Field k="upgradeSalesAscendente" label="Vendas/semana p/ Ascendente" hint="Chute inicial — ajuste com a régua real do programa."/>
      <Field k="upgradeSalesNorth" label="Vendas/semana p/ North" hint="Idem."/>
      <Field k="tierCpaAscendenteMin" label="CPA mínimo p/ inferir Ascendente (US$)"/>
      <Field k="tierCpaNorthMin" label="CPA mínimo p/ inferir North (US$)"/>
      <Field k="minValueUsd" label="Piso de relevância (US$)" hint="Abaixo disso a reativação entra como baixa prioridade."/>
      <button className="btn btn-primary" disabled={busy} onClick={() => onSave(f)}>Salvar parâmetros</button>
    </div>
  );
}

function AffiliateCrmPage({ user }) {
  const [data, setData] = useStateCrm(null);
  const [loading, setLoading] = useStateCrm(true);
  const [err, setErr] = useStateCrm(null);
  const [busy, setBusy] = useStateCrm(false);
  const [segment, setSegment] = useStateCrm('dormente');
  const [tier, setTier] = useStateCrm('');
  const [pendingOnly, setPendingOnly] = useStateCrm(true);
  const [noPhone, setNoPhone] = useStateCrm(false);
  const [q, setQ] = useStateCrm('');
  const [sel, setSel] = useStateCrm(() => new Set());
  const [open, setOpen] = useStateCrm(null);
  const [params, setParams] = useStateCrm(false);
  const [toast, setToast] = useStateCrm(null);

  const query = useMemoCrm(() => ({
    segment, tier: tier || undefined, pending: pendingOnly ? 1 : undefined,
    phone: noPhone ? 0 : undefined, q: q.trim() || undefined,
  }), [segment, tier, pendingOnly, noPhone, q]);

  const load = useCallbackCrm(async () => {
    setLoading(true); setErr(null);
    try { setData(await window.NSApi.fetchAffiliateCrm(query)); }
    catch (e) { setErr(e.message || String(e)); }
    finally { setLoading(false); }
  }, [query]);

  useEffectCrm(() => { load(); }, [load]);
  useEffectCrm(() => { setSel(new Set()); }, [segment, tier, pendingOnly, noPhone]);
  useEffectCrm(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const rows = data?.rows || [];
  const sum = data?.summary;
  const counts = sum?.bySegment || {};

  async function act(body, msg) {
    setBusy(true);
    try {
      await window.NSApi.adminAffiliateCrm(body);
      if (msg) setToast(`✓ ${msg}`);
      await load();
      if (open) setOpen(null);
    } catch (e) { setToast(`Não deu: ${e.message || e}`); }
    finally { setBusy(false); }
  }

  const doTouch = (r, touchpoint, tag) => act(
    { action: 'touch', crmKey: r.key, cycleKey: r.cycleKey, segment: r.segment, touchpoint, tag },
    touchpoint === 'SKIP' ? `${r.name} fora da fila neste ciclo` : `${r.name}: ${touchpoint} registrado`,
  );
  const doUntouch = (r, touchpoint) => act(
    { action: 'untouch', crmKey: r.key, cycleKey: r.cycleKey, touchpoint }, 'toque desfeito',
  );
  const doSaveProfile = (patch) => act({ action: 'profile', ...patch }, 'contato salvo');
  const doSaveParams = (cfg) => act({ action: 'config', config: cfg }, 'parâmetros salvos').then(() => setParams(false));

  async function markSelected() {
    const items = rows.filter((r) => sel.has(r.key) && r.nextTouch).map((r) => ({
      crmKey: r.key, cycleKey: r.cycleKey, segment: r.segment, touchpoint: r.nextTouch.id, tag: r.nextTouch.tag,
    }));
    if (!items.length) return;
    await act({ action: 'touch_batch', items }, `${items.length} toques registrados`);
    setSel(new Set());
  }

  const exportUrl = window.NSApi.affiliateCrmExportUrl({ ...query, pending: pendingOnly ? 1 : 0 });
  const pendentes = rows.filter((r) => r.pending).length;

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <CrmKpi label="FILA DE HOJE" value={fmtInt(sum?.pending || 0)} sub="afiliados devendo toque" tone="var(--accent)"/>
        <CrmKpi label="VALOR NA FILA" value={fmtCurrency(sum?.valuePendingUsd || 0, 'USD', 0)} sub="melhor mês de quem está parado" tone="var(--money)"/>
        <CrmKpi label="SEM WHATSAPP" value={fmtInt(sum?.pendingWithoutPhone || 0)}
          sub={`de ${fmtInt(sum?.pending || 0)} na fila · ${fmtInt(sum?.withoutPhone || 0)} na base`}
          tone={(sum?.pendingWithoutPhone || 0) > 0 ? 'var(--warning)' : 'var(--fg1)'}/>
        <CrmKpi label="DORMENTES" value={fmtInt(counts.dormente || 0)} sub={`${fmtInt(counts.em_risco || 0)} em risco · ${fmtInt(counts.frio || 0)} frios`}/>
        <CrmKpi label="TOQUE → VENDA (30D)" value={sum?.conversionPct != null ? `${sum.conversionPct}%` : '—'}
          sub={`${fmtInt(sum?.converted30 || 0)} de ${fmtInt(sum?.touches30 || 0)} toques em até 7 dias`}/>
      </div>

      <div className="panel" style={{ padding: '10px 14px', marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {CRM_SEGMENTS.map((s) => (
          <button key={s.id} title={s.desc} onClick={() => setSegment(s.id)}
            className={segment === s.id ? 'chip is-active' : 'chip'}>
            {s.label} <span className="cnt">{fmtInt(counts[s.id] || 0)}</span>
          </button>
        ))}
      </div>

      <div className="panel" style={{ padding: '10px 14px', marginBottom: 12, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="buscar afiliado…" style={{ width: 190 }}/>
        <select value={tier} onChange={(e) => setTier(e.target.value)}>
          <option value="">todos os tiers</option>
          {CRM_TIERS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
          <input type="checkbox" checked={pendingOnly} onChange={(e) => setPendingOnly(e.target.checked)}/>
          só quem está devendo toque
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
          <input type="checkbox" checked={noPhone} onChange={(e) => setNoPhone(e.target.checked)}/>
          só sem WhatsApp
        </label>
        <div style={{ flex: 1 }}/>
        {sel.size > 0 && (
          <button className="btn btn-primary" disabled={busy} onClick={markSelected}>
            <Icon name="check" size={13}/> marcar {sel.size} como enviados
          </button>
        )}
        <a className="btn btn-ghost" href={exportUrl} download>
          <Icon name="download" size={13}/> baixar CSV
        </a>
        {user?.role === 'ADMIN' && (
          <button className="btn btn-ghost" onClick={() => setParams(true)}><Icon name="sliders" size={13}/> parâmetros</button>
        )}
      </div>

      {err && <div className="panel" style={{ padding: 14, color: 'var(--danger)', marginBottom: 12 }}>{err}</div>}

      <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="tbl" style={{ fontSize: 12.5, minWidth: 900 }}>
          <thead>
            <tr>
              <th style={{ width: 28 }}/>
              <th>Afiliado</th><th>Tier</th><th className="num">Sem vender</th><th className="num">CPA</th>
              <th className="num">Valor</th><th>WhatsApp</th><th>Próximo toque</th><th>Prioridade</th><th>Alertas</th><th/>
            </tr>
          </thead>
          <tbody>
            {loading && <SkelTableRows rows={8} cols={11}/>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={11} style={{ padding: 22, textAlign: 'center', color: 'var(--fg5)' }}>
                Ninguém neste filtro. {pendingOnly ? 'A fila deste segmento está zerada — bom sinal.' : ''}
              </td></tr>
            )}
            {!loading && rows.map((r) => (
              <CrmRow key={r.key} r={r} checked={sel.has(r.key)} onOpen={setOpen} onTouch={doTouch}
                onCheck={(k, on) => { const n = new Set(sel); if (on) n.add(k); else n.delete(k); setSel(n); }}/>
            ))}
          </tbody>
        </table>
      </div>

      {data && (
        <div className="panel-sub" style={{ fontSize: 11, marginTop: 8 }}>
          {fmtInt(pendentes)} na fila deste filtro · dados até {data.anchorDay} (BRT) · semana {data.weekKey}
          {data.truncated ? ' · lista truncada' : ''}
          {' · '}o CSV sai com as colunas do playbook (nome, whatsapp, tier, dias_sem_venda, produto_principal, cpa_atual, tag_sugerida)
        </div>
      )}

      {open && (
        <CrmDrawer row={rows.find((r) => r.key === open.key) || open} busy={busy}
          onClose={() => setOpen(null)} onSave={doSaveProfile} onTouch={doTouch} onUntouch={doUntouch}/>
      )}
      {params && data && (
        <CrmParams config={data.config} busy={busy} onSave={doSaveParams} onClose={() => setParams(false)}/>
      )}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 22, left: '50%', transform: 'translateX(-50%)', zIndex: 80,
          background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: '10px 18px',
          boxShadow: 'var(--shadow)', fontSize: 13,
        }}>{toast}</div>
      )}
    </div>
  );
}

Object.assign(window, { AffiliateCrmPage });
