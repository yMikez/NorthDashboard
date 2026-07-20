// Aba Fulfillment reformulada — "quanto está sendo ENVIADO, quanto está
// sendo GASTO, e onde tem problema".
//
// Fonte: Orders APROVADAS (premissa: aprovado = enviado; refund NÃO devolve
// o custo — o produto já saiu). Volume vem do snapshot Order.bottlesShipped
// (congela o catálogo da época); custo dos snapshots cogsUsd/fulfillmentUsd
// já rebalanceados por sessão (FE+upsells = 1 pacote — ver
// sessionFulfillment.ts).
//
// PACOTE = sessão de funil (mesma chave do rebalance): BuyGoods agrupa por
// funnelSessionId (sessid2), demais por parentExternalId. É o que o
// fornecedor de fato despacha e cobra.
//
// Projeções (Fase 3) são SEMPRE relativas a AGORA (últimos 7/30 dias),
// independente do período selecionado na tela — respeitando os filtros de
// dimensão. Dia bucketado em BRT como no resto do dash.

import { db } from '../db';

const BRT_OFFSET_MS = 3 * 3600_000;
const DAY_MS = 86_400_000;

// Dia da semana do fechamento da fatura dos fornecedores (BRT).
// 2 = terça. Editável aqui; se um fornecedor mudar de ciclo, vira mapa.
const INVOICE_CYCLE_DOW = 2;

// Referência operacional do usuário: as invoices semanais dos fornecedores
// giram em torno de ~10% do faturamento. Usada como régua de sanidade nos
// ciclos de fatura — desvio grande pra CIMA = gross caindo ou custo
// inflado; pra BAIXO = provável furo de contagem/custo (ver saúde).
export const INVOICE_PCT_BENCHMARK = 0.10;

const DEFAULT_SUPPLIER = 'shipoffers';
// Plataformas cuja sessão agrupa por funnelSessionId (ver sessionFulfillment).
const SESSION_GROUPED = new Set(['buygoods']);

