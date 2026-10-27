// Pure-function tests for the analytics aggregation helpers. These are the
// reduce loops that turn DailyMetricsRow[] (from the MV) and FunnelGroupAgg[]
// (from getFunnel) into the response payloads. They're side-effect free, so
// we can test them with synthetic inputs without spinning up Postgres.

import { describe, expect, it } from 'vitest';
import type { ProfitModelInputs } from './profitModel';

const round2 = (n: number) => Math.round(n * 100) / 100;
import {
  affiliateEconomics,
  affiliateRefundPct,
  isPaidSale,
  dailyFromRows,
  byCountryFromRows,
  byProductTypeFromRows,
  aggregateGroups,
  type FunnelGroupAgg,
} from './metrics';
import type { DailyMetricsRow } from './dailyMetrics';

function row(overrides: Partial<DailyMetricsRow> = {}): DailyMetricsRow {
  return {
    day: new Date('2026-04-20T00:00:00.000Z'),
    platform: 'clickbank',
    family: 'NeuroMindPro',
    country: 'US',
    product_type: 'FRONTEND',
    cogs: 0,
    fulfillment: 0,
    total_count: 10,
    approved_count: 9,
    refunded_count: 1,
    chargeback_count: 0,
    gross: 1000,
    gross_original: 1000,
    net: 950,
    cpa: 200,
    ...overrides,
  };
}

// ------------ dailyFromRows ------------

describe('dailyFromRows', () => {
  // Start/end vêm do frontend como BRT day boundaries em UTC:
  // - BRT day X start = UTC X 03:00:00
  // - BRT day X end   = UTC X+1 02:59:59.999
  // Iteração interna gera keys em BRT day ('2026-04-XX').
  it('produces one bucket per day in the range, even with no data', () => {
    const start = new Date('2026-04-20T03:00:00.000Z'); // BRT day Apr 20 start
    const end = new Date('2026-04-23T02:59:59.999Z');   // BRT day Apr 22 end
    const buckets = dailyFromRows([], start, end);
    expect(buckets).toHaveLength(3);
    expect(buckets.map((b) => b.date)).toEqual(['2026-04-20', '2026-04-21', '2026-04-22']);
    for (const b of buckets) {
      expect(b.gross).toBe(0);
      expect(b.allOrders).toBe(0);
    }
  });

  it('aggregates rows from multiple dimensions into one bucket per day', () => {
    const start = new Date('2026-04-20T03:00:00.000Z');
    const end = new Date('2026-04-21T02:59:59.999Z');
    const rows = [
      row({ family: 'NeuroMindPro', country: 'US', product_type: 'FRONTEND', gross: 500, approved_count: 5, total_count: 5 }),
      row({ family: 'NeuroMindPro', country: 'AU', product_type: 'FRONTEND', gross: 200, approved_count: 2, total_count: 3 }),
      row({ family: 'GlycoPulse', country: 'US', product_type: 'UPSELL', gross: 100, approved_count: 1, total_count: 1 }),
    ];
    const buckets = dailyFromRows(rows, start, end);
    expect(buckets).toHaveLength(1);
    const b = buckets[0];
    expect(b.gross).toBe(800);
    expect(b.approvedOrders).toBe(8);
    expect(b.allOrders).toBe(9);
    // orders is derived from approved (kept as alias for legacy chart code).
    expect(b.orders).toBe(8);
  });

  it('orders the resulting buckets ascending by date', () => {
    const start = new Date('2026-04-20T03:00:00.000Z');
    const end = new Date('2026-04-23T02:59:59.999Z');
    const rows = [
      row({ day: new Date('2026-04-22T00:00:00.000Z'), gross: 30 }),
      row({ day: new Date('2026-04-20T00:00:00.000Z'), gross: 10 }),
      row({ day: new Date('2026-04-21T00:00:00.000Z'), gross: 20 }),
    ];
    const buckets = dailyFromRows(rows, start, end);
    expect(buckets.map((b) => b.gross)).toEqual([10, 20, 30]);
  });
});

// ------------ byCountryFromRows ------------

