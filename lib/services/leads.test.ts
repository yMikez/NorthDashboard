import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import type { PGlite } from '@electric-sql/pglite';
import { migratedPglite } from '../test/pgliteDb';
import {
  buildLeadDetail, clickbankBackfillSql, leadBreakdownSql, leadCallCenterEventsSql, leadKpisSql, leadListSql,
  leadOrderEventsSql, leadSalesboundEventsSql, normalizeLeadEmail, type LeadFilters,
} from './leads';

const daysAgo = (n: number, h = 15) => new Date(Date.UTC(2026, 9, 9 - n, h, 0, 0));
// Janela larga cobrindo todas as fixtures (as datas são fixas, não relativas a "agora").
const ALL: LeadFilters = { startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2026-12-31T23:59:59Z') };

describe('normalizeLeadEmail', () => {
  it('normaliza e recusa lixo', () => {
    expect(normalizeLeadEmail('  Ana@X.COM ')).toBe('ana@x.com');
    expect(normalizeLeadEmail('sem-arroba')).toBeNull();
    expect(normalizeLeadEmail('a b@x.com')).toBeNull();
  });
});

describe('aba Leads no Postgres (PGlite com as migrações)', () => {
  let pg: PGlite;
  const pgValue = (v: unknown) => (Array.isArray(v) ? `{${v.map((x) => JSON.stringify(String(x))).join(',')}}` : v);
  const q = async (sql: Prisma.Sql) => (await pg.query<Record<string, unknown>>(sql.text, (sql.values as unknown[]).map(pgValue))).rows;
  const ins = (table: string, cols: Record<string, unknown>) => {
    const keys = Object.keys(cols);
    return pg.query(`INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(cols));
  };
  const order = (id: string, o: Record<string, unknown>) => ins('Order', {
    id, externalId: id, currencyOriginal: 'USD', grossAmountOrig: o.grossAmountUsd, eventType: 'x', updatedAt: new Date(),
    productType: 'FRONTEND', status: 'APPROVED', netAmountUsd: 0, country: 'US', ...o,
  });

  beforeAll(async () => {
    pg = await migratedPglite({ extensions: false });
    await pg.exec(`
      INSERT INTO "Platform" (id, slug, "displayName") VALUES
        ('p_bg','buygoods','BuyGoods'), ('p_jv','jvzoo','JVZoo'), ('p_d24','digistore24','Digistore24'), ('p_cb','clickbank','ClickBank');
      INSERT INTO "Product" (id, "platformId", "externalId", name, "productType", family) VALUES
        ('pr_bg','p_bg','neu6','Neuro Mind Pro 6','FRONTEND','NeuroMindPro'),
        ('pr_bgup','p_bg','neuup','Neuro Mind Pro Upsell','UPSELL','NeuroMindPro'),
        ('pr_jv','p_jv','2322247','NeuroRecall 6','FRONTEND','NeuroRecall'),
        ('pr_d24','p_d24','gp3','GlycoPulse 3','FRONTEND','GlycoPulse'),
        ('pr_cb','p_cb','tb6','ThermoBurn 6','FRONTEND','ThermoBurnPro');
      INSERT INTO "Affiliate" (id, "platformId", "externalId", nickname, "firstSeenAt") VALUES
        ('a_prem','p_jv','2322247','Premium','2026-01-01'), ('a_bg','p_bg','77@12595','Nitro','2026-01-01');
      INSERT INTO "Customer" (id, "platformId", "externalId", email, "firstName", "lastName", "firstSeenAt") VALUES
        ('c_ana_bg','p_bg','bg1','Ana@X.com','Ana','Souza','2026-01-01'),
        ('c_ana_jv','p_jv','jv1',' ana@x.com ',NULL,NULL,'2026-01-01'),
        ('c_bia','p_d24','d1','bia@x.com','Bia','Lima','2026-01-01'),
        ('c_semmail','p_bg','bg2',NULL,'Sem','Email','2026-01-01');
    `);
    // Ana: BuyGoods FE + upsell no mesmo dia (upsell estornado in-place), JVZoo 40 dias depois,
    // call center 100 dias depois (estorno parcial) e SalesBound 200 dias depois com reembolso.
    await order('o1', { platformId: 'p_bg', productId: 'pr_bg', customerId: 'c_ana_bg', affiliateId: 'a_bg', grossAmountUsd: 294, originalGrossUsd: 294, orderedAt: daysAgo(260), bottlesShipped: 6 });
    await order('o2', { platformId: 'p_bg', productId: 'pr_bgup', customerId: 'c_ana_bg', affiliateId: 'a_bg', productType: 'UPSELL', status: 'REFUNDED', grossAmountUsd: -100, originalGrossUsd: 100, orderedAt: new Date(daysAgo(260).getTime() + 600_000), refundedAt: daysAgo(250) });
    await order('o3', { platformId: 'p_jv', productId: 'pr_jv', customerId: 'c_ana_jv', affiliateId: 'a_prem', grossAmountUsd: 207, originalGrossUsd: 207, orderedAt: daysAgo(220) });
    await ins('CallCenterSale', { id: 'cc1', externalKey: 'k1', provider: 'logicall', status: 'APPROVED', email: 'ANA@x.com', amountUsd: 150, refundedUsd: 50, purchasedAt: daysAgo(160), updatedAt: new Date(), productName: 'NeuroMind 3', family: 'NeuroMindPro' });
    await ins('SalesboundTransaction', { id: 'sb1', transactionId: 't1', orderId: 'so1', type: 'SALE', result: 'SUCCESS', amountUsd: 500, txnAt: daysAgo(60), email: 'ana@x.com', items: JSON.stringify([{ name: 'Bundle 12' }]), updatedAt: new Date() });
    await ins('SalesboundTransaction', { id: 'sb2', transactionId: 't2', orderId: 'so1', type: 'REFUND', result: 'SUCCESS', amountUsd: 200, txnAt: daysAgo(40), email: 'ana@x.com', items: '[]', updatedAt: new Date() });
    await ins('SalesboundTransaction', { id: 'sb3', transactionId: 't3', orderId: 'so2', type: 'SALE', result: 'HARD_DECLINE', amountUsd: 999, txnAt: daysAgo(30), email: 'ana@x.com', items: '[]', updatedAt: new Date() });
    // Bia: Digistore, estorno em LINHA EXTRA (a venda continua APPROVED).
    await order('o4', { platformId: 'p_d24', productId: 'pr_d24', customerId: 'c_bia', grossAmountUsd: 197, originalGrossUsd: 197, orderedAt: daysAgo(10) });
    await order('o5', { platformId: 'p_d24', productId: 'pr_d24', customerId: 'c_bia', externalId: 'o4-refund', parentExternalId: 'o4', status: 'REFUNDED', grossAmountUsd: -197, originalGrossUsd: -197, orderedAt: daysAgo(10), refundedAt: daysAgo(5) });
    // Pendente não conta; cliente sem e-mail fica fora.
    await order('o6', { platformId: 'p_d24', productId: 'pr_d24', customerId: 'c_bia', status: 'PENDING', grossAmountUsd: 50, orderedAt: daysAgo(9) });
    await order('o7', { platformId: 'p_bg', productId: 'pr_bg', customerId: 'c_semmail', grossAmountUsd: 99, orderedAt: daysAgo(3) });
    // Carla: só call center (nunca comprou no funil).
    await ins('CallCenterSale', { id: 'cc2', externalKey: 'k2', provider: 'tauk', status: 'REFUNDED', email: 'carla@x.com', firstName: 'Carla', amountUsd: 120, purchasedAt: daysAgo(20), updatedAt: new Date() });
    await ins('CallCenterSale', { id: 'cc3', externalKey: 'k3', provider: 'tauk', status: 'APPROVED', email: 'carla@x.com', amountUsd: 80, purchasedAt: daysAgo(19), updatedAt: new Date() });
    // ClickBank sem cliente (bug antigo) + o IPN guardado com o e-mail.
    await order('o8', { platformId: 'p_cb', productId: 'pr_cb', grossAmountUsd: 300, originalGrossUsd: 300, orderedAt: daysAgo(5), country: 'CA' });
    await ins('IngestLog', { id: 'l1', source: 'webhook', platformSlug: 'clickbank', eventType: 'SALE', externalId: 'o8', receivedAt: daysAgo(5),
      payload: JSON.stringify({ customer: { billing: { email: ' Dani@X.com', firstName: 'Dani', lastName: 'Reis' } }, orderLanguage: 'EN' }) });
  }, 60_000);

  afterAll(async () => { await pg?.close(); });

  it('ClickBank: recria o cliente pelo IPN guardado, vincula o pedido e é idempotente', async () => {
    const sql = clickbankBackfillSql();
    expect(await q(sql.count)).toEqual([{ orders: 1, customers: 1 }]);
    await q(sql.insert);
    await q(sql.link);
    const { rows: [c] } = await pg.query(`SELECT c."externalId", c.email, c."firstName", c.language, c.country FROM "Order" o JOIN "Customer" c ON c.id = o."customerId" WHERE o.id = 'o8'`);
    expect(c).toEqual({ externalId: 'dani@x.com', email: 'dani@x.com', firstName: 'Dani', language: 'en', country: 'CA' });
    expect(await q(sql.count)).toEqual([{ orders: 0, customers: 0 }]);
  });

  it('MV: uma linha por e-mail somando funil + call center + SalesBound, com as regras de estorno de cada fonte', async () => {
    await pg.exec('REFRESH MATERIALIZED VIEW lead_summary');
    const rows = await pg.query<Record<string, unknown>>(`SELECT email, purchases, purchase_days, gross_usd::float g, refunded_usd::float r, ltv_usd::float ltv,
      funnel_usd::float f, callcenter_usd::float cc, salesbound_usd::float sb, ltv_24h::float d1, ltv_30d::float d30, ltv_90d::float d90, ltv_180d::float d180,
      origin_channel, origin_platform, origin_affiliate_id, origin_family, origin_product, country, name, channels, platforms FROM lead_summary ORDER BY email`);
    const by = Object.fromEntries(rows.rows.map((r) => [r.email, r]));
    expect(Object.keys(by)).toEqual(['ana@x.com', 'bia@x.com', 'carla@x.com', 'dani@x.com']);
    // Ana: vendas 294+100+207+150+500 = 1251; estornos 100 (in-place) + 50 (parcial) + 200 (SB) = 350.
    expect(by['ana@x.com']).toMatchObject({
      purchases: 5, purchase_days: 4, g: 1251, r: 350, ltv: 901, f: 501, cc: 100, sb: 300,
      d1: 294, d30: 294, d90: 501, d180: 601,
      origin_channel: 'funil', origin_platform: 'buygoods', origin_affiliate_id: 'a_bg', origin_family: 'NeuroMindPro',
      origin_product: 'Neuro Mind Pro 6', country: 'US', name: 'Ana Souza',
    });
    expect([...(by['ana@x.com'].channels as string[])].sort()).toEqual(['callcenter', 'funil', 'salesbound']);
    // Bia: Digistore linha extra — a venda conta 1x, o estorno abate; pendente fica fora.
    expect(by['bia@x.com']).toMatchObject({ purchases: 1, g: 197, r: 197, ltv: 0, origin_platform: 'digistore24' });
    // Carla: só call center; estorno total sem refundedUsd tira a venda inteira.
    expect(by['carla@x.com']).toMatchObject({ purchases: 2, purchase_days: 2, g: 200, r: 120, ltv: 80, origin_channel: 'callcenter', origin_platform: 'tauk', name: 'Carla' });
    expect(by['dani@x.com']).toMatchObject({ ltv: 300, origin_platform: 'clickbank', country: 'CA' });
  });

  it('lista: ordem, total, filtros de origem, segmentos e busca que ignora os filtros', async () => {
    const list = await q(leadListSql({ ...ALL, sort: 'ltv' }));
    expect(list.map((r) => r.email)).toEqual(['ana@x.com', 'dani@x.com', 'carla@x.com', 'bia@x.com']);
    expect(list[0]).toMatchObject({ total: 4, originAffiliate: 'Nitro', ltvUsd: 901 });

    const emails = async (f: LeadFilters) => (await q(leadListSql(f))).map((r) => r.email);
    expect(await emails({ ...ALL, platforms: ['buygoods'] })).toEqual(['ana@x.com']);
    expect(await emails({ ...ALL, affiliateIds: ['a_prem'] })).toEqual([]); // Premium não é a ORIGEM da Ana
    expect(await emails({ ...ALL, families: ['GlycoPulse'] })).toEqual(['bia@x.com']);
    expect(await emails({ ...ALL, countries: ['CA'] })).toEqual(['dani@x.com']);
    expect(await emails({ ...ALL, segment: 'repeat' })).toEqual(['ana@x.com', 'carla@x.com']);
    expect(await emails({ ...ALL, segment: 'multichannel' })).toEqual(['ana@x.com']);
    expect(await emails({ ...ALL, segment: 'refunded', sort: 'refunds' })).toEqual(['ana@x.com', 'bia@x.com', 'carla@x.com']);
    // Período: só quem fez a 1ª compra nele.
    expect(await emails({ startDate: new Date(daysAgo(30)), endDate: new Date(daysAgo(0)), sort: 'new' })).toEqual(['dani@x.com', 'bia@x.com', 'carla@x.com']);
    // Busca: acha por nome mesmo com filtro que excluiria; % e _ não viram curinga.
    expect(await emails({ ...ALL, platforms: ['jvzoo'], q: 'souza' })).toEqual(['ana@x.com']);
    expect(await emails({ ...ALL, q: '_' })).toEqual([]);
  });

  it('KPIs e curva: janelas só contam leads que já viveram a janela', async () => {
    const [k] = await q(leadKpisSql(ALL));
    expect(k).toMatchObject({
      leads: 4, ltvUsd: 1281, grossUsd: 1948, refundedUsd: 667, callcenterUsd: 180, salesboundUsd: 300,
      repeatLeads: 2, multichannelLeads: 1, callcenterLeads: 2, salesboundLeads: 1, refundedLeads: 3,
    });
    // Elegíveis medidos contra now() real: as fixtures de 2026-10 só valem enquanto now() ≥ 2026-10-09.
    expect(k.ltv_180dEligible).toBeGreaterThanOrEqual(1);
  });

  it('quebra por origem: canal e afiliado', async () => {
    const ch = await q(leadBreakdownSql(ALL, 'channel'));
    expect(ch.map((g) => [g.key, g.leads, g.ltvUsd])).toEqual([['funil', 3, 1201], ['callcenter', 1, 80]]);
    const aff = await q(leadBreakdownSql(ALL, 'affiliate'));
    expect(aff.find((g) => g.key === 'a_bg')).toMatchObject({ label: 'Nitro · buygoods', leads: 1, ltvUsd: 901 });
  });

  it('ficha: eventos ao vivo batem com a MV e mostram estorno de cada fonte', async () => {
    const email = 'ana@x.com';
    const asDates = (rows: Record<string, unknown>[]) => rows.map((r) => ({ ...r, at: new Date(r.at as string), refundedAt: r.refundedAt ? new Date(r.refundedAt as string) : null }));
    const d = buildLeadDetail(
      email,
      asDates(await q(leadOrderEventsSql(email))) as never,
      asDates(await q(leadCallCenterEventsSql(email))) as never,
      asDates(await q(leadSalesboundEventsSql(email))) as never,
    );
    expect(d.summary).toMatchObject({ purchases: 5, purchaseDays: 4, grossUsd: 1251, refundedUsd: 350, ltvUsd: 901, funnelUsd: 501, callcenterUsd: 100, salesboundUsd: 300 });
    expect(d.summary.origin).toMatchObject({ channel: 'funil', source: 'buygoods', affiliate: 'Nitro' });
    expect(d.events.map((e) => `${e.channel}:${e.kind}`)).toEqual([
      'funil:venda', 'funil:venda', 'funil:venda', 'callcenter:venda', 'salesbound:venda', 'salesbound:estorno',
    ]);
    expect(d.products.find((p) => p.product === 'Neuro Mind Pro Upsell')).toMatchObject({ times: 1, grossUsd: 100, refundedUsd: 100 });
    // Reembolso da SalesBound herda o produto da venda do mesmo pedido.
    expect(d.products.find((p) => p.product === 'Bundle 12')).toMatchObject({ times: 1, grossUsd: 500, refundedUsd: 200 });
    expect(d.products.some((p) => p.product === '(sem nome)')).toBe(false);
  });

  it('ficha: Digistore em linha extra vira evento de estorno; pendente aparece sem contar', async () => {
    const email = 'bia@x.com';
    const asDates = (rows: Record<string, unknown>[]) => rows.map((r) => ({ ...r, at: new Date(r.at as string), refundedAt: r.refundedAt ? new Date(r.refundedAt as string) : null }));
    const d = buildLeadDetail(email, asDates(await q(leadOrderEventsSql(email))) as never, [], []);
    expect(d.events.map((e) => [e.kind, e.counted, e.saleUsd, e.refundedUsd])).toEqual([
      ['venda', true, 197, 0], ['estorno', true, 0, 197], ['pendente', false, 50, 0],
    ]);
    expect(d.summary).toMatchObject({ purchases: 1, grossUsd: 197, ltvUsd: 0 });
  });
});
