import type { PGlite } from '@electric-sql/pglite';
import type { Prisma } from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { migratedPglite } from '../test/pgliteDb';
import type { MetricsFilters, OverviewKPIs, ProductsResponse, OrdersResponse } from '../services/metrics';
import type { ProfitSplitResponse } from '../services/profitSplit';
import { parseBrtEnd, parseBrtStart } from './meta';
import {
  alignedPreviousWindow,
  buildScreenCards,
  isEmptyResult,
  kpiDeltas,
  kpisFromTotals,
  labelHeatmap,
  orderRows,
  overviewKpisSql,
  productRows,
  servicePreviousWindow,
  stripNetProfit,
  windowSpanOf,
  type KpiSessionsRow,
  type KpiTotalsRow,
} from './views';

const KPIS: OverviewKPIs = {
  gross: 154_318.2, grossOriginal: 171_002.5, net: 98_000.1, cpa: 40_000, netProfit: 58_000.1,
  approvalRate: 0.8812, refundRate: 0.0613, cbRate: 0.0123, aov: 142.37, approvedCount: 1083, totalCount: 1229,
  orderGroups: 1000, epo: 98, cogs: 9000, fulfillment: 7000, estimatedProfit: 82_000.1, estimatedMarginPct: 53.14,
};

const SPLIT = {
  range: { start: '', end: '' },
  opexPct: 10,
  front: { grossUsd: 150_000, cpaUsd: 40_000, orders: 1000, profitUsd: 61_234.56, refundCbUsd: 15_000 },
  back: { sources: [], profitUsd: 4_321 },
  totalUsd: 65_555.56,
  refunds: { salesCount: 1100, refundedCount: 90, chargebackCount: 12, pct: 8.18, grossUsd: 154_318.2, refundedUsd: 14_000, valuePct: 9.07 },
  refunds7d: { salesCount: 300, refundedCount: 31, chargebackCount: 2, pct: 10.33, grossUsd: 40_000, refundedUsd: 3_000, valuePct: 7.5 },
} satisfies ProfitSplitResponse;

describe('overview — visão de IA', () => {
  it('netProfit (net − CPA: CPA contado 2×) sai do payload', () => {
    const k = stripNetProfit(KPIS);
    expect('netProfit' in k).toBe(false);
    expect(k.gross).toBe(KPIS.gross);
  });

  it('screenCards: 1:1 com os cards da Visão Geral, fontes e limiares da tela', () => {
    const cards = buildScreenCards(stripNetProfit(KPIS), SPLIT);
    const by = Object.fromEntries(cards.map((c) => [c.card, c]));
    expect(cards.map((c) => c.card)).toEqual([
      'Receita bruta', 'Receita líquida', 'Pedidos aprovados', 'AOV', 'Taxa de aprovação', 'Taxa de reembolso',
      'Reembolso por pedidos', 'Reembolso por pedidos — últimos 7d (limite 10%)', 'Chargeback', 'Net after CPA (modelo)',
      'Net after CPA (modelo) — total front + back',
    ]);
    expect(by['Receita bruta']).toMatchObject({ value: 154_318.2, unit: 'usd', detail: { modoEvento: 171_002.5 } });
    expect(by['Taxa de aprovação']).toMatchObject({ value: 88.12, unit: 'pp', state: 'warn' });
    // Reembolso da tela = profit split (data do ESTORNO), NÃO kpis.refundRate.
    expect(by['Taxa de reembolso']).toMatchObject({ value: 9.07, unit: 'pp', source: 'get_profit_split.refunds.valuePct' });
    expect(by['Reembolso por pedidos']).toMatchObject({ value: 8.18, detail: { refundedCount: 90, salesCount: 1100 } });
    expect(by['Reembolso por pedidos — últimos 7d (limite 10%)']).toMatchObject({ value: 10.33, state: 'danger' });
    expect(by['Chargeback']).toMatchObject({ value: 1.23, state: 'warn' });
    expect(by['Net after CPA (modelo)']).toMatchObject({ value: 61_234.56, source: 'get_profit_split.front.profitUsd' });
    expect(by['Net after CPA (modelo)'].state).toBeUndefined();
    expect(by['Net after CPA (modelo) — total front + back']).toMatchObject({ value: 65_555.56, detail: { frontUsd: 61_234.56, backUsd: 4_321 } });
  });

  it('deltas prontos: abs, relativo (fração) e pp nas taxas', () => {
    const cur = stripNetProfit(KPIS);
    const prev = { ...cur, gross: 140_000, refundRate: 0.05, estimatedMarginPct: 50, approvedCount: 0 };
    const d = kpiDeltas(cur, prev);
    expect(d.gross).toEqual({ cur: 154_318.2, prev: 140_000, abs: 14_318.2, pct: 0.1023 });
    expect(d.refundRate).toEqual({ cur: 0.0613, prev: 0.05, abs: 0.0113, pct: 0.226, pp: 1.13 });
    expect(d.estimatedMarginPct.pp).toBe(3.14);
    expect(d.approvedCount.pct).toBeNull();
  });

  it('heatmap ganha o dia da semana por extenso (dow 0 = domingo, BRT)', () => {
    expect(labelHeatmap([{ dow: 0, hour: 22, orders: 3, gross: 100 }, { dow: 3, hour: 9, orders: 1, gross: 50 }]).map((c) => c.dowLabel)).toEqual(['dom', 'qua']);
  });
});