function brtDay(d: Date): string {
  return new Date(d.getTime() - BRT_OFFSET_MS).toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Shapes ──────────────────────────────────────────────────────────────────

export interface FulfillmentOrderRow {
  platformSlug: string;
  funnelSessionId: string | null;
  parentExternalId: string | null;
  externalId: string;
  family: string | null;
  supplier: string;
  bottles: number;
  fulfillmentUsd: number;
  cogsUsd: number;
  grossUsd: number;
  orderedAt: Date;
}

export interface FulfillmentFilters {
  startDate: Date;
  endDate: Date;
  platformSlugs?: string[];
  countries?: string[];
  productFamilies?: string[];
}

export interface FulfillmentKpis {
  orders: number;
  packages: number;
  bottles: number;
  fulfillmentUsd: number;
  cogsUsd: number;
  totalUsd: number;
  grossUsd: number;
  fulfillmentPctOfGross: number | null;
  // custo de FRETE médio por pacote; custo TOTAL (pote+frete) por pote.
  costPerPackageUsd: number | null;
  costPerBottleUsd: number | null;
  prev: { orders: number; bottles: number; fulfillmentUsd: number; cogsUsd: number; totalUsd: number };
}

export interface FulfillmentForecast {
  // Médias diárias (7 dias BRT completos antes de hoje) e tendência vs 30d.
  avg7d: { bottlesPerDay: number; fulfillmentPerDay: number; cogsPerDay: number; totalPerDay: number };
  avg30d: { totalPerDay: number };
  trendPct: number | null; // avg7d.total vs avg30d.total
  month: {
    label: string; // 'YYYY-MM'
    actualUsd: number;
    actualBottles: number;
    projectedUsd: number;
    projectedBottles: number;
    daysElapsed: number;
    daysInMonth: number;
  };
  nextInvoice: Array<{
    supplier: string;
    cycleStart: string; // dia BRT do último fechamento
    daysToNext: number;
    accruedUsd: number;
    projectedUsd: number;
  }>;
  // Últimos ciclos de fatura (qua→ter BRT) vs faturamento — régua dos ~10%.
  invoiceCycles: InvoiceCycle[];
  invoiceBenchmarkPct: number;
}

export interface InvoiceCycle {
  // Dia BRT do fechamento (terça) que encerra o ciclo. O ciclo cobre os 7
  // dias que terminam NESSA terça (qua anterior → ter).
  closesOn: string;
  partial: boolean; // ciclo corrente ainda aberto
  grossUsd: number;
  fulfillmentUsd: number;
  cogsUsd: number;
  totalUsd: number;
  // total (pote+frete) ÷ gross e frete ÷ gross — comparar com o benchmark.
  totalPctOfGross: number | null;
  fulfillmentPctOfGross: number | null;
}

export interface FulfillmentResponse {
  range: { start: string; end: string };
  kpis: FulfillmentKpis;
  daily: Array<{ date: string; bottles: number; packages: number; fulfillmentUsd: number; cogsUsd: number }>;
  byFamily: Array<{ family: string; orders: number; bottles: number; fulfillmentUsd: number; cogsUsd: number; costPerBottleUsd: number | null }>;
  bySupplier: Array<{ supplier: string; orders: number; packages: number; bottles: number; fulfillmentUsd: number; cogsUsd: number }>;
  bracketMix: Array<{ bracket: string; packages: number; bottles: number; pctPackages: number }>;
  forecast: FulfillmentForecast;
}

// ── Reducers puros ──────────────────────────────────────────────────────────

export function sessionKeyFor(r: Pick<FulfillmentOrderRow, 'platformSlug' | 'funnelSessionId' | 'parentExternalId' | 'externalId'>): string {
  return SESSION_GROUPED.has(r.platformSlug)
    ? `${r.platformSlug}|${r.funnelSessionId ?? r.externalId}`
    : `${r.platformSlug}|${r.parentExternalId ?? r.externalId}`;
}

function bracketLabel(bottles: number): string {
  if (bottles <= 0) return 'sem potes';
  if (bottles >= 7) return '7+';
  return String(bottles);
}

export function reduceFulfillment(
  rows: FulfillmentOrderRow[],
  prev: FulfillmentKpis['prev'],
): Omit<FulfillmentResponse, 'range' | 'forecast'> {
  let bottles = 0;
  let fulfill = 0;
  let cogs = 0;
  let gross = 0;

  interface SessionAcc { bottles: number; firstDay: string; firstAt: number; supplier: string }
  const sessions = new Map<string, SessionAcc>();
  const daily = new Map<string, { bottles: number; packages: number; fulfill: number; cogs: number }>();
  const byFamily = new Map<string, { orders: number; bottles: number; fulfill: number; cogs: number }>();
  const bySupplier = new Map<string, { orders: number; packages: number; bottles: number; fulfill: number; cogs: number }>();

  for (const r of rows) {
    bottles += r.bottles;
    fulfill += r.fulfillmentUsd;
    cogs += r.cogsUsd;
    gross += r.grossUsd;

    const day = brtDay(r.orderedAt);
    const d = daily.get(day) ?? { bottles: 0, packages: 0, fulfill: 0, cogs: 0 };
    d.bottles += r.bottles;
    d.fulfill += r.fulfillmentUsd;
    d.cogs += r.cogsUsd;
    daily.set(day, d);

    const famKey = r.family ?? 'Sem família';
    const f = byFamily.get(famKey) ?? { orders: 0, bottles: 0, fulfill: 0, cogs: 0 };
    f.orders++;
    f.bottles += r.bottles;
    f.fulfill += r.fulfillmentUsd;
    f.cogs += r.cogsUsd;
    byFamily.set(famKey, f);

    const s = bySupplier.get(r.supplier) ?? { orders: 0, packages: 0, bottles: 0, fulfill: 0, cogs: 0 };
    s.orders++;
    s.bottles += r.bottles;
    s.fulfill += r.fulfillmentUsd;
    s.cogs += r.cogsUsd;
    bySupplier.set(r.supplier, s);

    const key = sessionKeyFor(r);
    const at = r.orderedAt.getTime();
    const sess = sessions.get(key);
    if (!sess) {
      sessions.set(key, { bottles: r.bottles, firstDay: day, firstAt: at, supplier: r.supplier });
    } else {
      sess.bottles += r.bottles;
      // Pacote conta no dia (e fornecedor) da PRIMEIRA order da sessão.
      if (at < sess.firstAt) {
        sess.firstAt = at;
        sess.firstDay = day;
        sess.supplier = r.supplier;
      }
    }
  }

  // Pacotes → dia, fornecedor e mix de brackets.
  const brackets = new Map<string, { packages: number; bottles: number }>();
  for (const sess of sessions.values()) {
    const d = daily.get(sess.firstDay);
    if (d) d.packages++;
    const s = bySupplier.get(sess.supplier);
    if (s) s.packages++;
    const label = bracketLabel(sess.bottles);
    const b = brackets.get(label) ?? { packages: 0, bottles: 0 };
    b.packages++;
    b.bottles += sess.bottles;
    brackets.set(label, b);
  }

  const packages = sessions.size;
  const totalUsd = round2(fulfill + cogs);
  const BRACKET_ORDER = ['1', '2', '3', '4', '5', '6', '7+', 'sem potes'];

  return {
    kpis: {
      orders: rows.length,
      packages,
      bottles,
      fulfillmentUsd: round2(fulfill),
      cogsUsd: round2(cogs),
      totalUsd,
      grossUsd: round2(gross),
      fulfillmentPctOfGross: gross > 0 ? Math.round((fulfill / gross) * 10000) / 10000 : null,
      costPerPackageUsd: packages > 0 ? round2(fulfill / packages) : null,
      costPerBottleUsd: bottles > 0 ? round2((fulfill + cogs) / bottles) : null,
      prev,
    },
    daily: Array.from(daily.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, d]) => ({
        date,
        bottles: d.bottles,
        packages: d.packages,
        fulfillmentUsd: round2(d.fulfill),
        cogsUsd: round2(d.cogs),
      })),
    byFamily: Array.from(byFamily.entries())
      .sort(([, a], [, b]) => b.fulfill + b.cogs - (a.fulfill + a.cogs))
      .map(([family, f]) => ({
        family,
        orders: f.orders,
        bottles: f.bottles,
        fulfillmentUsd: round2(f.fulfill),
        cogsUsd: round2(f.cogs),
        costPerBottleUsd: f.bottles > 0 ? round2((f.fulfill + f.cogs) / f.bottles) : null,
      })),
    bySupplier: Array.from(bySupplier.entries())
      .sort(([, a], [, b]) => b.fulfill - a.fulfill)
      .map(([supplier, s]) => ({
        supplier,
        orders: s.orders,
        packages: s.packages,
        bottles: s.bottles,
        fulfillmentUsd: round2(s.fulfill),
        cogsUsd: round2(s.cogs),
      })),
    bracketMix: BRACKET_ORDER.filter((l) => brackets.has(l)).map((label) => {
      const b = brackets.get(label)!;
      return {
        bracket: label,
        packages: b.packages,
        bottles: b.bottles,
        pctPackages: packages > 0 ? Math.round((b.packages / packages) * 1000) / 10 : 0,
      };
    }),
  };
}

