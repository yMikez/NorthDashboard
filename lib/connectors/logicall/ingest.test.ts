import { describe, expect, it } from 'vitest';
import { parseLogicallTransaction, isAiAgent, externalKeyFor } from './ingest';
import type { LogicallTransaction } from './types';

// Linha real de 2026-08-22 (anonimizada). É a shape exata da API.
const sale: LogicallTransaction = {
  transactionId: 2308825,
  parentTxnId: null,
  orderId: '4CF2B8B2A2',
  customerId: 1042597,
  campaignName: 'NorthScale',
  txnType: 'SALE',
  responseType: 'SUCCESS',
  responseText: 'Approved',
  totalAmount: '294.00',
  currencyCode: 'USD',
  dateCreated: '2026-08-22 10:42:47',
  orderAgentName: 'LC-1260',
  orderType: 'NEW_SALE',
  billingCycleNumber: 1,
  isChargedback: '0',
  emailAddress: 'Buyer@Example.test',
  firstName: 'Ana',
  lastName: 'Silva',
  phoneNumber: '+15550001111',
  address1: '1 Main St',
  city: 'Austin',
  state: 'TX',
  country: 'US',
  items: [{
    productId: '15613', product: 'NeuroMindPro 6 Bottles Special', sku: 'NSNMP6',
    price: '294.00', quantity: '1', fulfillmentStatus: 'PENDING', productType: 'OFFER',
  }],
};

describe('parseLogicallTransaction — venda', () => {
  const p = parseLogicallTransaction(sale);
  it('SALE+SUCCESS vira venda APPROVED com chave logicall:<transactionId>', () => {
    expect(p.kind).toBe('sale');
    if (p.kind !== 'sale') return;
    expect(p.externalKey).toBe('logicall:2308825');
    expect(p.externalId).toBe('2308825');
    expect(p.orderId).toBe('4CF2B8B2A2');
    expect(p.status).toBe('APPROVED');
    expect(p.amountUsd).toBe(294);
  });

  it('dateCreated é wall clock Eastern → UTC (10:42 EDT = 14:42Z)', () => {
    if (p.kind !== 'sale') return;
    expect(p.purchasedAt.toISOString()).toBe('2026-08-22T14:42:47.000Z');
  });

  it('produto → família/potes pelo classificador; agente e fulfillment preservados', () => {
    if (p.kind !== 'sale') return;
    expect(p.productName).toBe('NeuroMindPro 6 Bottles Special');
    expect(p.productSku).toBe('NSNMP6');
    expect(p.family).toBe('NeuroMindPro');
    expect(p.bottles).toBe(6);
    expect(p.agentName).toBe('LC-1260');
    expect(p.fulfillmentStatus).toBe('PENDING');
  });

  it('cliente: e-mail minúsculo, endereço concatenado', () => {
    if (p.kind !== 'sale') return;
    expect(p.email).toBe('buyer@example.test');
    expect(p.address).toBe('1 Main St, Austin');
    expect(p.state).toBe('TX');
  });

  it('multi-item: potes somados (quantidade × potes de cada)', () => {
    const q = parseLogicallTransaction({
      ...sale,
      items: [
        { product: 'NeuroMindPro 6 Bottles Special', sku: 'NSNMP6', quantity: '1', fulfillmentStatus: 'PENDING' },
        { product: 'NeuroMindPro 2 Bottles Special', sku: 'NSNMP2', quantity: '2', fulfillmentStatus: 'PENDING' },
      ],
    });
    expect(q.kind).toBe('sale');
    if (q.kind === 'sale') expect(q.bottles).toBe(10);
  });

  it('isChargedback=1 na própria venda → CHARGEBACK', () => {
    const q = parseLogicallTransaction({
      ...sale, isChargedback: '1', chargebackAmount: '294.00', chargebackDate: '2026-08-30 09:00:00',
    });
    expect(q.kind).toBe('sale');
    if (q.kind === 'sale') {
      expect(q.status).toBe('CHARGEBACK');
      expect(q.chargebackUsd).toBe(294);
      expect(q.chargebackAt?.toISOString()).toBe('2026-08-30T13:00:00.000Z');
    }
  });
});

describe('parseLogicallTransaction — estornos e descartes', () => {
  it('REFUND vira evento aplicado à venda-mãe (parentTxnId)', () => {
    const r = parseLogicallTransaction({
      ...sale, transactionId: 9999, parentTxnId: 2308825, txnType: 'REFUND',
      totalAmount: '-294.00', dateCreated: '2026-08-25 15:00:00',
    });
    expect(r.kind).toBe('reversal');
    if (r.kind === 'reversal') {
      expect(r.status).toBe('REFUNDED');
      expect(r.parentTransactionId).toBe('2308825');
      expect(r.amountUsd).toBe(294); // abs
      expect(r.at.toISOString()).toBe('2026-08-25T19:00:00.000Z');
    }
  });

  it('VOID e CHARGEBACK também são estorno', () => {
    expect(parseLogicallTransaction({ ...sale, transactionId: 1, txnType: 'VOID' }).kind).toBe('reversal');
    const cb = parseLogicallTransaction({ ...sale, transactionId: 2, txnType: 'CHARGEBACK' });
    expect(cb.kind === 'reversal' && cb.status).toBe('CHARGEBACK');
  });

  it('SALE DECLINED não é venda', () => {
    const d = parseLogicallTransaction({ ...sale, responseType: 'DECLINED', responseText: 'Do Not Honor' });
    expect(d.kind).toBe('skip');
  });

  it('txnType desconhecido → skip com motivo', () => {
    const d = parseLogicallTransaction({ ...sale, txnType: 'AUTH_ONLY' });
    expect(d).toMatchObject({ kind: 'skip', reason: 'txnType AUTH_ONLY' });
  });

  it('sem transactionId → skip', () => {
    const d = parseLogicallTransaction({ ...sale, transactionId: '' });
    expect(d.kind).toBe('skip');
  });

  it('sem dateCreated parseável → skip (nunca "agora", senão a linha anda a cada sync)', () => {
    expect(parseLogicallTransaction({ ...sale, dateCreated: '' })).toMatchObject({ kind: 'skip' });
    expect(parseLogicallTransaction({ ...sale, dateCreated: '08/22/2026 10:42' })).toMatchObject({ kind: 'skip' });
  });
});

describe('isAiAgent', () => {
  it('lc-ai-process é IA; LC-1287 é humano', () => {
    expect(isAiAgent('lc-ai-process')).toBe(true);
    expect(isAiAgent('LC-1287')).toBe(false);
    expect(isAiAgent(null)).toBe(false);
  });
  it('externalKeyFor', () => {
    expect(externalKeyFor('42')).toBe('logicall:42');
  });
});
