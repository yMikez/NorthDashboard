/* global React, Icon, fmtCurrency, fmtInt, fmtDateTime, platBadge, SkelTableRows */
/* Lucro real (admin-only): lucro líquido da empresa por canal — front-end
   (plataformas), call centers, recuperação (Skill99 / SMS) e SalesBound —
   com cada linha de custo isolada, parâmetros editáveis (custo de produto
   por canal/etapa, reembolso observado ou % fixo, comissões, taxas), visão
   por afiliado, participações % e projeções salvas pra comparação.
   API: GET/POST /api/admin/net-profit, PUT …/params, GET/POST/DELETE …/scenarios */

const { useState: useStateNP, useEffect: useEffectNP, useRef: useRefNP, useMemo: useMemoNP } = React;

const NP_INPUT = { padding: '6px 8px', fontSize: 12, color: 'var(--fg1)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'var(--f-mono)', width: 92, textAlign: 'right' };
const NP_STAGES = [['FRONTEND', 'Front-end'], ['UPSELL', 'Upsell'], ['DOWNSELL', 'Downsell'], ['BUMP', 'Bump'], ['SMS_RECOVERY', 'Recovery (funil)']];
const NP_SOURCE = {
  observed: { label: 'observado', color: 'var(--success)', hint: 'Medido nos dados do período' },
  manual:   { label: 'manual',    color: 'var(--accent)',  hint: 'Parâmetro informado por você' },
  config:   { label: 'config',    color: 'var(--fg4)',     hint: 'Cadastro (Plataformas / Integrações)' },
  default:  { label: 'padrão',    color: 'var(--fg5)',     hint: 'Valor padrão do sistema' },
  none:     { label: 'faltando',  color: 'var(--warning)', hint: 'Sem dado nem parâmetro — está em 0' },
};

function npMoney(v, cur, digits = 0) { return fmtCurrency(v || 0, cur, digits); }
function npPct(v, digits = 1) { return v == null ? '—' : `${Number(v).toFixed(digits)}%`; }
function npGet(obj, path) { return path.reduce((o, k) => (o == null ? undefined : o[k]), obj); }
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

// Campo numérico que aceita vazio (= null → usa o observado/configurado).
function NpNum({ value, onChange, suffix = '%', placeholder = '', width, step = '0.01', max }) {
  const [draft, setDraft] = useStateNP(value == null ? '' : String(value));
  useEffectNP(() => { setDraft(value == null ? '' : String(value)); }, [value]);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <input type="number" step={step} min="0" max={max} value={draft} placeholder={placeholder}
        style={{ ...NP_INPUT, ...(width ? { width } : {}) }}
        onChange={(e) => {
          const raw = e.target.value; setDraft(raw);
          if (raw === '') { onChange(null); return; }
          const n = Number(raw); if (Number.isFinite(n) && n >= 0) onChange(n);
        }}/>
      {suffix && <span style={{ fontSize: 11, color: 'var(--fg4)', fontFamily: 'var(--f-mono)' }}>{suffix}</span>}
    </span>
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

// Tabela de linhas (faturamento → deduções → lucro) de um canal ou de um
// item do breakdown.
function NpLines({ gross, lines, profit, marginPct, cur, dense }) {
  const fs = dense ? 11 : 12;
  return (
    <table className="tbl" style={{ fontSize: fs }}>
      <tbody>
        <tr>
          <td style={{ fontWeight: 600 }}>Faturamento</td>
          <td className="num cell-mono" style={{ color: 'var(--fg1)', fontWeight: 600 }}>{npMoney(gross, cur)}</td>
          <td className="num cell-mono" style={{ color: 'var(--fg5)' }}>100%</td>
          <td/>
        </tr>
        {lines.map((l) => (
          <tr key={l.key} title={l.note || ''}>
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

function NpChannelCard({ ch, cur }) {
  const [open, setOpen] = useStateNP(false);
  return (
    <div className="panel" style={{ marginBottom: 0, opacity: ch.available ? 1 : 0.6 }}>
      <div className="panel-head" style={{ marginBottom: 8 }}>
        <div className="panel-title" style={{ minWidth: 0 }}>
          <span className="panel-eyebrow">{ch.label.toUpperCase()}</span>
          <div className="panel-sub">
            {ch.available
              ? `${fmtInt(ch.orders)} vendas · ${npPct(ch.shareOfRevenuePct)} do faturamento · ${npPct(ch.shareOfProfitPct)} do lucro`
              : 'sem dado no período (nem parâmetro manual)'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="cell-mono" style={{ fontSize: 18, fontWeight: 700, color: ch.profit >= 0 ? 'var(--money)' : 'var(--danger)' }}>{npMoney(ch.profit, cur)}</div>
          <div style={{ fontSize: 10, color: 'var(--fg4)', fontFamily: 'var(--f-mono)' }}>margem {npPct(ch.marginPct)}</div>
        </div>
      </div>
      <div className="tbl-wrap" style={{ margin: 0, padding: 0 }}>
        <NpLines gross={ch.gross} lines={ch.lines} profit={ch.profit} marginPct={ch.marginPct} cur={cur}/>
      </div>
      {ch.breakdown.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button className="btn btn-ghost" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => setOpen((v) => !v)}>
            <Icon name={open ? 'chevron-down' : 'chevron-right'} size={10}/> {open ? 'ocultar' : 'abrir'} desagregação ({ch.breakdown.length})
          </button>
          {open && (
            <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
              {ch.breakdown.map((b) => (
                <div key={b.key} style={{ border: '1px solid var(--border-soft)', borderRadius: 8, padding: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{b.label}</span>
                    <span className="cell-mono" style={{ fontSize: 11, color: 'var(--fg4)' }}>{fmtInt(b.orders)} vendas · {npPct(ch.gross > 0 ? (b.gross / ch.gross) * 100 : 0)} do canal</span>
                  </div>
                  <div className="tbl-wrap" style={{ margin: 0, padding: 0 }}>
                    <NpLines gross={b.gross} lines={b.lines} profit={b.profit} marginPct={b.marginPct} cur={cur} dense/>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Painel de parâmetros. `obs` = % real observado (sugestão/fallback).
function NpParamsPanel({ params, setParam, obs, platforms, dirty, onSave, onReset, busy }) {
  const row = { display: 'grid', gridTemplateColumns: 'minmax(160px, 220px) 1fr', gap: 8, alignItems: 'center' };
  const Sec = ({ title, hint, children }) => (
    <div style={{ paddingTop: 10, borderTop: '1px solid var(--border-soft)' }}>
      <div className="f-label" style={{ marginBottom: 6 }}>{title}{hint && <span style={{ marginLeft: 8, fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--fg5)' }}>{hint}</span>}</div>
      <div style={{ display: 'grid', gap: 6 }}>{children}</div>
    </div>
  );
  const hintPct = (v) => (v == null ? 'sem dado' : `observado ${npPct(v)}`);
  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="panel-head">
        <div className="panel-title">
          <span className="panel-eyebrow">PARÂMETROS DO CÁLCULO · PROJEÇÃO</span>
          <div className="panel-sub">Campo vazio = usa o valor observado/cadastrado (chip "observado"/"config"). Tudo recalcula ao digitar; "Salvar parâmetros" fixa como padrão da aba.</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" disabled={!dirty || busy} onClick={onReset}>Descartar</button>
          <button className="btn btn-primary" disabled={!dirty || busy} onClick={onSave}>{busy ? 'salvando…' : 'Salvar parâmetros'}</button>
        </div>
      </div>

      <Sec title="REEMBOLSO / CHARGEBACK" hint="observado = valor já calculado no dashboard (por data do estorno); manual = % fixo sobre o faturamento, pra projeção">
        <div style={row}>
          <span style={{ fontSize: 12 }}>Modo</span>
          <div className="seg">
            <button className={params.refundMode === 'observed' ? 'is-active' : ''} onClick={() => setParam(['refundMode'], 'observed')}>observado</button>
            <button className={params.refundMode === 'manual' ? 'is-active' : ''} onClick={() => setParam(['refundMode'], 'manual')}>% manual</button>
          </div>
        </div>
        {params.refundMode === 'manual' && (
          <div style={{ ...row, alignItems: 'start' }}>
            <span style={{ fontSize: 12 }}>% por canal</span>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {[['front', 'Front-end'], ['callcenter', 'Call centers'], ['recovery', 'Recuperação'], ['salesbound', 'SalesBound']].map(([k, l]) => (
                <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg3)' }}>{l} <NpNum value={params.refundPct[k]} onChange={(v) => setParam(['refundPct', k], v)} placeholder="0"/></label>
              ))}
            </div>
          </div>
        )}
      </Sec>

      <Sec title="CUSTO DE PRODUTO" hint="% do faturamento; vazio = real observado (COGS + frete dos pedidos do período)">
        <div style={{ ...row, alignItems: 'start' }}>
          <span style={{ fontSize: 12 }}>Front-end por etapa</span>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {NP_STAGES.map(([s, l]) => (
              <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg3)' }} title={hintPct(obs?.front?.[s])}>
                {l} <NpNum value={params.productCostPct.front[s]} onChange={(v) => setParam(['productCostPct', 'front', s], v)} placeholder={obs?.front?.[s] != null ? String(obs.front[s]) : '—'}/>
              </label>
            ))}
          </div>
        </div>
        <div style={{ ...row, alignItems: 'start' }}>
          <span style={{ fontSize: 12 }}>Outros canais</span>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg3)' }} title={`vazio = ${hintPct(obs?.front?.FRONTEND)} (front-end)`}>Call centers <NpNum value={params.productCostPct.callcenter} onChange={(v) => setParam(['productCostPct', 'callcenter'], v)} placeholder={obs?.front?.FRONTEND != null ? String(obs.front.FRONTEND) : '—'}/></label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg3)' }} title={hintPct(obs?.recovery)}>Recuperação <NpNum value={params.productCostPct.recovery} onChange={(v) => setParam(['productCostPct', 'recovery'], v)} placeholder={obs?.recovery != null ? String(obs.recovery) : (obs?.front?.FRONTEND != null ? String(obs.front.FRONTEND) : '—')}/></label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg3)' }}>SalesBound <NpNum value={params.productCostPct.salesbound} onChange={(v) => setParam(['productCostPct', 'salesbound'], v)} placeholder="informe"/></label>
          </div>
        </div>
      </Sec>

      <Sec title="COMISSÕES" hint="vazio = acordo cadastrado (Call Center / Recuperação); SMS próprio padrão 0%">
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg3)' }}>Tauk <NpNum value={params.commissionPct.tauk} onChange={(v) => setParam(['commissionPct', 'tauk'], v)} placeholder="cadastro"/></label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg3)' }}>Logicall <NpNum value={params.commissionPct.logicall} onChange={(v) => setParam(['commissionPct', 'logicall'], v)} placeholder="cadastro"/></label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg3)' }} title="Sobrescreve a taxa de TODOS os afiliados de recuperação (vazio = taxa vigente de cada um)">Recuperação (parceiros) <NpNum value={params.commissionPct.recoveryOverride} onChange={(v) => setParam(['commissionPct', 'recoveryOverride'], v)} placeholder="por afiliado"/></label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg3)' }}>SMS próprio <NpNum value={params.commissionPct.sms} onChange={(v) => setParam(['commissionPct', 'sms'], v ?? 0)} placeholder="0"/></label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg3)' }}>SalesBound <NpNum value={params.commissionPct.salesbound} onChange={(v) => setParam(['commissionPct', 'salesbound'], v)} placeholder="informe"/></label>
        </div>
      </Sec>

      <Sec title="TAXA DA PLATAFORMA E ALLOWANCE" hint="vazio = cadastro da aba Plataformas; override só nesta projeção">
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {platforms.map((p) => (
            <div key={p.slug} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--fg3)', border: '1px solid var(--border-soft)', borderRadius: 8, padding: '4px 8px' }}>
              <span className={`plat ${platBadge(p.slug).cls}`}>{platBadge(p.slug).short}</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }} title={`cadastro: ${p.feePct == null ? 'não cadastrada' : npPct(p.feePct, 2)}`}>taxa <NpNum value={params.feePctOverride[p.slug] ?? null} onChange={(v) => setParam(['feePctOverride', p.slug], v)} placeholder={p.feePct == null ? '—' : String(p.feePct)} width={70}/></label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }} title={`cadastro: ${p.allowancePct == null ? 'não cadastrado' : npPct(p.allowancePct, 2)}`}>allow. <NpNum value={params.allowancePctOverride[p.slug] ?? null} onChange={(v) => setParam(['allowancePctOverride', p.slug], v)} placeholder={p.allowancePct == null ? '—' : String(p.allowancePct)} width={70}/></label>
            </div>
          ))}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg3)' }}>
            <input type="checkbox" checked={params.includeAllowance} onChange={(e) => setParam(['includeAllowance'], e.target.checked)}/> descontar allowance (reserva) do lucro front
          </label>
        </div>
      </Sec>

      <Sec title="SALESBOUND · DADOS MANUAIS" hint="enquanto o postback não traz eventos, informe o período: faturamento, nº de vendas e estornos em USD">
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg3)' }}>Faturamento <NpNum value={params.salesbound.grossUsd || null} onChange={(v) => setParam(['salesbound', 'grossUsd'], v ?? 0)} suffix="USD" placeholder="0" width={110}/></label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg3)' }}>Vendas <NpNum value={params.salesbound.sales} onChange={(v) => setParam(['salesbound', 'sales'], v)} suffix="" step="1" placeholder="0" width={70}/></label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg3)' }}>Estornos <NpNum value={params.salesbound.refundsUsd} onChange={(v) => setParam(['salesbound', 'refundsUsd'], v)} suffix="USD" placeholder="0" width={110}/></label>
        </div>
      </Sec>

      <Sec title="DUPLICAÇÃO" hint="vendas dos afiliados de recuperação e do SMS próprio também passam pelas plataformas">
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg3)' }}>
          <input type="checkbox" checked={params.dedupeRecovery} onChange={(e) => setParam(['dedupeRecovery'], e.target.checked)}/>
          subtrair automaticamente a receita de recuperação/SMS do front-end (evita contar duas vezes)
        </label>
      </Sec>
    </div>
  );
}

