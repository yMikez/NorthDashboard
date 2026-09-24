import { describe, expect, it } from 'vitest';
import {
  computeNetProfit, defaultParams, diffParams, normalizeParams, emptyStages, emptyStage,
  type CallCenterProviderInput, type NetProfitInputs, type PlatformFrontInput, type RecoveryAffiliateInput, type StageAgg,
} from './netProfitCore';

const st = (over: Partial<StageAgg>): StageAgg => ({ ...emptyStage(), ...over });
const platform = (over: Partial<PlatformFrontInput>): PlatformFrontInput => ({
  slug: 'digistore24', displayName: 'Digistore24', feePct: 8, allowancePct: 2, refundCbPctModel: 10,
  byStage: emptyStages(), recovery: emptyStage(), sms: emptyStage(), refundsObserved: { front: 0, recovery: 0, sms: 0 },
  ...over,
});
const cc = (over: Partial<CallCenterProviderInput>): CallCenterProviderInput => ({
  provider: 'tauk', label: 'Tauk', configured: true, gross: 0, sales: 0, refundsObserved: 0, refundsReported: false, commissionPct: 30, commissionAssumed: false,
  ...over,
});
const recAff = (over: Partial<RecoveryAffiliateInput>): RecoveryAffiliateInput => ({
  affiliateId: 'r1', externalId: 'skill99', nickname: 'skill99', platformSlug: 'digistore24', gross: 0, orders: 0, feOrders: 0, cogs: 0, fulfillment: 0, commissionUsd: 0, currentPct: 30, refundsObserved: 0,
  ...over,
});
const inputs = (over: Partial<NetProfitInputs> = {}): NetProfitInputs => ({
  period: { start: '2026-09-01T03:00:00.000Z', end: '2026-09-15T02:59:59.999Z' },
  platforms: [], callcenters: [], recoveryAffiliates: [],
  sms: { gross: 0, orders: 0, cogs: 0, fulfillment: 0, refundsObserved: 0 },
  affiliates: [], salesbound: { measured: null },
  ...over,
});
const lineOf = (lines: Array<{ key: string }>, key: string) => lines.find((l) => l.key === key) as { usd: number; source: string; kind: string; note?: string } | undefined;

describe('calculo_margem_northscale.md — reproduz o exemplo oficial (§1–§9)', () => {
  // Gross JVZoo 513.000 · 1.241 FEs · afiliados 308.948,96 · refund 20% · fee
  // 8,5% · reserva 5% · produto 12% · Logicall 23.916 (NS 70%) · TAUK 16.000
  // (NS 70%) · SalesBound 29.000 (NS 50%) · buffer 2%.
  const inp = inputs({
    platforms: [platform({
      slug: 'jvzoo', displayName: 'JVZoo', feePct: 9, allowancePct: 5,
      byStage: { ...emptyStages(), FRONTEND: st({ gross: 513000, cpa: 308948.96, orders: 1241, cogs: 0, fulfillment: 0 }) },
      refundsObserved: { front: 12345, recovery: 0, sms: 0 },
    })],
    callcenters: [
      cc({ provider: 'logicall', label: 'Logicall', gross: 23916, sales: 50, refundsReported: true }),
      cc({ provider: 'tauk', label: 'Tauk', gross: 16000, sales: 30 }),
    ],
    salesbound: { measured: { gross: 29000, sales: 20, refunds: 0 } },
  });
  const p = defaultParams();
  p.refundMode = 'manual'; p.refundPct.front = 20;
  p.feePctOverride.jvzoo = 8.5;
  p.productCostDefaultPct = 12;
  p.commissionPct.tauk = 30; p.commissionPct.logicall = 30; p.commissionPct.salesbound = 50;
  p.riskBufferPct = 2;
  const r = computeNetProfit(inp, p);

  it('backend líquido (§2.6) e receita econômica (§3)', () => {
    const ch = (k: string) => r.channels.find((c) => c.key === k)!;
    expect(ch('callcenter').revenue).toBe(27941.2);           // 16.741,20 + 11.200
    expect(ch('salesbound').revenue).toBe(14500);
    expect(r.kpis.backendNet).toBe(42441.2);
    expect(r.kpis.platformGross).toBe(513000);
    expect(r.kpis.revenue).toBe(555441.2);
    expect(r.kpis.grossTotal).toBe(513000 + 23916 + 16000 + 29000);
  });
  it('custos variáveis linha a linha (§2.2–§2.5, §4)', () => {
    const front = r.channels.find((c) => c.key === 'front')!;
    expect(lineOf(front.lines, 'cpa')!.usd).toBe(308948.96);
    expect(lineOf(front.lines, 'refund')!.usd).toBe(102600);
    expect(lineOf(front.lines, 'fee')!.usd).toBe(43605);
    expect(lineOf(front.lines, 'allowance')!.usd).toBe(25650);
    expect(lineOf(front.lines, 'product')!.usd).toBe(61560);
    expect(r.kpis.costs).toBe(542363.96);
  });
  it('lucro de contribuição, margem oficial, margem sobre gross, lucro por FE, CPA médio (§2.1, §5–§7)', () => {
    expect(r.kpis.profit).toBe(13077.24);
    expect(r.kpis.marginPct).toBe(2.35);
    expect(r.kpis.marginOnGrossPct).toBe(2.55);
    expect(r.kpis.fes).toBe(1241);
    expect(r.kpis.profitPerFe).toBe(10.54);
    expect(r.kpis.cpaAvg).toBe(248.95);
  });
  it('buffer de risco em linha separada (§9) sem mexer no lucro oficial', () => {
    expect(r.kpis.buffer).toEqual({ pct: 2, usd: 11108.82, adjustedProfit: 1968.42, adjustedMarginPct: 0.35 });
    expect(computeNetProfit(inp, { ...p, riskBufferPct: null }).kpis.buffer).toBeNull();
  });
  it('backend não recebe reembolso projetado nem custo de produto (§10.1–§10.2)', () => {
    const cch = r.channels.find((c) => c.key === 'callcenter')!;
    expect(cch.type).toBe('backend');
    expect(cch.costs).toBe(0);
    expect(cch.lines.every((l) => l.kind === 'share')).toBe(true);
  });
});

