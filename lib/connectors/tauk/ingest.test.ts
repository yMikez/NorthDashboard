import { describe, it, expect } from 'vitest';
import { parseTaukPayload } from './ingest';

// Payload real capturado no webhook do n8n em 2026-07-06 (query params).
const REAL = {
  'Fulfillment Status': 'HOLD',
  'Purchase Date': '2026-07-06 13:52:41',
  'purchase amount': '207.00',
  'address': '12 Bishop Creek Dr',
  'phone': '7275195441',
  'email': 'dixon.michele@aol.com',
  'lname': 'Dixon',
  'fname': 'Michele R',
};

describe('parseTaukPayload', () => {
  it('parseia o payload real (chaves com espaço/caixa mista)', () => {
    const r = parseTaukPayload(REAL);
    expect(r.email).toBe('dixon.michele@aol.com');
    expect(r.firstName).toBe('Michele R');
    expect(r.lastName).toBe('Dixon');
    expect(r.phone).toBe('7275195441');
    expect(r.address).toBe('12 Bishop Creek Dr');
    expect(r.amountUsd).toBe(207.0);
    expect(r.fulfillmentStatus).toBe('HOLD');
  });

  it('Purchase Date é wall clock Eastern → UTC (julho = EDT, UTC-4)', () => {
    const r = parseTaukPayload(REAL);
    // 2026-07-06 13:52:41 EDT = 17:52:41 UTC
    expect(r.purchasedAt.toISOString()).toBe('2026-07-06T17:52:41.000Z');
  });

  it('externalKey estável (dedup de reenvio) = email|data crua', () => {
    const a = parseTaukPayload(REAL);
    const b = parseTaukPayload({ ...REAL });
    expect(a.externalKey).toBe(b.externalKey);
    expect(a.externalKey).toBe('dixon.michele@aol.com|2026-07-06 13:52:41');
  });

  it('compras distintas do mesmo cliente → chaves distintas (segundo difere)', () => {
    const b = parseTaukPayload({ ...REAL, 'Purchase Date': '2026-07-06 14:10:05' });
    expect(b.externalKey).not.toBe(parseTaukPayload(REAL).externalKey);
  });

  it('valor com símbolo/lixo ainda parseia ("$1,207.50" → 1207.5)', () => {
    const r = parseTaukPayload({ ...REAL, 'purchase amount': '$1,207.50' });
    expect(r.amountUsd).toBe(1207.5);
  });

  it('sem email e sem data → erro (nada pra chavear)', () => {
    expect(() => parseTaukPayload({ fname: 'X', 'purchase amount': '10' })).toThrow();
  });

  it('aliases: Email/PURCHASE_DATE/Amount variantes também casam', () => {
    const r = parseTaukPayload({
      Email: 'a@b.com',
      PURCHASE_DATE: '2026-01-15 08:00:00',
      Amount: '59.90',
      Status: 'SHIPPED',
    });
    expect(r.email).toBe('a@b.com');
    expect(r.amountUsd).toBe(59.9);
    expect(r.fulfillmentStatus).toBe('SHIPPED');
    // janeiro = EST (UTC-5): 08:00 EST = 13:00 UTC
    expect(r.purchasedAt.toISOString()).toBe('2026-01-15T13:00:00.000Z');
  });
});