function NpNeeds({ needs }) {
  if (!needs || needs.length === 0) return null;
  const req = needs.filter((n) => n.severity === 'required');
  const sug = needs.filter((n) => n.severity !== 'required');
  const Item = ({ n }) => (
    <div style={{ display: 'grid', gridTemplateColumns: '10px 1fr', gap: 8, alignItems: 'start', fontSize: 12 }}>
      <span style={{ width: 8, height: 8, borderRadius: 4, marginTop: 5, background: n.severity === 'required' ? 'var(--danger)' : 'var(--warning)' }}/>
      <div>
        <div style={{ fontWeight: 600 }}>{n.title}</div>
        <div style={{ color: 'var(--fg4)', lineHeight: 1.45 }}>{n.detail}</div>
        <div className="cell-mono" style={{ fontSize: 11, color: 'var(--accent)', marginTop: 2 }}>→ {n.format}</div>
      </div>
    </div>
  );
  return (
    <div className="panel" style={{ marginBottom: 14, borderColor: req.length ? 'color-mix(in oklab, var(--danger) 35%, transparent)' : undefined }}>
      <div className="panel-head" style={{ marginBottom: 8 }}>
        <div className="panel-title">
          <span className="panel-eyebrow">O QUE VOCÊ PRECISA INFORMAR</span>
          <div className="panel-sub">{req.length} obrigatório(s) · {sug.length} sugerido(s) — o cálculo roda mesmo assim, com o fallback indicado</div>
        </div>
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        {req.map((n) => <Item key={n.key} n={n}/>)}
        {sug.map((n) => <Item key={n.key} n={n}/>)}
      </div>
    </div>
  );
}

