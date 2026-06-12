import { describe, it, expect } from 'vitest';
import {
  recoveryCommission, reduceRecovery, ratePeriodAt,
  type RecoveryOrderRow, type RatePeriod,
} from './recovery';

const DAY = '2026-06-01T15:00:00.000Z'; // BRT 2026-06-01
const start = new Date('2026-06-01T03:00:00.000Z');
const end = new Date('2026-06-02T02:59:59.999Z');

const row = (over: Partial<RecoveryOrderRow>): RecoveryOrderRow => ({
  affiliateId: 'a1', externalId: '3722234', nickname: 'lusk1nha',
  commissionPct: 0.30, currentPct: 0.30, periodFrom: null, periodTo: null,
  grossUsd: 200, orderedAt: DAY, ...over,
});

describe('recoveryCommission', () => {
  it('gross × pct, 2 casas', () => {
    expect(recoveryCommission(200, 0.30)).toBe(60);
    expect(recoveryCommission(149.9, 0.30)).toBe(44.97);
    expect(recoveryCommission(100, 0)).toBe(0);
  });
});

describe('ratePeriodAt', () => {
  const periods: RatePeriod[] = [
    { commissionPct: 0.30, effectiveFrom: '1970-01-01T00:00:00.000Z', effectiveTo: '2026-06-10T12:00:00.000Z' },
    { commissionPct: 0.35, effectiveFrom: '2026-06-10T12:00:00.000Z', effectiveTo: null },
  ];

  it('venda antes da mudança usa a taxa antiga', () => {
    expect(ratePeriodAt(periods, new Date('2026-06-01T15:00:00Z'))!.commissionPct).toBe(0.30);
  });

  it('venda depois da mudança usa a taxa nova', () => {
    expect(ratePeriodAt(periods, new Date('2026-06-11T15:00:00Z'))!.commissionPct).toBe(0.35);
  });

  it('fronteira exata pertence ao período NOVO (from inclusivo, to exclusivo)', () => {
    expect(ratePeriodAt(periods, new Date('2026-06-10T12:00:00.000Z'))!.commissionPct).toBe(0.35);
  });

  it('sem períodos → null', () => {
    expect(ratePeriodAt([], new Date())).toBeNull();
  });
});

describe('reduceRecovery', () => {
  const rows = [
    row({ affiliateId: 'a1', grossUsd: 200 }),
    row({ affiliateId: 'a1', grossUsd: 100 }),
    row({ affiliateId: 'a2', externalId: 'x99', nickname: 'outro', commissionPct: 0.20, currentPct: 0.20, grossUsd: 300 }),
  ];

  it('KPIs: sales, gross, commission (por afiliado), net', () => {
    const r = reduceRecovery(rows, start, end);
    expect(r.kpis.sales).toBe(3);
    expect(r.kpis.grossUsd).toBe(600);
    // 200*.3 + 100*.3 + 300*.2 = 60 + 30 + 60 = 150
    expect(r.kpis.commissionUsd).toBe(150);
    expect(r.kpis.netUsd).toBe(450);
  });

  it('byAffiliate: agrega por afiliado com a % vigente', () => {
    const r = reduceRecovery(rows, start, end);
    const a1 = r.byAffiliate.find((a) => a.affiliateExternalId === '3722234')!;
    expect(a1).toMatchObject({ sales: 2, grossUsd: 300, commissionUsd: 90, commissionPct: 0.30 });
    const a2 = r.byAffiliate.find((a) => a.affiliateExternalId === 'x99')!;
    expect(a2).toMatchObject({ sales: 1, grossUsd: 300, commissionUsd: 60, commissionPct: 0.20 });
  });

  it('taxa única → 1 período só, com os mesmos totais', () => {
    const r = reduceRecovery(rows, start, end);
    const a1 = r.byAffiliate.find((a) => a.affiliateExternalId === '3722234')!;
    expect(a1.periods).toHaveLength(1);
    expect(a1.periods[0]).toMatchObject({
      commissionPct: 0.30, effectiveFrom: null, effectiveTo: null,
      sales: 2, grossUsd: 300, commissionUsd: 90,
    });
  });

  it('mudança de % no meio: vendas antigas ficam no contador antigo, novas no novo', () => {
    const CHANGE = '2026-06-01T18:00:00.000Z';
    const split = [
      // 2 vendas com a taxa antiga (30%), período fechado no CHANGE
      row({ grossUsd: 200, currentPct: 0.35, commissionPct: 0.30, periodFrom: null, periodTo: CHANGE, orderedAt: '2026-06-01T10:00:00.000Z' }),
      row({ grossUsd: 100, currentPct: 0.35, commissionPct: 0.30, periodFrom: null, periodTo: CHANGE, orderedAt: '2026-06-01T12:00:00.000Z' }),
      // 1 venda com a taxa nova (35%), período vigente
      row({ grossUsd: 400, currentPct: 0.35, commissionPct: 0.35, periodFrom: CHANGE, periodTo: null, orderedAt: '2026-06-01T20:00:00.000Z' }),
    ];
    const r = reduceRecovery(split, start, end);
    const a1 = r.byAffiliate[0];

    // Cabeçalho mostra a taxa VIGENTE e os totais combinados.
    expect(a1.commissionPct).toBe(0.35);
    expect(a1.sales).toBe(3);
    // 300*.30 + 400*.35 = 90 + 140 = 230
    expect(a1.commissionUsd).toBe(230);

    // Contadores separados por período, vigente primeiro.
    expect(a1.periods).toHaveLength(2);
    expect(a1.periods[0]).toMatchObject({
      commissionPct: 0.35, effectiveFrom: CHANGE, effectiveTo: null,
      sales: 1, grossUsd: 400, commissionUsd: 140,
    });
    expect(a1.periods[1]).toMatchObject({
      commissionPct: 0.30, effectiveFrom: null, effectiveTo: CHANGE,
      sales: 2, grossUsd: 300, commissionUsd: 90,
    });

    // KPIs globais usam a comissão por-período.
    expect(r.kpis.commissionUsd).toBe(230);
  });

  it('daily: bucket BRT', () => {
    const r = reduceRecovery(rows, start, end);
    expect(r.daily).toHaveLength(1);
    expect(r.daily[0]).toMatchObject({ date: '2026-06-01', sales: 3, grossUsd: 600, commissionUsd: 150 });
  });

  it('vazio → zerado', () => {
    const r = reduceRecovery([], start, end);
    expect(r.kpis).toMatchObject({ sales: 0, grossUsd: 0, commissionUsd: 0, netUsd: 0 });
    expect(r.byAffiliate).toEqual([]);
    expect(r.daily).toEqual([]);
  });
});