function addDaysBrt(day: string, days: number): string {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

// Agrupa orders por CICLO DE FATURA (qua→ter BRT, fechando terça) e compara
// custo vs faturamento — régua dos ~10% do usuário. Puro, testável.
export function reduceInvoiceCycles(
  rows: FulfillmentOrderRow[],
  now: Date,
  count: number,
): InvoiceCycle[] {
  const today = brtDay(now);
  const acc = new Map<string, { gross: number; fulfill: number; cogs: number }>();
  for (const r of rows) {
    const day = brtDay(r.orderedAt);
    // Fecha na próxima terça >= day (terça fecha no próprio dia).
    const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
    const closesOn = addDaysBrt(day, (INVOICE_CYCLE_DOW - dow + 7) % 7);
    const c = acc.get(closesOn) ?? { gross: 0, fulfill: 0, cogs: 0 };
    c.gross += r.grossUsd;
    c.fulfill += r.fulfillmentUsd;
    c.cogs += r.cogsUsd;
    acc.set(closesOn, c);
  }
  return Array.from(acc.entries())
    .sort(([a], [b]) => (a > b ? -1 : 1))
    .slice(0, count)
    .map(([closesOn, c]) => {
      const total = c.fulfill + c.cogs;
      return {
        closesOn,
        partial: closesOn >= today,
        grossUsd: round2(c.gross),
        fulfillmentUsd: round2(c.fulfill),
        cogsUsd: round2(c.cogs),
        totalUsd: round2(total),
        totalPctOfGross: c.gross > 0 ? Math.round((total / c.gross) * 10000) / 10000 : null,
        fulfillmentPctOfGross: c.gross > 0 ? Math.round((c.fulfill / c.gross) * 10000) / 10000 : null,
      };
    });
}

// Projeções a partir das orders dos últimos ~35 dias (janela now-relative).
export function computeForecast(windowRows: FulfillmentOrderRow[], now: Date): FulfillmentForecast {
  const today = brtDay(now);

  // Somas por dia BRT (globais + frete por fornecedor).
  const byDay = new Map<string, { bottles: number; fulfill: number; cogs: number }>();
  const supplierByDay = new Map<string, Map<string, number>>();
  const suppliers = new Set<string>();
  for (const r of windowRows) {
    const day = brtDay(r.orderedAt);
    const d = byDay.get(day) ?? { bottles: 0, fulfill: 0, cogs: 0 };
    d.bottles += r.bottles;
    d.fulfill += r.fulfillmentUsd;
    d.cogs += r.cogsUsd;
    byDay.set(day, d);
    suppliers.add(r.supplier);
    const sd = supplierByDay.get(r.supplier) ?? new Map<string, number>();
    sd.set(day, (sd.get(day) ?? 0) + r.fulfillmentUsd);
    supplierByDay.set(r.supplier, sd);
  }

  // Janela de N dias BRT COMPLETOS terminando ontem (hoje parcial distorce).
  const dayNDaysAgo = (n: number) => brtDay(new Date(now.getTime() - n * DAY_MS));
  const windowAvg = (n: number, pick: (d: { bottles: number; fulfill: number; cogs: number }) => number) => {
    let sum = 0;
    for (let i = 1; i <= n; i++) {
      const d = byDay.get(dayNDaysAgo(i));
      if (d) sum += pick(d);
    }
    return sum / n;
  };
  const avg7 = {
    bottlesPerDay: Math.round(windowAvg(7, (d) => d.bottles) * 10) / 10,
    fulfillmentPerDay: round2(windowAvg(7, (d) => d.fulfill)),
    cogsPerDay: round2(windowAvg(7, (d) => d.cogs)),
    totalPerDay: round2(windowAvg(7, (d) => d.fulfill + d.cogs)),
  };
  const avg30Total = round2(windowAvg(30, (d) => d.fulfill + d.cogs));

  // Mês corrente (BRT): realizado + projeção no ritmo dos últimos 7d.
  const monthLabel = today.slice(0, 7);
  const dayOfMonth = Number(today.slice(8, 10));
  const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let mtdUsd = 0;
  let mtdBottles = 0;
  for (const [day, d] of byDay) {
    if (day.slice(0, 7) === monthLabel && day <= today) {
      mtdUsd += d.fulfill + d.cogs;
      mtdBottles += d.bottles;
    }
  }
  const daysRemaining = daysInMonth - dayOfMonth;

  // Próxima fatura por fornecedor: acumulado desde o último fechamento
  // (terça BRT) + projeção até o próximo no ritmo 7d do fornecedor.
  const todayDow = new Date(`${today}T00:00:00Z`).getUTCDay();
  // Fechamento mais recente (hoje conta como fechamento se for o dia).
  const daysSinceCycle = (todayDow - INVOICE_CYCLE_DOW + 7) % 7;
  const cycleStart = dayNDaysAgo(daysSinceCycle);
  const daysToNext = daysSinceCycle === 0 ? 7 : 7 - daysSinceCycle;

  const nextInvoice = Array.from(suppliers).sort().map((supplier) => {
    const sd = supplierByDay.get(supplier)!;
    let accrued = 0;
    for (const [day, usd] of sd) {
      if (day >= cycleStart && day <= today) accrued += usd;
    }
    let avg7Supplier = 0;
    for (let i = 1; i <= 7; i++) avg7Supplier += sd.get(dayNDaysAgo(i)) ?? 0;
    avg7Supplier /= 7;
    return {
      supplier,
      cycleStart,
      daysToNext,
      accruedUsd: round2(accrued),
      projectedUsd: round2(accrued + avg7Supplier * daysToNext),
    };
  });

  return {
    avg7d: avg7,
    avg30d: { totalPerDay: avg30Total },
    trendPct: avg30Total > 0 ? Math.round(((avg7.totalPerDay - avg30Total) / avg30Total) * 1000) / 10 : null,
    month: {
      label: monthLabel,
      actualUsd: round2(mtdUsd),
      actualBottles: mtdBottles,
      projectedUsd: round2(mtdUsd + avg7.totalPerDay * daysRemaining),
      projectedBottles: Math.round(mtdBottles + avg7.bottlesPerDay * daysRemaining),
      daysElapsed: dayOfMonth,
      daysInMonth,
    },
    nextInvoice,
    // 4 ciclos (incl. o corrente parcial) cabem na janela de 35d.
    invoiceCycles: reduceInvoiceCycles(windowRows, now, 4),
    invoiceBenchmarkPct: INVOICE_PCT_BENCHMARK,
  };
}

// Comparação estendida de ciclos de fatura (mais história que o forecast).
// Consumida pelo endpoint admin /api/admin/fulfillment-check.
export async function getInvoiceCycles(cycles = 8): Promise<InvoiceCycle[]> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - (cycles + 1) * 7 * DAY_MS);
  const [orders, familyCosts] = await Promise.all([
    db.order.findMany({
      where: { status: 'APPROVED', orderedAt: { gte: windowStart, lte: now } },
      select: ORDER_SELECT,
    }),
    db.productFamilyCost.findMany({ select: { family: true, fulfillmentSupplier: true } }),
  ]);
  const familySupplier = new Map(familyCosts.map((f) => [f.family, f.fulfillmentSupplier]));
  return reduceInvoiceCycles(orders.map((o) => toRow(o, familySupplier)), now, cycles);
}