describe('PLATAFORMAS: Gross − Afiliados − Reembolso − Fee − Produto − Reserva', () => {
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
    expect(front.revenue).toBe(12000);
    expect(front.fes).toBe(40);
    const l = Object.fromEntries(front.lines.map((x) => [x.key, x]));
    expect(l.cpa.usd).toBe(4000);
    expect(l.refund).toMatchObject({ usd: 600, source: 'observed', kind: 'cost' });
    expect(l.fee.usd).toBe(960);            // 8% de 12000
    expect(l.product).toMatchObject({ usd: 1350, source: 'observed' });  // FE 12% de 10000 + UP 7.5% de 2000
    expect(l.allowance.usd).toBe(240);      // 2%
    expect(front.profit).toBe(12000 - 4000 - 600 - 960 - 1350 - 240);
    expect(front.marginPct).toBe(40.42);
    expect(r.observedProductCostPct.front).toMatchObject({ FRONTEND: 12, UPSELL: 7.5 });
    expect(r.kpis).toMatchObject({ revenue: 12000, costs: 7150, profit: 4850, marginPct: 40.42, marginOnGrossPct: 40.42, fes: 40, profitPerFe: 121.25, cpaAvg: 100 });
  });
  it('% MANUAL de custo por etapa e reembolso % fixo (projeção sobre o gross) vencem o observado', () => {
    const p = defaultParams();
    p.refundMode = 'manual'; p.refundPct.front = 10;
    p.productCostPct.front.FRONTEND = 20; p.productCostPct.front.UPSELL = 5;
    const front = computeNetProfit(base, p).channels[0];
    expect(lineOf(front.lines, 'refund')).toMatchObject({ usd: 1200, source: 'manual' });
    expect(lineOf(front.lines, 'product')).toMatchObject({ usd: 2100, source: 'manual' });
  });
  it('override de taxa/reserva por plataforma e reserva desligável', () => {
    const p = defaultParams();
    p.feePctOverride.digistore24 = 10; p.allowancePctOverride.digistore24 = 0; p.includeAllowance = false;
    const front = computeNetProfit(base, p).channels[0];
    expect(lineOf(front.lines, 'fee')).toMatchObject({ usd: 1200, source: 'manual' });
    expect(lineOf(front.lines, 'allowance')).toBeUndefined();
  });
  it('taxa não cadastrada → linha 0 com aviso', () => {
    const r = computeNetProfit(inputs({ platforms: [platform({ feePct: null, byStage: { ...emptyStages(), FRONTEND: st({ gross: 100, orders: 1 }) } })] }), defaultParams());
    expect(lineOf(r.channels[0].lines, 'fee')).toMatchObject({ usd: 0, source: 'none' });
    expect(r.warnings.some((w) => w.includes('taxa da plataforma'))).toBe(true);
  });
});

