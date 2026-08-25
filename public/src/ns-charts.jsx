/* global React, Recharts, fmtCurrency, fmtInt, fmtK, fmtDateShort, fmtDateLong */
/* NSChart — wrapper temático sobre o Recharts (window.Recharts, bundlado em
   /dist/vendor-recharts.js). Aplica o design system NorthScale em TODOS os
   gráficos de série temporal: grid dasheado discreto, gradientes de área,
   tooltip sólido tokenizado (North Editorial), eixos em fonte mono,
   brush de zoom e legenda clicável.

   Substitui o LineChart hand-rolled (charts.jsx), o SupplierDailyChart e o
   SVG inline do Copy Optimizer — um único componente para todas as séries. */

const { useState: useStateN, useMemo: useMemoN } = React;

// Recharts escreve cores como ATRIBUTO SVG — var(--x) não resolve de forma
// confiável ali. nsTok resolve o token computado no momento do render (segue
// o tema); nsAlpha aplica alfa em cima do hex resolvido.
function nsTok(name, fb) { try { var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fb; } catch (e) { return fb; } }
function nsAlpha(hex, a) {
  var h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  var n = parseInt(h, 16);
  if (h.length !== 6 || Number.isNaN(n)) return hex;
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}

// Paleta de séries tokenizada (função, não constante: acompanha troca de tema).
function nsSeriesPalette() {
  return [
    nsTok('--accent', '#3EB7D4'),
    nsTok('--money', '#37D695'),
    nsTok('--hot', '#E0653A'),
    nsTok('--warning', '#ffd166'),
    nsTok('--gold', '#C29B3C'),
  ];
}

// ---------- formatação por tipo de série ----------
function nsFmtValue(format, v, currency) {
  if (format === 'int') return fmtInt(v);
  if (format === 'pct') return (v * 100).toFixed(1) + '%';
  if (format === 'money2') return fmtCurrency(v, currency, 2);
  return fmtCurrency(v, currency, 0); // 'money'
}
function nsFmtAxis(format, v, currency) {
  if (format === 'int') return fmtK(v);
  if (format === 'pct') return (v * 100).toFixed(0) + '%';
  if (format === 'money2') return '$' + v.toFixed(0);
  return '$' + fmtK(v);
}
// Ticks compactos p/ telas estreitas (SÓ eixo Y — tooltip segue no formato cheio):
// 746961 → "747K", 7300000 → "7.3M", 12400000 → "12M". Abaixo de 1000, inteiro puro.
function nsCompact(n) {
  var v = Number(n);
  if (!isFinite(v)) return String(n);
  var sign = v < 0 ? '-' : '';
  var abs = Math.abs(v);
  if (abs >= 1e6) { var m = abs / 1e6; return sign + (m >= 10 ? Math.round(m) : Math.round(m * 10) / 10) + 'M'; }
  if (abs >= 1000) return sign + Math.round(abs / 1000) + 'K';
  return sign + Math.round(abs);
}
// Variante narrow do nsFmtAxis: mesmo prefixo $ dos formatos de dinheiro, pct intacto.
function nsFmtAxisNarrow(format, v, currency) {
  if (format === 'pct') return (v * 100).toFixed(0) + '%';
  if (format === 'int') return nsCompact(v);
  return '$' + nsCompact(v); // 'money' e 'money2'
}
function nsDateStr(d) {
  return typeof d === 'string' ? d : new Date(d).toISOString().slice(0, 10);
}

