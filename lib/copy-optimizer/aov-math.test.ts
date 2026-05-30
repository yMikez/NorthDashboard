import { describe, it, expect } from 'vitest';
import { aovFromConvs, buildScenarios, computeAov, type AovInputs } from './aov-math';

// Golden vectors gerados rodando as funções ORIGINAIS de calculadoraAOV.html
// em node. Travam a paridade: se o porte divergir do .html, quebra aqui.
const DEFAULTS: AovInputs = {
  front: 220, orders: 1000, target: 340,
  up: [
    { name: 'UP1', price: 147, floor: 0.20 },
    { name: 'UP2', price: 197, floor: 0.15 },
    { name: 'UP3', price: 297, floor: 0.10 },
  ],
};

const BRIEF: AovInputs = {
  front: 220, orders: 1247, target: 280,
  up: [
    { name: 'UP1', price: 147, floor: 0.24 },
    { name: 'UP2', price: 197, floor: 0.17 },
    { name: 'UP3', price: 297, floor: 0.13 },
  ],
};

function byLabel(d: AovInputs) {
  const map = new Map(buildScenarios(d).map((s) => [s.label, s]));
  return (label: string) => map.get(label)!;
}

describe('aovFromConvs', () => {
  it('matches the model AOV = front + Σ conv*price', () => {
    expect(aovFromConvs(DEFAULTS, [0.20, 0.15, 0.10])).toBeCloseTo(308.65, 6);
    expect(aovFromConvs(DEFAULTS, [0, 0, 0])).toBe(220);
  });
});

describe('buildScenarios — parity with calculadoraAOV.html (DEFAULTS, target 340)', () => {
  const s = byLabel(DEFAULTS);

  it('Foco em UP1', () => {
    const x = s('Foco em UP1');
    expect(x.convs.map((c) => +c.toFixed(6))).toEqual([0.413265, 0.15, 0.1]);
    expect(x.reqConv).toBeCloseTo(0.413265, 5);
    expect(x.aov).toBeCloseTo(340, 6);
    expect(x.effort).toBeCloseTo(0.213265, 5);
    expect(x.status).toBe('ok');
    expect(x.feasible).toBe(true);
  });

  it('Foco em UP3 is the easiest feasible (lowest effort)', () => {
    const x = s('Foco em UP3');
    expect(x.effort).toBeCloseTo(0.105556, 5);
    expect(x.convs[2]).toBeCloseTo(0.205556, 5);
    expect(x.status).toBe('ok');
  });

  it('Foco em UP2 + UP3 lift', () => {
    const x = s('Foco em UP2 + UP3');
    expect(x.reqConv).toBeCloseTo(0.063462, 5); // lift
    expect(x.convs.map((c) => +c.toFixed(6))).toEqual([0.2, 0.213462, 0.163462]);
    expect(x.aov).toBeCloseTo(340, 6);
  });

  it('Distribuído lift across all three', () => {
    const x = s('Distribuído (UP1 + UP2 + UP3)');
    expect(x.reqConv).toBeCloseTo(0.048908, 5);
    expect(x.convs.map((c) => +c.toFixed(6))).toEqual([0.248908, 0.198908, 0.148908]);
  });

  it('all five scenarios hit the target AOV exactly', () => {
    for (const sc of buildScenarios(DEFAULTS)) expect(sc.aov).toBeCloseTo(340, 6);
  });
});

describe('computeAov', () => {
  it('DEFAULTS: baseline, gap, easiest = Foco em UP3', () => {
    const r = computeAov(DEFAULTS);
    expect(r.baselineAov).toBeCloseTo(308.65, 6);
    expect(r.gap).toBeCloseTo(31.35, 6);
    expect(r.easiestLabel).toBe('Foco em UP3');
  });

  it('BRIEF: baseline already above target → all scenarios "below", no easiest', () => {
    const r = computeAov(BRIEF);
    expect(r.baselineAov).toBeCloseTo(327.38, 6);
    expect(r.gap).toBeCloseTo(-47.38, 6);
    expect(r.scenarios.every((sc) => sc.status === 'below')).toBe(true);
    expect(r.scenarios.every((sc) => !sc.feasible)).toBe(true);
    expect(r.easiestLabel).toBeNull();
  });

  it('flags "over" when a stage would need >100% conversion', () => {
    const over: AovInputs = {
      front: 200, orders: 100, target: 500,
      up: [
        { name: 'UP1', price: 100, floor: 0.10 },
        { name: 'UP2', price: 100, floor: 0.10 },
        { name: 'UP3', price: 100, floor: 0.10 },
      ],
    };
    const up1 = computeAov(over).scenarios.find((sc) => sc.label === 'Foco em UP1')!;
    expect(up1.reqConv).toBeCloseTo(2.8, 6);
    expect(up1.status).toBe('over');
    expect(up1.feasible).toBe(false);
  });
});
