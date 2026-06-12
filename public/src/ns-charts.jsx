/* global React, Recharts, fmtCurrency, fmtInt, fmtK, fmtDateShort, fmtDateLong */
/* NSChart — wrapper temático sobre o Recharts (window.Recharts, bundlado em
   /dist/vendor-recharts.js). Aplica o design system NorthScale em TODOS os
   gráficos de série temporal: grid dasheado ciano, gradientes de área,
   tooltip glassy (mesmo estilo do antigo LineChart), eixos em fonte mono,
   brush de zoom e legenda clicável.

   Substitui o LineChart hand-rolled (charts.jsx), o SupplierDailyChart e o
   SVG inline do Copy Optimizer — um único componente para todas as séries. */

const { useState: useStateN, useMemo: useMemoN } = React;

const NS_SERIES_PALETTE = ['#5BC8FF', '#4A90FF', '#8B7FFF', '#28C878', '#FFB14E', '#FF6B6B', '#a8b7d8'];

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
function nsDateStr(d) {
  return typeof d === 'string' ? d : new Date(d).toISOString().slice(0, 10);
}

// ---------- tooltip glassy (porta o estilo do LineChart antigo) ----------
function NSTooltipContent({ active, payload, label, currency, formatFor }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div style={{
      background: 'var(--bg-elev)', border: '1px solid var(--border)',
      backdropFilter: 'blur(20px) saturate(180%)', WebkitBackdropFilter: 'blur(20px) saturate(180%)',
      borderRadius: 6, padding: '8px 12px', minWidth: 150,
      fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--fg2)', letterSpacing: '0.02em',
      boxShadow: '0 10px 30px -10px rgba(91,200,255,0.35)',
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

  const seriesDef = series.map((s, i) => ({
    kind: 'area',
    color: NS_SERIES_PALETTE[i % NS_SERIES_PALETTE.length],
    format,
    ...s,
  }));
  const visible = seriesDef.filter((s) => !hidden.has(s.key));
  const formatFor = (key) => (seriesDef.find((s) => s.key === key)?.format) || format;
  const axisFormat = (visible[0] || seriesDef[0]).format;

  const hasNegative = visible.some((s) => rows.some((d) => (d[s.key] ?? 0) < 0));
  const showBrush = brush === true || (brush === 'auto' && rows.length > 14);

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
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: '2px 4px 8px' }}>
          {seriesDef.map((s) => {
            const off = hidden.has(s.key);
            const isFocus = focusKey != null && s.key === focusKey;
            const Tag = toggles ? 'button' : 'div';
            return (
              <Tag key={s.key} onClick={toggles ? () => toggle(s.key) : undefined}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: 'none', border: 'none', padding: 0,
                  fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.08em',
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
        <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <defs>
            {visible.map((s) => (
              <linearGradient key={s.key} id={`nsgrad-${s.key}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.32}/>
                <stop offset="100%" stopColor={s.color} stopOpacity={0}/>
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} stroke="rgba(91,200,255,0.07)" strokeDasharray="3 6"/>
          <XAxis dataKey="date" tickFormatter={fmtDateShort} minTickGap={28}
            axisLine={false} tickLine={false}
            tick={{ fontSize: 10, fill: 'var(--fg5)', fontFamily: 'var(--f-mono)' }}/>
          <YAxis tickFormatter={(v) => nsFmtAxis(axisFormat, v, currency)} width={58}
            axisLine={false} tickLine={false}
            tick={{ fontSize: 10, fill: 'var(--fg5)', fontFamily: 'var(--f-mono)' }}/>
          {hasNegative && <ReferenceLine y={0} stroke="rgba(255,107,107,0.45)" strokeDasharray="4 4"/>}
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
            cursor={{ stroke: 'rgba(91,200,255,0.35)', strokeDasharray: '3 3' }}
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
              stroke="rgba(91,200,255,0.45)" fill="rgba(10,16,40,0.45)"
              traveller={undefined}/>
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

Object.assign(window, { NSTimeSeries });