describe('byCountryFromRows', () => {
  it('returns empty for no rows', () => {
    expect(byCountryFromRows([])).toEqual([]);
  });

  it('skips _unknown country bucket', () => {
    const rows = [
      row({ country: '_unknown', gross: 999, approved_count: 5 }),
      row({ country: 'US', gross: 100, approved_count: 2 }),
    ];
    const out = byCountryFromRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0].code).toBe('US');
  });

  it('aggregates across families/products into per-country totals, top 25', () => {
    // Generate 30 distinct countries; verify only top 25 are returned, sorted
    // by gross desc.
    const rows = Array.from({ length: 30 }, (_, i) =>
      row({ country: `C${i}`, gross: (30 - i) * 100, approved_count: 30 - i }),
    );
    const out = byCountryFromRows(rows);
    expect(out).toHaveLength(25);
    expect(out[0].code).toBe('C0'); // highest revenue first
    expect(out[0].value).toBe(3000);
    expect(out[24].value).toBe(600);
  });

  it('combines multiple rows for the same country', () => {
    const rows = [
      row({ country: 'US', family: 'NeuroMindPro', gross: 300, approved_count: 3 }),
      row({ country: 'US', family: 'GlycoPulse', gross: 200, approved_count: 2 }),
    ];
    const out = byCountryFromRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0].value).toBe(500);
    expect(out[0].orders).toBe(5);
  });
});

// ------------ byProductTypeFromRows ------------

describe('byProductTypeFromRows', () => {
  it('returns empty array when all types are zero', () => {
    expect(byProductTypeFromRows([])).toEqual([]);
  });

  it('only emits buckets with positive gross (filters zero categories)', () => {
    const rows = [
      row({ product_type: 'FRONTEND', gross: 1000 }),
      row({ product_type: 'UPSELL', gross: 200 }),
      // No DOWNSELL/BUMP/SMS_RECOVERY rows — they should not appear.
    ];
    const out = byProductTypeFromRows(rows);
    expect(out.map((x) => x.label).sort()).toEqual(['FRONTEND', 'UPSELL']);
  });

  it('sums values across rows of the same type', () => {
    const rows = [
      row({ product_type: 'UPSELL', country: 'US', gross: 100 }),
      row({ product_type: 'UPSELL', country: 'AU', gross: 200 }),
    ];
    const out = byProductTypeFromRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0].value).toBe(300);
  });
});

// ------------ aggregateGroups (Funnel) ------------

// Builder helpers for the per-step funnel maps. Tests read more cleanly
// when we say `up({ 2: 50 })` instead of `new Map([[2, 50]])`.
const up = (entries: Record<number, number> = {}): Map<number, number> =>
  new Map(Object.entries(entries).map(([k, v]) => [Number(k), v]));
const dw = up;

function group(p: Partial<FunnelGroupAgg> = {}): FunnelGroupAgg {
  return {
    hasFE: true,
    hasBump: false,
    feRevenue: 100,
    bumpRevenue: 0,
    upsellsByStep: new Map(),
    downsellsByStep: new Map(),
    ...p,
  };
}