// ── Serviço ─────────────────────────────────────────────────────────────────

interface RawOrderSelect {
  externalId: string;
  funnelSessionId: string | null;
  parentExternalId: string | null;
  bottlesShipped: number | null;
  fulfillmentUsd: unknown;
  cogsUsd: unknown;
  grossAmountUsd: unknown;
  orderedAt: Date;
  platform: { slug: string };
  product: { family: string | null; bottles: number | null; bonusBottles: number | null; fulfillmentSupplier: string | null };
}

function toRow(o: RawOrderSelect, familySupplier: Map<string, string>): FulfillmentOrderRow {
  const supplier =
    o.product.fulfillmentSupplier
    ?? (o.product.family ? familySupplier.get(o.product.family) : null)
    ?? DEFAULT_SUPPLIER;
  return {
    platformSlug: o.platform.slug,
    funnelSessionId: o.funnelSessionId,
    parentExternalId: o.parentExternalId,
    externalId: o.externalId,
    family: o.product.family,
    supplier,
    bottles: o.bottlesShipped ?? (o.product.bottles ?? 0) + (o.product.bonusBottles ?? 0),
    fulfillmentUsd: o.fulfillmentUsd ? Number(o.fulfillmentUsd) : 0,
    cogsUsd: o.cogsUsd ? Number(o.cogsUsd) : 0,
    grossUsd: o.grossAmountUsd ? Number(o.grossAmountUsd) : 0,
    orderedAt: o.orderedAt,
  };
}

