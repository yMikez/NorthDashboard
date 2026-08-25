// Núcleo PURO da Análise de afiliados (sem DB): agregação de buckets
// diários em janelas, métricas do modelo CPA, fusão de contas num parceiro,
// tag de tendência e "drivers" (por que subiu/caiu).
//
// Convenções:
//   - "vendas" = pedidos APROVADOS (todas as etapas), como no ranking HTML
//     do usuário; "FEs" = fronts aprovados (denominador do AOV e do CPA).
//   - AOV = receita ÷ FEs aprovadas (mesma fórmula da aba Afiliados).
//   - refund/aprovação sobre pedidos REAIS (Digistore: linha de estorno é
//     extra, não venda — realOrderCount em profitModel).
//   - CPA negociado = último cpaPaidUsd de FE aprovada DENTRO da janela
//     (paridade com a aba Afiliados: sem venda com CPA na janela → sem CPA).
//   - Δreceita = efeito VOLUME + efeito AOV, decomposição EXATA:
//       cur.rev − prev.rev = (cur.fe − prev.fe)·prev.aov + cur.fe·(cur.aov − prev.aov)
//     (só quando as duas janelas têm FE; senão o Δ inteiro vai pra "volume").

import { netAovUsd, cpaStatus, realOrderCount, type CpaStatus, type ProfitThresholds } from './profitModel';

export const WINDOWS = [3, 7, 15, 30, 60] as const;
export type WindowDays = (typeof WINDOWS)[number];
export const COVERAGE_DAYS = 121; // 2 × 60 dias completos + hoje

export function isWindowDays(n: unknown): n is WindowDays {
  return typeof n === 'number' && (WINDOWS as readonly number[]).includes(n);
}

export interface Bucket {
  allOrders: number;
  approved: number;
  refunds: number;
  chargebacks: number;
  revenue: number;        // gross APPROVED
  net: number;            // net (todas as linhas)
  cpa: number;            // cpaPaidUsd somado
  feApproved: number;
  feAll: number;
  backendApproved: number; // UPSELL/DOWNSELL/BUMP aprovados
  feRevenue: number;
  backendRevenue: number;
}

export const ZERO_BUCKET: Bucket = {
  allOrders: 0, approved: 0, refunds: 0, chargebacks: 0, revenue: 0, net: 0, cpa: 0,
  feApproved: 0, feAll: 0, backendApproved: 0, feRevenue: 0, backendRevenue: 0,
};

export function addBucket(a: Bucket, b: Bucket): Bucket {
  return {
    allOrders: a.allOrders + b.allOrders,
    approved: a.approved + b.approved,
    refunds: a.refunds + b.refunds,
    chargebacks: a.chargebacks + b.chargebacks,
    revenue: a.revenue + b.revenue,
    net: a.net + b.net,
    cpa: a.cpa + b.cpa,
    feApproved: a.feApproved + b.feApproved,
    feAll: a.feAll + b.feAll,
    backendApproved: a.backendApproved + b.backendApproved,
    feRevenue: a.feRevenue + b.feRevenue,
    backendRevenue: a.backendRevenue + b.backendRevenue,
  };
}

export interface WindowRange { from: number; to: number } // índices de dia, inclusivos

/** Janela atual e anterior (mesmo tamanho) terminando em `lastIdx`. */
export function windowRanges(days: WindowDays, lastIdx: number): { cur: WindowRange; prev: WindowRange } {
  const cur = { from: lastIdx - days + 1, to: lastIdx };
  const prev = { from: cur.from - days, to: cur.from - 1 };
  return { cur, prev };
}

export function sumRange(dayMap: Map<number, Bucket>, r: WindowRange): { bucket: Bucket; activeDays: number; daily: number[] } {
  let bucket = ZERO_BUCKET;
  let activeDays = 0;
  const daily: number[] = [];
  for (let d = r.from; d <= r.to; d++) {
    const b = dayMap.get(d);
    if (b) {
      bucket = addBucket(bucket, b);
      if (b.approved > 0) activeDays++;
      daily.push(round2(b.revenue));
    } else {
      daily.push(0);
    }
  }
  return { bucket, activeDays, daily };
}

/** Último CPA negociado DENTRO da janela (0 = nenhuma FE com CPA na janela). */
export function latestCpaInRange(cpaByDay: Map<number, number>, r: WindowRange): number {
  let best = 0;
  let bestDay = -1;
  for (const [d, v] of cpaByDay) {
    if (d >= r.from && d <= r.to && d > bestDay) { bestDay = d; best = v; }
  }
  return best;
}

