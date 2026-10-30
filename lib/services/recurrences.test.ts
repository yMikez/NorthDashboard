import { describe, expect, it, vi } from 'vitest';

const DAY = 86400000;
const NOW = new Date('2026-10-29T15:00:00Z');
const ago = (n: number) => new Date(NOW.getTime() - n * DAY);

const order = (externalId: string, daysAgo: number, extra: Record<string, unknown> = {}) => ({
  externalId, eventType: 'sale', status: 'APPROVED', originalGrossUsd: 69, grossAmountUsd: 69,
  previousTransactionId: null as string | null,
  orderedAt: ago(daysAgo), approvedAt: ago(daysAgo) as Date | null, refundedAt: null as Date | null, chargebackAt: null, trackingId: null,
  platform: 'jvzoo', productExternalId: '777', productName: 'Blessed Kit',
  email: 'ana@x.com', firstName: 'Ana', lastName: 'Lima', phone: null, ...extra,
});

const mockDb = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  ingestLog: { findMany: vi.fn() },
  product: { findMany: vi.fn(async () => [{ id: 'p-cb' }]) },
  subscription: { findMany: vi.fn(async () => []) },
}));
vi.mock('../db', () => ({ db: mockDb, dbRead: mockDb }));

import { getRecurrences } from './recurrences';

describe('recorrências a partir dos pedidos e dos avisos', () => {
  it('produto que renovou entra; cancelamento do IngestLog encerra; aviso sem venda aprovada não é cobrança', async () => {
    mockDb.$queryRaw.mockImplementation(async (sql: { text: string }) => {
      if (sql.text.includes('"IngestLog"')) return [];
      if (sql.text.includes('SELECT DISTINCT')) return [{ productId: 'p-blessed' }];
      return [
        order('A1', 70), order('A2', 40, { eventType: 'bill' }),
        // Venda que o CANCEL-REBILL sobrescreveu: segue sendo cobrança (foi aprovada).
        order('B1', 50, { email: 'bia@x.com', status: 'CANCELED', eventType: 'cancel-rebill' }),
        // Linha criada pelo próprio aviso (nunca aprovada): não é cobrança.
        order('C1', 5, { email: 'caio@x.com', status: 'CANCELED', eventType: 'cancel-rebill', approvedAt: null }),
        // Digistore: o estorno vem em LINHA EXTRA (negativa) apontando pra cobrança.
        ...[order('D1', 70), order('D2', 40, { eventType: 'on_payment' }),
          order('D2-R', 40, { eventType: 'on_refund', status: 'REFUNDED', originalGrossUsd: -69, grossAmountUsd: -69, approvedAt: null, refundedAt: ago(35), previousTransactionId: 'D2' }),
        ].map((o) => ({ ...o, platform: 'digistore24', productExternalId: '555', productName: 'Glyco Sub', email: 'dora@x.com' })),
      ];
    });
    mockDb.ingestLog.findMany.mockResolvedValue([
      { platformSlug: 'jvzoo', eventType: 'cancel-rebill', receivedAt: ago(30),
        payload: { transaction_type: 'CANCEL-REBILL', transaction_id: 'B1', customer_email: 'BIA@x.com', product_id: '777', product_name: 'Blessed Kit', total: '0', date: '2026-09-09 10:00:00' } },
    ]);

    const d = await getRecurrences({ start: ago(30), end: NOW, now: NOW });
    expect(d.rows.map((r) => [r.email, r.status, r.endReason])).toEqual([
      ['ana@x.com', 'late', null],
      ['dora@x.com', 'ended', 'reembolso'],
      ['bia@x.com', 'ended', 'pediu'],
    ]);
    expect(d.kpis.ended).toBe(1);
    expect(d.kpis.avgDaysToEnd).toBe(20);
    expect(d.products).toEqual([
      { key: 'jvzoo:777', label: 'Blessed Kit', platform: 'jvzoo', count: 2 },
      { key: 'digistore24:555', label: 'Glyco Sub', platform: 'digistore24', count: 1 },
    ]);

    // Filtro por plataforma depois de montar.
    const none = await getRecurrences({ start: ago(30), end: NOW, now: NOW, platform: 'vupim' });
    expect(none.rows).toEqual([]);
    expect(none.platforms).toEqual([{ id: 'jvzoo', count: 2 }, { id: 'digistore24', count: 1 }]);
  });
});

