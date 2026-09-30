import { describe, expect, it } from 'vitest';
import { UNITS, resolveUnit, unitsFor } from './units';
import type { OverviewResponse, AffiliatesResponse, AffiliateDetailResponse, PlatformsResponse, ProductsResponse, CostsOverviewResponse, FunnelResponse } from '../services/metrics';
import type { AffiliateAnalysisResponse, AffiliateExplainResponse, AffiliateSequenceResponse } from '../services/affiliateAnalysis';
import type { FunnelSequenceResponse } from '../services/funnelSequence';
import type { ProfitSplitResponse } from '../services/profitSplit';
import type { FulfillmentResponse } from '../services/fulfillment';
import type { RefundCohortsResponse } from '../services/refundCohorts';
import type { CallCenterResponse } from '../services/callCenterSales';
import type { RecoveryResponse } from '../services/recovery';
import type { FamiliesResponse } from '../services/families';
import type { SmsResponse } from '../services/sms';
import type { HealthResponse } from '../services/health';

// Fixtures TIPADAS pelos contratos dos serviços (DeepPartial mantém a checagem
// de chave inexistente): se um serviço renomear um campo, o teste quebra aqui.
type DeepPartial<T> = T extends Array<infer U> ? Array<DeepPartial<U>> : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

const FIXTURES: Record<string, unknown> = {
  get_overview: {
    range: { start: '2026-09-01T03:00:00.000Z', end: '2026-10-01T02:59:59.999Z' },
    kpis: { gross: 1, grossOriginal: 1, net: 1, cpa: 1, approvalRate: 0.9, refundRate: 0.05, cbRate: 0.004, aov: 1, approvedCount: 1, totalCount: 1, orderGroups: 1, epo: 1, cogs: 1, fulfillment: 1, estimatedProfit: 1, estimatedMarginPct: 6.6 },
    previous: { approvalRate: 0.9, refundRate: 0.05, cbRate: 0.004, estimatedMarginPct: 6 },
    daily: [{ date: '2026-09-01', gross: 1, profit: 1 }],
    byCountry: [{ code: 'US', value: 1, orders: 1 }],
    topAffiliates: [{ revenue: 1, approvalRate: 0.9, netAfterCpaUsd: 1 }],
    platformHealth: [{ slug: 'clickbank', lastSyncAt: '2026-09-30T00:00:00.000Z' }],
    // Campos da visão de IA (lib/ai/views).
    deltas: { refundRate: { cur: 0.05, prev: 0.04, abs: 0.01, pct: 0.25, pp: 1 } },
  } satisfies DeepPartial<OverviewResponse> & Record<string, unknown>,
  get_affiliates: {
    summary: { concentration: 0.42, totalRevenue: 1 },
    affiliates: [{ revenue: 1, approvalRate: 0.9, refundRate: 0.1, cbRate: 0.01, refundCbPctUsed: 15, refundCbPctOverride: null, opexPctUsed: 10, attributedMarginPct: 12, cpaPerFe: 1, netAovUsd: 1, lastOrderAt: '2026-09-29T00:00:00.000Z' }],
  } satisfies DeepPartial<AffiliatesResponse>,
  get_affiliate_detail: {
    kpis: { approvalRate: 0.9, refundRate: 0.1, cbRate: 0.01, refundCbPctUsed: 15, opexPctUsed: 10, refundCbPctOverride: 12 },
    daily: [{ date: '2026-09-01', revenue: 1 }],
  } satisfies DeepPartial<AffiliateDetailResponse>,
  get_affiliate_analysis: {
    summary: { concentrationTop10: 0.6 },
    windows: [{ start: '2026-09-23', end: '2026-09-29', cur: { refundRate: 0.1, backendTakeRate: 0.3, approvalRate: 0.9, cbRate: 0.01 } }],
    rows: [{
      cur: { revenue: 1, refundRate: 0.1, approvalRate: 0.9, cbRate: 0.01, backendTakeRate: 0.2 },
      delta: { revenue: 0.12, sales: -0.1, aov: 0.02, refundRate: 0.01, netAfterCpa: 3, netAfterCpaTotal: 30 },
      windows: [{ refundRate: 0.1, prevRefundRate: 0.08 }],
    }],
  } satisfies DeepPartial<AffiliateAnalysisResponse>,
  get_affiliate_explain: {
    cur: { refundRate: 0.1, approvalRate: 0.9, cbRate: 0.01, backendTakeRate: 0.2 },
    byFamily: [{ share: 0.5, prevShare: 0.4 }],
  } satisfies DeepPartial<AffiliateExplainResponse>,
  get_affiliate_sequence: {
    windows: [{ concentrationTop10: 0.5, topShare2: 0.2, rows: [{ m: { refundRate: 0.1, approvalRate: 0.9, cbRate: 0.01, backendTakeRate: 0.2 } }] }],
    transitions: [{ retainedChangePct: -0.1 }],
    evolution: [{ deltas: [0.1, null], per: [{ approvalRate: 0.9, refundRate: 0.1 }] }],
    slowing: [{ dropPct: -0.6 }],
  } satisfies DeepPartial<AffiliateSequenceResponse>,
  get_funnel: {
    stages: [{ takeRate: 0.4 }],
    summary: { revenueLiftFromUpsells: 0.35 },
  } satisfies DeepPartial<FunnelResponse>,
  get_funnel_sequence: {
    windows: [{ all: { stages: [{ takeRate: 0.4 }], summary: { revenueLiftFromUpsells: 0.3 } } }],
    scopes: { all: { transitions: [{ fePct: 0.1, aovPct: -0.02, revenuePct: 0.08, lift: 0.3, prevLift: 0.2, stages: [{ takeRate: 0.4, prevTakeRate: 0.38, takePp: 0.02 }] }] } },
  } satisfies DeepPartial<FunnelSequenceResponse>,
  get_products: {
    products: [{ approvalRate: 0.9, estimatedMarginPct: 12, attributedMarginPct: 20 }],
  } satisfies DeepPartial<ProductsResponse>,
  get_families: { families: [{ upsellLiftPct: 0.2 }] } satisfies DeepPartial<FamiliesResponse>,
  get_platforms: {
    platforms: [{ approvalRate: 0.9, refundRate: 0.07, cbRate: 0.004, feeRatePct: 8.37, allowancePct: 2.37, refundCbPct: 15, observedRefundCbPct: 10.45 }],
  } satisfies DeepPartial<PlatformsResponse>,
  get_profit_split: {
    opexPct: 10,
    refunds: { pct: 8.1, valuePct: 9.3 },
    refunds7d: { pct: 7.5, valuePct: 8 },
  } satisfies DeepPartial<ProfitSplitResponse>,
  get_costs_overview: {
    kpis: { marginPct: 12.5 },
    byPlatform: [{ feeRatePctEffective: 8.4, marginPct: 10 }],
    byFamily: [{ marginPct: 5 }],
    allowance: { byPlatform: [{ allowancePct: 2.37 }] },
  } satisfies DeepPartial<CostsOverviewResponse>,
  get_fulfillment: {
    kpis: { fulfillmentPctOfGross: 0.08 },
    bracketMix: [{ pctPackages: 66.7 }],
    forecast: { trendPct: 12.3, invoiceBenchmarkPct: 0.1, invoiceCycles: [{ totalPctOfGross: 0.1, fulfillmentPctOfGross: 0.05 }] },
  } satisfies DeepPartial<FulfillmentResponse>,
  get_refund_cohorts: {
    cohorts: [{ cells: [{ pctCount: 0.01, pctUsd: 0.012 }], projection: { pctCount: 0.1, pctUsd: 0.11, developedCount: 0.4, developedUsd: 0.45 } }],
    curve: [{ pctCount: 0.05, pctUsd: 0.06 }],
    projection: { periodPctCount: 0.09, periodPctUsd: 0.1 },
  } satisfies DeepPartial<RefundCohortsResponse>,
  get_call_center: {
    totals: { commissionPct: 0.35 },
    providers: [{ commissionPct: 0.35 }],
  } satisfies DeepPartial<CallCenterResponse>,
  get_recovery: {
    byCompany: [{ effectivePct: 0.3, accounts: [{ commissionPct: 0.3 }] }],
    byAffiliate: [{ commissionPct: 0.3 }],
  } satisfies DeepPartial<RecoveryResponse>,
  get_sms: {
    kpis: { deliveryRate: 0.97, deliveryRatePrev: 0.95, deliveryRateDeltaPp: 2, stopRate: 0.01 },
    numbers: [{ deliveryRate: 0.9, stopRate: 0.01 }],
  } satisfies DeepPartial<SmsResponse>,
  get_health: {
    ingestion: { perPlatform: [{ successRate24h: 1 }] },
    health: { approvalRate24h: 0.9, refundRate24h: 0.1, chargebackRate24h: 0.01, refundRateBaseline30d: 0.09 },
  } satisfies DeepPartial<HealthResponse>,
};

