import { describe, expect, it } from 'vitest';
import {
  brtDay, brtDayOffset, foldPaykeyMark, mergeNetworkSale, parseNetworkCheckout, parseNetworkSale, type NetworkSaleFields, type StoredNetworkSale,
} from './networksCore';
import { checkoutDailyRows } from './networksSync';

// Corpo de compra do contrato (docs/integracoes/redes.md §3), encurtado.
const purchase = {
  source: 'n8n-jvzoo-redes',
  status: 'accepted',
  event: 'purchase',
  transaction_type: 'SALE',
  network: { id: 'net-1', name: 'ProStart', status: 'active', operation_mode: 'own_pages', jvzoo_affiliate_id: '3552295' },
  member: { id: 'mem-1', public_id: 'WiweBviKhW', name: 'Novo Pelo Link', status: 'active' },
  product: { id: 'prod-1', name: 'NeuroMind Pro', jvzoo_product_id: '444171' },
  sale: { conversion_id: 'conv-1', transaction_id: 'AP-7RX93422', sold_at: '2026-10-22T19:29:55.000Z', amount: '69.00', is_test: false, state: 'approved', refunded_at: null },
  attribution: { status: 'attributed', reason: null },
  amounts: { currency: 'USD', network_cpa: '230.00', member_amount: '200.00', network_margin: '30.00' },
  commission: { status: 'pending', available_at: '2026-10-25T03:00:00.000Z', paid_at: null },
  click: { ic_code: 'K2x9', click_id: '6ac53d9e', clicked_at: '2026-10-22T19:20:01.000Z', utm: { source: 'fb', campaign: 'c1' }, suspect: false },
  traffic: { tid: 'tid-9', utm: { source: 'fb', medium: null, campaign: 'c1' }, sub: { sub1: 'ad-77' }, ad_click: { gclid: null, fbclid: 'IwAR' } },
  postback: { transaction_id: 'AP-7RX93422' },
};

function fields(over: Partial<NetworkSaleFields> = {}): NetworkSaleFields {
  const p = parseNetworkSale(purchase);
  if ('error' in p) throw new Error(p.error);
  return { ...p.fields, ...over };
}

describe('parseNetworkSale', () => {
  it('lê o corpo do contrato', () => {
    const p = parseNetworkSale(purchase);
    if ('error' in p) throw new Error(p.error);
    expect(p.transactionId).toBe('AP-7RX93422');
    expect(p.network).toEqual({ id: 'net-1', name: 'ProStart', status: 'active', operationMode: 'own_pages', jvzooAffiliateIds: ['3552295'] });
    expect(p.member?.publicId).toBe('WiweBviKhW');
    expect(p.fields).toMatchObject({
      amountUsd: 69, networkCpa: 230, memberAmount: 200, networkMargin: 30, attributionStatus: 'attributed',
      jvzooProductId: '444171', tid: 'tid-9', utmSource: 'fb', sub1: 'ad-77', isTest: false, adClick: { gclid: null, fbclid: 'IwAR' },
    });
    expect(p.fields.soldAt?.toISOString()).toBe('2026-10-22T19:29:55.000Z');
  });

  it('item da leitura (sem traffic/postback): tid fica vazio, utm vem do clique', () => {
    const { traffic: _t, postback: _p, ...read } = purchase;
    const p = parseNetworkSale(read);
    if ('error' in p) throw new Error(p.error);
    expect(p.fields.tid).toBeNull();
    expect(p.fields.utmSource).toBe('fb');
    expect(p.fields.adClick).toBeNull();
  });

  it('recusa sem rede ou sem transação; member nulo é aceito', () => {
    expect(parseNetworkSale({ ...purchase, network: null })).toEqual({ error: 'network.id ausente' });
    expect(parseNetworkSale({ ...purchase, sale: {}, postback: {} })).toEqual({ error: 'sale.transaction_id ausente' });
    const p = parseNetworkSale({ ...purchase, member: null });
    expect('error' in p ? null : p.member).toBeNull();
  });

  it('paykey da venda (é o transaction_id do postback S2S); a chave é o da IPN', () => {
    const p = parseNetworkSale({
      ...purchase, sale: { ...purchase.sale, transaction_id: 'TXIPN0001', paykey: 'WP-PAYKEY0001' }, postback: { transaction_id: 'WP-PAYKEY0001' },
    });
    if ('error' in p) throw new Error(p.error);
    expect(p.transactionId).toBe('TXIPN0001');
    expect(p.paykey).toBe('WP-PAYKEY0001');
    expect(parseNetworkSale(purchase)).toMatchObject({ paykey: null });
  });

  it('junta jvzoo_affiliate_id e jvzoo_affiliate_ids (diretório)', () => {
    const p = parseNetworkSale({ ...purchase, network: { id: 'n', name: 'N', jvzoo_affiliate_id: null, jvzoo_affiliate_ids: ['1', '2', 3] } });
    expect('error' in p ? null : p.network.jvzooAffiliateIds).toEqual(['1', '2', '3']);
  });
});