const ORDER_SELECT = {
  externalId: true,
  funnelSessionId: true,
  parentExternalId: true,
  bottlesShipped: true,
  fulfillmentUsd: true,
  cogsUsd: true,
  grossAmountUsd: true,
  orderedAt: true,
  platform: { select: { slug: true } },
  product: { select: { family: true, bottles: true, bonusBottles: true, fulfillmentSupplier: true } },
} as const;

export async function getFulfillment(filters: FulfillmentFilters): Promise<FulfillmentResponse> {
  const now = new Date();
  const { startDate, endDate } = filters;
  const durationMs = endDate.getTime() - startDate.getTime();

  const dimensionWhere = {
    ...(filters.platformSlugs?.length ? { platform: { slug: { in: filters.platformSlugs } } } : {}),
    ...(filters.countries?.length ? { country: { in: filters.countries } } : {}),
    ...(filters.productFamilies?.length ? { product: { family: { in: filters.productFamilies } } } : {}),
  };

  const [periodOrders, prevAgg, windowOrders, familyCosts] = await Promise.all([
    db.order.findMany({
      where: { status: 'APPROVED', orderedAt: { gte: startDate, lte: endDate }, ...dimensionWhere },
      select: ORDER_SELECT,
    }),
    db.order.aggregate({
      where: {
        status: 'APPROVED',
        orderedAt: { gte: new Date(startDate.getTime() - durationMs), lt: startDate },
        ...dimensionWhere,
      },
      _count: { _all: true },
      _sum: { bottlesShipped: true, fulfillmentUsd: true, cogsUsd: true },
    }),
    // Janela de projeção: 35 dias cobrem 30d completos + mês corrente.
    db.order.findMany({
      where: { status: 'APPROVED', orderedAt: { gte: new Date(now.getTime() - 35 * DAY_MS), lte: now }, ...dimensionWhere },
      select: ORDER_SELECT,
    }),
    db.productFamilyCost.findMany({ select: { family: true, fulfillmentSupplier: true } }),
  ]);

  const familySupplier = new Map(familyCosts.map((f) => [f.family, f.fulfillmentSupplier]));
  const rows = periodOrders.map((o) => toRow(o, familySupplier));
  const windowRows = windowOrders.map((o) => toRow(o, familySupplier));

  const prevFulfill = prevAgg._sum.fulfillmentUsd ? Number(prevAgg._sum.fulfillmentUsd) : 0;
  const prevCogs = prevAgg._sum.cogsUsd ? Number(prevAgg._sum.cogsUsd) : 0;
  const prev = {
    orders: prevAgg._count._all,
    bottles: prevAgg._sum.bottlesShipped ?? 0,
    fulfillmentUsd: round2(prevFulfill),
    cogsUsd: round2(prevCogs),
    totalUsd: round2(prevFulfill + prevCogs),
  };

  return {
    range: { start: startDate.toISOString(), end: endDate.toISOString() },
    ...reduceFulfillment(rows, prev),
    forecast: computeForecast(windowRows, now),
  };
}
