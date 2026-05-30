import { describe, it, expect } from 'vitest';
import {
  decideLayer,
  resolvePct,
  isValidEmail,
  isCopyLayer,
  type CopyRule,
} from './decision';

const rule = (over: Partial<CopyRule> = {}): CopyRule => ({
  key: '46',
  keyType: 'id',
  black2Pct: 100,
  enabled: true,
  ...over,
});

// 'A9UZ4VNM' → bucket 75 (ver bucket.test.ts). Usado pros testes de boundary.
const OID_75 = 'A9UZ4VNM';
// 'A9UZ57CW' → bucket 0. Qualquer pct>0 qualifica.
const OID_0 = 'A9UZ57CW';

describe('isValidEmail', () => {
  it('accepts a normal email', () => {
    expect(isValidEmail('lindance48@yahoo.com')).toBe(true);
  });
  it('rejects empty / null / malformed', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail(null)).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
    expect(isValidEmail('no-at-sign')).toBe(false);
    expect(isValidEmail('foo@bar')).toBe(false);
    expect(isValidEmail('foo @bar.com')).toBe(false);
  });
});

describe('isCopyLayer', () => {
  it('validates known layers', () => {
    expect(isCopyLayer('black2')).toBe(true);
    expect(isCopyLayer('black1')).toBe(true);
    expect(isCopyLayer('white')).toBe(true);
    expect(isCopyLayer('loading')).toBe(true);
    expect(isCopyLayer('green3')).toBe(false);
  });
});

describe('resolvePct', () => {
  it('matches by aff_id', () => {
    expect(resolvePct([rule({ key: '46' })], '46', 'Matheus')).toBe(100);
  });
  it('matches by aff_name', () => {
    expect(resolvePct([rule({ key: 'Matheus Petersen', keyType: 'name' })], '46', 'Matheus Petersen')).toBe(100);
  });
  it('no match → 0', () => {
    expect(resolvePct([rule({ key: '999' })], '46', 'Matheus')).toBe(0);
  });
  it('ignores disabled rules', () => {
    expect(resolvePct([rule({ key: '46', enabled: false })], '46', null)).toBe(0);
  });
  it('most-inclusive wins (max across id+name matches)', () => {
    const rules = [
      rule({ key: '46', keyType: 'id', black2Pct: 50 }),
      rule({ key: 'Matheus', keyType: 'name', black2Pct: 80 }),
    ];
    expect(resolvePct(rules, '46', 'Matheus')).toBe(80);
  });
  it('clamps out-of-range pct', () => {
    expect(resolvePct([rule({ black2Pct: 250 })], '46', null)).toBe(100);
    expect(resolvePct([rule({ black2Pct: -10 })], '46', null)).toBe(0);
  });
});

describe('decideLayer', () => {
  it('no matching rule → black1, bucket null, pct 0', () => {
    const d = decideLayer({ orderIdGlobal: OID_0, affId: '999', affName: null, emailValid: true, rules: [rule()] });
    expect(d).toEqual({ layer: 'black1', bucket: null, pctApplied: 0 });
  });

  it('matched pct>0 but email invalid → black1, bucket null', () => {
    const d = decideLayer({ orderIdGlobal: OID_0, affId: '46', affName: null, emailValid: false, rules: [rule()] });
    expect(d.layer).toBe('black1');
    expect(d.bucket).toBeNull();
    expect(d.pctApplied).toBe(100);
  });

  it('pct=100 + valid email → black2', () => {
    const d = decideLayer({ orderIdGlobal: OID_0, affId: '46', affName: null, emailValid: true, rules: [rule({ black2Pct: 100 })] });
    expect(d.layer).toBe('black2');
    expect(d.bucket).toBe(0);
    expect(d.pctApplied).toBe(100);
  });

  it('pct=0 explicit rule → black1', () => {
    const d = decideLayer({ orderIdGlobal: OID_0, affId: '46', affName: null, emailValid: true, rules: [rule({ black2Pct: 0 })] });
    expect(d.layer).toBe('black1');
    expect(d.bucket).toBeNull();
  });

  it('boundary: bucket 75 — pct=75 → black1 (75 < 75 false)', () => {
    const d = decideLayer({ orderIdGlobal: OID_75, affId: '46', affName: null, emailValid: true, rules: [rule({ black2Pct: 75 })] });
    expect(d.bucket).toBe(75);
    expect(d.layer).toBe('black1');
  });

  it('boundary: bucket 75 — pct=76 → black2 (75 < 76 true)', () => {
    const d = decideLayer({ orderIdGlobal: OID_75, affId: '46', affName: null, emailValid: true, rules: [rule({ black2Pct: 76 })] });
    expect(d.bucket).toBe(75);
    expect(d.layer).toBe('black2');
  });

  it('honors a custom defaultLayer for non-qualifying leads', () => {
    const d = decideLayer({ orderIdGlobal: OID_75, affId: '46', affName: null, emailValid: true, rules: [rule({ black2Pct: 10 })], defaultLayer: 'white' });
    expect(d.layer).toBe('white');
  });

  it('is sticky: same input → same decision', () => {
    const args = { orderIdGlobal: OID_75, affId: '46', affName: null, emailValid: true, rules: [rule({ black2Pct: 76 })] };
    expect(decideLayer({ ...args }).layer).toBe(decideLayer({ ...args }).layer);
  });

  it('disabled matching rule → treated as no rule (black1)', () => {
    const d = decideLayer({ orderIdGlobal: OID_0, affId: '46', affName: null, emailValid: true, rules: [rule({ enabled: false })] });
    expect(d.layer).toBe('black1');
    expect(d.pctApplied).toBe(0);
  });
});
