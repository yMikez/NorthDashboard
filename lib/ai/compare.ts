// compare_periods: roda a MESMA tool em dois períodos e devolve a diferença
// calculada no servidor — o modelo não subtrai de cabeça nem compara hoje
// parcial com ontem inteiro sem saber.
//
//   - períodos em dias civis BRT (mesma regra dos presets da tela);
//   - alinhamento: com A incluindo hoje, "same_elapsed" corta B no mesmo
//     tempo decorrido (aggregate_orders aceita hora de corte) ou, nas tools
//     que só recebem dias, compara só os dias FECHADOS dos dois lados;
//   - diff: toda folha numérica {a, b, delta, deltaPct} (+ deltaPp em
//     taxas), listas com chave casadas por entidade (movers, onlyInA/B);
//   - get_funnel e get_overview reaproveitam funnelTransition (efeito do
//     volume de FEs × efeito do AOV de sessão — decomposição exata).

import { brtRangeForDays, brtRangeForPreset } from '../shared/datePresets';
import { funnelTransition, EMPTY_SUMMARY, type FunnelScope } from '../services/funnelSequence';
import type { FunnelStage, FunnelSummary } from '../services/metrics';
import type { ToolContext } from './toolTypes';
import { cleanFloat } from './calc';

// ── Dias BRT ─────────────────────────────────────────────────────────────

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const BRT_OFFSET_MS = 3 * 3600 * 1000;

export class PeriodInputError extends Error {}

export interface BrtDays { start: string; end: string }

/** Dia civil BRT de um instante. */
export function brtDayOf(d: Date): string {
  return new Date(d.getTime() - BRT_OFFSET_MS).toISOString().slice(0, 10);
}

