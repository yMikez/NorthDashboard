// Recorrências (aba Recorrências): de cobranças soltas de qualquer plataforma
// pra assinatura → estado, retenção, previsão. Tudo puro (sem banco).
//
// Uma assinatura = mesma plataforma + mesmo cliente (e-mail) + mesmo produto
// recorrente. A 1ª cobrança é a compra; as seguintes são renovações. Cada
// plataforma avisa (ou não) cancelamento e falha de pagamento do seu jeito —
// quem não avisa, a gente percebe pela cobrança que não veio:
//   esperada = última cobrança + ciclo
//   + 3 dias sem cobrança (ou falha avisada) → em atraso
//   + 15 dias sem cobrança → parou de pagar (encerrada, mesmo sem aviso)
// O ciclo sai das próprias cobranças (mediana dos intervalos); sem histórico,
// do produto; sem nada, 30 dias.

export const DAY_MS = 86400000;
export const LATE_AFTER_DAYS = 3;
export const LAPSE_AFTER_DAYS = 15;
export const DEFAULT_CYCLE_DAYS = 30;
/** Cobranças a menos de 5 dias uma da outra são o mesmo ciclo (2 unidades, nova tentativa). */
export const SAME_CYCLE_DAYS = 5;
/** Mínimo de assinaturas pra usar a retenção medida (abaixo disso, não chuta). */
export const MIN_SAMPLE = 10;
export const RETENTION_MAX = 8;

export interface RecCharge {
  at: Date;
  usd: number;
  /** Estornada (reembolso ou chargeback) — quando. */
  refundedAt: Date | null;
  ref?: string | null;
}

export type RecEventKind = 'cancel' | 'failed' | 'resume';
export interface RecEvent { kind: RecEventKind; at: Date; reason?: string | null }

export interface RecSubInput {
  key: string;
  platform: string;
  /** plataforma:produto — o filtro e o agrupamento "por produto". */
  productKey: string;
  product: string;
  email: string | null;
  name: string | null;
  phone: string | null;
  charges: RecCharge[];
  events: RecEvent[];
  /** Ciclo informado pela oferta (Vupim: frascos × 30). */
  cycleHintDays?: number | null;
  /** Fim do período pago, quando a plataforma diz (Vupim). */
  periodEnd?: Date | null;
  externalId?: string | null;
  fromSurvey?: boolean;
}

export type RecStatus = 'active' | 'late' | 'ended';
/** pediu = cancelamento avisado; reembolso = última cobrança estornada; sem_pagamento = a cobrança não veio. */
export type RecEndReason = 'pediu' | 'reembolso' | 'sem_pagamento';
export type RecCycleSource = 'cobrancas' | 'oferta' | 'produto' | 'padrao';