describe('custo de produto ÚNICO (productCostDefaultPct)', () => {
  it('12% vale pras vendas de plataforma (front e recuperação); backend só com % por canal', () => {
    const p = defaultParams(); p.productCostDefaultPct = 12; p.salesbound = { grossUsd: 1000, sales: 5, refundsUsd: 0 }; p.commissionPct.salesbound = 50;
    const inp = inputs({
      platforms: [platform({ byStage: { ...emptyStages(), FRONTEND: st({ gross: 1000, orders: 1, cogs: 50, fulfillment: 0 }), UPSELL: st({ gross: 500, orders: 1, cogs: 200, fulfillment: 0 }) } })],
      callcenters: [cc({ gross: 2000, sales: 4 })],
      recoveryAffiliates: [recAff({ gross: 500, orders: 5, feOrders: 5, commissionUsd: 150 })],
    });
    const r = computeNetProfit(inp, p);
    const prod = (k: string) => lineOf(r.channels.find((c) => c.key === k)!.lines, 'product');
    expect(prod('front')).toMatchObject({ usd: 180, source: 'manual' });        // 12% de 1500 (não o observado)
    expect(prod('recovery')).toMatchObject({ usd: 60, source: 'manual' });
    expect(prod('callcenter')).toBeUndefined();
    expect(prod('salesbound')).toBeUndefined();
    p.productCostPct.callcenter = 10;
    // custo por canal incide sobre a base líquida (2000 − 0 estorno) e entra como CUSTO
    const cch = computeNetProfit(inp, p).channels.find((c) => c.key === 'callcenter')!;
    expect(lineOf(cch.lines, 'product')).toMatchObject({ usd: 200, kind: 'cost' });
    expect(cch.revenue).toBe(1400);
    expect(cch.profit).toBe(1200);
    expect(normalizeParams({ productCostDefaultPct: '12' }).productCostDefaultPct).toBe(12);
  });
});

