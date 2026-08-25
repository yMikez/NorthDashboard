import { describe, expect, it } from 'vitest';
import {
  windowRanges, sumRange, latestCpaInRange, metricsFor, mergeMetrics, pctDelta, trendTag, explainChange, rankBy,
  ZERO_BUCKET, type Bucket, type RateInputs,
} from './affiliateAnalysisCore';

const rates: RateInputs = { slug: 'jvzoo', feePct: 5, refundCbPct: 15, opexPct: 10, thresholds: { healthyMinUsd: 10, attentionMinUsd: 0 } };
const b = (over: Partial<Bucket>): Bucket => ({ ...ZERO_BUCKET, ...over });

describe('windowRanges / sumRange', () => {
  it('janela de 7 termina no último dia e a anterior encosta nela', () => {
    const { cur, prev } = windowRanges(7, 119);
    expect(cur).toEqual({ from: 113, to: 119 });
    expect(prev).toEqual({ from: 106, to: 112 });
  });
  it('soma buckets, conta dias ativos e devolve série diária com zeros', () => {
    const m = new Map<number, Bucket>([[118, b({ approved: 2, revenue: 100, feApproved: 1 })], [119, b({ approved: 1, revenue: 50, feApproved: 1 })]]);
    const r = sumRange(m, { from: 117, to: 119 });
    expect(r.bucket.revenue).toBe(150);
    expect(r.activeDays).toBe(2);
    expect(r.daily).toEqual([0, 100, 50]);
  });
  it('latestCpaInRange pega o último CPA DENTRO da janela; fora dela = desconhecido (paridade com a aba)', () => {
    const cpa = new Map<number, number>([[100, 230], [115, 250], [119, 245]]);
    expect(latestCpaInRange(cpa, { from: 113, to: 119 })).toBe(245);
    expect(latestCpaInRange(cpa, { from: 113, to: 118 })).toBe(250);
    expect(latestCpaInRange(cpa, { from: 106, to: 112 })).toBe(0); // CPA de 40 dias atrás não vale
  });
});

describe('metricsFor — modelo CPA', () => {
  it('AOV = receita ÷ FEs; NET AOV = AOV × (1 − 30%); NET after CPA = NET AOV − CPA; total × FEs', () => {
    const m = metricsFor(b({ allOrders: 12, approved: 10, refunds: 1, chargebacks: 0, revenue: 3000, feApproved: 8, feRevenue: 2000, backendRevenue: 1000, backendApproved: 2 }), 5, 7, 250, rates);
    expect(m.aov).toBe(375);
    expect(m.netAov).toBe(262.5);
    expect(m.netAfterCpa).toBe(12.5);
    expect(m.netAfterCpaTotal).toBe(100);
    expect(m.cpaStatus).toBe('saudavel');
    expect(m.feTicket).toBe(250);
    expect(m.backendPerFe).toBe(125);
    expect(m.backendTakeRate).toBe(0.25);
    expect(m.refundRate).toBeCloseTo(1 / 12, 4);
    expect(m.sales).toBe(10);
  });
  it('Digistore: linha de estorno é extra → sai do denominador (pedidos reais)', () => {
    const m = metricsFor(b({ allOrders: 12, approved: 10, refunds: 2 }), 1, 3, 0, { ...rates, slug: 'digistore24' });
    expect(m.realOrders).toBe(10);
    expect(m.refundRate).toBe(0.2);
    expect(m.netAfterCpa).toBeNull();
  });
});

