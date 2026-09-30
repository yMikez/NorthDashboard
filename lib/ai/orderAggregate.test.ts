import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import type { Prisma } from '@prisma/client';
import { migratedPglite } from '../test/pgliteDb';
import {
  OrderAggInputError, buildMainSql, buildSessionSql, mergeAggregates, parseOrderAggSpec, type OrderAggSpec,
} from './orderAggregate';

// Dia BRT → instante UTC (BRT = UTC−3 fixo).
const brt = (day: string, hhmm = '00:00') => new Date(Date.parse(`${day}T${hhmm}:00Z`) + 3 * 3600 * 1000);
const dayStart = (d: string) => brt(d);
const dayEnd = (d: string) => new Date(brt(d).getTime() + 86_400_000 - 1);

function spec(raw: Record<string, unknown>, from = '2026-09-01', to = '2026-09-04'): OrderAggSpec {
  return parseOrderAggSpec(raw, { startAt: dayStart(from), endAt: dayEnd(to) });
}

describe('parseOrderAggSpec — whitelist', () => {
  it('recusa dimensão/métrica/status fora da lista (nunca vira SQL)', () => {
    expect(() => spec({ group_by: ['day; DROP TABLE "Order"'] })).toThrow(OrderAggInputError);
    expect(() => spec({ metrics: ['gross_approved', 'sum(x)'] })).toThrow(/metrics inválido/);
    expect(() => spec({ status: ['DELETED'] })).toThrow(/status inválido/);
    expect(() => spec({ stages: ['UP1'] })).toThrow(/stages inválido/);
    expect(() => spec({ date_axis: 'approval' })).toThrow(/date_axis/);
    expect(() => spec({ group_by: ['day', 'platform', 'family', 'country'] })).toThrow(/3 dimensões/);
  });

  it('eixo do estorno: sem métricas de sessão/aprovação e status só REFUNDED/CHARGEBACK', () => {
    expect(() => spec({ date_axis: 'refund_event', metrics: ['aov_session'] })).toThrow(/eixo da venda/);
    expect(() => spec({ date_axis: 'refund_event', metrics: ['approval_rate'] })).toThrow(/eixo da venda/);
    expect(() => spec({ date_axis: 'refund_event', status: ['APPROVED'] })).toThrow(/REFUNDED/);
    expect(spec({ date_axis: 'refund_event', metrics: ['refunds', 'refund_rate'] }).axis).toBe('refund_event');
  });

  it('order_by precisa ser métrica pedida ou dimensão; limit com teto', () => {
    expect(() => spec({ metrics: ['approved'], order_by: 'net' })).toThrow(/precisa estar em metrics/);
    expect(() => spec({ order_by: 'x' })).toThrow(/order_by/);
    expect(spec({ limit: 99999 }).limit).toBe(1000);
    expect(spec({}).metrics).toEqual(['approved', 'gross_approved']);
  });
});

describe('SQL builder', () => {
  it('snapshot: só fragmentos da whitelist, valores como parâmetros', () => {
    const s = spec({
      group_by: ['day', 'platform'],
      metrics: ['gross_approved', 'real_orders', 'refund_rate'],
      platforms: ['clickbank', 'digistore24'],
      families: ['NeuroMindPro'],
      stages: ['FRONTEND'],
      countries: ['US'],
      affiliate_ids: ['aff_1'],
      status: ['APPROVED', 'REFUNDED'],
    });
    const main = buildMainSql(s);
    expect(main.text).toMatchSnapshot();
    expect(main.values).toEqual([
      ['digistore24'], ['digistore24'],
      s.startAt, s.endAt,
      ['clickbank', 'digistore24'], ['US'], ['NeuroMindPro'], ['FRONTEND'], ['aff_1'], ['APPROVED', 'REFUNDED'],
      20001,
    ]);
    // Nenhum valor do usuário no texto da SQL.
    for (const v of ['NeuroMindPro', 'aff_1', "'US'", 'clickbank']) expect(main.text).not.toContain(v);
    expect(buildSessionSql(s).text).toMatchSnapshot();
  });

  it('eixo do estorno filtra pela data do evento de cada status', () => {
    const sql = buildMainSql(spec({ date_axis: 'refund_event', group_by: ['day'], metrics: ['refunds'] })).text;
    expect(sql).toContain(`o."status" = 'REFUNDED' AND o."refundedAt" >=`);
    expect(sql).toContain(`o."status" = 'CHARGEBACK' AND o."chargebackAt" >=`);
    expect(sql).toContain(`CASE WHEN o."status" = 'REFUNDED' THEN o."refundedAt" ELSE o."chargebackAt" END`);
    expect(sql).not.toContain(`o."orderedAt" >=`);
  });
});