describe('dedupe da recuperação no front', () => {
  const inp = inputs({
    platforms: [platform({
      byStage: { ...emptyStages(), FRONTEND: st({ gross: 1000, orders: 10 }) },
      recovery: { ...st({ gross: 300, orders: 3 }), feOrders: 3 }, sms: { ...st({ gross: 100, orders: 1 }), feOrders: 1 },
      refundsObserved: { front: 50, recovery: 30, sms: 0 },
    })],
    recoveryAffiliates: [recAff({ gross: 300, orders: 3, feOrders: 3, cogs: 30, commissionUsd: 90, refundsObserved: 30 })],
    sms: { gross: 100, orders: 1, feOrders: 1, cogs: 10, fulfillment: 0, refundsObserved: 0 },
  });
  it('dedupeRecovery=true (padrão): front NÃO inclui recuperação/SMS; canal Recuperação tem os dois', () => {
    const r = computeNetProfit(inp, defaultParams());
    expect(r.channels[0].gross).toBe(1000);
    expect(lineOf(r.channels[0].lines, 'refund')!.usd).toBe(50);
    const rec = r.channels.find((c) => c.key === 'recovery')!;
    expect(rec.gross).toBe(400);
    expect(rec.fes).toBe(4);
    expect(rec.breakdown.map((b) => b.key)).toEqual(['aff:r1', 'sms']);
    expect(r.kpis.revenue).toBe(1400);
    expect(r.kpis.fes).toBe(14);
  });
  it('CPA médio é só do FRONT: a comissão do afiliado de recuperação não entra (regra do Ranking)', () => {
    const r = computeNetProfit(inputs({
      platforms: [platform({ byStage: { ...emptyStages(), FRONTEND: st({ gross: 10000, cpa: 2450, orders: 10 }) } })],
      recoveryAffiliates: [recAff({ gross: 3000, orders: 20, feOrders: 20, commissionUsd: 750 })],
    }), defaultParams());
    expect(r.kpis.affiliateCost).toBe(3200);      // CPA + comissão (custo total de afiliados)
    expect(r.kpis.fes).toBe(30);                   // lucro/FE segue sobre todas as FEs
    expect(r.kpis.cpaAvg).toBe(245);               // 2450 ÷ 10 FEs do front — não (3200 ÷ 30 = 106,67)
  });
  it('dedupeRecovery=false: front inclui (dupla contagem deliberada) e os estornos também', () => {
    const p = defaultParams(); p.dedupeRecovery = false;
    const r = computeNetProfit(inp, p);
    expect(r.channels[0].gross).toBe(1400);
    expect(lineOf(r.channels[0].lines, 'refund')!.usd).toBe(80);
    expect(r.kpis.revenue).toBe(1800);
  });
  it('recuperação é venda de plataforma: paga fee e reserva da plataforma do afiliado/da venda SMS', () => {
    const rec = computeNetProfit(inp, defaultParams()).channels.find((c) => c.key === 'recovery')!;
    expect(lineOf(rec.lines, 'fee')!.usd).toBe(32);        // 8% de 300 + 8% de 100
    expect(lineOf(rec.lines, 'allowance')!.usd).toBe(8);   // 2% de 400
    const p = defaultParams(); p.refundMode = 'manual'; p.refundPct.front = 10;
    const rec2 = computeNetProfit(inp, p).channels.find((c) => c.key === 'recovery')!;
    expect(lineOf(rec2.lines, 'refund')!.usd).toBe(40);    // % do front quando recuperação vazio
    p.refundPct.recovery = 5;
    expect(lineOf(computeNetProfit(inp, p).channels.find((c) => c.key === 'recovery')!.lines, 'refund')!.usd).toBe(20);
  });
});

describe('BACKEND: call centers — parcela líquida da NorthScale', () => {
  const inp = inputs({
    callcenters: [
      cc({ provider: 'tauk', label: 'Tauk', gross: 2000, sales: 8, refundsObserved: 0, commissionPct: 35 }),
      cc({ provider: 'logicall', label: 'Logicall', gross: 1000, sales: 4, refundsObserved: 200, refundsReported: true, commissionPct: 35, commissionAssumed: true }),
    ],
  });
  it('receita NS = (bruto − estorno do parceiro) × (100 − parcela)%; nada entra como custo', () => {
    const cch = computeNetProfit(inp, defaultParams()).channels.find((c) => c.key === 'callcenter')!;
    expect(cch.gross).toBe(3000);
    const lc = cch.breakdown.find((b) => b.key === 'logicall')!;
    expect(lineOf(lc.lines, 'refund')).toMatchObject({ usd: 200, kind: 'share', source: 'observed' });
    expect(lineOf(lc.lines, 'commission')).toMatchObject({ usd: 280, kind: 'share' });   // 35% de 800
    expect(lineOf(lc.lines, 'commission')!.note).toContain('assumida');
    expect(lc.revenue).toBe(520);
    const tauk = cch.breakdown.find((b) => b.key === 'tauk')!;
    expect(lineOf(tauk.lines, 'refund')).toMatchObject({ usd: 0, source: 'none' });     // Tauk não informa estorno
    expect(tauk.revenue).toBe(1300);
    expect(cch.revenue).toBe(1820);
    expect(cch.costs).toBe(0);
    expect(cch.profit).toBe(1820);
  });
  it('backendNetOfRefunds=false segue o md literal: bruto × parcela NS', () => {
    const p = defaultParams(); p.backendNetOfRefunds = false; p.commissionPct.logicall = 30;
    const lc = computeNetProfit(inp, p).channels.find((c) => c.key === 'callcenter')!.breakdown.find((b) => b.key === 'logicall')!;
    expect(lineOf(lc.lines, 'refund')).toBeUndefined();
    expect(lc.revenue).toBe(700);
  });
});

