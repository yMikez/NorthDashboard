import { describe, expect, it } from 'vitest';
import { percentile, summarizeResults, wilson, type EvalRecord } from './summary';

const rec = (caseId: string, status: EvalRecord['status'], extra: Partial<EvalRecord> = {}): EvalRecord => ({
  caseId,
  category: caseId.startsWith('L') ? 'lente' : 'numero',
  rep: 0,
  status,
  score: status === 'pass' ? 1 : 0.5,
  checks: [],
  costUsd: 0.1,
  latencyMs: 1_000,
  rounds: 2,
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 800,
  cacheWriteTokens: 100,
  faithfulness: 1,
  firstFactAt: 10,
  ...extra,
});

describe('wilson / percentile', () => {
  it('intervalo de Wilson conhecido (8/10)', () => {
    expect(wilson(8, 10)).toEqual([0.49, 0.943]);
    expect(wilson(0, 0)).toBeNull();
    const [lo, hi] = wilson(0, 5)!;
    expect(lo).toBe(0);
    expect(hi).toBeGreaterThan(0.4);
  });

  it('percentil com interpolação linear', () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([10], 0.95)).toBe(10);
    expect(percentile([], 0.5)).toBeNull();
  });
});

describe('summarizeResults', () => {
  it('taxa só sobre avaliadas; erro/inconclusivo contados à parte; flaky detectado', () => {
    const s = summarizeResults([
      rec('N1', 'pass'),
      rec('N1', 'fail', { rep: 1, checks: [{ id: 'fact:x', status: 'fail', critical: true }] }),
      rec('L1', 'partial', { checks: [{ id: 'fact:y', status: 'lens_mismatch', critical: false }, { id: 'unit', status: 'pass', critical: true }] }),
      rec('N2', 'error', { costUsd: 0, latencyMs: 99_000, error: 'API 529' }),
      rec('N3', 'inconclusive'),
    ]);
    expect(s.results).toBe(5);
    expect(s.passRate.n).toBe(3);
    expect(s.passRate.rate).toBeCloseTo(1 / 3, 3);
    expect(s.acceptableRate.rate).toBeCloseTo(2 / 3, 3);
    expect(s.statusCounts).toMatchObject({ pass: 1, fail: 1, partial: 1, error: 1, inconclusive: 1 });
    expect(s.flaky).toEqual(['N1']);
    expect(s.lensMismatchRate).toBe(0.5);
    expect(s.unitFailRate).toBe(0);
    expect(s.byCategory.lente).toMatchObject({ n: 1, pass: 0, partial: 1 });
    expect(s.costUsd).toBeCloseTo(0.4, 6);
    expect(s.costPerPass).toBeCloseTo(0.4, 6);
    // erro de infra não entra na latência
    expect(s.latencyP95).toBe(1_000);
    expect(s.cacheHitRatio).toBeCloseTo(4_000 / 5_000, 3);
    expect(s.failures.find((f) => f.caseId === 'N2')?.failed).toEqual(['API 529']);
  });
});
