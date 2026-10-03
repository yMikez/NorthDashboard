// Desempenho das VSLs — redução pura das linhas que o SQL devolve
// (lib/services/vslPerformance.ts). Duas fontes, nunca misturadas:
//
//   RASTREIO (beacon do snippet): visitas → play → chegou ao pitch → aceite
//     (clique em comprar) / recusa. Vale por visita, por VSL e por braço de
//     teste. Na BuyGoods o sessid2 casa a visita com a venda confirmada.
//   VENDA REAL (pedidos das plataformas): sessões com FE da família e vendas
//     da etapa, por dia BRT. Atribuída a uma VSL só nos dias em que ela foi a
//     ÚNICA no ar o dia inteiro, depois da instalação da página (primeira
//     visita rastreada). Dia de troca e dia de teste A/B ficam de fora.

export interface VisitAggRow {
  pageId: string;
  vslId: string | null;
  testId: string | null;
  armId: string | null;
  day: string; // YYYY-MM-DD (BRT)
  visits: number;
  plays: number;
  pitch: number;
  accepts: number;
  /** aceites de quem também chegou ao pitch (base do "aceite pós-pitch") */
  acceptsAfterPitch: number;
  declines: number;
  watchSum: number; // soma dos segundos assistidos de quem deu play
}

export interface LinkedRow {
  pageId: string;
  vslId: string | null;
  testId: string | null;
  armId: string | null;
  day: string;
  soldVisits: number;
  revenue: number;
}

export interface RealRow {
  pageId: string;
  day: string;
  feSessions: number;
  sales: number;
  revenue: number;
}

export interface ChangeRow {
  pageId: string | null;
  kind: string;
  toVslId: string | null;
  createdAt: Date;
}

export interface PageInfo {
  id: string;
  platform: string;
  fallbackVslId: string | null;
}

export interface Metrics {
  visits: number;
  plays: number;
  pitch: number;
  accepts: number;
  declines: number;
  playRate: number | null;
  pitchRate: number | null;
  acceptRate: number | null;
  acceptAfterPitch: number | null;
  avgWatchSeconds: number | null;
  /** vendas confirmadas por visita (só onde dá pra casar: BuyGoods) */
  linkable: boolean;
  /** visitas em página que casa visita e venda — base de saleRate/receita por visita */
  linkableVisits: number;
  sales: number | null;
  revenue: number | null;
  saleRate: number | null;
  revenuePerVisit: number | null;
}

export interface RealMetrics {
  days: number;
  feSessions: number;
  sales: number;
  revenue: number;
  takeRate: number | null;
}

export interface Acc {
  visits: number;
  plays: number;
  pitch: number;
  accepts: number;
  acceptsAfterPitch: number;
  declines: number;
  watchSum: number;
  sold: number;
  revenue: number;
  linkable: boolean;
  linkableVisits: number;
}

const BRT_SHIFT_MS = 3 * 60 * 60 * 1000;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const div = (a: number, b: number) => (b > 0 ? r4(a / b) : null);

export function brtDay(d: Date): string {
  return new Date(d.getTime() - BRT_SHIFT_MS).toISOString().slice(0, 10);
}

function emptyAcc(linkable = false): Acc {
  return { visits: 0, plays: 0, pitch: 0, accepts: 0, acceptsAfterPitch: 0, declines: 0, watchSum: 0, sold: 0, revenue: 0, linkable, linkableVisits: 0 };
}

function addVisit(a: Acc, r: VisitAggRow, linkable: boolean) {
  a.visits += r.visits;
  a.plays += r.plays;
  a.pitch += r.pitch;
  a.accepts += r.accepts;
  a.acceptsAfterPitch += r.acceptsAfterPitch;
  a.declines += r.declines;
  a.watchSum += r.watchSum;
  if (linkable) { a.linkable = true; a.linkableVisits += r.visits; }
}

export function finishMetrics(a: Acc): Metrics {
  return {
    visits: a.visits,
    plays: a.plays,
    pitch: a.pitch,
    accepts: a.accepts,
    declines: a.declines,
    playRate: div(a.plays, a.visits),
    pitchRate: div(a.pitch, a.visits),
    acceptRate: div(a.accepts, a.visits),
    acceptAfterPitch: div(a.acceptsAfterPitch, a.pitch),
    avgWatchSeconds: a.plays > 0 ? Math.round(a.watchSum / a.plays) : null,
    linkable: a.linkable,
    linkableVisits: a.linkableVisits,
    sales: a.linkable ? a.sold : null,
    revenue: a.linkable ? r2(a.revenue) : null,
    saleRate: a.linkable ? div(a.sold, a.linkableVisits) : null,
    revenuePerVisit: a.linkable && a.linkableVisits > 0 ? r2(a.revenue / a.linkableVisits) : null,
  };
}