describe('mergeAggregates (puro)', () => {
  it('taxas de soma de grupos; totais antes do limit; sessões juntadas por chave', () => {
    const s = spec({ group_by: ['platform'], metrics: ['approved', 'approval_rate', 'fe_sessions', 'aov_session'], limit: 1 });
    const main = [
      { g0: 'a', rows: 10, real_orders: 10, approved: 9, refunds: 1, chargebacks: 0, gross_approved: 900, gross_original: 1000, net: 1, cpa: 0, cogs: 0, fulfillment: 0, refunded_usd: 100 },
      { g0: 'b', rows: 4, real_orders: 2, approved: 1, refunds: 2, chargebacks: 0, gross_approved: 100, gross_original: 100, net: 1, cpa: 0, cogs: 0, fulfillment: 0, refunded_usd: 50 },
    ];
    const sessions = [{ g0: 'a', fe_sessions: 3, session_revenue: 300 }, { g0: 'b', fe_sessions: 1, session_revenue: 150 }];
    const out = mergeAggregates(s, main, sessions, null);
    expect(out.groups).toBe(2);
    expect(out.rows).toEqual([{ platform: 'a', approved: 9, approval_rate: 0.9, fe_sessions: 3, aov_session: 100 }]);
    expect(out.totals).toEqual({ approved: 10, approval_rate: 0.833333, fe_sessions: 4, aov_session: 112.5 });
  });
});