export interface RateInputs {
  slug: string;
  feePct: number;
  refundCbPct: number;
  opexPct: number;
  thresholds: ProfitThresholds;
}

export interface WindowMetrics {
  sales: number;          // pedidos aprovados
  feApproved: number;
  realOrders: number;
  revenue: number;
  net: number;
  aov: number;            // receita ÷ FEs
  feTicket: number;       // receita FE ÷ FEs
  backendPerFe: number;   // receita back ÷ FEs
  backendTakeRate: number; // backends aprovados ÷ FEs
  approvalRate: number;
  refundRate: number;
  cbRate: number;
  refunds: number;
  chargebacks: number;
  cpaPaid: number;
  cpaPerFe: number;       // CPA negociado (último na janela); 0 = desconhecido
  netAov: number;
  netAfterCpa: number | null;
  netAfterCpaTotal: number | null;
  cpaStatus: CpaStatus | null;
  activeDays: number;
  days: number;
}

export function round2(n: number): number { return Math.round(n * 100) / 100; }
export function round4(n: number): number { return Math.round(n * 10000) / 10000; }

export function metricsFor(bucket: Bucket, activeDays: number, days: number, cpaPerFe: number, rates: RateInputs): WindowMetrics {
  const realOrders = realOrderCount(rates.slug, bucket.allOrders, bucket.refunds, bucket.chargebacks);
  const denom = realOrders || 1;
  const fe = bucket.feApproved;
  const aov = fe > 0 ? bucket.revenue / fe : 0;
  const netAov = netAovUsd(aov, { feePct: rates.feePct, refundCbPct: rates.refundCbPct, opexPct: rates.opexPct });
  const cpaVal = round2(cpaPerFe);
  const nAfter = cpaVal > 0 && fe > 0 ? round2(netAov - cpaVal) : null;
  return {
    sales: bucket.approved,
    feApproved: fe,
    realOrders,
    revenue: round2(bucket.revenue),
    net: round2(bucket.net),
    aov: round2(aov),
    feTicket: fe > 0 ? round2(bucket.feRevenue / fe) : 0,
    backendPerFe: fe > 0 ? round2(bucket.backendRevenue / fe) : 0,
    backendTakeRate: fe > 0 ? round4(bucket.backendApproved / fe) : 0,
    approvalRate: realOrders ? round4(bucket.approved / denom) : 0,
    refundRate: realOrders ? round4(bucket.refunds / denom) : 0,
    cbRate: realOrders ? round4(bucket.chargebacks / denom) : 0,
    refunds: bucket.refunds,
    chargebacks: bucket.chargebacks,
    cpaPaid: round2(bucket.cpa),
    cpaPerFe: cpaVal,
    netAov,
    netAfterCpa: nAfter,
    netAfterCpaTotal: nAfter != null ? round2(nAfter * fe) : null,
    cpaStatus: nAfter != null ? cpaStatus(nAfter, rates.thresholds) : null,
    activeDays,
    days,
  };
}

/**
 * Métricas de um PARCEIRO = contas somadas. Taxas re-derivadas dos totais;
 * NET AOV ponderado por FEs; CPA/venda ponderado SÓ pelas FEs das contas
 * com CPA conhecido (senão uma conta revshare diluía o CPA); NET AFTER CPA
 * total = soma dos totais das contas (cada uma com a fee/refund da própria
 * plataforma), e por FE = total ÷ FEs com CPA — as duas contas fecham.
 */
