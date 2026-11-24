// Decisões (ClickUp) × métricas — regras puras.
//
// "Desde o dia X a decisão Y foi tomada; ela podia mexer em N métricas; elas
// estão assim desde então." O dash compara a MÉDIA dos dias desde a decisão
// com a dos mesmos tantos dias imediatamente antes (até 30). É correlação no
// tempo — nunca prova de causa — e o texto diz isso sempre.

import { fmtValue, metricPair, type MetricFormat, type MetricKey } from '../briefing/core';

export const DECISION_METRICS: readonly MetricKey[] = [
  'faturamento', 'pedidos', 'aov', 'net_after_cpa', 'aprovacao', 'reembolso', 'chargeback',
];

export const METRIC_META: Record<MetricKey, { label: string; format: MetricFormat; better: 'higher' | 'lower'; perDay: boolean }> = {
  faturamento: { label: 'Faturamento/dia', format: 'money', better: 'higher', perDay: true },
  pedidos: { label: 'Pedidos/dia', format: 'int', better: 'higher', perDay: true },
  aov: { label: 'AOV', format: 'money2', better: 'higher', perDay: false },
  net_after_cpa: { label: 'Net after CPA/dia', format: 'money', better: 'higher', perDay: true },
  aprovacao: { label: 'Taxa de aprovação', format: 'pct', better: 'higher', perDay: false },
  reembolso: { label: 'Reembolso/dia (US$)', format: 'money', better: 'lower', perDay: true },
  chargeback: { label: 'Chargeback', format: 'pct', better: 'lower', perDay: false },
};

export type Expected = 'subir' | 'cair' | 'incerto';
export interface MetricExpectation { metric: MetricKey; expected: Expected }

export const CORRELATION_DISCLAIMER =
  'Correlação no tempo, não prova de causa: sazonalidade, tráfego, afiliados, outras decisões e o mercado mexem nos mesmos números.';

export const MAX_WINDOW_DAYS = 30;
export const MIN_AFTER_DAYS = 3;
const DAY_MS = 86_400_000;
const BRT_MS = 3 * 3_600_000;

const brtDayStart = (d: Date) => {
  const s = new Date(d.getTime() - BRT_MS);
  return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()) + BRT_MS);
};
const ymd = (d: Date) => new Date(d.getTime() - BRT_MS).toISOString().slice(0, 10);

export interface Window { start: Date; end: Date; days: number; from: string; to: string }

/**
 * Depois = do dia da decisão até ontem (no máx. 30 dias); antes = os mesmos
 * tantos dias imediatamente antes. Menos de 3 dias depois = cedo demais.
 */
export function correlationWindows(decidedAt: Date, now: Date): { before: Window; after: Window; early: boolean } {
  const afterStart = brtDayStart(decidedAt);
  const todayStart = brtDayStart(now);
  const days = Math.max(0, Math.min(MAX_WINDOW_DAYS, Math.round((todayStart.getTime() - afterStart.getTime()) / DAY_MS)));
  const afterEnd = new Date(afterStart.getTime() + days * DAY_MS - 1);
  const beforeStart = new Date(afterStart.getTime() - Math.max(days, 1) * DAY_MS);
  const beforeEnd = new Date(afterStart.getTime() - 1);
  const mk = (start: Date, end: Date, n: number): Window => ({ start, end, days: n, from: ymd(start), to: ymd(end) });
  return {
    before: mk(beforeStart, beforeEnd, Math.max(days, 1)),
    after: mk(afterStart, afterEnd, days),
    early: days < MIN_AFTER_DAYS,
  };
}

export type Verdict = 'esperado' | 'contrario' | 'estavel' | 'sem_base';

