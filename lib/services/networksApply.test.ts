import { beforeEach, describe, expect, it, vi } from 'vitest';

// network_sales em memória: o bastante para applyNetworkSale.
const store = vi.hoisted(() => new Map<string, Record<string, unknown>>());
const mockDb = vi.hoisted(() => ({
  networkSale: {
    findUnique: vi.fn(async ({ where }: { where: { transactionId: string } }) => store.get(where.transactionId) ?? null),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { store.set(data.transactionId as string, { ...data }); }),
    update: vi.fn(async ({ where, data }: { where: { transactionId: string }; data: Record<string, unknown> }) => {
      store.set(where.transactionId, { ...store.get(where.transactionId), ...data });
    }),
    deleteMany: vi.fn(async ({ where }: { where: { transactionId: string } }) => ({ count: store.delete(where.transactionId) ? 1 : 0 })),
  },
}));
vi.mock('../db', () => ({ db: mockDb }));

import { applyNetworkSale } from './networks';
import { parseNetworkSale } from './networksCore';

const network = { id: 'net-1', name: 'ProStart', status: 'active', operation_mode: 'own_pages', jvzoo_affiliate_id: '3649735' };

// O postback chegou antes da venda: o NorthAffiliates devolveu "pending" com o
// número do postback (o paykey) como transaction_id.
const pendingEvent = {
  status: 'accepted', event: 'purchase', transaction_type: 'SALE', network, member: null,
  product: { id: null, name: 'Cognizil 2 Bottles', jvzoo_product_id: '446369' },
  sale: { conversion_id: null, transaction_id: 'WP-PAYKEY0001', paykey: 'WP-PAYKEY0001', amount: '167.99' },
  attribution: { status: 'pending', reason: 'awaiting_ipn' },
  traffic: { tid: 'clk-77', utm: { source: 'fb' }, sub: { sub1: 'ad-1' } },
  postback: { transaction_id: 'WP-PAYKEY0001' },
};

// A conferência traz a venda com o transaction_id da IPN e o paykey.
const readItem = {
  event: 'purchase', network, member: { id: 'mem-1', public_id: 'N2unBaV9Q1', name: 'Integrante', status: 'active' },
  product: { id: 'prod-1', name: 'Cognizil 2 Bottles', jvzoo_product_id: '446369' },
  sale: { conversion_id: 'conv-1', transaction_id: 'TXIPN0001', paykey: 'WP-PAYKEY0001', sold_at: '2026-10-22T20:46:16.000Z', amount: '167.99', is_test: false, state: 'approved' },
  attribution: { status: 'attributed', reason: null },
  amounts: { currency: 'USD', network_cpa: '240.00', member_amount: '225.00', network_margin: '15.00' },
  commission: { status: 'pending', available_at: '2026-10-29T03:00:00.000Z', paid_at: null },
  click: null,
};

const parse = (b: unknown) => {
  const p = parseNetworkSale(b);
  if ('error' in p) throw new Error(p.error);
  return p;
};

describe('applyNetworkSale — marca gravada pelo paykey', () => {
  beforeEach(() => { store.clear(); vi.clearAllMocks(); });

  it('a leitura com sale.paykey junta a marca pendente à venda e apaga a órfã', async () => {
    await applyNetworkSale(parse(pendingEvent), 'event', pendingEvent);
    expect(store.get('WP-PAYKEY0001')).toMatchObject({ attributionStatus: 'pending', tid: 'clk-77' });

    expect(await applyNetworkSale(parse(readItem), 'read', readItem)).toBe('created');
    expect(store.has('WP-PAYKEY0001')).toBe(false);
    const sale = store.get('TXIPN0001');
    expect(sale).toMatchObject({
      attributionStatus: 'attributed', memberId: 'mem-1', memberAmount: 225, networkCpa: 240,
      tid: 'clk-77', utmSource: 'fb', sub1: 'ad-1', transactionType: 'SALE', lastSource: 'read',
    });
    // o corpo guardado é o do evento (com postback e tráfego)
    expect((sale?.raw as { postback?: unknown }).postback).toEqual({ transaction_id: 'WP-PAYKEY0001' });
  });

  it('venda já gravada pela leitura: a órfã completa o tráfego e some', async () => {
    await applyNetworkSale(parse({ ...readItem, sale: { ...readItem.sale, paykey: null } }), 'read', readItem);
    await applyNetworkSale(parse(pendingEvent), 'event', pendingEvent);
    expect(await applyNetworkSale(parse(readItem), 'read', readItem)).toBe('updated');
    expect(store.has('WP-PAYKEY0001')).toBe(false);
    expect(store.get('TXIPN0001')).toMatchObject({ attributionStatus: 'attributed', tid: 'clk-77', sub1: 'ad-1' });
  });

  it('sem paykey (ou igual ao transaction_id) não procura órfã', async () => {
    await applyNetworkSale(parse({ ...readItem, sale: { ...readItem.sale, paykey: 'TXIPN0001' } }), 'read', readItem);
    expect(mockDb.networkSale.findUnique).toHaveBeenCalledTimes(1);
    expect(mockDb.networkSale.deleteMany).not.toHaveBeenCalled();
  });
});
