import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import type { PGlite } from '@electric-sql/pglite';
import { migratedPglite } from '../test/pgliteDb';
import { DAYS_PER_BOTTLE, estimateBottlesFromAmount, leadStock } from './leadStock';
import {
  buildLeadDetail, leadCallCenterEventsSql, leadKpisSql, leadListSql, leadOrderEventsSql, leadSalesboundEventsSql, type LeadFilters,
} from './leads';

const DAY = 86_400_000;
const NOW = Date.now();
const ago = (days: number) => new Date(NOW - days * DAY);

describe('leadStock (puro)', () => {
  const at = (d: string) => new Date(`${d}T12:00:00Z`);
  const now = at('2026-10-12');

  it('cada pote dura 30 dias; compras do MESMO produto entram em fila', () => {
    expect(DAYS_PER_BOTTLE).toBe(30);
    const s = leadStock([
      { family: 'NeuroMindPro', at: at('2026-09-01'), bottles: 1, estimated: false },   // acaba 01/10
      { family: 'NeuroMindPro', at: at('2026-09-11'), bottles: 1, estimated: false },   // começa 01/10 → 31/10
    ], now);
    expect(s.families).toHaveLength(1);
    expect(s.stockUntil).toBe(at('2026-10-31').toISOString());
    expect(s).toMatchObject({ bottles: 2, daysLeft: 19 });
  });

  it('se o estoque já tinha acabado, a compra nova começa no dia dela', () => {
    const s = leadStock([
      { family: 'X', at: at('2026-01-01'), bottles: 1, estimated: false },   // acaba 31/01
      { family: 'X', at: at('2026-06-01'), bottles: 2, estimated: false },   // 01/06 + 60 dias
    ], now);
    expect(s.stockUntil).toBe(at('2026-07-31').toISOString());
    expect(s.daysLeft).toBe(0);
  });

  it('produtos diferentes correm em paralelo; o lead acaba quando o último acaba', () => {
    const s = leadStock([
      { family: 'A', at: at('2026-09-01'), bottles: 6, estimated: false },
      { family: 'B', at: at('2026-09-01'), bottles: 3, estimated: true },
      { family: null, at: at('2026-09-01'), bottles: 0, estimated: false },
    ], now);
    expect(s.families.map((f) => [f.family, f.bottles, f.estimatedBottles])).toEqual([['A', 6, 0], ['B', 3, 3]]);
    expect(s.stockUntil).toBe(new Date(at('2026-09-01').getTime() + 180 * DAY).toISOString());
    expect(s).toMatchObject({ bottles: 9, estimatedBottles: 3 });
  });

  it('Tauk sem potes: estimativa pelo valor nas faixas da Logicall', () => {
    expect([0, 79, 158, 207, 294, 299, 389, 650].map(estimateBottlesFromAmount)).toEqual([0, 1, 2, 3, 6, 6, 12, 12]);
  });
});