export interface RecSub {
  key: string; platform: string; productKey: string; product: string;
  email: string | null; name: string | null; phone: string | null; externalId: string | null; fromSurvey: boolean;
  /** Cobranças ordenadas (a 1ª é a compra). */
  charges: RecCharge[];
  /** Ciclos pagos (cobranças do mesmo ciclo contam 1) — "chegou na n-ª cobrança". */
  cycles: number;
  startedAt: Date;
  lastChargeAt: Date;
  totalPaidUsd: number;
  /** Valor da próxima renovação (última renovação; sem renovação, a do produto; senão a compra). */
  renewalUsd: number;
  cycleDays: number;
  cycleSource: RecCycleSource;
  status: RecStatus;
  endReason: RecEndReason | null;
  endedAt: Date | null;
  nextChargeAt: Date | null;
  nextEstimated: boolean;
  lastFailedAt: Date | null;
  failureReason: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const days = (ms: number) => ms / DAY_MS;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Início de cada ciclo: cobranças a menos de SAME_CYCLE_DAYS da anterior ficam no mesmo. */
function cycleStarts(charges: readonly RecCharge[]): Date[] {
  const out: Date[] = [];
  for (const c of charges) {
    const prev = out[out.length - 1];
    if (!prev || days(c.at.getTime() - prev.getTime()) >= SAME_CYCLE_DAYS) out.push(c.at);
  }
  return out;
}

function intervals(starts: readonly Date[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < starts.length; i++) out.push(days(starts[i].getTime() - starts[i - 1].getTime()));
  return out;
}

const clampCycle = (d: number) => Math.min(400, Math.max(7, Math.round(d)));

/**
 * Entrada → assinatura com estado em `now`. Ciclo e valor de renovação usam o
 * produto como reserva, então vem tudo junto (antes de qualquer filtro).
 */
export function buildSubs(inputs: readonly RecSubInput[], now: Date): RecSub[] {
  const sorted = inputs
    .map((i) => ({ i, charges: [...i.charges].filter((c) => c.usd > 0).sort((a, b) => a.at.getTime() - b.at.getTime()) }))
    .filter((x) => x.charges.length > 0);

  // Reservas por produto: intervalo mediano e valor mediano das renovações.
  const prodIntervals = new Map<string, number[]>();
  const prodRenewals = new Map<string, number[]>();
  for (const { i, charges } of sorted) {
    const iv = intervals(cycleStarts(charges));
    if (iv.length) prodIntervals.set(i.productKey, [...(prodIntervals.get(i.productKey) ?? []), ...iv]);
    if (charges.length > 1) prodRenewals.set(i.productKey, [...(prodRenewals.get(i.productKey) ?? []), ...charges.slice(1).map((c) => c.usd)]);
  }

  return sorted.map(({ i, charges }) => {
    const starts = cycleStarts(charges);
    const own = median(intervals(starts));
    const prod = (prodIntervals.get(i.productKey)?.length ?? 0) >= 3 ? median(prodIntervals.get(i.productKey)!) : null;
    const [cycleDays, cycleSource]: [number, RecCycleSource] = own != null ? [clampCycle(own), 'cobrancas']
      : i.cycleHintDays ? [clampCycle(i.cycleHintDays), 'oferta']
      : prod != null ? [clampCycle(prod), 'produto']
      : [DEFAULT_CYCLE_DAYS, 'padrao'];

    const first = charges[0];
    const last = charges[charges.length - 1];
    const lastMs = last.at.getTime();
    const renewalUsd = charges.length > 1 ? last.usd : median(prodRenewals.get(i.productKey) ?? []) ?? first.usd;

    const events = [...i.events].sort((a, b) => a.at.getTime() - b.at.getTime());
    let cancel: RecEvent | null = null;
    let failed: RecEvent | null = null;
    for (const e of events) {
      if (e.at.getTime() <= lastMs) continue;
      if (e.kind === 'cancel') cancel = cancel ?? e;
      else if (e.kind === 'resume') cancel = null;
      else if (e.kind === 'failed') failed = e;
    }

    const expected = i.periodEnd && i.periodEnd.getTime() > lastMs ? i.periodEnd : new Date(lastMs + cycleDays * DAY_MS);
    let status: RecStatus = 'active';
    let endReason: RecEndReason | null = null;
    let endedAt: Date | null = null;
    if (last.refundedAt) {
      status = 'ended'; endReason = 'reembolso'; endedAt = last.refundedAt;
    } else if (cancel) {
      status = 'ended'; endReason = 'pediu'; endedAt = cancel.at;
    } else if (now.getTime() > expected.getTime() + LAPSE_AFTER_DAYS * DAY_MS) {
      status = 'ended'; endReason = 'sem_pagamento'; endedAt = expected;
    } else if (failed || now.getTime() > expected.getTime() + LATE_AFTER_DAYS * DAY_MS) {
      status = 'late';
    }

    return {
      key: i.key, platform: i.platform, productKey: i.productKey, product: i.product,
      email: i.email, name: i.name, phone: i.phone, externalId: i.externalId ?? null, fromSurvey: Boolean(i.fromSurvey),
      charges,
      cycles: starts.length,
      startedAt: first.at,
      lastChargeAt: last.at,
      totalPaidUsd: round2(charges.filter((c) => !c.refundedAt).reduce((s, c) => s + c.usd, 0)),
      renewalUsd: round2(renewalUsd),
      cycleDays, cycleSource,
      status, endReason, endedAt,
      nextChargeAt: status === 'ended' ? null : expected,
      nextEstimated: !(i.periodEnd && i.periodEnd.getTime() > lastMs),
      lastFailedAt: status === 'ended' ? null : failed?.at ?? null,
      failureReason: status === 'ended' ? null : failed?.reason ?? null,
    };
  });
}

// ---------- análise ----------

/** Mês (BRT, UTC−3 sem horário de verão) — "2026-10". */
export const brtMonth = (d: Date) => new Date(d.getTime() - 3 * 3600000).toISOString().slice(0, 7);

function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

/** Fim do mês BRT (último ms). */
function monthEnd(month: string): Date {
  const next = addMonths(month, 1);
  return new Date(Date.parse(`${next}-01T03:00:00Z`) - 1);
}

export interface RetentionRow { n: number; eligible: number; reached: number; pct: number | null }

/**
 * Quantos chegam na n-ª cobrança. Só entra quem já teve tempo de pagar a n-ª
 * (início + (n−1) ciclos + a folga de atraso já passou) — sem isso quem
 * assinou ontem puxaria a taxa pra baixo.
 */
export function retention(subs: readonly RecSub[], now: Date, max = RETENTION_MAX): RetentionRow[] {
  const out: RetentionRow[] = [];
  for (let n = 1; n <= max; n++) {
    const due = (s: RecSub) => s.startedAt.getTime() + ((n - 1) * s.cycleDays + LAPSE_AFTER_DAYS) * DAY_MS <= now.getTime();
    const eligible = n === 1 ? subs : subs.filter(due);
    const reached = eligible.filter((s) => s.cycles >= n).length;
    out.push({ n, eligible: eligible.length, reached, pct: eligible.length ? reached / eligible.length : null });
  }
  return out;
}

/**
 * Chance de pagar o próximo ciclo pra quem já pagou k: medida entre quem já
 * teve tempo de pagar k+1. Pouca gente (< MIN_SAMPLE) → usa a média de todos
 * os ciclos; nenhuma medida → null (a previsão mostra só o máximo).
 */
export function continueRates(subs: readonly RecSub[], now: Date, max = 24): { byCycle: (number | null)[]; pooled: number | null } {
  const num: number[] = [];
  const den: number[] = [];
  for (let k = 1; k < max; k++) {
    const due = (s: RecSub) => s.startedAt.getTime() + (k * s.cycleDays + LAPSE_AFTER_DAYS) * DAY_MS <= now.getTime();
    const base = subs.filter((s) => s.cycles >= k && due(s));
    den[k] = base.length;
    num[k] = base.filter((s) => s.cycles >= k + 1).length;
  }
  const dSum = den.slice(1).reduce((s, x) => s + x, 0);
  const pooled = dSum >= MIN_SAMPLE ? num.slice(1).reduce((s, x) => s + x, 0) / dSum : null;
  const byCycle: (number | null)[] = [null];
  for (let k = 1; k < max; k++) byCycle[k] = den[k] >= MIN_SAMPLE ? num[k] / den[k] : pooled;
  return { byCycle, pooled };
}

export interface ForecastCharge { at: Date; usd: number; prob: number }

/** Próximas cobranças de quem não encerrou, até `until`, com a chance de cada uma vir. */
export function forecastCharges(sub: RecSub, rates: { byCycle: (number | null)[]; pooled: number | null }, now: Date, until: Date): ForecastCharge[] {
  if (sub.status === 'ended' || !sub.nextChargeAt) return [];
  const out: ForecastCharge[] = [];
  let t = Math.max(sub.nextChargeAt.getTime(), now.getTime());
  let prob = 1;
  let k = sub.cycles;
  while (t <= until.getTime() && out.length < 60) {
    const r = rates.byCycle[k] ?? rates.pooled;
    prob *= r ?? 1;
    out.push({ at: new Date(t), usd: sub.renewalUsd, prob });
    t += sub.cycleDays * DAY_MS;
    k++;
  }
  return out;
}

export interface RecMonth {
  month: string;
  kind: 'past' | 'current' | 'future';
  renewals: number;
  renewalsUsd: number;
  refundedUsd: number;
  newSubs: number;
  ended: number;
  expectedCharges: number;
  expectedUsd: number;
  maxUsd: number;
}

export interface RecProductRow {
  key: string; label: string; platform: string;
  total: number; active: number; late: number; ended: number;
  newSubs: number; renewals: number; renewalsUsd: number;
  avgTicketUsd: number | null;
  retention2: number | null; retention2Eligible: number;
  avgDaysToEnd: number | null;
  ltvUsd: number | null;
  mrrUsd: number;
  cycleDays: number | null;
}

export interface RecRow {
  key: string; platform: string; productKey: string; product: string;
  name: string | null; email: string | null; phone: string | null; externalId: string | null; fromSurvey: boolean;
  status: RecStatus; endReason: RecEndReason | null;
  startedAt: string; lastChargeAt: string; cycles: number; charges: number;
  totalPaidUsd: number; renewalUsd: number; cycleDays: number; cycleSource: RecCycleSource;
  nextChargeAt: string | null; nextEstimated: boolean;
  endedAt: string | null; daysToEnd: number | null;
  lastFailedAt: string | null; failureReason: string | null;
}

export interface RecDashboard {
  kpis: {
    renewals: number; renewalsUsd: number; refundedRenewalsUsd: number; avgTicketUsd: number | null;
    renewalsAllTime: number; renewalsAllTimeUsd: number; avgTicketAllTimeUsd: number | null;
    newSubs: number; newSubsUsd: number;
    active: number; late: number; mrrUsd: number;
    ended: number; endedPediu: number; endedReembolso: number; endedSemPagamento: number;
    activeAtStart: number; churn: number | null;
    avgDaysToEnd: number | null; avgCyclesToEnd: number | null;
    avgDaysToEndAll: number | null; avgCyclesToEndAll: number | null; endedAll: number;
    ltvUsd: number | null;
    forecast30Usd: number; forecast30MaxUsd: number; forecast30Charges: number;
    forecastHasHistory: boolean;
  };
  months: RecMonth[];
  retention: RetentionRow[];
  endTiming: { id: string; label: string; count: number }[];
  byProduct: RecProductRow[];
  byPlatform: { platform: string; total: number; active: number; late: number; ended: number; renewalsUsd: number; mrrUsd: number }[];
  rows: RecRow[];
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const inRange = (d: Date | null | undefined, start: Date, end: Date) => d != null && d >= start && d <= end;
const monthlyOf = (s: RecSub) => (s.status === 'ended' ? 0 : (s.renewalUsd * 30) / s.cycleDays);
const daysToEnd = (s: RecSub) => (s.endedAt ? Math.max(0, Math.round(days(s.endedAt.getTime() - s.startedAt.getTime()))) : null);

export function analyze(subs: readonly RecSub[], opts: { start: Date; end: Date; now: Date; pastMonths?: number; futureMonths?: number }): RecDashboard {
  const { start, end, now } = opts;
  const pastMonths = opts.pastMonths ?? 12;
  const futureMonths = opts.futureMonths ?? 6;
  const nowMonth = brtMonth(now);
  const horizon = monthEnd(addMonths(nowMonth, futureMonths - 1));
  const rates = continueRates(subs, now);

  // Renovações = cobrança depois da 1ª (o 1º ciclo é a compra).
  const renewalCharges = subs.flatMap((s) => s.charges.filter((c) => c.at.getTime() >= s.startedAt.getTime() + SAME_CYCLE_DAYS * DAY_MS));
  const paid = (c: RecCharge) => !c.refundedAt;
  const periodRenewals = renewalCharges.filter((c) => inRange(c.at, start, end));
  const renewalsUsd = periodRenewals.filter(paid).reduce((s, c) => s + c.usd, 0);
  const renewalsN = periodRenewals.filter(paid).length;
  const allPaid = renewalCharges.filter(paid);
  const allUsd = allPaid.reduce((s, c) => s + c.usd, 0);

  const ended = subs.filter((s) => s.status === 'ended');
  const endedIn = ended.filter((s) => inRange(s.endedAt, start, end));
  const activeAtStart = subs.filter((s) => s.startedAt < start && (!s.endedAt || s.endedAt >= start)).length;

  const forecasts = subs.map((s) => ({ s, f: forecastCharges(s, rates, now, horizon) }));
  const in30 = now.getTime() + 30 * DAY_MS;
  let f30 = 0, f30max = 0, f30n = 0;
  for (const { f } of forecasts) {
    for (const c of f) {
      if (c.at.getTime() > in30) break;
      f30 += c.usd * c.prob; f30max += c.usd; f30n += c.prob;
    }
  }

  // Mês a mês: passado (recebido), mês corrente (recebido + o que falta), futuro (previsto).
  const months = new Map<string, RecMonth>();
  for (let i = -pastMonths + 1; i <= futureMonths - 1; i++) {
    const m = addMonths(nowMonth, i);
    months.set(m, { month: m, kind: i < 0 ? 'past' : i === 0 ? 'current' : 'future', renewals: 0, renewalsUsd: 0, refundedUsd: 0, newSubs: 0, ended: 0, expectedCharges: 0, expectedUsd: 0, maxUsd: 0 });
  }
  for (const c of renewalCharges) {
    const m = months.get(brtMonth(c.at));
    if (!m) continue;
    if (c.refundedAt) m.refundedUsd += c.usd;
    else { m.renewals++; m.renewalsUsd += c.usd; }
  }
  for (const s of subs) {
    const m = months.get(brtMonth(s.startedAt));
    if (m) m.newSubs++;
    const e = s.endedAt && s.endedAt <= now ? months.get(brtMonth(s.endedAt)) : undefined;
    if (e) e.ended++;
  }
  for (const { f } of forecasts) {
    for (const c of f) {
      const m = months.get(brtMonth(c.at));
      if (!m) continue;
      m.expectedCharges += c.prob; m.expectedUsd += c.usd * c.prob; m.maxUsd += c.usd;
    }
  }

  const endTiming = [
    { id: '1', label: 'Antes da 2ª cobrança', test: (n: number) => n <= 1 },
    { id: '2', label: 'Depois da 2ª', test: (n: number) => n === 2 },
    { id: '3', label: 'Depois da 3ª', test: (n: number) => n === 3 },
    { id: '4-5', label: 'Depois da 4ª ou 5ª', test: (n: number) => n === 4 || n === 5 },
    { id: '6+', label: 'Depois da 6ª ou mais', test: (n: number) => n >= 6 },
  ].map((b) => ({ id: b.id, label: b.label, count: ended.filter((s) => b.test(s.cycles)).length }));

  const group = <K extends string>(keyOf: (s: RecSub) => K) => {
    const g = new Map<K, RecSub[]>();
    for (const s of subs) g.set(keyOf(s), [...(g.get(keyOf(s)) ?? []), s]);
    return g;
  };

  const byProduct: RecProductRow[] = [...group((s) => s.productKey).entries()].map(([key, list]) => {
    const ren = list.flatMap((s) => s.charges.filter((c) => c.at.getTime() >= s.startedAt.getTime() + SAME_CYCLE_DAYS * DAY_MS));
    const renPaid = ren.filter(paid);
    const renIn = renPaid.filter((c) => inRange(c.at, start, end));
    const r2 = retention(list, now, 2)[1];
    const endedL = list.filter((s) => s.status === 'ended');
    return {
      key, label: list[0].product, platform: list[0].platform,
      total: list.length,
      active: list.filter((s) => s.status === 'active').length,
      late: list.filter((s) => s.status === 'late').length,
      ended: endedL.length,
      newSubs: list.filter((s) => inRange(s.startedAt, start, end)).length,
      renewals: renIn.length,
      renewalsUsd: round2(renIn.reduce((s, c) => s + c.usd, 0)),
      avgTicketUsd: renPaid.length ? round2(renPaid.reduce((s, c) => s + c.usd, 0) / renPaid.length) : null,
      retention2: r2.pct, retention2Eligible: r2.eligible,
      avgDaysToEnd: avg(endedL.map((s) => daysToEnd(s)!)),
      ltvUsd: endedL.length ? round2(avg(endedL.map((s) => s.totalPaidUsd))!) : null,
      mrrUsd: round2(list.reduce((s, x) => s + monthlyOf(x), 0)),
      cycleDays: median(list.map((s) => s.cycleDays)),
    };
  }).sort((a, b) => b.active + b.late - (a.active + a.late) || b.total - a.total);

  const byPlatform = [...group((s) => s.platform).entries()].map(([platform, list]) => ({
    platform,
    total: list.length,
    active: list.filter((s) => s.status === 'active').length,
    late: list.filter((s) => s.status === 'late').length,
    ended: list.filter((s) => s.status === 'ended').length,
    renewalsUsd: round2(list.flatMap((s) => s.charges.filter((c) => paid(c) && inRange(c.at, start, end) && c.at.getTime() >= s.startedAt.getTime() + SAME_CYCLE_DAYS * DAY_MS)).reduce((x, c) => x + c.usd, 0)),
    mrrUsd: round2(list.reduce((x, s) => x + monthlyOf(s), 0)),
  })).sort((a, b) => b.total - a.total);

  const rows: RecRow[] = [...subs].sort((a, b) => b.lastChargeAt.getTime() - a.lastChargeAt.getTime()).map((s) => ({
    key: s.key, platform: s.platform, productKey: s.productKey, product: s.product,
    name: s.name, email: s.email, phone: s.phone, externalId: s.externalId, fromSurvey: s.fromSurvey,
    status: s.status, endReason: s.endReason,
    startedAt: s.startedAt.toISOString(), lastChargeAt: s.lastChargeAt.toISOString(),
    cycles: s.cycles, charges: s.charges.length,
    totalPaidUsd: s.totalPaidUsd, renewalUsd: s.renewalUsd, cycleDays: s.cycleDays, cycleSource: s.cycleSource,
    nextChargeAt: iso(s.nextChargeAt), nextEstimated: s.nextEstimated,
    endedAt: iso(s.endedAt), daysToEnd: daysToEnd(s),
    lastFailedAt: iso(s.lastFailedAt), failureReason: s.failureReason,
  }));

  const active = subs.filter((s) => s.status === 'active');
  const late = subs.filter((s) => s.status === 'late');
  const r = (n: number | null) => (n == null ? null : round2(n));
  return {
    kpis: {
      renewals: renewalsN,
      renewalsUsd: round2(renewalsUsd),
      refundedRenewalsUsd: round2(periodRenewals.filter((c) => !paid(c)).reduce((s, c) => s + c.usd, 0)),
      avgTicketUsd: renewalsN ? round2(renewalsUsd / renewalsN) : null,
      renewalsAllTime: allPaid.length,
      renewalsAllTimeUsd: round2(allUsd),
      avgTicketAllTimeUsd: allPaid.length ? round2(allUsd / allPaid.length) : null,
      newSubs: subs.filter((s) => inRange(s.startedAt, start, end)).length,
      newSubsUsd: round2(subs.filter((s) => inRange(s.startedAt, start, end)).reduce((x, s) => x + s.charges[0].usd, 0)),
      active: active.length,
      late: late.length,
      mrrUsd: round2(subs.reduce((x, s) => x + monthlyOf(s), 0)),
      ended: endedIn.length,
      endedPediu: endedIn.filter((s) => s.endReason === 'pediu').length,
      endedReembolso: endedIn.filter((s) => s.endReason === 'reembolso').length,
      endedSemPagamento: endedIn.filter((s) => s.endReason === 'sem_pagamento').length,
      activeAtStart,
      churn: activeAtStart ? endedIn.length / activeAtStart : null,
      avgDaysToEnd: r(avg(endedIn.map((s) => daysToEnd(s)!))),
      avgCyclesToEnd: r(avg(endedIn.map((s) => s.cycles))),
      avgDaysToEndAll: r(avg(ended.map((s) => daysToEnd(s)!))),
      avgCyclesToEndAll: r(avg(ended.map((s) => s.cycles))),
      endedAll: ended.length,
      ltvUsd: ended.length ? round2(avg(ended.map((s) => s.totalPaidUsd))!) : null,
      forecast30Usd: round2(f30),
      forecast30MaxUsd: round2(f30max),
      forecast30Charges: Math.round(f30n),
      forecastHasHistory: rates.pooled != null,
    },
    months: [...months.values()].map((m) => ({
      ...m,
      renewalsUsd: round2(m.renewalsUsd), refundedUsd: round2(m.refundedUsd),
      expectedCharges: Math.round(m.expectedCharges), expectedUsd: round2(m.expectedUsd), maxUsd: round2(m.maxUsd),
    })),
    retention: retention(subs, now),
    endTiming,
    byProduct,
    byPlatform,
    rows,
  };
}