describe('mergeMetrics — parceiro = contas somadas', () => {
  it('conta sem CPA (revshare) não dilui o CPA/venda do parceiro; NET AOV − CPA fecha com Net após CPA', () => {
    const a = metricsFor(b({ allOrders: 10, approved: 10, revenue: 4000, feApproved: 10 }), 7, 7, 250, rates); // netAov 280 → nAfter 30
    const c = metricsFor(b({ allOrders: 10, approved: 10, revenue: 4000, feApproved: 10 }), 7, 7, 0, rates);   // sem CPA
    const m = mergeMetrics([a, c], rates.thresholds);
    expect(m.cpaPerFe).toBe(250);
    expect(m.netAfterCpaTotal).toBe(300);
    expect(m.netAfterCpa).toBe(30);
    expect(m.netAov - m.cpaPerFe).toBe(m.netAfterCpa); // mesma base
  });

  it('soma totais, pondera CPA/NET por FEs e re-deriva taxas', () => {
    const a = metricsFor(b({ allOrders: 10, approved: 10, revenue: 4000, feApproved: 10 }), 7, 7, 250, rates);           // net aov 280, nAfter 30, total 300
    const c = metricsFor(b({ allOrders: 10, approved: 8, refunds: 2, revenue: 2000, feApproved: 5 }), 7, 7, 200, { ...rates, slug: 'buygoods' }); // aov 400 → 280, nAfter 80, total 400
    const m = mergeMetrics([a, c], rates.thresholds);
    expect(m.revenue).toBe(6000);
    expect(m.feApproved).toBe(15);
    expect(m.aov).toBe(400);
    expect(m.netAfterCpaTotal).toBe(700);
    expect(m.netAfterCpa).toBeCloseTo(700 / 15, 2);
    expect(m.cpaPerFe).toBeCloseTo((250 * 10 + 200 * 5) / 15, 2);
    expect(m.refundRate).toBe(0.1);
    expect(m.sales).toBe(18);
  });
});

describe('trendTag', () => {
  const mk = (revenue: number, fe = 1) => metricsFor(b({ approved: fe, allOrders: fe, revenue, feApproved: fe }), 1, 7, 0, rates);
  it('novo / churn / breakout / crescimento / queda / queda forte / estável', () => {
    expect(trendTag(mk(100), mk(0), [100])).toBe('novo');
    expect(trendTag(mk(0), mk(100), [0])).toBe('churn');
    expect(trendTag(mk(400), mk(100), [100, 100, 100, 100])).toBe('breakout');
    expect(trendTag(mk(130), mk(100), [30, 30, 35, 35])).toBe('crescimento');
    expect(trendTag(mk(70), mk(100), [17, 18, 17, 18])).toBe('queda');
    expect(trendTag(mk(30), mk(100), [7, 8, 7, 8])).toBe('queda_forte');
    expect(trendTag(mk(105), mk(100), [26, 26, 27, 26])).toBe('estavel');
  });
  it('volátil quando as metades da janela divergem ≥ 50%', () => {
    expect(trendTag(mk(100), mk(100), [50, 40, 5, 5])).toBe('volatil');
  });
});

