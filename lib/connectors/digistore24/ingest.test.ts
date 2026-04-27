import { describe, expect, it } from 'vitest';
import fixturePayment from './__fixtures__/glyco-on-payment.json';
import { parseDigistoreIngest, parseDigistoreTimestamp, deriveBaseOrderId } from './ingest';
import type { DigistorePayload } from './types';

const payment = fixturePayment as unknown as DigistorePayload;

describe('parseDigistoreTimestamp', () => {
  it('parses "YYYY-MM-DD HH:MM:SS" format as UTC', () => {
    const d = parseDigistoreTimestamp('2026-04-24 03:56:47');
    expect(d.toISOString()).toBe('2026-04-24T03:56:47.000Z');
  });

  it('falls back to transaction_date + transaction_time', () => {
    const d = parseDigistoreTimestamp(undefined, '2026-04-24', '03:56:54');
    expect(d.toISOString()).toBe('2026-04-24T03:56:54.000Z');
  });

  it('falls back to server_time', () => {
    const d = parseDigistoreTimestamp(undefined, undefined, undefined, '2026-04-24 03:44:09');
    expect(d.toISOString()).toBe('2026-04-24T03:44:09.000Z');
  });
});

describe('parseDigistoreIngest — on_payment', () => {
  const normalized = parseDigistoreIngest(payment);

  it('uses transaction_id as externalId', () => {
    expect(normalized.externalId).toBe('99999999');
  });

  it('extracts merchant_name as vendorAccount', () => {
    expect(normalized.vendorAccount).toBe('TESTMERCHANT');
  });

  it('normalizes event by stripping on_ prefix', () => {
    expect(normalized.eventType).toBe('payment');
  });

  it('maps payment event to APPROVED', () => {
    expect(normalized.status).toBe('APPROVED');
  });

  it('order_id differs from transaction_id → parentExternalId is order_id', () => {
    expect(normalized.parentExternalId).toBe('TEST0001');
    expect(normalized.previousTransactionId).toBe('99999998');
  });

  it('upsell_no 0 → FRONTEND, funnelStep 0', () => {
    expect(normalized.productType).toBe('FRONTEND');
    expect(normalized.funnelStep).toBe(0);
  });

  it('affiliate identity uses first-class fields not tags', () => {
    expect(normalized.affiliateExternalId).toBe('1111111');
    expect(normalized.affiliateNickname).toBe('testaff01');
  });

  it('customer identity preserved with buyer_id', () => {
    expect(normalized.customerExternalId).toBe('22222222');
    expect(normalized.customerEmail).toBe('buyer@example.test');
    expect(normalized.customerLanguage).toBe('en');
  });

  it('amounts map correctly — net = amount_vendor, not amount_netto', () => {
    expect(normalized.grossAmountOrig).toBe(294);
    expect(normalized.netAmountUsd).toBe(29.77);
    expect(normalized.cpaPaidUsd).toBe(240);
    expect(normalized.fees).toBeCloseTo(24.23, 2);
  });

  it('billingType single_payment mapped', () => {
    expect(normalized.billingType).toBe('SINGLE_PAYMENT');
    expect(normalized.paySequenceNo).toBe(0);
    expect(normalized.numberOfInstallments).toBe(1);
  });

  it('detailsUrl captured for drill-down', () => {
    expect(normalized.detailsUrl).toBe(
      'https://www.digistore24-app.com/vendor/reports/transactions/order/TEST0001',
    );
  });

  it('country/state/city from address_* fields', () => {
    expect(normalized.country).toBe('CA');
    expect(normalized.state).toBe('ON');
    expect(normalized.city).toBe('Test City');
  });
});

describe('parseDigistoreIngest — status mapping', () => {
  it('on_refund → REFUNDED', () => {
    const p = { ...payment, event: 'on_refund' };
    expect(parseDigistoreIngest(p).status).toBe('REFUNDED');
  });

  it('chargeback → CHARGEBACK', () => {
    const p = { ...payment, event: 'chargeback' };
    expect(parseDigistoreIngest(p).status).toBe('CHARGEBACK');
  });

  it('on_rebill_cancelled → CANCELED', () => {
    const p = { ...payment, event: 'on_rebill_cancelled' };
    expect(parseDigistoreIngest(p).status).toBe('CANCELED');
  });

  it('on_rebill_resumed → APPROVED', () => {
    const p = { ...payment, event: 'on_rebill_resumed' };
    expect(parseDigistoreIngest(p).status).toBe('APPROVED');
  });
});

describe('parseDigistoreIngest — upsell detection', () => {
  it('upsell_no 1 → UPSELL with funnelStep 1', () => {
    const p = { ...payment, upsell_no: '1', transaction_id: 'T2', parent_transaction_id: 'T1' };
    const n = parseDigistoreIngest(p);
    expect(n.productType).toBe('UPSELL');
    expect(n.funnelStep).toBe(1);
    expect(n.previousTransactionId).toBe('T1');
  });
});

describe('deriveBaseOrderId', () => {
  it('returns orderId unchanged when upsellNo is 0 (FE)', () => {
    expect(deriveBaseOrderId('SAJ39K7J', 0)).toBe('SAJ39K7J');
    expect(deriveBaseOrderId('YP7TYT29', 0)).toBe('YP7TYT29'); // even ending in digit
  });

  it('strips single-digit upsell suffix', () => {
    expect(deriveBaseOrderId('SAJ39K7J1', 1)).toBe('SAJ39K7J');
    expect(deriveBaseOrderId('SAJ39K7J2', 2)).toBe('SAJ39K7J');
    expect(deriveBaseOrderId('YP7TYT291', 1)).toBe('YP7TYT29');
  });

  it('strips multi-digit upsell suffix', () => {
    expect(deriveBaseOrderId('ABC12310', 10)).toBe('ABC123');
    expect(deriveBaseOrderId('XYZ4599', 99)).toBe('XYZ45');
  });

  it('returns orderId unchanged when suffix does not match (defensive)', () => {
    // Real-world malformed payload: upsell_no=2 but order_id ends in "1"
    expect(deriveBaseOrderId('ABC1', 2)).toBe('ABC1');
    expect(deriveBaseOrderId('ABC', 1)).toBe('ABC'); // too short to strip
  });

  it('FE and its upsells share the same base id', () => {
    const fe = deriveBaseOrderId('C74PNZH5', 0);
    const up1 = deriveBaseOrderId('C74PNZH51', 1);
    const up2 = deriveBaseOrderId('C74PNZH52', 2);
    expect(fe).toBe(up1);
    expect(fe).toBe(up2);
    expect(fe).toBe('C74PNZH5');
  });
});