describe('janela anterior', () => {
  const now = new Date('2026-09-30T17:05:00.000Z'); // 14:05 BRT

  it('hoje parcial: anterior = ontem até o MESMO horário', () => {
    const w = alignedPreviousWindow(parseBrtStart('2026-09-30'), parseBrtEnd('2026-09-30'), now)!;
    expect(w.start.toISOString()).toBe(parseBrtStart('2026-09-29').toISOString());
    expect(w.end.toISOString()).toBe('2026-09-29T17:05:00.000Z');
  });

  it('últimos 7 dias com hoje: anterior = 7 dias antes, cortado no mesmo tempo decorrido', () => {
    const w = alignedPreviousWindow(parseBrtStart('2026-09-24'), parseBrtEnd('2026-09-30'), now)!;
    expect(w.start.toISOString()).toBe(parseBrtStart('2026-09-17').toISOString());
    expect(w.end.toISOString()).toBe('2026-09-23T17:05:00.000Z');
  });

  it('janela fechada → null (o anterior de mesma duração do serviço vale)', () => {
    expect(alignedPreviousWindow(parseBrtStart('2026-09-22'), parseBrtEnd('2026-09-28'), now)).toBeNull();
    const s = servicePreviousWindow(parseBrtStart('2026-09-22'), parseBrtEnd('2026-09-28'));
    expect(s.end.toISOString()).toBe(new Date(parseBrtStart('2026-09-22').getTime() - 1).toISOString());
    expect(s.start.toISOString()).toBe(parseBrtStart('2026-09-15').toISOString());
  });
});

describe('produtos e pedidos', () => {
  const base = {
    externalId: 'X', name: 'X', productType: 'FRONTEND', family: 'NeuroMindPro', variant: null, bottles: 6, catalogPriceUsd: 294,
    salesPageUrl: 'https://s', checkoutUrl: 'https://c', thanksPageUrl: 'https://t', driveUrl: 'https://d', catalogStatus: null,
    vendorAccount: null, revenue: 1000, orders: 90, net: 1, cpa: 1, cogs: 1, fulfillment: 1, estimatedProfit: 1, estimatedMarginPct: 1,
    attributedSessions: 0, attributedOrders: 0, attributedRevenue: 0, attributedNet: 0, attributedCpa: 0, attributedCogs: 0,
    attributedFulfillment: 0, attributedProfit: 0, attributedMarginPct: 0, approvalRate: 0.9, firstSoldAt: null, lastSoldAt: null,
  };

  it('taxa por SKU sobre realOrders (Digistore desconta as linhas sintéticas de estorno); URLs só com include_urls', () => {
    const products: ProductsResponse['products'] = [
      { ...base, platformSlug: 'digistore24', allOrders: 110, refunds: 8, chargebacks: 2 },
      { ...base, platformSlug: 'clickbank', allOrders: 100, refunds: 8, chargebacks: 2 },
    ];
    const [d24, cb] = productRows(products, false);
    expect(d24).toMatchObject({ realOrders: 100, refundRate: 0.08, cbRate: 0.02 });
    expect(cb).toMatchObject({ realOrders: 100, refundRate: 0.08, cbRate: 0.02 });
    expect('salesPageUrl' in d24).toBe(false);
    expect(productRows(products, true)[0].checkoutUrl).toBe('https://c');
  });

  it('pedido ganha horário BRT (borda: 02:30Z = 23:30 do dia anterior)', () => {
    const orders = [{ orderedAt: '2026-09-30T02:30:00.000Z', eventAt: '2026-09-30T15:00:00.000Z' }] as OrdersResponse['orders'];
    expect(orderRows(orders)[0]).toMatchObject({ orderedAtBrt: '2026-09-29 23:30', eventAtBrt: '2026-09-30 12:00' });
  });
});