describe('parseNetworkCheckout', () => {
  it('lê o checkout iniciado', () => {
    const c = parseNetworkCheckout({
      event: 'initiated', network: purchase.network, member: null, product: purchase.product,
      checkout: { session_id: 'sess-1', jvzoo_click_id: 'a1', funnel_id: '123', country: 'US', at: '2026-10-22T19:20:01.000Z' },
      traffic: { tid: 'x', utm: { source: 'fb', campaign: null }, sub: { sub1: null } },
    });
    if ('error' in c) throw new Error(c.error);
    expect(c).toMatchObject({ sessionId: 'sess-1', member: null, jvzooProductId: '444171', country: 'US', utmSource: 'fb', sub1: null });
    expect(c.at.toISOString()).toBe('2026-10-22T19:20:01.000Z');
    expect(parseNetworkCheckout({ network: purchase.network, checkout: {} })).toEqual({ error: 'checkout.session_id ausente' });
  });
});

describe('mergeNetworkSale', () => {
  const stored = (over: Partial<StoredNetworkSale> = {}): StoredNetworkSale =>
    ({ ...fields(), lastSource: 'event', ...over }) as StoredNetworkSale;

  it('criação: pendente quando não vem status', () => {
    const out = mergeNetworkSale(null, fields({ attributionStatus: null }), 'event');
    expect(out.attributionStatus).toBe('pending');
    expect(out.lastSource).toBe('event');
  });

  it('nulo não apaga', () => {
    const out = mergeNetworkSale(stored(), fields({ memberAmount: null, utmSource: null }), 'event');
    expect('memberAmount' in out).toBe(false);
    expect('utmSource' in out).toBe(false);
  });

  it('atribuída não volta pra pendente (nem perde integrante/valores)', () => {
    const out = mergeNetworkSale(stored(), fields({ attributionStatus: 'pending', attributionReason: 'awaiting_ipn', memberId: 'outro', networkCpa: 1 }), 'event');
    expect(out.attributionStatus).toBeUndefined();
    expect(out.attributionReason).toBeUndefined();
    expect(out.memberId).toBeUndefined();
    expect(out.networkCpa).toBeUndefined();
  });

  it('pendente vira atribuída', () => {
    const out = mergeNetworkSale(stored({ attributionStatus: 'pending', memberId: null }), fields(), 'read');
    expect(out).toMatchObject({ attributionStatus: 'attributed', memberId: 'mem-1', lastSource: 'read' });
  });

  it('a leitura vence; evento atrasado depois dela só preenche o vazio', () => {
    const afterRead = stored({ lastSource: 'read', state: 'refunded', tid: null });
    const out = mergeNetworkSale(afterRead, fields({ state: 'approved', tid: 'tid-9' }), 'event');
    expect(out.state).toBeUndefined();
    expect(out.tid).toBe('tid-9');
    const read = mergeNetworkSale(stored({ state: 'approved' }), fields({ state: 'refunded' }), 'read');
    expect(read.state).toBe('refunded');
  });
});

describe('foldPaykeyMark', () => {
  it('a marca órfã (gravada pelo paykey) completa só o tráfego, nunca atribuição nem valores', () => {
    const orphan = {
      ...fields({ attributionStatus: 'pending', attributionReason: 'awaiting_ipn', memberId: null, networkCpa: null, tid: 'tid-orfa', sub1: 'ad-1', transactionType: 'SALE' }),
      lastSource: 'event',
    } as StoredNetworkSale;
    const read = fields({ tid: null, sub1: null, transactionType: null, utmSource: 'ic-fb' });
    expect(foldPaykeyMark(read, orphan)).toMatchObject({
      tid: 'tid-orfa', sub1: 'ad-1', transactionType: 'SALE', utmSource: 'ic-fb',
      attributionStatus: 'attributed', attributionReason: null, memberId: 'mem-1', networkCpa: 230,
    });
  });
});

describe('dias BRT', () => {
  it('UTC−3', () => {
    expect(brtDay(new Date('2026-10-23T02:59:00Z'))).toBe('2026-10-22');
    expect(brtDay(new Date('2026-10-23T03:00:00Z'))).toBe('2026-10-23');
    expect(brtDayOffset(new Date('2026-10-23T12:00:00Z'), -44)).toBe('2026-09-09');
  });
});

describe('checkoutDailyRows', () => {
  it('soma chave repetida, integrante/produto nulo vira vazio, descarta lixo', () => {
    const now = new Date('2026-10-22T12:00:00Z');
    const rows = checkoutDailyRows([
      { day: '2026-10-22', network_id: 'n1', affiliate_id: 'm1', jvzoo_product_id: '444171', checkouts: 3 },
      { day: '2026-10-22', network_id: 'n1', affiliate_id: 'm1', jvzoo_product_id: '444171', checkouts: 2 },
      { day: '2026-10-22', network_id: 'n1', affiliate_id: null, jvzoo_product_id: null, checkouts: 7 },
      { day: 'ontem', network_id: 'n1', checkouts: 1 },
      { day: '2026-10-22', network_id: null, checkouts: 1 },
    ], now);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ networkId: 'n1', memberKey: 'm1', productKey: '444171', checkouts: 5 });
    expect(rows[1]).toMatchObject({ memberKey: '', productKey: '', checkouts: 7 });
    expect(rows[0].day.toISOString()).toBe('2026-10-22T00:00:00.000Z');
  });
});
