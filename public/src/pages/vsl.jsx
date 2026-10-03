/* global React, Icon, fmtInt, fmtCurrency, fmtDateShort, fmtDateTime, Paginated, ReadState, NSTimeSeries, SkelTableRows */
/* Aba VSLs — a VSL de cada página de upsell/downsell vem do dash.
   A equipe cola UMA vez o snippet gerado aqui no lugar do player do VTurb;
   depois disso, trocar VSL, ajustar o pitch, pré-visualizar e rodar teste A/B
   é tudo por esta aba. O snippet tem reserva: se o dash cair, a página toca a
   VSL que já tinha.
   Seções: Desempenho · Páginas · Biblioteca · Testes A/B · Histórico.
   API: GET /api/vsl-admin/state · POST /api/vsl-admin/actions ·
        GET /api/vsl-admin/performance (período/plataforma/família do filtro global). */

const { useState: useStateVsl, useEffect: useEffectVsl, useMemo: useMemoVsl, useCallback: useCallbackVsl, useRef: useRefVsl } = React;

const VSL_SECTIONS = [
  { id: 'overview', label: 'Desempenho', icon: 'bar-chart-3' },
  { id: 'pages', label: 'Páginas', icon: 'layers' },
  { id: 'library', label: 'Biblioteca', icon: 'monitor-play' },
  { id: 'tests', label: 'Testes A/B', icon: 'flask' },
  { id: 'history', label: 'Histórico', icon: 'history' },
];

const VSL_STATUS = {
  live: { label: 'No ar', tone: 'var(--success)', hint: 'A página está mandando sinal nas últimas 24 h.' },
  stale: { label: 'Sem sinal', tone: 'var(--warning)', hint: 'Já recebeu visitas, mas nada nas últimas 24 h — tráfego parado ou snippet removido.' },
  waiting: { label: 'Aguardando instalação', tone: 'var(--fg5)', hint: 'Nenhuma visita ainda: o snippet não foi colado ou a página não recebeu tráfego.' },
  off: { label: 'Desligada', tone: 'var(--danger)', hint: 'Desligada no dash — a página toca a VSL de reserva do snippet.' },
};

const VSL_HISTORY_GROUPS = [
  { id: 'all', label: 'Tudo' },
  { id: 'live', label: 'VSL no ar', kinds: ['vsl_assigned', 'page_enabled', 'page_disabled', 'fallback_set', 'preview_started'] },
  { id: 'tests', label: 'Testes', kinds: ['test_started', 'test_paused', 'test_resumed', 'test_weights', 'test_finished'] },
  { id: 'pages', label: 'Páginas', kinds: ['page_created', 'page_deleted', 'page_url_reset', 'page_variant'] },
  { id: 'affiliates', label: 'Afiliados', kinds: ['aff_rule_created', 'aff_rule_updated', 'aff_rule_deleted', 'aff_rule_enabled', 'aff_rule_disabled'] },
  { id: 'library', label: 'Biblioteca', kinds: ['vsl_created', 'vsl_updated', 'vsl_archived', 'vsl_restored'] },
];

const VSL_VERDICT = {
  insufficient: { label: 'Coletando dados', tone: 'var(--fg4)', bg: 'var(--bg-hover)' },
  running: { label: 'Sem vencedor ainda', tone: 'var(--accent)', bg: 'var(--bg-hover)' },
  leader: { label: 'Vencedor claro', tone: 'var(--success)', bg: 'var(--success-bg)' },
  no_difference: { label: 'Sem diferença', tone: 'var(--warning)', bg: 'var(--warning-bg)' },
};

/** Pesos válidos: inteiros 0–100, somam 100, ao menos 2 com tráfego (mesma regra do servidor). */
function vslWeightsProblem(weights) {
  const w = weights.map((x) => Number(x));
  if (w.some((x) => !Number.isInteger(x) || x < 0 || x > 100)) return 'Cada peso é um número inteiro de 0 a 100.';
  const total = w.reduce((a, b) => a + b, 0);
  if (total !== 100) return `Os pesos somam ${total}% — precisam somar 100%.`;
  if (w.filter((x) => x > 0).length < 2) return 'Pelo menos duas VSLs precisam receber tráfego.';
  return null;
}

/** Abaixo disso, a taxa é ruído — fica no fim do ranking com aviso. */
const VSL_MIN_SAMPLE = 50;
const VSL_EMBED_RE = /https:\/\/scripts\.converteai\.net\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/players\/([0-9a-f]{24})\/(v\d{1,2})\/player\.js/i;
const VSL_PADDING_RE = /padding\s*:\s*([\d.]+)%\s+0(?:px)?\s+0/i;

// ── Helpers ───────────────────────────────────────────────────────────────

function vslFmtPitch(sec) {
  if (sec == null || !isFinite(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

function vslParsePitch(raw) {
  const t = String(raw || '').trim();
  if (/^\d+$/.test(t)) { const n = Number(t); return n > 0 && n <= 21600 ? n : null; }
  const m = /^(?:(\d{1,2}):)?(\d{1,3}):(\d{2})$/.exec(t);
  if (!m) return null;
  const h = Number(m[1] || 0), mi = Number(m[2]), s = Number(m[3]);
  if (s > 59 || (m[1] != null && mi > 59)) return null;
  const total = h * 3600 + mi * 60 + s;
  return total > 0 && total <= 21600 ? total : null;
}

function vslParseEmbed(code) {
  const c = String(code || '').trim();
  if (!c) return null;
  if (c.length > 20000) return { error: 'Código grande demais — cole só o embed do player.' };
  const m = VSL_EMBED_RE.exec(c);
  if (!m) return { error: /vid-[0-9a-f]{24}/i.test(c) ? 'Faltou o <script> com o player.js — cole o embed inteiro.' : 'Não achei um player do VTurb (scripts.converteai.net/…/player.js).' };
  const el = /\bid\s*=\s*["']vid-([0-9a-f]{24})["']/i.exec(c);
  if (el && el[1].toLowerCase() !== m[2].toLowerCase()) return { error: `O elemento é vid-${el[1]} mas o script é de outro player. Copie o embed de novo no VTurb.` };
  const p = VSL_PADDING_RE.exec(c);
  const aspect = p ? Number(p[1]) : null;
  return { playerId: m[2].toLowerCase(), accountId: m[1].toLowerCase(), aspectPct: aspect && aspect >= 20 && aspect <= 300 ? aspect : null };
}

function vslAspect(aspectPct) {
  if (aspectPct == null) return '—';
  return aspectPct > 110 ? 'Vertical' : aspectPct < 90 ? 'Horizontal' : 'Quadrado';
}

function vslPct(x, digits = 1) { return x == null ? '—' : `${(x * 100).toFixed(digits)}%`; }

// Data de um instante no fuso de quem olha (fmtDateShort força UTC: é pra
// dia-bucket, não pra timestamp).
let _vslDayFmt = null;
function vslFmtDay(iso) {
  if (!iso) return '—';
  if (!_vslDayFmt) _vslDayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit' });
  return _vslDayFmt.format(new Date(iso));
}

/** Célula de métrica: "…" carregando, "—" sem dado/falha. */
function vslCell(perfState, value, fmt) {
  if (perfState === 'loading') return '…';
  if (perfState === 'error' || value == null) return '—';
  return fmt(value);
}

function vslAgo(iso, nowMs) {
  if (!iso) return null;
  const s = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (s < 90) return 'agora há pouco';
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  return `há ${Math.round(s / 86400)} d`;
}

/** "GlycoEden · UP01 · 6 potes" — a variante entra quando existe. */
function vslPageName(p, withPlatform) {
  return `${p.family} · ${p.stage}${p.variant ? ` · ${p.variant}` : ''}${withPlatform ? ` · ${p.platform}` : ''}`;
}

/** Rótulo da variante; página sem filtro com variante irmã = "demais potes". */
function vslVariantLabel(p) {
  if (p.variant) return p.variant;
  return p.otherBottles && p.otherBottles.length ? 'demais potes' : '';
}

function vslBottlesText(list) {
  if (!list || !list.length) return 'qualquer front';
  return `front com ${list.join(' ou ')} pote${list.length === 1 && list[0] === 1 ? '' : 's'}`;
}

function vslPageStatus(p, nowMs) {
  if (!p.enabled) return 'off';
  if (!p.installedAt) return 'waiting';
  if (!p.lastSeenAt || nowMs - Date.parse(p.lastSeenAt) > 24 * 3600 * 1000) return 'stale';
  return 'live';
}

async function vslCopy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }
}

// ── Peças de UI ───────────────────────────────────────────────────────────

function VslKpi({ label, value, sub, tone, emphasis, title }) {
  return (
    <div className={`panel vsl-kpi${emphasis ? ' is-emphasis' : ''}`} title={title}>
      <div className="kpi-label">{label}</div>
      <div className="vsl-kpi-value" style={tone ? { color: tone } : null}>{value}</div>
      {sub && <div className="panel-sub">{sub}</div>}
    </div>
  );
}

function VslChip({ children, tone = 'var(--fg4)', title }) {
  return <span className="vsl-pill" title={title} style={{ color: tone, background: `color-mix(in oklab, ${tone} 12%, transparent)` }}>{children}</span>;
}

function VslStatus({ status, page, nowMs }) {
  const s = VSL_STATUS[status];
  const when = status === 'live' || status === 'stale' ? vslAgo(page.lastSeenAt, nowMs) : null;
  return (
    <span className="vsl-status" title={s.hint}>
      <span className="vsl-dot" style={{ background: s.tone }} aria-hidden="true"/>
      <span style={{ color: status === 'waiting' ? 'var(--fg4)' : 'var(--fg2)' }}>{s.label}</span>
      {when && <span className="vsl-muted"> · {when}</span>}
    </span>
  );
}

function VslRate({ value, max, n, strong }) {
  const w = value != null && max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  const small = n != null && n < VSL_MIN_SAMPLE;
  return (
    <div className="vsl-rate" title={small ? `Só ${n} visitas — taxa ainda instável` : undefined}>
      <span className="num" style={{ fontWeight: strong ? 600 : 500, color: small ? 'var(--fg4)' : 'var(--fg1)' }}>{vslPct(value)}</span>
      <span className="vsl-rate-track" aria-hidden="true"><span className="vsl-rate-fill" style={{ width: `${w}%`, opacity: small ? 0.45 : 1 }}/></span>
    </div>
  );
}

function VslDrawer({ title, sub, onClose, children, wide, footer }) {
  const ref = useRefVsl(null);
  // Esc é do handler global (app.jsx): dentro de um campo o 1º Esc só sai do
  // campo, o 2º fecha pelo .drawer-backdrop — não perde o que foi digitado.
  useEffectVsl(() => {
    const prev = document.activeElement;
    if (ref.current) ref.current.focus();
    return () => { if (prev && prev.focus) prev.focus(); };
  }, []);
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose}/>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
        className={`drawer vsl-drawer${wide ? ' is-wide' : ''}`}>
        <div className="vsl-drawer-head">
          <div style={{ minWidth: 0 }}>
            <div className="vsl-drawer-title">{title}</div>
            {sub && <div className="panel-sub">{sub}</div>}
          </div>
          <button className="btn btn-ghost vsl-icon-btn" onClick={onClose} aria-label="Fechar" title="Fechar (Esc)"><Icon name="x" size={14}/></button>
        </div>
        <div className="vsl-drawer-body">{children}</div>
        {footer && <div className="vsl-drawer-foot">{footer}</div>}
      </div>
    </>
  );
}

