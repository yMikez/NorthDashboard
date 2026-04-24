import { describe, expect, it } from 'vitest';
import fixtureFrontend from './__fixtures__/neuromind-frontend.json';
import type { ClickBankIngestPayload } from './types';
import { parseClickBankIngest, parseClickBankTimestamp } from './ingest';

const frontend = fixtureFrontend as unknown as ClickBankIngestPayload;

describe('parseClickBankTimestamp', () => {
  it('parses ClickBank format with PDT offset', () => {
    const d = parseClickBankTimestamp('20260423T175704-0700');
    expect(d.toISOString()).toBe('2026-04-24T00:57:04.000Z');
  });

  it('parses ClickBank format with UTC offset', () => {
    const d = parseClickBankTimestamp('20260101T120000+0000');
    expect(d.toISOString()).toBe('2026-01-01T12:00:00.000Z');
  });

  it('throws on invalid timestamps', () => {
    expect(() => parseClickBankTimestamp('not-a-date')).toThrow();
  });
});

describe('parseClickBankIngest — frontend SALE', () => {
  const normalized = parseClickBankIngest(frontend);

  it('maps receipt to externalId', () => {
    expect(normalized.externalId).toBe('TEST0001');
  });

  it('extracts vendor as vendorAccount', () => {
    expect(normalized.vendorAccount).toBe('testvendor');
  });

  it('treats ORIGINAL lineItemType as FRONTEND with no parent', () => {
    expect(normalized.productType).toBe('FRONTEND');
    expect(normalized.parentExternalId).toBeNull();
  });

  it('funnelStep is 0 for frontend', () => {
    expect(normalized.funnelStep).toBe(0);
  });

  it('maps SALE to APPROVED', () => {
    expect(normalized.status).toBe('APPROVED');
    expect(normalized.eventType).toBe('SALE');
  });

  it('uses aff_sub1 as trackingId, traffic_source as trafficSource', () => {
    expect(normalized.trackingId).toBe('1559512');
    expect(normalized.trafficSource).toBe('Taboola_Test');
    expect(normalized.campaignKey).toBe('test-key');
  });

  it('uses tracking city when present (richer than billing)', () => {
    expect(normalized.city).toBe('Phoenix');
    expect(normalized.state).toBe('Arizona');
    expect(normalized.country).toBe('US');
  });

  it('maps net and gross amounts correctly', () => {
    expect(normalized.grossAmountOrig).toBe(320.75);
    expect(normalized.netAmountUsd).toBe(28.94);
    expect(normalized.taxAmount).toBe(26.75);
    expect(normalized.cpaPaidUsd).toBe(240);
  });

  it('extracts upsellSession as funnelSessionId', () => {
    expect(normalized.funnelSessionId).toBe('TESTSESSION01');
  });

  it('captures clickId, device, browser', () => {
    expect(normalized.clickId).toBe('00000000-0000-0000-0000-000000000000');
    expect(normalized.deviceType).toBe('Desktop');
    expect(normalized.browser).toBe('Chrome');
  });

  it('preserves raw payload in rawMetadata', () => {
    expect(normalized.rawMetadata).toMatchObject({ receipt: 'TEST0001', version: 8 });
  });
});

describe('parseClickBankIngest — status mapping', () => {
  it('RFND → REFUNDED', () => {
    const p = { ...frontend, transactionType: 'RFND' };
    expect(parseClickBankIngest(p).status).toBe('REFUNDED');
  });

  it('CGBK → CHARGEBACK', () => {
    const p = { ...frontend, transactionType: 'CGBK' };
    expect(parseClickBankIngest(p).status).toBe('CHARGEBACK');
  });

  it('BILL → APPROVED', () => {
    const p = { ...frontend, transactionType: 'BILL' };
    expect(parseClickBankIngest(p).status).toBe('APPROVED');
  });
});

describe('parseClickBankIngest — upsell detection', () => {
  it('treats UPSELL lineItemType with distinct parent receipt', () => {
    const p: ClickBankIngestPayload = {
      ...frontend,
      receipt: 'UPSELL123',
      lineItems: [{ ...frontend.lineItems[0], lineItemType: 'UPSELL' }],
      upsell: { ...frontend.upsell, upsellOriginalReceipt: 'TEST0001', upsellPath: 'a' },
    };
    const n = parseClickBankIngest(p);
    expect(n.productType).toBe('UPSELL');
    expect(n.parentExternalId).toBe('TEST0001');
    expect(n.funnelStep).toBe(1);
  });
});

describe('parseClickBankIngest — DW heuristic for downsells', () => {
  it('classifies "DW1" itemNo as DOWNSELL even when lineItemType=UPSELL', () => {
    const p: ClickBankIngestPayload = {
      ...frontend,
      receipt: 'DOWN001',
      lineItems: [{
        ...frontend.lineItems[0],
        lineItemType: 'UPSELL',
        itemNo: 'NeuroMindPro-5-DW1-V1',
      }],
      upsell: { ...frontend.upsell, upsellOriginalReceipt: 'TEST0001', upsellPath: 'b' },
    };
    expect(parseClickBankIngest(p).productType).toBe('DOWNSELL');
  });

  it('classifies "DOWN" itemNo as DOWNSELL', () => {
    const p: ClickBankIngestPayload = {
      ...frontend,
      lineItems: [{ ...frontend.lineItems[0], lineItemType: 'UPSELL', itemNo: 'Some-DOWN-Variant' }],
    };
    expect(parseClickBankIngest(p).productType).toBe('DOWNSELL');
  });

  it('classifies "ds2" itemNo as DOWNSELL', () => {
    const p: ClickBankIngestPayload = {
      ...frontend,
      lineItems: [{ ...frontend.lineItems[0], lineItemType: 'UPSELL', itemNo: 'Foo-ds2-vsX' }],
    };
    expect(parseClickBankIngest(p).productType).toBe('DOWNSELL');
  });

  it('does NOT misclassify "drift" or other DW-substring as DOWNSELL', () => {
    const p: ClickBankIngestPayload = {
      ...frontend,
      lineItems: [{ ...frontend.lineItems[0], lineItemType: 'UPSELL', itemNo: 'DriftCo-Premium' }],
    };
    expect(parseClickBankIngest(p).productType).toBe('UPSELL');
  });

  it('keeps UPSELL when itemNo has no downsell marker', () => {
    const p: ClickBankIngestPayload = {
      ...frontend,
      lineItems: [{ ...frontend.lineItems[0], lineItemType: 'UPSELL', itemNo: 'MaxVitalize-6-UP1-vs2' }],
    };
    expect(parseClickBankIngest(p).productType).toBe('UPSELL');
  });
});