// Chaves que SEMPRE precisam de legenda: é nelas que fração × pontos
// percentuais se confunde.
const AMBIGUOUS = /(Rate|Pct|Pp|Share|share|pct|pp|Rate24h|Rate30d|deltas)$/;

function leafPaths(v: unknown, path: string[] = [], out: string[][] = []): string[][] {
  if (v === null || typeof v !== 'object') {
    out.push(path);
    return out;
  }
  if (Array.isArray(v)) {
    if (v.every((x) => x === null || typeof x !== 'object')) out.push(path);
    else for (const x of v) leafPaths(x, path, out);
    return out;
  }
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) leafPaths(x, [...path, k], out);
  return out;
}

describe('UNITS — cobertura', () => {
  for (const [tool, fixture] of Object.entries(FIXTURES)) {
    it(`${tool}: toda chave de taxa/percentual tem unidade`, () => {
      const missing = leafPaths(fixture)
        .filter((p) => AMBIGUOUS.test(p[p.length - 1] ?? ''))
        .filter((p) => !resolveUnit(tool, p))
        .map((p) => p.join('.'));
      expect(missing).toEqual([]);
    });
  }

  it('toda tool de dado do catálogo tem mapa de unidades', () => {
    expect(Object.keys(UNITS).sort()).toEqual(Object.keys(FIXTURES).concat('get_orders').sort());
  });
});