describe('explainChange — decomposição exata', () => {
  it('efeito volume + efeito AOV fecham com Δreceita', () => {
    const prev = metricsFor(b({ allOrders: 100, approved: 100, revenue: 30000, feApproved: 100, feRevenue: 20000, backendRevenue: 10000, backendApproved: 40 }), 7, 7, 250, rates);
    const cur = metricsFor(b({ allOrders: 60, approved: 60, revenue: 21000, feApproved: 60, feRevenue: 15000, backendRevenue: 6000, backendApproved: 12 }), 4, 7, 250, rates);
    const d = explainChange(cur, prev, new Map([['A', 21000]]), new Map([['A', 30000]]));
    const vol = d.find((x) => x.kind === 'volume')!;
    const aov = d.find((x) => x.kind === 'aov')!;
    expect(vol.impactUsd! + aov.impactUsd!).toBeCloseTo(cur.revenue - prev.revenue, 1);
    expect(vol.impactUsd).toBe(-12000); // (60-100) × 300
    expect(aov.impactUsd).toBe(3000);   // 60 × (350-300)
    expect(d[0].kind).toBe('volume');   // maior impacto primeiro
    expect(d.some((x) => x.kind === 'active_days' && x.tone === 'down')).toBe(true);
    expect(d.some((x) => x.kind === 'backend')).toBe(true); // take rate 40% → 20%
  });
  it('sem FE numa das janelas (só upsell órfão) o Δ inteiro vai pro volume — nada de efeito fantasma', () => {
    const prev = metricsFor(b({ allOrders: 10, approved: 10, revenue: 3000, feApproved: 10 }), 7, 7, 0, rates);
    const cur = metricsFor(b({ allOrders: 2, approved: 2, revenue: 500, feApproved: 0, backendApproved: 2, backendRevenue: 500 }), 2, 7, 0, rates);
    const d = explainChange(cur, prev, new Map(), new Map());
    const vol = d.find((x) => x.kind === 'volume')!;
    expect(vol.impactUsd).toBe(-2500);
    expect(d.find((x) => x.kind === 'aov')).toBeUndefined();
  });

  it('decomposição fecha mesmo com AOV "quebrado" (sem driver Δ receita espúrio)', () => {
    const prev = metricsFor(b({ allOrders: 333, approved: 333, revenue: 99999.99, feApproved: 333, feRevenue: 70000, backendRevenue: 29999.99 }), 7, 7, 0, rates);
    const cur = metricsFor(b({ allOrders: 271, approved: 271, revenue: 88888.88, feApproved: 271, feRevenue: 60000, backendRevenue: 28888.88 }), 7, 7, 0, rates);
    const d = explainChange(cur, prev, new Map(), new Map());
    const sum = d.filter((x) => x.kind === 'volume' || x.kind === 'aov').reduce((n, x) => n + (x.impactUsd ?? 0), 0);
    expect(sum).toBeCloseTo(cur.revenue - prev.revenue, 1);
    expect(d.filter((x) => x.kind === 'volume')).toHaveLength(1);
  });

  it('mix de família aparece quando o share muda ≥ 15pp', () => {
    const prev = metricsFor(b({ allOrders: 50, approved: 50, revenue: 10000, feApproved: 50 }), 7, 7, 0, rates);
    const cur = metricsFor(b({ allOrders: 50, approved: 50, revenue: 10000, feApproved: 50 }), 7, 7, 0, rates);
    const d = explainChange(cur, prev, new Map([['Neuro', 3000], ['Glyco', 7000]]), new Map([['Neuro', 9000], ['Glyco', 1000]]));
    expect(d.find((x) => x.kind === 'mix')?.title).toContain('Neuro');
  });
  it('CPA renegociado vira driver com impacto', () => {
    const prev = metricsFor(b({ allOrders: 10, approved: 10, revenue: 4000, feApproved: 10 }), 7, 7, 230, rates);
    const cur = metricsFor(b({ allOrders: 10, approved: 10, revenue: 4000, feApproved: 10 }), 7, 7, 250, rates);
    const d = explainChange(cur, prev, new Map(), new Map());
    const cpa = d.find((x) => x.kind === 'cpa')!;
    expect(cpa.impactUsd).toBe(-200);
    expect(cpa.tone).toBe('down');
  });
});

describe('pctDelta / rankBy', () => {
  it('pctDelta null sem base', () => {
    expect(pctDelta(10, 0)).toBeNull();
    expect(pctDelta(150, 100)).toBe(0.5);
  });
  it('rankBy desc com desempate e asc pra reembolso', () => {
    const rows = [{ key: 'a', v: 10, r: 5 }, { key: 'b', v: 10, r: 9 }, { key: 'c', v: 3, r: 1 }];
    const desc = rankBy(rows, (x) => x.v, (x) => x.r);
    expect([desc.get('b'), desc.get('a'), desc.get('c')]).toEqual([1, 2, 3]);
    const asc = rankBy(rows, (x) => x.v, (x) => x.r, true);
    expect(asc.get('c')).toBe(1);
  });
});
