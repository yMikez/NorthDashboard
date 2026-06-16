import { describe, it, expect } from 'vitest';
import { parseCartpandaWebhook } from './ingest';
import type { CartpandaWebhook } from './types';

// Payloads enxutos baseados nos webhooks reais capturados em 2026-06-13
// (loja de teste testecartx). Mantidos só os campos que o parser usa.

const paidSingleFE: CartpandaWebhook = {
  event: 'order.paid',
  order: {
    id: 10993186,
    number: 2800,
    order_number: '2800',
    test: 0,
    is_cartx_test: 0,
    email: 'teste@cartpanda.com',
    currency: 'BRL',
    total_price: '7,50',
    afid: null,
    affiliate_slug: null,
    affiliate_amount: null,
    created_at: '2022-07-16 01:18:23',
    status_id: 'New',
    shop: { id: 9, slug: 'testecartx', name: 'Teste Cartpanda' },
    customer: { id: 1, email: 'teste@cartpanda.com', first_name: 'Cartpanda', last_name: 'Teste' },
    address: { country_code: 'BR', city: 'Franca', province_code: 'SP' },
    payment: { type: 'boleto', split_fee: 3.6, seller_split_amount: 3.9, amount: 7.5 },
    line_items: [
      { id: 9536765, sku: 'v-17106571', name: '[PROMO] Garantiax Preto', price: 15, quantity: 1, product_id: 4916560, up_sell_id: 0, up_sell_type: null, is_refunded: 0 },
    ],
  },
};

const upsellMultiLine: CartpandaWebhook = {
  event: 'order.upsell',
  order: {
    id: 32502750,
    number: 193,
    test: 0,
    is_cartx_test: 1,
    email: 'test@cartpanda.com',
    currency: 'BRL',
    total_price: 38,
    afid: null,
    affiliate_slug: null,
    affiliate_amount: null,
    created_at: '2025-02-05T07:21:07.000000Z',
    shop: { id: 9, slug: 'testecartx' },
    customer: { email: 'test@cartpanda.com', first_name: 'Test', last_name: 'cartpanda' },
    address: { country_code: 'BR' },
    payment: { type: 'cc', split_fee: 0 },
    line_items: [
      { id: 37807619, sku: 'TESTBRP', name: 'Test BR P Default', price: 15, quantity: 1, product_id: 22678013, up_sell_id: 0, up_sell_type: null },
      { id: 37807667, sku: 'UPS1', name: 'Test Upsell Default', price: 10, quantity: 1, product_id: 22264763, up_sell_id: 42186, up_sell_type: 'Upsell 1' },
      { id: 37807680, sku: 'UPS2', name: 'Test Upsell 2', price: 13, quantity: 1, product_id: 22264763, up_sell_id: 42187, up_sell_type: 'Upsell 2' },
    ],
  },
};

const refundedWithAffiliate: CartpandaWebhook = {
  event: 'order.refunded',
  order: {
    id: 34656145,
    number: 4072,
    test: 0,
    email: 'test@cartpanda.com',
    currency: 'USD',
    total_price: '5,88',
    afid: 'ppB15ZXbN0',
    affiliate_slug: 'caju',
    affiliate_amount: '2.20',
    created_at: '2025-04-15 11:15:37',
    status_id: 'Refunded',
    chargeback_received: 0,
    shop: { id: 9, slug: 'testecartx' },
    customer: { email: 'test@cartpanda.com', first_name: 'test', last_name: 'cartpanda' },
    address: { country_code: 'BR' },
    payment: { type: 'cc', split_fee: 1.49 },
    refunds: [{ total_amount: 5.88 }],
    line_items: [
      { id: 40825139, sku: '6978791', name: 'Product A', price: 5.88, quantity: 1, product_id: 6978789, up_sell_id: 0, up_sell_type: null, is_refunded: 0, refunded_quantity: 0 },
    ],
  },
};

