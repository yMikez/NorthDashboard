/* global React */
/* Shared utils, icons, and common components. */

const { useState, useEffect, useMemo, useRef, useCallback } = React;

// ---------- utils ----------
const ROOT = window; // mock lives on window.MOCK

function fmtCurrency(n, currency = 'USD', digits = 0) {
  const opts = { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits };
  try { return new Intl.NumberFormat('en-US', opts).format(n); } catch (e) { return '$' + n.toFixed(digits); }
}
function fmtK(n) {
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2).replace(/\.00$/, '') + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(n));
}
function fmtInt(n) { return new Intl.NumberFormat('en-US').format(Math.round(n)); }
function fmtPct(n, digits = 1) { return (n * 100).toFixed(digits) + '%'; }
function fmtDateShort(d) {
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
}
function fmtDateLong(d) {
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}
function fmtDateTime(d) {
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}
function initials(name) {
  return name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}
function avatarColor(id) {
  // deterministic hue from id
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const palettes = [
    ['#5BC8FF','#1E3A8A'],
    ['#8B7FFF','#1E3A8A'],
    ['#4A90FF','#152A66'],
    ['#5BC8FF','#8B7FFF'],
    ['#4A90FF','#0F1F4D'],
  ];
  const p = palettes[h % palettes.length];
  return `linear-gradient(135deg, ${p[0]}, ${p[1]})`;
}

// ---------- date range utils ----------
function rangeForPreset(preset, today = new Date()) {
  const end = new Date(today);
  end.setUTCHours(23,59,59,999);
  let start = new Date(today);
  start.setUTCHours(0,0,0,0);
  switch (preset) {
    case 'today': break;
    case 'yesterday': {
      start.setUTCDate(start.getUTCDate() - 1);
      const e = new Date(start); e.setUTCHours(23,59,59,999);
      return { start, end: e, preset };
    }
    case '7d':  start.setUTCDate(start.getUTCDate() - 6); break;
    case '30d': start.setUTCDate(start.getUTCDate() - 29); break;
    case 'mtd': start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)); break;
    case 'qtd': start = new Date(Date.UTC(today.getUTCFullYear(), Math.floor(today.getUTCMonth()/3)*3, 1)); break;
    case 'ytd': start = new Date(Date.UTC(today.getUTCFullYear(), 0, 1)); break;
    case '90d': start.setUTCDate(start.getUTCDate() - 89); break;
    default:    start.setUTCDate(start.getUTCDate() - 29);
  }
  return { start, end, preset };
}
function previousRange(range) {
  const ms = range.end.getTime() - range.start.getTime();
  const end = new Date(range.start.getTime() - 1);
  const start = new Date(end.getTime() - ms);
  return { start, end };
}
function dayIndexFromDate(d) {
  const start = window.MOCK.startDate;
  return Math.floor((d.getTime() - start.getTime()) / (24 * 3600 * 1000));
}

// ---------- filter application ----------
function applyFilters(orders, filters) {
  const { dateRange, platforms, products, countries, trafficSources, minStatus } = filters;
  return orders.filter(o => {
    const t = new Date(o.createdAt).getTime();
    if (t < dateRange.start.getTime() || t > dateRange.end.getTime()) return false;
    if (platforms && platforms.size > 0 && !platforms.has(o.platform)) return false;
    if (products && products.size > 0 && !products.has(o.productId)) return false;
    if (countries && countries.size > 0 && !countries.has(o.country)) return false;
    if (trafficSources && trafficSources.size > 0 && !trafficSources.has(o.trafficSource)) return false;
    return true;
  });
}

