/* global React */
/* Skeletons + helpers de loading/animação. Espelham a FORMA de cada página
   enquanto os dados carregam (em vez de deixar a tela vazia), e dão
   primitivos de animação (count-up, entrada com stagger, mensagem
   informativa). Carregado logo após utils.jsx — disponível em todas as
   páginas via window. */

const { useState: useStateSk, useEffect: useEffectSk, useRef: useRefSk } = React;

// ---------- primitivos ----------
function Skel({ w, h, r, className = '', style = {} }) {
  const s = { ...style };
  if (w != null) s.width = typeof w === 'number' ? w + 'px' : w;
  if (h != null) s.height = typeof h === 'number' ? h + 'px' : h;
  if (r != null) s.borderRadius = typeof r === 'number' ? r + 'px' : r;
  return <div className={`skel ${className}`} style={s} />;
}
function SkelLine({ w = '100%', size = '', className = '' }) {
  return <div className={`skel skel-line ${size} ${className}`} style={{ width: typeof w === 'number' ? w + 'px' : w }} />;
}
function SkelCircle({ d = 36 }) {
  return <div className="skel skel-circle" style={{ width: d, height: d, flexShrink: 0 }} />;
}

// Barra de progresso indeterminada — fina, no topo de um painel/seção.
function SkelBar() { return <div className="skel-bar" />; }

// ---------- mensagem informativa de loading ----------
// Cicla mensagens curtas pra reduzir a sensação de espera ("Buscando vendas…",
// "Agregando métricas…", "Quase lá…"). Pulsa via CSS.
function LoadingMsg({ steps, interval = 1500 }) {
  const msgs = steps && steps.length ? steps : ['Carregando…'];
  const [i, setI] = useStateSk(0);
  useEffectSk(() => {
    if (msgs.length < 2) return;
    const id = setInterval(() => setI((n) => (n + 1) % msgs.length), interval);
    return () => clearInterval(id);
  }, [msgs.length, interval]);
  return (
    <span className="loading-msg"><span className="dot" />{msgs[Math.min(i, msgs.length - 1)]}</span>
  );
}

// ---------- count-up animado de números ----------
// Anima do valor anterior até o novo com easing. `format` recebe o número e
// devolve a string final (ex: fmtCurrency). Respeita prefers-reduced-motion.
const _prefersReduced = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;

function useCountUp(value, duration = 700) {
  const [display, setDisplay] = useStateSk(value);
  const fromRef = useRefSk(value);
  const rafRef = useRefSk(null);
  useEffectSk(() => {
    const target = Number(value) || 0;
    const from = Number(fromRef.current) || 0;
    if (_prefersReduced || from === target || duration <= 0) {
      fromRef.current = target;
      setDisplay(target);
      return;
    }
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / duration);
      // easeOutCubic
      const e = 1 - Math.pow(1 - p, 3);
      const v = from + (target - from) * e;
      setDisplay(v);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else { fromRef.current = target; setDisplay(target); }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); fromRef.current = target; };
  }, [value, duration]);
  return display;
}

// Componente conveniente: <CountUp value={1234.5} format={(n)=>fmtCurrency(n)} />
function CountUp({ value, format, duration = 700 }) {
  const n = useCountUp(value, duration);
  const fmt = format || ((x) => String(Math.round(x)));
  return <>{fmt(n)}</>;
}