describe('aggregate_orders no Postgres (PGlite com as migrações)', () => {
  let db: PGlite;
  // O PGlite não serializa array JS pra tipo de enum (o Prisma sim, em
  // produção): passa como literal de array do Postgres.
  const pgValue = (v: unknown) => (Array.isArray(v) ? `{${v.map((x) => JSON.stringify(String(x))).join(',')}}` : v);
  const q = async (sql: Prisma.Sql) => (await db.query<Record<string, unknown>>(sql.text, (sql.values as unknown[]).map(pgValue))).rows;

  beforeAll(async () => {
    db = await migratedPglite({ extensions: false });
    await db.exec(`
      INSERT INTO "Platform" (id, slug, "displayName") VALUES
        ('p_cb','clickbank','ClickBank'), ('p_d24','digistore24','Digistore24'), ('p_bg','buygoods','BuyGoods');
      INSERT INTO "Product" (id, "platformId", "externalId", name, "productType", family) VALUES
        ('pr1','p_cb','NM-FE','NeuroMindPro 6','FRONTEND','NeuroMindPro'),
        ('pr2','p_cb','NM-UP','NeuroMindPro UP','UPSELL','NeuroMindPro'),
        ('pr3','p_d24','GP-FE','GlycoPulse 3','FRONTEND','GlycoPulse'),
        ('pr4','p_bg','NP-FE','NeuroPulsePro 2','FRONTEND','NeuroPulsePro'),
        ('pr5','p_bg','NP-UP','NeuroPulsePro UP','UPSELL','NeuroPulsePro');
      INSERT INTO "Affiliate" (id, "platformId", "externalId", nickname, "firstSeenAt") VALUES
        ('a1','p_cb','nitro01','nitro','2026-01-01');
      INSERT INTO affiliate_mapping_state (affiliate_id, name, status, occurred_at, synced_at) VALUES
        ('ns_1','Nitro Company','active','2026-01-01','2026-01-01');
    `);
    const ins = (id: string, o: Record<string, unknown>) => {
      const cols = { id, currencyOriginal: 'USD', grossAmountOrig: o.grossAmountUsd, eventType: 'x', updatedAt: '2026-09-30', country: 'US', ...o };
      const keys = Object.keys(cols);
      return db.query(
        `INSERT INTO "Order" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`,
        Object.values(cols),
      );
    };
    // ClickBank: sessão c1 = FE + UP (mesmo parentExternalId); c3 = FE estornado in-place.
    await ins('o1', { platformId: 'p_cb', externalId: 'c1', productId: 'pr1', productType: 'FRONTEND', status: 'APPROVED', grossAmountUsd: 100, originalGrossUsd: 100, netAmountUsd: 60, cpaPaidUsd: 30, cogsUsd: 10, fulfillmentUsd: 5, orderedAt: brt('2026-09-01', '12:00'), affiliateId: 'a1', mappedAffiliateId: 'ns_1' });
    await ins('o2', { platformId: 'p_cb', externalId: 'c2', parentExternalId: 'c1', productId: 'pr2', productType: 'UPSELL', status: 'APPROVED', grossAmountUsd: 50, originalGrossUsd: 50, netAmountUsd: 35, orderedAt: brt('2026-09-01', '12:05'), affiliateId: 'a1', mappedAffiliateId: 'ns_1' });
    await ins('o3', { platformId: 'p_cb', externalId: 'c3', productId: 'pr1', productType: 'FRONTEND', status: 'REFUNDED', grossAmountUsd: -80, originalGrossUsd: 80, netAmountUsd: 0, orderedAt: brt('2026-09-02', '22:30'), refundedAt: brt('2026-09-05', '10:00') });
    // Digistore: venda segue APPROVED; o estorno é LINHA EXTRA com a data da venda.
    await ins('o4', { platformId: 'p_d24', externalId: 'd1', productId: 'pr3', productType: 'FRONTEND', status: 'APPROVED', grossAmountUsd: 200, originalGrossUsd: 200, netAmountUsd: 150, cpaPaidUsd: 60, orderedAt: brt('2026-09-02', '10:00') });
    await ins('o5', { platformId: 'p_d24', externalId: 'd1-refund', parentExternalId: 'd1', productId: 'pr3', productType: 'FRONTEND', status: 'REFUNDED', grossAmountUsd: -200, originalGrossUsd: -200, netAmountUsd: -150, orderedAt: brt('2026-09-02', '10:00'), refundedAt: brt('2026-09-06', '09:00') });
    // BuyGoods: order_id_global por transação — a sessão é o sessid2 (funnelSessionId).
    await ins('o6', { platformId: 'p_bg', externalId: 'b1', funnelSessionId: 's9', productId: 'pr4', productType: 'FRONTEND', status: 'APPROVED', grossAmountUsd: 70, originalGrossUsd: 70, netAmountUsd: 50, orderedAt: new Date('2026-09-03T02:00:00Z') });
    await ins('o7', { platformId: 'p_bg', externalId: 'b2', funnelSessionId: 's9', productId: 'pr5', productType: 'UPSELL', status: 'APPROVED', grossAmountUsd: 40, originalGrossUsd: 40, netAmountUsd: 30, orderedAt: new Date('2026-09-03T02:10:00Z') });
    await ins('o8', { platformId: 'p_bg', externalId: 'b3', funnelSessionId: 's10', productId: 'pr4', productType: 'FRONTEND', status: 'CHARGEBACK', grossAmountUsd: -70, originalGrossUsd: 70, netAmountUsd: 0, orderedAt: brt('2026-09-04', '12:00'), chargebackAt: brt('2026-09-06', '15:00') });
    // Fora do período (23:59 BRT do dia anterior ao início).
    await ins('o9', { platformId: 'p_cb', externalId: 'c9', productId: 'pr1', productType: 'FRONTEND', status: 'APPROVED', grossAmountUsd: 999, originalGrossUsd: 999, netAmountUsd: 1, orderedAt: brt('2026-08-31', '23:59') });
  }, 60_000);

  afterAll(async () => { await db?.close(); });

  const runAll = async (s: OrderAggSpec) => {
    const main = await q(buildMainSql(s));
    const needSessions = s.metrics.some((m) => m === 'fe_sessions' || m === 'aov_session');
    const needDen = s.axis === 'refund_event' && s.metrics.includes('refund_rate');
    return mergeAggregates(s, main, needSessions ? await q(buildSessionSql(s)) : null, needDen ? await q(buildMainSql(s, 'sale')) : null);
  };

  it('total do período (eixo venda): contagens, somas, pedidos reais, reversedAmount e AOV de sessão', async () => {
    const out = await runAll(spec({ metrics: ['rows', 'real_orders', 'approved', 'refunds', 'chargebacks', 'gross_approved', 'gross_original', 'net', 'cpa', 'cogs', 'fulfillment', 'refunded_usd', 'fe_sessions', 'aov_session', 'approval_rate', 'refund_rate'] }));
    expect(out.rows).toHaveLength(1);
    expect(out.totals).toEqual({
      rows: 8, real_orders: 7, approved: 5, refunds: 2, chargebacks: 1,
      gross_approved: 460, gross_original: 410, net: 325, cpa: 90, cogs: 10, fulfillment: 5,
      refunded_usd: 350,
      fe_sessions: 3, aov_session: 153.33,
      approval_rate: 0.714286, refund_rate: 0.285714,
    });
  });

  it('paridade com a materialized view daily_metrics (a fonte dos KPIs do get_overview) num período BRT', async () => {
    await db.exec('REFRESH MATERIALIZED VIEW daily_metrics');
    const [mv] = (await db.query<Record<string, number>>(`
      SELECT SUM(gross)::float8 AS gross, SUM(approved_count)::int AS approved, SUM(gross_original)::float8 AS gross_original,
             SUM(net)::float8 AS net, SUM(cpa)::float8 AS cpa, SUM(total_count)::int AS rows,
             SUM(refunded_count)::int AS refunds, SUM(chargeback_count)::int AS chargebacks
      FROM daily_metrics WHERE day BETWEEN '2026-09-01' AND '2026-09-04'`)).rows;
    const out = await runAll(spec({ metrics: ['gross_approved', 'approved', 'gross_original', 'net', 'cpa', 'rows', 'refunds', 'chargebacks'] }));
    expect(out.totals).toEqual({
      gross_approved: mv.gross, approved: mv.approved, gross_original: mv.gross_original,
      net: mv.net, cpa: mv.cpa, rows: mv.rows, refunds: mv.refunds, chargebacks: mv.chargebacks,
    });
  });

  it('balde por dia em BRT (23:10 BRT do dia 02 é dia 02, não 03) e sessões pela linha do FE', async () => {
    const out = await runAll(spec({ group_by: ['day'], metrics: ['rows', 'gross_approved', 'fe_sessions'] }));
    expect(out.rows).toEqual([
      { day: '2026-09-01', rows: 2, gross_approved: 150, fe_sessions: 1 },
      { day: '2026-09-02', rows: 5, gross_approved: 310, fe_sessions: 2 },
      { day: '2026-09-04', rows: 1, gross_approved: 0, fe_sessions: 0 },
    ]);
  });

  it('eixo do estorno: conta pela data do evento; refund_rate usa pedidos reais vendidos no período', async () => {
    const out = await runAll(spec({ date_axis: 'refund_event', group_by: ['platform'], metrics: ['refunds', 'chargebacks', 'refunded_usd', 'refund_rate'], order_by: 'refunded_usd' }, '2026-09-01', '2026-09-06'));
    const byP = Object.fromEntries(out.rows.map((r) => [r.platform, r]));
    expect(byP.clickbank).toMatchObject({ refunds: 1, chargebacks: 0, refunded_usd: 80, sales_real_orders: 3, refund_rate: 0.333333 });
    expect(byP.digistore24).toMatchObject({ refunds: 1, refunded_usd: 200, sales_real_orders: 1, refund_rate: 1 });
    expect(byP.buygoods).toMatchObject({ refunds: 0, chargebacks: 1, refunded_usd: 70, sales_real_orders: 3, refund_rate: 0 });
    expect(out.totals).toMatchObject({ refunds: 2, chargebacks: 1, refunded_usd: 350, refund_rate: 0.285714 });
    // Estornos de 05–06/09 não existem no período de vendas 01–04.
    const narrow = await runAll(spec({ date_axis: 'refund_event', metrics: ['refunds'] }));
    expect(narrow.totals.refunds).toBe(0);
  });

  it('filtros de dimensão, dow/hour e rótulos de produto/afiliado', async () => {
    const fam = await runAll(spec({ families: ['NeuroMindPro'], stages: ['UPSELL'], metrics: ['rows', 'gross_approved'] }));
    expect(fam.totals).toMatchObject({ rows: 1, gross_approved: 50 });
    const prod = await runAll(spec({ platforms: ['clickbank'], group_by: ['product', 'affiliate'], metrics: ['rows'], order_by: 'product', dir: 'asc' }));
    expect(prod.rows).toEqual([
      { product: 'NM-FE', affiliate: 'clickbank:nitro01', product_name: 'NeuroMindPro 6', affiliate_nickname: 'nitro', rows: 1 },
      { product: 'NM-FE', affiliate: null, product_name: 'NeuroMindPro 6', rows: 1 },
      { product: 'NM-UP', affiliate: 'clickbank:nitro01', product_name: 'NeuroMindPro UP', affiliate_nickname: 'nitro', rows: 1 },
    ]);
    const mapped = await runAll(spec({ affiliate_ids: ['ns_1'], group_by: ['mapped_affiliate'], metrics: ['gross_approved', 'fe_sessions'] }));
    expect(mapped.rows).toEqual([{ mapped_affiliate: 'ns_1', mapped_affiliate_name: 'Nitro Company', gross_approved: 150, fe_sessions: 1 }]);
    const dow = await runAll(spec({ group_by: ['dow', 'hour'], metrics: ['rows'], platforms: ['clickbank'] }));
    // 01/09/2026 é terça (ISODOW 2).
    expect(dow.rows[0]).toMatchObject({ dow: 2, dow_label: 'terça', hour: 12, rows: 2 });
  });
});