// ---------- aggregations ----------
function aggregateKPIs(orders) {
  let gross = 0, net = 0, fees = 0, cpa = 0, approvedCount = 0, totalCount = 0, refunds = 0, chargebacks = 0, approvedGross = 0;
  const groupSeen = new Set();
  for (const o of orders) {
    gross += o.grossAmount;
    fees += o.fees;
    cpa += o.cpaPaid;
    if (o.status === 'approved') { approvedCount++; approvedGross += o.grossAmount; net += o.netAmount; }
    if (o.status === 'refunded') refunds++;
    if (o.status === 'chargeback') chargebacks++;
    totalCount++;
    groupSeen.add(o.orderGroup);
  }
  const cogs = approvedGross * 0.12; // 12% COGS
  const netProfit = net - cpa - cogs - fees * 0.1;
  const approvalRate = totalCount ? approvedCount / totalCount : 0;
  const refundRate = totalCount ? refunds / totalCount : 0;
  const cbRate = totalCount ? chargebacks / totalCount : 0;
  const aov = approvedCount ? approvedGross / approvedCount : 0;
  return { gross, net, fees, cpa, cogs, netProfit, approvalRate, refundRate, cbRate, aov, approvedCount, totalCount, orderGroups: groupSeen.size };
}

// group orders by day for a range
function bucketByDay(orders, range) {
  const dayMs = 24 * 3600 * 1000;
  const days = Math.ceil((range.end - range.start) / dayMs) + 1;
  const buckets = [];
  for (let i = 0; i < days; i++) {
    buckets.push({
      date: new Date(range.start.getTime() + i * dayMs),
      gross: 0, net: 0, orders: 0, approvedOrders: 0, allOrders: 0, cpa: 0
    });
  }
  for (const o of orders) {
    const t = new Date(o.createdAt).getTime();
    const idx = Math.floor((t - range.start.getTime()) / dayMs);
    if (idx < 0 || idx >= buckets.length) continue;
    const b = buckets[idx];
    b.gross += o.grossAmount;
    b.net += o.netAmount;
    b.cpa += o.cpaPaid;
    b.allOrders++;
    if (o.status === 'approved') { b.approvedOrders++; b.orders++; }
  }
  return buckets;
}