// ---------- composições por seção ----------
// Grade de KPI cards fantasma (mesma silhueta do .kpi real).
function SkelKpiGrid({ n = 8, gridClass = 'kpi-grid' }) {
  return (
    <div className={gridClass}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="skel-kpi anim-in" style={{ '--i': i }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <SkelLine w={70} size="sm" />
            <Skel w={16} h={16} r={4} />
          </div>
          <SkelLine w={110} size="xl" />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
            <SkelLine w={54} size="sm" />
            <Skel w={80} h={20} r={4} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Painel com cabeçalho + área de chart.
function SkelChartPanel({ height = 260, title = true, i = 0 }) {
  return (
    <div className="skel-panel anim-in-soft" style={{ '--i': i }}>
      {title && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <SkelLine w={120} size="sm" /><SkelLine w={180} size="lg" />
          </div>
          <Skel w={180} h={28} r={8} />
        </div>
      )}
      <Skel w="100%" h={height} r={8} />
    </div>
  );
}

// Painel com tabela: cabeçalho + N linhas × M colunas.
function SkelTablePanel({ rows = 6, cols = 5, title = true, i = 0 }) {
  return (
    <div className="skel-panel anim-in-soft" style={{ '--i': i }}>
      {title && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          <SkelLine w={140} size="sm" /><SkelLine w={220} className="skel-w-60" />
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} style={{ display: 'grid', gridTemplateColumns: `1.6fr repeat(${Math.max(1, cols - 1)}, 1fr)`, gap: 12, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <SkelCircle d={22} /><SkelLine w="70%" />
            </div>
            {Array.from({ length: cols - 1 }).map((_, c) => (
              <SkelLine key={c} w={`${50 + ((r + c) % 4) * 12}%`} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// Donut + legenda fantasma.
function SkelDonut() {
  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'center', padding: '8px 4px' }}>
      <div style={{ position: 'relative', width: 150, height: 150, flexShrink: 0 }}>
        <Skel w={150} h={150} r="50%" />
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Skel w={10} h={10} r={3} /><SkelLine w={`${40 + i * 12}%`} />
          </div>
        ))}
      </div>
    </div>
  );
}

// Bloco genérico: barra indeterminada + mensagem — pra painéis menores.
function SkelInline({ steps, height = 120 }) {
  return (
    <div className="skel-panel" style={{ display: 'flex', flexDirection: 'column', gap: 14, minHeight: height, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ width: '60%' }}><SkelBar /></div>
      <LoadingMsg steps={steps} />
    </div>
  );
}

// Cabeçalho de página fantasma (eyebrow + h2 + sub).
function SkelPageHead() {
  return (
    <div className="page-head">
      <div className="lead" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <SkelLine w={130} size="sm" />
        <SkelLine w={300} style={{ height: 30, borderRadius: 8 }} />
        <SkelLine w={360} className="skel-w-90" size="sm" />
      </div>
    </div>
  );
}

// Grade de mini-KPIs fantasma (.mini-kpis → .mini-kpi: label/value/sub).
function SkelMiniKpis({ n = 4 }) {
  return (
    <div className="mini-kpis">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="skel-panel anim-in" style={{ '--i': i, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 9 }}>
          <SkelLine w="55%" size="sm" />
          <SkelLine w="75%" size="xl" />
          <SkelLine w="45%" size="sm" />
        </div>
      ))}
    </div>
  );
}

// Linhas de skeleton DENTRO de uma <tbody> (loading em tabela). Retorna um
// fragmento de <tr>s — usar no lugar do <tr><td>Carregando…</td></tr>.
function SkelTableRows({ rows = 8, cols = 6 }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="skel-tr">
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c}>
              {c === 0
                ? <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><SkelCircle d={20} /><SkelLine w="60%" /></div>
                : <SkelLine w={`${45 + ((r + c) % 4) * 12}%`} />}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// Grade de cards de família/produto (ProductsPage nível 1).
function SkelCardGrid({ n = 6 }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="skel-panel anim-in" style={{ '--i': i, display: 'flex', flexDirection: 'column', gap: 14, minHeight: 168 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Skel w={10} h={10} r="50%" /><SkelLine w={120} /></div>
            <Skel w={50} h={18} r={4} />
          </div>
          <SkelLine w="60%" size="xl" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
            {[0, 1, 2].map((k) => (
              <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><SkelLine w="80%" size="sm" /><SkelLine w="60%" /></div>
            ))}
          </div>
          <SkelLine w="40%" size="sm" style={{ marginTop: 'auto' }} />
        </div>
      ))}
    </div>
  );
}