export function mergeMetrics(parts: WindowMetrics[], thresholds: ProfitThresholds): WindowMetrics {
  if (parts.length === 1) return parts[0];
  const sum = (f: (m: WindowMetrics) => number) => parts.reduce((n, m) => n + f(m), 0);
  const fe = sum((m) => m.feApproved);
  const realOrders = sum((m) => m.realOrders);
  const denom = realOrders || 1;
  const revenue = sum((m) => m.revenue);
  const withCpa = parts.filter((m) => m.netAfterCpaTotal != null);
  const feWithCpa = withCpa.reduce((n, m) => n + m.feApproved, 0);
  const nAfterTotal = withCpa.length ? round2(withCpa.reduce((n, m) => n + (m.netAfterCpaTotal ?? 0), 0)) : null;
  const nAfter = nAfterTotal != null && feWithCpa > 0 ? round2(nAfterTotal / feWithCpa) : null;
  const wavg = (f: (m: WindowMetrics) => number) => (fe > 0 ? round2(parts.reduce((n, m) => n + f(m) * m.feApproved, 0) / fe) : 0);
  return {
    sales: sum((m) => m.sales),
    feApproved: fe,
    realOrders,
    revenue: round2(revenue),
    net: round2(sum((m) => m.net)),
    aov: fe > 0 ? round2(revenue / fe) : 0,
    feTicket: wavg((m) => m.feTicket),
    backendPerFe: wavg((m) => m.backendPerFe),
    backendTakeRate: fe > 0 ? round4(parts.reduce((n, m) => n + m.backendTakeRate * m.feApproved, 0) / fe) : 0,
    approvalRate: realOrders ? round4(sum((m) => m.sales) / denom) : 0,
    refundRate: realOrders ? round4(sum((m) => m.refunds) / denom) : 0,
    cbRate: realOrders ? round4(sum((m) => m.chargebacks) / denom) : 0,
    refunds: sum((m) => m.refunds),
    chargebacks: sum((m) => m.chargebacks),
    cpaPaid: round2(sum((m) => m.cpaPaid)),
    cpaPerFe: feWithCpa > 0 ? round2(withCpa.reduce((n, m) => n + m.cpaPerFe * m.feApproved, 0) / feWithCpa) : 0,
    netAov: wavg((m) => m.netAov),
    netAfterCpa: nAfter,
    netAfterCpaTotal: nAfterTotal,
    cpaStatus: nAfter != null ? cpaStatus(nAfter, thresholds) : null,
    activeDays: Math.max(...parts.map((m) => m.activeDays)),
    days: parts[0].days,
  };
}

/** Variação relativa; null quando não há base (prev = 0). */
export function pctDelta(cur: number, prev: number): number | null {
  if (!prev) return null;
  return round4((cur - prev) / Math.abs(prev));
}

export type TrendTag = 'novo' | 'churn' | 'breakout' | 'crescimento' | 'estavel' | 'volatil' | 'queda' | 'queda_forte';

export const TREND_LABELS: Record<TrendTag, string> = {
  novo: 'Novo entrante', churn: 'Saiu do radar', breakout: 'Breakout', crescimento: 'Crescimento',
  estavel: 'Estável', volatil: 'Volátil', queda: 'Queda', queda_forte: 'Queda forte',
};

export function trendTag(cur: WindowMetrics, prev: WindowMetrics, dailyCur: number[]): TrendTag {
  if (prev.revenue <= 0 && cur.revenue > 0) return 'novo';
  if (cur.revenue <= 0 && prev.revenue > 0) return 'churn';
  const d = pctDelta(cur.revenue, prev.revenue) ?? 0;
  if (d >= 2) return 'breakout';
  if (d >= 0.25) return 'crescimento';
  if (d <= -0.6) return 'queda_forte';
  if (d <= -0.25) return 'queda';
  // Volátil: metades da janela atual muito diferentes entre si.
  if (dailyCur.length >= 4) {
    const half = Math.floor(dailyCur.length / 2);
    const h1 = dailyCur.slice(0, half).reduce((a, b) => a + b, 0);
    const h2 = dailyCur.slice(half).reduce((a, b) => a + b, 0);
    const mx = Math.max(h1, h2);
    if (mx > 0 && Math.abs(h2 - h1) / mx >= 0.5) return 'volatil';
  }
  return 'estavel';
}

export interface Driver {
  kind: 'volume' | 'aov' | 'fe_ticket' | 'backend' | 'active_days' | 'approval' | 'refund' | 'cpa' | 'mix' | 'chargeback';
  title: string;
  detail: string;
  from: number | null;
  to: number | null;
  format: 'int' | 'money' | 'pct' | 'days';
  impactUsd: number | null; // efeito estimado na receita (quando decomponível)
  tone: 'up' | 'down' | 'neutral';
}