// ---------- icons (lucide paths) ----------
function Icon({ name, size = 16, stroke = 1.5, className = '' }) {
  const paths = {
    'layout-dashboard': ['M3 3h7v9H3z','M14 3h7v5h-7z','M14 12h7v9h-7z','M3 16h7v5H3z'],
    'bar-chart-3': ['M3 3v18h18','M7 16v-5','M12 16V8','M17 16v-8'],
    'filter': ['M22 3H2l8 9.46V19l4 2v-8.54z'],
    'users': ['M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2','M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8','M23 21v-2a4 4 0 0 0-3-3.87','M16 3.13a4 4 0 0 1 0 7.75'],
    'trophy': ['M6 9H4.5a2.5 2.5 0 0 1 0-5H6','M18 9h1.5a2.5 2.5 0 0 0 0-5H18','M4 22h16','M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22','M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22','M18 2H6v7a6 6 0 0 0 12 0V2Z'],
    'package': ['m7.5 4.27 9 5.15','M21 8 12 13 3 8','M21 8v8a2 2 0 0 1-1 1.73l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8','m3.3 7 8.7 5 8.7-5','M12 22V12'],
    'receipt': ['M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1Z','M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8','M12 17.5v-11'],
    'settings': ['M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z','M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'],
    'plug': ['M12 22v-5','M9 7V2','M15 7V2','M6 13V8h12v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4Z'],
    'dollar': ['M12 1v22','M17 5H9.5a3.5 3.5 0 1 0 0 7h5a3.5 3.5 0 1 1 0 7H6'],
    'trending-up': ['M23 6l-9.5 9.5-5-5L1 18','M17 6h6v6'],
    'trending-down': ['M23 18l-9.5-9.5-5 5L1 6','M17 18h6v-6'],
    'shopping-cart': ['M9 22a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z','M20 22a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z','M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6H19a2 2 0 0 0 2-1.6L23 6H6'],
    'percent': ['m19 5-14 14','M6.5 8.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z','M17.5 18.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z'],
    'alert-triangle': ['M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z','M12 9v4','M12 17h.01'],
    'wallet': ['M20 12V8H6a2 2 0 0 1 0-4h12v4','M4 6v12a2 2 0 0 0 2 2h14v-4','M18 12a2 2 0 0 0 0 4h4v-4Z'],
    'bell': ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9','M10.3 21a1.94 1.94 0 0 0 3.4 0'],
    'chevron-down': ['m6 9 6 6 6-6'],
    'chevron-right': ['m9 18 6-6-6-6'],
    'x': ['M18 6 6 18','m6 6 12 12'],
    'search': ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z','m21 21-4.3-4.3'],
    'calendar': ['M3 4h18v18H3z','M16 2v4','M8 2v4','M3 10h18'],
    'download': ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4','M7 10l5 5 5-5','M12 15V3'],
    'arrow-up-right': ['M7 17 17 7','M7 7h10v10'],
    'arrow-down-right': ['M7 7l10 10','M17 7v10H7'],
    'check': ['M20 6 9 17l-5-5'],
    'plus': ['M12 5v14','M5 12h14'],
    'flame': ['M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14 .27-4 2-5 .39 3.5 2 5.5 3 7 .34.52.5 1.38.5 2a5 5 0 1 1-10 0c0-.47.16-.93.5-1.5Z'],
    'globe': ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z','M2 12h20','M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z'],
    'zap': ['M13 2 3 14h9l-1 8 10-12h-9l1-8Z'],
    'logo-mono': ['M12 2L3 7l9 5 9-5-9-5Z','M3 17l9 5 9-5','M3 12l9 5 9-5'],
    'pill': ['M10.5 20.5a5.66 5.66 0 0 1-8-8l9-9a5.66 5.66 0 0 1 8 8Z','m3.5 15.5 4-4 5 5'],
    'moon': ['M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z'],
    'leaf': ['M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19.5 2c.5 1.5 1 3 1 4.5C20.5 13.12 17.12 20 11 20Z','M2 22c2-2 5-3 8-4'],
    'target': ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z','M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z','M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z'],
    'clock': ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z','M12 6v6l4 2'],
    'credit-card': ['M2 5h20v14H2z','M2 10h20'],
    'link': ['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71','M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'],
    'refresh': ['M23 4v6h-6','M1 20v-6h6','M3.5 9a9 9 0 0 1 15-3.4L23 10','M20.5 15a9 9 0 0 1-15 3.4L1 14'],
    'user': ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2','M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8'],
    'map': ['M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4Z','M8 2v16','M16 6v16'],
    'info': ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z','M12 16v-4','M12 8h.01'],
    'sort': ['m7 15 5 5 5-5','m7 9 5-5 5 5'],
  };
  const ps = paths[name] || paths['info'];
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
      className={className}
    >
      {ps.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

// ---------- sparkline ----------
function Sparkline({ data, width = 80, height = 26, color = '#5BC8FF', fill = true }) {
  if (!data || data.length < 2) return <svg width={width} height={height}/>;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * (width - 2) + 1;
    const y = height - 2 - ((v - min) / span) * (height - 4);
    return [x, y];
  });
  const path = 'M' + pts.map(p => p.join(' ')).join(' L ');
  const area = path + ` L ${width - 1} ${height} L 1 ${height} Z`;
  const gid = 'spg' + Math.random().toString(36).slice(2, 7);
  return (
    <svg width={width} height={height} className="spark">
      {fill && (
        <>
          <defs>
            <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.35"/>
              <stop offset="100%" stopColor={color} stopOpacity="0"/>
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gid})`}/>
        </>
      )}
      <path d={path} fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ---------- FX layers ----------
function FXLayers() {
  return (
    <>
      <div className="ns-bg"/>
      <div className="ns-scan"/>
    </>
  );
}

// export to window
Object.assign(window, {
  fmtCurrency, fmtK, fmtInt, fmtPct, fmtDateShort, fmtDateLong, fmtDateTime,
  initials, avatarColor, rangeForPreset, previousRange, dayIndexFromDate,
  applyFilters, aggregateKPIs, bucketByDay,
  Icon, Sparkline, FXLayers,
});
