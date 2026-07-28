import { describe, expect, it } from 'vitest';
import fixtureSale from './__fixtures__/hawaiian-sale.json';
import { parseJvzooIngest, parseJvzooTimestamp, parsePayouts } from './ingest';
import type { JvzooPayload } from './types';

const sale = fixtureSale as unknown as JvzooPayload;

describe('parseJvzooTimestamp', () => {
  it('trata wall clock como America/New_York (EDT em julho = UTC-4)', () => {
    expect(parseJvzooTimestamp('2026-07-26 04:25:29').toISOString()).toBe('2026-07-26T08:25:29.000Z');
  });
  it('EST no inverno (janeiro = UTC-5)', () => {
    expect(parseJvzooTimestamp('2026-01-15 12:00:00').toISOString()).toBe('2026-01-15T17:00:00.000Z');
  });
  it('inválido/ausente cai pro relógio do servidor (não perde o evento)', () => {
    const before = Date.now();
    expect(parseJvzooTimestamp(undefined).getTime()).toBeGreaterThanOrEqual(before);
    expect(parseJvzooTimestamp('not-a-date').getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe('parsePayouts', () => {
  it('AFFILIATES → cpa; JVZOO DOT COM → fee; VENDOR/JV ignorados', () => {
    expect(parsePayouts(sale.transactionPayouts)).toEqual({ affiliateUsd: 230, platformFeeUsd: 25.99 });
  });
  it('JSON quebrado/ausente/não-array → zeros (tolerante)', () => {
    expect(parsePayouts(undefined)).toEqual({ affiliateUsd: 0, platformFeeUsd: 0 });
    expect(parsePayouts('not json')).toEqual({ affiliateUsd: 0, platformFeeUsd: 0 });
    expect(parsePayouts('{"a":1}')).toEqual({ affiliateUsd: 0, platformFeeUsd: 0 });
  });
  it('múltiplos afiliados somam (JV split)', () => {
    const raw = JSON.stringify([
      { payee_amount: '100.00', payout_type: 'AFFILIATES' },
      { payee_amount: '30.00', payout_type: 'AFFILIATES' },
      { payee_amount: '10.00', payout_type: 'JVZOO DOT COM' },
    ]);
    expect(parsePayouts(raw)).toEqual({ affiliateUsd: 130, platformFeeUsd: 10 });
  });
});

describe('parseJvzooIngest — SALE (fixture real anonimizada)', () => {
  const n = parseJvzooIngest(sale);

  it('identidade: transaction_id, plataforma, vendor', () => {
    expect(n.externalId).toBe('NSGOG44I8PJN0F8AR');
    expect(n.platformSlug).toBe('jvzoo');
    expect(n.vendorAccount).toBe('NorthScale LTDA');
  });

  it('FE: prekey aponta pro próprio id → FRONTEND, sessão ancora nele', () => {
    expect(n.productType).toBe('FRONTEND');
    expect(n.parentExternalId).toBe('NSGOG44I8PJN0F8AR');
    expect(n.funnelSessionId).toBe('NSGOG44I8PJN0F8AR');
  });

  it('dinheiro: payouts como fonte de verdade (cpa 230, fee 25.99, net 38.01)', () => {
    expect(n.grossAmountUsd).toBe(294);
    expect(n.cpaPaidUsd).toBe(230);
    expect(n.fees).toBe(25.99);
    expect(n.taxAmount).toBe(0);
    expect(n.netAmountUsd).toBe(38.01);
    expect(n.currencyOriginal).toBe('USD');
  });

  it('SALE + RECURRING → APPROVED + SUBSCRIPTION', () => {
    expect(n.status).toBe('APPROVED');
    expect(n.eventType).toBe('sale');
    expect(n.billingType).toBe('SUBSCRIPTION');
  });

  it('país enum → ISO2; região/cidade preservados', () => {
    expect(n.country).toBe('US');
    expect(n.state).toBe('IL');
    expect(n.city).toBe('Ottawa');
  });

  it('tracking do other_params: tid/vtid extraídos', () => {
    expect(n.trackingId).toBe('ekmwpdty_3092_90872502');
    expect(n.clickId).toMatch(/^v3_/);
    expect(n.trafficSource).toBeNull(); // sem utm_source neste link
  });

  it('afiliado e cliente', () => {
    expect(n.affiliateExternalId).toBe('3552225');
    expect(n.affiliateNickname).toBe('Health Innovations');
    expect(n.customerEmail).toBe('buyer@example.com');
  });

  it('data EDT → UTC', () => {
    expect(n.orderedAt.toISOString()).toBe('2026-07-26T08:25:29.000Z');
  });
});

describe('parseJvzooIngest — variações', () => {
  it('prekey apontando pra OUTRO receipt → UPSELL agrupado na sessão da FE', () => {
    const n = parseJvzooIngest({ ...sale, transaction_id: 'UPSELL123', prekey: 'WR-NSGOG44I8PJN0F8AR' });
    expect(n.productType).toBe('UPSELL');
    expect(n.parentExternalId).toBe('NSGOG44I8PJN0F8AR');
  });

  it('rebill (BILL): NÃO vira upsell e ancora em si mesmo (remessa própria)', () => {
    const n = parseJvzooIngest({
      ...sale,
      transaction_type: 'BILL',
      transaction_id: 'REBILL456',
      prekey: 'WR-NSGOG44I8PJN0F8AR', // prekey da compra ORIGINAL
    });
    expect(n.status).toBe('APPROVED');
    expect(n.productType).toBe('FRONTEND');
    // Sessão isolada: rebalance de frete não funde com o pacote original.
    expect(n.parentExternalId).toBe('REBILL456');
    expect(n.funnelSessionId).toBe('REBILL456');
    expect(n.eventType).toBe('bill');
  });

  it('transaction_type ausente → eventType "unknown" (não string vazia)', () => {
    const n = parseJvzooIngest({ ...sale, transaction_type: '' });
    expect(n.eventType).toBe('unknown');
    expect(n.status).toBe('PENDING');
  });

  it('RFND → REFUNDED; CGBK → CHARGEBACK; INSF/CANCEL-REBILL → CANCELED', () => {
    expect(parseJvzooIngest({ ...sale, transaction_type: 'RFND' }).status).toBe('REFUNDED');
    expect(parseJvzooIngest({ ...sale, transaction_type: 'CGBK' }).status).toBe('CHARGEBACK');
    expect(parseJvzooIngest({ ...sale, transaction_type: 'INSF' }).status).toBe('CANCELED');
    expect(parseJvzooIngest({ ...sale, transaction_type: 'CANCEL-REBILL' }).status).toBe('CANCELED');
    expect(parseJvzooIngest({ ...sale, transaction_type: 'BILL' }).status).toBe('APPROVED');
  });

  it('utm_source no other_params vira trafficSource (atribuição de fonte)', () => {
    const n = parseJvzooIngest({ ...sale, other_params: 'tid=x&utm_source=smsbrdcst&utm_campaign=neuro-01' });
    expect(n.trafficSource).toBe('smsbrdcst');
    expect(n.campaignKey).toBe('neuro-01');
  });

  it('país fora do mapa mantém o cru (não some do filtro)', () => {
    expect(parseJvzooIngest({ ...sale, delivery_country: 'ELBONIA' }).country).toBe('ELBONIA');
  });

  it('POSTBACK S2S (formato magro): amounts/CPA flat, nome único, sem prekey/date', () => {
    const before = Date.now();
    const n = parseJvzooIngest({
      currency: 'USD',
      transaction_id: 'PB123',
      transaction_amount: '294.00',
      transaction_type: 'SALE',
      product_id: '446191',
      product_name: 'Hawaiian Harmony 6 Bottles',
      customer_email: 'buyer@example.com',
      customer_name: 'Test da Silva Buyer',
      customer_country: 'US',
      vendor_id: '3586537',
      payment_method: 'WHOP',
      affiliate_id: '3552225',
      affiliate_amount: '230.00',
      commission_type: 'CPA',
      tid: 'ekmwpdty_3092_90872502',
      utm_source: 'smsbrdcst',
      utm_campaign: 'neuro-01',
      gclid: 'gclid123',
      random: '999',
    });
    expect(n.externalId).toBe('PB123');
    expect(n.grossAmountUsd).toBe(294);
    expect(n.cpaPaidUsd).toBe(230);
    expect(n.fees).toBe(0); // fee da plataforma não vem no postback
    expect(n.netAmountUsd).toBe(64); // 294 − 0 − 0 − 230
    expect(n.customerFirstName).toBe('Test');
    expect(n.customerLastName).toBe('da Silva Buyer');
    expect(n.country).toBe('US');
    expect(n.productType).toBe('FRONTEND'); // sem prekey — cada tx é a própria sessão
    expect(n.parentExternalId).toBe('PB123');
    expect(n.trafficSource).toBe('smsbrdcst');
    expect(n.campaignKey).toBe('neuro-01');
    expect(n.trackingId).toBe('ekmwpdty_3092_90872502');
    expect(n.clickId).toBe('gclid123');
    expect(n.orderedAt.getTime()).toBeGreaterThanOrEqual(before); // sem date → agora
  });

  it('sem transaction_id → erro (campo obrigatório)', () => {
    const p = { ...sale } as Record<string, string>;
    delete p.transaction_id;
    expect(() => parseJvzooIngest(p)).toThrow(/transaction_id/);
  });
});