function finishReal(days: number, fe: number, sales: number, revenue: number): RealMetrics {
  return { days, feSessions: fe, sales, revenue: r2(revenue), takeRate: div(sales, fe) };
}

// ── Linha do tempo: qual VSL estava no ar em cada instante ──────────────

export type LiveState = { kind: 'vsl'; vslId: string | null } | { kind: 'test' };

const LIVE_KINDS = new Set([
  'page_created', 'vsl_assigned', 'page_enabled', 'page_disabled', 'fallback_set',
  'test_started', 'test_resumed', 'test_paused', 'test_finished',
]);

interface Machine { enabled: boolean; vslId: string | null; fallback: string | null; test: boolean }

function apply(m: Machine, c: ChangeRow) {
  switch (c.kind) {
    case 'page_created': m.enabled = true; m.vslId = c.toVslId; m.fallback = c.toVslId; break;
    case 'vsl_assigned': m.vslId = c.toVslId; break;
    case 'page_enabled': m.enabled = true; break;
    case 'page_disabled': m.enabled = false; break;
    case 'fallback_set': m.fallback = c.toVslId; break;
    case 'test_started':
    case 'test_resumed': m.test = true; break;
    case 'test_paused': m.test = false; break;
    case 'test_finished': m.test = false; if (c.toVslId) m.vslId = c.toVslId; break;
  }
}

function live(m: Machine): LiveState {
  if (!m.enabled) return { kind: 'vsl', vslId: m.fallback };
  if (m.test) return { kind: 'test' };
  return { kind: 'vsl', vslId: m.vslId ?? m.fallback };
}

/**
 * VSL exclusiva do dia (BRT) numa página, ou null quando o dia não é
 * atribuível: antes da instalação, teve troca no dia, teste rodando.
 */
export function exclusiveVslForDay(
  changesSorted: ChangeRow[],
  day: string,
  installDay: string | null,
  initialFallback: string | null,
): string | null {
  // O dia da instalação fica de fora: parte dele ainda rodou o embed antigo.
  if (!installDay || day <= installDay) return null;
  const start = new Date(`${day}T00:00:00.000Z`).getTime() + BRT_SHIFT_MS;
  const end = start + 24 * 60 * 60 * 1000;
  // A reserva começa vazia e segue o histórico (page_created, fallback_set) —
  // a reserva ATUAL não vale pra dias antes de ela ser trocada.
  void initialFallback;
  const m: Machine = { enabled: true, vslId: null, fallback: null, test: false };
  for (const c of changesSorted) {
    const t = c.createdAt.getTime();
    if (t >= end) break;
    if (t >= start) return null; // mexeram no meio do dia
    apply(m, c);
  }
  const s = live(m);
  return s.kind === 'vsl' ? s.vslId : null;
}

// ── Redução principal ────────────────────────────────────────────────────

export interface PerformanceInput {
  visits: VisitAggRow[];
  linked: LinkedRow[];
  real: RealRow[];
  changes: ChangeRow[];
  pages: PageInfo[];
  /** primeiro dia (BRT) com visita rastreada, por página — de todo o histórico */
  installDayByPage: Map<string, string>;
}

const LINKABLE_PLATFORMS = new Set(['buygoods']);

const vk = (pageId: string, vslId: string | null) => `${pageId}|${vslId ?? ''}`;