describe('Vupim', () => {
  const env = (eventId: string, event: string, data: Record<string, unknown>) =>
    ({ id: `d_${eventId}`, eventId, event, timestamp: '2026-10-22T10:00:00Z', livemode: true, data });

  it('assinatura vendida antes do histórico (só no IngestLog) aparece; evento repetido no histórico não conta 2x', async () => {
    const sale = env('e1', 'sale.approved', {
      subscriptionId: 'sub_1', transactionId: 'tx1', chargeNumber: 1, amountUsd: 4900, approvedAt: ago(8).toISOString(),
      offerName: 'NeuroRecall 1 Bottle', productName: 'NeuroRecall', offerId: 'off_1',
      customer: { email: 'Eva@x.com', name: 'Eva Reis', phone: '+1 555 010 9999' },
    });
    const old = env('e0', 'sale.approved', {
      subscriptionId: 'sub_0', transactionId: 'tx0', chargeNumber: 1, amount: 25000, currency: 'BRL', exchangeRate: 0.2,
      approvedAt: ago(7).toISOString(), offerName: 'NeuroRecall 1 Bottle', offerId: 'off_1', customer: { email: 'leo@x.com' },
    });
    mockDb.$queryRaw.mockImplementation(async (sql: { text: string }) => {
      if (sql.text.includes('"IngestLog"')) return [{ eventType: 'sale.approved', payload: sale }, { eventType: 'sale.approved', payload: old }];
      return [];
    });
    mockDb.ingestLog.findMany.mockResolvedValue([]);
    // sub_1 já tem o mesmo evento no histórico gravado (desde 28/10).
    mockDb.subscription.findMany.mockResolvedValueOnce([{
      externalId: 'sub_1', email: 'eva@x.com', name: 'Eva Reis', phone: '15550109999', productName: 'NeuroRecall', offerName: 'NeuroRecall 1 Bottle',
      offerId: 'off_1', bottles: 1, src: 'qz_abc', periodEnd: null,
      events: [{ eventId: 'e1', kind: 'charge', at: ago(8), amountUsd: 49, chargeNumber: 1, attempt: null, nextRetryAt: null, periodEnd: null, reason: null, transactionId: 'tx1' }],
    }] as never);

    // Módulo novo: a leitura fica 2 min em cache e o teste de cima já encheu.
    vi.resetModules();
    const mod = await import('./recurrences');
    const d = await mod.getRecurrences({ start: ago(30), end: NOW, now: NOW, platform: 'vupim' });
    expect(d.rows.map((r) => [r.externalId, r.email, r.status, r.charges, r.totalPaidUsd, r.fromSurvey, r.cycleDays])).toEqual([
      ['sub_0', 'leo@x.com', 'active', 1, 50, false, 30],
      ['sub_1', 'eva@x.com', 'active', 1, 49, true, 30],
    ]);
    expect(d.kpis.newSubs).toBe(2);
  });
});

