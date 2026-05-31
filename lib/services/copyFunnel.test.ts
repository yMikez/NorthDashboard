import { describe, it, expect } from 'vitest';
import { reduceCopyFunnel, forecastToTarget, type RawFunnelView, type RuleInfo } from './copyFunnel';

const DAY = '2026-05-30T15:00:00.000Z'; // BRT 2026-05-30 12:00 → bucket 2026-05-30

function view(over: Partial<RawFunnelView>): RawFunnelView {
  return {
    stage: 'Upsell01', layer: 'black1', affName: 'Matheus Petersen', affId: '46',
    convertedStage: false, convertedAny: false, grossSession: 0, shownAt: DAY, ...over,
  };
}

// Matheus: black1 4 views (1 conv, gross 100/300/100/100), black2 4 views (3 conv, 400/400/400/200)
function matheusViews(): RawFunnelView[] {
  const b1g = [100, 300, 100, 100], b1c = [false, true, false, false];
  const b2g = [400, 400, 400, 200], b2c = [true, true, true, false];
  const rows: RawFunnelView[] = [];
  b1g.forEach((g, i) => rows.push(view({ layer: 'black1', grossSession: g, convertedStage: b1c[i], convertedAny: b1c[i] })));
  b2g.forEach((g, i) => rows.push(view({ layer: 'black2', grossSession: g, convertedStage: b2c[i], convertedAny: b2c[i] })));
  return rows;
}

const RULES = new Map<string, RuleInfo>([
  ['Matheus Petersen', { black2Pct: 50, autotune: false, keyType: 'name' }],
]);

describe('reduceCopyFunnel', () => {
  it('summary: counts, AOV overall, gap, conv', () => {
    const r = reduceCopyFunnel(matheusViews(), 220, RULES);
    expect(r.summary.totalViews).toBe(8);
    expect(r.summary.byLayer.black1).toBe(4);
    expect(r.summary.byLayer.black2).toBe(4);
    expect(r.summary.aovOverall).toBe(250); // 2000/8
    expect(r.summary.aovGap).toBe(30); // 250 - 220
    expect(r.summary.convOverall).toBe(0.5); // 4 converted / 8
  });

  it('byStage: per-layer conv/aov + lift (uses convertedStage)', () => {
    const r = reduceCopyFunnel(matheusViews(), 220, RULES);
    expect(r.byStage).toHaveLength(1);
    const s = r.byStage[0];
    expect(s.stage).toBe('Upsell01');
    expect(s.product).toBe('neu6u');
    expect(s.byLayer.black1).toMatchObject({ n: 4, converted: 1, conv: 0.25, aov: 150 });
    expect(s.byLayer.black2).toMatchObject({ n: 4, converted: 3, conv: 0.75, aov: 350 });
    expect(s.liftPp).toBe(50); // (0.75 - 0.25) * 100
  });

  it('byAffiliate: attaches currentPct/autotune from rules, computes lift', () => {
    const r = reduceCopyFunnel(matheusViews(), 220, RULES);
    expect(r.byAffiliate).toHaveLength(1);
    const a = r.byAffiliate[0];
    expect(a.key).toBe('Matheus Petersen');
    expect(a.nLeads).toBe(8);
    expect(a.currentPct).toBe(50);
    expect(a.autotune).toBe(false);
    expect(a.liftPp).toBe(50);
  });

  it('drops affiliates below MIN_AFF_SAMPLE (n<5)', () => {
    const small = [
      view({ affName: 'Tiny', affId: '999', layer: 'black1', grossSession: 100 }),
      view({ affName: 'Tiny', affId: '999', layer: 'black2', grossSession: 200 }),
    ];
    const r = reduceCopyFunnel(small, 220, new Map());
    expect(r.byAffiliate).toHaveLength(0); // only 2 leads
  });

  it('daily: one BRT-day bucket', () => {
    const r = reduceCopyFunnel(matheusViews(), 220, RULES);
    expect(r.daily).toHaveLength(1);
    expect(r.daily[0]).toMatchObject({ date: '2026-05-30', views: 8, aov: 250, convOverall: 0.5 });
  });

  it('liftPp null when a layer is missing', () => {
    const onlyB1 = [
      view({ layer: 'black1', grossSession: 100 }), view({ layer: 'black1', grossSession: 100 }),
      view({ layer: 'black1', grossSession: 100 }), view({ layer: 'black1', grossSession: 100 }),
      view({ layer: 'black1', grossSession: 100 }),
    ];
    const r = reduceCopyFunnel(onlyB1, 220, new Map());
    expect(r.byStage[0].liftPp).toBeNull();
  });

  it('empty input → zeroed summary, empty arrays', () => {
    const r = reduceCopyFunnel([], 220, new Map());
    expect(r.summary.totalViews).toBe(0);
    expect(r.summary.aovOverall).toBe(0);
    expect(r.byStage).toEqual([]);
    expect(r.byAffiliate).toEqual([]);
    expect(r.daily).toEqual([]);
    expect(r.forecast.status).toBe('insufficient');
  });
});

describe('forecastToTarget', () => {
  const d = (aov: number, views = 100) => ({ aov, views });

  it('insufficient with <3 days', () => {
    const f = forecastToTarget([d(200), d(210)], 300);
    expect(f.status).toBe('insufficient');
    expect(f.daysToTarget).toBeNull();
    expect(f.daysOfData).toBe(2);
  });

  it('eta: rising trend extrapolates days to target', () => {
    // 200→210→220→230 ($10/dia), fitted no último=230, target 300 → 7 dias
    const f = forecastToTarget([d(200), d(210), d(220), d(230)], 300);
    expect(f.status).toBe('eta');
    expect(f.slopePerDay).toBeCloseTo(10, 6);
    expect(f.currentAov).toBeCloseTo(230, 6);
    expect(f.daysToTarget).toBeCloseTo(7, 6);
    expect(f.avgDailyViews).toBe(100);
  });

  it('reached when trend already at/above target', () => {
    const f = forecastToTarget([d(310), d(320), d(330)], 300);
    expect(f.status).toBe('reached');
    expect(f.daysToTarget).toBe(0);
  });

  it('flat when AOV not rising (no ETA)', () => {
    const f = forecastToTarget([d(300), d(300), d(300)], 400);
    expect(f.status).toBe('flat');
    expect(f.daysToTarget).toBeNull();
  });
});