describe('vazio e janelas', () => {
  it('vazio por tool', () => {
    expect(isEmptyResult('get_orders', { total: 0, orders: [] })).toBe(true);
    expect(isEmptyResult('get_orders', { total: 3 })).toBe(false);
    expect(isEmptyResult('get_overview', { kpis: { totalCount: 0 } })).toBe(true);
    expect(isEmptyResult('get_platforms', { platforms: [{ allOrders: 0 }, { allOrders: 0 }] })).toBe(true);
    expect(isEmptyResult('get_health', {})).toBe(false);
  });

  it('span das tools de janela vem do próprio resultado', () => {
    expect(windowSpanOf('get_affiliate_analysis', { range: { start: '2026-09-23', end: '2026-09-29' } })).toEqual({ start: '2026-09-23', end: '2026-09-29' });
    expect(windowSpanOf('get_affiliate_sequence', { windows: [{ start: '2026-09-09', end: '2026-09-15' }, { start: '2026-09-23', end: '2026-09-29' }] }))
      .toEqual({ start: '2026-09-09', end: '2026-09-29' });
    expect(windowSpanOf('get_overview', {})).toBeUndefined();
  });
});

// ── Paridade da agregação por instante com a MV daily_metrics ────────────

const run = <T,>(db: PGlite, sql: Prisma.Sql) => db.query<T>(sql.text, sql.values as unknown[]);

interface Seed {
  id: string; platform: string; product: string; status: string; type: string; at: string; gross: number;
  original?: number | null; net: number; cpa?: number; country?: string | null; parent?: string; session?: string;
  cogs?: number; ful?: number;
}

// Horários escolhidos nas BORDAS do dia BRT (23:30 BRT = 02:30Z do dia seguinte).
const ORDERS: Seed[] = [
  // ClickBank: sessão s1 (FE + UP) em 28/09; FE estornado 29/09.
  { id: 'o1', platform: 'p_cb', product: 'cb_fe', status: 'APPROVED', type: 'FRONTEND', at: '2026-09-28T13:00:00Z', gross: 49, net: 20, cpa: 25, country: 'US', parent: 's1', cogs: 5, ful: 4 },
  { id: 'o2', platform: 'p_cb', product: 'cb_up', status: 'APPROVED', type: 'UPSELL', at: '2026-09-28T13:05:00Z', gross: 147, net: 110, country: 'US', parent: 's1', cogs: 10, ful: 0 },
  { id: 'o3', platform: 'p_cb', product: 'cb_fe', status: 'REFUNDED', type: 'FRONTEND', at: '2026-09-29T02:30:00Z', gross: 49, original: 49, net: 0, country: 'CA', parent: 's2', cogs: 5, ful: 4 },
  // Digistore: venda aprovada + linha SINTÉTICA de estorno (gross negativo) no mesmo dia.
  { id: 'o4', platform: 'p_d24', product: 'd24_fe', status: 'APPROVED', type: 'FRONTEND', at: '2026-09-29T15:00:00Z', gross: 69, original: 69, net: 30, cpa: 30, country: null, parent: 's3' },
  { id: 'o5', platform: 'p_d24', product: 'd24_fe', status: 'REFUNDED', type: 'FRONTEND', at: '2026-09-29T15:00:00Z', gross: -69, original: -69, net: 0, country: null, parent: 's3' },
  // BuyGoods: sessão por funnelSessionId (order_id por transação).
  { id: 'o6', platform: 'p_bg', product: 'bg_fe', status: 'APPROVED', type: 'FRONTEND', at: '2026-09-29T16:00:00Z', gross: 59, net: 25, country: 'US', parent: 'bgA', session: 'sess9' },
  { id: 'o7', platform: 'p_bg', product: 'bg_up', status: 'APPROVED', type: 'UPSELL', at: '2026-09-29T16:02:00Z', gross: 99, net: 60, country: 'US', parent: 'bgB', session: 'sess9' },
  { id: 'o8', platform: 'p_bg', product: 'bg_fe', status: 'CHARGEBACK', type: 'FRONTEND', at: '2026-09-29T20:00:00Z', gross: 59, net: 0, country: 'GB', parent: 'bgC', session: 'sess10' },
  // UP órfão (FE fora da janela) — fica fora do AOV.
  { id: 'o9', platform: 'p_cb', product: 'cb_up', status: 'APPROVED', type: 'UPSELL', at: '2026-09-30T02:00:00Z', gross: 147, net: 110, country: 'US', parent: 's0' },
  // Fora do range (30/09 BRT).
  { id: 'o10', platform: 'p_cb', product: 'cb_fe', status: 'APPROVED', type: 'FRONTEND', at: '2026-09-30T03:30:00Z', gross: 49, net: 20, country: 'US', parent: 's5' },
];