describe('MV lead_summary × ficha: mesmo estoque (PGlite)', () => {
  let pg: PGlite;
  const pgValue = (v: unknown) => (Array.isArray(v) ? `{${v.map((x) => JSON.stringify(String(x))).join(',')}}` : v);
  const q = async (sql: Prisma.Sql) => (await pg.query<Record<string, unknown>>(sql.text, (sql.values as unknown[]).map(pgValue))).rows;
  const ins = (table: string, cols: Record<string, unknown>) => {
    const keys = Object.keys(cols);
    return pg.query(`INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(cols));
  };
  const order = (id: string, o: Record<string, unknown>) => ins('Order', {
    id, externalId: id, currencyOriginal: 'USD', grossAmountOrig: 100, grossAmountUsd: 100, originalGrossUsd: 100, eventType: 'x', updatedAt: new Date(),
    productType: 'FRONTEND', status: 'APPROVED', netAmountUsd: 0, ...o,
  });
  const ALL: LeadFilters = { startDate: new Date(NOW - 400 * DAY), endDate: new Date(NOW + DAY) };

  beforeAll(async () => {
    pg = await migratedPglite({ extensions: false });
    await pg.exec(`
      INSERT INTO "Platform" (id, slug, "displayName") VALUES ('p_bg','buygoods','BuyGoods'), ('p_d24','digistore24','Digistore24');
      INSERT INTO "Product" (id, "platformId", "externalId", name, "productType", family, bottles, "bonusBottles") VALUES
        ('pr_fe','p_bg','fe6','Neuro Mind Pro 6','FRONTEND','NeuroMindPro',6,NULL),
        ('pr_up','p_bg','up3','Neuro Mind Pro 3+1','UPSELL','NeuroMindPro',3,1),
        ('pr_gp','p_d24','gp3','GlycoPulse 3','FRONTEND','GlycoPulse',3,NULL);
      INSERT INTO "Customer" (id, "platformId", "externalId", email, "firstSeenAt") VALUES
        ('c_ana','p_bg','1','ana@x.com','2026-01-01'), ('c_ana2','p_d24','2','ana@x.com','2026-01-01');
    `);
    // Ana: FE 6 + upsell 3+1 do mesmo produto (snapshot do catálogo) → 10 potes; GlycoPulse 3 numa
    // compra posterior (com a linha EXTRA de estorno da Digistore, que não conta).
    await order('o1', { platformId: 'p_bg', productId: 'pr_fe', customerId: 'c_ana', orderedAt: ago(170), bottlesShipped: 6 });
    await order('o2', { platformId: 'p_bg', productId: 'pr_up', customerId: 'c_ana', productType: 'UPSELL', orderedAt: ago(170), bottlesShipped: null });
    await order('o3', { platformId: 'p_d24', productId: 'pr_gp', customerId: 'c_ana2', orderedAt: ago(100), bottlesShipped: 3 });
    await order('o4', { platformId: 'p_d24', productId: 'pr_gp', customerId: 'c_ana2', status: 'REFUNDED', grossAmountUsd: -100, originalGrossUsd: -100, orderedAt: ago(100), bottlesShipped: 3 });
    const cc = (id: string, o: Record<string, unknown>) => ins('CallCenterSale', { id, externalKey: id, updatedAt: new Date(), ...o });
    // Bia: Tauk US$ 299 sem potes → estimado 6 → acaba em 5 dias.
    await cc('t1', { provider: 'tauk', email: 'bia@x.com', amountUsd: 299, purchasedAt: ago(175) });
    // Dani: Logicall, 2 compras de 1 pote do mesmo produto → fila → acaba em 10 dias.
    await cc('l1', { provider: 'logicall', email: 'dani@x.com', amountUsd: 80, bottles: 1, family: 'NightCalm', purchasedAt: ago(50) });
    await cc('l2', { provider: 'logicall', email: 'dani@x.com', amountUsd: 80, bottles: 1, family: 'NightCalm', purchasedAt: ago(40) });
    // Eva: 2 potes há 80 dias → acabou há 20.
    await cc('l3', { provider: 'logicall', email: 'eva@x.com', amountUsd: 158, bottles: 2, family: 'GlycoPulse', purchasedAt: ago(80) });
    const sb = (id: string, o: Record<string, unknown>) => ins('SalesboundTransaction', { id, transactionId: id, result: 'SUCCESS', updatedAt: new Date(), ...o });
    // Caio: SalesBound item a item (NightCalm 6 + ImmuneGuard 3); outra venda anulada (void) não conta.
    await sb('s1', { orderId: 'so1', type: 'SALE', amountUsd: 400, txnAt: ago(100), email: 'caio@x.com',
      items: JSON.stringify([{ name: 'Night Calm - 1 Bottle', qty: 6, bottles: 1, family: 'NightCalm' }, { name: 'ImmuneGuard - 1 Bottle', qty: 3, bottles: 1, family: 'ImmuneGuard' }]) });
    await sb('s2', { orderId: 'so2', type: 'SALE', amountUsd: 800, txnAt: ago(10), email: 'caio@x.com', items: JSON.stringify([{ name: 'Night Calm - 1 Bottle', qty: 18, bottles: 1, family: 'NightCalm' }]) });
    await sb('s3', { orderId: 'so2', type: 'VOID', amountUsd: 800, txnAt: ago(10), email: 'caio@x.com', items: '[]' });
    await pg.exec('REFRESH MATERIALIZED VIEW lead_summary');
  }, 60_000);

  afterAll(async () => { await pg?.close(); });

  const detailOf = async (email: string) => {
    const asDates = (rs: Record<string, unknown>[]) => rs.map((r) => ({ ...r, at: new Date(r.at as string), refundedAt: r.refundedAt ? new Date(r.refundedAt as string) : null }));
    return buildLeadDetail(email,
      asDates(await q(leadOrderEventsSql(email))) as never,
      asDates(await q(leadCallCenterEventsSql(email))) as never,
      asDates(await q(leadSalesboundEventsSql(email))) as never);
  };

  it('potes e "estoque até" da MV batem com a ficha, lead a lead', async () => {
    const { rows } = await pg.query<{ email: string; bottles: number; bottles_estimated: number; stock_until: Date | null; stock_family: string | null }>(
      `SELECT email, bottles, bottles_estimated, stock_until, stock_family FROM lead_summary ORDER BY email`);
    const expected: Record<string, { bottles: number; est: number; untilDays: number; family: string }> = {
      'ana@x.com': { bottles: 13, est: 0, untilDays: -170 + 300, family: 'NeuroMindPro' },   // 6 + (3+1) = 10 potes de Neuro → 300 dias
      'bia@x.com': { bottles: 6, est: 6, untilDays: -175 + 180, family: '—' },
      'caio@x.com': { bottles: 9, est: 0, untilDays: -100 + 180, family: 'NightCalm' },       // void fora: só os 6 + 3 da 1ª venda
      'dani@x.com': { bottles: 2, est: 0, untilDays: -20 + 30, family: 'NightCalm' },        // 1º acaba em −20, 2º começa ali
      'eva@x.com': { bottles: 2, est: 0, untilDays: -80 + 60, family: 'GlycoPulse' },
    };
    expect(rows.map((r) => r.email)).toEqual(Object.keys(expected));
    for (const r of rows) {
      const e = expected[r.email];
      expect(r).toMatchObject({ bottles: e.bottles, bottles_estimated: e.est, stock_family: e.family });
      const until = new Date(r.stock_until as Date).getTime();
      const d = await detailOf(r.email);
      expect(d.stock.bottles).toBe(e.bottles);
      expect(new Date(d.stock.stockUntil!).getTime()).toBe(until);
      expect(Math.round((until - NOW) / DAY)).toBe(e.untilDays);
    }
  });

  it('ficha: estoque por produto e potes estimados marcados nos eventos', async () => {
    const ana = await detailOf('ana@x.com');
    expect(ana.stock.families.map((f) => [f.family, f.bottles])).toEqual([['NeuroMindPro', 10], ['GlycoPulse', 3]]);
    expect(ana.stock.families[1].daysLeft).toBe(0);
    const bia = await detailOf('bia@x.com');
    expect(bia.events[0]).toMatchObject({ bottles: 6, bottlesEstimated: true });
    expect(bia.stock.estimatedBottles).toBe(6);
  });

  it('atalhos de estoque, ordenação "acaba primeiro" e KPIs', async () => {
    const emails = async (f: LeadFilters) => (await q(leadListSql(f))).map((r) => r.email);
    expect(await emails({ ...ALL, segment: 'stock_low', sort: 'stock' })).toEqual(['bia@x.com', 'dani@x.com']);
    expect(await emails({ ...ALL, segment: 'stock_out' })).toEqual(['eva@x.com']);
    expect(await emails({ ...ALL, sort: 'stock' })).toEqual(['bia@x.com', 'dani@x.com', 'caio@x.com', 'ana@x.com', 'eva@x.com']);
    const [row] = await q(leadListSql({ ...ALL, q: 'bia' }));
    expect(row).toMatchObject({ bottles: 6, bottlesEstimated: 6, stockFamily: '—' });
    const [k] = await q(leadKpisSql(ALL));
    expect(k).toMatchObject({ bottles: 32, bottlesEstimated: 6, leadsWithBottles: 5, leadsWithStock: 4, stockLowLeads: 2, stockOutLeads: 1 });
  });
});