describe('SQL no Postgres (PGlite com as migrações)', () => {
  it('acha o produto que renovou e traz os pedidos dele com cliente, do mais antigo pro mais novo', async () => {
    const { migratedPglite } = await import('../test/pgliteDb');
    const { rebilledProductsSql, recurringOrdersSql } = await import('./recurrences');
    const pg = await migratedPglite({ extensions: false });
    try {
      await pg.exec(`
        INSERT INTO "Platform" (id, slug, "displayName") VALUES ('p_jvz','jvzoo','JVZoo'), ('p_d24','digistore24','Digistore24'), ('p_vp','vupim','Vupim');
        INSERT INTO "Product" (id, "platformId", "externalId", name, "productType") VALUES
          ('pr_bk','p_jvz','777','Blessed Kit','FRONTEND'), ('pr_x','p_jvz','888','Avulso','FRONTEND'),
          ('pr_d','p_d24','555','Glyco Sub','FRONTEND'), ('pr_v','p_vp','v1','NeuroRecall','FRONTEND');
        INSERT INTO "Customer" (id, "platformId", "externalId", email, "firstName", "firstSeenAt") VALUES ('c1','p_jvz','ana@x.com','ana@x.com','Ana','2026-08-01');
      `);
      const ins = (id: string, o: Record<string, unknown>) => {
        const cols = { id, currencyOriginal: 'USD', grossAmountOrig: 69, grossAmountUsd: 69, originalGrossUsd: 69, netAmountUsd: 50, status: 'APPROVED', updatedAt: '2026-10-01', ...o };
        const keys = Object.keys(cols);
        return pg.query(`INSERT INTO "Order" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(cols));
      };
      await ins('o1', { platformId: 'p_jvz', externalId: 'T2', productId: 'pr_bk', customerId: 'c1', eventType: 'bill', orderedAt: '2026-09-01T12:00:00Z' });
      await ins('o2', { platformId: 'p_jvz', externalId: 'T1', productId: 'pr_bk', customerId: 'c1', eventType: 'sale', orderedAt: '2026-08-01T12:00:00Z' });
      await ins('o3', { platformId: 'p_jvz', externalId: 'X1', productId: 'pr_x', eventType: 'sale', orderedAt: '2026-08-01T12:00:00Z' });
      await ins('o4', { platformId: 'p_d24', externalId: 'D2', productId: 'pr_d', eventType: 'on_payment', paySequenceNo: 2, orderedAt: '2026-09-01T12:00:00Z' });
      await ins('o5', { platformId: 'p_vp', externalId: 'V2', productId: 'pr_v', eventType: 'BILL', orderedAt: '2026-09-01T12:00:00Z' });
      await ins('o6', { platformId: 'p_jvz', externalId: 'T0', productId: 'pr_bk', eventType: 'TEST_SALE', orderedAt: '2026-07-01T12:00:00Z' });

      const run = async (sql: { text: string; values: unknown[] }) => (await pg.query<Record<string, unknown>>(sql.text, sql.values)).rows;
      const products = (await run(rebilledProductsSql())).map((r) => r.productId).sort();
      expect(products).toEqual(['pr_bk', 'pr_d', 'pr_v']);

      const rows = await run(recurringOrdersSql(['pr_bk', 'pr_d', 'pr_v']));
      expect(rows.map((r) => [r.externalId, r.platform, r.status, r.email])).toEqual([
        ['T1', 'jvzoo', 'APPROVED', 'ana@x.com'],
        ['D2', 'digistore24', 'APPROVED', null],
        ['T2', 'jvzoo', 'APPROVED', 'ana@x.com'],
      ]);

      // Vupim: só o evento de assinatura com subscriptionId.
      await pg.exec(`
        INSERT INTO "IngestLog" (id, source, "platformSlug", "eventType", payload) VALUES
          ('l1','n8n-vupim','vupim','sale.approved','{"data":{"subscriptionId":"sub_1"}}'),
          ('l2','n8n-vupim','vupim','sale.approved','{"data":{"subscriptionId":null}}'),
          ('l3','n8n-vupim','vupim','checkout.abandoned','{"data":{"subscriptionId":"sub_1"}}'),
          ('l4','n8n-jvzoo','jvzoo','sale.approved','{"data":{"subscriptionId":"x"}}');
      `);
      const { vupimSubscriptionLogsSql } = await import('./recurrences');
      expect((await run(vupimSubscriptionLogsSql())).map((r) => r.payload)).toEqual([{ data: { subscriptionId: 'sub_1' } }]);
    } finally {
      await pg.close();
    }
  }, 60_000);
});