function VslSection({ title, hint, children, action }) {
  return (
    <section className="vsl-block">
      <div className="vsl-block-head">
        <div>
          <div className="vsl-block-title">{title}</div>
          {hint && <div className="panel-sub">{hint}</div>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function VslField({ label, hint, error, children }) {
  return (
    <label className="vsl-field">
      <span className="vsl-field-label">{label}</span>
      {children}
      {error ? <span className="vsl-field-error" role="alert">{error}</span> : hint ? <span className="vsl-field-hint">{hint}</span> : null}
    </label>
  );
}

function VslVslSelect({ vsls, value, onChange, placeholder = 'Escolha a VSL', disabled, includeArchivedId, label }) {
  const list = vsls.filter((v) => !v.archived || v.id === includeArchivedId);
  return (
    <select aria-label={label || placeholder} value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} style={{ width: '100%' }}>
      <option value="">{placeholder}</option>
      {list.map((v) => <option key={v.id} value={v.id}>{v.name} · pitch {vslFmtPitch(v.pitchSeconds)}{v.archived ? ' (arquivada)' : ''}</option>)}
    </select>
  );
}

function VslSnippet({ page, onCopied }) {
  const [copied, setCopied] = useStateVsl(false);
  if (!page.snippet) {
    return <ReadState kind="parcial" title="Sem snippet">Escolha a VSL de reserva desta página para gerar o snippet.</ReadState>;
  }
  async function copy() {
    const ok = await vslCopy(page.snippet);
    setCopied(ok);
    if (onCopied) onCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 2500);
  }
  return (
    <div>
      <div className="vsl-code-wrap">
        <pre className="vsl-code" tabIndex={0} aria-label="Snippet para colar na página">{page.snippet}</pre>
        <button className="btn btn-primary vsl-code-copy" onClick={copy}>
          <Icon name={copied ? 'check' : 'copy'} size={14}/> {copied ? 'Copiado' : 'Copiar snippet'}
        </button>
      </div>
      <ol className="vsl-steps">
        <li>Na página, apague o bloco do player do VTurb: o <code>&lt;vturb-smartplayer …&gt;</code> e o <code>&lt;script&gt;</code> que carrega o <code>player.js</code>.</li>
        <li>Cole o snippet no mesmo lugar.</li>
        <li>No <code>&lt;head&gt;</code>, apague o <code>&lt;link rel="preload"&gt;</code> do <code>player.js</code> (os <code>dns-prefetch</code> ficam).</li>
        <li>Deixe <code>window.VSL_REVEAL_DELAY</code> e o <code>vsl-reveal.js</code> como estão — o snippet precisa vir <strong>antes</strong> deles na página.</li>
        <li>Suba a página e abra com tráfego de teste: aqui a página passa para <strong>No ar</strong>.</li>
      </ol>
    </div>
  );
}

// ── Seção: Desempenho ─────────────────────────────────────────────────────

function VslOverview({ st, perf, perfLoading, perfErr, visiblePages, nowMs, onOpenVsl, onOpenPage, onGo }) {
  const [metric, setMetric] = useStateVsl('accept');
  const vslById = useMemoVsl(() => new Map(st.vsls.map((v) => [v.id, v])), [st.vsls]);
  const pageIds = useMemoVsl(() => new Set(visiblePages.map((p) => p.id)), [visiblePages]);

  if (perfErr) return <ReadState kind="falha" title="Não deu para calcular o desempenho">{perfErr}</ReadState>;
  if (perfLoading && !perf) {
    return (
      <div>
        <div className="vsl-kpis">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="panel vsl-kpi skel" style={{ height: 92 }}/>)}</div>
        <div className="panel" style={{ marginTop: 12 }}><table className="tbl"><tbody><SkelTableRows rows={6} cols={8}/></tbody></table></div>
      </div>
    );
  }
  if (!perf) return null;

  const t = perf.totals;
  const live = visiblePages.filter((p) => vslPageStatus(p, nowMs) === 'live').length;
  const waiting = visiblePages.filter((p) => vslPageStatus(p, nowMs) === 'waiting').length;
  const pagesPerf = perf.byPage.filter((b) => pageIds.has(b.pageId));
  const realSales = pagesPerf.reduce((s, b) => s + (b.real ? b.real.sales : 0), 0);
  const liveSales = pagesPerf.reduce((s, b) => s + (b.real && b.real.live ? b.real.live.sales : 0), 0);
  const liveRevenue = pagesPerf.reduce((s, b) => s + (b.real && b.real.live ? b.real.live.revenue : 0), 0);

  // Ranking: amostra decente primeiro (por aceite), resto no fim.
  const ranking = perf.byVsl
    .map((r) => ({ ...r, vsl: r.vslId ? vslById.get(r.vslId) : null }))
    .sort((a, b) => {
      const sa = a.visits >= VSL_MIN_SAMPLE, sb = b.visits >= VSL_MIN_SAMPLE;
      if (sa !== sb) return sa ? -1 : 1;
      return (b.acceptRate || 0) - (a.acceptRate || 0) || b.visits - a.visits;
    });
  const maxAccept = Math.max(0.0001, ...ranking.map((r) => r.acceptRate || 0));

  // Série diária: top 5 VSLs por visitas.
  const top = [...perf.byVsl].sort((a, b) => b.visits - a.visits).slice(0, 5);
  const days = Array.from(new Set(perf.daily.map((d) => d.day))).sort();
  const series = top.map((r) => {
    const name = r.vslId ? (vslById.get(r.vslId) || {}).name || 'VSL removida' : 'Reserva';
    return { key: r.vslId || 'fb', label: name.length > 22 ? name.slice(0, 21) + '…' : name, kind: 'line' };
  });
  const chartData = days.map((day) => {
    const row = { date: day };
    for (const r of top) {
      const d = perf.daily.find((x) => x.day === day && (x.vslId || null) === (r.vslId || null));
      row[r.vslId || 'fb'] = d ? (metric === 'accept' ? d.acceptRate : d.pitchRate) : null;
    }
    return row;
  });

  const attention = [];
  for (const p of visiblePages) {
    const s = vslPageStatus(p, nowMs);
    if (s === 'stale') attention.push({ key: `s${p.id}`, tone: 'var(--warning)', icon: 'alert-triangle', text: `${vslPageName(p)}: sem sinal ${vslAgo(p.lastSeenAt, nowMs)}.`, page: p });
    if (s === 'waiting' && nowMs - Date.parse(p.createdAt) > 24 * 3600 * 1000) attention.push({ key: `w${p.id}`, tone: 'var(--fg4)', icon: 'clock', text: `${vslPageName(p)}: criada ${vslAgo(p.createdAt, nowMs)} e ainda sem visita — o snippet foi colado?`, page: p });
  }
  for (const tr of perf.tests) {
    if (tr.status === 'finished' || !pageIds.has(tr.pageId)) continue;
    if (tr.byAccept.verdict === 'leader') attention.push({ key: `t${tr.id}`, tone: 'var(--success)', icon: 'trophy', text: `Teste "${tr.name}": ${tr.byAccept.message}`, go: 'tests' });
  }
  // One-click: clicar em comprar deveria virar compra. Muito clique sem compra
  // confirmada = cobrança do upsell falhando ou travando na plataforma.
  for (const b of pagesPerf) {
    const p = visiblePages.find((x) => x.id === b.pageId);
    if (!p || !b.linkable || b.linkableVisits < 5 || b.accepts < 4 || (b.sales || 0) >= b.accepts * 0.6) continue;
    attention.push({ key: `c${p.id}`, tone: 'var(--warning)', icon: 'alert-triangle', page: p,
      text: `${vslPageName(p)}: ${b.accepts} cliques em comprar e só ${b.sales || 0} compras confirmadas — no one-click o clique devia virar compra. Confira a cobrança do upsell na plataforma.` });
  }
  for (const r of perf.byPageVsl) {
    if (!pageIds.has(r.pageId) || r.visits < 100 || r.pitchRate == null || r.pitchRate >= 0.15) continue;
    const v = r.vslId ? vslById.get(r.vslId) : null;
    attention.push({ key: `p${r.pageId}${r.vslId}`, tone: 'var(--warning)', icon: 'info', text: `${v ? v.name : 'Reserva'}: só ${vslPct(r.pitchRate)} das visitas chegam ao pitch (${vslFmtPitch(v ? v.pitchSeconds : null)}). Pitch mais cedo ou VSL mais curta pode render mais.` });
  }

  if (t.visits === 0) {
    return (
      <div>
        <ReadState kind="vazio" title="Nenhuma visita rastreada neste período" action={st.pages.length ? 'Ver páginas' : 'Criar a primeira página'} onAction={() => onGo('pages')}>
          O desempenho aparece quando uma página com o snippet recebe tráfego. Crie a página do funil, copie o snippet e cole no lugar do player do VTurb.
        </ReadState>
        {attention.length > 0 && <VslAttention items={attention} onOpenPage={onOpenPage} onGo={onGo}/>}
      </div>
    );
  }

  return (
    <div>
      <div className="vsl-kpis">
        <VslKpi label="Visitas rastreadas" value={fmtInt(t.visits)} sub={`${live} de ${visiblePages.length} páginas no ar${waiting ? ` · ${waiting} aguardando` : ''}`}/>
        <VslKpi label="Chegaram ao pitch" value={vslPct(t.pitchRate)} sub={t.avgWatchSeconds != null ? `assistem ${vslFmtPitch(t.avgWatchSeconds)} em média` : '—'}
          title="Os botões só aparecem no pitch: quem quer seguir no funil precisa esperar até ele."/>
        <VslKpi label="Clicaram em comprar" value={vslPct(t.acceptRate)} emphasis tone="var(--accent)"
          sub={`${fmtInt(t.accepts)} cliques · ${vslPct(t.acceptAfterPitch)} de quem viu o pitch`}
          title="Clique no botão de compra da página. É a taxa que decide os testes. No one-click devia virar compra — compare com a compra confirmada."/>
        {t.linkable && (
          <VslKpi label="Compra confirmada" value={vslPct(t.saleRate)} tone="var(--money)"
            sub={`${fmtInt(t.sales || 0)} de ${fmtInt(t.linkableVisits || 0)} visitas ligadas à venda · ${fmtCurrency(t.revenuePerVisit || 0, 'USD', 2)} por visita`}
            title="Visita ligada à sessão da plataforma que comprou a etapa. BuyGoods: sessid2 ou pedido da URL. JVZoo: mesmo afiliado e front comprado até 30 min antes (aproximado). A base são só as visitas ligadas."/>
        )}
        <VslKpi label="Vendas reais das etapas" value={fmtInt(liveSales)} tone="var(--money)"
          sub={`desde a instalação · ${fmtCurrency(liveRevenue, 'USD', 0)} · no período todo: ${fmtInt(realSales)}`}
          title="Pedidos aprovados da etapa pelas plataformas, só de sessões com front DEPOIS da instalação da página — a mesma janela das visitas rastreadas. O período todo inclui os dias antes do snippet."/>
      </div>

      {attention.length > 0 && <VslAttention items={attention} onOpenPage={onOpenPage} onGo={onGo}/>}

      <div className="vsl-two">
        <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="vsl-panel-head">
            <div>
              <div className="panel-title vsl-block-title">Ranking de VSLs</div>
              <div className="panel-sub">Ordenado por aceite · abaixo de {VSL_MIN_SAMPLE} visitas fica no fim</div>
            </div>
          </div>
          <Paginated items={ranking} label="VSLs" initialPageSize={10}>
            {(rows, pager) => (<>
              <div className="tbl-wrap">
                <table className="tbl vsl-tbl">
                  <thead><tr>
                    <th>VSL</th><th className="num">Visitas</th><th className="num">Pitch</th><th title="Clicaram em comprar">Clique</th>
                    <th className="num" title="Compra confirmada: visita ligada à venda da etapa">Compra</th>
                    <th className="num" title="Take rate real nos dias em que só esta VSL esteve no ar">Take real</th>
                  </tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.vslId || 'fb'} tabIndex={r.vsl ? 0 : undefined} className={r.vsl ? 'is-clickable' : undefined}
                        onClick={r.vsl ? () => onOpenVsl(r.vsl.id) : undefined}>
                        <td>
                          <div className="vsl-name">{r.vsl ? r.vsl.name : 'Reserva (VSL não cadastrada)'}</div>
                          <div className="vsl-muted">{r.pages} página{r.pages === 1 ? '' : 's'} · pitch {vslFmtPitch(r.vsl ? r.vsl.pitchSeconds : null)}{r.visits < VSL_MIN_SAMPLE ? ' · amostra pequena' : ''}</div>
                        </td>
                        <td className="num">{fmtInt(r.visits)}</td>
                        <td className="num">{vslPct(r.pitchRate)}</td>
                        <td style={{ minWidth: 130 }}><VslRate value={r.acceptRate} max={maxAccept} n={r.visits} strong/></td>
                        <td className="num" title={r.linkable ? `${fmtInt(r.sales || 0)} de ${fmtInt(r.linkableVisits || 0)} visitas ligadas` : 'Sem como ligar visita e venda nesta plataforma'}>{r.linkable ? vslPct(r.saleRate) : '—'}</td>
                        <td className="num" title={r.real ? undefined : 'Só conta dia inteiro com esta VSL sozinha no ar, depois do dia da instalação'}>{r.real ? vslPct(r.real.takeRate) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pager}
            </>)}
          </Paginated>
        </div>

        <div className="panel">
          <div className="vsl-panel-head" style={{ padding: 0, marginBottom: 8 }}>
            <div>
              <div className="panel-title vsl-block-title">Por dia</div>
              <div className="panel-sub">As 5 VSLs com mais visitas</div>
            </div>
            <div className="seg" role="group" aria-label="Métrica do gráfico">
              <button className={metric === 'accept' ? 'is-active' : ''} aria-pressed={metric === 'accept'} onClick={() => setMetric('accept')}>Clique</button>
              <button className={metric === 'pitch' ? 'is-active' : ''} aria-pressed={metric === 'pitch'} onClick={() => setMetric('pitch')}>Pitch</button>
            </div>
          </div>
          <NSTimeSeries data={chartData} series={series} height={250} format="pct" toggles brush={false}/>
        </div>
      </div>

      <VslPagePerfTable st={st} perf={perf} pages={visiblePages} onOpenPage={onOpenPage}/>

      <div className="vsl-footnote">
        <strong>Clique</strong> = clique no botão de compra da página. <strong>Compra</strong> = a visita ligada à sessão da plataforma comprou a etapa
        (BuyGoods: sessid2 ou pedido da URL; JVZoo: mesmo afiliado e front comprado até 30 min antes — aproximado). No one-click, clique sem compra
        é cobrança que não passou.
        {' '}<strong>Vendas reais</strong> = pedidos aprovados da etapa de sessões com front depois da instalação (mesma janela das visitas).
        {' '}<strong>Take real</strong> por VSL = só dias inteiros com ela sozinha no ar depois do dia da instalação (dia de troca e de teste A/B ficam de fora).
        {' '}Visita de teste: abra a página com <code>?ns_vsl_test=1</code> (não rastreia) ou descarte na gaveta da página.
      </div>
    </div>
  );
}

function VslAttention({ items, onOpenPage, onGo }) {
  return (
    <div className="panel vsl-attention" role="region" aria-label="Pontos de atenção">
      <div className="vsl-block-title" style={{ marginBottom: 6 }}>Atenção</div>
      {items.slice(0, 6).map((a) => (a.page || a.go ? (
        <button key={a.key} className="vsl-attention-row" onClick={() => (a.page ? onOpenPage(a.page.id) : onGo(a.go))}>
          <Icon name={a.icon} size={14}/>
          <span style={{ color: 'var(--fg2)' }}>{a.text}</span>
          <Icon name="chevron-right" size={14}/>
        </button>
      ) : (
        <div key={a.key} className="vsl-attention-row is-static">
          <Icon name={a.icon} size={14}/>
          <span style={{ color: 'var(--fg2)' }}>{a.text}</span>
        </div>
      )))}
      {items.length > 6 && <div className="vsl-muted" style={{ paddingTop: 4 }}>+ {items.length - 6} outros pontos</div>}
    </div>
  );
}

