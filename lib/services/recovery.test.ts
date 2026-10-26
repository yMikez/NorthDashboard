import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { migratedPglite } from '../test/pgliteDb';
import {
  recoveryCommission, recoveryPreviousWindow, recoverySessionKey, reduceRecovery, ratePeriodAt, unmatchedCsvRefundsSql,
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

  it('vazio → zerado (o dia do período aparece, com zero)', () => {
    const r = reduceRecovery([], start, end);
    expect(r.kpis).toMatchObject({ sales: 0, purchases: 0, grossUsd: 0, commissionUsd: 0, netUsd: 0, aovUsd: null, refundPct: null });
    expect(r.byAffiliate).toEqual([]);
    expect(r.daily).toEqual([{ date: '2026-06-01', sales: 0, purchases: 0, grossUsd: 0, commissionUsd: 0, netUsd: 0, byCompany: {} }]);
  });
});

// Uma empresa pode ter várias contas (MailX = skill99 na Digistore + 364622
// na BuyGoods). A aba mostra a empresa; a conta é detalhe de plataforma.
describe('reduceRecovery · agrupamento por empresa', () => {
  const rows = [
    row({ affiliateId: 'a1', externalId: '3722234', nickname: 'skill99', company: 'MailX', platformSlug: 'digistore24', grossUsd: 200 }),
    row({ affiliateId: 'a2', externalId: '364622', nickname: 'MailX', company: 'MailX', platformSlug: 'buygoods', grossUsd: 100 }),
    row({ affiliateId: 'a3', externalId: '290', nickname: 'Recorvely', company: 'Recorvely', platformSlug: 'buygoods', grossUsd: 300 }),
  ];

  it('soma as contas da mesma empresa numa linha só', () => {
    const r = reduceRecovery(rows, start, end);
    const mailx = r.byCompany.find((c) => c.company === 'MailX')!;
    expect(mailx.sales).toBe(2);
    expect(mailx.grossUsd).toBe(300);
    expect(mailx.accounts).toHaveLength(2);
    expect(mailx.accounts.map((a) => a.platformSlug).sort()).toEqual(['buygoods', 'digistore24']);
  });

  it('ordena por faturamento e mantém as contas dentro', () => {
    const r = reduceRecovery(rows, start, end);
    expect(r.byCompany.map((c) => c.company)).toEqual(['Recorvely', 'MailX']);
  });

  it('taxa da empresa é a EFETIVA (comissão ÷ bruto), não uma média inventada', () => {
    const mistas = [row({ affiliateId: 'a1', company: 'X', grossUsd: 100, commissionPct: 0.30, currentPct: 0.30 }), row({ affiliateId: 'a2', externalId: 'b', company: 'X', grossUsd: 100, commissionPct: 0.10, currentPct: 0.10 })];
    const c = reduceRecovery(mistas, start, end).byCompany[0];
    expect(c.commissionUsd).toBe(40);
    expect(c.effectivePct).toBe(0.2);
  });

  it('conta sem empresa cadastrada não some — cai no próprio nome', () => {
    const r = reduceRecovery([row({ affiliateId: 'z', externalId: '999', nickname: 'sozinho', grossUsd: 50 })], start, end);
    expect(r.byCompany[0].company).toBe('sozinho');
  });
});