export function reducePerformance(input: PerformanceInput) {
  const pageById = new Map(input.pages.map((p) => [p.id, p]));
  const linkablePage = (pageId: string) => LINKABLE_PLATFORMS.has(pageById.get(pageId)?.platform ?? '');

  const totals = emptyAcc(false);
  const byVsl = new Map<string, Acc & { pages: Set<string> }>();
  const byPage = new Map<string, Acc>();
  const byPageVsl = new Map<string, Acc & { pageId: string; vslId: string | null }>();
  const daily = new Map<string, { day: string; vslId: string | null; visits: number; accepts: number; pitch: number }>();

  for (const r of input.visits) {
    const linkable = linkablePage(r.pageId);
    addVisit(totals, r, linkable);
    const vKey = r.vslId ?? '';
    let v = byVsl.get(vKey);
    if (!v) { v = Object.assign(emptyAcc(false), { pages: new Set<string>() }); byVsl.set(vKey, v); }
    addVisit(v, r, linkable);
    v.pages.add(r.pageId);

    let p = byPage.get(r.pageId);
    if (!p) { p = emptyAcc(linkable); byPage.set(r.pageId, p); }
    addVisit(p, r, linkable);

    const pvKey = vk(r.pageId, r.vslId);
    let pv = byPageVsl.get(pvKey);
    if (!pv) { pv = Object.assign(emptyAcc(linkable), { pageId: r.pageId, vslId: r.vslId }); byPageVsl.set(pvKey, pv); }
    addVisit(pv, r, linkable);

    const dKey = `${r.day}|${vKey}`;
    const d = daily.get(dKey) ?? { day: r.day, vslId: r.vslId, visits: 0, accepts: 0, pitch: 0 };
    d.visits += r.visits;
    d.accepts += r.accepts;
    d.pitch += r.pitch;
    daily.set(dKey, d);
  }

  for (const l of input.linked) {
    const add = (a: Acc | undefined) => { if (a) { a.sold += l.soldVisits; a.revenue += l.revenue; } };
    add(totals);
    add(byVsl.get(l.vslId ?? ''));
    add(byPage.get(l.pageId));
    add(byPageVsl.get(vk(l.pageId, l.vslId)));
  }

  // Venda real: total por página e atribuição exclusiva por VSL.
  const changesByPage = new Map<string, ChangeRow[]>();
  for (const c of input.changes) {
    if (!c.pageId || !LIVE_KINDS.has(c.kind)) continue;
    const list = changesByPage.get(c.pageId) ?? [];
    list.push(c);
    changesByPage.set(c.pageId, list);
  }
  for (const list of changesByPage.values()) list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const realPage = new Map<string, { days: number; fe: number; sales: number; revenue: number }>();
  const realPageVsl = new Map<string, { days: number; fe: number; sales: number; revenue: number }>();
  const realVsl = new Map<string, { days: number; fe: number; sales: number; revenue: number }>();
  const bump = (m: Map<string, { days: number; fe: number; sales: number; revenue: number }>, k: string, r: RealRow) => {
    const a = m.get(k) ?? { days: 0, fe: 0, sales: 0, revenue: 0 };
    a.days += 1; a.fe += r.feSessions; a.sales += r.sales; a.revenue += r.revenue;
    m.set(k, a);
  };
  for (const r of input.real) {
    bump(realPage, r.pageId, r);
    const page = pageById.get(r.pageId);
    const vslId = exclusiveVslForDay(changesByPage.get(r.pageId) ?? [], r.day, input.installDayByPage.get(r.pageId) ?? null, page?.fallbackVslId ?? null);
    if (vslId) {
      bump(realPageVsl, vk(r.pageId, vslId), r);
      bump(realVsl, vslId, r);
    }
  }
  const real = (a?: { days: number; fe: number; sales: number; revenue: number }) =>
    a ? finishReal(a.days, a.fe, a.sales, a.revenue) : null;

  // Página × VSL só com venda real (VSL que não teve visita rastreada no período).
  for (const k of realPageVsl.keys()) {
    if (byPageVsl.has(k)) continue;
    const [pageId, vslId] = k.split('|');
    byPageVsl.set(k, Object.assign(emptyAcc(linkablePage(pageId)), { pageId, vslId: vslId || null }));
  }

  return {
    totals: finishMetrics(totals),
    byVsl: [...byVsl.entries()].map(([vslId, a]) => ({
      vslId: vslId || null,
      pages: a.pages.size,
      ...finishMetrics(a),
      real: real(realVsl.get(vslId)),
    })),
    byPage: [...new Set([...byPage.keys(), ...realPage.keys()])].map((pageId) => ({
      pageId,
      ...finishMetrics(byPage.get(pageId) ?? emptyAcc(linkablePage(pageId))),
      real: real(realPage.get(pageId)),
    })),
    byPageVsl: [...byPageVsl.entries()].map(([k, a]) => ({
      pageId: a.pageId,
      vslId: a.vslId,
      ...finishMetrics(a),
      real: real(realPageVsl.get(k)),
    })),
    daily: [...daily.values()]
      .map((d) => ({ ...d, acceptRate: div(d.accepts, d.visits), pitchRate: div(d.pitch, d.visits) }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    realDaily: [...input.real].sort((a, b) => a.day.localeCompare(b.day)).map((r) => ({
      ...r, revenue: r2(r.revenue), takeRate: div(r.sales, r.feSessions),
    })),
  };
}

export type PerformanceReduced = ReturnType<typeof reducePerformance>;
