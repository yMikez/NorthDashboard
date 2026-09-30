// Unidade de cada campo numérico/data que as tools devolvem ao modelo.
//
// Por quê: os serviços misturam convenções NO MESMO objeto — em
// get_platforms `refundRate: 0.07` (fração) mora ao lado de
// `observedRefundCbPct: 10.45` (pontos percentuais); em recovery o
// `commissionPct` é fração (0.30) apesar do nome. O modelo lia "Pct" como
// porcentagem e errava por 100×. Os serviços ficam como estão (alimentam as
// abas); o executeTool anexa `_meta.units` só com as chaves PRESENTES no
// resultado, a partir deste mapa.
//
// Chave do mapa = nome do campo (casa em qualquer profundidade) OU sufixo de
// caminho pontuado sem índices ('delta.revenue', 'deltas.*.pct'). A chave
// mais específica (mais segmentos) vence — é o que separa `delta.revenue`
// (variação relativa, fração) de `revenue` (US$).

export type Unit =
  /** 0–1 (0.0823 = 8,23%); também diferença/variação expressa em fração. */
  | 'fraction'
  /** Pontos percentuais: o número JÁ é a porcentagem (8.23 = 8,23%). */
  | 'pp'
  | 'usd'
  | 'count'
  | 'days'
  /** Instante ISO 8601 em UTC. */
  | 'iso_utc'
  /** Dia civil de Brasília 'YYYY-MM-DD'. */
  | 'date_brt';

type UnitMap = Record<string, Unit>;

// Taxas por contagem que TODOS os serviços calculam como fração (round4).
const COUNT_RATES: UnitMap = { approvalRate: 'fraction', refundRate: 'fraction', cbRate: 'fraction' };

// WindowMetrics (affiliateAnalysisCore) — base das 3 tools de janela.
const WINDOW_METRICS: UnitMap = {
  ...COUNT_RATES,
  revenue: 'usd', net: 'usd', aov: 'usd', feTicket: 'usd', backendPerFe: 'usd', cpaPaid: 'usd',
  cpaPerFe: 'usd', netAov: 'usd', netAfterCpa: 'usd', netAfterCpaTotal: 'usd',
  backendTakeRate: 'fraction',
  activeDays: 'days', days: 'days',
  impactUsd: 'usd',
  start: 'date_brt', end: 'date_brt', prevStart: 'date_brt', prevEnd: 'date_brt',
  anchor: 'date_brt', todayBrt: 'date_brt', asOf: 'iso_utc',
};

const AFFILIATE_ROW: UnitMap = {
  ...COUNT_RATES,
  revenue: 'usd', cpa: 'usd', cpaPerFe: 'usd', cpaPerFeApproved: 'usd', netMargin: 'usd',
  cogs: 'usd', fulfillment: 'usd', estimatedProfit: 'usd', aov: 'usd', epo: 'usd',
  attributedRevenue: 'usd', attributedNet: 'usd', attributedCpa: 'usd', attributedCogs: 'usd',
  attributedFulfillment: 'usd', attributedProfit: 'usd', attributedMarginPct: 'pp',
  ltvRevenue: 'usd',
  refundCbPctUsed: 'pp', refundCbPctOverride: 'pp', opexPctUsed: 'pp',
  firstSeenAt: 'iso_utc', lastOrderAt: 'iso_utc',
};

