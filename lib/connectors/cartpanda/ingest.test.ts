import { describe, it, expect } from 'vitest';
import { parseCartpandaIngest } from './ingest';
import type { CartpandaPostback } from './types';

// Postback baseado nas macros do painel Cartpanda (print 2026-06-13).
const fePostback: CartpandaPostback = {
  order_id: 'CP10042',
  product_id: '777',
  product_name: 'Neuro Mind Pro 6 Bottles',
  shop_slug: 'minha-loja',
  cid: 'click_abc123',
  order_type: 'front',
  upsell_no: '0',
  total_price: '199.00',
  amount_net: '120.00',
  amount_affiliate: '60.00',
  currency: 'USD',
  afid: '4521',
  affiliate_slug: 'joao-afiliado',
  email: 'buyer@example.com',
  first_name: 'João',
  last_name: 'Silva',
  phone_number: '+5511999999999',
  country: 'BR',
  datetime_unix: '1781841600', // 2026-06-19 04:00:00 UTC
  datetime_utc: '2026-06-19 04:00:00',
  is_test: '0',
  utm_source: 'facebook',
  campaignkey: 'camp42',
  src: 'src_xyz',
};

describe('parseCartpandaIngest', () => {
  it('FE: campos básicos + sessão por cid', () => {
    const o = parseCartpandaIngest(fePostback);
    expect(o.platformSlug).toBe('cartpanda');
    expect(o.externalId).toBe('CP10042'); // FE = order_id limpo
    expect(o.parentExternalId).toBe('CP10042'); // anchor
    expect(o.funnelSessionId).toBe('click_abc123'); // cid = sessão
    expect(o.clickId).toBe('click_abc123');
    expect(o.productType).toBe('FRONTEND');
    expect(o.funnelStep).toBe(1);
    expect(o.status).toBe('APPROVED'); // canal só manda venda aprovada
    expect(o.vendorAccount).toBe('minha-loja');
  });

  it('FE: valores — gross/net/cpa e fee implícita', () => {
    const o = parseCartpandaIngest(fePostback);
    expect(o.grossAmountUsd).toBe(199);
    expect(o.netAmountUsd).toBe(120);
    expect(o.cpaPaidUsd).toBe(60);
    // fee implícita = gross - net - cpa = 199 - 120 - 60 = 19
    expect(o.fees).toBe(19);
    expect(o.currencyOriginal).toBe('USD');
  });

  it('FE: afiliado e customer', () => {
    const o = parseCartpandaIngest(fePostback);
    expect(o.affiliateExternalId).toBe('4521');
    expect(o.affiliateNickname).toBe('joao-afiliado');
    expect(o.customerEmail).toBe('buyer@example.com');
    expect(o.customerExternalId).toBe('buyer@example.com');
    expect(o.customerFirstName).toBe('João');
    expect(o.country).toBe('BR');
  });

  it('timestamp: usa datetime_unix (epoch) como autoritativo', () => {
    const o = parseCartpandaIngest(fePostback);
    expect(o.orderedAt.toISOString()).toBe('2026-06-19T04:00:00.000Z');
  });

  it('timestamp: fallback datetime_utc tratado como UTC literal (sem shift)', () => {
    const o = parseCartpandaIngest({ ...fePostback, datetime_unix: undefined });
    expect(o.orderedAt.toISOString()).toBe('2026-06-19T04:00:00.000Z');
  });

  it('upsell: externalId ganha sufixo -uN, role UPSELL, step segue o número', () => {
    const o = parseCartpandaIngest({
      ...fePostback,
      order_type: 'upsell',
      upsell_no: '1',
      product_name: 'Neuro Mind Pro 6 Bottles',
      total_price: '79.00',
      amount_net: '50.00',
      amount_affiliate: '20.00',
    });
    expect(o.externalId).toBe('CP10042-u1'); // único, mesmo reusando order_id
    expect(o.parentExternalId).toBe('CP10042'); // mesmo anchor do FE
    expect(o.funnelSessionId).toBe('click_abc123'); // mesma sessão do FE
    expect(o.productType).toBe('UPSELL');
    expect(o.funnelStep).toBe(2); // up1 → step 2
  });

  it('upsell 2 → step 3', () => {
    const o = parseCartpandaIngest({ ...fePostback, upsell_no: '2', order_type: 'upsell' });
    expect(o.externalId).toBe('CP10042-u2');
    expect(o.funnelStep).toBe(3);
  });

  it('downsell detectado por order_type', () => {
    const o = parseCartpandaIngest({ ...fePostback, upsell_no: '1', order_type: 'downsell' });
    expect(o.productType).toBe('DOWNSELL');
  });

  it('sem order_id → erro (campo obrigatório)', () => {
    expect(() => parseCartpandaIngest({ ...fePostback, order_id: undefined }))
      .toThrow(/order_id/);
  });

  it('currency default USD + cid ausente cai pro order_id como sessão', () => {
    const o = parseCartpandaIngest({ ...fePostback, currency: undefined, cid: undefined });
    expect(o.currencyOriginal).toBe('USD');
    expect(o.funnelSessionId).toBe('CP10042');
  });
});