// ---------- tooltip sólido (superfície --bg-elev, sem blur) ----------
function NSTooltipContent({ active, payload, label, currency, formatFor }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div style={{
      background: 'var(--bg-elev)', border: '1px solid var(--border)',
      borderRadius: 6, padding: '8px 12px', minWidth: 150,
      fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--fg2)', letterSpacing: '0.02em',
      boxShadow: 'var(--shadow-lg)',
    }}>
      <div style={{ fontSize: 10, color: 'var(--fg5)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
        {fmtDateLong(label)}
      </div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color || p.stroke, flexShrink: 0 }}/>
          <span style={{ color: 'var(--fg4)', flex: 1 }}>{p.name}</span>
          <span style={{ color: 'var(--fg1)', fontFamily: 'var(--f-display)', fontSize: 13 }}>
            {nsFmtValue(formatFor(p.dataKey), p.value, currency)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------- NSTimeSeries ----------
// props:
//   data:    [{ date: 'YYYY-MM-DD'|Date, <key>: number, ... }]
//   series:  [{ key, label, color?, kind?: 'area'|'line', stackId?, format? }]
//   height=260, currency='USD', format='money' (default das séries)
//   focusKey: série em destaque — as demais viram linhas finas esmaecidas
//   toggles:  legenda clicável que esconde/mostra séries
//   brush:    true | false | 'auto' (auto: liga quando data.length > 14)
//   refLines: [{ y, label?, color? }] — linhas horizontais de referência (metas)
function NSTimeSeries({
  data, series, height = 260, currency = 'USD', format = 'money',
  focusKey = null, toggles = false, brush = 'auto', refLines = [],
}) {
  const R = window.Recharts;
  const [hidden, setHidden] = useStateN(() => new Set());

  const rows = useMemoN(
    () => (data || []).map((d) => ({ ...d, date: nsDateStr(d.date) })),
    [data],
  );

  if (!R) {
    return <div style={{ padding: 24, color: 'var(--fg5)', fontSize: 12 }}>Biblioteca de gráficos não carregada.</div>;
  }
  if (!rows.length) {
    return <div style={{ padding: 24, color: 'var(--fg5)', fontSize: 12 }}>Sem dados no período.</div>;
  }

  const {
    ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis,
    CartesianGrid, Tooltip, Brush, ReferenceLine,
  } = R;

  const nsPal = nsSeriesPalette();
  const seriesDef = series.map((s, i) => ({
    kind: 'area',
    color: nsPal[i % nsPal.length],
    format,
    ...s,
  }));
  const visible = seriesDef.filter((s) => !hidden.has(s.key));
  const formatFor = (key) => (seriesDef.find((s) => s.key === key)?.format) || format;
  const axisFormat = (visible[0] || seriesDef[0]).format;

  const hasNegative = visible.some((s) => rows.some((d) => (d[s.key] ?? 0) < 0));
  // Touch: o Brush briga com o scroll por gesto — em ponteiro coarse ele é
  // desabilitado incondicionalmente (equivale a brush={false}).
  const coarse = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const showBrush = !coarse && (brush === true || (brush === 'auto' && rows.length > 14));
  // Tela estreita (~mobile): lido no render — rotação/resize re-renderiza via
  // ResponsiveContainer, então não precisa de listener próprio.
  const narrow = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 820px)').matches;
  const tightLegend = narrow && seriesDef.length > 3;

  function toggle(key) {
    if (!toggles) return;
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      // não deixa esconder a última série visível
      else if (visible.length > 1) next.add(key);
      return next;
    });
  }

  return (
    <div>
      {(toggles || seriesDef.length > 1) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: tightLegend ? 8 : 12, padding: '2px 4px 8px' }}>
          {seriesDef.map((s) => {
            const off = hidden.has(s.key);
            const isFocus = focusKey != null && s.key === focusKey;
            const Tag = toggles ? 'button' : 'div';
            return (
              <Tag key={s.key} onClick={toggles ? () => toggle(s.key) : undefined}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: 'none', border: 'none', padding: 0,
                  fontFamily: 'var(--f-mono)', fontSize: tightLegend ? 9 : 10, letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: off ? 'var(--fg6)' : isFocus ? 'var(--fg1)' : 'var(--fg4)',
                  cursor: toggles ? 'pointer' : 'default',
                  textDecoration: off ? 'line-through' : 'none',
                  opacity: off ? 0.55 : 1,
                }}
                title={toggles ? (off ? 'Mostrar série' : 'Esconder série') : undefined}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: s.color, opacity: off ? 0.35 : 1 }}/>
                {s.label}
              </Tag>
            );
          })}
        </div>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={rows} margin={{ top: 8, right: narrow ? 6 : 12, bottom: 0, left: 0 }}>
          <defs>
            {visible.map((s) => (
              <linearGradient key={s.key} id={`nsgrad-${s.key}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.32}/>
                <stop offset="100%" stopColor={s.color} stopOpacity={0}/>
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} stroke={nsAlpha(nsTok('--fg1', '#182226'), 0.1)} strokeDasharray="3 6"/>
          <XAxis dataKey="date" tickFormatter={fmtDateShort} minTickGap={28}
            interval={narrow ? 'preserveStartEnd' : undefined}
            axisLine={false} tickLine={false}
            tick={{ fontSize: 10, fill: 'var(--fg5)', fontFamily: 'var(--f-mono)' }}/>
          <YAxis width={narrow ? 44 : 58}
            tickFormatter={(v) => (narrow ? nsFmtAxisNarrow : nsFmtAxis)(axisFormat, v, currency)}
            axisLine={false} tickLine={false}
            tick={{ fontSize: 10, fill: 'var(--fg5)', fontFamily: 'var(--f-mono)' }}/>
          {hasNegative && <ReferenceLine y={0} stroke={nsAlpha(nsTok('--danger', '#FF6B6B'), 0.45)} strokeDasharray="4 4"/>}
          {refLines.map((rl, i) => (
            <ReferenceLine key={`ref${i}`} y={rl.y}
              stroke={rl.color || 'var(--warning)'} strokeDasharray="4 4" strokeOpacity={0.7}
              label={rl.label ? {
                value: rl.label, position: 'insideTopRight',
                fill: rl.color || 'var(--warning)',
                fontSize: 9, fontFamily: 'var(--f-mono)',
              } : undefined}/>
          ))}
          <Tooltip
            content={<NSTooltipContent currency={currency} formatFor={formatFor}/>}
            cursor={{ stroke: nsAlpha(nsTok('--accent', '#3EB7D4'), 0.35), strokeDasharray: '3 3' }}
          />
          {visible.map((s) => {
            const dimmed = focusKey != null && s.key !== focusKey;
            if (s.kind === 'line' || dimmed) {
              return (
                <Line key={s.key} dataKey={s.key} name={s.label} type="monotone"
                  stroke={s.color} strokeWidth={dimmed ? 1.2 : 2} dot={false}
                  strokeOpacity={dimmed ? 0.4 : 1}
                  activeDot={{ r: 4, fill: s.color, stroke: 'var(--bg)', strokeWidth: 2 }}
                  animationDuration={350} animationEasing="ease-out"/>
              );
            }
            return (
              <Area key={s.key} dataKey={s.key} name={s.label} type="monotone"
                stroke={s.color} strokeWidth={2} fill={`url(#nsgrad-${s.key})`}
                stackId={s.stackId}
                activeDot={{ r: 4, fill: s.color, stroke: 'var(--bg)', strokeWidth: 2 }}
                animationDuration={350} animationEasing="ease-out"/>
            );
          })}
          {showBrush && (
            <Brush dataKey="date" height={24} travellerWidth={8}
              tickFormatter={fmtDateShort}
              stroke={nsTok('--accent', '#3EB7D4')} fill={nsAlpha(nsTok('--fg1', '#182226'), 0.08)}
              traveller={undefined}/>
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------- NSBarRank ----------
// Barras horizontais de ranking (top N por métrica). Mesmo motor/tokens do
// NSTimeSeries. props:
//   items:  [{ label, value, color?, sub? }]   (ordem = ordem de exibição)
//   format: 'money'|'money2'|'int'|'pct', currency, height (auto por linha)
function NSBarRank({ items, format = 'money', currency = 'USD', height }) {
  const R = window.Recharts;
  if (!R) {
    return <div style={{ padding: 24, color: 'var(--fg5)', fontSize: 12 }}>Biblioteca de gráficos não carregada.</div>;
  }
  const rows = (items || []).map((it) => ({ ...it, value: Number(it.value) || 0 }));
  if (!rows.length) {
    return <div style={{ padding: 24, color: 'var(--fg5)', fontSize: 12 }}>Sem dados na janela.</div>;
  }
  const { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, CartesianGrid, LabelList } = R;
  const h = height || Math.max(140, rows.length * 26 + 28);
  const accent = nsTok('--accent', '#3EB7D4');
  const hot = nsTok('--hot', '#E0653A');
  const fg = nsTok('--fg4', '#8a8f98');
  const line = nsTok('--border-soft', '#333');
  const tooltip = ({ active, payload }) => {
    if (!active || !payload || !payload.length) return null;
    const p = payload[0].payload;
    return (
      <div style={{
        background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 10px',
        boxShadow: 'var(--shadow-md)', fontSize: 12, color: 'var(--fg1)',
      }}>
        <div style={{ fontWeight: 600, marginBottom: 2 }}>{p.label}</div>
        <div className="mono">{nsFmtValue(format, p.value, currency)}</div>
        {p.sub && <div style={{ color: 'var(--fg4)', fontSize: 11, marginTop: 2 }}>{p.sub}</div>}
      </div>
    );
  };
  return (
    <div style={{ width: '100%', height: h }}>
      <ResponsiveContainer>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 64, bottom: 4, left: 4 }} barCategoryGap={5}>
          <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke={line}/>
          <XAxis type="number" tick={{ fill: fg, fontSize: 10, fontFamily: 'var(--f-mono)' }}
                 tickFormatter={(v) => nsFmtAxis(format, v, currency)} axisLine={false} tickLine={false}/>
          <YAxis type="category" dataKey="label" width={150} interval={0}
                 tick={{ fill: fg, fontSize: 11 }} axisLine={false} tickLine={false}/>
          <Tooltip cursor={{ fill: nsAlpha(accent, 0.08) }} content={tooltip}/>
          <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {rows.map((r, i) => <Cell key={i} fill={r.color || (r.value < 0 ? hot : accent)}/>)}
            <LabelList dataKey="value" position="right" formatter={(v) => nsFmtValue(format, v, currency)}
                       style={{ fill: fg, fontSize: 10, fontFamily: 'var(--f-mono)' }}/>
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

Object.assign(window, { NSTimeSeries, NSBarRank });