const fmtUsd = (n: number) => (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
const fmtPctPt = (f: number) => (f * 100).toFixed(1).replace('.', ',') + '%';

/**
 * "Por quê": lista ordenada por impacto do que explica a variação entre a
 * janela anterior e a atual. Receita é decomposta EXATAMENTE em volume ×
 * AOV (com AOV recalculado sem arredondar); AOV em ticket do front × back
 * por FE; o resto são sinais (dias ativos, aprovação, reembolso, CPA, mix
 * de família, take rate).
 */
export function explainChange(
  cur: WindowMetrics,
  prev: WindowMetrics,
  familyCur: Map<string, number>,
  familyPrev: Map<string, number>,
): Driver[] {
  const out: Driver[] = [];
  const dRev = round2(cur.revenue - prev.revenue);
  const bothFe = cur.feApproved > 0 && prev.feApproved > 0;
  // AOV exato (sem round2) pra decomposição fechar com Δreceita.
  const aovCur = cur.feApproved > 0 ? cur.revenue / cur.feApproved : 0;
  const aovPrev = prev.feApproved > 0 ? prev.revenue / prev.feApproved : 0;
  const volumeEffect = bothFe ? round2((cur.feApproved - prev.feApproved) * aovPrev) : dRev;
  const aovEffect = bothFe ? round2(dRev - volumeEffect) : 0;

  if (cur.feApproved !== prev.feApproved || (!bothFe && dRev !== 0)) {
    const d = pctDelta(cur.feApproved, prev.feApproved);
    const feText = d == null
      ? (cur.feApproved > 0 ? `${cur.feApproved} FEs aprovadas (antes nenhuma)` : `nenhuma FE aprovada (antes ${prev.feApproved})`)
      : `${prev.feApproved} → ${cur.feApproved} FEs (${d >= 0 ? '+' : ''}${fmtPctPt(d)})`;
    out.push({
      kind: 'volume',
      title: 'Volume de fronts',
      detail: `${feText} — efeito de ${fmtUsd(volumeEffect)} na receita${bothFe ? '' : ' (sem FE numa das janelas: Δ inteiro atribuído ao volume)'}`,
      from: prev.feApproved, to: cur.feApproved, format: 'int',
      impactUsd: volumeEffect, tone: volumeEffect >= 0 ? 'up' : 'down',
    });
  }
  if (bothFe && Math.abs(aovCur - aovPrev) >= 1) {
    const ticketPart = round2(cur.feApproved * (cur.feTicket - prev.feTicket));
    const backPart = round2(aovEffect - ticketPart);
    out.push({
      kind: 'aov',
      title: 'AOV (receita por FE)',
      detail: `${fmtUsd(aovPrev)} → ${fmtUsd(aovCur)} — efeito de ${fmtUsd(aovEffect)}: ticket do front ${fmtUsd(ticketPart)}, back/upsell ${fmtUsd(backPart)}`,
      from: round2(aovPrev), to: round2(aovCur), format: 'money',
      impactUsd: aovEffect, tone: aovEffect >= 0 ? 'up' : 'down',
    });
    if (Math.abs(cur.backendTakeRate - prev.backendTakeRate) >= 0.1) {
      out.push({
        kind: 'backend',
        title: 'Take rate de upsell/back',
        detail: `${fmtPctPt(prev.backendTakeRate)} → ${fmtPctPt(cur.backendTakeRate)} de backends por FE`,
        from: prev.backendTakeRate, to: cur.backendTakeRate, format: 'pct',
        impactUsd: backPart, tone: cur.backendTakeRate >= prev.backendTakeRate ? 'up' : 'down',
      });
    }
  }
  if (cur.days > 1 && cur.activeDays < cur.days && prev.activeDays >= cur.activeDays + 2) {
    out.push({
      kind: 'active_days',
      title: 'Dias com venda',
      detail: `vendeu em ${cur.activeDays} de ${cur.days} dias (antes ${prev.activeDays} de ${prev.days}) — tráfego parou/oscilou`,
      from: prev.activeDays, to: cur.activeDays, format: 'days', impactUsd: null, tone: 'down',
    });
  } else if (cur.days > 1 && cur.activeDays >= prev.activeDays + 2 && cur.activeDays === cur.days) {
    out.push({
      kind: 'active_days',
      title: 'Dias com venda',
      detail: `vendeu todos os ${cur.days} dias (antes ${prev.activeDays} de ${prev.days}) — operação constante`,
      from: prev.activeDays, to: cur.activeDays, format: 'days', impactUsd: null, tone: 'up',
    });
  }
  if (prev.realOrders >= 10 && cur.realOrders >= 10 && Math.abs(cur.approvalRate - prev.approvalRate) >= 0.05) {
    out.push({
      kind: 'approval',
      title: 'Aprovação',
      detail: `${fmtPctPt(prev.approvalRate)} → ${fmtPctPt(cur.approvalRate)}`,
      from: prev.approvalRate, to: cur.approvalRate, format: 'pct', impactUsd: null,
      tone: cur.approvalRate >= prev.approvalRate ? 'up' : 'down',
    });
  }
  if ((prev.realOrders >= 10 || cur.realOrders >= 10) && Math.abs(cur.refundRate - prev.refundRate) >= 0.03) {
    out.push({
      kind: 'refund',
      title: 'Reembolso',
      detail: `${fmtPctPt(prev.refundRate)} → ${fmtPctPt(cur.refundRate)} (${cur.refunds} estornos na janela)`,
      from: prev.refundRate, to: cur.refundRate, format: 'pct', impactUsd: null,
      tone: cur.refundRate <= prev.refundRate ? 'up' : 'down',
    });
  }
  if (cur.realOrders >= 10 && cur.cbRate >= 0.01 && cur.cbRate > prev.cbRate) {
    out.push({
      kind: 'chargeback',
      title: 'Chargeback',
      detail: `${fmtPctPt(prev.cbRate)} → ${fmtPctPt(cur.cbRate)}`,
      from: prev.cbRate, to: cur.cbRate, format: 'pct', impactUsd: null, tone: 'down',
    });
  }
  if (prev.cpaPerFe > 0 && cur.cpaPerFe > 0 && Math.abs(cur.cpaPerFe - prev.cpaPerFe) >= 1) {
    const dNet = (cur.netAfterCpa ?? 0) - (prev.netAfterCpa ?? 0);
    out.push({
      kind: 'cpa',
      title: 'CPA por FE (efetivo)',
      detail: `${fmtUsd(prev.cpaPerFe)} → ${fmtUsd(cur.cpaPerFe)} por FE — Net após CPA ${fmtUsd(prev.netAfterCpa ?? 0)} → ${fmtUsd(cur.netAfterCpa ?? 0)}`,
      from: prev.cpaPerFe, to: cur.cpaPerFe, format: 'money',
      impactUsd: round2(-(cur.cpaPerFe - prev.cpaPerFe) * cur.feApproved), tone: dNet >= 0 ? 'up' : 'down',
    });
  }
  // Mix de família: maior deslocamento de share.
  const totalCur = [...familyCur.values()].reduce((a, b) => a + b, 0);
  const totalPrev = [...familyPrev.values()].reduce((a, b) => a + b, 0);
  if (totalCur > 0 && totalPrev > 0) {
    let bestFam = '';
    let bestShift = 0;
    let fromShare = 0;
    let toShare = 0;
    for (const fam of new Set([...familyCur.keys(), ...familyPrev.keys()])) {
      const sc = (familyCur.get(fam) ?? 0) / totalCur;
      const sp = (familyPrev.get(fam) ?? 0) / totalPrev;
      if (Math.abs(sc - sp) > Math.abs(bestShift)) { bestShift = sc - sp; bestFam = fam; fromShare = sp; toShare = sc; }
    }
    if (Math.abs(bestShift) >= 0.15) {
      out.push({
        kind: 'mix',
        title: `Mix de produto: ${bestFam}`,
        detail: `${fmtPctPt(fromShare)} → ${fmtPctPt(toShare)} da receita${fromShare === 0 ? ' (família nova)' : toShare === 0 ? ' (parou de vender)' : ''}`,
        from: fromShare, to: toShare, format: 'pct', impactUsd: null, tone: 'neutral',
      });
    }
  }
  // Ordena por impacto absoluto; sem impacto vai depois, na ordem de inserção.
  const withIdx = out.map((d, i) => ({ d, i }));
  withIdx.sort((x, y) => {
    const ax = x.d.impactUsd == null ? -1 : Math.abs(x.d.impactUsd);
    const ay = y.d.impactUsd == null ? -1 : Math.abs(y.d.impactUsd);
    if (ax !== ay) return ay - ax;
    return x.i - y.i;
  });
  return withIdx.map((x) => x.d);
}

/** Ranking por métrica; retorna mapa key → posição (1-based). Empates por receita. */
export function rankBy<T extends { key: string }>(rows: T[], value: (r: T) => number, tiebreak: (r: T) => number, ascending = false): Map<string, number> {
  const sorted = [...rows].sort((a, b) => {
    const d = value(a) - value(b);
    if (d !== 0) return ascending ? d : -d;
    return tiebreak(b) - tiebreak(a);
  });
  const out = new Map<string, number>();
  sorted.forEach((r, i) => out.set(r.key, i + 1));
  return out;
}
