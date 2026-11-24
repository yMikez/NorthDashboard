// Briefing da IA (topo da Visão geral) — regras puras.
//
// O dash calcula TODOS os números (mesmas fontes da Visão geral); a IA só
// escreve o texto em cima do pacote pronto, com os valores já formatados —
// ela não soma, não arredonda, não inventa.
//
// Janelas: os últimos 7 dias FECHADOS (até ontem, Brasília) contra os 7
// anteriores. Dia em andamento fica fora: hoje parcial contra dias cheios
// faria toda manhã parecer queda (mesma regra da Análise de afiliados).

export const DAY_MS = 86_400_000;
const BRT_MS = 3 * 3_600_000;

export interface BriefingWindows {
  cur: { start: Date; end: Date; from: string; to: string };
  prev: { start: Date; end: Date; from: string; to: string };
}

const ymd = (d: Date) => new Date(d.getTime() - BRT_MS).toISOString().slice(0, 10);

export function briefingWindows(now: Date, days = 7): BriefingWindows {
  const shifted = new Date(now.getTime() - BRT_MS);
  const todayStart = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) + BRT_MS);
  const curEnd = new Date(todayStart.getTime() - 1);
  const curStart = new Date(todayStart.getTime() - days * DAY_MS);
  const prevEnd = new Date(curStart.getTime() - 1);
  const prevStart = new Date(curStart.getTime() - days * DAY_MS);
  return {
    cur: { start: curStart, end: curEnd, from: ymd(curStart), to: ymd(curEnd) },
    prev: { start: prevStart, end: prevEnd, from: ymd(prevStart), to: ymd(prevEnd) },
  };
}

export type MetricKey = 'faturamento' | 'pedidos' | 'aov' | 'net_after_cpa' | 'aprovacao' | 'reembolso' | 'chargeback';
export type MetricFormat = 'money' | 'money2' | 'int' | 'pct';

export interface MetricPair {
  key: MetricKey;
  label: string;
  format: MetricFormat;
  /** higher = subir é bom; lower = subir é ruim (reembolso, chargeback). */
  better: 'higher' | 'lower';
  cur: number;
  prev: number;
  /** Variação relativa (0.12 = +12%); null sem base. Taxas: em pontos (0.004 = +0,4 pp). */
  delta: number | null;
  deltaKind: 'rel' | 'pp';
  /** true = melhorou, false = piorou, null = estável/sem base. */
  good: boolean | null;
  curFmt: string;
  prevFmt: string;
  deltaFmt: string;
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export function fmtValue(v: number, f: MetricFormat): string {
  if (f === 'pct') return `${(v * 100).toFixed(1)}%`;
  if (f === 'int') return Math.round(v).toLocaleString('en-US');
  const digits = f === 'money2' ? 2 : 0;
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${v < 0 ? '-' : ''}$${s}`;
}

export function metricPair(
  key: MetricKey, label: string, format: MetricFormat, better: 'higher' | 'lower', cur: number, prev: number,
): MetricPair {
  const pct = format === 'pct';
  let delta: number | null;
  if (pct) delta = round(cur - prev, 4);
  else delta = prev ? round((cur - prev) / Math.abs(prev), 4) : null;
  // Estável: |Δ| < 0,5% (ou < 0,1 pp em taxa).
  const flat = delta == null || (pct ? Math.abs(delta) < 0.001 : Math.abs(delta) < 0.005);
  const good = flat ? null : better === 'higher' ? (delta as number) > 0 : (delta as number) < 0;
  const deltaFmt = delta == null
    ? (cur ? 'novo' : '—')
    : pct
      ? `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)} pp`
      : `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}%`;
  return {
    key, label, format, better, cur: round(cur, 4), prev: round(prev, 4), delta, deltaKind: pct ? 'pp' : 'rel', good,
    curFmt: fmtValue(cur, format), prevFmt: fmtValue(prev, format), deltaFmt,
  };
}

export interface MoverRow { dimension: 'família' | 'plataforma' | 'afiliado'; name: string; cur: number; prev: number }
export interface Mover extends MoverRow { delta: number; deltaFmt: string; curFmt: string; prevFmt: string }

/**
 * Maiores altas e quedas de faturamento (família, plataforma, afiliado).
 * Piso de relevância: |Δ| ≥ max(US$ 300, 1,5% do faturamento da janela) —
 * abaixo disso é ruído de dia a dia.
 */
export function topMovers(rows: MoverRow[], totalCur: number, n = 3): { up: Mover[]; down: Mover[] } {
  const floor = Math.max(300, totalCur * 0.015);
  const all = rows
    .map((r) => ({ ...r, cur: round(r.cur), prev: round(r.prev), delta: round(r.cur - r.prev) }))
    .filter((r) => Math.abs(r.delta) >= floor)
    .map((r) => ({
      ...r,
      deltaFmt: `${r.delta >= 0 ? '+' : '-'}${fmtValue(Math.abs(r.delta), 'money')}`,
      curFmt: fmtValue(r.cur, 'money'), prevFmt: fmtValue(r.prev, 'money'),
    }));
  return {
    up: all.filter((r) => r.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, n),
    down: all.filter((r) => r.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, n),
  };
}

export interface DayPoint { date: string; cur: number; prev: number }

/** Melhor e pior dia da janela atual (por faturamento). */
export function extremes(series: DayPoint[]): { best: DayPoint | null; worst: DayPoint | null } {
  if (!series.length) return { best: null, worst: null };
  const sorted = [...series].sort((a, b) => b.cur - a.cur);
  return { best: sorted[0], worst: sorted[sorted.length - 1] };
}

/** Saudação pelo horário de Brasília. */
export function greetingFor(now: Date): 'Bom dia' | 'Boa tarde' | 'Boa noite' {
  const h = new Date(now.getTime() - BRT_MS).getUTCHours();
  if (h >= 5 && h < 12) return 'Bom dia';
  if (h >= 12 && h < 18) return 'Boa tarde';
  return 'Boa noite';
}
