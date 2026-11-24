/* global React, Icon, CountUp, fmtCurrency, fmtInt */
/* Briefing da IA no topo da Visão geral (2026-11-24): saudação + símbolo da
   NorthScale + leitura da semana (7 dias fechados × 7 anteriores) escrita pela
   IA sobre os números do dash. Dados: GET /api/metrics/briefing
   (lib/briefing/service.ts). Os números aparecem na hora; o texto entra
   quando a IA termina (a tela pede de novo enquanto status = generating).

   Movimento com significado e sem enfeite (docs/design-system.md: nada de
   brilho, vidro ou gradiente): o símbolo se desenha, os números contam, as
   linhas da semana se traçam, a manchete é escrita. Tudo some com
   prefers-reduced-motion. */

const { useState: useStateBf, useEffect: useEffectBf, useRef: useRefBf } = React;

const BF_REDUCED = typeof window !== 'undefined' && !!window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const BF_COLLAPSE_KEY = 'ns.briefing.collapsed';
const BF_TONE = { positivo: 'good', negativo: 'bad', neutro: 'flat' };
const BF_TONE_ICON = { positivo: 'arrow-up-right', negativo: 'arrow-down-right', neutro: 'info' };
const BF_TILES = ['faturamento', 'pedidos', 'aov', 'net_after_cpa'];
const BF_CHIPS = ['aprovacao', 'reembolso', 'chargeback'];

