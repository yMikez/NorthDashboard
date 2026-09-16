import { describe, expect, it } from 'vitest';
import {
  computeNetProfit, defaultParams, normalizeParams, emptyStages, emptyStage,
  type NetProfitInputs, type PlatformFrontInput, type StageAgg,
} from './netProfitCore';

const st = (over: Partial<StageAgg>): StageAgg => ({ ...emptyStage(), ...over });
const platform = (over: Partial<PlatformFrontInput>): PlatformFrontInput => ({
  slug: 'digistore24', displayName: 'Digistore24', feePct: 8, allowancePct: 2, refundCbPctModel: 10,
  byStage: emptyStages(), recovery: emptyStage(), sms: emptyStage(), refundsObserved: { front: 0, recovery: 0, sms: 0 },
  ...over,
});
const inputs = (over: Partial<NetProfitInputs> = {}): NetProfitInputs => ({
  period: { start: '2026-09-01T03:00:00.000Z', end: '2026-09-15T02:59:59.999Z' },
  platforms: [], callcenters: [], recoveryAffiliates: [],
  sms: { gross: 0, orders: 0, cogs: 0, fulfillment: 0, refundsObserved: 0 },
  affiliates: [], salesbound: { measured: null },
  ...over,
});

describe('computeNetProfit — FRONT: Faturamento − CPA − Reembolso/CB − Taxa − Custo de produto − Allowance', () => {
  const base = inputs({
    platforms: [platform({
      byStage: { ...emptyStages(), FRONTEND: st({ gross: 10000, cpa: 4000, orders: 40, cogs: 900, fulfillment: 300 }), UPSELL: st({ gross: 2000, cpa: 0, orders: 10, cogs: 100, fulfillment: 50 }) },
      refundsObserved: { front: 600, recovery: 0, sms: 0 },
    })],
  });
  it('reembolso OBSERVADO (data do estorno) e custo de produto pelo % REAL dos snapshots por etapa', () => {
    const r = computeNetProfit(base, defaultParams());
    const front = r.channels.find((c) => c.key === 'front')!;
    expect(front.gross).toBe(12000);
    const l = Object.fromEntries(front.lines.map((x) => [x.key, x]));
    expect(l.cpa.usd).toBe(4000);
    expect(l.refund.usd).toBe(600);
    expect(l.refund.source).toBe('observed');
    expect(l.fee.usd).toBe(960);            // 8% de 12000
    expect(l.product.usd).toBe(1350);       // FE 12% de 10000 (1200/10000) + UP 7.5% de 2000 (150/2000)
    expect(l.product.source).toBe('observed');
    expect(l.allowance.usd).toBe(240);      // 2%
    expect(front.profit).toBe(12000 - 4000 - 600 - 960 - 1350 - 240);
    expect(front.marginPct).toBe(40.42);
    expect(r.observedProductCostPct.front.FRONTEND).toBe(12);
    expect(r.observedProductCostPct.front.UPSELL).toBe(7.5);
    expect(r.kpis).toEqual({ revenue: 12000, costs: 7150, profit: 4850, marginPct: 40.42 });
  });
  it('% MANUAL de custo de produto por etapa e reembolso % fixo (projeção) vencem o observado', () => {
    const p = defaultParams();
    p.refundMode = 'manual'; p.refundPct.front = 10;
    p.productCostPct.front.FRONTEND = 20; p.productCostPct.front.UPSELL = 5;
    const front = computeNetProfit(base, p).channels[0];
    const l = Object.fromEntries(front.lines.map((x) => [x.key, x]));
    expect(l.refund.usd).toBe(1200);
    expect(l.refund.source).toBe('manual');
    expect(l.product.usd).toBe(2100);       // 20% de 10000 + 5% de 2000
    expect(l.product.source).toBe('manual');
  });
  it('override de taxa/allowance por plataforma e allowance desligável', () => {
    const p = defaultParams();
    p.feePctOverride.digistore24 = 10; p.allowancePctOverride.digistore24 = 0; p.includeAllowance = false;
    const front = computeNetProfit(base, p).channels[0];
    const l = Object.fromEntries(front.lines.map((x) => [x.key, x]));
    expect(l.fee.usd).toBe(1200);
    expect(l.fee.source).toBe('manual');
    expect(l.allowance).toBeUndefined();
  });
  it('taxa não cadastrada → linha 0 com aviso', () => {
    const r = computeNetProfit(inputs({ platforms: [platform({ feePct: null, byStage: { ...emptyStages(), FRONTEND: st({ gross: 100, orders: 1 }) } })] }), defaultParams());
    expect(r.channels[0].lines.find((l) => l.key === 'fee')).toMatchObject({ usd: 0, source: 'none' });
    expect(r.warnings.some((w) => w.includes('taxa da plataforma'))).toBe(true);
  });
});

