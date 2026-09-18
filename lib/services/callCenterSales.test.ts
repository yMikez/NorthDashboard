import { describe, expect, it } from 'vitest';
import { aggregateCallCenter, summarizeProviders, type CallCenterRow } from './callCenterSales';

const at = (iso: string) => new Date(iso);
const row = (over: Partial<CallCenterRow>): CallCenterRow => ({
  id: 'x', provider: 'tauk', status: 'APPROVED', email: null, firstName: null, lastName: null,
  phone: null, amountUsd: 100, refundedUsd: null, fulfillmentStatus: 'SHIPPED',
  productName: null, family: null, agentName: null, purchasedAt: at('2026-08-22T15:00:00Z'),
  ...over,
});
const COMM = { tauk: { pct: 0.35, assumed: false }, logicall: { pct: 0.2, assumed: true }, salesbound: { pct: 0.5, assumed: true } };

describe('aggregateCallCenter', () => {
  it('separa por parceiro com a comissão de cada um; total soma as comissões', () => {
    const r = aggregateCallCenter([
      row({ provider: 'tauk', amountUsd: 200 }),
      row({ provider: 'logicall', amountUsd: 300, agentName: 'LC-1', productName: 'NeuroMindPro 6 Bottles Special', family: 'NeuroMindPro' }),
    ], COMM);
    const tauk = r.providers.find((p) => p.provider === 'tauk')!;
    const lc = r.providers.find((p) => p.provider === 'logicall')!;
    expect(tauk).toMatchObject({ sales: 1, grossUsd: 200, commissionUsd: 70, netUsd: 130 });
    expect(lc).toMatchObject({ sales: 1, grossUsd: 300, commissionUsd: 60, netUsd: 240, commissionAssumed: true });
    expect(r.totals).toMatchObject({ sales: 2, grossUsd: 500, commissionUsd: 130, netUsd: 370 });
    // taxa efetiva do total = 130/500
    expect(r.totals.commissionPct).toBeCloseTo(0.26, 4);
    expect(r.totals.commissionAssumed).toBe(true);
  });

  it('estorno sai da receita e da comissão, mas conta em refunded', () => {
    const r = aggregateCallCenter([
      row({ provider: 'logicall', amountUsd: 300 }),
      row({ provider: 'logicall', amountUsd: 300, status: 'REFUNDED', refundedUsd: 300 }),
      row({ provider: 'logicall', amountUsd: 100, status: 'CHARGEBACK', refundedUsd: 100 }),
    ], COMM);
    const lc = r.providers.find((p) => p.provider === 'logicall')!;
    expect(lc).toMatchObject({ sales: 3, approved: 1, grossUsd: 300, refundedCount: 2, refundedUsd: 400, commissionUsd: 60 });
  });

  it('pendentes = HOLD (Tauk) e PENDING (Logicall) entre as aprovadas', () => {
    const r = aggregateCallCenter([
      row({ provider: 'tauk', fulfillmentStatus: 'HOLD' }),
      row({ provider: 'logicall', fulfillmentStatus: 'PENDING' }),
      row({ provider: 'logicall', fulfillmentStatus: 'SHIPPED' }),
      row({ provider: 'logicall', fulfillmentStatus: 'PENDING', status: 'REFUNDED' }), // fora
    ], COMM);
    expect(r.totals.pendingCount).toBe(2);
    expect(r.byStatus.map((s) => [s.status, s.sales])).toEqual(
      expect.arrayContaining([['HOLD', 1], ['PENDING', 1], ['SHIPPED', 1]]),
    );
  });

  it('série diária em BRT com uma coluna por parceiro', () => {
    const r = aggregateCallCenter([
      row({ provider: 'tauk', amountUsd: 50, purchasedAt: at('2026-08-22T01:00:00Z') }),     // 21/08 BRT
      row({ provider: 'logicall', amountUsd: 80, purchasedAt: at('2026-08-22T12:00:00Z') }), // 22/08
      row({ provider: 'logicall', amountUsd: 20, purchasedAt: at('2026-08-22T20:00:00Z') }), // 22/08
    ], COMM);
    expect(r.daily).toEqual([
      { date: '2026-08-21', tauk: 50, logicall: 0, salesbound: 0, taukSales: 1, logicallSales: 0, salesboundSales: 0 },
      { date: '2026-08-22', tauk: 0, logicall: 100, salesbound: 0, taukSales: 0, logicallSales: 2, salesboundSales: 0 },
    ]);
  });

  it('agentes: IA marcada, ordenado por receita, com ticket médio', () => {
    const r = aggregateCallCenter([
      row({ provider: 'logicall', amountUsd: 100, agentName: 'lc-ai-process' }),
      row({ provider: 'logicall', amountUsd: 300, agentName: 'LC-7' }),
      row({ provider: 'logicall', amountUsd: 100, agentName: 'LC-7' }),
    ], COMM);
    expect(r.byAgent[0]).toMatchObject({ agent: 'LC-7', isAi: false, sales: 2, grossUsd: 400, aovUsd: 200 });
    expect(r.byAgent[1]).toMatchObject({ agent: 'lc-ai-process', isAi: true });
  });

  it('sem linhas → tudo zero, sem NaN; % exibido cai pra referência (Tauk)', () => {
    const r = aggregateCallCenter([], COMM);
    expect(r.totals).toMatchObject({ sales: 0, grossUsd: 0, aovUsd: 0, commissionUsd: 0, commissionPct: 0.35 });
    expect(r.daily).toEqual([]);
  });

  it('refund PARCIAL abate só o valor devolvido — a venda continua na receita', () => {
    const r = aggregateCallCenter([
      row({ provider: 'logicall', amountUsd: 294, refundedUsd: 50 }),   // APPROVED com parcial
    ], COMM);
    const lc = r.providers.find((p) => p.provider === 'logicall')!;
    expect(lc).toMatchObject({ sales: 1, approved: 1, grossUsd: 244, refundedCount: 0, partialRefundCount: 1, refundedUsd: 50 });
    expect(lc.commissionUsd).toBeCloseTo(244 * 0.2, 2);
    expect(r.daily[0].logicall).toBe(244);
  });

  // A SalesBound entra na mesma aba, mas vem do razão dela (SalesboundTransaction):
  // traz produto, agente e origem do cliente, e NÃO tem feed de fulfillment.
  it('SalesBound: soma no parceiro dela, com série e origem do cliente próprias', () => {
    const r = aggregateCallCenter([
      row({ provider: 'salesbound', amountUsd: 846, agentName: 'Joshua.Fields-NorthScale', productName: 'NeuroRecall - 1 Bottle', family: 'NeuroRecall', fulfillmentStatus: null, sourcePlatform: 'jvzoo' }),
      row({ provider: 'salesbound', amountUsd: 294, fulfillmentStatus: null, sourcePlatform: 'buygoods' }),
      row({ provider: 'salesbound', amountUsd: 500, refundedUsd: 500, status: 'REFUNDED', fulfillmentStatus: null, sourcePlatform: 'buygoods' }),
      row({ provider: 'tauk', amountUsd: 200 }),
    ], COMM);
    const sb = r.providers.find((p) => p.provider === 'salesbound')!;
    expect(sb).toMatchObject({ label: 'SalesBound', sales: 3, approved: 2, grossUsd: 1140, refundedCount: 1, refundedUsd: 500 });
    expect(sb.commissionUsd).toBe(570);      // 50% fica com a parceira
    expect(sb.netUsd).toBe(570);
    expect(r.daily[0]).toMatchObject({ salesbound: 1140, salesboundSales: 2, tauk: 200, taukSales: 1 });
    expect(r.bySourcePlatform).toEqual([
      { platform: 'jvzoo', sales: 1, grossUsd: 846 },
      { platform: 'buygoods', sales: 1, grossUsd: 294 },
    ]);
    // fulfillment: só Tauk/Logicall entram (a SalesBound não informa)
    expect(r.byStatus.reduce((s, x) => s + x.sales, 0)).toBe(1);
    // agente e produto aparecem normalmente
    expect(r.byAgent.map((a) => a.agent)).toContain('Joshua.Fields-NorthScale');
    expect(r.byProduct.map((p) => p.product)).toContain('NeuroRecall - 1 Bottle');
  });

  it('placeholder (estorno antes da venda) conta como estorno, não como venda', () => {
    const { providers } = summarizeProviders([
      row({ provider: 'logicall', amountUsd: 0, status: 'REFUNDED', refundedUsd: 294, placeholder: true }),
      row({ provider: 'logicall', amountUsd: 300 }),
    ], COMM);
    const lc = providers.find((p) => p.provider === 'logicall')!;
    expect(lc).toMatchObject({ sales: 1, approved: 1, refundedCount: 1, refundedUsd: 294, grossUsd: 300 });
  });
});
