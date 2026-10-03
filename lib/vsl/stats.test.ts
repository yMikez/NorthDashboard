import { describe, expect, it } from 'vitest';
import { abStats, neededVisits, normalCdf, probabilityBest, wilson } from './stats';

describe('estatística do teste A/B', () => {
  it('Φ e Wilson batem com valores de referência', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 4);
    expect(normalCdf(-1.959964)).toBeCloseTo(0.025, 4);
    const [lo, hi] = wilson(20, 100);
    expect(lo).toBeCloseTo(0.1333, 3);
    expect(hi).toBeCloseTo(0.2888, 3);
    expect(wilson(0, 0)).toEqual([0, 0]);
  });

  it('amostra necessária: 10% de base, +20% relativo ≈ 3.800 visitas por braço', () => {
    const n = neededVisits(0.1, 0.2)!;
    expect(n).toBeGreaterThan(3500);
    expect(n).toBeLessThan(4200);
    expect(neededVisits(0)).toBeNull();
  });

  it('chance de ser a melhor é determinística e soma 1', () => {
    const arms = [{ id: 'a', label: 'A', visits: 1000, conversions: 100 }, { id: 'b', label: 'B', visits: 1000, conversions: 130 }];
    const p1 = probabilityBest(arms);
    const p2 = probabilityBest(arms);
    expect(p1).toEqual(p2);
    expect(p1[0] + p1[1]).toBeCloseTo(1, 6);
    expect(p1[1]).toBeGreaterThan(0.95);
  });

  it('veredito: pouca amostra, vencedor claro, sem diferença e em andamento', () => {
    const small = abStats([{ id: 'a', label: 'A', visits: 80, conversions: 8 }, { id: 'b', label: 'B', visits: 85, conversions: 15 }]);
    expect(small.verdict).toBe('insufficient');
    expect(small.message).toMatch(/Amostra pequena/);

    const lead = abStats([{ id: 'a', label: 'A', visits: 3000, conversions: 300 }, { id: 'b', label: 'B', visits: 3000, conversions: 390 }]);
    expect(lead.verdict).toBe('leader');
    expect(lead.leaderId).toBe('b');
    expect(lead.arms[1].liftVsControl).toBeCloseTo(0.3, 6);
    expect(lead.arms[1].pValueVsControl!).toBeLessThan(0.01);
    expect(lead.message).toMatch(/^B tem .* de chance de ser a melhor \(\+30%/);

    const flat = abStats([{ id: 'a', label: 'A', visits: 9000, conversions: 900 }, { id: 'b', label: 'B', visits: 9000, conversions: 905 }]);
    expect(flat.verdict).toBe('no_difference');

    const mid = abStats([{ id: 'a', label: 'A', visits: 1500, conversions: 150 }, { id: 'b', label: 'B', visits: 1500, conversions: 165 }]);
    expect(mid.verdict).toBe('running');
    expect(mid.arms[0].liftVsControl).toBeNull();
  });

  it('braço com peso 0 aparece mas fica fora do veredito', () => {
    const r = abStats([
      { id: 'a', label: 'A', visits: 5000, conversions: 250, active: true },
      { id: 'b', label: 'B', visits: 5000, conversions: 400, active: true },
      { id: 'c', label: 'C', visits: 4, conversions: 1, active: false },
    ]);
    expect(r.verdict).toBe('leader');
    expect(r.leaderId).toBe('b');
    expect(r.arms[2].probBest).toBe(0);
  });

  it('conversões maiores que visitas e números negativos não quebram', () => {
    const r = abStats([{ id: 'a', label: 'A', visits: 10, conversions: 50 }, { id: 'b', label: 'B', visits: -5, conversions: 2 }]);
    expect(r.arms[0].rate).toBe(1);
    expect(r.arms[1].visits).toBe(0);
  });
});
