import { describe, it, expect } from 'vitest';
import { parseBuyGoodsIngest } from './ingest';
import type { BuyGoodsPayload } from './types';

// Payload baseado em IPN real capturado via N8N em 2026-05-14. Trim de
// alguns campos pra economizar tamanho do test; valores que entram no
// NormalizedOrder estão preservados verbatim.
const realPayload: BuyGoodsPayload = {
  sessid2: 'sessid222',
  account_id: '12595',
  action_type: 'neworder',
  product_codename: 'prod_cod',
  product_id: '1',
  user_id: '1',
  storecheckedoutcarts_id: '1',
  aff_id: '1',
  rr_createdate: '2026-05-14 01:06:55',
  order_id_global: '5QWERTYU',
  name: 'John Doe',
  total: '1.95', // garbled — parser deve ignorar e usar total_amount_charged
  payment_method: 'Visa ending with 1111',
  payment_cardtype: 'Visa',
  payment_cardlast4: '1111',
  was_canceled: '0',
  aff_commission: '47.90',
  shipping_method: '0',
  is_test: '0',
  total_collected: '0.00',
  customer_emailaddress: 'johndoe@gmail.com',
  customer_phone: '123456789',
  referrer_url: 'johndoe.com',
  referrer_sid: 'aaa140323extra',
  ipaddress: '127.0.0.1',
  shipping_cost: '9.95',
  flag_sms_sent: '0',
  merchant_commission: '5.74',
  lang: 'en',
  cogs: '0.00',
  coupon_discount: '0.00',
  subid: 'aaa140323extra',
  accrual_total: '0.00',
  buy_url: 'buygoods.com/secure/?account_id=12595&product_codename=prod_cod',
  flag_upsell: '0',
  browser_user_agent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1',
  traffic_source: '',
  aff_name: 'AffID',
  total_clean: '78.95',
  amount_in_currency: '$78.95',
  token: 'token123',
  token_ipn: 'token_123ipn',
  sid: 'aaa140323extra',
  total_amount_charged: '78.95',
  currency: 'USD',
  billing_firstname: 'John',
  billing_lastname: 'Doe',
  customer_firstname: 'John',
  customer_lastname: 'Doe',
  order_id: '111',
  country_2letter: 'US',
  state: 'New York',
  city: 'Elmont',
  shipping_cost_total: '9.95',
  product_quantity: '1',
  flag_frontend: '1',
  payment_status: 'Completed',
  product_name: 'TestProd  ',
  product_price: '69.00',
  sku: '12595-prod_cod:1',
  taxes: '0',
};

describe('parseBuyGoodsIngest', () => {
  it('parses a real neworder/FE payload', () => {
    const o = parseBuyGoodsIngest(realPayload);

    expect(o.platformSlug).toBe('buygoods');
    expect(o.externalId).toBe('111');
    expect(o.parentExternalId).toBe('5QWERTYU');
    expect(o.vendorAccount).toBe('12595');

    expect(o.productExternalId).toBe('prod_cod');
    expect(o.productName).toBe('TestProd');
    expect(o.productType).toBe('FRONTEND');

    expect(o.affiliateExternalId).toBe('1');
    expect(o.affiliateNickname).toBe('AffID');

    expect(o.customerEmail).toBe('johndoe@gmail.com');
    expect(o.customerFirstName).toBe('John');
    expect(o.customerLastName).toBe('Doe');
    expect(o.customerLanguage).toBe('en');

    expect(o.status).toBe('APPROVED');
    expect(o.eventType).toBe('neworder');

    expect(o.currencyOriginal).toBe('USD');
    expect(o.grossAmountUsd).toBe(78.95);
    expect(o.grossAmountOrig).toBe(78.95);
    expect(o.taxAmount).toBe(0);
    // fees = merchant_commission (5.74) + shipping (9.95)
    expect(o.fees).toBeCloseTo(15.69, 2);
    expect(o.cpaPaidUsd).toBe(47.90);
    // net = gross - merchant - cpa - shipping = 78.95 - 5.74 - 47.90 - 9.95 = 15.36
    expect(o.netAmountUsd).toBeCloseTo(15.36, 2);

    expect(o.paymentMethod).toBe('Visa');
    expect(o.country).toBe('US');
    expect(o.state).toBe('New York');
    expect(o.city).toBe('Elmont');

    expect(o.funnelSessionId).toBe('5QWERTYU');
    expect(o.funnelStep).toBe(1);
    expect(o.clickId).toBe('aaa140323extra');
    expect(o.deviceType).toBe('mobile');
    expect(o.browser).toBe('Safari');

    // 2026-05-14 01:06:55 UTC
    expect(o.orderedAt.toISOString()).toBe('2026-05-14T01:06:55.000Z');
  });

  it('throws when order_id missing', () => {
    expect(() =>
      parseBuyGoodsIngest({ ...realPayload, order_id: '' }),
    ).toThrow(/order_id/);
  });

  it('maps refund action to REFUNDED status', () => {
    const o = parseBuyGoodsIngest({ ...realPayload, action_type: 'refund' });
    expect(o.status).toBe('REFUNDED');
    expect(o.eventType).toBe('refund');
  });

  it('maps chargeback action', () => {
    const o = parseBuyGoodsIngest({ ...realPayload, action_type: 'chargeback' });
    expect(o.status).toBe('CHARGEBACK');
  });

  it('flags upsell when flag_upsell=1', () => {
    const o = parseBuyGoodsIngest({
      ...realPayload,
      flag_frontend: '0',
      flag_upsell: '1',
      funnel_step: '2',
    });
    expect(o.productType).toBe('UPSELL');
    expect(o.funnelStep).toBe(2);
  });

  it('detects downsell from SKU pattern', () => {
    const o = parseBuyGoodsIngest({
      ...realPayload,
      flag_frontend: '0',
      flag_upsell: '0',
      product_codename: 'neuromindpro-dw2',
    });
    expect(o.productType).toBe('DOWNSELL');
  });

  it('handles canceled order', () => {
    const o = parseBuyGoodsIngest({
      ...realPayload,
      was_canceled: '1',
    });
    expect(o.status).toBe('CANCELED');
  });

  it('falls back to FE when no flags present', () => {
    const o = parseBuyGoodsIngest({
      ...realPayload,
      flag_frontend: '',
      flag_upsell: '',
    });
    expect(o.productType).toBe('FRONTEND');
  });
});