async function seed(db: PGlite): Promise<void> {
  await db.exec(`
    INSERT INTO "Platform" (id, slug, "displayName") VALUES ('p_cb','clickbank','ClickBank'), ('p_d24','digistore24','Digistore24'), ('p_bg','buygoods','BuyGoods');
    INSERT INTO "Product" (id, "platformId", "externalId", name, "productType", family) VALUES
      ('cb_fe','p_cb','NMP-FE','NeuroMind FE','FRONTEND','NeuroMindPro'),
      ('cb_up','p_cb','NMP-UP1','NeuroMind UP1','UPSELL','NeuroMindPro'),
      ('d24_fe','p_d24','GP-FE','GlycoPulse FE','FRONTEND','GlycoPulse'),
      ('bg_fe','p_bg','X-FE','Sem família FE','FRONTEND',NULL),
      ('bg_up','p_bg','X-UP','Sem família UP','UPSELL',NULL);
  `);
  for (const o of ORDERS) {
    await db.query(
      `INSERT INTO "Order" (id, "platformId", "externalId", "parentExternalId", "productId", "currencyOriginal", "grossAmountOrig",
         "grossAmountUsd", "originalGrossUsd", "netAmountUsd", "cpaPaidUsd", "productType", status, "eventType", "orderedAt", "updatedAt",
         country, "funnelSessionId", "cogsUsd", "fulfillmentUsd")
       VALUES ($1,$2,$1,$3,$4,'USD',$5,$5,$6,$7,$8,$9::"ProductType",$10::"OrderStatus",'SALE',$11::timestamp,now(),$12,$13,$14,$15)`,
      [o.id, o.platform, o.parent ?? null, o.product, o.gross, o.original ?? null, o.net, o.cpa ?? 0, o.type, o.status,
        o.at.replace('Z', ''), o.country ?? null, o.session ?? null, o.cogs ?? null, o.ful ?? null],
    );
  }
  await db.exec('REFRESH MATERIALIZED VIEW daily_metrics');
}

/** O que o caminho da MV (queryDailyMetrics + kpisFromRows) somaria nesse range/filtro. */
async function mvTotals(db: PGlite, f: MetricsFilters): Promise<KpiTotalsRow> {
  const where: string[] = [
    `day >= ($1::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date`,
    `day <= ($2::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date`,
  ];
  const values: unknown[] = [f.startDate.toISOString(), f.endDate.toISOString()];
  if (f.platformSlugs) { values.push(f.platformSlugs); where.push(`platform = ANY($${values.length})`); }
  if (f.countries) { values.push(f.countries); where.push(`country = ANY($${values.length})`); }
  if (f.productFamilies) { values.push(f.productFamilies); where.push(`family = ANY($${values.length})`); }
  const { rows } = await db.query<KpiTotalsRow>(`
    SELECT COALESCE(SUM(total_count),0)::int AS total_count, COALESCE(SUM(approved_count),0)::int AS approved_count,
           COALESCE(SUM(refunded_count),0)::int AS refunded_count, COALESCE(SUM(chargeback_count),0)::int AS chargeback_count,
           COALESCE(SUM(gross),0)::float8 AS gross, COALESCE(SUM(gross_original),0)::float8 AS gross_original,
           COALESCE(SUM(net),0)::float8 AS net, COALESCE(SUM(cpa),0)::float8 AS cpa,
           COALESCE(SUM(cogs),0)::float8 AS cogs, COALESCE(SUM(fulfillment),0)::float8 AS fulfillment
    FROM daily_metrics WHERE ${where.join(' AND ')}`, values);
  return rows[0];
}