describe('resolveUnit — o mais específico vence', () => {
  it('mesma palavra, unidades diferentes no mesmo objeto', () => {
    expect(resolveUnit('get_platforms', ['platforms', 'refundRate'])?.unit).toBe('fraction');
    expect(resolveUnit('get_platforms', ['platforms', 'observedRefundCbPct'])?.unit).toBe('pp');
    expect(resolveUnit('get_affiliate_analysis', ['rows', 'delta', 'revenue'])?.unit).toBe('fraction');
    expect(resolveUnit('get_affiliate_analysis', ['rows', 'cur', 'revenue'])?.unit).toBe('usd');
    expect(resolveUnit('get_affiliate_analysis', ['rows', 'delta', 'netAfterCpa'])?.unit).toBe('usd');
    expect(resolveUnit('get_overview', ['deltas', 'gross', 'pct'])?.unit).toBe('fraction');
    expect(resolveUnit('get_overview', ['deltas', 'refundRate', 'pp'])?.unit).toBe('pp');
  });

  it('"Pct" que na verdade é fração é declarado como fração', () => {
    expect(resolveUnit('get_recovery', ['byAffiliate', 'commissionPct'])?.unit).toBe('fraction');
    expect(resolveUnit('get_call_center', ['totals', 'commissionPct'])?.unit).toBe('fraction');
    expect(resolveUnit('get_affiliate_sequence', ['slowing', 'dropPct'])?.unit).toBe('fraction');
    expect(resolveUnit('get_fulfillment', ['kpis', 'fulfillmentPctOfGross'])?.unit).toBe('fraction');
    expect(resolveUnit('get_funnel_sequence', ['scopes', 'all', 'transitions', 'stages', 'takePp'])?.unit).toBe('fraction');
  });
});

describe('unitsFor — só as chaves presentes', () => {
  it('legenda compacta com o padrão que casou', () => {
    const u = unitsFor('get_platforms', FIXTURES.get_platforms);
    expect(u).toEqual({
      approvalRate: 'fraction', refundRate: 'fraction', cbRate: 'fraction',
      feeRatePct: 'pp', allowancePct: 'pp', refundCbPct: 'pp', observedRefundCbPct: 'pp',
    });
  });

  it('ignora _meta/_ref e olha só as primeiras linhas das listas', () => {
    const rows = Array.from({ length: 1000 }, () => ({ refundRate: 0.1 }));
    expect(unitsFor('get_platforms', { _meta: { units: { x: 'usd' } }, _ref: 'r1', platforms: rows })).toEqual({ refundRate: 'fraction' });
  });

  it('lista de primitivos conta como o campo dono', () => {
    expect(unitsFor('get_affiliate_sequence', { evolution: [{ deltas: [0.1, -0.2] }] })).toEqual({ 'evolution.deltas': 'fraction' });
  });

  it('tool sem mapa → undefined', () => {
    expect(unitsFor('calc', { results: [] })).toBeUndefined();
  });
});
