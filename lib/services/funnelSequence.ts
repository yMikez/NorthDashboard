// Funil em SEQUÊNCIA de janelas (Janela 1..K de N dias até uma data):
// roda o MESMO getFunnel da aba por janela (números idênticos), e explica
// a variação entre janelas — receita decomposta em volume de FEs × AOV de
// sessão, e o estágio (UP1/UP2/DW…) cuja take rate mais mexeu, com o efeito
// em $ a ticket constante. Texto por regras, como na Análise de afiliados.

import { getFunnel, type FunnelResponse, type FunnelStage, type FunnelSummary, type MetricsFilters } from './metrics';
import { brtDayStart } from './affiliateAnalysis';
import { sequenceRanges } from './affiliateSequenceCore';
import { pctDelta, round2, round4 } from './affiliateAnalysisCore';

const DAY_MS = 86_400_000;
const BRT_OFFSET_MS = 3 * 3600 * 1000;
const brtDateStr = (d: Date) => new Date(d.getTime() - BRT_OFFSET_MS).toISOString().slice(0, 10);

export interface FunnelSequenceOptions {
  window: number;
  count: number;
  anchor?: string;
  includeToday?: boolean;
  platformSlugs?: string[];
  countries?: string[];
  productExternalIds?: string[];
  productFamilies?: string[];
  now?: Date;
}

export interface FunnelScope { stages: FunnelStage[]; summary: FunnelSummary }

export interface FunnelSeqWindow {
  index: number;
  label: string;
  start: string;
  end: string;
  all: FunnelScope;
  byFamily: Record<string, FunnelScope>;
}

export interface StageDelta {
  id: string;
  label: string;
  volume: number; prevVolume: number;
  takeRate: number; prevTakeRate: number;
  takePp: number;                 // fração (0.05 = +5pp)
  revenue: number; prevRevenue: number;
  revenueDelta: number;
  /** Efeito em $ da mudança de take rate, a ticket e volume de FE constantes (janela atual). */
  takeEffectUsd: number;
}

export interface FunnelTransition {
  from: number;
  to: number;
  feGroups: number; prevFeGroups: number; fePct: number | null;
  aov: number; prevAov: number; aovPct: number | null;
  aovFEOnly: number; prevAovFEOnly: number;
  lift: number; prevLift: number;
  revenue: number; prevRevenue: number; revenueDelta: number; revenuePct: number | null;
  volumeEffect: number;
  aovEffect: number;
  stages: StageDelta[];
  topStage: StageDelta | null;
  tone: 'pos' | 'neg' | 'neutral';
  note: string;
}

export interface FunnelWindowNote { index: number; tone: 'pos' | 'neg' | 'neutral'; title: string; text: string }

export interface FunnelScopeAnalysis { transitions: FunnelTransition[]; notes: FunnelWindowNote[] }

export interface FunnelSequenceResponse {
  asOf: string;
  window: number;
  count: number;
  anchor: string;
  windows: FunnelSeqWindow[];
  families: string[];
  scopes: Record<string, FunnelScopeAnalysis>; // 'all' + uma por família
}

