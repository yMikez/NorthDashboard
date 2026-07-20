import { describe, it, expect } from 'vitest';
import {
  reduceFulfillment, computeForecast, sessionKeyFor,
  type FulfillmentOrderRow,
} from './fulfillment';

const PREV = { orders: 0, bottles: 0, fulfillmentUsd: 0, cogsUsd: 0, totalUsd: 0 };

const row = (over: Partial<FulfillmentOrderRow> = {}): FulfillmentOrderRow => ({
  platformSlug: 'digistore24',
  funnelSessionId: null,
  parentExternalId: 'SESS1',
  externalId: 'T1',
  family: 'NeuroMindPro',
  supplier: 'redrock',
  bottles: 6,
  fulfillmentUsd: 10,
  cogsUsd: 24,
  grossUsd: 200,
  orderedAt: new Date('2026-07-08T15:00:00Z'),
  ...over,
});

describe('sessionKeyFor', () => {
  it('BuyGoods agrupa por funnelSessionId (sessid2)', () => {
    expect(sessionKeyFor({ platformSlug: 'buygoods', funnelSessionId: 'sid2', parentExternalId: 'X', externalId: 'T' }))
      .toBe('buygoods|sid2');
  });
  it('demais plataformas agrupam por parentExternalId, fallback externalId', () => {
    expect(sessionKeyFor({ platformSlug: 'digistore24', funnelSessionId: null, parentExternalId: 'BASE', externalId: 'T' }))
      .toBe('digistore24|BASE');
    expect(sessionKeyFor({ platformSlug: 'clickbank', funnelSessionId: null, parentExternalId: null, externalId: 'T9' }))
      .toBe('clickbank|T9');
  });
});

describe('reduceFulfillment', () => {
  it('FE + upsell da mesma sessão = 1 pacote; bracket usa potes da SESSÃO', () => {
    const r = reduceFulfillment([
      row({ externalId: 'FE', bottles: 6, fulfillmentUsd: 12, cogsUsd: 24 }),
      row({ externalId: 'UP', bottles: 2, fulfillmentUsd: 4, cogsUsd: 8, orderedAt: new Date('2026-07-08T15:05:00Z') }),
    ], PREV);
    expect(r.kpis.orders).toBe(2);
    expect(r.kpis.packages).toBe(1);
    expect(r.kpis.bottles).toBe(8);
    expect(r.kpis.fulfillmentUsd).toBe(16);
    expect(r.kpis.cogsUsd).toBe(32);
    expect(r.kpis.costPerPackageUsd).toBe(16);
    expect(r.kpis.costPerBottleUsd).toBe(6); // (16+32)/8
    expect(r.bracketMix).toEqual([{ bracket: '7+', packages: 1, bottles: 8, pctPackages: 100 }]);
  });

  it('sessões distintas viram pacotes distintos com brackets próprios', () => {
    const r = reduceFulfillment([
      row({ parentExternalId: 'A', externalId: 'A', bottles: 3 }),
      row({ parentExternalId: 'B', externalId: 'B', bottles: 1 }),
      row({ parentExternalId: 'C', externalId: 'C', bottles: 1 }),
    ], PREV);
    expect(r.kpis.packages).toBe(3);
    expect(r.bracketMix).toEqual([
      { bracket: '1', packages: 2, bottles: 2, pctPackages: 66.7 },
      { bracket: '3', packages: 1, bottles: 3, pctPackages: 33.3 },
    ]);
  });

  it('série diária bucketa em BRT e conta pacote no dia da 1ª order da sessão', () => {
    const r = reduceFulfillment([
      // 01:00Z = 22:00 BRT do dia anterior
      row({ externalId: 'FE', bottles: 6, orderedAt: new Date('2026-07-08T01:00:00Z') }),
      row({ externalId: 'UP', bottles: 2, orderedAt: new Date('2026-07-08T15:00:00Z') }),
    ], PREV);
    expect(r.daily).toEqual([
      { date: '2026-07-07', bottles: 6, packages: 1, fulfillmentUsd: 10, cogsUsd: 24 },
      { date: '2026-07-08', bottles: 2, packages: 0, fulfillmentUsd: 10, cogsUsd: 24 },
    ]);
  });

  it('byFamily e bySupplier agregam com custo/pote; % do gross calculado', () => {
    const r = reduceFulfillment([
      row({ family: 'NeuroMindPro', supplier: 'redrock', bottles: 6, fulfillmentUsd: 12, cogsUsd: 24, grossUsd: 300 }),
      row({ parentExternalId: 'Z', externalId: 'Z', family: 'GlycoPulse', supplier: 'shipoffers', bottles: 3, fulfillmentUsd: 9, cogsUsd: 9, grossUsd: 100 }),
    ], PREV);
    expect(r.byFamily[0].family).toBe('NeuroMindPro'); // maior gasto primeiro
    expect(r.byFamily[0].costPerBottleUsd).toBe(6);
    expect(r.bySupplier.find((s) => s.supplier === 'shipoffers')!.packages).toBe(1);
    expect(r.kpis.fulfillmentPctOfGross).toBeCloseTo(21 / 400, 4);
  });

  it('order sem potes entra no bracket "sem potes" (sinal de furo, não some)', () => {
    const r = reduceFulfillment([row({ bottles: 0, fulfillmentUsd: 0, cogsUsd: 0 })], PREV);
    expect(r.bracketMix).toEqual([{ bracket: 'sem potes', packages: 1, bottles: 0, pctPackages: 100 }]);
  });
});