// ---------- páginas inteiras ----------
// Overview: page-head + 8 KPIs + série temporal + 2×(donut|barras) + tabela.
function SkelOverview() {
  return (
    <div className="page-in">
      <SkelPageHead />
      <SkelKpiGrid n={8} />
      <div style={{ marginTop: 14 }}><SkelChartPanel height={260} i={8} /></div>
      <div className="grid-2" style={{ marginTop: 14 }}>
        <div className="skel-panel anim-in-soft" style={{ '--i': 9 }}><SkelLine w={160} size="sm" style={{ marginBottom: 14 }} /><SkelDonut /></div>
        <div className="skel-panel anim-in-soft" style={{ '--i': 10 }}>
          <SkelLine w={150} size="sm" style={{ marginBottom: 14 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Skel w={22} h={16} r={3} /><SkelLine w={`${70 - i * 8}%`} style={{ flex: 1 }} /><SkelLine w={60} size="sm" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ marginTop: 14 }}><SkelTablePanel rows={5} cols={6} i={11} /></div>
    </div>
  );
}

// Custos: page-head + 8 KPIs + chart stacked + 2 tabelas + allowance.
function SkelCustos() {
  return (
    <div className="page-in">
      <SkelPageHead />
      <SkelKpiGrid n={8} />
      <div style={{ marginTop: 14 }}><SkelChartPanel height={280} i={8} /></div>
      <div className="grid-2" style={{ marginTop: 14 }}>
        <SkelTablePanel rows={4} cols={5} i={9} />
        <SkelTablePanel rows={5} cols={4} i={10} />
      </div>
    </div>
  );
}

// Página genérica de tabela: page-head + (mini-kpis) + (chart) + tabela(s).
// Cobre Funnel/Leaderboard/AllAffiliates/Transactions/Recovery/Users/Networks
// variando os params. cols é capado visualmente (tabelas muito largas viram
// colunas finas demais).
function SkelTablePage({ miniKpis = 0, chart = false, chartHeight = 260, cols = 6, rows = 9, dualTable = false }) {
  const c = Math.min(cols, 7);
  return (
    <div className="page-in">
      <SkelPageHead />
      {miniKpis > 0 && <SkelMiniKpis n={miniKpis} />}
      {chart && <div style={{ marginTop: 14 }}><SkelChartPanel height={chartHeight} i={0} /></div>}
      {dualTable ? (
        <div className="grid-2" style={{ marginTop: 14 }}>
          <SkelTablePanel rows={rows} cols={c} i={1} />
          <SkelTablePanel rows={rows} cols={Math.max(2, c - 2)} i={2} />
        </div>
      ) : (
        <div style={{ marginTop: 14 }}><SkelTablePanel rows={rows} cols={c} i={1} /></div>
      )}
    </div>
  );
}

// Página de grade de cards (ProductsPage nível 1).
function SkelCardGridPage({ n = 6 }) {
  return (
    <div className="page-in">
      <SkelPageHead />
      <div style={{ marginTop: 14 }}><SkelCardGrid n={n} /></div>
    </div>
  );
}

// Carregamento de drawer/painel lateral — mensagem informativa centralizada.
function SkelDrawerLoading({ steps }) {
  return (
    <div style={{ padding: 40, display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', justifyContent: 'center', minHeight: 240 }}>
      <div style={{ width: '70%' }}><SkelBar /></div>
      <LoadingMsg steps={steps} />
    </div>
  );
}

Object.assign(window, {
  Skel, SkelLine, SkelCircle, SkelBar, LoadingMsg, CountUp, useCountUp,
  SkelKpiGrid, SkelChartPanel, SkelTablePanel, SkelDonut, SkelInline,
  SkelPageHead, SkelMiniKpis, SkelTableRows, SkelCardGrid,
  SkelOverview, SkelCustos, SkelTablePage, SkelCardGridPage, SkelDrawerLoading,
});
