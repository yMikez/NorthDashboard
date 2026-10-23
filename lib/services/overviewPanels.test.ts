import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import type { PGlite } from '@electric-sql/pglite';
import { migratedPglite } from '../test/pgliteDb';
import {
  affiliateRefundsSql, approvedByChannelSql, assembleOverviewPanels, brtDays, callCenterByDaySql, feSessionsByDaySql,
  previousWindow, refundWindow, refundsByDaySql, salesboundByDaySql, type ChannelRow,
} from './overviewPanels';

const pgValue = (v: unknown) => (Array.isArray(v) ? `{${v.map((x) => JSON.stringify(String(x))).join(',')}}` : v);
// Dia BRT D às 15:00 UTC (12:00 BRT).
const at = (d: string, h = 15) => new Date(`2026-10-${d}T${String(h).padStart(2, '0')}:00:00Z`);
const OCT = { startDate: new Date('2026-10-01T03:00:00Z'), endDate: new Date('2026-11-01T02:59:59Z') };

describe('overviewPanels — SQL (PGlite)', () => {
  let pg: PGlite;
  const q = async (sql: Prisma.Sql) => (await pg.query<Record<string, unknown>>(sql.text, (sql.values as unknown[]).map(pgValue))).rows;
  const ins = (table: string, cols: Record<string, unknown>) => {
    const keys = Object.keys(cols);
    return pg.query(`INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(cols));
  };
  const order = (id: string, o: Record<string, unknown>) => ins('Order', {
    id, externalId: id, platformId: 'p_jv', productId: 'pr_fe', currencyOriginal: 'USD', grossAmountOrig: 0, grossAmountUsd: 100,
    netAmountUsd: 0, cpaPaidUsd: 0, eventType: 'x', updatedAt: new Date(), productType: 'FRONTEND', status: 'APPROVED', orderedAt: at('05'), ...o,
  });

  beforeAll(async () => {
    pg = await migratedPglite({ extensions: false });
    await pg.exec(`
      INSERT INTO "Platform" (id, slug, "displayName") VALUES ('p_jv','jvzoo','JVZoo'), ('p_bg','buygoods','BuyGoods');
      INSERT INTO "Product" (id, "platformId", "externalId", name, "productType", family) VALUES
        ('pr_fe','p_jv','fe','NeuroRecall 6','FRONTEND','NeuroRecall'), ('pr_up','p_jv','up','NeuroRecall Upgrade','UPSELL','NeuroRecall'),
        ('pr_bg','p_bg','bg','GlycoPulse 3','FRONTEND','GlycoPulse');
      INSERT INTO "Affiliate" (id, "platformId", "externalId", "firstSeenAt") VALUES
        ('a_ind','p_jv','111','2026-01-01'), ('a_rec','p_bg','364622@1','2026-01-01');
    `);
    // Sessão JVZoo: FE 100 + upsell 50 (mesmo pai), CPA 40 no FE.
    await order('F1', { affiliateId: 'a_ind', cpaPaidUsd: 40 });
    await order('U1', { parentExternalId: 'F1', productId: 'pr_up', productType: 'UPSELL', grossAmountUsd: 50 });
    // Recuperação: afiliado de recuperação (vence o SMS) e SMS puro.
    await order('R1', { platformId: 'p_bg', productId: 'pr_bg', affiliateId: 'a_rec', grossAmountUsd: 80, trafficSource: 'smsbrdcst' });
    await order('S1', { productId: 'pr_fe', grossAmountUsd: 30, trafficSource: 'SMSBRDCST', orderedAt: at('06') });
    // Estorno de venda antiga, acontecido no dia 07; pendente não conta.
    await order('X1', { status: 'REFUNDED', grossAmountUsd: -70, orderedAt: new Date('2026-09-20T15:00:00Z'), refundedAt: at('07') });
    await order('P1', { status: 'PENDING', grossAmountUsd: 999 });
    await ins('CallCenterSale', { id: 'cc1', externalKey: 'k1', provider: 'tauk', status: 'APPROVED', email: 'a@x.com', amountUsd: 200, refundedUsd: 20, purchasedAt: at('05'), updatedAt: new Date() });
    await ins('CallCenterSale', { id: 'cc2', externalKey: 'k2', provider: 'logicall', status: 'REFUNDED', email: 'b@x.com', amountUsd: 90, purchasedAt: at('05'), updatedAt: new Date() });
    await ins('SalesboundTransaction', { id: 'sb1', transactionId: 't1', orderId: 'so1', type: 'SALE', result: 'SUCCESS', amountUsd: 500, txnAt: at('06'), email: 'c@x.com', items: '[]', updatedAt: new Date() });
    await ins('SalesboundTransaction', { id: 'sb2', transactionId: 't2', orderId: 'so1', type: 'VOID', result: 'SUCCESS', amountUsd: 100, txnAt: at('07'), saleAt: at('06'), email: 'c@x.com', items: '[]', updatedAt: new Date() });
  }, 60_000);
  afterAll(async () => { await pg.close(); });

  it('canais: recuperação vence SMS; SMS sem afiliado; resto é front (por etapa)', async () => {
    const rows = (await q(approvedByChannelSql(OCT, ['a_rec']))) as unknown as ChannelRow[];
    const pick = (ch: string, ptype?: string) => rows.filter((r) => r.channel === ch && (!ptype || r.ptype === ptype)).reduce((s, r) => s + r.gross, 0);
    expect(pick('front', 'FRONTEND')).toBe(100);
    expect(pick('front', 'UPSELL')).toBe(50);
    expect(pick('rec:a_rec')).toBe(80);
    expect(pick('sms')).toBe(30);
    expect(rows.find((r) => r.ptype === 'FRONTEND' && r.channel === 'front')?.cpa).toBe(40);
  });

  it('filtro de plataforma recorta os canais', async () => {
    const rows = (await q(approvedByChannelSql({ ...OCT, platformSlugs: ['buygoods'] }, ['a_rec']))) as unknown as ChannelRow[];
    expect(rows.map((r) => r.channel)).toEqual(['rec:a_rec']);
  });

  it('reembolso pela data do estorno', async () => {
    expect(await q(refundsByDaySql(OCT))).toEqual([{ day: '2026-10-07', n: 1, usd: 70 }]);
  });

  it('sessões de funil por dia: receita da sessão inteira (mesma base do card de AOV)', async () => {
    const rows = await q(feSessionsByDaySql(OCT));
    // Dia 05: sessão JVZoo (FE 100 + upsell 50) e a da recuperação (80); dia 06: SMS (30).
    expect(rows.sort((a, b) => String(a.day).localeCompare(String(b.day)))).toEqual([
      { day: '2026-10-05', sessions: 2, revenue: 230 },
      { day: '2026-10-06', sessions: 1, revenue: 30 },
    ]);
  });

  it('reembolso por afiliado (coorte): base com a linha estornada in-place que tem approvedAt', async () => {
    await order('A1', { affiliateId: 'a_ind', orderedAt: at('10') });
    await order('A2', { affiliateId: 'a_ind', status: 'REFUNDED', grossAmountUsd: 100, orderedAt: at('10'), approvedAt: at('10'), refundedAt: at('12') });
    const rows = await q(affiliateRefundsSql(['jvzoo:111', 'jvzoo:nao-existe'], new Date('2026-10-08T03:00:00Z'), new Date('2026-10-31T00:00:00Z')));
    expect(rows).toEqual([{ key: 'jvzoo:111', baseCount: 2, baseUsd: 200, refundCount: 1, refundUsd: 100 }]);
  });

  it('call center: aprovada menos estorno parcial; SalesBound: venda menos anulação', async () => {
    expect(await q(callCenterByDaySql(OCT))).toEqual([{ day: '2026-10-05', provider: 'tauk', usd: 180 }]);
    expect(await q(salesboundByDaySql(OCT))).toEqual([{ day: '2026-10-06', usd: 400 }]);
  });
});

describe('assembleOverviewPanels', () => {
  const base = {
    start: new Date('2026-10-05T03:00:00Z'),
    end: new Date('2026-10-08T02:59:59Z'),
    models: new Map([['jvzoo', { feePct: 10, refundCbPct: 5 }]]),
    opexPct: 10,
    recoveryLabels: new Map([['a_rec', 'MailX']]),
  };
  const channels: ChannelRow[] = [
    { day: '2026-10-05', platform: 'jvzoo', ptype: 'FRONTEND', channel: 'front', gross: 100, cpa: 40, orders: 1 },
    { day: '2026-10-05', platform: 'jvzoo', ptype: 'UPSELL', channel: 'front', gross: 50, cpa: 0, orders: 1 },
    { day: '2026-10-05', platform: 'buygoods', ptype: 'FRONTEND', channel: 'rec:a_rec', gross: 80, cpa: 0, orders: 1 },
    { day: '2026-10-06', platform: 'jvzoo', ptype: 'FRONTEND', channel: 'sms', gross: 30, cpa: 0, orders: 1 },
  ];

  it('estágios, Net after CPA do modelo e séries por dia (dias vazios incluídos)', () => {
    const p = assembleOverviewPanels({
      ...base, channels,
      refunds: [{ day: '2026-10-07', n: 1, usd: 70 }],
      sessions: [{ day: '2026-10-05', sessions: 1, revenue: 150 }],
      callCenter: [{ day: '2026-10-05', provider: 'tauk', usd: 180 }],
      salesbound: [{ day: '2026-10-06', usd: 400 }],
    });
    // 150 × (1 − 25%) − 40 = 72.5
    expect(p.netAfterCpa).toMatchObject({ usd: 72.5, frontGrossUsd: 150, frontCpaUsd: 40 });
    expect(p.stages.front).toEqual({ usd: 150, parts: [{ key: 'FRONTEND', label: 'Front', usd: 100 }, { key: 'UPSELL', label: 'Upsells', usd: 50 }] });
    expect(p.stages.recovery.parts).toEqual([{ key: 'MailX', label: 'MailX', usd: 80 }, { key: 'SMS', label: 'SMS', usd: 30 }]);
    expect(p.stages.backend).toMatchObject({ usd: 580, available: true });
    expect(p.stages.totalUsd).toBe(840);
    expect(p.daily.map((d) => d.date)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
    expect(p.daily[0]).toMatchObject({ gross: 230, orders: 3, front: 150, backend: 180, recovery: 80, netAfterCpa: 72.5, feSessions: 1, feRevenue: 150 });
    expect(p.daily[2]).toMatchObject({ refundUsd: 70, refundCount: 1, front: 0 });
  });

  it('com filtro de ordem o backend some (não atribuível)', () => {
    const p = assembleOverviewPanels({ ...base, channels, refunds: [], sessions: [], callCenter: null, salesbound: null });
    expect(p.stages.backend).toEqual({ usd: 0, parts: [], available: false });
  });
});

describe('janelas', () => {
  it('dias BRT do período e janela de 60 dias de venda', () => {
    expect(brtDays(new Date('2026-10-05T03:00:00Z'), new Date('2026-10-07T02:59:59Z'))).toEqual(['2026-10-05', '2026-10-06']);
    const w = refundWindow(new Date('2026-10-23T12:00:00Z'));
    expect(w.start.toISOString()).toBe('2026-08-25T03:00:00.000Z');
    const p = previousWindow(new Date('2026-10-16T03:00:00Z'), new Date('2026-10-23T02:59:59.999Z'));
    expect([p.start.toISOString(), p.end.toISOString()]).toEqual(['2026-10-09T03:00:00.000Z', '2026-10-16T02:59:59.999Z']);
  });
});
