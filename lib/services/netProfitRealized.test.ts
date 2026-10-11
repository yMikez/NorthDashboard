import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import type { PGlite } from '@electric-sql/pglite';
import { migratedPglite } from '../test/pgliteDb';
import { affiliateBackendSql, realizedCutoff, reduceAffiliateBackend } from './netProfit';

const T0 = new Date('2026-09-01T12:00:00Z');
const at = (h: number) => new Date(T0.getTime() + h * 3600_000);

describe('realizedCutoff', () => {
  it('agora − 48h, arredondado pra hora cheia (estável no cache)', () => {
    expect(realizedCutoff(new Date('2026-10-11T15:42:10Z')).toISOString()).toBe('2026-10-09T15:00:00.000Z');
  });
});

describe('Lucro real · Realizado: backend atribuído aos leads de cada afiliado (PGlite)', () => {
  let pg: PGlite;
  const q = async (sql: Prisma.Sql) => (await pg.query<Record<string, unknown>>(sql.text, sql.values as unknown[])).rows;
  const ins = (table: string, cols: Record<string, unknown>) => {
    const keys = Object.keys(cols);
    return pg.query(`INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(cols));
  };
  const order = (id: string, o: Record<string, unknown>) => ins('Order', {
    id, externalId: id, currencyOriginal: 'USD', grossAmountOrig: o.grossAmountUsd ?? 100, grossAmountUsd: 100, eventType: 'x', updatedAt: new Date(),
    productType: 'FRONTEND', status: 'APPROVED', netAmountUsd: 0, ...o,
  });
  const run = async (start: Date, end: Date) => {
    const rows = await q(affiliateBackendSql(start, end));
    return Object.fromEntries(reduceAffiliateBackend(rows as never).map((a) => [a.affiliateId, a]));
  };

  beforeAll(async () => {
    pg = await migratedPglite({ extensions: false });
    await pg.exec(`
      INSERT INTO "Platform" (id, slug, "displayName") VALUES ('p_bg','buygoods','BuyGoods'), ('p_jv','jvzoo','JVZoo'), ('p_d24','digistore24','Digistore24');
      INSERT INTO "Product" (id, "platformId", "externalId", name, "productType") VALUES
        ('pr_bg','p_bg','fe','FE','FRONTEND'), ('pr_bgup','p_bg','up','UP','UPSELL'), ('pr_jv','p_jv','fe','FE','FRONTEND'), ('pr_d24','p_d24','fe','FE','FRONTEND');
      INSERT INTO "Affiliate" (id, "platformId", "externalId", "firstSeenAt") VALUES
        ('a_bg','p_bg','77@12595','2026-01-01'), ('a_jv','p_jv','2322247','2026-01-01'), ('a_d24','p_d24','999','2026-01-01');
      INSERT INTO "Customer" (id, "platformId", "externalId", email, "firstSeenAt") VALUES
        ('c_ana_bg','p_bg','1','Ana@X.com','2026-01-01'), ('c_ana_jv','p_jv','2',' ana@x.com','2026-01-01'), ('c_bia','p_d24','3','bia@x.com','2026-01-01');
    `);
    // Ana: FE na BuyGoods (Nitro), upsell 5 min depois, e 10 dias depois FE na JVZoo (Premium).
    await order('o1', { platformId: 'p_bg', productId: 'pr_bg', customerId: 'c_ana_bg', affiliateId: 'a_bg', orderedAt: at(0) });
    await order('o2', { platformId: 'p_bg', productId: 'pr_bgup', customerId: 'c_ana_bg', affiliateId: 'a_bg', productType: 'UPSELL', orderedAt: at(0.1) });
    await order('o3', { platformId: 'p_jv', productId: 'pr_jv', customerId: 'c_ana_jv', affiliateId: 'a_jv', orderedAt: at(240) });
    // Bia: FE na Digistore + a linha EXTRA de estorno (mesmo produto, FRONTEND, status REFUNDED) — não é FE nova.
    await order('o4', { platformId: 'p_d24', productId: 'pr_d24', customerId: 'c_bia', affiliateId: 'a_d24', orderedAt: at(48) });
    await order('o5', { platformId: 'p_d24', productId: 'pr_d24', customerId: 'c_bia', affiliateId: 'a_d24', status: 'REFUNDED', grossAmountUsd: -100, orderedAt: at(50) });

    const cc = (id: string, o: Record<string, unknown>) => ins('CallCenterSale', { id, externalKey: id, updatedAt: new Date(), ...o });
    await cc('cc1', { provider: 'logicall', email: 'ANA@x.com', amountUsd: 300, purchasedAt: at(1) });          // → Nitro
    await cc('cc2', { provider: 'tauk', email: 'ana@x.com', amountUsd: 200, purchasedAt: at(-24) });           // antes de qualquer FE → ninguém
    await cc('cc3', { provider: 'logicall', status: 'REFUNDED', email: 'bia@x.com', amountUsd: 150, purchasedAt: at(51) }); // estorno total sem valor → 150
    const sb = (id: string, o: Record<string, unknown>) => ins('SalesboundTransaction', { id, transactionId: id, orderId: 'so1', result: 'SUCCESS', items: '[]', updatedAt: new Date(), ...o });
    await sb('sb1', { type: 'SALE', amountUsd: 500, txnAt: at(288), saleAt: at(288), email: 'ana@x.com' });     // → Premium (FE mais recente)
    await sb('sb2', { type: 'REFUND', amountUsd: 100, txnAt: at(480), saleAt: at(288), email: 'ana@x.com' });   // estorno pela data da VENDA → Premium
    await sb('sb3', { type: 'SALE', result: 'HARD_DECLINE', amountUsd: 999, txnAt: at(300), email: 'ana@x.com' });
  }, 60_000);

  afterAll(async () => { await pg?.close(); });

  it('cada venda de backend vai pra FE mais recente do mesmo e-mail antes dela', async () => {
    const by = await run(at(-24), at(360));
    expect(Object.keys(by).sort()).toEqual(['a_bg', 'a_d24', 'a_jv']);
    expect(by.a_bg).toEqual({ affiliateId: 'a_bg', leads: 1, bySource: [{ source: 'logicall', gross: 300, refunds: 0, sales: 1 }] });
    expect(by.a_jv).toEqual({ affiliateId: 'a_jv', leads: 1, bySource: [{ source: 'salesbound', gross: 500, refunds: 100, sales: 1 }] });
    expect(by.a_d24).toEqual({ affiliateId: 'a_d24', leads: 1, bySource: [{ source: 'logicall', gross: 150, refunds: 150, sales: 1 }] });
  });

  it('FE fora do período não leva backend — e o backend dela não volta pro afiliado anterior', async () => {
    const by = await run(at(-24), at(120));   // a FE da JVZoo (hora 240) fica fora
    expect(Object.keys(by).sort()).toEqual(['a_bg', 'a_d24']);
    expect(by.a_bg.bySource).toEqual([{ source: 'logicall', gross: 300, refunds: 0, sales: 1 }]);
  });
});
