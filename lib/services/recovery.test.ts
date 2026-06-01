import { describe, it, expect } from 'vitest';
import { recoveryCommission, reduceRecovery, type RecoveryOrderRow } from './recovery';

const DAY = '2026-06-01T15:00:00.000Z'; // BRT 2026-06-01
const start = new Date('2026-06-01T03:00:00.000Z');
const end = new Date('2026-06-02T02:59:59.999Z');

const row = (over: Partial<RecoveryOrderRow>): RecoveryOrderRow => ({
  affiliateId: 'a1', externalId: '3722234', nickname: 'lusk1nha',
  commissionPct: 0.30, grossUsd: 200, orderedAt: DAY, ...over,
});

describe('recoveryCommission', () => {
  it('gross × pct, 2 casas', () => {
    expect(recoveryCommission(200, 0.30)).toBe(60);
    expect(recoveryCommission(149.9, 0.30)).toBe(44.97);
    expect(recoveryCommission(100, 0)).toBe(0);
  });
});

describe('reduceRecovery', () => {
  const rows = [
    row({ affiliateId: 'a1', grossUsd: 200 }),
    row({ affiliateId: 'a1', grossUsd: 100 }),
    row({ affiliateId: 'a2', externalId: 'x99', nickname: 'outro', commissionPct: 0.20, grossUsd: 300 }),
  ];

  it('KPIs: sales, gross, commission (por afiliado), net', () => {
    const r = reduceRecovery(rows, start, end);
    expect(r.kpis.sales).toBe(3);
    expect(r.kpis.grossUsd).toBe(600);
    // 200*.3 + 100*.3 + 300*.2 = 60 + 30 + 60 = 150
    expect(r.kpis.commissionUsd).toBe(150);
    expect(r.kpis.netUsd).toBe(450);
  });

  it('byAffiliate: agrega por afiliado com a % dele', () => {
    const r = reduceRecovery(rows, start, end);
    const a1 = r.byAffiliate.find((a) => a.affiliateExternalId === '3722234')!;
    expect(a1).toMatchObject({ sales: 2, grossUsd: 300, commissionUsd: 90, commissionPct: 0.30 });
    const a2 = r.byAffiliate.find((a) => a.affiliateExternalId === 'x99')!;
    expect(a2).toMatchObject({ sales: 1, grossUsd: 300, commissionUsd: 60, commissionPct: 0.20 });
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
