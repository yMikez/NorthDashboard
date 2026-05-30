import { describe, it, expect } from 'vitest';
import { buildRuleSuggestions } from './suggest';

describe('buildRuleSuggestions', () => {
  const affs = [
    { key: 'Matheus Petersen', liftPp: 14, currentPct: 50 },
    { key: '46', liftPp: 20, currentPct: 100 },
    { key: 'LowLift', liftPp: 2, currentPct: 30 },
    { key: 'NoRule', liftPp: 10, currentPct: null },
  ];

  it('no gap → no suggestions', () => {
    const r = buildRuleSuggestions({ easiestLabel: 'Foco em UP3', gap: -5, affiliates: affs, liftThresholdPp: 5 });
    expect(r.rules).toEqual([]);
    expect(r.scenario).toBe('Foco em UP3');
  });

  it('bumps affiliates above lift threshold proportional to lift', () => {
    const r = buildRuleSuggestions({ easiestLabel: 'Foco em UP3', gap: 30, affiliates: affs, liftThresholdPp: 5 });
    const m = r.rules.find((x) => x.key === 'Matheus Petersen')!;
    expect(m).toMatchObject({ currentPct: 50, newPct: 64 }); // +round(14)
  });

  it('caps at 100 and flags already-max', () => {
    const r = buildRuleSuggestions({ easiestLabel: null, gap: 30, affiliates: affs, liftThresholdPp: 5 });
    const at100 = r.rules.find((x) => x.key === '46')!;
    expect(at100).toMatchObject({ currentPct: 100, newPct: 100, reasoning: 'já em max (100%)' });
  });

  it('skips low-lift and ruleless affiliates', () => {
    const r = buildRuleSuggestions({ easiestLabel: null, gap: 30, affiliates: affs, liftThresholdPp: 5 });
    expect(r.rules.find((x) => x.key === 'LowLift')).toBeUndefined();
    expect(r.rules.find((x) => x.key === 'NoRule')).toBeUndefined();
  });

  it('never proposes above 100 even with huge lift', () => {
    const r = buildRuleSuggestions({ easiestLabel: null, gap: 30, affiliates: [{ key: 'X', liftPp: 80, currentPct: 90 }], liftThresholdPp: 5 });
    expect(r.rules[0].newPct).toBe(100);
  });
});