function VslPagePerfTable({ st, perf, pages, onOpenPage }) {
  const perfByPage = new Map(perf.byPage.map((b) => [b.pageId, b]));
  const vslById = new Map(st.vsls.map((v) => [v.id, v]));
  const rows = pages.map((p) => ({ id: p.id, p, b: perfByPage.get(p.id) })).sort((a, b) => ((b.b && b.b.visits) || 0) - ((a.b && a.b.visits) || 0));
  if (!rows.length) return null;
  return (
    <div className="panel" style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
      <div className="vsl-panel-head">
        <div>
          <div className="panel-title vsl-block-title">Por página</div>
          <div className="panel-sub">Rastreio e venda real na mesma janela: desde a instalação do snippet (passe o mouse para ver o período todo)</div>
        </div>
      </div>
      <Paginated items={rows} label="páginas" initialPageSize={10}>
        {(pageRows, pager) => (<>
          <div className="tbl-wrap">
            <table className="tbl vsl-tbl">
              <thead><tr>
                <th>Página</th><th>No ar</th><th className="num">Visitas</th><th className="num" title="Clicaram em comprar">Clique</th>
                <th className="num" title="Compra confirmada: visita ligada à venda da etapa">Compra</th>
                <th className="num">Sessões FE</th><th className="num">Vendas reais</th><th className="num">Take real</th>
              </tr></thead>
              <tbody>
                {pageRows.map(({ p, b }) => {
                  const v = p.vslId ? vslById.get(p.vslId) : null;
                  return (
                    <tr key={p.id} tabIndex={0} className="is-clickable" onClick={() => onOpenPage(p.id)} onKeyDown={(e) => { if (e.key === 'Enter') onOpenPage(p.id); }}>
                      <td><div className="vsl-name">{p.family}</div><div className="vsl-muted">{p.stage}{vslVariantLabel(p) ? ` · ${vslVariantLabel(p)}` : ''} · {p.platform}</div></td>
                      <td>{p.test ? <VslChip tone="var(--accent)">Teste A/B</VslChip> : <span>{v ? v.name : '—'}</span>}</td>
                      <td className="num">{b ? fmtInt(b.visits) : '0'}</td>
                      <td className="num">{b ? vslPct(b.acceptRate) : '—'}</td>
                      <td className="num" title={b && b.linkable ? `${fmtInt(b.sales || 0)} de ${fmtInt(b.linkableVisits || 0)} visitas ligadas` : undefined}>{b && b.linkable ? vslPct(b.saleRate) : '—'}</td>
                      <td className="num" title={b && b.real ? `Período todo: ${fmtInt(b.real.feSessions)}` : undefined}>{b && b.real && b.real.live ? fmtInt(b.real.live.feSessions) : '—'}</td>
                      <td className="num" style={{ color: 'var(--money)' }} title={b && b.real ? `Período todo: ${fmtInt(b.real.sales)}` : undefined}>{b && b.real && b.real.live ? fmtInt(b.real.live.sales) : '—'}</td>
                      <td className="num" title={b && b.real ? `Período todo: ${vslPct(b.real.takeRate)}` : undefined}>{b && b.real && b.real.live ? vslPct(b.real.live.takeRate) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pager}
        </>)}
      </Paginated>
    </div>
  );
}

// ── Seção: Páginas ────────────────────────────────────────────────────────

const VSL_PAGE_FILTERS = [
  { id: 'all', label: 'Todas' },
  { id: 'live', label: 'No ar' },
  { id: 'stale', label: 'Sem sinal' },
  { id: 'waiting', label: 'Aguardando instalação' },
  { id: 'off', label: 'Desligadas' },
  { id: 'test', label: 'Em teste' },
];

function VslPagesSection({ st, perf, perfState, pages, nowMs, busy, onOpenPage, onAssign, onNew }) {
  const [status, setStatus] = useStateVsl('all');
  const perfByPage = useMemoVsl(() => new Map(((perf && perf.byPage) || []).map((b) => [b.pageId, b])), [perf]);
  const counts = useMemoVsl(() => {
    const c = { all: pages.length, live: 0, stale: 0, waiting: 0, off: 0, test: 0 };
    for (const p of pages) { c[vslPageStatus(p, nowMs)] += 1; if (p.test) c.test += 1; }
    return c;
  }, [pages, nowMs]);
  const shown = pages.filter((p) => status === 'all' || (status === 'test' ? !!p.test : vslPageStatus(p, nowMs) === status));
  const families = Array.from(new Set(shown.map((p) => p.family))).sort((a, b) => a.localeCompare(b));
  const platformLabel = new Map(st.options.platforms.map((p) => [p.id, p.label]));
  const stageLabel = new Map(st.options.stages.map((s) => [s.id, s.label]));

  if (!st.pages.length) {
    return (
      <ReadState kind="vazio" title="Nenhuma página ainda" action="Nova página" onAction={onNew}>
        Cada página é uma etapa do funil (família + etapa + plataforma). Ao criar, o dash gera o snippet para colar no lugar do player do VTurb.
      </ReadState>
    );
  }

  return (
    <div>
      <div className="vsl-chips" role="group" aria-label="Filtrar por situação">
        {VSL_PAGE_FILTERS.map((f) => (
          <button key={f.id} className={status === f.id ? 'chip is-active' : 'chip'} aria-pressed={status === f.id} onClick={() => setStatus(f.id)}>
            {f.id !== 'all' && f.id !== 'test' && <span className="vsl-dot" style={{ background: VSL_STATUS[f.id].tone }} aria-hidden="true"/>}
            {f.label} <span className="cnt">{counts[f.id]}</span>
          </button>
        ))}
      </div>

      {perfState === 'error' && <ReadState kind="parcial" title="Métricas indisponíveis agora">A lista e as ações funcionam; a coluna de aceite volta quando o desempenho carregar.</ReadState>}
      {shown.length === 0 && <ReadState kind="vazio" title="Nenhuma página nesta situação">Troque o filtro acima ou o filtro global de plataforma/família.</ReadState>}

      {families.map((fam) => {
        const rows = shown.filter((p) => p.family === fam);
        return (
          <div key={fam} className="panel vsl-family">
            <div className="vsl-family-head">
              <div className="vsl-block-title">{fam}</div>
              <span className="vsl-muted">{rows.length} página{rows.length === 1 ? '' : 's'}</span>
            </div>
            <div className="tbl-wrap">
              <table className="tbl vsl-tbl">
                <thead><tr>
                  <th style={{ width: 120 }}>Etapa</th><th style={{ width: 120 }}>Plataforma</th><th>VSL no ar</th>
                  <th>Situação</th><th className="num">Visitas 24 h</th><th className="num">Aceite</th><th style={{ width: 90 }}/>
                </tr></thead>
                <tbody>
                  {rows.map((p) => {
                    const b = perfByPage.get(p.id);
                    const s = vslPageStatus(p, nowMs);
                    return (
                      <tr key={p.id}>
                        <td>
                          <button className="vsl-link" onClick={() => onOpenPage(p.id)}>{stageLabel.get(p.stage) || p.stage}</button>
                          {p.variant
                            ? <div><VslChip tone="var(--accent)" title={vslBottlesText(p.feBottles)}>{p.variant}</VslChip></div>
                            : vslVariantLabel(p)
                              ? <div><VslChip tone="var(--fg4)" title={`Conta quem NÃO comprou ${p.otherBottles.join(' ou ')} potes (essas têm variante própria)`}>demais potes</VslChip></div>
                              : <div className="vsl-muted cell-mono">{p.stage}</div>}
                        </td>
                        <td>{platformLabel.get(p.platform) || p.platform}</td>
                        <td style={{ minWidth: 220 }}>
                          {p.test ? (
                            <button className="vsl-link" onClick={() => onOpenPage(p.id)} title="Teste A/B aberto — gerencie na aba Testes A/B">
                              <VslChip tone="var(--accent)">{p.test.status === 'paused' ? 'Teste pausado' : 'Teste A/B'}</VslChip>{' '}
                              <span className="vsl-muted">{p.test.arms.map((a) => `${a.label} ${a.weight}%`).join(' · ')}</span>
                            </button>
                          ) : (
                            <select aria-label={`VSL no ar em ${vslPageName(p)}`} value={p.vslId || ''} disabled={busy}
                              onChange={(e) => e.target.value && onAssign(p, e.target.value)} style={{ width: '100%', maxWidth: 320 }}>
                              {!p.vslId && <option value="">— reserva do snippet —</option>}
                              {st.vsls.filter((v) => !v.archived || v.id === p.vslId).map((v) => (
                                <option key={v.id} value={v.id}>{v.name} · {vslFmtPitch(v.pitchSeconds)}</option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td>
                          <VslStatus status={s} page={p} nowMs={nowMs}/>
                          {p.affRules && p.affRules.some((r) => r.enabled) && (
                            <div><VslChip tone="var(--accent)" title="Afiliados com VSL própria nesta página">{p.affRules.filter((r) => r.enabled).length} regra{p.affRules.filter((r) => r.enabled).length === 1 ? '' : 's'} de afiliado</VslChip></div>
                          )}
                        </td>
                        <td className="num">{fmtInt(p.visits24h || 0)}</td>
                        <td className="num">{vslCell(perfState, b ? b.acceptRate : null, vslPct)}</td>
                        <td>
                          <button className="btn btn-ghost vsl-icon-btn" onClick={() => onOpenPage(p.id, 'snippet')} title="Snippet da página" aria-label={`Snippet de ${vslPageName(p)}`}><Icon name="copy" size={14}/></button>
                          <button className="btn btn-ghost vsl-icon-btn" onClick={() => onOpenPage(p.id)} title="Abrir página" aria-label={`Abrir ${vslPageName(p)}`}><Icon name="chevron-right" size={14}/></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Seção: Biblioteca ─────────────────────────────────────────────────────

function VslLibrarySection({ st, perf, perfState, q, onOpenVsl, onNew }) {
  const [archived, setArchived] = useStateVsl(false);
  const perfByVsl = useMemoVsl(() => new Map(((perf && perf.byVsl) || []).map((b) => [b.vslId, b])), [perf]);
  const needle = q.trim().toLowerCase();
  const list = st.vsls.filter((v) => (archived ? v.archived : !v.archived) && (!needle || v.name.toLowerCase().includes(needle) || v.playerId.includes(needle)));
  const archivedCount = st.vsls.filter((v) => v.archived).length;

  if (!st.vsls.length) {
    return (
      <ReadState kind="vazio" title="Biblioteca vazia" action="Nova VSL" onAction={onNew}>
        Cadastre a VSL com o nome, o código de embed do VTurb e o tempo do pitch. Comece pelas VSLs que já estão nas páginas — elas viram a reserva do snippet.
      </ReadState>
    );
  }
  return (
    <div>
      {perfState === 'error' && <ReadState kind="parcial" title="Métricas indisponíveis agora">A biblioteca funciona; visitas, aceite e take real voltam quando o desempenho carregar.</ReadState>}
      <div className="vsl-chips" role="group" aria-label="Filtrar biblioteca">
        <button className={!archived ? 'chip is-active' : 'chip'} aria-pressed={!archived} onClick={() => setArchived(false)}>Em uso e disponíveis <span className="cnt">{st.vsls.length - archivedCount}</span></button>
        <button className={archived ? 'chip is-active' : 'chip'} aria-pressed={archived} onClick={() => setArchived(true)}>Arquivadas <span className="cnt">{archivedCount}</span></button>
      </div>
      <Paginated items={list} label="VSLs" resetKey={`${archived}|${needle}`}>
        {(rows, pager) => (
          <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="tbl-wrap">
              <table className="tbl vsl-tbl">
                <thead><tr>
                  <th>VSL</th><th className="num">Pitch</th><th>Formato</th><th>Em uso</th>
                  <th className="num">Visitas</th><th className="num">Aceite</th><th className="num">Take real</th><th>Atualizada</th>
                </tr></thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={8} className="vsl-empty-cell">Nada {archived ? 'arquivado' : 'na biblioteca'}{needle ? ' com essa busca' : ''}.</td></tr>}
                  {rows.map((v) => {
                    const b = perfByVsl.get(v.id);
                    return (
                      <tr key={v.id} tabIndex={0} className="is-clickable" onClick={() => onOpenVsl(v.id)} onKeyDown={(e) => { if (e.key === 'Enter') onOpenVsl(v.id); }}>
                        <td>
                          <div className="vsl-name">{v.name}</div>
                          <div className="vsl-muted cell-mono">vid-{v.playerId}</div>
                        </td>
                        <td className="num">{vslFmtPitch(v.pitchSeconds)}</td>
                        <td>{vslAspect(v.aspectPct)}</td>
                        <td>
                          {v.usage.pages > 0 && <VslChip tone="var(--success)">{v.usage.pages} página{v.usage.pages === 1 ? '' : 's'}</VslChip>}{' '}
                          {v.usage.tests > 0 && <VslChip tone="var(--accent)">em teste</VslChip>}{' '}
                          {v.usage.fallbacks > 0 && <VslChip tone="var(--fg4)" title="Está no snippet como reserva — toca se o dash não responder">reserva em {v.usage.fallbacks}</VslChip>}
                          {v.usage.rules > 0 && <VslChip tone="var(--accent)" title="VSL de regra por afiliado">{v.usage.rules} regra{v.usage.rules === 1 ? '' : 's'}</VslChip>}
                          {!v.usage.pages && !v.usage.tests && !v.usage.fallbacks && !v.usage.rules && <span className="vsl-muted">livre</span>}
                        </td>
                        <td className="num">{vslCell(perfState, b ? b.visits : 0, fmtInt)}</td>
                        <td className="num">{vslCell(perfState, b ? b.acceptRate : null, vslPct)}</td>
                        <td className="num">{vslCell(perfState, b && b.real ? b.real.takeRate : null, vslPct)}</td>
                        <td className="vsl-muted">{vslFmtDay(v.updatedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {pager}
          </div>
        )}
      </Paginated>
    </div>
  );
}

// ── Seção: Testes A/B ─────────────────────────────────────────────────────

function VslTestCard({ tr, page, st, busy, onAct, onFinish, onWeights }) {
  const vslById = new Map(st.vsls.map((v) => [v.id, v]));
  const ab = tr.byAccept;
  const verdict = VSL_VERDICT[ab.verdict] || VSL_VERDICT.running;
  const statsById = new Map(ab.arms.map((a) => [a.id, a]));
  const saleById = tr.bySale ? new Map(tr.bySale.arms.map((a) => [a.id, a])) : null;
  const days = Math.max(1, Math.round(((tr.endedAt ? Date.parse(tr.endedAt) : Date.now()) - Date.parse(tr.startedAt)) / 86400000));
  const finished = tr.status === 'finished';
  const maxRate = Math.max(0.0001, ...tr.arms.map((a) => a.acceptRate || 0));
  return (
    <div className="panel vsl-test">
      <div className="vsl-test-head">
        <div style={{ minWidth: 0 }}>
          <div className="vsl-block-title">{tr.name}</div>
          <div className="panel-sub">
            {page ? vslPageName(page, true) : 'Página excluída'} · {finished ? `${days} dia${days === 1 ? '' : 's'}, encerrado em ${vslFmtDay(tr.endedAt)}` : `rodando há ${days} dia${days === 1 ? '' : 's'}`}
          </div>
        </div>
        <VslChip tone={finished ? 'var(--fg4)' : tr.status === 'paused' ? 'var(--warning)' : 'var(--success)'}>
          {finished ? 'Encerrado' : tr.status === 'paused' ? 'Pausado' : 'Rodando'}
        </VslChip>
      </div>

      {!finished && (
        <div className="vsl-verdict" style={{ background: verdict.bg }}>
          <strong style={{ color: verdict.tone }}>{verdict.label}.</strong> <span style={{ color: 'var(--fg2)' }}>{ab.message}</span>
        </div>
      )}
      {finished && (
        <div className="vsl-verdict" style={{ background: 'var(--bg-hover)' }}>
          {tr.winnerVslId
            ? <span><strong>Vencedora aplicada:</strong> {(vslById.get(tr.winnerVslId) || {}).name || 'VSL removida'}.</span>
            : <span>Encerrado sem aplicar vencedora.</span>}
        </div>
      )}

      <div className="tbl-wrap">
        <table className="tbl vsl-tbl">
          <thead><tr>
            <th style={{ width: 44 }}>Braço</th><th>VSL</th><th className="num">Peso</th><th className="num">Visitas</th>
            <th className="num">Pitch</th><th>Aceite</th><th className="num" title="Intervalo de 95%">Faixa provável</th>
            <th className="num">vs {tr.arms[0] ? tr.arms[0].label : 'A'}</th><th title="Chance de ser a melhor VSL do teste">Chance de ser a melhor</th>
            {tr.linkable && <th className="num" title="Compra confirmada: visita ligada à venda da etapa (BuyGoods pelo sessid2/pedido; JVZoo pelo afiliado + horário do front)">Compras</th>}
          </tr></thead>
          <tbody>
            {tr.arms.map((a, i) => {
              const s = statsById.get(a.id) || {};
              const sale = saleById ? saleById.get(a.id) : null;
              const v = vslById.get(a.vslId);
              const isLeader = ab.leaderId === a.id && ab.verdict !== 'insufficient';
              return (
                <tr key={a.id}>
                  <td><span className={`vsl-arm${isLeader ? ' is-leader' : ''}`}>{a.label}</span></td>
                  <td><div className="vsl-name">{v ? v.name : 'VSL removida'}</div><div className="vsl-muted">pitch {vslFmtPitch(v ? v.pitchSeconds : null)}{i === 0 ? ' · controle' : ''}</div></td>
                  <td className="num">{a.weight}%</td>
                  <td className="num">{fmtInt(a.visits)}</td>
                  <td className="num">{vslPct(a.pitchRate)}</td>
                  <td style={{ minWidth: 120 }}><VslRate value={a.acceptRate} max={maxRate} n={a.visits} strong={isLeader}/></td>
                  <td className="num vsl-muted">{s.ci95 ? `${vslPct(s.ci95[0])} – ${vslPct(s.ci95[1])}` : '—'}</td>
                  <td className="num" style={{ color: s.liftVsControl == null ? 'var(--fg5)' : s.liftVsControl >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                    {s.liftVsControl == null ? '—' : `${s.liftVsControl >= 0 ? '+' : ''}${(s.liftVsControl * 100).toFixed(1)}%`}
                  </td>
                  <td style={{ minWidth: 140 }}>
                    <div className="vsl-rate">
                      <span className="num" style={{ fontWeight: isLeader ? 600 : 500 }}>{vslPct(s.probBest, 0)}</span>
                      <span className="vsl-rate-track" aria-hidden="true"><span className="vsl-rate-fill" style={{ width: `${Math.round((s.probBest || 0) * 100)}%`, background: isLeader ? 'var(--success)' : undefined }}/></span>
                    </div>
                  </td>
                  {tr.linkable && <td className="num" style={{ color: 'var(--money)' }}>{fmtInt(a.sales || 0)}{sale && sale.rate != null ? <span className="vsl-muted"> · {vslPct(sale.rate)}</span> : null}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {tr.bySale && !finished && (
        <div className="vsl-muted" style={{ padding: '8px 14px 0' }}>Por compra confirmada: {tr.bySale.message}</div>
      )}

      {!finished && (
        <div className="vsl-test-actions">
          {tr.status === 'running'
            ? <button className="btn btn-ghost" disabled={busy} onClick={() => onAct({ action: 'pause_test', testId: tr.id })}><Icon name="pause" size={14}/> Pausar</button>
            : <button className="btn btn-ghost" disabled={busy} onClick={() => onAct({ action: 'resume_test', testId: tr.id })}><Icon name="play" size={14}/> Retomar</button>}
          <button className="btn btn-ghost" disabled={busy} onClick={() => onWeights(tr)}><Icon name="sliders" size={14}/> Ajustar pesos</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => onFinish(tr)}><Icon name="trophy" size={14}/> Encerrar teste</button>
        </div>
      )}
    </div>
  );
}

function VslTestsSection({ st, perf, perfLoading, perfErr, onRetry, visiblePageIds, busy, onAct, onFinish, onWeights, onNew }) {
  const pageById = new Map(st.pages.map((p) => [p.id, p]));
  const results = ((perf && perf.tests) || []).filter((t) => !pageById.has(t.pageId) || visiblePageIds.has(t.pageId));
  const open = results.filter((t) => t.status !== 'finished');
  const done = results.filter((t) => t.status === 'finished');

  if (perfLoading && !perf) return <div className="panel"><table className="tbl"><tbody><SkelTableRows rows={4} cols={6}/></tbody></table></div>;
  if (perfErr && !perf) {
    return (
      <ReadState kind="falha" title="Não deu para carregar os resultados dos testes" action="Tentar de novo" onAction={onRetry}>
        {perfErr} — os testes continuam rodando nas páginas; só a leitura dos números falhou.
      </ReadState>
    );
  }
  if (!st.tests.length) {
    return (
      <ReadState kind="vazio" title="Nenhum teste A/B ainda" action="Novo teste" onAction={onNew}>
        Um teste divide o tráfego de uma página entre 2 a 4 VSLs. Cada visitante fica sempre na mesma VSL, e a decisão sai do aceite (clique em comprar) — na BuyGoods, também da venda confirmada.
      </ReadState>
    );
  }
  return (
    <div>
      {open.length === 0 && <ReadState kind="vazio" title="Nenhum teste rodando" action="Novo teste" onAction={onNew}>Os testes encerrados estão logo abaixo.</ReadState>}
      {open.map((tr) => (
        <VslTestCard key={tr.id} tr={tr} page={pageById.get(tr.pageId)} st={st} busy={busy} onAct={onAct} onFinish={onFinish} onWeights={onWeights}/>
      ))}
      {done.length > 0 && (
        <VslSection title="Encerrados" hint="O resultado vale do início ao fim de cada teste (o período do filtro não se aplica).">
          <Paginated items={done} label="testes" initialPageSize={10}>
            {(rows, pager) => (<>
              {rows.map((tr) => <VslTestCard key={tr.id} tr={tr} page={pageById.get(tr.pageId)} st={st} busy={busy} onAct={onAct} onFinish={onFinish} onWeights={onWeights}/>)}
              {pager}
            </>)}
          </Paginated>
        </VslSection>
      )}
    </div>
  );
}

// ── Seção: Histórico ──────────────────────────────────────────────────────

function VslHistorySection({ st, q, visiblePageIds }) {
  const [group, setGroup] = useStateVsl('all');
  const needle = q.trim().toLowerCase();
  const g = VSL_HISTORY_GROUPS.find((x) => x.id === group);
  const list = st.changes.filter((c) =>
    (!g.kinds || g.kinds.includes(c.kind)) &&
    (!c.pageId || visiblePageIds.has(c.pageId) || !st.pages.some((p) => p.id === c.pageId)) &&
    (!needle || c.detail.toLowerCase().includes(needle) || (c.actorName || '').toLowerCase().includes(needle)));
  return (
    <div>
      <div className="vsl-chips" role="group" aria-label="Filtrar histórico">
        {VSL_HISTORY_GROUPS.map((x) => (
          <button key={x.id} className={group === x.id ? 'chip is-active' : 'chip'} aria-pressed={group === x.id} onClick={() => setGroup(x.id)}>{x.label}</button>
        ))}
      </div>
      <Paginated items={list} label="registros" resetKey={`${group}|${needle}`}>
        {(rows, pager) => (
          <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="tbl-wrap">
              <table className="tbl vsl-tbl">
                <thead><tr><th style={{ width: 150 }}>Quando</th><th style={{ width: 160 }}>Quem</th><th>O que mudou</th></tr></thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={3} className="vsl-empty-cell">Nada registrado com esse filtro.</td></tr>}
                  {rows.map((c) => (
                    <tr key={c.id}>
                      <td className="vsl-muted">{fmtDateTime(c.createdAt)}</td>
                      <td>{c.actorName || '—'}</td>
                      <td style={{ color: 'var(--fg2)' }}>{c.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pager}
          </div>
        )}
      </Paginated>
      <div className="vsl-footnote">Mostra as últimas 500 alterações.</div>
    </div>
  );
}

// ── Gavetas ───────────────────────────────────────────────────────────────

/** Snippet curto com botão de copiar (memória do afiliado da BuyGoods). */
function VslCodeCopy({ code, label, onCopied }) {
  const [copied, setCopied] = useStateVsl(false);
  async function copy() {
    const ok = await vslCopy(code);
    setCopied(ok);
    if (onCopied) onCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 2500);
  }
  return (
    <div className="vsl-code-wrap">
      <pre className="vsl-code" tabIndex={0} aria-label={label} style={{ maxHeight: 160 }}>{code}</pre>
      <button className="btn btn-primary vsl-code-copy" onClick={copy}>
        <Icon name={copied ? 'check' : 'copy'} size={14}/> {copied ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  );
}

function VslAffiliateRules({ page, st, perf, busy, onAct, onToast }) {
  const [q, setQ] = useStateVsl('');
  const [cands, setCands] = useStateVsl(null);
  const [loading, setLoading] = useStateVsl(false);
  const [pick, setPick] = useStateVsl(null);
  const [vslId, setVslId] = useStateVsl('');
  const seq = useRefVsl(0);
  const supported = !!page.affiliateSource;
  const rules = page.affRules || [];

  useEffectVsl(() => {
    if (!supported) return undefined;
    const my = ++seq.current;
    setLoading(true);
    const t = setTimeout(() => {
      window.NSApi.fetchVslAffiliates(page.id, q.trim())
        .then((r) => { if (my === seq.current) setCands(r); })
        .catch(() => { if (my === seq.current) setCands({ seen: [], results: [] }); })
        .finally(() => { if (my === seq.current) setLoading(false); });
    }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [page.id, q, supported]);

  if (!supported) {
    return (
      <VslSection title="Regras por afiliado">
        <div className="vsl-muted">Disponível nas páginas da JVZoo e da BuyGoods — nesta plataforma a página ainda não recebe o afiliado.</div>
      </VslSection>
    );
  }

  const vslById = new Map(st.vsls.map((v) => [v.id, v]));
  const ruled = new Set(rules.map((r) => r.affiliateId));
  const cov = page.affiliateCoverage7d || { visits: 0, withAffiliate: 0 };
  const covPct = cov.visits ? cov.withAffiliate / cov.visits : null;
  const isBg = page.affiliateSource === 'mem';
  const seenList = ((cands && cands.seen) || []).filter((a) => !ruled.has(a.id));
  const resultList = ((cands && cands.results) || []).filter((a) => !ruled.has(a.id) && !seenList.some((x) => x.id === a.id));
  const perfAff = (perf && perf.byPageAffiliate && perf.byPageAffiliate[page.id]) || [];
  const label = (a) => `${a.nickname || 'sem nome'} · ${a.externalId}`;

  function create() {
    if (!pick || !vslId) return;
    onAct({ action: 'create_aff_rule', pageId: page.id, affiliateId: pick.id, vslId }).then((ok) => { if (ok) { setPick(null); setVslId(''); setQ(''); } });
  }

  return (
    <VslSection title="Regras por afiliado"
      hint={`Quem vem do afiliado escolhido vê a VSL da regra${page.test ? ' e fica fora do teste A/B' : ''}. Vale da próxima visita em diante (até 1 minuto).`}>
      <div className="vsl-note" role="status" style={{ marginBottom: 10 }}>
        <Icon name="info" size={14}/>
        <div>
          {isBg
            ? <>Na BuyGoods o afiliado vem da <strong>página de vendas</strong> (o upsell não recebe na URL): cole a memória do afiliado abaixo nela. </>
            : <>Na JVZoo o afiliado vem do <code>aid</code> da URL do upsell. </>}
          {cov.visits > 0
            ? <>Afiliado reconhecido em <strong>{vslPct(covPct, 0)}</strong> das {fmtInt(cov.visits)} visitas dos últimos 7 dias.</>
            : <>Ainda sem visitas nos últimos 7 dias para medir o reconhecimento.</>}
        </div>
      </div>
      {isBg && (
        <details className="vsl-details" open={cov.visits > 20 && covPct != null && covPct < 0.3}>
          <summary>Memória do afiliado — snippet da página de vendas</summary>
          <div style={{ marginTop: 8 }}>
            <VslCodeCopy code={st.affiliateMemorySnippet} label="Memória do afiliado (página de vendas)" onCopied={(ok) => onToast(ok ? 'Snippet copiado.' : 'Não deu para copiar — selecione e copie.')}/>
            <ol className="vsl-steps">
              <li>Cole na <strong>página de vendas</strong> (a que tem os botões que levam ao checkout da BuyGoods), em qualquer lugar do <code>&lt;body&gt;</code>. Uma vez por página de vendas.</li>
              <li>A página de vendas e o upsell precisam estar no <strong>mesmo domínio</strong> (com ou sem <code>www</code> igual).</li>
              <li>A memória vale {st.affiliateMemoryHours} h e não chama o dash — a página de vendas não ganha dependência.</li>
            </ol>
          </div>
        </details>
      )}

      {rules.length > 0 && (
        <div className="tbl-wrap" style={{ marginTop: 10 }}>
          <table className="tbl vsl-tbl">
            <thead><tr><th>Afiliado</th><th>VSL</th><th style={{ width: 90 }}>Ligada</th><th style={{ width: 44 }}/></tr></thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td><div className="vsl-name">{r.affiliateName || 'sem nome'}</div><div className="vsl-muted cell-mono">{r.affiliateExternalId}</div></td>
                  <td style={{ minWidth: 200 }}>
                    <select aria-label={`VSL do afiliado ${r.affiliateName || r.affiliateExternalId}`} value={r.vslId} disabled={busy} style={{ width: '100%' }}
                      onChange={(e) => onAct({ action: 'update_aff_rule', ruleId: r.id, vslId: e.target.value })}>
                      {st.vsls.filter((v) => !v.archived || v.id === r.vslId).map((v) => <option key={v.id} value={v.id}>{v.name} · {vslFmtPitch(v.pitchSeconds)}</option>)}
                    </select>
                  </td>
                  <td>
                    <label className="vsl-toggle" style={{ marginTop: 0 }}>
                      <input type="checkbox" checked={r.enabled} disabled={busy} onChange={(e) => onAct({ action: 'update_aff_rule', ruleId: r.id, enabled: e.target.checked })}/>
                      <span>{r.enabled ? 'sim' : 'não'}</span>
                    </label>
                  </td>
                  <td>
                    <button className="btn btn-ghost vsl-icon-btn" disabled={busy} aria-label={`Remover regra de ${r.affiliateName || r.affiliateExternalId}`} title="Remover regra"
                      onClick={() => { if (window.confirm(`Remover a regra de ${r.affiliateName || r.affiliateExternalId}? Ele volta pra VSL da página (ou pro teste).`)) onAct({ action: 'delete_aff_rule', ruleId: r.id }); }}>
                      <Icon name="trash-2" size={14}/>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="vsl-aff-add">
        <div className="vsl-field-label" style={{ marginBottom: 6 }}>Nova regra</div>
        {pick ? (
          <div className="vsl-aff-picked">
            <span><strong>{pick.nickname || 'sem nome'}</strong> <span className="vsl-muted cell-mono">{pick.externalId}</span></span>
            <button className="btn btn-ghost vsl-icon-btn" aria-label="Trocar afiliado" title="Trocar afiliado" onClick={() => setPick(null)}><Icon name="x" size={14}/></button>
          </div>
        ) : (
          <>
            <div className="vsl-search" style={{ marginLeft: 0, width: '100%' }}>
              <Icon name="search" size={14}/>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar afiliado por nome ou ID…" aria-label="Buscar afiliado" style={{ width: '100%' }}/>
            </div>
            <div className="vsl-aff-list" role="group" aria-label="Afiliados">
              {loading && !cands && <div className="vsl-muted" style={{ padding: 8 }}>Buscando…</div>}
              {seenList.length > 0 && <div className="vsl-aff-group">Já passaram por esta página (30 dias)</div>}
              {seenList.map((a) => (
                <button key={a.id} type="button" className="vsl-aff-option" onClick={() => setPick(a)}>
                  <span>{label(a)}</span><span className="vsl-muted num">{fmtInt(a.visits30d)} visitas</span>
                </button>
              ))}
              {resultList.length > 0 && <div className="vsl-aff-group">{q.trim() ? 'Resultado da busca' : 'Afiliados com venda recente'}</div>}
              {resultList.map((a) => (
                <button key={a.id} type="button" className="vsl-aff-option" onClick={() => setPick(a)}>
                  <span>{label(a)}</span><span className="vsl-muted">{a.lastOrderAt ? `última venda ${vslFmtDay(a.lastOrderAt)}` : ''}</span>
                </button>
              ))}
              {cands && !loading && !seenList.length && !resultList.length && <div className="vsl-muted" style={{ padding: 8 }}>Nenhum afiliado encontrado.</div>}
            </div>
          </>
        )}
        <div className="vsl-inline-form" style={{ marginTop: 8 }}>
          <VslVslSelect vsls={st.vsls} value={vslId} onChange={setVslId} label="VSL da regra" placeholder="VSL que esse afiliado vai ver"/>
          <button className="btn btn-primary" disabled={busy || !pick || !vslId} onClick={create}>Criar regra</button>
        </div>
      </div>

      {perfAff.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="vsl-field-label" style={{ marginBottom: 6 }}>Afiliados nesta página (período do filtro)</div>
          <div className="tbl-wrap">
            <table className="tbl vsl-tbl">
              <thead><tr><th>Afiliado</th><th className="num">Visitas</th><th className="num">Pitch</th><th className="num">Aceite</th><th/></tr></thead>
              <tbody>
                {perfAff.slice(0, 10).map((r) => {
                  const rule = rules.find((x) => x.affiliateExternalId === r.affiliateKey);
                  return (
                    <tr key={r.affiliateKey}>
                      <td><div className="vsl-name">{r.name || 'sem nome'}</div><div className="vsl-muted cell-mono">{r.affiliateKey}</div></td>
                      <td className="num">{fmtInt(r.visits)}</td>
                      <td className="num">{vslPct(r.pitchRate)}</td>
                      <td className="num">{vslPct(r.acceptRate)}</td>
                      <td>{rule ? <VslChip tone="var(--accent)">regra: {(vslById.get(rule.vslId) || {}).name || 'VSL'}</VslChip> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </VslSection>
  );
}

/** Últimas visitas da página: achar e descartar as de teste da equipe. */
function VslVisitsSection({ page, busy, onAct }) {
  const [data, setData] = useStateVsl({ status: 'loading', visits: [], error: null });
  const [sel, setSel] = useStateVsl(() => new Set());
  const [seq, setSeq] = useStateVsl(0);
  useEffectVsl(() => {
    let alive = true;
    setData((d) => ({ ...d, status: 'loading' }));
    window.NSApi.fetchVslVisits(page.id)
      .then((r) => { if (alive) setData({ status: 'ready', visits: r.visits || [], error: null }); })
      .catch((e) => { if (alive) setData({ status: 'error', visits: [], error: e.message || 'falha' }); });
    return () => { alive = false; };
  }, [page.id, seq]);
  const vis = data.visits;
  const chosen = vis.filter((v) => sel.has(v.id));
  const toggle = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  function apply(discard) {
    const ids = chosen.filter((v) => v.discarded !== discard).map((v) => v.id);
    if (!ids.length) return;
    onAct({ action: 'discard_visits', pageId: page.id, visitIds: ids, discard }).then((ok) => { if (ok) { setSel(new Set()); setSeq((n) => n + 1); } });
  }
  const watch = (s) => (s > 0 ? vslFmtPitch(s) : '—');
  return (
    <VslSection title="Visitas recentes"
      hint="30 dias, da mais nova. Marque as visitas de teste da equipe e descarte: saem de todas as métricas (dá pra restaurar).">
      <div className="vsl-note" style={{ marginBottom: 8 }}>
        <Icon name="info" size={14}/>
        <div>Pra testar sem entrar na conta, abra a página com <code>?ns_vsl_test=1</code> no fim do endereço — a página roda normal e nada é rastreado nessa aba do navegador.</div>
      </div>
      {data.status === 'loading' && !vis.length && <div className="vsl-muted">Carregando…</div>}
      {data.status === 'error' && <ReadState kind="falha" title="Não deu para listar as visitas">{data.error}</ReadState>}
      {data.status !== 'error' && vis.length === 0 && data.status === 'ready' && <div className="vsl-muted">Nenhuma visita nos últimos 30 dias.</div>}
      {vis.length > 0 && (
        <Paginated items={vis} label="visitas" initialPageSize={10}>
          {(rows, pager) => (<>
            <div className="tbl-wrap">
              <table className="tbl vsl-tbl">
                <thead><tr>
                  <th style={{ width: 36 }}><span className="vsl-sr-only">Selecionar</span></th>
                  <th>Quando</th><th>Afiliado</th><th className="num">Assistiu</th><th>Clique</th><th>Compra</th>
                </tr></thead>
                <tbody>
                  {rows.map((v) => (
                    <tr key={v.id} style={v.discarded ? { opacity: 0.55 } : undefined}>
                      <td><input type="checkbox" checked={sel.has(v.id)} onChange={() => toggle(v.id)} aria-label={`Selecionar visita de ${fmtDateTime(v.firstAt)}`}/></td>
                      <td>
                        <div className="cell-mono">{fmtDateTime(v.firstAt)}</div>
                        {v.discarded && <VslChip tone="var(--fg4)">descartada</VslChip>}
                      </td>
                      <td className="cell-mono">{v.affiliateKey || '—'}</td>
                      <td className="num">{watch(v.maxSecond)}{v.pitch ? ' · pitch' : ''}</td>
                      <td>{v.accept && v.decline ? 'Sim e Não' : v.accept ? 'Sim' : v.decline ? 'Não' : '—'}</td>
                      <td>{!v.linked ? <span className="vsl-muted" title="Não deu pra ligar esta visita a uma compra da plataforma">sem vínculo</span>
                        : v.bought ? <span style={{ color: 'var(--money)' }}>comprou</span>
                        : <span className={v.accept ? '' : 'vsl-muted'} style={v.accept ? { color: 'var(--warning)' } : undefined}>{v.accept ? 'clicou e não comprou' : 'não comprou'}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pager}
          </>)}
        </Paginated>
      )}
      {chosen.length > 0 && (
        <div className="vsl-inline-form" style={{ marginTop: 10 }}>
          <span className="vsl-muted">{chosen.length} selecionada{chosen.length === 1 ? '' : 's'}</span>
          <button className="btn btn-ghost" disabled={busy || !chosen.some((v) => !v.discarded)} onClick={() => apply(true)}>Descartar (teste)</button>
          <button className="btn btn-ghost" disabled={busy || !chosen.some((v) => v.discarded)} onClick={() => apply(false)}>Restaurar</button>
        </div>
      )}
    </VslSection>
  );
}

function VslPageDrawer({ page, st, perf, focus, busy, nowMs, onClose, onAct, onToast, onOpenTest }) {
  const vslById = new Map(st.vsls.map((v) => [v.id, v]));
  const [assignId, setAssignId] = useStateVsl(page.vslId || '');
  const [fallbackId, setFallbackId] = useStateVsl(page.fallbackVslId || '');
  const [previewId, setPreviewId] = useStateVsl(page.vslId || '');
  const snippetRef = useRefVsl(null);
  const [variant, setVariant] = useStateVsl(page.variant || '');
  const [bottles, setBottles] = useStateVsl(page.feBottles || []);
  useEffectVsl(() => { setAssignId(page.vslId || ''); setFallbackId(page.fallbackVslId || ''); }, [page.id, page.vslId, page.fallbackVslId]);
  useEffectVsl(() => { setVariant(page.variant || ''); setBottles(page.feBottles || []); }, [page.id, page.variant, (page.feBottles || []).join(',')]);
  const variantDirty = variant.trim() !== (page.variant || '') || bottles.join(',') !== (page.feBottles || []).join(',');
  const variantClash = st.pages.some((p) => p.id !== page.id && p.family === page.family && p.stage === page.stage && p.platform === page.platform
    && (p.variant || '').trim().toLowerCase() === variant.trim().toLowerCase());
  useEffectVsl(() => { if (focus === 'snippet' && snippetRef.current) snippetRef.current.scrollIntoView({ block: 'start' }); }, [focus]);

  const status = vslPageStatus(page, nowMs);
  const b = perf ? perf.byPage.find((x) => x.pageId === page.id) : null;
  const pv = perf ? perf.byPageVsl.filter((x) => x.pageId === page.id).sort((x, y) => y.visits - x.visits) : [];
  const changes = st.changes.filter((c) => c.pageId === page.id).slice(0, 8);
  const cur = page.vslId ? vslById.get(page.vslId) : null;
  const fb = page.fallbackVslId ? vslById.get(page.fallbackVslId) : null;
  const pageUrl = page.lastSeenUrl ? `https://${page.lastSeenUrl}` : null;

  async function preview() {
    const w = pageUrl ? window.open('about:blank', '_blank') : null;
    const ok = await onAct({ action: 'preview', pageId: page.id, vslId: previewId });
    if (!w) return;
    if (ok) { w.opener = null; w.location.href = `${pageUrl}?ns_vsl_preview=1`; } else w.close();
  }

  return (
    <VslDrawer title={vslPageName(page)} sub={`${page.platform} · chave ${page.key}${page.variant ? ` · ${vslBottlesText(page.feBottles)}` : ''}`} onClose={onClose} wide>
      <div className="vsl-drawer-status">
        <VslStatus status={status} page={page} nowMs={nowMs}/>
        {page.lastSeenUrl && (
          <span className="vsl-inline-form" style={{ gap: 6 }}>
            <a className="vsl-link" href={pageUrl} target="_blank" rel="noopener noreferrer" title="Endereço gravado no primeiro acesso">{page.lastSeenUrl} <Icon name="external-link" size={12}/></a>
            <button className="btn btn-ghost vsl-icon-btn" disabled={busy} title="A página mudou de endereço? Redefina e o próximo acesso grava o novo."
              onClick={() => { if (window.confirm('Redefinir o endereço desta página? O próximo acesso real grava o novo.')) onAct({ action: 'reset_page_url', pageId: page.id }); }}>Redefinir</button>
          </span>
        )}
      </div>

      {b && (
        <div className="vsl-mini-kpis">
          <div><span className="kpi-label">Visitas</span><strong className="num">{fmtInt(b.visits)}</strong></div>
          <div><span className="kpi-label">Pitch</span><strong className="num">{vslPct(b.pitchRate)}</strong></div>
          <div><span className="kpi-label">Aceite</span><strong className="num" style={{ color: 'var(--accent)' }}>{vslPct(b.acceptRate)}</strong></div>
          <div><span className="kpi-label">Take real</span><strong className="num">{b.real ? vslPct(b.real.takeRate) : '—'}</strong></div>
        </div>
      )}

      <VslSection title="VSL no ar" hint={page.test ? 'Há um teste A/B aberto nesta página — a VSL fixa volta quando o teste for pausado ou encerrado.' : 'A troca entra na página em até 1 minuto.'}>
        {page.test ? (
          <button className="btn btn-ghost" onClick={onOpenTest}><Icon name="flask" size={14}/> Ver o teste ({page.test.arms.map((a) => `${a.label} ${a.weight}%`).join(' · ')})</button>
        ) : (
          <div className="vsl-inline-form">
            <VslVslSelect vsls={st.vsls} value={assignId} onChange={setAssignId} includeArchivedId={page.vslId} label="VSL para colocar no ar"/>
            <button className="btn btn-primary" disabled={busy || !assignId || assignId === page.vslId}
              onClick={() => onAct({ action: 'assign_vsl', pageId: page.id, vslId: assignId })}>Colocar no ar</button>
          </div>
        )}
        {cur && !page.test && <div className="vsl-muted" style={{ marginTop: 6 }}>No ar agora: <strong>{cur.name}</strong> · pitch {vslFmtPitch(cur.pitchSeconds)}</div>}
        <label className="vsl-toggle">
          <input type="checkbox" checked={page.enabled} disabled={busy}
            onChange={(e) => onAct({ action: 'set_enabled', pageId: page.id, enabled: e.target.checked })}/>
          <span>Página ligada no dash <span className="vsl-muted">— desligada, ela toca a reserva do snippet{fb ? ` (${fb.name})` : ''}</span></span>
        </label>
      </VslSection>

      <VslAffiliateRules page={page} st={st} perf={perf} busy={busy} onAct={onAct} onToast={onToast}/>

      <VslSection title="Variante" hint="Para quando a mesma etapa tem mais de uma página (ex.: upsell de quem levou 6 potes × 2–3 potes). Mudar aqui não muda o snippet.">
        <VslVariantFields variant={variant} setVariant={setVariant} bottles={bottles} setBottles={setBottles} options={st.options.feBottles || [1, 2, 3, 4, 5, 6]}
          error={variantClash ? (variant.trim() ? `Já existe a variante “${variant.trim()}” nesta etapa.` : 'Esta etapa já tem uma página sem variante.') : null}/>
        <div style={{ marginTop: 8 }}>
          <button className="btn btn-ghost" disabled={busy || !variantDirty || variantClash}
            onClick={() => onAct({ action: 'update_variant', pageId: page.id, variant: variant.trim(), feBottles: bottles })}>Salvar variante</button>
        </div>
      </VslSection>

      <VslSection title="Pré-visualizar na página" hint={pageUrl ? `Abre a página real com a VSL escolhida, só para você, por ${st.previewMinutes} min. Não entra na métrica.` : 'Disponível depois da primeira visita (o dash precisa saber o endereço da página).'}>
        <div className="vsl-inline-form">
          <VslVslSelect vsls={st.vsls} value={previewId} onChange={setPreviewId} label="VSL para pré-visualizar"/>
          <button className="btn btn-ghost" disabled={busy || !previewId || !pageUrl} onClick={preview}><Icon name="eye" size={14}/> Pré-visualizar</button>
        </div>
      </VslSection>

      <div ref={snippetRef}>
        <VslSection title="Snippet da página" hint={fb ? `Reserva: ${fb.name} (pitch ${vslFmtPitch(fb.pitchSeconds)}) — é o que toca se o dash não responder.` : null}>
          <VslSnippet page={page} onCopied={(ok) => onToast(ok ? 'Snippet copiado.' : 'Não deu para copiar — selecione o texto e copie.')}/>
        </VslSection>
      </div>

      <VslSection title="Reserva do snippet" hint="Use a VSL que está fixa no HTML da página. Trocar a reserva muda o snippet: cole a versão nova.">
        <div className="vsl-inline-form">
          <VslVslSelect vsls={st.vsls} value={fallbackId} onChange={setFallbackId} includeArchivedId={page.fallbackVslId} label="VSL de reserva do snippet"/>
          <button className="btn btn-ghost" disabled={busy || !fallbackId || fallbackId === page.fallbackVslId}
            onClick={() => onAct({ action: 'set_fallback', pageId: page.id, vslId: fallbackId })}>Trocar reserva</button>
        </div>
      </VslSection>

      {pv.length > 0 && (
        <VslSection title="VSLs nesta página" hint="No período do filtro">
          <div className="tbl-wrap">
            <table className="tbl vsl-tbl">
              <thead><tr><th>VSL</th><th className="num">Visitas</th><th className="num">Pitch</th><th className="num">Aceite</th><th className="num">Take real</th></tr></thead>
              <tbody>
                {pv.map((r) => (
                  <tr key={r.vslId || 'fb'}>
                    <td>{r.vslId ? (vslById.get(r.vslId) || {}).name || 'VSL removida' : 'Reserva'}</td>
                    <td className="num">{fmtInt(r.visits)}</td>
                    <td className="num">{vslPct(r.pitchRate)}</td>
                    <td className="num">{vslPct(r.acceptRate)}</td>
                    <td className="num">{r.real ? vslPct(r.real.takeRate) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </VslSection>
      )}

      <VslVisitsSection page={page} busy={busy} onAct={onAct}/>

      <VslSection title="Últimas alterações">
        {changes.length === 0 ? <div className="vsl-muted">Nada ainda.</div> : (
          <ul className="vsl-timeline">
            {changes.map((c) => (
              <li key={c.id}><span className="vsl-muted">{fmtDateTime(c.createdAt)} · {c.actorName || '—'}</span><div>{c.detail}</div></li>
            ))}
          </ul>
        )}
      </VslSection>

      <VslSection title="Excluir página">
        <div className="vsl-muted" style={{ marginBottom: 8 }}>
          {page.test
            ? 'Encerre o teste A/B desta página antes de excluir.'
            : 'A página real continua funcionando com a reserva do snippet. Os testes encerrados desta página e os números dela saem da aba.'}
        </div>
        <button className="btn btn-ghost vsl-danger" disabled={busy || !!page.test}
          onClick={() => { if (window.confirm(`Excluir a página ${vslPageName(page, true)}?

Os testes encerrados dela e os números dela saem da aba (o histórico de alterações fica).`)) onAct({ action: 'delete_page', pageId: page.id }, { close: true }); }}>
          <Icon name="trash-2" size={14}/> Excluir página
        </button>
      </VslSection>
    </VslDrawer>
  );
}

function VslVariantFields({ variant, setVariant, bottles, setBottles, options, error }) {
  const toggle = (n) => setBottles(bottles.includes(n) ? bottles.filter((x) => x !== n) : [...bottles, n].sort((a, b) => a - b));
  return (
    <>
      <VslField label="Variante (opcional)" error={error}
        hint="Use quando a mesma etapa tem mais de uma página — ex.: “6 potes” e “2–3 potes”. Vazio = página única da etapa.">
        <input value={variant} onChange={(e) => setVariant(e.target.value)} maxLength={40} placeholder="Ex.: 2–3 potes" style={{ width: '100%' }}/>
      </VslField>
      <div className="vsl-field">
        <span className="vsl-field-label" id="vsl-bottles-label">Potes do front que levam a esta página (opcional)</span>
        <div className="vsl-chips" role="group" aria-labelledby="vsl-bottles-label" style={{ margin: 0 }}>
          {options.map((n) => (
            <button key={n} type="button" className={bottles.includes(n) ? 'chip is-active' : 'chip'} aria-pressed={bottles.includes(n)} onClick={() => toggle(n)}>
              {n} pote{n === 1 ? '' : 's'}
            </button>
          ))}
        </div>
        <span className="vsl-field-hint">
          {bottles.length
            ? `A venda real desta página conta só quem comprou ${vslBottlesText(bottles)}.`
            : 'Sem marcar, a venda real conta todo front da família — marque para separar entre variantes.'}
        </span>
      </div>
    </>
  );
}

function VslNewPageDrawer({ st, busy, draft, onClose, onAct, onNewVsl, onOpenPage }) {
  const d = draft || {};
  const [family, setFamily] = useStateVsl(d.family || '');
  const [stage, setStage] = useStateVsl(d.stage || 'UP01');
  const [platform, setPlatform] = useStateVsl(d.platform || '');
  const [vslId, setVslId] = useStateVsl(d.vslId || '');
  const [variant, setVariant] = useStateVsl(d.variant || '');
  const [bottles, setBottles] = useStateVsl(d.feBottles || []);
  const siblings = st.pages.filter((p) => p.family === family && p.stage === stage && p.platform === platform);
  const norm = (x) => (x || '').trim().toLowerCase();
  const exists = siblings.find((p) => norm(p.variant) === norm(variant));
  const variantError = exists
    ? (variant.trim() ? `Já existe a variante “${variant.trim()}” nesta etapa.` : 'Esta etapa já tem uma página — dê um nome de variante para criar outra.')
    : null;
  const ready = family && stage && platform && vslId && !exists;
  return (
    <VslDrawer title="Nova página" sub="Uma etapa do funil que vai receber a VSL pelo dash" onClose={onClose}
      footer={<button className="btn btn-primary" disabled={busy || !ready}
        onClick={() => onAct({ action: 'create_page', family, stage, platform, vslId, variant: variant.trim(), feBottles: bottles }, { openCreated: 'snippet' })}>Criar e gerar snippet</button>}>
      <VslField label="Família (produto)">
        <select value={family} onChange={(e) => setFamily(e.target.value)} style={{ width: '100%' }}>
          <option value="">Escolha a família</option>
          {st.options.families.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </VslField>
      <div className="vsl-form-row">
        <VslField label="Etapa">
          <select value={stage} onChange={(e) => setStage(e.target.value)} style={{ width: '100%' }}>
            {st.options.stages.map((s) => <option key={s.id} value={s.id}>{s.label} ({s.id})</option>)}
          </select>
        </VslField>
        <VslField label="Plataforma">
          <select value={platform} onChange={(e) => setPlatform(e.target.value)} style={{ width: '100%' }}>
            <option value="">Escolha</option>
            {st.options.platforms.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </VslField>
      </div>
      {siblings.length > 0 && (
        <div className="vsl-note" role="status">
          <Icon name="info" size={14}/>
          <div>
            Esta etapa já tem {siblings.length === 1 ? 'a página' : 'as páginas'}{' '}
            {siblings.map((p, i) => (
              <React.Fragment key={p.id}>
                {i > 0 ? ', ' : ''}
                <button type="button" className="vsl-link" onClick={() => onOpenPage(p.id)}>{p.variant || 'sem variante'}</button>
              </React.Fragment>
            ))}
            . Dê um nome de variante para criar outra{siblings.some((p) => !p.variant) ? ' — e vale nomear a que já existe (abra e edite a variante; o snippet dela não muda)' : ''}.
          </div>
        </div>
      )}
      <VslVariantFields variant={variant} setVariant={setVariant} bottles={bottles} setBottles={setBottles} options={st.options.feBottles || [1, 2, 3, 4, 5, 6]} error={family && platform ? variantError : null}/>
      <VslField label="VSL que está hoje na página"
        hint="Vira a VSL no ar e a reserva do snippet (o que toca se o dash não responder).">
        <VslVslSelect vsls={st.vsls} value={vslId} onChange={setVslId}/>
      </VslField>
      <button className="btn btn-ghost" onClick={() => onNewVsl({ family, stage, platform, vslId, variant, feBottles: bottles })}><Icon name="plus" size={14}/> Cadastrar uma VSL nova</button>
      <div className="vsl-field-hint">Cadastre e volte para cá — o que você já preencheu fica guardado.</div>
    </VslDrawer>
  );
}

function VslVslDrawer({ vsl, st, perf, busy, onClose, onAct, onCreated }) {
  const isNew = !vsl;
  const [name, setName] = useStateVsl(vsl ? vsl.name : '');
  const [code, setCode] = useStateVsl('');
  const [pitch, setPitch] = useStateVsl(vsl ? vslFmtPitch(vsl.pitchSeconds) : '');
  const [notes, setNotes] = useStateVsl(vsl ? vsl.notes || '' : '');
  const parsed = vslParseEmbed(code);
  const pitchSec = vslParsePitch(pitch);
  const dup = parsed && !parsed.error ? st.vsls.find((v) => v.playerId === parsed.playerId && (!vsl || v.id !== vsl.id)) : null;
  const pages = vsl ? st.pages.filter((p) => p.vslId === vsl.id || p.fallbackVslId === vsl.id || (p.test && p.test.arms.some((a) => a.vslId === vsl.id))
    || (p.affRules || []).some((r) => r.vslId === vsl.id)) : [];
  const inUse = pages.length > 0;
  const perfRows = vsl && perf ? perf.byPageVsl.filter((r) => r.vslId === vsl.id) : [];
  const pageById = new Map(st.pages.map((p) => [p.id, p]));
  const codeOk = isNew ? parsed && !parsed.error && !dup : !code.trim() || (parsed && !parsed.error && !dup);
  const ready = name.trim() && pitchSec && codeOk;

  function save() {
    const body = isNew
      ? { action: 'create_vsl', name, code, pitch, notes }
      : { action: 'update_vsl', id: vsl.id, name, pitch, notes, ...(code.trim() ? { code } : {}) };
    onAct(body, { close: true, after: isNew && onCreated ? (res) => onCreated(res.id) : null });
  }

  return (
    <VslDrawer title={isNew ? 'Nova VSL' : vsl.name} sub={isNew ? 'Nome, embed do VTurb e tempo do pitch' : `vid-${vsl.playerId}`} onClose={onClose}
      footer={<>
        {!isNew && (
          vsl.archived
            ? <button className="btn btn-ghost" disabled={busy} onClick={() => onAct({ action: 'restore_vsl', id: vsl.id })}>Restaurar</button>
            : <button className="btn btn-ghost" disabled={busy || inUse} title={inUse ? 'Em uso: troque nas páginas (inclusive a reserva do snippet) antes de arquivar' : undefined}
                onClick={() => onAct({ action: 'archive_vsl', id: vsl.id }, { close: true })}>Arquivar</button>
        )}
        <button className="btn btn-primary" disabled={busy || !ready} onClick={save}>{isNew ? 'Cadastrar VSL' : 'Salvar'}</button>
      </>}>
      <VslField label="Nome" hint="Como a equipe reconhece a VSL (ex.: GlycoEden UP01 · v3 dor).">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} style={{ width: '100%' }}/>
      </VslField>
      <VslField label={isNew ? 'Código de embed do VTurb' : 'Trocar o vídeo (opcional)'}
        error={code.trim() ? (parsed && parsed.error) || (dup ? `Esse player já está na biblioteca como "${dup.name}".` : null) : null}
        hint={isNew ? 'Cole o embed inteiro: o <vturb-smartplayer> e o <script> do player.js.' : 'Cole um embed novo só se for trocar o vídeo desta VSL — as páginas que usam ela mudam junto.'}>
        <textarea value={code} onChange={(e) => setCode(e.target.value)} rows={5} spellCheck={false} className="vsl-code-input"
          placeholder={'<vturb-smartplayer id="vid-…"></vturb-smartplayer>\n<script>… scripts.converteai.net/…/player.js …</script>'}/>
      </VslField>
      {parsed && !parsed.error && (
        <div className="vsl-parsed" role="status">
          <Icon name="check" size={14}/> Player <span className="cell-mono">{parsed.playerId}</span> · {vslAspect(parsed.aspectPct)}
        </div>
      )}
      <VslField label="Tempo do pitch" error={pitch.trim() && !pitchSec ? 'Use minutos:segundos (ex.: 5:27).' : null}
        hint={pitchSec ? `A oferta aparece aos ${vslFmtPitch(pitchSec)} de vídeo assistido (${pitchSec} s).` : 'Momento do vídeo em que a oferta aparece na página (minutos:segundos).'}>
        <input value={pitch} onChange={(e) => setPitch(e.target.value)} placeholder="5:27" style={{ width: 140 }}/>
      </VslField>
      <VslField label="Notas (opcional)">
        <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} style={{ width: '100%' }}/>
      </VslField>

      {!isNew && (
        <VslSection title="Onde está">
          {pages.length === 0 ? <div className="vsl-muted">Em nenhuma página agora.</div> : (
            <ul className="vsl-timeline">
              {pages.map((p) => {
                const ruleN = (p.affRules || []).filter((r) => r.vslId === vsl.id).length;
                const roles = [p.vslId === vsl.id ? 'no ar' : null, p.test && p.test.arms.some((a) => a.vslId === vsl.id) ? 'em teste' : null, p.fallbackVslId === vsl.id ? 'reserva do snippet' : null, ruleN ? `${ruleN} regra${ruleN === 1 ? '' : 's'} de afiliado` : null].filter(Boolean);
                return <li key={p.id}>{vslPageName(p, true)} <span className="vsl-muted">({roles.join(', ')})</span></li>;
              })}
            </ul>
          )}
        </VslSection>
      )}
      {perfRows.length > 0 && (
        <VslSection title="Desempenho no período">
          <div className="tbl-wrap">
            <table className="tbl vsl-tbl">
              <thead><tr><th>Página</th><th className="num">Visitas</th><th className="num">Pitch</th><th className="num">Aceite</th><th className="num">Take real</th></tr></thead>
              <tbody>
                {perfRows.map((r) => {
                  const p = pageById.get(r.pageId);
                  return (
                    <tr key={r.pageId}>
                      <td>{p ? vslPageName(p) : 'Página excluída'}</td>
                      <td className="num">{fmtInt(r.visits)}</td>
                      <td className="num">{vslPct(r.pitchRate)}</td>
                      <td className="num">{vslPct(r.acceptRate)}</td>
                      <td className="num">{r.real ? vslPct(r.real.takeRate) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </VslSection>
      )}
    </VslDrawer>
  );
}

function VslNewTestDrawer({ st, busy, presetPageId, onClose, onAct }) {
  const candidates = st.pages.filter((p) => !p.test);
  const [pageId, setPageId] = useStateVsl(presetPageId && candidates.some((p) => p.id === presetPageId) ? presetPageId : '');
  const page = st.pages.find((p) => p.id === pageId);
  const [name, setName] = useStateVsl('');
  const [arms, setArms] = useStateVsl([{ vslId: '', weight: 50 }, { vslId: '', weight: 50 }]);
  useEffectVsl(() => {
    if (page) setArms((a) => [{ ...a[0], vslId: page.vslId || '' }, ...a.slice(1)]);
  }, [pageId]);
  const total = arms.reduce((s, a) => s + (Number(a.weight) || 0), 0);
  const ids = arms.map((a) => a.vslId).filter(Boolean);
  const dupes = ids.length !== new Set(ids).size;
  const weightProblem = vslWeightsProblem(arms.map((a) => a.weight));
  const ready = page && arms.every((a) => a.vslId) && !dupes && !weightProblem;
  const set = (i, patch) => setArms(arms.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const even = () => {
    const n = arms.length, base = Math.floor(100 / n), extra = 100 - base * n;
    setArms(arms.map((a, i) => ({ ...a, weight: base + (i < extra ? 1 : 0) })));
  };
  return (
    <VslDrawer title="Novo teste A/B" sub="Divide o tráfego da página entre 2 a 4 VSLs" onClose={onClose} wide
      footer={<button className="btn btn-primary" disabled={busy || !ready}
        onClick={() => onAct({ action: 'start_test', pageId, name, arms: arms.map((a) => ({ vslId: a.vslId, weight: Number(a.weight) })) }, { close: true, go: 'tests' })}>
        <Icon name="flask" size={14}/> Começar teste</button>}>
      <VslField label="Página" hint={candidates.length < st.pages.length ? 'Páginas com teste aberto não aparecem.' : null}>
        <select value={pageId} onChange={(e) => setPageId(e.target.value)} style={{ width: '100%' }}>
          <option value="">Escolha a página</option>
          {candidates.map((p) => <option key={p.id} value={p.id}>{vslPageName(p, true)}{p.enabled ? '' : ' (desligada)'}</option>)}
        </select>
      </VslField>
      {page && !page.installedAt && <div className="vsl-field-error" role="alert">Essa página ainda não recebeu visita — o teste só coleta dado depois que o snippet estiver no ar.</div>}
      <VslField label="Nome do teste (opcional)" hint="Vazio: o dash usa os nomes das VSLs.">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Ex.: pitch curto × pitch longo" style={{ width: '100%' }}/>
      </VslField>

      <div className="vsl-block-title" style={{ margin: '6px 0' }}>VSLs do teste</div>
      {arms.map((a, i) => (
        <div key={i} className="vsl-arm-row">
          <span className="vsl-arm">{['A', 'B', 'C', 'D'][i]}</span>
          <div style={{ flex: 1, minWidth: 0 }}><VslVslSelect vsls={st.vsls} value={a.vslId} onChange={(v) => set(i, { vslId: v })} placeholder={i === 0 ? 'Controle (a VSL de hoje)' : 'Desafiante'} label={`VSL do braço ${['A', 'B', 'C', 'D'][i]}`}/></div>
          <div className="vsl-weight">
            <input type="number" min={0} max={100} step={1} value={a.weight} onChange={(e) => set(i, { weight: e.target.value })} aria-label={`Peso do braço ${['A', 'B', 'C', 'D'][i]}`}/>
            <span>%</span>
          </div>
          {arms.length > 2 && <button className="btn btn-ghost vsl-icon-btn" aria-label="Remover braço" onClick={() => setArms(arms.filter((_, j) => j !== i))}><Icon name="x" size={14}/></button>}
        </div>
      ))}
      <div className="vsl-inline-form" style={{ justifyContent: 'space-between' }}>
        <div>
          {arms.length < 4 && <button className="btn btn-ghost" onClick={() => setArms([...arms, { vslId: '', weight: 0 }])}><Icon name="plus" size={14}/> Outra VSL</button>}{' '}
          <button className="btn btn-ghost" onClick={even}>Dividir igual</button>
        </div>
        <span className="num" style={{ color: total === 100 ? 'var(--success)' : 'var(--danger)' }}>Soma {total}%</span>
      </div>
      {dupes && <div className="vsl-field-error" role="alert">A mesma VSL aparece em dois braços.</div>}
      {!dupes && weightProblem && total === 100 && <div className="vsl-field-error" role="alert">{weightProblem}</div>}
      <div className="vsl-footnote">
        Cada visitante é sorteado uma vez e fica sempre na mesma VSL. A decisão usa o <strong>aceite</strong> (clique em comprar);
        na BuyGoods aparece também a venda confirmada. Recomendação: só encerre com "Vencedor claro" (95% de chance de ser a melhor).
      </div>
    </VslDrawer>
  );
}

function VslFinishDialog({ tr, st, busy, onClose, onAct }) {
  const vslById = new Map(st.vsls.map((v) => [v.id, v]));
  const statsById = new Map(tr.byAccept.arms.map((a) => [a.id, a]));
  const leader = tr.arms.find((a) => a.id === tr.byAccept.leaderId);
  const [winner, setWinner] = useStateVsl(tr.byAccept.verdict === 'leader' && leader ? leader.vslId : '');
  return (
    <VslDrawer title="Encerrar teste" sub={tr.name} onClose={onClose}
      footer={<button className="btn btn-primary" disabled={busy}
        onClick={() => onAct({ action: 'finish_test', testId: tr.id, winnerVslId: winner || null }, { close: true })}>
        {winner ? 'Encerrar e colocar no ar' : 'Encerrar sem aplicar'}</button>}>
      <div className="vsl-verdict" style={{ background: (VSL_VERDICT[tr.byAccept.verdict] || VSL_VERDICT.running).bg, marginBottom: 12 }}>{tr.byAccept.message}</div>
      <fieldset className="vsl-radios">
        <legend className="vsl-field-label">Qual VSL fica no ar?</legend>
        {tr.arms.map((a) => {
          const s = statsById.get(a.id) || {};
          const v = vslById.get(a.vslId);
          return (
            <label key={a.id} className={`vsl-radio${winner === a.vslId ? ' is-active' : ''}`}>
              <input type="radio" name="winner" checked={winner === a.vslId} onChange={() => setWinner(a.vslId)}/>
              <span className="vsl-arm">{a.label}</span>
              <span style={{ flex: 1 }}>{v ? v.name : 'VSL removida'}</span>
              <span className="num vsl-muted">{vslPct(a.acceptRate)} · {vslPct(s.probBest, 0)} chance</span>
            </label>
          );
        })}
        <label className={`vsl-radio${!winner ? ' is-active' : ''}`}>
          <input type="radio" name="winner" checked={!winner} onChange={() => setWinner('')}/>
          <span style={{ flex: 1 }}>Nenhuma — a página volta para a VSL fixa de antes</span>
        </label>
      </fieldset>
    </VslDrawer>
  );
}

function VslWeightsDialog({ tr, st, busy, onClose, onAct }) {
  const vslById = new Map(st.vsls.map((v) => [v.id, v]));
  const [w, setW] = useStateVsl(() => Object.fromEntries(tr.arms.map((a) => [a.id, a.weight])));
  const total = Object.values(w).reduce((s, x) => s + (Number(x) || 0), 0);
  const problem = vslWeightsProblem(tr.arms.map((a) => w[a.id]));
  return (
    <VslDrawer title="Ajustar pesos" sub={tr.name} onClose={onClose}
      footer={<button className="btn btn-primary" disabled={busy || !!problem}
        onClick={() => onAct({ action: 'update_weights', testId: tr.id, weights: tr.arms.map((a) => ({ armId: a.id, weight: Number(w[a.id]) })) }, { close: true })}>Salvar pesos</button>}>
      <div className="vsl-muted" style={{ marginBottom: 10 }}>Vale para quem chegar a partir de agora. Quem já viu uma VSL continua nela.</div>
      {tr.arms.map((a) => (
        <div key={a.id} className="vsl-arm-row">
          <span className="vsl-arm">{a.label}</span>
          <span style={{ flex: 1 }}>{(vslById.get(a.vslId) || {}).name || 'VSL removida'}</span>
          <div className="vsl-weight">
            <input type="number" min={0} max={100} step={1} value={w[a.id]} onChange={(e) => setW({ ...w, [a.id]: e.target.value })} aria-label={`Peso do braço ${a.label}`}/>
            <span>%</span>
          </div>
        </div>
      ))}
      <div className="num" style={{ textAlign: 'right', color: total === 100 ? 'var(--success)' : 'var(--danger)' }}>Soma {total}%</div>
      {problem && total === 100 && <div className="vsl-field-error" role="alert">{problem}</div>}
    </VslDrawer>
  );
}

// ── Página ────────────────────────────────────────────────────────────────

function vslReadSection() {
  try {
    const u = new URLSearchParams(window.location.search).get('sec');
    if (u && VSL_SECTIONS.some((s) => s.id === u)) return u;
    const s = localStorage.getItem('ns-vsl-section');
    if (s && VSL_SECTIONS.some((x) => x.id === s)) return s;
  } catch (e) {}
  return 'overview';
}

function VslPage({ filters, user }) {
  const [st, setSt] = useStateVsl(null);
  const [stErr, setStErr] = useStateVsl(null);
  const [perf, setPerf] = useStateVsl(null);
  const [perfLoading, setPerfLoading] = useStateVsl(true);
  const [perfErr, setPerfErr] = useStateVsl(null);
  const [section, setSectionState] = useStateVsl(vslReadSection);
  const [stage, setStage] = useStateVsl('');
  const [q, setQ] = useStateVsl('');
  const [drawer, setDrawer] = useStateVsl(null);
  const [busy, setBusy] = useStateVsl(false);
  const [toast, setToast] = useStateVsl(null);
  const [nowMs, setNowMs] = useStateVsl(() => Date.now());

  const setSection = (id) => {
    setSectionState(id);
    setQ('');
    try {
      localStorage.setItem('ns-vsl-section', id);
      const u = new URL(window.location.href);
      u.searchParams.set('sec', id);
      window.history.replaceState(window.history.state, '', u.toString());
    } catch (e) {}
  };

  const loadState = useCallbackVsl(async () => {
    try {
      const s = await window.NSApi.fetchVslState();
      setSt(s); setStErr(null); setNowMs(Date.now());
      return s;
    } catch (e) { setStErr(e.message || String(e)); return null; }
  }, []);

  const perfSeq = useRefVsl(0);
  const loadPerf = useCallbackVsl(async () => {
    const seq = ++perfSeq.current;
    setPerfLoading(true);
    try {
      const data = await window.NSApi.fetchVslPerformance(filters, { stage: stage || null });
      if (seq !== perfSeq.current) return;
      setPerf(data); setPerfErr(null);
    } catch (e) {
      if (seq !== perfSeq.current) return;
      setPerfErr(e.message || String(e));
    } finally {
      if (seq === perfSeq.current) setPerfLoading(false);
    }
  }, [filters, stage]);

  useEffectVsl(() => { loadState(); }, [loadState]);
  useEffectVsl(() => { loadPerf(); }, [loadPerf]);
  // "Visto há X min" e situação das páginas andam sozinhos.
  useEffectVsl(() => {
    const t = setInterval(() => { setNowMs(Date.now()); loadState(); }, 60_000);
    return () => clearInterval(t);
  }, [loadState]);
  useEffectVsl(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3600);
    return () => clearTimeout(t);
  }, [toast]);

  // Escopos de página. Global = plataforma/família do filtro do topo (vale
  // pro Histórico). Escopo = global + etapa (Desempenho, Testes, contadores).
  // Páginas = escopo + busca. A busca nunca mexe em número de outra seção.
  const globalPages = useMemoVsl(() => (st ? st.pages.filter((p) =>
    (!filters.platforms || !filters.platforms.size || filters.platforms.has(p.platform)) &&
    (!filters.families || !filters.families.size || filters.families.has(p.family))) : []), [st, filters]);
  const globalPageIds = useMemoVsl(() => new Set(globalPages.map((p) => p.id)), [globalPages]);
  const scopedPages = useMemoVsl(() => globalPages.filter((p) => !stage || p.stage === stage), [globalPages, stage]);
  const scopedPageIds = useMemoVsl(() => new Set(scopedPages.map((p) => p.id)), [scopedPages]);
  const visiblePages = useMemoVsl(() => {
    const needle = q.trim().toLowerCase();
    return needle ? scopedPages.filter((p) => `${p.family} ${p.stage} ${p.platform} ${p.variant || ''} ${p.key}`.toLowerCase().includes(needle)) : scopedPages;
  }, [scopedPages, q]);
  const perfState = perfErr && !perf ? 'error' : perfLoading && !perf ? 'loading' : perfErr ? 'error' : 'ok';

  async function act(body, opts = {}) {
    setBusy(true);
    try {
      const res = await window.NSApi.adminVslAction(body);
      setToast(res.message || 'Salvo.');
      await loadState();
      loadPerf();
      if (opts.openCreated && res.id) setDrawer({ type: 'page', id: res.id, focus: opts.openCreated });
      else if (opts.close) setDrawer(null);
      if (opts.go) setSection(opts.go);
      if (opts.after) opts.after(res);
      return true;
    } catch (e) {
      setToast(`Não deu: ${e.message || e}`);
      return false;
    } finally { setBusy(false); }
  }

  function assign(p, vslId) {
    const v = st.vsls.find((x) => x.id === vslId);
    const cur = st.vsls.find((x) => x.id === p.vslId);
    if (!v || vslId === p.vslId) return;
    if (!window.confirm(`Colocar "${v.name}" no ar em ${vslPageName(p, true)}?\n\nSai: ${cur ? cur.name : 'reserva'}. Entra na página em até 1 minuto.`)) return;
    act({ action: 'assign_vsl', pageId: p.id, vslId });
  }

  if (stErr && !st) return <ReadState kind="falha" title="Não deu para abrir a aba VSLs" action="Tentar de novo" onAction={loadState}>{stErr}</ReadState>;
  if (!st) {
    return (
      <div>
        <div className="vsl-toolbar"><div className="skel" style={{ height: 36, width: 520, borderRadius: 6 }}/></div>
        <div className="vsl-kpis">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="panel vsl-kpi skel" style={{ height: 92 }}/>)}</div>
      </div>
    );
  }

  const counts = {
    overview: null,
    pages: scopedPages.length,
    library: st.vsls.filter((v) => !v.archived).length,
    tests: st.tests.filter((t) => t.status !== 'finished' && scopedPageIds.has(t.pageId)).length,
    history: null,
  };
  const primary = {
    pages: { label: 'Nova página', icon: 'plus', run: () => setDrawer({ type: 'newPage' }) },
    library: { label: 'Nova VSL', icon: 'plus', run: () => setDrawer({ type: 'vsl', id: null }) },
    tests: { label: 'Novo teste', icon: 'flask', run: () => setDrawer({ type: 'newTest' }) },
    overview: { label: 'Nova página', icon: 'plus', run: () => setDrawer({ type: 'newPage' }) },
    history: null,
  }[section];

  const openPage = (id, focus) => setDrawer({ type: 'page', id, focus });
  const openVsl = (id) => setDrawer({ type: 'vsl', id });
  const drawerPage = drawer && drawer.type === 'page' ? st.pages.find((p) => p.id === drawer.id) : null;
  const drawerVsl = drawer && drawer.type === 'vsl' && drawer.id ? st.vsls.find((v) => v.id === drawer.id) : null;
  const testResult = (id) => ((perf && perf.tests) || []).find((t) => t.id === id);

  return (
    <div className="vsl-page">
      <div className="vsl-toolbar">
        <div className="vsl-tabs" role="tablist" aria-label="Seções da aba VSLs">
          {VSL_SECTIONS.map((s) => (
            <button key={s.id} role="tab" aria-selected={section === s.id} className={section === s.id ? 'vsl-tab is-active' : 'vsl-tab'} onClick={() => setSection(s.id)}>
              <Icon name={s.icon} size={15}/> {s.label}
              {counts[s.id] != null && <span className="cnt">{counts[s.id]}</span>}
            </button>
          ))}
        </div>
        {primary && <button className="btn btn-primary" onClick={primary.run}><Icon name={primary.icon} size={14}/> {primary.label}</button>}
      </div>

      {section !== 'history' && (
        <div className="vsl-filters">
          <div className="vsl-chips" role="group" aria-label="Filtrar por etapa" style={{ margin: 0 }}>
            <button className={!stage ? 'chip is-active' : 'chip'} aria-pressed={!stage} onClick={() => setStage('')}>Todas as etapas</button>
            {st.options.stages.map((s) => (
              <button key={s.id} className={stage === s.id ? 'chip is-active' : 'chip'} aria-pressed={stage === s.id} onClick={() => setStage(s.id)} title={s.label}>{s.id}</button>
            ))}
          </div>
          {(section === 'pages' || section === 'library') && (
            <div className="vsl-search">
              <Icon name="search" size={14}/>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={section === 'library' ? 'Buscar VSL…' : 'Buscar página…'} aria-label={section === 'library' ? 'Buscar VSL' : 'Buscar página'}/>
            </div>
          )}
        </div>
      )}
      {section === 'history' && (
        <div className="vsl-filters">
          <div className="vsl-search" style={{ marginLeft: 0 }}>
            <Icon name="search" size={14}/>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar no histórico…" aria-label="Buscar no histórico"/>
          </div>
        </div>
      )}

      <div role="tabpanel">
        {section === 'overview' && (
          <VslOverview st={st} perf={perf} perfLoading={perfLoading} perfErr={perfErr} visiblePages={scopedPages} nowMs={nowMs}
            onOpenVsl={openVsl} onOpenPage={openPage} onGo={setSection}/>
        )}
        {section === 'pages' && (
          <VslPagesSection st={st} perf={perf} perfState={perfState} pages={visiblePages} nowMs={nowMs} busy={busy}
            onOpenPage={openPage} onAssign={assign} onNew={() => setDrawer({ type: 'newPage' })}/>
        )}
        {section === 'library' && <VslLibrarySection st={st} perf={perf} perfState={perfState} q={q} onOpenVsl={openVsl} onNew={() => setDrawer({ type: 'vsl', id: null })}/>}
        {section === 'tests' && (
          <VslTestsSection st={st} perf={perf} perfLoading={perfLoading} perfErr={perfErr} onRetry={loadPerf} visiblePageIds={scopedPageIds} busy={busy} onAct={act}
            onFinish={(tr) => setDrawer({ type: 'finish', id: tr.id })} onWeights={(tr) => setDrawer({ type: 'weights', id: tr.id })}
            onNew={() => setDrawer({ type: 'newTest' })}/>
        )}
        {section === 'history' && <VslHistorySection st={st} q={q} visiblePageIds={globalPageIds}/>}
      </div>

      {drawerPage && (
        <VslPageDrawer page={drawerPage} st={st} perf={perf} focus={drawer.focus} busy={busy} nowMs={nowMs}
          onClose={() => setDrawer(null)} onAct={act} onToast={setToast}
          onOpenTest={() => { setDrawer(null); setSection('tests'); }}/>
      )}
      {drawer && drawer.type === 'newPage' && (
        <VslNewPageDrawer key={JSON.stringify(drawer.draft || {})} st={st} busy={busy} draft={drawer.draft} onClose={() => setDrawer(null)} onAct={act}
          onOpenPage={(id) => setDrawer({ type: 'page', id })}
          onNewVsl={(draft) => setDrawer({ type: 'vsl', id: null, returnDraft: draft })}/>
      )}
      {drawer && drawer.type === 'vsl' && (drawer.id == null || drawerVsl) && (
        <VslVslDrawer key={drawer.id || 'new'} vsl={drawerVsl} st={st} perf={perf} busy={busy} onAct={act}
          onClose={() => setDrawer(drawer.returnDraft ? { type: 'newPage', draft: drawer.returnDraft } : null)}
          onCreated={drawer.returnDraft ? (id) => setDrawer({ type: 'newPage', draft: { ...drawer.returnDraft, vslId: id } }) : null}/>
      )}
      {drawer && drawer.type === 'newTest' && (
        <VslNewTestDrawer st={st} busy={busy} presetPageId={drawer.pageId} onClose={() => setDrawer(null)} onAct={act}/>
      )}
      {drawer && drawer.type === 'finish' && testResult(drawer.id) && (
        <VslFinishDialog tr={testResult(drawer.id)} st={st} busy={busy} onClose={() => setDrawer(null)} onAct={act}/>
      )}
      {drawer && drawer.type === 'weights' && testResult(drawer.id) && (
        <VslWeightsDialog tr={testResult(drawer.id)} st={st} busy={busy} onClose={() => setDrawer(null)} onAct={act}/>
      )}

      {/* Região viva sempre montada: leitor de tela anuncia a troca de texto. */}
      <div className={toast ? 'vsl-toast' : 'vsl-sr-only'} role="status" aria-live="polite">{toast || ''}</div>
    </div>
  );
}

Object.assign(window, { VslPage });