export interface MetricShift {
  metric: MetricKey;
  label: string;
  expected: Expected;
  before: number;
  after: number;
  beforeFmt: string;
  afterFmt: string;
  deltaFmt: string;
  /** Na direção que a decisão esperava? (incerto: segue o bom/ruim do negócio). */
  verdict: Verdict;
  /** Bom pro negócio (subir faturamento, cair reembolso…). */
  good: boolean | null;
}

/** Totais de cada janela → médias comparáveis (fluxos por dia; taxas como estão). */
export function buildShifts(
  expectations: MetricExpectation[],
  before: Partial<Record<MetricKey, number>>,
  after: Partial<Record<MetricKey, number>>,
  days: { before: number; after: number },
): MetricShift[] {
  const out: MetricShift[] = [];
  for (const e of expectations) {
    const meta = METRIC_META[e.metric];
    if (!meta) continue;
    const b = before[e.metric];
    const a = after[e.metric];
    if (b == null || a == null) continue;
    const bv = meta.perDay ? b / Math.max(days.before, 1) : b;
    const av = meta.perDay ? a / Math.max(days.after, 1) : a;
    const p = metricPair(e.metric, meta.label, meta.format, meta.better, av, bv);
    let verdict: Verdict;
    if (p.delta == null) verdict = 'sem_base';
    else if (p.good == null) verdict = 'estavel';
    else if (e.expected === 'subir') verdict = p.delta > 0 ? 'esperado' : 'contrario';
    else if (e.expected === 'cair') verdict = p.delta < 0 ? 'esperado' : 'contrario';
    else verdict = p.good ? 'esperado' : 'contrario';
    out.push({
      metric: e.metric, label: meta.label, expected: e.expected,
      before: p.prev, after: p.cur, beforeFmt: p.prevFmt, afterFmt: p.curFmt, deltaFmt: p.deltaFmt,
      verdict, good: p.good,
    });
  }
  return out;
}

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** O texto pronto ("Desde 12/11 … estão assim desde então"), sem a IA. */
export function correlationNarrative(
  decision: { title: string },
  w: { before: Window; after: Window; early: boolean },
  shifts: MetricShift[],
): string {
  const since = dm(w.after.from);
  if (w.early) {
    return `Decidido em ${since}: "${decision.title}". Ainda é cedo pra ler o efeito — menos de ${MIN_AFTER_DAYS} dias fechados desde então.`;
  }
  if (!shifts.length) {
    return `Decidido em ${since}: "${decision.title}". A decisão não aponta métrica do dash pra acompanhar.`;
  }
  const n = shifts.length;
  const parts = shifts.map((s) => `${lower(s.label)} ${s.deltaFmt} (${s.beforeFmt} → ${s.afterFmt})`);
  const judged = shifts.filter((s) => s.verdict === 'esperado' || s.verdict === 'contrario');
  const hit = judged.filter((s) => s.verdict === 'esperado').length;
  const tally = judged.length
    ? ` ${hit} de ${judged.length} ${judged.length === 1 ? 'andou' : 'andaram'} na direção esperada.`
    : ' Nenhuma mudou de forma relevante.';
  return `Desde ${since} foi decidido "${decision.title}", com potencial de mexer em ${n} ${n === 1 ? 'métrica' : 'métricas'}. `
    + `Nos ${w.after.days} dias seguintes, contra os ${w.before.days} anteriores: ${parts.join('; ')}.${tally}`;
}

/** Normaliza a resposta da IA: só métricas conhecidas, sem repetir. */
export function cleanExpectations(raw: Array<{ metric: string; expected: string }>): MetricExpectation[] {
  const seen = new Set<string>();
  const out: MetricExpectation[] = [];
  for (const r of raw) {
    if (!(DECISION_METRICS as readonly string[]).includes(r.metric) || seen.has(r.metric)) continue;
    seen.add(r.metric);
    const expected: Expected = r.expected === 'subir' || r.expected === 'cair' ? r.expected : 'incerto';
    out.push({ metric: r.metric as MetricKey, expected });
  }
  return out;
}

export { fmtValue };
