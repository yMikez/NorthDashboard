import { describe, it, expect } from 'vitest';
import {
  decideAutotune,
  DEFAULT_AUTOTUNE_CONFIG,
  type AutotuneRuleSnapshot,
  type AutotuneMetrics,
  type DecideAutotuneInput,
} from './autotune';

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

const rule = (over: Partial<AutotuneRuleSnapshot> = {}): AutotuneRuleSnapshot => ({
  black2Pct: 50, minPct: 0, maxPct: 80, stepPct: 5, targetAov: null, ...over,
});

const metrics = (over: Partial<AutotuneMetrics> = {}): AutotuneMetrics => ({
  n_b1: 40, n_b2: 40, conv_b1: 0.20, conv_b2: 0.30, aov_observed: 200, ...over,
});

function decide(over: Partial<DecideAutotuneInput> = {}) {
  return decideAutotune({
    rule: rule(),
    config: DEFAULT_AUTOTUNE_CONFIG,
    metrics: metrics(),
    lastChangeAt: null,
    now: NOW,
    ...over,
  });
}

describe('decideAutotune', () => {
  it('cooldown: skips if last change < cooldownH ago', () => {
    const d = decide({ lastChangeAt: NOW - 1 * HOUR });
    expect(d).toMatchObject({ changed: false, reason: 'cooldown', pctAfter: 50 });
  });

  it('past cooldown: acts normally', () => {
    const d = decide({ lastChangeAt: NOW - 13 * HOUR });
    expect(d.reason).toBe('aov_gap_up');
    expect(d.changed).toBe(true);
  });

  it('no_sample: skips if either variant under minSample', () => {
    expect(decide({ metrics: metrics({ n_b1: 10 }) }).reason).toBe('no_sample');
    expect(decide({ metrics: metrics({ n_b2: 29 }) }).reason).toBe('no_sample');
  });

  it('aov_gap_up: gap>0 and lift>=threshold → +stepPct', () => {
    const d = decide(); // gap = 220-200 = 20 > 0; lift = 10pp >= 5
    expect(d).toMatchObject({ changed: true, reason: 'aov_gap_up', pctBefore: 50, pctAfter: 55 });
    expect(d.metrics.lift_pp).toBeCloseTo(10, 6);
    expect(d.metrics.aov_gap).toBeCloseTo(20, 6);
  });

  it('cap_hit up: already at maxPct → hold', () => {
    const d = decide({ rule: rule({ black2Pct: 80 }) });
    expect(d).toMatchObject({ changed: false, reason: 'cap_hit', pctAfter: 80 });
  });

  it('clamps the up-step to maxPct', () => {
    const d = decide({ rule: rule({ black2Pct: 78, maxPct: 80 }) });
    expect(d).toMatchObject({ changed: true, reason: 'aov_gap_up', pctAfter: 80 });
  });

  it('adverse_lift_down: lift<=adverseThreshold → -stepPct', () => {
    const d = decide({ metrics: metrics({ conv_b1: 0.30, conv_b2: 0.20 }) }); // lift -10
    expect(d).toMatchObject({ changed: true, reason: 'adverse_lift_down', pctBefore: 50, pctAfter: 45 });
  });

  it('cap_hit down: already at minPct → hold', () => {
    const d = decide({ rule: rule({ black2Pct: 0 }), metrics: metrics({ conv_b1: 0.30, conv_b2: 0.20 }) });
    expect(d).toMatchObject({ changed: false, reason: 'cap_hit', pctAfter: 0 });
  });

  it('hold: positive gap but lift below threshold (neutral)', () => {
    const d = decide({ metrics: metrics({ conv_b1: 0.20, conv_b2: 0.22 }) }); // lift 2pp, gap 20
    expect(d).toMatchObject({ changed: false, reason: 'hold' });
  });

  it('hold: AOV already at/above target (gap<=0), no adverse lift', () => {
    const d = decide({ metrics: metrics({ aov_observed: 250 }) }); // gap -30, lift +10
    expect(d.reason).toBe('hold');
  });

  it('per-rule targetAov overrides global (flips hold→up)', () => {
    // global target 220 → gap -30 → hold. rule target 300 → gap +50 → up.
    const m = metrics({ aov_observed: 250 });
    expect(decide({ metrics: m }).reason).toBe('hold');
    expect(decide({ rule: rule({ targetAov: 300 }), metrics: m }).reason).toBe('aov_gap_up');
  });
});