describe('custo de produto ÚNICO (productCostDefaultPct)', () => {
  it('12% vale pra todas as etapas do front e pros outros canais; campo específico ainda sobrescreve', () => {
    const p = defaultParams(); p.productCostDefaultPct = 12; p.salesbound = { grossUsd: 1000, sales: 5, refundsUsd: 0 }; p.commissionPct.salesbound = 65;
    const inp = inputs({
      platforms: [platform({ byStage: { ...emptyStages(), FRONTEND: st({ gross: 1000, orders: 1, cogs: 50, fulfillment: 0 }), UPSELL: st({ gross: 500, orders: 1, cogs: 200, fulfillment: 0 }) } })],
      callcenters: [{ provider: 'tauk', label: 'Tauk', configured: true, gross: 2000, sales: 4, refundsObserved: 0, commissionPct: 30, commissionAssumed: false }],
    });
    const r = computeNetProfit(inp, p);
    const prod = (k: string) => r.channels.find((c) => c.key === k)!.lines.find((l) => l.key === 'product')!;
    expect(prod('front')).toMatchObject({ usd: 180, source: 'manual' });        // 12% de 1500 (não o observado 5%/40%)
    expect(prod('callcenter')).toMatchObject({ usd: 240, source: 'manual' });
    expect(prod('salesbound')).toMatchObject({ usd: 120, source: 'manual' });
    p.productCostPct.callcenter = 20;
    expect(computeNetProfit(inp, p).channels[1].lines.find((l) => l.key === 'product')!.usd).toBe(400);
    expect(normalizeParams({ productCostDefaultPct: '12' }).productCostDefaultPct).toBe(12);
  });
});

describe('dedupe da recuperação no front', () => {
  const inp = inputs({
    platforms: [platform({
      byStage: { ...emptyStages(), FRONTEND: st({ gross: 1000, orders: 10 }) },
      recovery: st({ gross: 300, orders: 3 }), sms: st({ gross: 100, orders: 1 }),
      refundsObserved: { front: 50, recovery: 30, sms: 0 },
    })],
    recoveryAffiliates: [{ affiliateId: 'r1', externalId: 'skill99', nickname: 'skill99', platformSlug: 'digistore24', gross: 300, orders: 3, cogs: 30, fulfillment: 0, commissionUsd: 90, currentPct: 30, refundsObserved: 30 }],
    sms: { gross: 100, orders: 1, cogs: 10, fulfillment: 0, refundsObserved: 0 },
  });
  it('dedupeRecovery=true (padrão): front NÃO inclui recuperação/SMS; canal Recuperação tem os dois', () => {
    const r = computeNetProfit(inp, defaultParams());
    expect(r.channels[0].gross).toBe(1000);
    expect(r.channels[0].lines.find((l) => l.key === 'refund')!.usd).toBe(50);
    const rec = r.channels.find((c) => c.key === 'recovery')!;
    expect(rec.gross).toBe(400);
    expect(rec.breakdown.map((b) => b.key)).toEqual(['aff:r1', 'sms']);
    expect(r.kpis.revenue).toBe(1400);
  });
  it('dedupeRecovery=false: front inclui (dupla contagem deliberada) e os estornos também', () => {
    const p = defaultParams(); p.dedupeRecovery = false;
    const r = computeNetProfit(inp, p);
    expect(r.channels[0].gross).toBe(1400);
    expect(r.channels[0].lines.find((l) => l.key === 'refund')!.usd).toBe(80);
    expect(r.kpis.revenue).toBe(1800);
  });
});