function NpAffiliates({ rows, cur }) {
  const [q, setQ] = useStateNP('');
  const [showAll, setShowAll] = useStateNP(false);
  const qn = q.trim().toLowerCase();
  const list = rows.filter((a) => !qn || (a.nickname || '').toLowerCase().includes(qn) || a.externalId.toLowerCase().includes(qn) || (a.mappedName || '').toLowerCase().includes(qn));
  const shown = showAll ? list : list.slice(0, 60);
  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="panel-head">
        <div className="panel-title">
          <span className="panel-eyebrow">LUCRO POR AFILIADO · MESMA FÓRMULA DO CANAL</span>
          <div className="panel-sub">{fmtInt(rows.length)} contas com venda no período · front-end: Faturamento − CPA − Reembolso − Taxa − Custo − Allowance · recuperação: − Comissão − Custo − Reembolso</div>
        </div>
        <div className="select-btn" style={{ padding: '0 10px', width: 'min(240px, 100%)' }}>
          <Icon name="search" size={13}/>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar afiliado…" style={{ background: 'transparent', border: 0, color: 'var(--fg1)', outline: 'none', flex: 1, fontFamily: 'var(--f-body)', fontSize: 12 }}/>
        </div>
      </div>
      <div className="tbl-wrap" style={{ margin: 0, padding: 0, maxHeight: 620, overflowY: 'auto' }}>
        <table className="tbl tbl--sticky-first">
          <thead>
            <tr>
              <th>Afiliado</th><th>Plat.</th><th>Canal</th>
              <th className="num">Faturamento</th>
              <th className="num" title="participação no faturamento TOTAL (todos os canais)">% total</th>
              <th className="num" title="participação no faturamento do próprio canal">% canal</th>
              <th className="num" title="front: CPA pago · recuperação: comissão">CPA / comissão</th>
              <th className="num">Reembolso</th>
              <th className="num">Taxa</th>
              <th className="num">Custo prod.</th>
              <th className="num">Allowance</th>
              <th className="num">Lucro</th>
              <th className="num">Margem</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={13} style={{ textAlign: 'center', padding: 20, opacity: 0.6 }}>Nenhum afiliado</td></tr>}
            {shown.map((a) => {
              const pb = platBadge(a.platformSlug);
              return (
                <tr key={a.affiliateId}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{a.nickname || a.externalId}</div>
                    <div className="cell-mono" style={{ fontSize: 10, color: 'var(--fg5)' }}>{a.externalId}{a.mappedName ? ` · ${a.mappedName}` : ''}</div>
                  </td>
                  <td><span className={`plat ${pb.cls}`}>{pb.short}</span></td>
                  <td><span className={`badge ${a.channel === 'recovery' ? 'warn' : 'neutral'}`}>{a.channel === 'recovery' ? 'RECUPERAÇÃO' : 'FRONT'}</span></td>
                  <td className="num cell-mono" style={{ color: 'var(--fg1)' }}>{npMoney(a.gross, cur)}</td>
                  <td className="num cell-mono">{npPct(a.shareOfRevenuePct)}</td>
                  <td className="num cell-mono" style={{ color: 'var(--fg4)' }}>{npPct(a.shareOfChannelPct)}</td>
                  <td className="num cell-mono">{npMoney(a.cpa, cur)}</td>
                  <td className="num cell-mono">{npMoney(a.refund, cur)}</td>
                  <td className="num cell-mono">{npMoney(a.fee, cur)}</td>
                  <td className="num cell-mono">{npMoney(a.productCost, cur)}</td>
                  <td className="num cell-mono">{npMoney(a.allowance, cur)}</td>
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

function NpScenarios({ scenarios, current, cur, onApply, onDelete, onSave, busy }) {
  const [name, setName] = useStateNP('');
  const [note, setNote] = useStateNP('');
  const [compare, setCompare] = useStateNP(null);
  const delta = (a, b) => a - b;
  const Delta = ({ v, money }) => (
    <span className="cell-mono" style={{ fontSize: 10, marginLeft: 6, color: v > 0 ? 'var(--success)' : v < 0 ? 'var(--danger)' : 'var(--fg5)' }}>
      {v > 0 ? '+' : ''}{money ? npMoney(v, cur) : `${v.toFixed(1)} pp`}
    </span>
  );
  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="panel-head" style={{ flexWrap: 'wrap' }}>
        <div className="panel-title">
          <span className="panel-eyebrow">PROJEÇÕES SALVAS · HISTÓRICO E COMPARAÇÃO</span>
          <div className="panel-sub">Cada projeção guarda os parâmetros e o resultado do momento. Δ = projeção vs. cálculo ATUAL (parâmetros em edição).</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="nome da projeção" style={{ ...NP_INPUT, width: 200, textAlign: 'left', fontFamily: 'var(--f-body)' }}/>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="nota (opcional)" style={{ ...NP_INPUT, width: 220, textAlign: 'left', fontFamily: 'var(--f-body)' }}/>
          <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => { onSave(name.trim(), note.trim()); setName(''); setNote(''); }}>{busy ? '…' : 'Salvar projeção'}</button>
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
                  <td className="num cell-mono">{npMoney(s.summary.revenue, cur)}{on && current && <Delta v={delta(s.summary.revenue, current.revenue)} money/>}</td>
                  <td className="num cell-mono">{npMoney(s.summary.costs, cur)}{on && current && <Delta v={delta(s.summary.costs, current.costs)} money/>}</td>
                  <td className="num cell-mono" style={{ color: 'var(--money)', fontWeight: 600 }}>{npMoney(s.summary.profit, cur)}{on && current && <Delta v={delta(s.summary.profit, current.profit)} money/>}</td>
                  <td className="num cell-mono">{npPct(s.summary.marginPct)}{on && current && <Delta v={delta(s.summary.marginPct, current.marginPct)}/>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-ghost" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => setCompare(on ? null : s.id)}>{on ? 'ocultar Δ' : 'comparar'}</button>
                    <button className="btn btn-ghost" style={{ fontSize: 10, padding: '2px 6px' }} title="Carrega os parâmetros desta projeção no painel (não salva)" onClick={() => onApply(s.params)}>aplicar</button>
                    <button className="btn btn-ghost" style={{ fontSize: 10, padding: '2px 6px', color: 'var(--danger)' }} onClick={() => { if (confirm(`Excluir a projeção "${s.name}"?`)) onDelete(s.id); }}>excluir</button>
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
  const [showParams, setShowParams] = useStateNP(true);
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
        setPlatforms((d.result?.channels?.[0]?.breakdown || []).map((b) => ({ slug: b.key, displayName: b.label }))
          .map((p) => {
            const fee = (d.result.channels[0].breakdown.find((b) => b.key === p.slug)?.lines || []).find((l) => l.key === 'fee');
            const al = (d.result.channels[0].breakdown.find((b) => b.key === p.slug)?.lines || []).find((l) => l.key === 'allowance');
            const pct = (l) => (l && l.note && /^[\d.]+%$/.test(l.note) ? Number(l.note.replace('%', '')) : null);
            return { ...p, feePct: pct(fee), allowancePct: pct(al) };
          }));
        setState({ status: 'ready', error: null });
      })
      .catch((err) => { if (!cancelled) setState({ status: 'error', error: err.message }); });
    return () => { cancelled = true; };
  }, [periodKey]);

  // Recalcula (debounce) sempre que os parâmetros mudam.
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
    }, 300);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [params]);

  const dirty = useMemoNP(() => JSON.stringify(params) !== JSON.stringify(savedParams), [params, savedParams]);
  const setParam = (path, value) => setParams((p) => npSet(p, path, value));

  async function saveParams() {
    setBusy(true); setMsg(null);
    try { const r = await window.NSApi.adminSaveNetProfitParams(params); setSavedParams(r.params); setParams(r.params); setMsg({ ok: true, text: 'parâmetros salvos como padrão' }); }
    catch (e) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(false); }
  }
  async function saveScenario(name, note) {
    setBusy(true); setMsg(null);
    try {
      await window.NSApi.adminSaveNetProfitScenario({ name, note, params, filters });
      setScenarios((await window.NSApi.adminListNetProfitScenarios()).scenarios);
      setMsg({ ok: true, text: `projeção "${name}" salva` });
    } catch (e) { setMsg({ ok: false, text: e.message }); }
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
  const k = result?.kpis;
  const loading = state.status === 'loading' || !result;

  return (
    <div className="page-in">
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">ADMIN · LUCRO REAL</span>
          <h2>Quanto <em>sobra de verdade</em>.</h2>
          <span className="sub">Front-end (plataformas) + call centers + recuperação + SalesBound, cada linha de custo isolada · período da barra acima (filtros de plataforma/família não se aplicam) · {computing ? 'recalculando…' : 'atualizado'}</span>
        </div>
        <div className="page-head-actions" style={{ flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" onClick={() => setShowParams((v) => !v)}><Icon name="sliders" size={12}/> {showParams ? 'ocultar' : 'mostrar'} parâmetros</button>
          <button className="btn btn-primary" disabled={!dirty || busy} onClick={saveParams}>{busy ? '…' : 'Salvar parâmetros'}</button>
        </div>
      </div>
      {msg && <div style={{ fontSize: 11, fontFamily: 'var(--f-mono)', color: msg.ok ? 'var(--success)' : 'var(--danger)', marginBottom: 8 }}>{msg.text}</div>}

      <div className="mini-kpis" style={{ marginBottom: 14 }}>
        <NpKpi label="Total faturado" value={loading ? '…' : npMoney(k.revenue, cur)} money sub="todos os canais · vendas aprovadas do período"/>
        <NpKpi label="Total de custos" value={loading ? '…' : npMoney(k.costs, cur)} accent="var(--danger)" sub="CPA + reembolsos + taxas + produto + allowance + comissões"/>
        <NpKpi label="Lucro líquido" value={loading ? '…' : npMoney(k.profit, cur)} accent={!loading && k.profit < 0 ? 'var(--danger)' : 'var(--money)'} sub="soma dos lucros por canal"/>
        <NpKpi label="Margem de lucro" value={loading ? '…' : npPct(k.marginPct)} accent={!loading && (k.marginPct >= 15 ? 'var(--success)' : k.marginPct >= 5 ? 'var(--warning)' : 'var(--danger)')} sub="lucro ÷ faturamento"/>
      </div>

      {!loading && <NpNeeds needs={needs}/>}

      {!loading && showParams && params && (
        <NpParamsPanel params={params} setParam={setParam} obs={result.observedProductCostPct} platforms={platforms}
          dirty={dirty} busy={busy} onSave={saveParams} onReset={() => { skipCompute.current = false; setParams(savedParams); }}/>
      )}

      {!loading && result.warnings?.length > 0 && (
        <div className="panel" style={{ marginBottom: 14, fontSize: 12, color: 'var(--warning)' }}>
          {result.warnings.map((w) => <div key={w}>⚠ {w}</div>)}
        </div>
      )}

      <div className="grid-2" style={{ marginBottom: 14 }}>
        {loading ? [0, 1, 2, 3].map((i) => <div key={i} className="panel"><SkelTableRows rows={5} cols={3}/></div>)
          : result.channels.map((ch) => <NpChannelCard key={ch.key} ch={ch} cur={cur}/>)}
      </div>

      {!loading && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-head" style={{ marginBottom: 8 }}>
            <div className="panel-title"><span className="panel-eyebrow">PARTICIPAÇÃO POR CANAL</span></div>
          </div>
          <div className="tbl-wrap" style={{ margin: 0, padding: 0 }}>
            <table className="tbl">
              <thead><tr><th>Canal</th><th className="num">Faturamento</th><th className="num">% do faturamento</th><th className="num">Custos</th><th className="num">Lucro</th><th className="num">% do lucro</th><th className="num">Margem</th></tr></thead>
              <tbody>
                {result.channels.map((c) => (
                  <tr key={c.key} style={{ opacity: c.available ? 1 : 0.5 }}>
                    <td style={{ fontWeight: 600 }}>{c.label}</td>
                    <td className="num cell-mono">{npMoney(c.gross, cur)}</td>
                    <td className="num cell-mono">{npPct(c.shareOfRevenuePct)}</td>
                    <td className="num cell-mono" style={{ color: 'var(--danger)' }}>{npMoney(c.costs, cur)}</td>
                    <td className="num cell-mono" style={{ color: c.profit >= 0 ? 'var(--money)' : 'var(--danger)', fontWeight: 600 }}>{npMoney(c.profit, cur)}</td>
                    <td className="num cell-mono">{npPct(c.shareOfProfitPct)}</td>
                    <td className="num cell-mono">{npPct(c.marginPct)}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: '1px solid var(--border)', fontWeight: 700 }}>
                  <td>Total</td>
                  <td className="num cell-mono">{npMoney(k.revenue, cur)}</td><td className="num cell-mono">100%</td>
                  <td className="num cell-mono" style={{ color: 'var(--danger)' }}>{npMoney(k.costs, cur)}</td>
                  <td className="num cell-mono" style={{ color: 'var(--money)' }}>{npMoney(k.profit, cur)}</td><td className="num cell-mono">100%</td>
                  <td className="num cell-mono">{npPct(k.marginPct)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && <NpAffiliates rows={result.affiliates} cur={cur}/>}

      {!loading && (
        <NpScenarios scenarios={scenarios} current={k} cur={cur} busy={busy}
          onSave={saveScenario} onDelete={deleteScenario}
          onApply={(p) => { setParams(p); setMsg({ ok: true, text: 'parâmetros da projeção carregados (não salvos)' }); }}/>
      )}
    </div>
  );
}

Object.assign(window, { NetProfitPage });