describe('reduceRecovery · compras, AOV, reembolso e SMS (reforma 2026-10-26)', () => {
  const end3 = new Date('2026-06-04T02:59:59.999Z');
  const rows = [
    // MailX: uma compra com front + upsell, outra só front; um estorno in-place de venda do período.
    row({ affiliateId: 'm1', externalId: 'skill99', company: 'MailX', commissionPct: 0.3, grossUsd: 200, sessionKey: 'digistore24:S1' }),
    row({ affiliateId: 'm1', externalId: 'skill99', company: 'MailX', commissionPct: 0.3, grossUsd: 100, sessionKey: 'digistore24:S1' }),
    row({ affiliateId: 'm1', externalId: 'skill99', company: 'MailX', commissionPct: 0.3, grossUsd: 150, sessionKey: 'digistore24:S2', orderedAt: '2026-06-03T15:00:00.000Z' }),
    row({ affiliateId: 'm1', externalId: 'skill99', company: 'MailX', commissionPct: 0.3, grossUsd: -100, kind: 'refund', inBase: false }),
    // SMS próprio: sem comissão.
    row({ affiliateId: 'sms', externalId: 'SMS', nickname: 'SMS próprio', company: 'SMS próprio', commissionPct: 0, currentPct: 0, grossUsd: 50, sessionKey: 'jvzoo:X1' }),
  ];

  it('compra = sessão; AOV = receita ÷ compras; reembolso das vendas do período', () => {
    const r = reduceRecovery(rows, start, end3);
    expect(r.kpis).toMatchObject({ sales: 4, purchases: 3, grossUsd: 500, commissionUsd: 135, netUsd: 365, aovUsd: 166.67, refunds: 1, refundUsd: 100 });
    // Linha extra (Digistore) não entra na base: 1 estorno ÷ 4 vendas.
    expect(r.kpis.refundPct).toBe(0.25);
    const mailx = r.byCompany.find((c) => c.company === 'MailX')!;
    expect(mailx).toMatchObject({ purchases: 2, grossUsd: 450, aovUsd: 225, sharePct: 0.9, effectivePct: 0.3 });
    expect(r.byCompany.find((c) => c.company === 'SMS próprio')).toMatchObject({ commissionUsd: 0, aovUsd: 50, sharePct: 0.1 });
  });

  it('estorno in-place entra na base (a linha estornada é a venda)', () => {
    const r = reduceRecovery([row({ grossUsd: 100 }), row({ grossUsd: 100, kind: 'refund', inBase: true })], start, end);
    expect(r.kpis).toMatchObject({ sales: 1, refunds: 1, refundPct: 0.5 });
  });

  it('estorno in-place sem data do estorno: venda da base, não estorno', () => {
    const r = reduceRecovery([row({ grossUsd: 100 }), row({ grossUsd: 100, kind: 'base' })], start, end);
    expect(r.kpis).toMatchObject({ sales: 1, grossUsd: 100, refunds: 0, refundPct: 0 });
  });

  it('série diária: todos os dias, por empresa', () => {
    const r = reduceRecovery(rows, start, end3);
    expect(r.daily.map((d) => d.date)).toEqual(['2026-06-01', '2026-06-02', '2026-06-03']);
    expect(r.daily[0]).toMatchObject({ purchases: 2, grossUsd: 350 });
    expect(r.daily[0].byCompany.MailX).toEqual({ grossUsd: 300, purchases: 1, commissionUsd: 90 });
    expect(r.daily[1]).toMatchObject({ sales: 0, grossUsd: 0, byCompany: {} });
  });

  it('chave da compra igual à da Visão geral e janela anterior', () => {
    expect(recoverySessionKey({ platformSlug: 'buygoods', externalId: 'o1', parentExternalId: 'p1', funnelSessionId: 'sess' })).toBe('buygoods:sess');
    expect(recoverySessionKey({ platformSlug: 'jvzoo', externalId: 'o2', parentExternalId: null, funnelSessionId: 'x' })).toBe('jvzoo:o2');
    const w = recoveryPreviousWindow(new Date('2026-06-08T03:00:00Z'), new Date('2026-06-15T02:59:59.999Z'));
    expect([w.start.toISOString(), w.end.toISOString()]).toEqual(['2026-06-01T03:00:00.000Z', '2026-06-08T02:59:59.999Z']);
  });
});

describe('unmatchedCsvRefundsSql (PGlite)', () => {
  let pg: PGlite;
  const order = (id: string, rawMetadata: unknown) => pg.query(
    `INSERT INTO "Order" ("id", "externalId", "platformId", "productId", "currencyOriginal", "grossAmountOrig", "grossAmountUsd",
       "eventType", "updatedAt", "productType", "status", "netAmountUsd", "orderedAt", "rawMetadata")
     VALUES ($1, $1, 'p_d24', 'pr_d24', 'USD', 50, -50, 'x', now(), 'FRONTEND', 'REFUNDED', 0, now(), $2)`,
    [id, rawMetadata == null ? null : JSON.stringify(rawMetadata)],
  );
  beforeAll(async () => {
    pg = await migratedPglite({ extensions: false });
    await pg.exec(`
      INSERT INTO "Platform" (id, slug, "displayName") VALUES ('p_d24', 'digistore24', 'Digistore24');
      INSERT INTO "Product" (id, "platformId", "externalId", name, "productType") VALUES ('pr_d24', 'p_d24', 'x', 'X', 'FRONTEND');
    `);
    await order('csv_sem_venda', { _source: 'csv-reconcile', matched_original_sale: false });
    await order('csv_casado', { _source: 'csv-reconcile', matched_original_sale: true });
    await order('ipn', { event: 'refund' });
    await order('sem_meta', null);
  }, 60_000);
  afterAll(async () => { await pg?.close(); });

  it('só o estorno do CSV sem venda casada sai', async () => {
    const sql = unmatchedCsvRefundsSql(['csv_sem_venda', 'csv_casado', 'ipn', 'sem_meta']);
    const ids = sql.values.map((v) => (Array.isArray(v) ? `{${v.join(',')}}` : v));
    const res = await pg.query<{ id: string }>(sql.text, ids);
    expect(res.rows.map((r) => r.id)).toEqual(['csv_sem_venda']);
  });
});