// Payload real (loja Horse Peak, BRL base, vendendo em USD). order.currency
// vem "USD" mentindo; os amounts estão em BRL e a Cartpanda manda a taxa.
const multiCurrencyBRL: CartpandaWebhook = {
  event: 'order.paid',
  order: {
    id: 50222500, number: 15, test: 0, is_cartx_test: 1,
    email: 'kennyd6237@aol.com',
    currency: 'USD', // MENTIROSO — a loja é BRL
    exchange_rate_USD: '0.19863300',
    total_price: 1115.07, subtotal_price: 1042.12, total_tax: 72.95,
    afid: null, affiliate_slug: null, affiliate_amount: null,
    created_at: '2026-06-16 09:52:10', status_id: 'New',
    shop: { id: 787216, slug: 'horse-peak-gelatin' },
    shop_info: { settings_general: { base_currency: 'BRL', currency: 'BRL' } },
    customer: { email: 'kennyd6237@aol.com', first_name: 'KENNY', last_name: 'DAWSON' },
    address: { country_code: 'US', province_code: 'MS', city: 'Florence' },
    payment: {
      type: 'cc', currency: 'BRL', split_fee: 8.5, seller_split_amount: 945.84,
      cartpanda_pay_split_amount: 96.28, actual_exchange_rate: 0.198633,
      actual_price_paid: 221.490277, actual_price_paid_currency: 'USD',
    },
    all_payments: [{
      seller_split_amount: 945.84, cartpanda_pay_split_amount: 96.28,
      actual_price_paid_currency: 'USD', actual_price_paid: 221.490277, actual_exchange_rate: 0.198633,
    }],
    line_items: [
      { id: 63206358, sku: 'HORSEPEAKFE-3BOTTLES', name: 'Horse Peak Gelatin - FE 3 Bottles', title: 'Horse Peak Gelatin - FE', price: 1042.12, actual_price_paid: 207, quantity: 1, product_id: 29662470, up_sell_id: 0, up_sell_type: null },
    ],
  },
};

describe('parseCartpandaWebhook — multi-moeda (loja BRL → USD)', () => {
  const [o] = parseCartpandaWebhook(multiCurrencyBRL);

  it('moeda base = BRL (ignora order.currency "USD" mentiroso)', () => {
    expect(o.currencyOriginal).toBe('BRL');
  });

  it('grossAmountOrig em BRL; grossAmountUsd convertido pela taxa do payload', () => {
    expect(o.grossAmountOrig).toBe(1042.12);       // valor BRL original preservado
    expect(o.grossAmountUsd).toBeCloseTo(207, 1);  // 1042.12 × 0.198633 ≈ 207
  });

  it('fee = cartpanda_pay_split_amount em USD; net ≈ seller_split em USD', () => {
    expect(o.fees).toBeCloseTo(19.13, 1);          // 96.28 × 0.198633
    expect(o.cpaPaidUsd).toBe(0);
    expect(o.netAmountUsd).toBeCloseTo(187.87, 1); // 207 − 19.13 ≈ 945.84 × taxa
  });

  it('NÃO mostra o valor em BRL como se fosse USD (bug reportado)', () => {
    expect(o.grossAmountUsd).toBeLessThan(300);    // ~207, não 1042
  });
});

describe('parseCartpandaWebhook — order.paid (FE única)', () => {
  const [o] = parseCartpandaWebhook(paidSingleFE);

  it('1 Order, FRONTEND, status APPROVED', () => {
    expect(parseCartpandaWebhook(paidSingleFE)).toHaveLength(1);
    expect(o.platformSlug).toBe('cartpanda');
    expect(o.productType).toBe('FRONTEND');
    expect(o.funnelStep).toBe(1);
    expect(o.status).toBe('APPROVED');
  });

  it('externalId = orderId-lineId; parent/sessão = orderId', () => {
    expect(o.externalId).toBe('10993186-9536765');
    expect(o.parentExternalId).toBe('10993186');
    expect(o.funnelSessionId).toBe('10993186');
  });

  it('gross = price × qty; net = gross − fee − cpa', () => {
    expect(o.grossAmountUsd).toBe(15);  // 15 × 1
    expect(o.cpaPaidUsd).toBe(0);       // sem afiliado
    expect(o.fees).toBe(3.6);           // split_fee na linha FE
    expect(o.netAmountUsd).toBe(11.4);  // 15 − 3.6 − 0
    expect(o.currencyOriginal).toBe('BRL');
  });

  it('produto, customer, país, vendor', () => {
    expect(o.productExternalId).toBe('v-17106571'); // sku
    expect(o.productName).toBe('[PROMO] Garantiax Preto');
    expect(o.customerEmail).toBe('teste@cartpanda.com');
    expect(o.country).toBe('BR');
    expect(o.vendorAccount).toBe('testecartx');
  });

  it('timestamp "YYYY-MM-DD HH:mm:ss" tratado como UTC', () => {
    expect(o.orderedAt.toISOString()).toBe('2022-07-16T01:18:23.000Z');
  });
});