export const UNITS: Record<string, UnitMap> = {
  get_overview: {
    ...COUNT_RATES,
    gross: 'usd', grossOriginal: 'usd', net: 'usd', cpa: 'usd', cogs: 'usd', fulfillment: 'usd',
    aov: 'usd', epo: 'usd', estimatedProfit: 'usd', profit: 'usd', revenue: 'usd',
    estimatedMarginPct: 'pp',
    orderGroups: 'count',
    'daily.date': 'date_brt',
    'byCountry.value': 'usd', 'byProductType.value': 'usd',
    'deltas.*.pct': 'fraction', 'deltas.*.pp': 'pp',
    lastSyncAt: 'iso_utc',
    'range.start': 'iso_utc', 'range.end': 'iso_utc',
  },
  get_affiliates: { ...AFFILIATE_ROW, 'summary.concentration': 'fraction', 'summary.totalRevenue': 'usd' },
  get_affiliate_detail: {
    ...AFFILIATE_ROW,
    'daily.date': 'date_brt', 'daily.revenue': 'usd',
  },
  get_affiliate_analysis: {
    ...WINDOW_METRICS,
    prevRevenue: 'usd', prevAov: 'usd', prevRefundRate: 'fraction', prevNetAfterCpa: 'usd', prevNetAfterCpaTotal: 'usd',
    'delta.revenue': 'fraction', 'delta.sales': 'fraction', 'delta.aov': 'fraction',
    'delta.refundRate': 'fraction', 'delta.netAfterCpa': 'usd', 'delta.netAfterCpaTotal': 'usd',
    concentrationTop10: 'fraction', internalRevenueExcluded: 'usd',
  },
  get_affiliate_explain: {
    ...WINDOW_METRICS,
    prevRevenue: 'usd', prevAov: 'usd', prevRefundRate: 'fraction', prevNetAfterCpa: 'usd', prevNetAfterCpaTotal: 'usd',
    'byFamily.share': 'fraction', 'byFamily.prevShare': 'fraction',
    'daily.date': 'date_brt', 'daily.atual': 'usd', 'daily.anterior': 'usd',
  },
  get_affiliate_sequence: {
    ...WINDOW_METRICS,
    concentrationTop10: 'fraction', topShare2: 'fraction', internalRevenueExcluded: 'usd',
    retainedChangePct: 'fraction',
    revenueNew: 'usd', revenueChurn: 'usd', revenueRetainedBefore: 'usd', revenueRetainedAfter: 'usd',
    'topGainers.delta': 'usd', 'topLosers.delta': 'usd',
    'evolution.deltas': 'fraction',
    dropPct: 'fraction', peakRevenue: 'usd', lastRevenue: 'usd', 'slowing.revenue': 'usd',
    firstSaleAt: 'iso_utc', firstSaleDay: 'date_brt',
  },
  get_funnel: {
    takeRate: 'fraction', revenueLiftFromUpsells: 'fraction',
    revenue: 'usd', totalRevenue: 'usd', revenueFeSessions: 'usd', aov: 'usd', aovFEOnly: 'usd', aovWithUpsell: 'usd',
  },
  get_funnel_sequence: {
    takeRate: 'fraction', prevTakeRate: 'fraction', takePp: 'fraction', revenueLiftFromUpsells: 'fraction',
    lift: 'fraction', prevLift: 'fraction',
    fePct: 'fraction', aovPct: 'fraction', revenuePct: 'fraction',
    revenue: 'usd', prevRevenue: 'usd', revenueDelta: 'usd', totalRevenue: 'usd', revenueFeSessions: 'usd',
    aov: 'usd', prevAov: 'usd', aovFEOnly: 'usd', prevAovFEOnly: 'usd', aovWithUpsell: 'usd',
    volumeEffect: 'usd', aovEffect: 'usd', takeEffectUsd: 'usd',
    start: 'date_brt', end: 'date_brt', anchor: 'date_brt', asOf: 'iso_utc',
  },
  get_products: {
    ...COUNT_RATES,
    revenue: 'usd', net: 'usd', cpa: 'usd', cogs: 'usd', fulfillment: 'usd', estimatedProfit: 'usd',
    attributedRevenue: 'usd', attributedNet: 'usd', attributedCpa: 'usd', attributedCogs: 'usd',
    attributedFulfillment: 'usd', attributedProfit: 'usd',
    estimatedMarginPct: 'pp', attributedMarginPct: 'pp',
    firstSoldAt: 'iso_utc', lastSoldAt: 'iso_utc',
  },
  get_families: {
    upsellLiftPct: 'fraction',
    grossRevenue: 'usd', netRevenue: 'usd', cpaPaid: 'usd', aov: 'usd',
  },
  get_platforms: {
    ...COUNT_RATES,
    feeRatePct: 'pp', allowancePct: 'pp', refundCbPct: 'pp', observedRefundCbPct: 'pp',
    observedRefundSample: 'count',
    totalRevenue: 'usd', grossBruto: 'usd', grossRefunded: 'usd', cpaPaidTotal: 'usd',
    vendorEarnings: 'usd', taxesPaid: 'usd', allowanceReserved: 'usd', revenue: 'usd',
    feesUpdatedAt: 'iso_utc', lastSyncAt: 'iso_utc',
  },
  get_orders: { orderedAt: 'iso_utc', eventAt: 'iso_utc' },
  get_profit_split: {
    opexPct: 'pp',
    'refunds.pct': 'pp', 'refunds.valuePct': 'pp', 'refunds7d.pct': 'pp', 'refunds7d.valuePct': 'pp',
    'range.start': 'iso_utc', 'range.end': 'iso_utc',
  },
  get_costs_overview: {
    marginPct: 'pp', feeRatePctEffective: 'pp', allowancePct: 'pp',
    'range.start': 'iso_utc', 'range.end': 'iso_utc',
  },
  get_fulfillment: {
    fulfillmentPctOfGross: 'fraction', totalPctOfGross: 'fraction', invoiceBenchmarkPct: 'fraction',
    trendPct: 'pp', pctPackages: 'pp',
    'daily.date': 'date_brt', cycleStart: 'date_brt', closesOn: 'date_brt',
    daysToNext: 'days', daysElapsed: 'days', daysInMonth: 'days',
  },
  get_refund_cohorts: {
    pctCount: 'fraction', pctUsd: 'fraction', developedCount: 'fraction', developedUsd: 'fraction',
    periodPctCount: 'fraction', periodPctUsd: 'fraction',
    ageDays: 'days', age: 'days', horizonDays: 'days',
    day: 'date_brt', todayBrt: 'date_brt',
  },
  get_call_center: {
    commissionPct: 'fraction',
    'daily.date': 'date_brt', 'daily.tauk': 'usd', 'daily.logicall': 'usd', 'daily.salesbound': 'usd',
    purchasedAt: 'iso_utc',
  },
  get_recovery: { commissionPct: 'fraction', currentPct: 'fraction', effectivePct: 'fraction', pct: 'fraction' },
  get_sms: { deliveryRate: 'fraction', deliveryRatePrev: 'fraction', stopRate: 'fraction', deliveryRateDeltaPp: 'pp' },
  get_health: {
    successRate24h: 'fraction', approvalRate24h: 'fraction', refundRate24h: 'fraction',
    chargebackRate24h: 'fraction', refundRateBaseline30d: 'fraction',
  },
};

