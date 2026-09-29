/* global React */
/* Shared utils, icons, and common components. */

const { useState, useEffect, useMemo, useRef, useCallback } = React;

// ---------- utils ----------
const ROOT = window; // mock lives on window.MOCK

// Formatters Intl são caros de instanciar (~0.1-1ms cada). Numa tabela de
// 500 linhas × 12 colunas isso vira ~6k instâncias POR RENDER — gargalo real
// de scroll/filtro. Cache por chave de opções: instancia 1x, reusa sempre.
const _fmtCache = new Map();
function _numFmt(key, opts) {
  let f = _fmtCache.get(key);
  if (!f) { f = new Intl.NumberFormat('en-US', opts); _fmtCache.set(key, f); }
  return f;
}
function _dateFmt(key, opts) {
  let f = _fmtCache.get(key);
  if (!f) { f = new Intl.DateTimeFormat('en-US', opts); _fmtCache.set(key, f); }
  return f;
}

function fmtCurrency(n, currency = 'USD', digits = 0) {
  try {
    return _numFmt(`c:${currency}:${digits}`, {
      style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits,
    }).format(n);
  } catch (e) { return '$' + n.toFixed(digits); }
}
function fmtK(n) {
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2).replace(/\.00$/, '') + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(n));
}
function fmtInt(n) { return _numFmt('int', {}).format(Math.round(n)); }
function fmtPct(n, digits = 1) { return (n * 100).toFixed(digits) + '%'; }
// Bucket dates from the API are date-only strings like '2026-04-29' that
// represent BRT calendar days. JS parses them as UTC midnight, so formatting
// in the browser's local TZ (BRT, UTC-3) shifts the displayed date back one
// day ("Apr 29" UTC midnight = "Apr 28" 21:00 BRT). Force UTC formatting so
// the label matches the bucket's date semantics regardless of viewer TZ.
function fmtDateShort(d) {
  const dt = typeof d === 'string' ? new Date(d) : d;
  return _dateFmt('ds', { month: 'short', day: '2-digit', timeZone: 'UTC' }).format(dt);
}
function fmtDateLong(d) {
  const dt = typeof d === 'string' ? new Date(d) : d;
  return _dateFmt('dl', { month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(dt);
}
// fmtDateTime opera em timestamps reais (orderedAt etc) — o user QUER ver
// no fuso local (BRT) pra saber a hora real do pedido. Mantém local.
function fmtDateTime(d) {
  const dt = typeof d === 'string' ? new Date(d) : d;
  return _dateFmt('dt', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(dt);
}
function initials(name) {
  return name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

// Visual badge por plataforma — usado em tabelas (transações, afiliados,
// produtos, drawers). Mantém short labels + CSS classes centralizados pra
// quando uma nova plataforma chegar bastar editar aqui.
const PLATFORM_BADGE = {
  clickbank:    { short: 'CB',  cls: 'plat-cb',  upper: 'CLICKBANK' },
  digistore24:  { short: 'D24', cls: 'plat-d24', upper: 'DIGISTORE24' },
  buygoods:     { short: 'BG',  cls: 'plat-bg',  upper: 'BUYGOODS' },
  cartpanda:    { short: 'CP',  cls: 'plat-cp',  upper: 'CARTPANDA' },
  jvzoo:        { short: 'JVZ', cls: 'plat-jvz', upper: 'JVZOO' },
};
function platBadge(slug) {
  return PLATFORM_BADGE[slug] || { short: (slug || '??').slice(0,3).toUpperCase(), cls: 'plat-cb', upper: (slug || '').toUpperCase() };
}
function avatarColor(id) {
  // Cor sólida editorial determinística a partir do id (sem gradiente).
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  // DS1: tokens escuros nos DOIS temas (iniciais brancas ≥ 4,5:1) — os
  // --chart-* clareiam no escuro e reprovariam com texto branco.
  const palette = ['var(--ns-blue)', 'var(--navy-600)', 'var(--ns-blue-dark)', 'var(--navy-500)', 'var(--navy-700)'];
  return palette[h % palette.length];
}

// ---------- date range utils ----------
// Toda lógica de range é em dia BRT (America/Sao_Paulo, UTC-3 sem DST).
// "Hoje" = dia do calendário BRT no momento de agora; o range termina às
// 23:59:59 BRT = 02:59:59 UTC do dia seguinte.
function rangeForPreset(preset, now = new Date()) {
  // Pega componentes do dia BRT atual via Intl (handle correto de TZ).
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const [Y, M, D] = fmt.format(now).split('-').map(Number);

  // BRT day X em UTC: [X 03:00:00, X+1 03:00:00). Ou: end = X+1 02:59:59.999.
  const brtDayStart = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 3, 0, 0, 0));
  const brtDayEnd   = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 26, 59, 59, 999));

  let start = brtDayStart(Y, M, D);
  let end = brtDayEnd(Y, M, D);
  switch (preset) {
    case 'today': break;
    case 'yesterday':
      start = brtDayStart(Y, M, D - 1);
      end   = brtDayEnd(Y, M, D - 1);
      break;
    case '7d':  start = brtDayStart(Y, M, D - 6);  break;
    case '30d': start = brtDayStart(Y, M, D - 29); break;
    case '90d': start = brtDayStart(Y, M, D - 89); break;
    case 'mtd': start = brtDayStart(Y, M, 1);      break;
    case 'qtd': start = brtDayStart(Y, Math.floor((M - 1) / 3) * 3 + 1, 1); break;
    case 'ytd': start = brtDayStart(Y, 1, 1);      break;
    default:    start = brtDayStart(Y, M, D - 29);
  }
  return { start, end, preset };
}
// YYYY-MM-DD in UTC. Used to encode custom date ranges into URL params and
// to populate <input type="date"> defaults (which expect this exact format).
function isoDateOnly(d) {
  return d.toISOString().slice(0, 10);
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
// Biblioteca vetorial NorthScale (DS1: grade 24, traço 1,6, terminais
// arredondados). Conteúdo interno de cada SVG oficial, sem cor fixa — herda
// currentColor. Fonte: Drive "North Scale/Visual/Iconografia"; os arquivos
// completos ficam em public/assets/icons/.
const NS_ICON_MARKUP = {
  'afiliados': "<circle cx=\"9\" cy=\"8.5\" r=\"3.5\"/><path d=\"M3.5 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5\"/><circle cx=\"17\" cy=\"9.5\" r=\"2.6\"/><path d=\"M16.5 14.6c2.4.2 4 1.9 4 4.4\"/>",
  'alerta': "<path d=\"M12 4 2.8 19.5h18.4z\"/><path d=\"M12 10v4.2M12 16.8v.2\"/>",
  'busca': "<circle cx=\"11\" cy=\"11\" r=\"6.5\"/><path d=\"m20 20-4.4-4.4\"/>",
  'calendario': "<rect x=\"3.5\" y=\"5\" width=\"17\" height=\"15.5\" rx=\"2.5\"/><path d=\"M3.5 9.5h17M8 3v4M16 3v4\"/>",
  'chat': "<path d=\"M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H9l-5 4z\"/><path d=\"M8 9.5h8M8 12.8h5\"/>",
  'check': "<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"m8.3 12.3 2.5 2.5 5-5.3\"/>",
  'config': "<circle cx=\"12\" cy=\"12\" r=\"3.2\"/><path d=\"M19 12a7 7 0 0 0-.14-1.4l2-1.55-2-3.46-2.35.95A7 7 0 0 0 14 4.9L13.65 2.4h-4L9.3 4.9a7 7 0 0 0-2.5 1.44l-2.36-.95-2 3.46 2 1.55a7.1 7.1 0 0 0 0 2.8l-2 1.55 2 3.46 2.35-.95a7 7 0 0 0 2.51 1.44l.35 2.5h4l.35-2.5a7 7 0 0 0 2.5-1.44l2.36.95 2-3.46-2-1.55A7 7 0 0 0 19 12z\"/>",
  'crescimento': "<path d=\"M3.5 20.5 9 12l4 4 7.5-10\"/><path d=\"M20.5 6v4.5M20.5 6H16\"/>",
  'custos': "<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"M12 7.5v9M14.6 9.2c-.5-.9-1.5-1.4-2.6-1.4-1.6 0-2.8.9-2.8 2.2 0 2.9 5.6 1.5 5.6 4.3 0 1.3-1.2 2.2-2.8 2.2-1.1 0-2.1-.5-2.6-1.4\"/>",
  'email': "<rect x=\"3.5\" y=\"5.5\" width=\"17\" height=\"13\" rx=\"2.5\"/><path d=\"m4.5 7.5 7.5 5.5 7.5-5.5\"/>",
  'exportar': "<path d=\"M12 15V4M8 7.5 12 3.5l4 4\"/><path d=\"M4.5 14v4A2.5 2.5 0 0 0 7 20.5h10a2.5 2.5 0 0 0 2.5-2.5v-4\"/>",
  'fechar': "<path d=\"m6 6 12 12M18 6 6 18\"/>",
  'filtro': "<path d=\"M4.5 6.5h15M7.5 12h9M10.5 17.5h3\"/>",
  'funil': "<path d=\"M4 5h16l-6.2 7v6.2L10.2 20v-8z\"/>",
  'grafico-barra': "<path d=\"M3.5 3.5v17h17\"/><path d=\"M8 17v-5M12.5 17V8M17 17v-7\"/>",
  'grafico-linha': "<path d=\"M3.5 3.5v17h17\"/><path d=\"m6.5 15 4-5 3.5 3 5.5-7\"/>",
  'info': "<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"M12 11v5M12 8v.2\"/>",
  'insights': "<path d=\"M12 3.5l1.8 4.6 4.7 1.9-4.7 1.9L12 16.5l-1.8-4.6-4.7-1.9 4.7-1.9z\"/><path d=\"M18.5 15.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z\"/>",
  'mais': "<path d=\"M12 5v14M5 12h14\"/>",
  'networks': "<circle cx=\"5.5\" cy=\"12\" r=\"2.5\"/><circle cx=\"18.5\" cy=\"5.5\" r=\"2.5\"/><circle cx=\"18.5\" cy=\"18.5\" r=\"2.5\"/><path d=\"M7.8 10.8l8.4-4.2M7.8 13.2l8.4 4.2\"/>",
  'norte': "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 3v2.5\"/><path d=\"M9.2 15.5 12 7.5l2.8 8-2.8-1.6z\" fill=\"currentColor\" stroke=\"none\"/>",
  'ofertas': "<path d=\"M12.6 3.5H19a1.5 1.5 0 0 1 1.5 1.5v6.4a2 2 0 0 1-.6 1.4l-7.4 7.4a2 2 0 0 1-2.8 0l-5-5a2 2 0 0 1 0-2.8l7.4-7.4a2 2 0 0 1 1.5-.5z\"/><circle cx=\"15.5\" cy=\"8.5\" r=\"1.4\"/>",
  'olho': "<path d=\"M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/>",
  'produtos': "<path d=\"M12 3.5 20 8v8l-8 4.5L4 16V8z\"/><path d=\"M4.5 8.2 12 12.5l7.5-4.3M12 12.5v8\"/>",
  'ranking': "<path d=\"M9 20.5V10h6v10.5M3.5 20.5v-6H9M15 20.5v-8h5.5v8M3 20.5h18\"/><path d=\"M12 3.5l.9 1.8 2 .3-1.4 1.4.3 2-1.8-1-1.8 1 .3-2-1.4-1.4 2-.3z\" fill=\"currentColor\" stroke=\"none\"/>",
  'recuperacao': "<path d=\"M4 12a8 8 0 1 0 2.3-5.6M4 3.5V7h3.5\"/><path d=\"M12 8.5V12l2.5 1.5\"/>",
  'seta-dir': "<path d=\"M4.5 12h15M13.5 6 19.5 12l-6 6\"/>",
  'sino': "<path d=\"M6 10a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 14 6 10\"/><path d=\"M10 19a2.2 2.2 0 0 0 4 0\"/>",
  'solicitacoes': "<rect x=\"4.5\" y=\"3.5\" width=\"15\" height=\"17\" rx=\"2.5\"/><path d=\"M8.5 8.5h7M8.5 12h7M8.5 15.5h4\"/>",
  'tema': "<circle cx=\"12\" cy=\"12\" r=\"4.5\"/><path d=\"M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M4.9 4.9 6.7 6.7M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8\"/>",
  'transacoes': "<path d=\"M4 8h13M14 4.5 17.5 8 14 11.5\"/><path d=\"M20 16H7M10 12.5 6.5 16l3.5 3.5\"/>",
  'visao': "<rect x=\"3.5\" y=\"3.5\" width=\"7\" height=\"7\" rx=\"2\"/><rect x=\"13.5\" y=\"3.5\" width=\"7\" height=\"7\" rx=\"2\"/><rect x=\"3.5\" y=\"13.5\" width=\"7\" height=\"7\" rx=\"2\"/><path d=\"M17 13.5v7M13.5 17h7\"/>",
};
// Nomes da UI (Lucide) que têm equivalente EXATO na biblioteca NorthScale.
// Os demais continuam no traço Lucide, que é da mesma família (24/round).
// Ícones só-NorthScale são usados com prefixo: <Icon name="ns-funil"/>.
const NS_ICON_ALIAS = {
  'x': 'fechar', 'check': 'check', 'search': 'busca', 'info': 'info', 'filter': 'filtro',
  'calendar': 'calendario', 'download': 'exportar', 'plus': 'mais', 'bell': 'sino',
  'eye': 'olho', 'settings': 'config', 'mail': 'email', 'alert-triangle': 'alerta',
  'message-square': 'chat', 'bar-chart-3': 'grafico-barra', 'trending-up': 'crescimento',
  'users': 'afiliados', 'package': 'produtos', 'receipt': 'transacoes',
  'layout-dashboard': 'visao', 'sun': 'tema',
};

function Icon({ name, size = 16, stroke = 1.6, className = '', label }) {
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
    'upload': ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4','M17 8l-5-5-5 5','M12 3v12'],
    'sliders': ['M4 21v-7','M4 10V3','M12 21v-9','M12 8V3','M20 21v-5','M20 12V3','M1 14h6','M9 8h6','M17 16h6'],
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
    'sun': ['M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z','M12 1v2','M12 21v2','M4.22 4.22l1.42 1.42','M18.36 18.36l1.42 1.42','M1 12h2','M21 12h2','M4.22 19.78l1.42-1.42','M18.36 5.64l1.42-1.42'],
    'leaf': ['M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19.5 2c.5 1.5 1 3 1 4.5C20.5 13.12 17.12 20 11 20Z','M2 22c2-2 5-3 8-4'],
    'target': ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z','M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z','M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z'],
    'clock': ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z','M12 6v6l4 2'],
    'credit-card': ['M2 5h20v14H2z','M2 10h20'],
    'link': ['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71','M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'],
    'refresh': ['M23 4v6h-6','M1 20v-6h6','M3.5 9a9 9 0 0 1 15-3.4L23 10','M20.5 15a9 9 0 0 1-15 3.4L1 14'],
    'message-square': ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z'],
    'mail': ['M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z','m22 6-10 7L2 6'],
    'user': ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2','M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8'],
    'map': ['M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4Z','M8 2v16','M16 6v16'],
    'info': ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z','M12 16v-4','M12 8h.01'],
    'sort': ['m7 15 5 5 5-5','m7 9 5-5 5 5'],
    'layers': ['m12 2 9 5-9 5-9-5 9-5Z','m3 12 9 5 9-5','m3 17 9 5 9-5'],
    'eye': ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z','M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'],
    'log-out': ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4','m16 17 5-5-5-5','M21 12H9'],
    'user-plus': ['M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2','M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8','M20 8v6','M23 11h-6'],
    'edit': ['M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7','M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5Z'],
    'key': ['M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777Zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5 5-5'],
    'trash': ['M3 6h18','M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2','M10 11v6','M14 11v6'],
    // Usados na UI e ausentes do mapa — caíam em 'info' (ⓘ) sem ninguém
    // perceber: o botão de EXCLUIR mostrava um "i". O build agora falha
    // se um nome usado não existir aqui (scripts/build-spa.mjs).
    'chevrons-left': ['m11 17-5-5 5-5','m18 17-5-5 5-5'],
    'chevrons-right': ['m6 17 5-5-5-5','m13 17 5-5-5-5'],
    'ns-afiliados': [],
    'ns-alerta': [],
    'ns-busca': [],
    'ns-calendario': [],
    'ns-chat': [],
    'ns-check': [],
    'ns-config': [],
    'ns-crescimento': [],
    'ns-custos': [],
    'ns-email': [],
    'ns-exportar': [],
    'ns-fechar': [],
    'ns-filtro': [],
    'ns-funil': [],
    'ns-grafico-barra': [],
    'ns-grafico-linha': [],
    'ns-info': [],
    'ns-insights': [],
    'ns-mais': [],
    'ns-networks': [],
    'ns-norte': [],
    'ns-ofertas': [],
    'ns-olho': [],
    'ns-produtos': [],
    'ns-ranking': [],
    'ns-recuperacao': [],
    'ns-seta-dir': [],
    'ns-sino': [],
    'ns-solicitacoes': [],
    'ns-tema': [],
    'ns-transacoes': [],
    'ns-visao': [],
    'trash-2': ['M3 6h18','M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2','M10 11v6','M14 11v6'],
    'pencil': ['M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z','m15 5 4 4'],
    'chevron-left': ['m15 18-6-6 6-6'],
    'external-link': ['M15 3h6v6','M10 14 21 3','M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
    // Estrela de 4 pontas: a metáfora "topo" do DESIGN-SYSTEM §7.
    'sparkles': ['M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z','M20 3v4','M22 5h-4'],
    'send': ['M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z','m21.854 2.147-10.94 10.939'],
    'loader': ['M12 2v4','m16.2 7.8 2.9-2.9','M18 12h4','m16.2 16.2 2.9 2.9','M12 18v4','m4.9 19.1 2.9-2.9','M2 12h4','m4.9 4.9 2.9 2.9'],
  };
  const ps = paths[name] || paths['info'];
  const nsKey = NS_ICON_ALIAS[name] || (name && name.startsWith('ns-') ? name.slice(3) : null);
  const nsMarkup = nsKey ? NS_ICON_MARKUP[nsKey] : null;
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
      className={className}
      focusable="false"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' })}
    >
      {nsMarkup
        ? <g dangerouslySetInnerHTML={{ __html: nsMarkup }}/>
        : ps.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

// ---------- sparkline ----------
function Sparkline({ data, width = 80, height = 26, color = 'var(--accent)', fill = true }) {
  if (!data || data.length < 2) return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}/>;
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
  return (
    // viewBox: quando o CSS mobile encolhe o svg (max-width), o traço
    // escala em vez de clipar à direita.
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="spark">
      {/* DS1: área em preenchimento chapado — sem gradiente decorativo. */}
      {fill && <path d={area} fill={color} fillOpacity="0.12"/>}
      <path d={path} fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ---------- export CSV ----------
// Convenções pt-BR (iguais ao lib/shared/csv.ts do servidor — mudou lá,
// mude aqui): separador ';', decimal ',', BOM UTF-8 → abre direto no
// Excel pt-BR e no Sheets. Strings com guarda contra formula injection.
function csvCellFmt(v) {
  if (v == null) return '';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
    return Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ',');
  }
  let s = String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  if (/[";\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function downloadCsv(filename, headers, rows) {
  const lines = [headers.map(csvCellFmt).join(';')];
  for (const r of rows) lines.push(r.map(csvCellFmt).join(';'));
  const blob = new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------- FX layers ----------
// .ns-scan (linhas digitais via repeating-linear-gradient) removida —
// textura agressiva demais segundo feedback. Mantemos só o gradient orb
// difuso de .ns-bg.
function FXLayers() {
  return (
    <>
      <div className="ns-bg"/>
    </>
  );
}

// export to window
// ============================================================
// Paginação (pedido do dono do produto: "em tudo que for lista/tabela,
// paginação com controle e seletor embaixo"). DS1: informar total e
// página atual, preservar filtros e ordenação, alvo clicável adequado.
//
// Três formas, da mais segura para a mais flexível:
//   <Paginated items={rows}>{(pageRows, pager) => (<>…tabela…{pager}</>)}</Paginated>
//       — guarda o estado sozinho; pode ficar dentro de if/map. PADRÃO.
//   const { pageItems, pager } = usePaged(rows)
//       — hook: só no topo do componente, antes de qualquer return.
//   <Pager page total pageSize onPageChange onPageSizeChange/>
//       — controlado, para listas paginadas no servidor.
// Totais, exportação CSV e contagens continuam sobre a lista INTEIRA; só
// as linhas desenhadas são da página.
// ============================================================
const NS_PAGE_SIZES = [10, 25, 50, 100];
const NS_PAGE_SIZE_KEY = 'ns-page-size';
function nsReadPageSize(fallback) {
  try {
    const v = Number(localStorage.getItem(NS_PAGE_SIZE_KEY));
    return NS_PAGE_SIZES.includes(v) ? v : fallback;
  } catch (e) { return fallback; }
}
function nsSavePageSize(v) { try { localStorage.setItem(NS_PAGE_SIZE_KEY, String(v)); } catch (e) {} }

/** Janela de páginas com reticências: 1 … 4 [5] 6 … 48 */
function nsPageWindow(page, totalPages) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const out = [1];
  const lo = Math.max(2, page - 1), hi = Math.min(totalPages - 1, page + 1);
  if (lo > 2) out.push('gap-l');
  for (let p = lo; p <= hi; p++) out.push(p);
  if (hi < totalPages - 1) out.push('gap-r');
  out.push(totalPages);
  return out;
}

function Pager({ page, pageSize, total, onPageChange, onPageSizeChange, hasMore, label = 'itens', pageSizes = NS_PAGE_SIZES }) {
  const known = typeof total === 'number';
  const totalPages = known ? Math.max(1, Math.ceil(total / pageSize)) : null;
  const from = known && total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = known ? Math.min(page * pageSize, total) : page * pageSize;
  const canPrev = page > 1;
  const canNext = known ? page < totalPages : !!hasMore;
  const go = (p) => { if (p !== page) onPageChange(p); };
  return (
    <nav className="ns-pager" aria-label="Paginação">
      <div className="ns-pager-summary" aria-live="polite">
        {known
          ? (total === 0 ? 'Nenhum resultado' : <>Mostrando <strong>{fmtInt(from)}–{fmtInt(to)}</strong> de <strong>{fmtInt(total)}</strong> {label}</>)
          : <>Mostrando <strong>{fmtInt(from)}–{fmtInt(to)}</strong> {label}</>}
      </div>
      {onPageSizeChange && (
        <label className="ns-pager-size">
          <span>Por página</span>
          <select value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))} aria-label="Itens por página">
            {pageSizes.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      )}
      <div className="ns-pager-nav">
        {known && <button type="button" className="ns-pager-btn" onClick={() => go(1)} disabled={!canPrev} aria-label="Primeira página" title="Primeira página"><Icon name="chevrons-left" size={16}/></button>}
        <button type="button" className="ns-pager-btn" onClick={() => go(page - 1)} disabled={!canPrev} aria-label="Página anterior" title="Página anterior"><Icon name="chevron-left" size={16}/></button>
        {known && nsPageWindow(page, totalPages).map((p) => (typeof p === 'number'
          ? <button type="button" key={p} className="ns-pager-btn" onClick={() => go(p)} aria-current={p === page ? 'page' : undefined} aria-label={'Página ' + p}>{p}</button>
          : <span key={p} className="ns-pager-gap" aria-hidden="true">…</span>))}
        {!known && <span className="ns-pager-gap" aria-current="page">{page}</span>}
        <button type="button" className="ns-pager-btn" onClick={() => go(page + 1)} disabled={!canNext} aria-label="Próxima página" title="Próxima página"><Icon name="chevron-right" size={16}/></button>
        {known && <button type="button" className="ns-pager-btn" onClick={() => go(totalPages)} disabled={!canNext} aria-label="Última página" title="Última página"><Icon name="chevrons-right" size={16}/></button>}
      </div>
    </nav>
  );
}

/** Identidade de um item para comparar a lista antes/depois (id quando há). */
function nsItemKey(it) {
  if (it == null || typeof it !== 'object') return String(it);
  const k = it.id ?? it.key ?? it.externalId ?? it.slug ?? it.code;
  if (k != null) return String(k) + (it.platformSlug ? '@' + it.platformSlug : '');
  try { return JSON.stringify(it); } catch (e) { return String(it); }
}

/**
 * Hook de paginação no cliente. Volta à página 1 quando `resetKey` muda ou
 * quando a lista vira OUTRA lista (filtro, busca); fica na página quando só
 * sai ou muda um punhado de itens — fila que encolhe a cada ação ("enviei",
 * "confirmar") não pode jogar o usuário de volta pra página 1. Nunca deixa a
 * página cair além do fim. Abaixo de `minToShow` itens não pagina nem desenha
 * o controle — uma tabela de 6 linhas não precisa dele.
 */
function usePaged(items, opts = {}) {
  const { initialPageSize = 25, resetKey, minToShow = 10, label } = opts;
  const list = Array.isArray(items) ? items : [];
  const [pageSize, setPageSize] = React.useState(() => nsReadPageSize(initialPageSize));
  const [page, setPage] = React.useState(1);
  const total = list.length;
  const keys = React.useMemo(() => list.map(nsItemKey), [list]);
  const prev = React.useRef({ keys, resetKey });
  React.useEffect(() => {
    const p = prev.current;
    if (p.keys === keys && p.resetKey === resetKey) return;
    let reset = p.resetKey !== resetKey;
    // Lista vazia no meio de um recarregamento não conta: compara a lista de
    // antes do "carregando" com a de depois.
    if (!reset && keys.length === 0) return;
    if (!reset) {
      const before = new Set(p.keys), after = new Set(keys);
      let changed = 0;
      for (const k of after) if (!before.has(k)) changed++;
      for (const k of before) if (!after.has(k)) changed++;
      reset = changed > 5 || changed > p.keys.length * 0.2;
    }
    prev.current = { keys, resetKey };
    if (reset) setPage(1);
  }, [keys, resetKey]);
  const active = total > minToShow;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  // Encolheu além do fim (última linha da última página saiu): assenta na
  // nova última página em vez de ficar num número que não existe mais.
  React.useEffect(() => {
    if (total > 0 && page > totalPages) setPage(totalPages);
  }, [total, page, totalPages]);
  const start = active ? (safePage - 1) * pageSize : 0;
  const pageItems = active ? list.slice(start, start + pageSize) : list;
  const pager = active ? (
    <Pager page={safePage} pageSize={pageSize} total={total} label={label}
      onPageChange={setPage}
      onPageSizeChange={(n) => { setPageSize(n); nsSavePageSize(n); setPage(1); }}/>
  ) : null;
  return { pageItems, pager, page: safePage, pageSize, total, start };
}

/** Versão componente do usePaged — pode ficar em qualquer lugar do JSX. */
function Paginated({ items, children, initialPageSize, resetKey, minToShow, label }) {
  const p = usePaged(items, { initialPageSize, resetKey, minToShow, label });
  return children(p.pageItems, p.pager, p);
}

// ============================================================
// Estados de leitura (DS1 "Dado com contexto"): vazio · carregando ·
// parcial · falha. Parcial é o que importa na operação — ex.: BuyGoods sem
// estorno registrado: o total PARECE certo e não está.
// ============================================================
const NS_READSTATE_ICON = { parcial: 'alert-triangle', falha: 'alert-triangle', vazio: 'info', carregando: 'loader' };
function ReadState({ kind = 'parcial', title, children, action, onAction }) {
  return (
    <div className={'ns-readstate is-' + kind} role={kind === 'falha' ? 'alert' : 'status'}>
      <Icon name={NS_READSTATE_ICON[kind] || 'info'} size={16}/>
      <div>
        {title && <strong>{title}</strong>}
        {children && <div className="ns-readstate-body">{children}</div>}
      </div>
      {action && onAction && <button type="button" className="btn btn-ghost" onClick={onAction}>{action}</button>}
    </div>
  );
}

// ============================================================
// Aviso de leitura PARCIAL de reembolso (DS1 "Dado com contexto").
// Plataforma com volume real e nenhum estorno em 30 dias = o evento não está
// chegando (caso BuyGoods). O sinal vem de /api/metrics/data-coverage e some
// sozinho quando a ingestão voltar. `platforms` = filtro atual ([] = todas).
// ============================================================
let _nsCoverageCache = null; // { at, promise }
function nsLoadCoverage() {
  const fresh = _nsCoverageCache && Date.now() - _nsCoverageCache.at < 5 * 60_000;
  if (!fresh) {
    _nsCoverageCache = {
      at: Date.now(),
      promise: (window.NSApi && window.NSApi.fetchDataCoverage ? window.NSApi.fetchDataCoverage() : Promise.resolve(null))
        .catch(() => null),
    };
  }
  return _nsCoverageCache.promise;
}
function RefundCoverageNotice({ platforms }) {
  const [cov, setCov] = React.useState(null);
  React.useEffect(() => {
    let alive = true;
    nsLoadCoverage().then((c) => { if (alive) setCov(c); });
    return () => { alive = false; };
  }, []);
  if (!cov || !Array.isArray(cov.platforms)) return null;
  const scope = Array.isArray(platforms) && platforms.length ? new Set(platforms) : null;
  const silent = cov.platforms.filter((p) => p.silent && (!scope || scope.has(p.platform)));
  if (!silent.length) return null;
  const names = silent.map((p) => p.displayName).join(', ');
  const sales = silent.reduce((n, p) => n + p.sales, 0);
  return (
    <div style={{ marginBottom: 12 }}>
      <ReadState kind="parcial" title="Leitura parcial de reembolso">
        {silent.length === 1 ? 'A ' : 'As plataformas '}{names} não {silent.length === 1 ? 'registrou' : 'registraram'} nenhum estorno nos últimos {cov.windowDays} dias,
        apesar de {fmtInt(sales)} vendas aprovadas — o evento de estorno não está chegando. O reembolso
        {silent.length === 1 ? ' dela' : ' delas'} aparece como zero e o total da operação pode mudar.
      </ReadState>
    </div>
  );
}

Object.assign(window, {
  fmtCurrency, fmtK, fmtInt, fmtPct, fmtDateShort, fmtDateLong, fmtDateTime,
  initials, avatarColor, rangeForPreset, previousRange, isoDateOnly, dayIndexFromDate,
  applyFilters, aggregateKPIs, bucketByDay,
  downloadCsv,
  Icon, Sparkline, FXLayers,
  Pager, Paginated, usePaged, ReadState, NS_PAGE_SIZES, RefundCoverageNotice,
  nsReadPageSize, nsSavePageSize,
});