describe('CALL CENTERS: Faturamento − Comissão − Reembolso/CB − Custo de produto', () => {
  const inp = inputs({
    platforms: [platform({ byStage: { ...emptyStages(), FRONTEND: st({ gross: 1000, orders: 10, cogs: 100, fulfillment: 20 }) } })],
    callcenters: [
      { provider: 'tauk', label: 'Tauk', configured: true, gross: 2000, sales: 8, refundsObserved: 200, commissionPct: 35, commissionAssumed: false },
      { provider: 'logicall', label: 'Logicall', configured: true, gross: 1000, sales: 4, refundsObserved: 0, commissionPct: 35, commissionAssumed: true },
    ],
  });
  it('comissão do setting (assumida marcada), custo de produto cai no observado do front FE quando não informado', () => {
    const cc = computeNetProfit(inp, defaultParams()).channels.find((c) => c.key === 'callcenter')!;
    expect(cc.gross).toBe(3000);
    const l = Object.fromEntries(cc.lines.map((x) => [x.key, x]));
    expect(l.commission.usd).toBe(1050);
    expect(l.refund.usd).toBe(200);
    expect(l.product.usd).toBe(360);        // 12% (observado FE) de 3000
    expect(cc.profit).toBe(3000 - 1050 - 200 - 360);
    const lc = cc.breakdown.find((b) => b.key === 'logicall')!;
    expect(lc.lines.find((x) => x.key === 'commission')!.note).toContain('assumida');
  });
  it('comissão e custo manuais por canal', () => {
    const p = defaultParams(); p.commissionPct.logicall = 20; p.productCostPct.callcenter = 10;
    const cc = computeNetProfit(inp, p).channels.find((c) => c.key === 'callcenter')!;
    const lc = cc.breakdown.find((b) => b.key === 'logicall')!;
    expect(lc.lines.find((x) => x.key === 'commission')!.usd).toBe(200);
    expect(cc.lines.find((x) => x.key === 'product')!.usd).toBe(300);
  });
});

describe('SALESBOUND: manual enquanto não há dado medido', () => {
  it('sem faturamento → canal indisponível; com manual → fórmula e avisos do que falta', () => {
    const r0 = computeNetProfit(inputs(), defaultParams());
    expect(r0.channels.find((c) => c.key === 'salesbound')!.available).toBe(false);
    const p = defaultParams(); p.salesbound = { grossUsd: 5000, sales: 20, refundsUsd: 250 };
    const r = computeNetProfit(inputs(), p);
    const sb = r.channels.find((c) => c.key === 'salesbound')!;
    expect(sb.available).toBe(true);
    expect(sb.gross).toBe(5000);
    expect(sb.orders).toBe(20);
    expect(sb.lines.find((l) => l.key === 'refund')!.usd).toBe(250);
    expect(r.warnings).toEqual(expect.arrayContaining([expect.stringContaining('SalesBound: comissão'), expect.stringContaining('SalesBound: custo')]));
    p.commissionPct.salesbound = 25; p.productCostPct.salesbound = 12;
    const r2 = computeNetProfit(inputs(), p);
    expect(r2.channels.find((c) => c.key === 'salesbound')!.profit).toBe(5000 - 250 - 1250 - 600);
    expect(r2.warnings).toEqual([]);
  });
  it('medido (fase 2) vence o manual', () => {
    const p = defaultParams(); p.salesbound.grossUsd = 999; p.commissionPct.salesbound = 10; p.productCostPct.salesbound = 10;
    const r = computeNetProfit(inputs({ salesbound: { measured: { gross: 100, sales: 1, refunds: 10 } } }), p);
    const sb = r.channels.find((c) => c.key === 'salesbound')!;
    expect(sb.gross).toBe(100);
    expect(sb.lines.find((l) => l.key === 'refund')).toMatchObject({ usd: 10, source: 'observed' });
  });
});