describe('parseCartpandaWebhook — order.upsell (multi-linha)', () => {
  const orders = parseCartpandaWebhook(upsellMultiLine);

  it('3 Orders (1 FE + 2 upsells), mesma sessão', () => {
    expect(orders).toHaveLength(3);
    expect(orders.every((o) => o.parentExternalId === '32502750')).toBe(true);
    expect(orders.map((o) => o.productType)).toEqual(['FRONTEND', 'UPSELL', 'UPSELL']);
  });

  it('upsell step vem do up_sell_type ("Upsell 1" → 2, "Upsell 2" → 3)', () => {
    expect(orders[1].funnelStep).toBe(2);
    expect(orders[2].funnelStep).toBe(3);
  });

  it('grosses por linha; externalId único por linha', () => {
    expect(orders.map((o) => o.grossAmountUsd)).toEqual([15, 10, 13]);
    expect(orders.map((o) => o.externalId)).toEqual([
      '32502750-37807619', '32502750-37807667', '32502750-37807680',
    ]);
  });

  it('timestamp ISO UTC parseado direto', () => {
    expect(orders[0].orderedAt.toISOString()).toBe('2025-02-05T07:21:07.000Z');
  });
});

describe('parseCartpandaWebhook — order.refunded', () => {
  const [o] = parseCartpandaWebhook(refundedWithAffiliate);

  it('status REFUNDED (reembolso total — nenhuma linha flagada)', () => {
    expect(o.status).toBe('REFUNDED');
  });

  it('CPA do afiliado na linha FE; net desconta fee+cpa', () => {
    expect(o.affiliateExternalId).toBe('ppB15ZXbN0');
    expect(o.affiliateNickname).toBe('caju');
    expect(o.cpaPaidUsd).toBe(2.2);
    expect(o.grossAmountUsd).toBe(5.88);
    expect(o.fees).toBe(1.49);
    expect(o.netAmountUsd).toBe(2.19); // 5.88 − 1.49 − 2.20
    expect(o.currencyOriginal).toBe('USD');
  });
});

describe('parseCartpandaWebhook — eventos e edge cases', () => {
  it('order.chargeback → CHARGEBACK', () => {
    const [o] = parseCartpandaWebhook({ ...paidSingleFE, event: 'order.chargeback' });
    expect(o.status).toBe('CHARGEBACK');
  });

  it('chargeback_received=1 → CHARGEBACK mesmo em outro evento', () => {
    const wh = { ...paidSingleFE, order: { ...paidSingleFE.order, chargeback_received: 1 } };
    const [o] = parseCartpandaWebhook(wh);
    expect(o.status).toBe('CHARGEBACK');
  });

  it('valor BR "1.234,56" parseado como 1234.56', () => {
    const wh: CartpandaWebhook = {
      ...paidSingleFE,
      order: {
        ...paidSingleFE.order,
        line_items: [{ id: 1, name: 'X', price: '1.234,56', quantity: 1, up_sell_id: 0 }],
      },
    };
    expect(parseCartpandaWebhook(wh)[0].grossAmountUsd).toBe(1234.56);
  });

  it('sem order.id → erro', () => {
    expect(() => parseCartpandaWebhook({ event: 'order.paid', order: {} as never }))
      .toThrow(/order\.id/);
  });
});