describe('aggregateGroups', () => {
  it('handles empty group list without dividing by zero', () => {
    const out = aggregateGroups([], 0);
    expect(out.summary.feGroups).toBe(0);
    expect(out.summary.aov).toBe(0);
    expect(out.stages.find((s) => s.id === 'frontend')?.takeRate).toBe(1);
    // Backend stages have take rate 0 when no FE groups (avoid NaN).
    for (const s of out.stages) {
      if (s.id !== 'frontend') expect(s.takeRate).toBe(0);
    }
  });

  it('computes take rates relative to FE volume', () => {
    // 10 FE groups; 3 with U1, 1 with U2, 2 with downsell (DW1).
    const fixed: FunnelGroupAgg[] = [
      group(), group(), group(), group(), group(), // 5 FE-only
      group({ upsellsByStep: up({ 2: 50 }) }),
      group({ upsellsByStep: up({ 2: 50 }) }),
      group({ upsellsByStep: up({ 2: 50, 3: 30 }) }),
      group({ downsellsByStep: dw({ 2: 40 }) }),
      group({ downsellsByStep: dw({ 2: 40 }) }),
    ];
    const out = aggregateGroups(fixed, fixed.length);
    expect(out.summary.feGroups).toBe(10);
    const stage = (id: string) => out.stages.find((s) => s.id === id)!;
    expect(stage('frontend').volume).toBe(10);
    expect(stage('upsell1').volume).toBe(3);
    expect(stage('upsell1').takeRate).toBe(0.3);
    expect(stage('upsell2').volume).toBe(1);
    expect(stage('upsell2').takeRate).toBe(0.1);
    expect(stage('downsell1').volume).toBe(2);
    expect(stage('downsell1').takeRate).toBe(0.2);
  });

  it('AOV per-buyer = total gross / FE groups', () => {
    const groups: FunnelGroupAgg[] = [
      group({ feRevenue: 100 }),
      group({ feRevenue: 200, upsellsByStep: up({ 2: 50 }) }),
    ];
    const out = aggregateGroups(groups, groups.length);
    // total = 100 + 200 + 50 = 350. feGroups = 2. aov = 175.
    expect(out.summary.totalRevenue).toBe(350);
    expect(out.summary.aov).toBe(175);
  });

  it('upsell lift compares aov FE-only vs FE+upsell', () => {
    const groups: FunnelGroupAgg[] = [
      group({ feRevenue: 100 }),
      group({ feRevenue: 100 }),
      group({ feRevenue: 100, upsellsByStep: up({ 2: 100 }) }),
    ];
    const out = aggregateGroups(groups, groups.length);
    // FE-only avg = 100. With upsell avg = 200. Lift = 1.0 (100%).
    expect(out.summary.aovFEOnly).toBe(100);
    expect(out.summary.aovWithUpsell).toBe(200);
    expect(out.summary.revenueLiftFromUpsells).toBe(1);
  });

  it('emite stages separadas para UP1/UP2/UP3 e DW1/DW2/DW3 quando o dado existe', () => {
    const groups: FunnelGroupAgg[] = [
      group({ upsellsByStep: up({ 2: 50, 3: 30, 4: 20 }) }),
      group({ upsellsByStep: up({ 2: 50, 3: 30 }) }),
      group({ upsellsByStep: up({ 2: 50 }) }),
      group({ downsellsByStep: dw({ 2: 40, 3: 25, 4: 15 }) }),
      group({ downsellsByStep: dw({ 2: 40, 3: 25 }) }),
      group({ downsellsByStep: dw({ 2: 40 }) }),
    ];
    const out = aggregateGroups(groups, groups.length);
    const ids = out.stages.map((s) => s.id);
    expect(ids).toEqual([
      'frontend',
      'upsell1', 'upsell2', 'upsell3',
      'downsell1', 'downsell2', 'downsell3',
    ]);
    const stage = (id: string) => out.stages.find((s) => s.id === id)!;
    expect(stage('upsell1').volume).toBe(3); // 3 grupos com step 2
    expect(stage('upsell2').volume).toBe(2); // 2 grupos com step 3
    expect(stage('upsell3').volume).toBe(1); // 1 grupo com step 4
    expect(stage('downsell3').revenue).toBe(15);
  });
});

// ------------ Cross-sell classification (pure helper) ------------

import { classifyOrderInGroup } from './metrics';

describe('classifyOrderInGroup', () => {
  it('FE order is never cross-sell (it defines the family)', () => {
    expect(classifyOrderInGroup('FRONTEND', 'NeuroMindPro', 'NeuroMindPro')).toBe('SAME_FAMILY');
    expect(classifyOrderInGroup('FRONTEND', 'NeuroMindPro', null)).toBe('SAME_FAMILY');
  });

  it('backend order with same family is SAME_FAMILY', () => {
    expect(classifyOrderInGroup('UPSELL', 'NeuroMindPro', 'NeuroMindPro')).toBe('SAME_FAMILY');
    expect(classifyOrderInGroup('DOWNSELL', 'GlycoPulse', 'GlycoPulse')).toBe('SAME_FAMILY');
  });

  it('backend order with different family is CROSS_SELL', () => {
    expect(classifyOrderInGroup('UPSELL', 'NeuroMindPro', 'GlycoPulse')).toBe('CROSS_SELL');
    expect(classifyOrderInGroup('DOWNSELL', 'GlycoPulse', 'ThermoBurnPro')).toBe('CROSS_SELL');
  });

  it('returns UNKNOWN when either family is null (cant classify)', () => {
    expect(classifyOrderInGroup('UPSELL', null, 'GlycoPulse')).toBe('UNKNOWN');
    expect(classifyOrderInGroup('UPSELL', 'NeuroMindPro', null)).toBe('UNKNOWN');
    expect(classifyOrderInGroup('UPSELL', null, null)).toBe('UNKNOWN');
  });
});