describe('SALESBOUND: export do CRM (medido) ou manual', () => {
  it('sem dado → indisponível; manual → parcela líquida e aviso sem parcela', () => {
    const r0 = computeNetProfit(inputs(), defaultParams());
    expect(r0.channels.find((c) => c.key === 'salesbound')!.available).toBe(false);
    expect(r0.salesbound.mode).toBe('none');
    const p = defaultParams(); p.salesbound = { grossUsd: 5000, sales: 20, refundsUsd: 250 };
    const r = computeNetProfit(inputs(), p);
    const sb = r.channels.find((c) => c.key === 'salesbound')!;
    expect(sb).toMatchObject({ available: true, gross: 5000, orders: 20, type: 'backend' });
    expect(lineOf(sb.lines, 'refund')).toMatchObject({ usd: 250, source: 'manual' });
    expect(r.warnings).toEqual(expect.arrayContaining([expect.stringContaining('SalesBound: parcela')]));
    expect(r.salesbound.mode).toBe('manual');
    p.commissionPct.salesbound = 50;
    const r2 = computeNetProfit(inputs(), p);
    expect(r2.channels.find((c) => c.key === 'salesbound')!.revenue).toBe((5000 - 250) * 0.5);
    expect(r2.warnings).toEqual([]);
  });
  it('medido vence o manual; estorno observado; cobertura do export e aviso quando o período passa dela', () => {
    const p = defaultParams(); p.salesbound.grossUsd = 999; p.commissionPct.salesbound = 50;
    const coverage = { firstAt: '2026-05-01T11:22:19.000Z', lastAt: '2026-09-10T02:52:29.000Z', importedAt: '2026-09-16T20:00:00.000Z' };
    const r = computeNetProfit(inputs({ salesbound: { measured: { gross: 100, sales: 1, refunds: 10, voids: 5, refundsCohort: 3, coverage } } }), p);
    const sb = r.channels.find((c) => c.key === 'salesbound')!;
    expect(sb.gross).toBe(100);
    expect(lineOf(sb.lines, 'refund')).toMatchObject({ usd: 10, source: 'observed' });
    expect(sb.revenue).toBe(45);
    expect(r.salesbound).toEqual({ mode: 'measured', coverage, voids: 5, refundsCohort: 3 });
    expect(r.warnings.some((w) => w.includes('2026-09-10'))).toBe(true);
  });
  it('estorno nunca passa do bruto do período (estornos de vendas antigas num dia fraco)', () => {
    const p = defaultParams(); p.commissionPct.salesbound = 50;
    const sb = computeNetProfit(inputs({ salesbound: { measured: { gross: 100, sales: 1, refunds: 400 } } }), p).channels.find((c) => c.key === 'salesbound')!;
    expect(lineOf(sb.lines, 'refund')!.usd).toBe(100);
    expect(sb.revenue).toBe(0);
  });
});