function bfGreeting(now) {
  const h = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }).format(now)) % 24;
  if (h >= 5 && h < 12) return 'Bom dia';
  if (h >= 12 && h < 18) return 'Boa tarde';
  return 'Boa noite';
}
function bfFirstName(user) {
  const raw = (user && (user.name || (user.email || '').split('@')[0])) || '';
  const first = raw.trim().split(/[\s._-]+/)[0] || '';
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : '';
}
// "terça-feira, 24 de novembro" → "Terça-feira, 24 de novembro" (só a 1ª letra).
function bfToday(now) {
  const s = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' }).format(now);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function bfDm(ymd) { return ymd ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}` : ''; }
function bfFormatter(format) {
  if (format === 'pct') return (n) => `${(n * 100).toFixed(1)}%`;
  if (format === 'int') return (n) => fmtInt(n);
  if (format === 'money2') return (n) => fmtCurrency(n, 'USD', 2);
  return (n) => fmtCurrency(n, 'USD', 0);
}

// Símbolo oficial (public/assets/brand/app-icon-sem-fundo.svg) em três
// partes: os arcos se traçam, a montanha sobe, o N entra por último.
function BfMark({ size = 56 }) {
  return (
    <svg className="bf-mark" viewBox="0 0 1024 1024" width={size} height={size} aria-hidden="true">
      <g transform="translate(112.640 121.766) scale(2.812394)">
        <path className="bf-mark-arcs" pathLength="1" d="M0,155.71c0,26.93,7.5,52.12,20.52,73.57l12.89-20.17c-7.95-16.11-12.41-34.24-12.41-53.4,0-51.99,32.79-96.32,78.82-113.44v-22.19C41.99,38.04,0,91.97,0,155.71ZM184.18,20.08v22.19c46.03,17.11,78.82,61.45,78.82,113.44,0,18.23-4.04,35.53-11.27,51.03l12.74,20.89c12.41-21.09,19.53-45.68,19.53-71.92,0-63.74-41.99-117.67-99.82-135.63Z"/>
        <path className="bf-mark-mountain" d="M255.27,241.35c-3.66,4.84-7.63,9.44-11.86,13.77l-5.36-9.43-8.03-6.96-15.04-13.06,5.21,17.94,1.07,3.52,2.3,7.54,11.83,8.01c-6.32,5.52-13.13,10.49-20.36,14.83l-15.13-15.53-9.59-9.86-37.8-25.29,7.53-16.35-15.13-17.62-7.9-8.84,2.63-18.3c.69-4.82,1.74-9.23,2.08-14.41l-19.49,21.04-13.11,14.64-24.28,33.97-15.8,6.13-10.75,15.98-2.98,4.43-8.76,13.35c-6.1-5.55-11.73-11.62-16.8-18.15l12.15-19.02,14.43-22.6,16.6,2.82,33.66-57.17,33.62-56.95,29.02,53.51,32.82,60.55,18.29-19.79,23.02,37.76,11.91,19.54Z"/>
        <polygon className="bf-mark-n" points="170.18 0 170.18 59.6 154.01 59.6 137.81 36.65 131.01 27.03 131.01 59.6 114.84 59.6 114.84 0 131.01 0 144.08 18.49 154.01 32.55 154.01 0 170.18 0"/>
      </g>
    </svg>
  );
}

// Manchete escrita letra a letra (até ~1,4 s, qualquer tamanho).
function BfTypewriter({ text }) {
  const [n, setN] = useStateBf(BF_REDUCED ? text.length : 0);
  useEffectBf(() => {
    if (BF_REDUCED) { setN(text.length); return undefined; }
    setN(0);
    const step = Math.max(1, Math.ceil(text.length / 70));
    const id = setInterval(() => setN((x) => {
      if (x + step >= text.length) { clearInterval(id); return text.length; }
      return x + step;
    }), 20);
    return () => clearInterval(id);
  }, [text]);
  const done = n >= text.length;
  return <span>{text.slice(0, n)}{!done && <span className="bf-caret" aria-hidden="true"/>}</span>;
}

// Semana atual (linha cheia) sobre a anterior (tracejada).
function BfSpark({ series, tone }) {
  const W = 132; const H = 34;
  const vals = series.flatMap((p) => [p.cur, p.prev]);
  const max = Math.max(1, ...vals);
  const pts = (key) => series.map((p, i) => {
    const x = series.length > 1 ? (i / (series.length - 1)) * (W - 4) + 2 : W / 2;
    const y = H - 3 - (p[key] / max) * (H - 6);
    return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  if (!series.length) return null;
  return (
    <svg className={`bf-spark is-${tone}`} viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
      <path className="bf-spark-prev" d={pts('prev')}/>
      <path className="bf-spark-cur" pathLength="1" d={pts('cur')}/>
    </svg>
  );
}

function BfTile({ m, series, index }) {
  const tone = m.good == null ? 'flat' : m.good ? 'good' : 'bad';
  return (
    <div className="bf-tile" style={{ '--i': index }}>
      <div className="bf-tile-label">{m.label}</div>
      {/* Dinheiro em verde (DS); valor negativo (ex.: Net after CPA no prejuízo) em vermelho. */}
      <div className={`bf-tile-value${m.cur < 0 ? ' is-negative' : m.format.startsWith('money') ? ' is-money' : ''}`}>
        {BF_REDUCED ? m.curFmt : <CountUp value={m.cur} format={bfFormatter(m.format)} duration={1100}/>}
      </div>
      <div className="bf-tile-foot">
        <span className={`bf-delta is-${tone}`} title={`semana anterior: ${m.prevFmt}`}>
          {m.deltaFmt}
        </span>
        {series && <BfSpark series={series} tone={tone}/>}
      </div>
    </div>
  );
}

function BriefingHero({ user }) {
  const [state, setState] = useStateBf({ status: 'loading', data: null, error: null });
  const [bump, setBump] = useStateBf(0);
  const [busy, setBusy] = useStateBf(false);
  const tries = useRefBf(0);
  const now = useRefBf(new Date()).current;
  const [collapsed, setCollapsed] = useStateBf(false);

  useEffectBf(() => {
    let cancelled = false;
    let timer = null;
    const load = () => window.NSApi.fetchBriefing()
      .then((data) => {
        if (cancelled) return;
        setState({ status: 'ready', data, error: null });
        try { setCollapsed(localStorage.getItem(BF_COLLAPSE_KEY) === data.pack.windows.cur.to); } catch (e) { /* sem storage */ }
        // A IA ainda escreve: pergunta de novo (até ~2 min).
        if (data.status === 'generating' && tries.current < 40) {
          tries.current += 1;
          timer = setTimeout(load, 3500);
        }
      })
      .catch((err) => { if (!cancelled) setState({ status: 'error', data: null, error: err.message }); });
    tries.current = 0;
    load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [bump]);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      if (next) localStorage.setItem(BF_COLLAPSE_KEY, state.data.pack.windows.cur.to);
      else localStorage.removeItem(BF_COLLAPSE_KEY);
    } catch (e) { /* sem storage */ }
  }

  async function regenerate() {
    setBusy(true);
    try { await window.NSApi.regenerateBriefing(); setBump((n) => n + 1); }
    catch (err) { setState((s) => ({ ...s, error: err.message })); }
    finally { setBusy(false); }
  }

  const greeting = `${bfGreeting(now)}${bfFirstName(user) ? `, ${bfFirstName(user)}` : ''}`;

  if (state.status === 'error' && !state.data) {
    return null; // sem briefing a Visão geral segue normal
  }
  const d = state.data;
  const pack = d && d.pack;
  const ai = d && d.ai;
  const byKey = pack ? Object.fromEntries(pack.metrics.map((m) => [m.key, m])) : {};
  const seriesFor = (key) => (pack ? (key === 'pedidos' ? pack.ordersSeries : key === 'faturamento' ? pack.series : null) : null);
  const isAdmin = user && user.role === 'ADMIN';

  return (
    <section className={`bf panel${collapsed ? ' is-collapsed' : ''}`} aria-label="Resumo da semana pela IA">
      <div className="bf-head">
        <BfMark size={collapsed ? 34 : 52}/>
        <div className="bf-hello">
          <div className="bf-greeting">{greeting}</div>
          <div className="bf-sub">
            <span className="bf-today">{bfToday(now)}</span>
            {pack && <span> · {pack.scope.label} · {bfDm(pack.windows.cur.from)}–{bfDm(pack.windows.cur.to)} vs {bfDm(pack.windows.prev.from)}–{bfDm(pack.windows.prev.to)}</span>}
          </div>
        </div>
        <div className="bf-actions">
          {isAdmin && d && d.status !== 'generating' && !collapsed && (
            <button className="btn btn-ghost" onClick={regenerate} disabled={busy} title="Pedir pra IA escrever de novo">
              <Icon name="refresh" size={12}/> {busy ? 'Pedindo…' : 'Gerar de novo'}
            </button>
          )}
          <button className="btn btn-ghost" onClick={toggle} aria-expanded={!collapsed}>
            <Icon name={collapsed ? 'chevron-down' : 'chevron-right'} size={12}/> {collapsed ? 'Abrir resumo' : 'Recolher'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="bf-body">
          <div className="bf-story">
            <div className="bf-eyebrow"><Icon name="sparkles" size={12}/> Resumo da semana · IA</div>
            {!ai && (
              <div className="bf-thinking" role="status">
                {!(d && d.status === 'error') && <div className="bf-thinking-bar" aria-hidden="true"/>}
                <span>
                  {state.status === 'loading' ? 'Juntando os números da semana…'
                    : d && d.status === 'error' ? 'A IA não conseguiu escrever agora — os números abaixo seguem valendo. Ela tenta de novo em alguns minutos.'
                    : 'A IA está lendo a semana…'}
                </span>
                {/* Motivo pro admin (o resto vê só a frase acima). */}
                {isAdmin && d && d.status === 'error' && d.error && <span className="bf-footnote">Motivo: {d.error}</span>}
              </div>
            )}
            {ai && (
              <>
                <h3 className="bf-headline"><BfTypewriter text={ai.headline}/></h3>
                <p className="bf-summary">{ai.summary}</p>
              </>
            )}
          </div>

          {pack && (
            <div className="bf-tiles">
              {BF_TILES.map((k, i) => byKey[k] && <BfTile key={k} m={byKey[k]} series={seriesFor(k)} index={i}/>)}
            </div>
          )}
          {pack && (
            <div className="bf-chips">
              {BF_CHIPS.map((k) => {
                const m = byKey[k];
                if (!m) return null;
                const tone = m.good == null ? 'flat' : m.good ? 'good' : 'bad';
                return (
                  <span key={k} className="bf-chip" title={`semana anterior: ${m.prevFmt}`}>
                    {m.label} <strong>{m.curFmt}</strong> <span className={`bf-delta is-${tone}`}>{m.deltaFmt}</span>
                  </span>
                );
              })}
              {pack.bestDay && <span className="bf-chip">Melhor dia <strong>{bfDm(pack.bestDay.date)}</strong> · {pack.bestDay.grossFmt}</span>}
            </div>
          )}

          {ai && ai.highlights && ai.highlights.length > 0 && (
            <div className="bf-highlights">
              {ai.highlights.map((h, i) => (
                <div key={i} className={`bf-hl is-${BF_TONE[h.tone] || 'flat'}`} style={{ '--i': i }}>
                  <span className="bf-hl-icon"><Icon name={BF_TONE_ICON[h.tone] || 'info'} size={13}/></span>
                  <div>
                    <div className="bf-hl-title">{h.title}</div>
                    <div className="bf-hl-detail">{h.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {pack && (pack.movers.up.length > 0 || pack.movers.down.length > 0) && (
            <div className="bf-movers">
              {[['up', 'Puxou pra cima', pack.movers.up], ['down', 'Puxou pra baixo', pack.movers.down]].map(([k, label, list]) => list.length > 0 && (
                <div key={k} className="bf-movers-col">
                  <div className="bf-movers-title">{label}</div>
                  {list.map((m) => (
                    <div key={`${m.dimension}:${m.name}`} className="bf-mover">
                      <span className="bf-mover-dim">{m.dimension}</span>
                      <span className="bf-mover-name">{m.name}</span>
                      <span className={`bf-delta is-${k === 'up' ? 'good' : 'bad'}`}>{m.deltaFmt}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {ai && ai.attention && (
            <div className="bf-attention"><Icon name="alert-triangle" size={13}/> <span><strong>Pra vigiar:</strong> {ai.attention}</span></div>
          )}

          {pack && pack.decisions.length > 0 && (
            <div className="bf-decisions">
              <div className="bf-movers-title">Decisões no radar</div>
              {pack.decisions.map((dec) => {
                const line = ai && ai.decisions ? (ai.decisions.find((x) => x.id === dec.id) || {}).line : null;
                return (
                  <div key={dec.id} className="bf-decision">
                    <span className="bf-decision-date">{bfDm(dec.decidedAt.slice(0, 10))}</span>
                    <div>
                      <div className="bf-hl-title">{dec.title}</div>
                      <div className="bf-hl-detail">{line || dec.narrative}</div>
                    </div>
                  </div>
                );
              })}
              <div className="bf-footnote">{d.disclaimer}</div>
            </div>
          )}

          <div className="bf-footnote">
            Texto escrito por IA a partir dos números do dash (vendas aprovadas, dias de Brasília).
            {d && d.generatedAt && ` Gerado às ${new Date(d.generatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`}
          </div>
        </div>
      )}
    </section>
  );
}

Object.assign(window, { BriefingHero });