describe('affiliateRefundPct — reembolso do NET AOV na aba Afiliados', () => {
  const lucroReal = { front: 20, recovery: null };
  it('observado: valor estornado ÷ valor cobrado das vendas pagas do afiliado', () => {
    const ctx = { source: 'observado' as const, lucroReal };
    expect(affiliateRefundPct(ctx, { grossChargedUsd: 1000, refundedUsd: 170, isRecovery: false })).toBe(17);
    expect(affiliateRefundPct(ctx, { grossChargedUsd: 0, refundedUsd: 0, isRecovery: false })).toBe(0);
  });
  it('Lucro real: o % configurado; recuperação sem % próprio usa o do front', () => {
    const ctx = { source: 'lucro_real' as const, lucroReal };
    expect(affiliateRefundPct(ctx, { grossChargedUsd: 1000, refundedUsd: 170, isRecovery: false })).toBe(20);
    expect(affiliateRefundPct(ctx, { grossChargedUsd: 10, refundedUsd: 0, isRecovery: true })).toBe(20);
    expect(affiliateRefundPct({ source: 'lucro_real', lucroReal: { front: 20, recovery: 8 } }, { grossChargedUsd: 10, refundedUsd: 0, isRecovery: true })).toBe(8);
    expect(affiliateRefundPct({ source: 'lucro_real', lucroReal: { front: null, recovery: null } }, { grossChargedUsd: 10, refundedUsd: 5, isRecovery: false })).toBe(0);
  });
});

describe('affiliateEconomics — regra do extrato na aba Afiliados', () => {
  const pm: ProfitModelInputs = {
    opexPct: 10,
    thresholds: { healthyMinUsd: 10, attentionMinUsd: 0 },
    byPlatform: new Map([['jvzoo', { feePct: 10, refundCbPct: 15, allowancePct: 0 }]]),
  };
  const ctx = { source: 'observado' as const, lucroReal: { front: 20, recovery: null } };
  // ERICSON MENDEZ (JVZoo 2322247), set/26 no dia de Nova York — números do
  // dados_oficiais conferidos em 27/10: 13.261 pagas, 10.009 aprovadas,
  // 2.820 reembolsos + 432 chargebacks, US$ 3.632.798,49 cobrados.
  const ericson = {
    platformSlug: 'jvzoo', isRecovery: false, orders: 10_009, refunds: 2_820, chargebacks: 432,
    paidOrders: 13_261, fePaidCount: 9_166, grossChargedUsd: 3_632_798.49, refundedUsd: 875_392.15,
    cpa: 2_238_610, latestCpa: 245,
  };
  it('taxas ÷ vendas pagas; AOV = cobrado ÷ FEs pagos; reembolso observado em valor', () => {
    const e = affiliateEconomics(ericson, pm, ctx);
    expect(e.approvalRate).toBe(0.7548);                 // 10.009 ÷ 13.261
    expect(e.cbRate).toBe(0.0326);
    expect(e.aovUsd).toBe(396.33);                        // 3.632.798,49 ÷ 9.166
    expect(e.refundCbPctUsed).toBe(24.1);                 // 875.392,15 ÷ 3.632.798,49
    // NET AOV = 396,33 × (1 − 24,1% − 10% − 10%) = 221,55; − CPA 245.
    expect(e.netAovUsd).toBe(221.55);
    expect(e.netAfterCpaUsd).toBe(-23.45);
    expect(e.netAfterCpaTotalUsd).toBe(round2(-23.45 * 9_166));
    expect(e.cpaPerFeApproved).toBe(244.23);              // CPA de todos os FEs pagos
  });
  it('Digistore: a linha de estorno não é venda paga', () => {
    expect(isPaidSale('digistore24', 'REFUNDED')).toBe(false);
    expect(isPaidSale('jvzoo', 'REFUNDED')).toBe(true);
    expect(isPaidSale('jvzoo', 'CHARGEBACK')).toBe(true);
    expect(isPaidSale('jvzoo', 'CANCELED')).toBe(false);
  });
});