interface Pattern { key: string; segs: string[]; unit: Unit }

// Padrões por tool, do mais específico pro mais genérico (compilado 1×).
const COMPILED = new Map<string, Pattern[]>();
function patternsFor(tool: string): Pattern[] {
  let p = COMPILED.get(tool);
  if (!p) {
    p = Object.entries(UNITS[tool] ?? {})
      .map(([key, unit]) => ({ key, segs: key.split('.'), unit }))
      .sort((a, b) => b.segs.length - a.segs.length);
    COMPILED.set(tool, p);
  }
  return p;
}

/** Chave do mapa que dá a unidade de um campo no caminho `path` (só nomes de objeto, sem índices). */
export function resolveUnit(tool: string, path: readonly string[]): { key: string; unit: Unit } | null {
  for (const p of patternsFor(tool)) {
    if (p.segs.length > path.length) continue;
    const off = path.length - p.segs.length;
    let ok = true;
    for (let i = 0; i < p.segs.length && ok; i++) ok = p.segs[i] === '*' || p.segs[i] === path[off + i];
    if (ok) return { key: p.key, unit: p.unit };
  }
  return null;
}

// Listas são homogêneas: olhar as primeiras linhas basta pra saber que
// chaves existem — varrer 29 mil pedidos por causa da legenda seria custo à toa.
const SAMPLE_ITEMS = 5;
const SKIP_KEYS = new Set(['_meta', '_ref', '_truncated', '_hint']);

/**
 * Legenda de unidades das chaves PRESENTES em `value` (undefined quando
 * nenhuma chave do mapa aparece). Array de primitivos conta como o campo
 * dono (`evolution[].deltas` → 'evolution.deltas').
 */
export function unitsFor(tool: string, value: unknown): Record<string, Unit> | undefined {
  if (!UNITS[tool]) return undefined;
  const out: Record<string, Unit> = {};
  const visit = (node: unknown, path: string[], depth: number): void => {
    if (depth > 8 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node.slice(0, SAMPLE_ITEMS)) {
        if (item !== null && typeof item === 'object') visit(item, path, depth + 1);
      }
      return;
    }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (SKIP_KEYS.has(k)) continue;
      const p = [...path, k];
      const isContainer = v !== null && typeof v === 'object';
      const primitiveArray = Array.isArray(v) && v.every((x) => x === null || typeof x !== 'object');
      if (!isContainer || primitiveArray) {
        const hit = resolveUnit(tool, p);
        if (hit) out[hit.key] = hit.unit;
        continue;
      }
      visit(v, p, depth + 1);
    }
  };
  visit(value, [], 0);
  return Object.keys(out).length ? out : undefined;
}
