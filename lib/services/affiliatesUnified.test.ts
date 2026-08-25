import { describe, expect, it } from 'vitest';
import { mergeAffiliateRows, groupAffiliateRows, type AffiliateRow } from './affiliatesUnified';

const th = { healthyMinUsd: 10, attentionMinUsd: 0 };
const row = (over: Partial<AffiliateRow>): AffiliateRow => ({
  externalId: 'x', platformSlug: 'jvzoo', nickname: 'x', revenue: 0, orders: 0, allOrders: 0, realOrders: 0, refunds: 0, chargebacks: 0,
  approvalRate: 0, refundRate: 0, cbRate: 0, cpa: 0, feApprovedCount: 0, feCpaPaidCount: 0, cpaPerFe: 0, cpaPerFeApproved: 0,
  netAovUsd: 0, netAfterCpaUsd: null, netAfterCpaTotalUsd: null, cpaStatus: null, refundCbPctUsed: 15, refundCbPctOverride: null, opexPctUsed: 10,
  netMargin: 0, cogs: 0, fulfillment: 0, estimatedProfit: 0, attributedSessions: 0, attributedOrders: 0, attributedRevenue: 0, attributedNet: 0,
  attributedCpa: 0, attributedCogs: 0, attributedFulfillment: 0, attributedProfit: 0, attributedMarginPct: 0, topCountry: null,
  ltvRevenue: 0, ltvOrders: 0, firstSeenAt: '2026-08-01T00:00:00.000Z', lastOrderAt: null, sparkline: [0, 0, 0],
  ...over,
} as AffiliateRow);

describe('mergeAffiliateRows', () => {
  it('soma, re-deriva taxas, pondera NET AOV por FE e CPA só pelas contas com CPA; sparkline soma', () => {
    const a = row({ externalId: 'a', platformSlug: 'jvzoo', revenue: 4000, orders: 10, allOrders: 10, realOrders: 10, feApprovedCount: 10, cpaPerFe: 250, netAovUsd: 280, netAfterCpaUsd: 30, netAfterCpaTotalUsd: 300, cpa: 2500, sparkline: [1, 2, 3], lastOrderAt: '2026-08-20T00:00:00.000Z', refundCbPctUsed: 15 });
    const b = row({ externalId: 'b', platformSlug: 'digistore24', revenue: 2000, orders: 8, allOrders: 10, realOrders: 8, refunds: 2, feApprovedCount: 5, cpaPerFe: 0, netAovUsd: 300, sparkline: [1, 1, 1], lastOrderAt: '2026-08-24T00:00:00.000Z', refundCbPctUsed: 21 });
    const m = mergeAffiliateRows([a, b], 'Parceiro X', th);
    expect(m.nickname).toBe('Parceiro X');
    expect(m.revenue).toBe(6000);
    expect(m.orders).toBe(18);
    expect(m.realOrders).toBe(18);
    expect(m.refundRate).toBeCloseTo(2 / 18, 4);
    expect(m.feApprovedCount).toBe(15);
    expect(m.cpaPerFe).toBe(250);                 // só a conta com CPA
    expect(m.netAfterCpaTotalUsd).toBe(300);
    expect(m.netAfterCpaUsd).toBe(30);
    expect(m.cpaStatus).toBe('saudavel');
    expect(m.netAovUsd).toBe(280);                // mesma base do CPA (só contas com CPA) → NET AOV − CPA = Net after CPA
    expect(m.netAovUsd - m.cpaPerFe).toBe(m.netAfterCpaUsd);
    expect(m.attributedMarginPct).toBe(0);
    expect(m.refundCbPctUsed).toBe(17);           // (15×10 + 21×5)/15 = 17
    expect(m.sparkline).toEqual([2, 3, 4]);
    expect(m.lastOrderAt).toBe('2026-08-24T00:00:00.000Z');
    expect(m.platformSlug).toBe('jvzoo');         // conta primária = maior receita
    expect(m.refundCbPctOverride).toBeNull();
  });
  it('uma conta só: mesma linha com o nome do parceiro', () => {
    const a = row({ externalId: 'a', nickname: 'conta', revenue: 10 });
    expect(mergeAffiliateRows([a], 'Nome', th)).toMatchObject({ externalId: 'a', nickname: 'Nome', revenue: 10 });
  });
});

describe('groupAffiliateRows', () => {
  it('agrupa por parceiro, mantém soltas, ordena por receita e lista contas por receita', () => {
    const rows = [
      row({ externalId: 'a', platformSlug: 'jvzoo', revenue: 100, realOrders: 1 }),
      row({ externalId: 'b', platformSlug: 'digistore24', revenue: 300, realOrders: 1 }),
      row({ externalId: 'c', platformSlug: 'buygoods', revenue: 250, realOrders: 1 }),
    ];
    const partnerOf = (k: string) => (k === 'jvzoo:a' || k === 'digistore24:b' ? { id: 'p1', name: 'Dupla', contact: { email: 'x@y.z', phone: null, notes: null } } : null);
    const out = groupAffiliateRows(rows, partnerOf, th);
    expect(out.map((r) => r.key)).toEqual(['partner:p1', 'buygoods:c']);
    expect(out[0]).toMatchObject({ partnerName: 'Dupla', platforms: ['digistore24', 'jvzoo'], revenue: 400 });
    expect(out[0].accounts.map((a) => a.externalId)).toEqual(['b', 'a']);
    expect(out[0].contact?.email).toBe('x@y.z');
    expect(out[1].accounts).toHaveLength(1);
  });
});