describe('totais, participações e afiliados', () => {
  const inp = inputs({
    platforms: [
      platform({ byStage: { ...emptyStages(), FRONTEND: st({ gross: 6000, cpa: 2000, orders: 20, cogs: 600, fulfillment: 0 }) }, refundsObserved: { front: 300, recovery: 0, sms: 0 } }),
      platform({ slug: 'buygoods', displayName: 'BuyGoods', feePct: 5, allowancePct: null, byStage: { ...emptyStages(), FRONTEND: st({ gross: 4000, cpa: 1000, orders: 10, cogs: 400, fulfillment: 0 }) } }),
    ],
    callcenters: [{ provider: 'tauk', label: 'Tauk', configured: true, gross: 1000, sales: 4, refundsObserved: 0, commissionPct: 35, commissionAssumed: false }],
    affiliates: [
      { affiliateId: 'a1', externalId: 'maria', nickname: 'Maria', platformSlug: 'digistore24', mappedName: 'Maria Silva', byStage: { ...emptyStages(), FRONTEND: st({ gross: 6000, cpa: 2000, orders: 20 }) }, refundsObserved: 300 },
      { affiliateId: 'a2', externalId: '46', nickname: 'Tayllan', platformSlug: 'buygoods', mappedName: null, byStage: { ...emptyStages(), FRONTEND: st({ gross: 4000, cpa: 1000, orders: 10 }) }, refundsObserved: 0 },
    ],
  });
  it('faturamento total, custos = faturamento − lucro, margem, % de cada canal no faturamento e no lucro', () => {
    const r = computeNetProfit(inp, defaultParams());
    expect(r.kpis.revenue).toBe(11000);
    const front = r.channels[0]; const cc = r.channels[1];
    expect(front.shareOfRevenuePct).toBe(90.91);
    expect(cc.shareOfRevenuePct).toBe(9.09);
    expect(r2sum(r.channels.map((c) => c.shareOfProfitPct))).toBeCloseTo(100, 0);
    expect(r.kpis.costs).toBe(r.kpis.revenue - r.kpis.profit);
    expect(r.kpis.marginPct).toBe(Math.round((r.kpis.profit / r.kpis.revenue) * 10000) / 100);
  });
  it('afiliado replica a fórmula do front com a taxa/allowance da PRÓPRIA plataforma e o custo por etapa; % do total e do canal', () => {
    const r = computeNetProfit(inp, defaultParams());
    const maria = r.affiliates.find((a) => a.affiliateId === 'a1')!;
    // FE observado: (600+400)/(6000+4000) = 10%
    expect(maria).toMatchObject({ gross: 6000, cpa: 2000, refund: 300, fee: 480, productCost: 600, allowance: 120, channel: 'front', mappedName: 'Maria Silva' });
    expect(maria.profit).toBe(6000 - 2000 - 300 - 480 - 600 - 120);
    expect(maria.shareOfRevenuePct).toBe(54.55);   // 6000 / 11000
    expect(maria.shareOfChannelPct).toBe(60);      // 6000 / 10000
    const tayllan = r.affiliates.find((a) => a.affiliateId === 'a2')!;
    expect(tayllan).toMatchObject({ fee: 200, allowance: 0 });   // BG 5%, sem allowance cadastrado
    expect(r.affiliates[0].affiliateId).toBe('a1');  // ordenado por faturamento
  });
  it('afiliado de recuperação entra com comissão no lugar do CPA e canal recovery', () => {
    const r = computeNetProfit(inputs({
      platforms: [platform({ byStage: { ...emptyStages(), FRONTEND: st({ gross: 1000, orders: 5, cogs: 100, fulfillment: 0 }) } })],
      recoveryAffiliates: [{ affiliateId: 'r1', externalId: 'skill99', nickname: null, platformSlug: 'digistore24', gross: 500, orders: 5, cogs: 50, fulfillment: 0, commissionUsd: 150, currentPct: 30, refundsObserved: 25 }],
    }), defaultParams());
    const s = r.affiliates.find((a) => a.affiliateId === 'r1')!;
    expect(s).toMatchObject({ channel: 'recovery', cpa: 150, refund: 25, productCost: 50, fee: 0, allowance: 0, profit: 275 });
    const p = defaultParams(); p.commissionPct.recoveryOverride = 20;
    expect(computeNetProfit(inputs({ recoveryAffiliates: [{ affiliateId: 'r1', externalId: 'skill99', nickname: null, platformSlug: 'digistore24', gross: 500, orders: 5, cogs: 0, fulfillment: 0, commissionUsd: 150, currentPct: 30, refundsObserved: 0 }] }), p).affiliates[0].cpa).toBe(100);
  });
});

describe('normalizeParams', () => {
  it('sanitiza JSON solto: strings numéricas, fora de faixa, chaves estranhas; defaults nos ausentes', () => {
    const p = normalizeParams({
      refundMode: 'manual', refundPct: { front: '7.5', callcenter: 150, recovery: -1 },
      productCostPct: { front: { FRONTEND: '11', UPSELL: 'x' }, callcenter: 9 },
      feePctOverride: { digistore24: '8.37', 'bad key!': 5, jvzoo: 200 },
      commissionPct: { tauk: 40, sms: null }, salesbound: { grossUsd: '1234.567', refundsUsd: -5 },
      dedupeRecovery: false, includeAllowance: 'no',
    });
    expect(p.refundMode).toBe('manual');
    expect(p.refundPct).toEqual({ front: 7.5, callcenter: null, recovery: null, salesbound: null });
    expect(p.productCostPct.front).toEqual({ FRONTEND: 11, UPSELL: null, DOWNSELL: null, BUMP: null, SMS_RECOVERY: null });
    expect(p.productCostPct.callcenter).toBe(9);
    expect(p.feePctOverride).toEqual({ digistore24: 8.37 });
    expect(p.commissionPct).toMatchObject({ tauk: 40, sms: 0, logicall: null });
    expect(p.salesbound).toEqual({ grossUsd: 1234.57, sales: null, refundsUsd: null });
    expect(p.dedupeRecovery).toBe(false);
    expect(p.includeAllowance).toBe(true);
    expect(normalizeParams(null)).toEqual(defaultParams());
    expect(normalizeParams('x')).toEqual(defaultParams());
  });
});

function r2sum(list: number[]): number { return list.reduce((s, v) => s + v, 0); }