describe('computeForecast', () => {
  // now = 2026-07-15T18:00Z → hoje BRT = 2026-07-15 (terça).
  const now = new Date('2026-07-15T18:00:00.000Z');
  const dayRow = (day: string, over: Partial<FulfillmentOrderRow> = {}) =>
    row({ externalId: `d${day}${over.supplier ?? ''}`, parentExternalId: `d${day}${over.supplier ?? ''}`, orderedAt: new Date(`${day}T15:00:00Z`), ...over });

  it('média 7d usa os 7 dias BRT completos antes de hoje', () => {
    // 10 USD total/dia (frete 10, cogs 0) nos dias 08..14 → avg7 = 10.
    const rows = ['2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11', '2026-07-12', '2026-07-13', '2026-07-14']
      .map((d) => dayRow(d, { fulfillmentUsd: 10, cogsUsd: 0, bottles: 7 }));
    const f = computeForecast(rows, now);
    expect(f.avg7d.fulfillmentPerDay).toBe(10);
    expect(f.avg7d.totalPerDay).toBe(10);
    expect(f.avg7d.bottlesPerDay).toBe(7);
  });

  it('projeção do mês = realizado + ritmo 7d × dias restantes', () => {
    const rows = ['2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11', '2026-07-12', '2026-07-13', '2026-07-14']
      .map((d) => dayRow(d, { fulfillmentUsd: 10, cogsUsd: 0, bottles: 7 }));
    const f = computeForecast(rows, now);
    expect(f.month.label).toBe('2026-07');
    expect(f.month.daysElapsed).toBe(15);
    expect(f.month.daysInMonth).toBe(31);
    expect(f.month.actualUsd).toBe(70);
    // 70 + 10/dia × 16 dias restantes
    expect(f.month.projectedUsd).toBe(230);
  });

  it('fatura por fornecedor: acumulado desde a terça e projeção até a próxima', () => {
    // 15/07/2026 é QUARTA → último fechamento (terça) = 14/07; faltam 6 dias.
    const rows = [
      dayRow('2026-07-15', { supplier: 'redrock', fulfillmentUsd: 20 }),   // dentro do ciclo
      dayRow('2026-07-13', { supplier: 'redrock', fulfillmentUsd: 70 }),   // ANTES do fechamento → fora
      ...['2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11', '2026-07-12', '2026-07-13', '2026-07-14']
        .map((d) => dayRow(d, { supplier: 'shipoffers', fulfillmentUsd: 7 })),
    ];
    const f = computeForecast(rows, now);
    const rr = f.nextInvoice.find((i) => i.supplier === 'redrock')!;
    expect(rr.cycleStart).toBe('2026-07-14');
    expect(rr.daysToNext).toBe(6);
    expect(rr.accruedUsd).toBe(20);
    // avg7 redrock = 70/7 = 10/dia → 20 + 10×6
    expect(rr.projectedUsd).toBe(80);
    const so = f.nextInvoice.find((i) => i.supplier === 'shipoffers')!;
    expect(so.accruedUsd).toBe(7);  // só o dia 14 está dentro do ciclo
    expect(so.projectedUsd).toBe(49); // 7 + 7/dia × 6 dias
  });

  it('tendência = avg7d vs avg30d em %', () => {
    // 7d recentes a 20/dia; 23 dias anteriores a 10/dia.
    const days: string[] = [];
    for (let i = 1; i <= 30; i++) {
      const d = new Date(now.getTime() - i * 86_400_000);
      days.push(new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10));
    }
    const rows = days.map((d, i) => dayRow(d, { fulfillmentUsd: i < 7 ? 20 : 10, cogsUsd: 0 }));
    const f = computeForecast(rows, now);
    expect(f.avg7d.totalPerDay).toBe(20);
    // avg30 = (7×20 + 23×10)/30 = 12.33
    expect(f.avg30d.totalPerDay).toBeCloseTo(12.33, 2);
    expect(f.trendPct).toBeCloseTo(62.2, 1);
  });
});