const usd0 = (n: number) => (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
const pct1 = (f: number) => (Math.abs(f) * 100).toFixed(1).replace('.', ',') + '%';
const signed = (f: number) => (f >= 0 ? '+' : '−') + pct1(f);
const pp = (f: number) => (f >= 0 ? '+' : '−') + (Math.abs(f) * 100).toFixed(1).replace('.', ',') + ' pp';

export const EMPTY_SUMMARY: FunnelSummary = { feGroups: 0, totalGroups: 0, totalRevenue: 0, aov: 0, aovFEOnly: 0, aovWithUpsell: 0, revenueLiftFromUpsells: 0, revenueFeSessions: 0 };

function isBackend(stage: FunnelStage): boolean {
  return !/^(fe|frontend|front)$/i.test(stage.id) && !/^front/i.test(stage.label);
}

/** Transição entre duas janelas de um escopo (global ou família). Pura. */
export function funnelTransition(prev: FunnelScope, cur: FunnelScope, from: number, to: number): FunnelTransition {
  const p = prev.summary; const c = cur.summary;
  const revenueDelta = round2(c.totalRevenue - p.totalRevenue);
  const both = p.feGroups > 0 && c.feGroups > 0;
  const aovPrev = p.feGroups > 0 ? p.totalRevenue / p.feGroups : 0;
  const aovCur = c.feGroups > 0 ? c.totalRevenue / c.feGroups : 0;
  const volumeEffect = both ? round2((c.feGroups - p.feGroups) * aovPrev) : revenueDelta;
  const aovEffect = both ? round2(revenueDelta - volumeEffect) : 0;
  const prevById = new Map(prev.stages.map((s) => [s.id, s]));
  const stages: StageDelta[] = cur.stages.filter(isBackend).map((s) => {
    const q = prevById.get(s.id);
    const prevTake = q?.takeRate ?? 0;
    const ticket = s.volume > 0 ? s.revenue / s.volume : (q && q.volume > 0 ? q.revenue / q.volume : 0);
    return {
      id: s.id, label: s.label,
      volume: s.volume, prevVolume: q?.volume ?? 0,
      takeRate: s.takeRate, prevTakeRate: prevTake, takePp: round4(s.takeRate - prevTake),
      revenue: round2(s.revenue), prevRevenue: round2(q?.revenue ?? 0), revenueDelta: round2(s.revenue - (q?.revenue ?? 0)),
      takeEffectUsd: round2((s.takeRate - prevTake) * c.feGroups * ticket),
    };
  });
  const moved = stages.filter((s) => Math.abs(s.takePp) >= 0.02).sort((a, b) => Math.abs(b.takeEffectUsd) - Math.abs(a.takeEffectUsd));
  const topStage = moved[0] ?? null;
  const revenuePct = pctDelta(c.totalRevenue, p.totalRevenue);
  const tone: FunnelTransition['tone'] = revenuePct == null ? 'neutral' : revenuePct >= 0.1 ? 'pos' : revenuePct <= -0.1 ? 'neg' : 'neutral';

  let note: string;
  if (!both) {
    note = p.feGroups === 0 && c.feGroups > 0
      ? `Primeira janela com vendas: ${c.feGroups} FEs, AOV de sessão ${usd0(aovCur)}${c.aovFEOnly > 0 ? `, lift de upsells ${signed(c.revenueLiftFromUpsells)}` : ''}.`
      : c.feGroups === 0 ? 'Sem vendas de front nesta janela.' : 'Sem base pra comparar.';
  } else {
    const head = `Receita ${revenueDelta >= 0 ? 'subiu' : 'caiu'} ${pct1(revenuePct ?? 0)} (${usd0(p.totalRevenue)} → ${usd0(c.totalRevenue)}).`;
    const volDominant = Math.abs(volumeEffect) >= Math.abs(aovEffect);
    const volTxt = `volume de FEs ${p.feGroups} → ${c.feGroups} (${signed(pctDelta(c.feGroups, p.feGroups) ?? 0)}, efeito ${usd0(volumeEffect)})`;
    const aovTxt = `AOV de sessão ${usd0(aovPrev)} → ${usd0(aovCur)} (${signed(pctDelta(aovCur, aovPrev) ?? 0)}, efeito ${usd0(aovEffect)})`;
    const stageTxt = topStage
      ? ` O estágio que mais mexeu foi ${topStage.label}: take rate ${pct1(topStage.prevTakeRate)} → ${pct1(topStage.takeRate)} (${pp(topStage.takePp)}, ${usd0(topStage.takeEffectUsd)} a ticket constante).`
      : ' Take rates por estágio estáveis (nenhuma mudou 2 pp ou mais).';
    const liftTxt = Math.abs(c.revenueLiftFromUpsells - p.revenueLiftFromUpsells) >= 0.03
      ? ` Lift de upsells ${signed(p.revenueLiftFromUpsells)} → ${signed(c.revenueLiftFromUpsells)}.`
      : '';
    const feTicket = Math.abs(c.aovFEOnly - p.aovFEOnly) / Math.max(p.aovFEOnly, 1) >= 0.05
      ? ` Ticket do front ${usd0(p.aovFEOnly)} → ${usd0(c.aovFEOnly)}.`
      : '';
    note = volDominant
      ? `${head} Puxada pelo ${volTxt}; ${aovTxt}.${stageTxt}${liftTxt}${feTicket}`
      : `${head} Puxada pelo ${aovTxt}; ${volTxt}.${stageTxt}${liftTxt}${feTicket}`;
  }
  return {
    from, to,
    feGroups: c.feGroups, prevFeGroups: p.feGroups, fePct: pctDelta(c.feGroups, p.feGroups),
    aov: round2(aovCur), prevAov: round2(aovPrev), aovPct: pctDelta(aovCur, aovPrev),
    aovFEOnly: round2(c.aovFEOnly), prevAovFEOnly: round2(p.aovFEOnly),
    lift: round4(c.revenueLiftFromUpsells), prevLift: round4(p.revenueLiftFromUpsells),
    revenue: round2(c.totalRevenue), prevRevenue: round2(p.totalRevenue), revenueDelta, revenuePct,
    volumeEffect, aovEffect, stages, topStage, tone, note,
  };
}

/** Nota da janela i (ponto de partida ou leitura da transição que chega nela). Pura. */
export function funnelWindowNote(i: number, scopes: FunnelScope[], transitions: FunnelTransition[]): FunnelWindowNote {
  const s = scopes[i].summary;
  const takeList = scopes[i].stages.filter(isBackend).map((st) => `${st.label} ${pct1(st.takeRate)}`).join(' · ');
  if (s.feGroups === 0) return { index: i, tone: 'neutral', title: '■ Sem vendas de front', text: 'Nenhuma FE nesta janela.' };
  const tr = transitions.find((t) => t.to === i);
  if (!tr || tr.prevFeGroups === 0) {
    return {
      index: i, tone: 'neutral',
      title: tr ? '▲ Início da série' : 'Ponto de partida',
      text: `${s.feGroups} FEs, ${usd0(s.totalRevenue)} de receita, AOV de sessão ${usd0(s.aov)} (só front ${usd0(s.aovFEOnly)}, lift ${signed(s.revenueLiftFromUpsells)}).${takeList ? ` Take rates: ${takeList}.` : ''}`,
    };
  }
  const title = tr.tone === 'pos'
    ? (Math.abs(tr.volumeEffect) >= Math.abs(tr.aovEffect) ? '▲ Cresceu no volume de FEs' : '▲ Cresceu no AOV de sessão')
    : tr.tone === 'neg'
      ? (Math.abs(tr.volumeEffect) >= Math.abs(tr.aovEffect) ? '▼ Caiu no volume de FEs' : '▼ Caiu no AOV de sessão')
      : '■ Estável';
  return { index: i, tone: tr.tone, title, text: tr.note };
}

function resolveLastDay(opts: FunnelSequenceOptions): Date {
  const now = opts.now ?? new Date();
  const todayStart = brtDayStart(now);
  if (opts.anchor) {
    const t = Date.parse(opts.anchor + 'T00:00:00Z');
    if (!Number.isNaN(t)) {
      const a = new Date(t + BRT_OFFSET_MS);
      if (a.getTime() <= todayStart.getTime()) return a;
    }
  }
  return opts.includeToday ? todayStart : new Date(todayStart.getTime() - DAY_MS);
}

export async function getFunnelSequence(opts: FunnelSequenceOptions): Promise<FunnelSequenceResponse> {
  const count = Math.min(Math.max(Math.trunc(opts.count) || 3, 2), 8);
  const window = Math.min(Math.max(Math.trunc(opts.window) || 7, 1), 90);
  const lastDayStart = resolveLastDay(opts);
  const total = count * window;
  const coverageStart = new Date(lastDayStart.getTime() - (total - 1) * DAY_MS);
  const ranges = sequenceRanges(window, count, total - 1);
  const base: Omit<MetricsFilters, 'startDate' | 'endDate'> = {
    platformSlugs: opts.platformSlugs, countries: opts.countries,
    productExternalIds: opts.productExternalIds, productFamilies: opts.productFamilies,
  };
  const results: FunnelResponse[] = await Promise.all(ranges.map((r) =>
    getFunnel({
      ...base,
      startDate: new Date(coverageStart.getTime() + r.from * DAY_MS),
      endDate: new Date(coverageStart.getTime() + (r.to + 1) * DAY_MS - 1),
    }),
  ));
  const windows: FunnelSeqWindow[] = results.map((res, i) => ({
    index: i,
    label: `Janela ${i + 1}`,
    start: brtDateStr(new Date(coverageStart.getTime() + ranges[i].from * DAY_MS)),
    end: brtDateStr(new Date(coverageStart.getTime() + ranges[i].to * DAY_MS)),
    all: { stages: res.stages, summary: res.summary },
    byFamily: Object.fromEntries(res.byFamily.map((f) => [f.family, { stages: f.stages, summary: f.summary }])),
  }));
  const families = [...new Set(windows.flatMap((w) => Object.keys(w.byFamily)))].sort();
  const analyze = (pick: (w: FunnelSeqWindow) => FunnelScope): FunnelScopeAnalysis => {
    const scopes = windows.map(pick);
    const transitions: FunnelTransition[] = [];
    for (let i = 1; i < scopes.length; i++) transitions.push(funnelTransition(scopes[i - 1], scopes[i], i - 1, i));
    return { transitions, notes: scopes.map((_, i) => funnelWindowNote(i, scopes, transitions)) };
  };
  const scopes: Record<string, FunnelScopeAnalysis> = { all: analyze((w) => w.all) };
  for (const fam of families) scopes[fam] = analyze((w) => w.byFamily[fam] ?? { stages: [], summary: EMPTY_SUMMARY });
  return {
    asOf: (opts.now ?? new Date()).toISOString(),
    window, count, anchor: brtDateStr(lastDayStart), windows, families, scopes,
  };
}