describe('overviewKpisSql — paridade com a MV daily_metrics (PGlite)', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await migratedPglite({ extensions: false });
    await seed(db);
  }, 60_000);

  const days = (from: string, to: string, extra: Partial<MetricsFilters> = {}): MetricsFilters => ({
    startDate: parseBrtStart(from), endDate: parseBrtEnd(to), ...extra,
  });

  const cases: Array<[string, MetricsFilters]> = [
    ['sem filtro', days('2026-09-28', '2026-09-29')],
    ['só 29/09 (borda 23:30 BRT do dia 28 fora)', days('2026-09-29', '2026-09-29')],
    ['plataforma', days('2026-09-28', '2026-09-29', { platformSlugs: ['buygoods', 'digistore24'] })],
    ['família com _unknown (sem família)', days('2026-09-28', '2026-09-29', { productFamilies: ['_unknown', 'GlycoPulse'] })],
    ['país com _unknown (sem país)', days('2026-09-28', '2026-09-29', { countries: ['_unknown', 'CA'] })],
  ];

  for (const [label, f] of cases) {
    it(`dias BRT inteiros → mesmos totais da MV: ${label}`, async () => {
      const [mine] = (await run<KpiTotalsRow>(db, overviewKpisSql(f).totals)).rows;
      const mv = await mvTotals(db, f);
      expect({ ...mine, total_count: Number(mine.total_count), approved_count: Number(mine.approved_count), refunded_count: Number(mine.refunded_count), chargeback_count: Number(mine.chargeback_count) })
        .toEqual({ ...mv, total_count: Number(mv.total_count), approved_count: Number(mv.approved_count), refunded_count: Number(mv.refunded_count), chargeback_count: Number(mv.chargeback_count) });
    });
  }

  it('corte por INSTANTE (o que a MV diária não faz): 29/09 até 12:30 BRT', async () => {
    const f: MetricsFilters = { startDate: parseBrtStart('2026-09-29'), endDate: new Date('2026-09-29T15:30:00Z') };
    const [t] = (await run<KpiTotalsRow>(db, overviewKpisSql(f).totals)).rows;
    // Só o3 (23:30 BRT do dia 28) fica fora por ser do dia 28; entram o4/o5 (12:00 BRT); o6/o7/o8 (13h+) ficam fora.
    expect(Number(t.total_count)).toBe(2);
    expect(t.gross).toBe(69);
  });

  it('AOV canônico: sessão por parentExternalId (CB) e funnelSessionId (BuyGoods); órfãs fora', async () => {
    const f = days('2026-09-28', '2026-09-29');
    const [s] = (await run<KpiSessionsRow>(db, overviewKpisSql(f).sessions)).rows;
    // Sessões com FE aprovado: cb s1 (49+147), d24 s3 (69), bg sess9 (59+99).
    expect(Number(s.sessions)).toBe(3);
    expect(s.revenue).toBe(49 + 147 + 69 + 59 + 99);
    const [t] = (await run<KpiTotalsRow>(db, overviewKpisSql(f).totals)).rows;
    const k = kpisFromTotals(t, s);
    expect(k.aov).toBe(Math.round(((49 + 147 + 69 + 59 + 99) / 3) * 100) / 100);
    expect(k.refundRate).toBe(Math.round((2 / 9) * 10000) / 10000); // o3 + linha sintética o5 ÷ 9 linhas
    expect(k.cbRate).toBe(Math.round((1 / 9) * 10000) / 10000);
    expect(k.grossOriginal).toBe(49 + 147 + 49 + 69 - 69 + 59 + 99 + 59 + 147);
  });

  it('família filtra a SESSÃO pelo FE (upsell junto)', async () => {
    const [s] = (await run<KpiSessionsRow>(db, overviewKpisSql(days('2026-09-28', '2026-09-29', { productFamilies: ['NeuroMindPro'] })).sessions)).rows;
    expect(Number(s.sessions)).toBe(1);
    expect(s.revenue).toBe(49 + 147);
  });
});