export function brtToday(now: Date): string {
  return brtRangeForPreset('today', now).start;
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

export function daysInclusive(r: BrtDays): number {
  return Math.round((Date.parse(`${r.end}T00:00:00Z`) - Date.parse(`${r.start}T00:00:00Z`)) / DAY_MS) + 1;
}

/** Valida "YYYY-MM-DD" (e que o dia existe — 2026-02-30 não passa). */
export function ymdArg(raw: unknown, name: string): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string' || !YMD.test(raw)) throw new PeriodInputError(`${name} inválido ("${String(raw)}") — use YYYY-MM-DD`);
  const t = Date.parse(`${raw}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== raw) throw new PeriodInputError(`${name} não é uma data real: ${raw}`);
  return raw;
}

/** "HH:MM" (BRT) → minutos do dia. */
export function hhmmArg(raw: unknown, name: string): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const m = typeof raw === 'string' ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(raw) : null;
  if (!m) throw new PeriodInputError(`${name} inválido ("${String(raw)}") — use HH:MM (BRT, 24h)`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Instantes exatos de um intervalo de dias BRT; `endMinutes` corta o último dia. */
export function instantsFor(r: BrtDays, endMinutes?: number): { startAt: Date; endAt: Date } {
  const range = brtRangeForDays(r.start, r.end);
  const startAt = new Date(range.startAt);
  const endAt = endMinutes == null
    ? new Date(range.endAt)
    : new Date(Date.parse(`${r.end}T00:00:00Z`) + BRT_OFFSET_MS + endMinutes * 60_000 + 59_999);
  return { startAt, endAt };
}

export function brtClock(now: Date): string {
  return new Date(now.getTime() - BRT_OFFSET_MS).toISOString().slice(11, 16);
}

/**
 * Período das tools novas quando o modelo passa (ou não) start/end: datas =
 * dias BRT inteiros; sem datas = o que a tela mostra (ctx), senão os últimos
 * 30 dias BRT até agora.
 */
export function resolveInstants(
  input: { start_date?: unknown; end_date?: unknown; end_time?: unknown },
  ctx: ToolContext,
  now: Date,
): { startAt: Date; endAt: Date; source: 'explicit' | 'ui' | 'default' } {
  const start = ymdArg(input.start_date, 'start_date');
  const end = ymdArg(input.end_date, 'end_date');
  const endMinutes = hhmmArg(input.end_time, 'end_time');
  if (endMinutes != null && !end) throw new PeriodInputError('end_time exige end_date');
  const today = brtToday(now);
  if (start || end) {
    const s = start ?? (ctx.defaultStart ? brtDayOf(ctx.defaultStart) : addDays(end!, -29));
    const e = end ?? today;
    if (e < s) throw new PeriodInputError('end_date anterior a start_date');
    const { startAt, endAt } = instantsFor({ start: s, end: e }, endMinutes);
    return { startAt, endAt, source: 'explicit' };
  }
  if (ctx.defaultStart && ctx.defaultEnd) return { startAt: ctx.defaultStart, endAt: ctx.defaultEnd, source: 'ui' };
  const { startAt } = instantsFor({ start: addDays(today, -29), end: today });
  return { startAt, endAt: now, source: 'default' };
}

// ── Períodos A/B e alinhamento ───────────────────────────────────────────

export type BPreset = 'previous' | 'previous_year' | 'same_weekday_last_week';
export type AlignMode = 'auto' | 'full' | 'same_elapsed';

export interface PeriodPlan {
  a: BrtDays & { endTime?: string };
  b: BrtDays & { endTime?: string };
  applied: 'full' | 'same_elapsed' | 'closed_days';
  aligned: boolean;
  aIncludesToday: boolean;
  notes: string[];
}

function shiftYear(day: string, years: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const target = new Date(Date.UTC(y + years, m - 1, d));
  // 29/02 → 28/02 (Date.UTC levaria pra 01/03).
  if (target.getUTCMonth() !== m - 1) return new Date(Date.UTC(y + years, m, 0)).toISOString().slice(0, 10);
  return target.toISOString().slice(0, 10);
}

export function periodB(a: BrtDays, preset: BPreset): BrtDays {
  const len = daysInclusive(a);
  switch (preset) {
    case 'previous':
      return { start: addDays(a.start, -len), end: addDays(a.start, -1) };
    case 'previous_year':
      return { start: shiftYear(a.start, -1), end: shiftYear(a.end, -1) };
    case 'same_weekday_last_week': {
      // Múltiplo de 7 que não sobrepõe A: preserva o mix de dias da semana.
      const shift = 7 * Math.ceil(len / 7);
      return { start: addDays(a.start, -shift), end: addDays(a.end, -shift) };
    }
  }
}

/**
 * Decide o recorte final de A e B. `supportsEndTime` = a tool aceita hora de
 * corte (aggregate_orders); as demais só recebem dias inteiros, então o
 * alinhamento possível é comparar só os dias fechados.
 */
export function planPeriods(
  aIn: BrtDays,
  bIn: BrtDays,
  align: AlignMode,
  now: Date,
  supportsEndTime: boolean,
): PeriodPlan {
  const notes: string[] = [];
  const today = brtToday(now);
  const a: PeriodPlan['a'] = { ...aIn };
  let b: PeriodPlan['b'] = { ...bIn };
  if (a.end > today) {
    notes.push(`A terminava no futuro (${a.end}); cortado em hoje (${today}).`);
    a.end = today;
  }
  if (a.start > a.end) throw new PeriodInputError('período A começa depois de hoje');
  const aIncludesToday = a.end === today;
  const mode = align === 'auto' ? (aIncludesToday ? 'same_elapsed' : 'full') : align;
  const lenA = daysInclusive(a);

  if (mode === 'same_elapsed' && aIncludesToday) {
    if (supportsEndTime) {
      const clock = brtClock(now);
      a.endTime = clock;
      b = { start: b.start, end: addDays(b.start, lenA - 1), endTime: clock };
      notes.push(`Mesmo tempo decorrido: A vai até hoje ${clock} BRT e B até ${b.end} ${clock} BRT.`);
      return { a, b, applied: 'same_elapsed', aligned: true, aIncludesToday, notes };
    }
    if (lenA >= 2) {
      a.end = addDays(today, -1);
      b = { start: b.start, end: addDays(b.start, lenA - 2) };
      notes.push('Hoje (dia parcial) ficou FORA dos dois lados — a comparação usa só dias fechados.');
      return { a, b, applied: 'closed_days', aligned: true, aIncludesToday, notes };
    }
    notes.push('A é só o dia de hoje (parcial) e esta tool não aceita hora de corte: B é um dia inteiro. Não conclua alta/queda por isto — use tool="aggregate_orders" (corta B na mesma hora) ou compare dias fechados.');
    return { a, b, applied: 'full', aligned: false, aIncludesToday, notes };
  }
  const aligned = !aIncludesToday && daysInclusive(b) === lenA;
  if (aIncludesToday) notes.push('A inclui hoje (parcial) e o alinhamento foi desligado (align=full): B está completo — a diferença mistura dia parcial com dia inteiro.');
  if (daysInclusive(b) !== lenA) notes.push(`A tem ${lenA} dia(s) e B tem ${daysInclusive(b)} — compare pelo perDayNormalized.`);
  return { a, b, applied: 'full', aligned, aIncludesToday, notes };
}

// ── Diff ─────────────────────────────────────────────────────────────────

export type LeafUnit = 'fraction' | 'percent' | 'usd' | 'count' | 'other';

export interface LeafDelta {
  a: number;
  b: number;
  delta: number;
  /** Variação relativa em PONTOS PERCENTUAIS (12.5 = +12.5%). null quando B = 0. */
  deltaPct: number | null;
  /** Só em taxas: diferença em pontos percentuais. */
  deltaPp?: number;
}

export type DeltaTree = { [key: string]: LeafDelta | DeltaTree };

// Nomes *Pct que são FRAÇÃO nos serviços (auditoria de unidades em
// tools.md §3): sem a exceção o deltaPp sairia 100× menor.
const FRACTION_PCT_KEYS = new Set([
  'upsellLiftPct', 'fulfillmentPctOfGross', 'totalPctOfGross', 'commissionPct', 'fePct', 'aovPct', 'revenuePct', 'dropPct', 'takePp',
]);

/** Unidade de um campo: mapa de unidades do resultado (_meta.units) primeiro, nome do campo como reserva. */
export function unitOf(key: string, path: string, units: Record<string, string> | null): LeafUnit {
  const raw = units?.[path] ?? units?.[key];
  if (raw) {
    const u = raw.toLowerCase();
    if (u === 'fraction' || u === 'fração' || u === 'fracao') return 'fraction';
    if (u === 'percent' || u === '%' || u === 'pp') return 'percent';
    if (u === 'usd') return 'usd';
    if (u === 'count') return 'count';
    return 'other';
  }
  if (FRACTION_PCT_KEYS.has(key)) return 'fraction';
  if (/(Rate|rate)$/.test(key) || ['share', 'pctCount', 'pctUsd'].includes(key)) return 'fraction';
  if (/(Pct|pct)$/.test(key)) return 'percent';
  return 'other';
}

function unitsMap(v: unknown): Record<string, string> | null {
  const o = v as { _meta?: { units?: unknown }; _units?: unknown } | null;
  const u = o?._meta?.units ?? o?._units;
  return u && typeof u === 'object' && !Array.isArray(u) ? (u as Record<string, string>) : null;
}

const SKIP_KEYS = new Set(['range', 'period', 'generatedAt', 'asOf', 'anchor']);
const r6 = (n: number) => cleanFloat(Math.round(n * 1e6) / 1e6);

function leafDelta(a: number, b: number, unit: LeafUnit): LeafDelta {
  const out: LeafDelta = { a, b, delta: r6(a - b), deltaPct: b === 0 ? null : r6((a / b - 1) * 100) };
  if (unit === 'fraction') out.deltaPp = r6((a - b) * 100);
  else if (unit === 'percent') out.deltaPp = r6(a - b);
  return out;
}

/** Folhas numéricas presentes nos dois lados (objetos, sem listas), até 4 níveis. */
export function diffLeaves(a: unknown, b: unknown, units: Record<string, string> | null, path = '', depth = 0): DeltaTree {
  const out: DeltaTree = {};
  if (depth > 4 || !a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) || Array.isArray(b)) return out;
  for (const [k, va] of Object.entries(a as Record<string, unknown>)) {
    if (k.startsWith('_') || SKIP_KEYS.has(k)) continue;
    if (!Object.prototype.hasOwnProperty.call(b, k)) continue;
    const vb = (b as Record<string, unknown>)[k];
    const p = path ? `${path}.${k}` : k;
    if (typeof va === 'number' && typeof vb === 'number' && Number.isFinite(va) && Number.isFinite(vb)) {
      out[k] = leafDelta(va, vb, unitOf(k, p, units));
    } else if (va && vb && typeof va === 'object' && typeof vb === 'object' && !Array.isArray(va) && !Array.isArray(vb)) {
      const sub = diffLeaves(va, vb, units, p, depth + 1);
      if (Object.keys(sub).length) out[k] = sub;
    }
  }
  return out;
}

// Séries temporais não casam por chave entre períodos diferentes (o dia 1
// de A não é o dia 1 de B) — ficam fora do diff por entidade.
const SERIES_KEYS = /^(daily|series|sparkline|hourlyHeatmap|cohorts|matrix|curve|evolution|windows|recent|history|notes)$/;

type Keyer = { name: string; key: (o: Record<string, unknown>) => string | null };
const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const KEYERS: Keyer[] = [
  { name: 'key', key: (o) => str(o.key) },
  { name: 'platformSlug:externalId', key: (o) => (o.platformSlug != null && o.externalId != null ? `${o.platformSlug}:${o.externalId}` : null) },
  { name: 'slug', key: (o) => str(o.slug) },
  { name: 'family', key: (o) => str(o.family) },
  { name: 'id', key: (o) => str(o.id) },
  { name: 'code', key: (o) => str(o.code) },
  { name: 'externalId', key: (o) => str(o.externalId) },
  { name: 'platform', key: (o) => str(o.platform) },
  { name: 'provider', key: (o) => str(o.provider) },
  { name: 'productType', key: (o) => str(o.productType) },
  { name: 'label', key: (o) => str(o.label) },
  { name: 'name', key: (o) => str(o.name) },
  // screenCards do get_overview (cards de reembolso e Net after CPA da tela):
  // sem chave, compare_periods(get_overview) só diffava kpis.refundRate — a
  // taxa por data da venda que NÃO é o card.
  { name: 'card', key: (o) => str(o.card) },
];
const METRIC_FIELDS = ['revenue', 'gross', 'grossUsd', 'totalRevenue', 'value', 'netUsd', 'profitUsd', 'net', 'orders', 'approvedOrders', 'sales', 'volume', 'count'];
const EXTRA_FIELDS = ['orders', 'approvedOrders', 'feOrders', 'aov', 'approvalRate', 'refundRate', 'cbRate', 'takeRate', 'cpaPerFe', 'netAfterCpaTotalUsd', 'volume', 'sales'];

function isObjArray(v: unknown): v is Array<Record<string, unknown>> {
  return Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === 'object' && !Array.isArray(x));
}

function pickKeyer(a: Array<Record<string, unknown>>, b: Array<Record<string, unknown>>): Keyer | null {
  for (const k of KEYERS) {
    const ok = (arr: Array<Record<string, unknown>>) => {
      const keys = arr.map(k.key).filter((x): x is string => x != null);
      return keys.length >= arr.length * 0.9 && new Set(keys).size === keys.length;
    };
    if (ok(a) && ok(b)) return k;
  }
  return null;
}

function labelOf(o: Record<string, unknown>): string | undefined {
  for (const f of ['nickname', 'displayName', 'label', 'name', 'family', 'slug']) {
    const v = o[f];
    if (typeof v === 'string' && v) return v;
  }
  return undefined;
}

export interface KeyedDiff {
  path: string;
  keyBy: string;
  metric: string;
  matched: number;
  onlyInACount: number;
  onlyInBCount: number;
  movers: Array<{ key: string; label?: string; a: number; b: number; delta: number; deltaPct: number | null; fields: Record<string, LeafDelta> }>;
  onlyInA: Array<{ key: string; label?: string; value: number }>;
  onlyInB: Array<{ key: string; label?: string; value: number }>;
}

function keyedDiff(path: string, a: Array<Record<string, unknown>>, b: Array<Record<string, unknown>>, top: number, units: Record<string, string> | null): KeyedDiff | null {
  const keyer = pickKeyer(a, b);
  if (!keyer) return null;
  const metric = METRIC_FIELDS.find((f) => a.some((o) => typeof o[f] === 'number') && b.some((o) => typeof o[f] === 'number'));
  if (!metric) return null;
  const mapB = new Map(b.map((o) => [keyer.key(o), o]));
  const mapA = new Map(a.map((o) => [keyer.key(o), o]));
  const val = (o: Record<string, unknown>) => (typeof o[metric] === 'number' ? (o[metric] as number) : 0);
  const movers: KeyedDiff['movers'] = [];
  const onlyInA: KeyedDiff['onlyInA'] = [];
  const onlyInB: KeyedDiff['onlyInB'] = [];
  for (const [k, oa] of mapA) {
    if (k == null) continue;
    const ob = mapB.get(k);
    if (!ob) { onlyInA.push({ key: k, label: labelOf(oa), value: val(oa) }); continue; }
    const fields: Record<string, LeafDelta> = {};
    for (const f of EXTRA_FIELDS) {
      if (f !== metric && typeof oa[f] === 'number' && typeof ob[f] === 'number') {
        fields[f] = leafDelta(oa[f] as number, ob[f] as number, unitOf(f, `${path}.${f}`, units));
      }
    }
    const d = leafDelta(val(oa), val(ob), 'other');
    movers.push({ key: k, label: labelOf(oa), a: d.a, b: d.b, delta: d.delta, deltaPct: d.deltaPct, fields });
  }
  for (const [k, ob] of mapB) if (k != null && !mapA.has(k)) onlyInB.push({ key: k, label: labelOf(ob), value: val(ob) });
  movers.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  onlyInA.sort((x, y) => y.value - x.value);
  onlyInB.sort((x, y) => y.value - x.value);
  return {
    path, keyBy: keyer.name, metric, matched: movers.length,
    onlyInACount: onlyInA.length, onlyInBCount: onlyInB.length,
    movers: movers.slice(0, top), onlyInA: onlyInA.slice(0, top), onlyInB: onlyInB.slice(0, top),
  };
}

/** Listas de entidades presentes nos dois lados (até 3 níveis de objeto). */
export function diffKeyedArrays(a: unknown, b: unknown, top: number, units: Record<string, string> | null, path = '', depth = 0): KeyedDiff[] {
  const out: KeyedDiff[] = [];
  if (depth > 3 || !a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) || Array.isArray(b)) return out;
  for (const [k, va] of Object.entries(a as Record<string, unknown>)) {
    if (k.startsWith('_') || SERIES_KEYS.test(k)) continue;
    const vb = (b as Record<string, unknown>)[k];
    const p = path ? `${path}.${k}` : k;
    if (isObjArray(va) && isObjArray(vb)) {
      const d = keyedDiff(p, va, vb, top, units);
      if (d) out.push(d);
    } else if (va && typeof va === 'object' && !Array.isArray(va)) {
      out.push(...diffKeyedArrays(va, vb, top, units, p, depth + 1));
    }
  }
  return out;
}

// Somas (e não médias/taxas): só essas fazem sentido "por dia" quando os
// períodos têm tamanhos diferentes.
const ADDITIVE = /^(gross|net|cpa|cogs|fulfillment|revenue|orders|sales|profit|cost|fees?|refund|chargeback|approved|total|bottles|spend|rows|real_orders|sessions|volume|commission)/i;
const NON_ADDITIVE = /(rate|pct|aov|avg|per|share|margin|ratio|epo|pp)/i;

export function perDay(tree: DeltaTree, lenA: number, lenB: number): Record<string, { a: number; b: number; deltaPct: number | null }> {
  const out: Record<string, { a: number; b: number; deltaPct: number | null }> = {};
  const walk = (t: DeltaTree, path: string, depth: number) => {
    for (const [k, v] of Object.entries(t)) {
      const p = path ? `${path}.${k}` : k;
      if ('delta' in v && typeof v.delta === 'number') {
        const leaf = v as LeafDelta;
        if (ADDITIVE.test(k) && !NON_ADDITIVE.test(k)) {
          const a = r6(leaf.a / lenA); const b = r6(leaf.b / lenB);
          out[p] = { a, b, deltaPct: b === 0 ? null : r6((a / b - 1) * 100) };
        }
      } else if (depth < 2) {
        walk(v as DeltaTree, p, depth + 1);
      }
    }
  };
  walk(tree, '', 0);
  return out;
}

// ── Decomposição volume × AOV (funnelTransition) ─────────────────────────

type TransitionOut = Omit<ReturnType<typeof funnelTransition>, 'note' | 'tone'>;

/** funnelTransition sem o texto (o `note` usa vírgula decimal; a resposta usa formato US). */
function transition(prev: FunnelScope, cur: FunnelScope): TransitionOut {
  const { note: _note, tone: _tone, ...rest } = funnelTransition(prev, cur, 0, 1);
  return rest;
}

interface FunnelLike { stages?: FunnelStage[]; summary?: FunnelSummary; byFamily?: Array<{ family: string; stages: FunnelStage[]; summary: FunnelSummary }> }

export function funnelDiff(a: FunnelLike, b: FunnelLike, top: number): { all: TransitionOut; byFamily: Array<{ family: string } & TransitionOut> } | null {
  if (!a.summary || !b.summary || !a.stages || !b.stages) return null;
  const all = transition({ stages: b.stages, summary: b.summary }, { stages: a.stages, summary: a.summary });
  const famB = new Map((b.byFamily ?? []).map((f) => [f.family, f]));
  const famA = new Map((a.byFamily ?? []).map((f) => [f.family, f]));
  const families = [...new Set([...famA.keys(), ...famB.keys()])];
  const empty: FunnelScope = { stages: [], summary: EMPTY_SUMMARY };
  const byFamily = families
    .map((family) => {
      const fa = famA.get(family); const fb = famB.get(family);
      return { family, ...transition(fb ? { stages: fb.stages, summary: fb.summary } : empty, fa ? { stages: fa.stages, summary: fa.summary } : empty) };
    })
    .sort((x, y) => Math.abs(y.revenueDelta) - Math.abs(x.revenueDelta))
    .slice(0, top);
  return { all, byFamily };
}

interface OverviewLike { kpis?: { orderGroups?: number; aov?: number } }

/** Receita das sessões com FE = sessões × AOV; Δ = efeito volume + efeito AOV. */
export function overviewDecomposition(a: OverviewLike, b: OverviewLike): (TransitionOut & { basis: string }) | null {
  const ka = a.kpis; const kb = b.kpis;
  if (ka?.orderGroups == null || ka.aov == null || kb?.orderGroups == null || kb.aov == null) return null;
  const scope = (sessions: number, aov: number): FunnelScope => ({
    stages: [],
    summary: { ...EMPTY_SUMMARY, feGroups: sessions, totalRevenue: Math.round(sessions * aov * 100) / 100, aov },
  });
  return {
    basis: 'receita das sessões com FE (orderGroups × AOV de sessão) — não é o gross da MV',
    ...transition(scope(kb.orderGroups, kb.aov), scope(ka.orderGroups, ka.aov)),
  };
}

export interface CompareDiff {
  deltas: DeltaTree;
  keyed: KeyedDiff[];
  perDayNormalized?: Record<string, { a: number; b: number; deltaPct: number | null }>;
  funnel?: ReturnType<typeof funnelDiff>;
  decomposition?: ReturnType<typeof overviewDecomposition>;
}

export function diffResults(tool: string, a: unknown, b: unknown, lenA: number, lenB: number, top: number): CompareDiff {
  const units = unitsMap(a) ?? unitsMap(b);
  const deltas = diffLeaves(a, b, units);
  const out: CompareDiff = { deltas, keyed: tool === 'get_funnel' ? [] : diffKeyedArrays(a, b, top, units) };
  if (lenA !== lenB) out.perDayNormalized = perDay(deltas, lenA, lenB);
  if (tool === 'get_funnel') {
    const f = funnelDiff(a as FunnelLike, b as FunnelLike, top);
    if (f) out.funnel = f;
  }
  if (tool === 'get_overview') {
    const d = overviewDecomposition(a as OverviewLike, b as OverviewLike);
    if (d) out.decomposition = d;
  }
  return out;
}

// ── A tool ───────────────────────────────────────────────────────────────

export const COMPARE_TOOLS = [
  'get_overview', 'get_platforms', 'get_affiliates', 'get_products', 'get_families', 'get_costs_overview',
  'get_profit_split', 'get_funnel', 'get_fulfillment', 'get_call_center', 'aggregate_orders',
] as const;

const FILTER_KEYS = ['platforms', 'families', 'countries', 'products', 'stages', 'affiliate_ids', 'provider', 'search'];
const AGG_KEYS = ['group_by', 'metrics', 'date_axis', 'status', 'order_by', 'dir', 'limit'];

function pickObject(raw: unknown, keys: string[], where: string): Record<string, unknown> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new PeriodInputError(`${where} deve ser um objeto`);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!keys.includes(k)) throw new PeriodInputError(`${where}.${k} não é aceito (use: ${keys.join(', ')})`);
    out[k] = v;
  }
  return out;
}

function periodArg(raw: unknown, name: string): BrtDays | undefined {
  if (raw === undefined || raw === null) return undefined;
  const r = raw as { start_date?: unknown; end_date?: unknown };
  const s = ymdArg(r.start_date, `${name}.start_date`);
  const e = ymdArg(r.end_date, `${name}.end_date`);
  if (!s || !e) throw new PeriodInputError(`${name} precisa de start_date e end_date`);
  if (e < s) throw new PeriodInputError(`${name}: end_date anterior a start_date`);
  return { start: s, end: e };
}

function isErrorResult(v: unknown): v is { error: string; message?: string } {
  return !!v && typeof v === 'object' && 'error' in (v as object) && !!(v as { error?: unknown }).error;
}

export async function runComparePeriods(input: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
  const tool = String(input.tool ?? '');
  if (!(COMPARE_TOOLS as readonly string[]).includes(tool)) {
    throw new PeriodInputError(`tool inválida — use ${COMPARE_TOOLS.join(', ')}`);
  }
  if (!ctx.exec) throw new Error('compare_periods precisa de ctx.exec');
  const now = ctx.now ?? new Date();
  const today = brtToday(now);
  const a = periodArg(input.a, 'a')
    ?? (ctx.defaultStart && ctx.defaultEnd
      ? { start: brtDayOf(ctx.defaultStart), end: brtDayOf(ctx.defaultEnd) }
      : { start: addDays(today, -29), end: today });
  const bRaw = input.b as { preset?: unknown } | undefined;
  let b: BrtDays;
  if (bRaw && typeof bRaw === 'object' && 'preset' in bRaw) {
    const preset = String(bRaw.preset) as BPreset;
    if (!['previous', 'previous_year', 'same_weekday_last_week'].includes(preset)) throw new PeriodInputError('b.preset inválido — use previous, previous_year ou same_weekday_last_week');
    b = periodB(a, preset);
  } else {
    b = periodArg(bRaw, 'b') ?? periodB(a, 'previous');
  }
  const align = (['auto', 'full', 'same_elapsed'].includes(String(input.align)) ? input.align : 'auto') as AlignMode;
  const top = Math.min(Math.max(Math.trunc(Number(input.top) || 20), 1), 100);
  const filters = pickObject(input.filters, FILTER_KEYS, 'filters');
  // Filtro que a tool alvo não aceita seria ignorado CALADO (get_profit_split
  // sem SKU/etapa, get_call_center sem plataforma…) e a comparação do TOTAL
  // sairia dita como "filtrada" — recusa dizendo o que vale pra ela.
  const TOOL_FILTERS: Record<string, readonly string[]> = {
    get_overview: ['platforms', 'countries', 'families', 'products', 'stages', 'affiliate_ids'],
    get_platforms: ['platforms', 'countries', 'families', 'products', 'stages', 'affiliate_ids'],
    get_products: ['platforms', 'countries', 'families', 'products', 'stages', 'affiliate_ids'],
    get_costs_overview: ['platforms', 'countries', 'families', 'products', 'stages', 'affiliate_ids'],
    aggregate_orders: ['platforms', 'countries', 'families', 'products', 'stages', 'affiliate_ids'],
    get_affiliates: ['platforms', 'countries', 'families', 'products', 'affiliate_ids', 'search'],
    get_funnel: ['platforms', 'countries', 'families', 'products', 'affiliate_ids'],
    get_families: ['platforms', 'countries', 'families', 'affiliate_ids'],
    get_profit_split: ['platforms', 'countries', 'families', 'affiliate_ids'],
    get_fulfillment: ['platforms', 'countries', 'families', 'affiliate_ids'],
    get_call_center: ['provider'],
  };
  const accepted = TOOL_FILTERS[tool] ?? FILTER_KEYS;
  const ignored = Object.keys(filters).filter((k) => !accepted.includes(k));
  if (ignored.length) {
    throw new PeriodInputError(`filters.${ignored.join(', filters.')} não se aplica a tool=${tool} (aceita: ${accepted.join(', ')})`);
  }
  const aggregate = tool === 'aggregate_orders' ? pickObject(input.aggregate, AGG_KEYS, 'aggregate') : {};
  if (tool !== 'aggregate_orders' && input.aggregate !== undefined) throw new PeriodInputError('aggregate só vale com tool="aggregate_orders"');

  const plan = planPeriods(a, b, align, now, tool === 'aggregate_orders');
  const call = (p: PeriodPlan['a']) => ({
    ...filters,
    ...aggregate,
    start_date: p.start,
    end_date: p.end,
    ...(p.endTime ? { end_time: p.endTime } : {}),
    ...(tool === 'get_overview' ? { compare: false } : {}),
  });
  const inputA = call(plan.a);
  const inputB = call(plan.b);
  const [va, vb] = await Promise.all([ctx.exec(tool, inputA), ctx.exec(tool, inputB)]);
  if (isErrorResult(va)) return { error: va.error, message: `período A: ${va.message ?? va.error}` };
  if (isErrorResult(vb)) return { error: vb.error, message: `período B: ${vb.message ?? vb.error}` };

  // Os dois resultados completos ficam no store: aggregate_result/calc
  // alcançam as listas inteiras de A e B na próxima rodada.
  const refA = ctx.results?.put(tool, inputA, va);
  const refB = ctx.results?.put(tool, inputB, vb);
  const lenA = daysInclusive(plan.a);
  const lenB = daysInclusive(plan.b);
  const diff = diffResults(tool, va, vb, lenA, lenB, top);
  const side = (p: PeriodPlan['a'], len: number, ref?: string) => ({
    start_date: p.start, end_date: p.end, ...(p.endTime ? { end_time: p.endTime } : {}), days: len,
    includesToday: p.end === today, ...(ref ? { ref } : {}),
  });
  return {
    tool,
    align: { requested: align, applied: plan.applied, aligned: plan.aligned },
    a: side(plan.a, lenA, refA),
    b: side(plan.b, lenB, refB),
    notes: plan.notes,
    howToRead: 'delta = A − B; deltaPct = variação relativa em pontos percentuais; deltaPp = diferença de taxas em pontos percentuais. EXCEÇÃO — em funnel e decomposition (volume × AOV) os campos fePct, aovPct, revenuePct, takeRate, prevTakeRate, takePp, lift e prevLift estão em FRAÇÃO (0.05 = 5% / +5 pp). A e B completos ficam nas refs indicadas (use aggregate_result/calc).',
    ...diff,
  };
}