describe('totais, participações, afiliados e produtos (§10.8)', () => {
  const inp = inputs({
    platforms: [
      platform({ byStage: { ...emptyStages(), FRONTEND: st({ gross: 6000, cpa: 2000, orders: 20, cogs: 600, fulfillment: 0 }) }, refundsObserved: { front: 300, recovery: 0, sms: 0 } }),
      platform({ slug: 'buygoods', displayName: 'BuyGoods', feePct: 5, allowancePct: null, byStage: { ...emptyStages(), FRONTEND: st({ gross: 4000, cpa: 1000, orders: 10, cogs: 400, fulfillment: 0 }) } }),
    ],
    callcenters: [cc({ gross: 1000, sales: 4, commissionPct: 30 })],
    affiliates: [
      { affiliateId: 'a1', externalId: 'maria', nickname: 'Maria', platformSlug: 'digistore24', mappedName: 'Maria Silva', byStage: { ...emptyStages(), FRONTEND: st({ gross: 6000, cpa: 2000, orders: 20 }) }, refundsObserved: 300 },
      { affiliateId: 'a2', externalId: '46', nickname: 'Tayllan', platformSlug: 'buygoods', mappedName: null, byStage: { ...emptyStages(), FRONTEND: st({ gross: 4000, cpa: 1000, orders: 10 }) }, refundsObserved: 0 },
    ],
    products: [
      { family: 'NeuroMindPro', byPlatform: [
        { slug: 'digistore24', byStage: { ...emptyStages(), FRONTEND: st({ gross: 6000, cpa: 2000, orders: 20 }) }, refundsObserved: 300 },
        { slug: 'buygoods', byStage: { ...emptyStages(), FRONTEND: st({ gross: 1000, cpa: 250, orders: 3 }) }, refundsObserved: 0 },
      ] },
      { family: 'GlycoPulse', byPlatform: [{ slug: 'buygoods', byStage: { ...emptyStages(), FRONTEND: st({ gross: 3000, cpa: 750, orders: 7 }) }, refundsObserved: 0 }] },
    ],
  });
  it('receita econômica = plataformas + parcela NS; participações somam 100%', () => {
    const r = computeNetProfit(inp, defaultParams());
    expect(r.kpis.revenue).toBe(10700);                   // 10000 + 1000 × 70%
    const front = r.channels[0]; const cch = r.channels[1];
    expect(front.shareOfRevenuePct).toBe(93.46);
    expect(cch.shareOfRevenuePct).toBe(6.54);
    expect(r2sum(r.channels.map((c) => c.shareOfProfitPct))).toBeCloseTo(100, 0);
    expect(r.kpis.profit).toBe(r.kpis.revenue - r.kpis.costs);
    expect(r.kpis.marginPct).toBe(Math.round((r.kpis.profit / r.kpis.revenue) * 10000) / 100);
  });
  it('afiliado replica a fórmula da plataforma dele, com lucro por FE', () => {
    const r = computeNetProfit(inp, defaultParams());
    const maria = r.affiliates.find((a) => a.affiliateId === 'a1')!;
    // FE observado: (600+400)/(6000+4000) = 10%
    expect(maria).toMatchObject({ gross: 6000, cpa: 2000, refund: 300, fee: 480, productCost: 600, allowance: 120, channel: 'front', mappedName: 'Maria Silva', fes: 20 });
    expect(maria.profit).toBe(6000 - 2000 - 300 - 480 - 600 - 120);
    expect(maria.profitPerFe).toBe(125);
    expect(maria.shareOfChannelPct).toBe(60);
    expect(r.affiliates.find((a) => a.affiliateId === 'a2')).toMatchObject({ fee: 200, allowance: 0 });
    expect(r.affiliates[0].affiliateId).toBe('a1');
  });
  it('projeção (modelo CPA): NET AOV com reembolso do MODELO, fee, opex e reserva, menos CPA por FE, × FEs', () => {
    // plataforma padrão do teste: fee 8, reserva 2, refund do modelo 10; opex 10 → keep = 70%
    const r = computeNetProfit(inputs({
      platforms: [platform({ byStage: { ...emptyStages(), FRONTEND: st({ gross: 6000, cpa: 2000, orders: 20 }) } })],
      affiliates: [{ affiliateId: 'a1', externalId: 'maria', nickname: 'Maria', platformSlug: 'digistore24', mappedName: null, byStage: { ...emptyStages(), FRONTEND: st({ gross: 6000, cpa: 2000, orders: 20 }) }, refundsObserved: 300 }],
      profitModel: { opexPct: 10 },
    }), defaultParams());
    const m = r.affiliates[0];
    // AOV 300 × 0,70 = 210 · CPA/FE 100 · 110 por FE · × 20 = 2.200
    expect(m.projectionPerFe).toBe(110);
    expect(m.projection).toBe(2200);
    // o Lucro da aba usa o reembolso OBSERVADO (300) e o custo de produto — é outro número
    expect(m.profit).not.toBe(m.projection);
    // sem FE não há projeção
    const r0 = computeNetProfit(inputs({ affiliates: [{ affiliateId: 'a2', externalId: 'x', nickname: null, platformSlug: 'digistore24', mappedName: null, byStage: { ...emptyStages(), UPSELL: st({ gross: 500, orders: 2 }) }, refundsObserved: 0 }] }), defaultParams());
    expect(r0.affiliates[0].projection).toBeNull();
  });
  it('afiliado de recuperação: comissão no lugar do CPA + fee e reserva da plataforma', () => {
    const r = computeNetProfit(inputs({
      platforms: [platform({ byStage: { ...emptyStages(), FRONTEND: st({ gross: 1000, orders: 5, cogs: 100, fulfillment: 0 }) } })],
      recoveryAffiliates: [recAff({ nickname: null, gross: 500, orders: 5, feOrders: 4, cogs: 50, commissionUsd: 150, refundsObserved: 25 })],
    }), defaultParams());
    const s = r.affiliates.find((a) => a.affiliateId === 'r1')!;
    expect(s).toMatchObject({ channel: 'recovery', cpa: 150, refund: 25, productCost: 50, fee: 40, allowance: 10, profit: 225, fes: 4 });
    const p = defaultParams(); p.commissionPct.recoveryOverride = 20;
    expect(computeNetProfit(inputs({ recoveryAffiliates: [recAff({ gross: 500, orders: 5, commissionUsd: 150 })] }), p).affiliates[0].cpa).toBe(100);
  });
  it('por produto: mesma fórmula por plataforma, somada por família', () => {
    const r = computeNetProfit(inp, defaultParams());
    const nm = r.products.find((x) => x.family === 'NeuroMindPro')!;
    // fee: 8% de 6000 + 5% de 1000 · reserva: 2% de 6000 · produto 10% observado de 7000
    expect(nm).toMatchObject({ gross: 7000, cpa: 2250, refund: 300, fee: 530, allowance: 120, productCost: 700, fes: 23 });
    expect(nm.profit).toBe(7000 - 2250 - 300 - 530 - 120 - 700);
    expect(r.products.map((x) => x.family)).toEqual(['NeuroMindPro', 'GlycoPulse']);
    expect(r2sum(r.products.map((x) => x.gross))).toBe(r.channels[0].gross);
  });
});

