import { describe, it, expect } from 'vitest';
import { validateRuleCreate, validateRulePatch, railsError } from './validation';

function val<T>(r: { error: string } | { value: T }): T {
  if ('error' in r) throw new Error(`expected value, got error: ${r.error}`);
  return r.value;
}
function err(r: { error: string } | { value: unknown }): string {
  if ('value' in r) throw new Error('expected error, got value');
  return r.error;
}

describe('validateRuleCreate', () => {
  it('accepts a full valid body', () => {
    const v = val(validateRuleCreate({
      key: '46', keyType: 'id', black2Pct: 50, enabled: true, autotune: false,
      minPct: 10, maxPct: 70, stepPct: 5, targetAov: 220,
    }));
    expect(v).toEqual({
      key: '46', keyType: 'id', black2Pct: 50, enabled: true, autotune: false,
      minPct: 10, maxPct: 70, stepPct: 5, targetAov: 220,
    });
  });

  it('applies defaults for optional fields', () => {
    const v = val(validateRuleCreate({ key: 'Matheus Petersen', keyType: 'name', black2Pct: 0 }));
    expect(v.enabled).toBe(true);
    expect(v.autotune).toBe(false);
    expect(v.minPct).toBe(0);
    expect(v.maxPct).toBe(80);
    expect(v.stepPct).toBe(5);
    expect(v.targetAov).toBeNull();
  });

  it('trims key and rejects empty', () => {
    expect(val(validateRuleCreate({ key: '  46 ', keyType: 'id', black2Pct: 10 })).key).toBe('46');
    expect(err(validateRuleCreate({ key: '   ', keyType: 'id', black2Pct: 10 }))).toMatch(/key/);
  });

  it('rejects bad keyType', () => {
    expect(err(validateRuleCreate({ key: '46', keyType: 'banana', black2Pct: 10 }))).toMatch(/keyType/);
  });

  it('rejects black2Pct out of range / non-numeric', () => {
    expect(err(validateRuleCreate({ key: '46', keyType: 'id', black2Pct: 150 }))).toMatch(/black2Pct/);
    expect(err(validateRuleCreate({ key: '46', keyType: 'id', black2Pct: -1 }))).toMatch(/black2Pct/);
    expect(err(validateRuleCreate({ key: '46', keyType: 'id', black2Pct: 'abc' }))).toMatch(/black2Pct/);
  });

  it('accepts numeric strings for black2Pct', () => {
    expect(val(validateRuleCreate({ key: '46', keyType: 'id', black2Pct: '50' })).black2Pct).toBe(50);
  });

  it('rejects incoherent rails', () => {
    expect(err(validateRuleCreate({ key: '46', keyType: 'id', black2Pct: 10, minPct: 80, maxPct: 20 }))).toMatch(/minPct/);
    expect(err(validateRuleCreate({ key: '46', keyType: 'id', black2Pct: 10, stepPct: 0 }))).toMatch(/stepPct/);
  });

  it('validates targetAov', () => {
    expect(val(validateRuleCreate({ key: '46', keyType: 'id', black2Pct: 10, targetAov: null })).targetAov).toBeNull();
    expect(val(validateRuleCreate({ key: '46', keyType: 'id', black2Pct: 10, targetAov: 199.999 })).targetAov).toBe(200);
    expect(err(validateRuleCreate({ key: '46', keyType: 'id', black2Pct: 10, targetAov: -5 }))).toMatch(/targetAov/);
  });
});

describe('validateRulePatch', () => {
  it('rejects empty patch', () => {
    expect(err(validateRulePatch({}))).toMatch(/nada pra atualizar/);
  });

  it('accepts a single-field patch', () => {
    expect(val(validateRulePatch({ black2Pct: 35 }))).toEqual({ black2Pct: 35 });
  });

  it('does not change key/keyType (ignored)', () => {
    const v = val(validateRulePatch({ key: 'x', keyType: 'name', enabled: false }));
    expect(v).toEqual({ enabled: false });
  });

  it('validates black2Pct range', () => {
    expect(err(validateRulePatch({ black2Pct: 200 }))).toMatch(/black2Pct/);
  });

  it('checks rails only when all three present', () => {
    // minPct alone is fine (route revalidates against existing via railsError)
    expect(val(validateRulePatch({ minPct: 90 }))).toEqual({ minPct: 90 });
    // all three present + incoherent → error
    expect(err(validateRulePatch({ minPct: 90, maxPct: 10, stepPct: 5 }))).toMatch(/minPct/);
  });

  it('clears targetAov with null', () => {
    expect(val(validateRulePatch({ targetAov: null }))).toEqual({ targetAov: null });
  });

  it('coerces boolean-ish enabled/autotune', () => {
    expect(val(validateRulePatch({ enabled: 'false' }))).toEqual({ enabled: false });
    expect(val(validateRulePatch({ autotune: '1' }))).toEqual({ autotune: true });
  });
});

describe('railsError', () => {
  it('flags min>max and bad step', () => {
    expect(railsError(50, 40, 5)).toMatch(/minPct/);
    expect(railsError(0, 80, 0)).toMatch(/stepPct/);
    expect(railsError(0, 80, 5)).toBeNull();
  });
});
