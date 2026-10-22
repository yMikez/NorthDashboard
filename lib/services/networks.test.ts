import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import type { PGlite } from '@electric-sql/pglite';
import { migratedPglite } from '../test/pgliteDb';
import { markNetworkOrdersSql, networkAccountsSql } from './networks';
import {
  buildNetworkTables, checkoutAggSql, networkAggSql, networkDailySql, networkDiagnosticsSql, networkRecentSql,
  type AggRow, type CheckoutRow, type NetworkFilters,
} from './networkMetrics';

const pgValue = (v: unknown) => (Array.isArray(v) ? `{${v.map((x) => JSON.stringify(String(x))).join(',')}}` : v);

function harness() {
  let pg: PGlite;
  const h = {
    get pg() { return pg; },
    async init() { pg = await migratedPglite({ extensions: false }); },
    q: async (sql: Prisma.Sql) => (await pg.query<Record<string, unknown>>(sql.text, (sql.values as unknown[]).map(pgValue))).rows,
    run: async (sql: Prisma.Sql) => (await pg.query(sql.text, (sql.values as unknown[]).map(pgValue))).affectedRows ?? 0,
    ins: (table: string, cols: Record<string, unknown>) => {
      const keys = Object.keys(cols);
      return pg.query(`INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(cols));
    },
    order: (id: string, o: Record<string, unknown>) => h.ins('Order', {
      id, externalId: id, platformId: 'p_jv', productId: 'pr_jv', currencyOriginal: 'USD', grossAmountOrig: o.grossAmountUsd ?? 69,
      grossAmountUsd: 69, eventType: 'x', updatedAt: new Date(), productType: 'FRONTEND', status: 'APPROVED', netAmountUsd: 0,
      orderedAt: new Date('2026-10-05T15:00:00Z'), ...o,
    }),
    sale: (tx: string, s: Record<string, unknown>) => h.ins('network_sales', {
      transaction_id: tx, network_id: 'net-1', attribution_status: 'attributed', last_source: 'event', raw: '{}', updated_at: new Date(), ...s,
    }),
  };
  return h;
}

describe('classificação dos pedidos de rede (PGlite)', () => {
  const h = harness();
  beforeAll(async () => {
    await h.init();
    await h.pg.exec(`
      INSERT INTO "Platform" (id, slug, "displayName") VALUES ('p_jv','jvzoo','JVZoo'), ('p_bg','buygoods','BuyGoods');
      INSERT INTO "Product" (id, "platformId", "externalId", name, "productType") VALUES
        ('pr_jv','p_jv','444171','NeuroMind Pro','FRONTEND'), ('pr_bg','p_bg','x','X','FRONTEND');
      INSERT INTO "Affiliate" (id, "platformId", "externalId", "firstSeenAt", "mappedAffiliateId") VALUES
        ('a_net','p_jv','3552295','2026-01-01','aff-x'),
        ('a_ind','p_jv','111','2026-01-01','aff-ind'),
        ('a_bg','p_bg','3552295','2026-01-01','aff-bg');
      INSERT INTO unmapped_affiliate_events (id, platform, external_id, affiliate_account_id, first_seen, last_seen) VALUES
        ('u1','jvzoo','3552295','a_net', now(), now()),
        ('u2','jvzoo','111','a_ind', now(), now()),
        ('u3','buygoods','3552295','a_bg', now(), now());
    `);
    // Conta de rede: FE e upsell sem afiliado (herda pelo funil).
    await h.order('T1', { affiliateId: 'a_net', mappedAffiliateId: 'aff-x' });
    await h.order('T1-UP', { parentExternalId: 'T1', grossAmountUsd: 97 });
    // Conta individual, mas com a marca do n8n: a marca vence; o upsell segue.
    await h.order('T2', { affiliateId: 'a_ind', mappedAffiliateId: 'aff-ind' });
    await h.order('T2-UP', { parentExternalId: 'T2', affiliateId: 'a_ind', mappedAffiliateId: 'aff-ind' });
    await h.sale('T2', {});
    // Individual sem marca e BuyGoods com o mesmo número: intocados.
    await h.order('T3', { affiliateId: 'a_ind', mappedAffiliateId: 'aff-ind' });
    await h.order('B1', { platformId: 'p_bg', productId: 'pr_bg', affiliateId: 'a_bg', mappedAffiliateId: 'aff-bg' });
  }, 60_000);
  afterAll(async () => { await h.pg.close(); });

  it('contas: marca a conta JVZoo da rede, tira o mapeamento e a fila', async () => {
    const [m, c, d] = networkAccountsSql(new Map([['3552295', 'net-1']]));
    expect(await h.run(m)).toBe(1);
    expect(await h.run(c)).toBe(0);
    expect(await h.run(d)).toBe(1);
    const acc = await h.q({ text: `SELECT id, "networkId", "mappedAffiliateId" FROM "Affiliate" ORDER BY id`, values: [] } as unknown as Prisma.Sql);
    expect(acc).toEqual([
      { id: 'a_bg', networkId: null, mappedAffiliateId: 'aff-bg' },
      { id: 'a_ind', networkId: null, mappedAffiliateId: 'aff-ind' },
      { id: 'a_net', networkId: 'net-1', mappedAffiliateId: null },
    ]);
    const queue = await h.q({ text: `SELECT id FROM unmapped_affiliate_events ORDER BY id`, values: [] } as unknown as Prisma.Sql);
    expect(queue.map((r) => r.id)).toEqual(['u2', 'u3']);
    // Idempotente.
    expect(await h.run(networkAccountsSql(new Map([['3552295', 'net-1']]))[0])).toBe(0);
  });

  it('pedidos: conta → marca → funil', async () => {
    for (const sql of markNetworkOrdersSql()) await h.run(sql);
    const rows = await h.q({ text: `SELECT id, "networkId", "mappedAffiliateId" FROM "Order" ORDER BY id`, values: [] } as unknown as Prisma.Sql);
    expect(rows).toEqual([
      { id: 'B1', networkId: null, mappedAffiliateId: 'aff-bg' },
      { id: 'T1', networkId: 'net-1', mappedAffiliateId: null },
      { id: 'T1-UP', networkId: 'net-1', mappedAffiliateId: null },
      { id: 'T2', networkId: 'net-1', mappedAffiliateId: null },
      { id: 'T2-UP', networkId: 'net-1', mappedAffiliateId: null },
      { id: 'T3', networkId: null, mappedAffiliateId: 'aff-ind' },
    ]);
    // Segunda passada não mexe em nada.
    let touched = 0;
    for (const sql of markNetworkOrdersSql()) touched += await h.run(sql);
    expect(touched).toBe(0);
  });

  it('conta que sai de todas as redes perde o networkId', async () => {
    const [, clear] = networkAccountsSql(new Map());
    expect(await h.run(clear)).toBe(1);
  });
});

describe('métricas da aba Networks (PGlite)', () => {
  const h = harness();
  const OCT: NetworkFilters = { start: new Date('2026-10-01T03:00:00Z'), end: new Date('2026-11-01T02:59:59Z') };
  const at = (d: string, hh = 15) => new Date(`2026-${d}T${String(hh).padStart(2, '0')}:00:00Z`);

  beforeAll(async () => {
    await h.init();
    await h.pg.exec(`
      INSERT INTO "Platform" (id, slug, "displayName") VALUES ('p_jv','jvzoo','JVZoo');
      INSERT INTO "Product" (id, "platformId", "externalId", name, "productType") VALUES ('pr_jv','p_jv','444171','NeuroMind Pro','FRONTEND');
      INSERT INTO affiliate_networks (network_id, name, status, jvzoo_affiliate_ids, synced_at, updated_at) VALUES
        ('net-1','ProStart','active','{3552295}', now(), now()), ('net-2','Alpha','active','{999}', now(), now());
      INSERT INTO affiliate_network_members (member_id, network_id, public_id, name, status, synced_at, updated_at) VALUES
        ('m1','net-1','AAA','Ana','active', now(), now()), ('m2','net-1','BBB','Bia','active', now(), now()),
        ('m3','net-2','CCC','Caio','suspended', now(), now());
    `);
    const money = { network_cpa: 230, member_amount: 200, network_margin: 30 };
    // S1: aprovada e paga; funil com upsell aprovado e outro estornado in-place.
    await h.sale('T1', { member_id: 'm1', sold_at: at('10-05'), state: 'approved', commission_status: 'paid', jvzoo_product_id: '444171', product_name: 'NeuroMind Pro', utm_source: 'fb', amount_usd: 69, ...money });
    await h.order('T1', { orderedAt: at('10-05') });
    await h.order('T1-UP', { parentExternalId: 'T1', grossAmountUsd: 97 });
    await h.order('T1-UP2', { parentExternalId: 'T1', grossAmountUsd: -50, status: 'REFUNDED' });
    // S2: a leitura ainda diz aprovada, mas o pedido já foi estornado.
    await h.sale('T2', { member_id: 'm1', sold_at: at('10-06'), state: 'approved', commission_status: 'pending', ...money });
    await h.order('T2', { grossAmountUsd: -69, status: 'REFUNDED' });
    // S3: retida (integrante suspenso).
    await h.sale('T3', { member_id: 'm2', sold_at: at('10-07'), state: 'held', commission_status: 'pending', ...money });
    await h.order('T3', {});
    // S4: chargeback, mas a comissão já tinha sido paga → continua devida.
    await h.sale('T4', { network_id: 'net-2', member_id: 'm3', sold_at: at('10-06'), state: 'chargeback', commission_status: 'paid', network_cpa: 100, member_amount: 80, network_margin: 20 });
    await h.order('T4', { grossAmountUsd: -69, status: 'CHARGEBACK' });
    // S5: upsell da conta da rede, sem comissão.
    await h.sale('T1-UP', { sold_at: at('10-05', 16), attribution_status: 'unattributed', attribution_reason: 'not_commissionable', amount_usd: 97 });
    // S6: teste; S7: pendente velha; S8: fora do período.
    await h.sale('T6', { member_id: 'm1', sold_at: at('10-08'), state: 'approved', is_test: true, ...money });
    await h.sale('T7', { sold_at: at('10-20'), attribution_status: 'pending', attribution_reason: 'awaiting_ipn' });
    await h.sale('T8', { member_id: 'm1', sold_at: at('09-15'), state: 'approved', ...money });
    // Checkouts: eventos (3 do m1, 1 sem integrante) e a contagem lida.
    let i = 0;
    for (const [member, utm] of [['m1', 'fb'], ['m1', 'fb'], ['m1', 'gg'], [null, 'fb']] as const) {
      await h.ins('network_checkouts', { session_id: `c${i++}`, network_id: 'net-1', member_id: member, jvzoo_product_id: member ? '444171' : null, at: at('10-05', 14), utm_source: utm, raw: '{}', updated_at: new Date() });
    }
    await h.ins('network_checkout_daily', { day: '2026-10-05', network_id: 'net-1', member_key: 'm1', product_key: '444171', checkouts: 5, synced_at: new Date() });
    await h.ins('network_checkout_daily', { day: '2026-10-06', network_id: 'net-2', member_key: 'm3', product_key: '444171', checkouts: 2, synced_at: new Date() });
  }, 60_000);
  afterAll(async () => { await h.pg.close(); });

  const tables = async (f: NetworkFilters) => {
    const agg = (await h.q(networkAggSql(f))) as unknown as AggRow[];
    const ck = (await h.q(checkoutAggSql(f))) as unknown as CheckoutRow[];
    return buildNetworkTables(agg, ck,
      [{ id: 'net-1', name: 'ProStart', status: 'active' }, { id: 'net-2', name: 'Alpha', status: 'active' }],
      [
        { id: 'm1', networkId: 'net-1', publicId: 'AAA', name: 'Ana', status: 'active' },
        { id: 'm2', networkId: 'net-1', publicId: 'BBB', name: 'Bia', status: 'active' },
        { id: 'm3', networkId: 'net-2', publicId: 'CCC', name: 'Caio', status: 'suspended' },
      ]);
  };

  it('KPIs do período', async () => {
    const { totals } = await tables(OCT);
    expect(totals).toMatchObject({
      sales: 4, refunds: 1, chargebacks: 1, held: 1, heldCpa: 230,
      cpaDue: 560, memberDue: 480, memberPaid: 280, margin: 80,
      revenue: 235, profit: -325, checkouts: 8, conversion: 0.5, netSales: 2,
    });
    expect(totals.refundPct).toBe(0.25);
  });

  it('por rede e por integrante', async () => {
    const { byNetwork, byMember } = await tables(OCT);
    expect(byNetwork.map((n) => [n.networkId, n.sales, n.netSales, n.checkouts, n.membersActive, n.membersWithSales])).toEqual([
      ['net-1', 3, 2, 6, 2, 2],
      ['net-2', 1, 0, 2, 0, 1],
    ]);
    const ana = byMember.find((m) => m.memberId === 'm1')!;
    expect(ana).toMatchObject({ publicId: 'AAA', sales: 2, refunds: 1, revenue: 166, checkouts: 5, memberPaid: 200 });
    expect(byMember.find((m) => m.memberId === null)).toMatchObject({ name: 'Sem integrante', sales: 0, checkouts: 1 });
  });

  it('testes entram só quando pedidos', async () => {
    expect((await tables({ ...OCT, includeTests: true })).totals.sales).toBe(5);
  });

  it('filtro de tráfego: vendas e checkouts só pelos eventos', async () => {
    const { totals } = await tables({ ...OCT, utmSource: 'fb' });
    expect(totals.sales).toBe(1);
    expect(totals.checkouts).toBe(3);
  });

  it('filtro de rede/integrante', async () => {
    const { totals } = await tables({ ...OCT, networkId: 'net-1', memberId: 'm1' });
    expect(totals).toMatchObject({ sales: 2, checkouts: 5, revenue: 166 });
  });

  it('série diária', async () => {
    const rows = await h.q(networkDailySql(OCT));
    expect(rows).toEqual([
      { day: '2026-10-05', network_id: 'net-1', sales: 1, checkouts: 6 },
      { day: '2026-10-06', network_id: 'net-1', sales: 1, checkouts: 0 },
      { day: '2026-10-06', network_id: 'net-2', sales: 1, checkouts: 2 },
      { day: '2026-10-07', network_id: 'net-1', sales: 1, checkouts: 0 },
    ]);
  });

  it('vendas recentes: todas as atribuições, situação efetiva, nomes', async () => {
    const rows = await h.q(networkRecentSql(OCT, 1));
    expect(rows.map((r) => r.transaction_id)).toEqual(['T7', 'T3', 'T2', 'T4', 'T1-UP', 'T1']);
    expect(rows[0].total).toBe(6);
    const t2 = rows.find((r) => r.transaction_id === 'T2')!;
    expect(t2).toMatchObject({ state: 'refunded', network_name: 'ProStart', member_public_id: 'AAA', order_external_id: 'T2' });
  });

  it('diagnóstico: sem atribuição por motivo e pendente há mais de 1 h', async () => {
    const d = networkDiagnosticsSql(OCT, new Date('2026-10-22T12:00:00Z'));
    expect(await h.q(d.unattributed)).toEqual([{ reason: 'not_commissionable', sales: 1, amount: 97 }]);
    const pending = await h.q(d.pending);
    expect(pending.map((r) => [r.transaction_id, r.has_order])).toEqual([['T7', false]]);
  });
});