describe('normalizeParams e histórico de premissas', () => {
  it('sanitiza JSON solto: strings numéricas, fora de faixa, chaves estranhas; defaults nos ausentes', () => {
    const p = normalizeParams({
      refundMode: 'manual', refundPct: { front: '7.5', callcenter: 13, recovery: -1 },
      productCostPct: { front: { FRONTEND: '11', UPSELL: 'x' }, callcenter: 9 },
      feePctOverride: { digistore24: '8.37', 'bad key!': 5, jvzoo: 200 },
      commissionPct: { tauk: 40, sms: null }, salesbound: { grossUsd: '1234.567', refundsUsd: -5 },
      dedupeRecovery: false, includeAllowance: 'no', riskBufferPct: '2', backendNetOfRefunds: false,
    });
    expect(p.refundMode).toBe('manual');
    expect(p.refundPct).toEqual({ front: 7.5, recovery: null });      // chaves antigas de backend caem
    expect(p.productCostPct.front).toEqual({ FRONTEND: 11, UPSELL: null, DOWNSELL: null, BUMP: null, SMS_RECOVERY: null });
    expect(p.productCostPct.callcenter).toBe(9);
    expect(p.feePctOverride).toEqual({ digistore24: 8.37 });
    expect(p.commissionPct).toMatchObject({ tauk: 40, sms: 0, logicall: null });
    expect(p.salesbound).toEqual({ grossUsd: 1234.57, sales: null, refundsUsd: null });
    expect(p).toMatchObject({ dedupeRecovery: false, includeAllowance: true, riskBufferPct: 2, backendNetOfRefunds: false });
    expect(normalizeParams({ riskBufferPct: 80 }).riskBufferPct).toBeNull();
    expect(normalizeParams(null)).toEqual(defaultParams());
    expect(normalizeParams('x')).toEqual(defaultParams());
  });
  it('diffParams lista só as folhas que mudaram, com antes/depois', () => {
    const a = defaultParams(); a.refundMode = 'manual'; a.refundPct.front = 13; a.commissionPct.salesbound = 65;
    const b = normalizeParams(JSON.parse(JSON.stringify(a))); b.refundPct.front = 20; b.commissionPct.salesbound = 50; b.feePctOverride.jvzoo = 8.5;
    expect(diffParams(a, b)).toEqual([
      { path: 'commissionPct.salesbound', from: 65, to: 50 },
      { path: 'feePctOverride.jvzoo', from: null, to: 8.5 },
      { path: 'refundPct.front', from: 13, to: 20 },
    ]);
    expect(diffParams(a, a)).toEqual([]);
  });
});

function r2sum(list: number[]): number { return Math.round(list.reduce((s, v) => s + v, 0) * 100) / 100; }
