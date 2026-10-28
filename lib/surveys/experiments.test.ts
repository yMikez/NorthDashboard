import { describe, expect, it } from 'vitest';
import { armConfig, configDiff, pickArm, proportionTest, sanitizeArms, type ExperimentArm } from './experiments';
import type { SurveyVariantConfig } from './fimTratamento';
import { sanitizeVariantConfig } from './variantConfig';

const BASE = sanitizeVariantConfig({
  productName: 'NeuroRecall',
  eligibleBottles: [2, 3],
  fullPlanFrom: 6,
  frontPrices: { 2: 158, 6: 294 },
  offers: {
    assinatura: { url: 'https://vupim.com/c/1', monthlyPrice: 69 },
    kits: { 6: { url: 'https://vupim.com/c/6', price: 234, everyMonths: 6 } },
  },
  coupons: [{ pct: 10, code: 'KEEP10' }],
});
if (!BASE.ok) throw new Error(BASE.error);
const base: SurveyVariantConfig = BASE.config;
const withB = (patch: Partial<SurveyVariantConfig>): SurveyVariantConfig => ({ ...structuredClone(base), ...patch });

describe('versões do teste', () => {
  it('a 1ª é o controle (sem config); as outras precisam de config válida', () => {
    const res = sanitizeArms([{ weight: 50 }, { name: 'Assinatura 59', weight: 50, config: withB({}) }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.arms.map((a) => [a.key, a.name, a.weight, Boolean(a.config)])).toEqual([
      ['A', 'Atual', 50, false], ['B', 'Assinatura 59', 50, true],
    ]);
  });

  it('recusa menos de 2 ou mais de 4 versões, peso fora de 1–100 e config quebrada', () => {
    expect(sanitizeArms([{}]).ok).toBe(false);
    expect(sanitizeArms([{}, {}, {}, {}, {}]).ok).toBe(false);
    expect(sanitizeArms([{ weight: 0 }, { config: base }])).toMatchObject({ ok: false });
    const bad = sanitizeArms([{}, { config: { ...base, offers: { kits: { 6: { url: 'http://x', price: 1 } } } } }]);
    expect(bad).toEqual({ ok: false, error: expect.stringMatching(/^Versão B: .*https/) });
  });

  it('público e rastreio vêm sempre da pesquisa, não da versão', () => {
    const arm: ExperimentArm = { key: 'B', name: 'B', weight: 1, config: withB({ eligibleBottles: [1], fullPlanFrom: null, trackingParam: 'x' }) };
    const cfg = armConfig(base, arm);
    expect(cfg.eligibleBottles).toEqual([2, 3]);
    expect(cfg.fullPlanFrom).toBe(6);
    expect(cfg.trackingParam).toBe('src');
    expect(armConfig(base, { key: 'A', name: 'A', weight: 1 })).toBe(base);
  });
});

describe('sorteio', () => {
  const arms: ExperimentArm[] = [{ key: 'A', name: 'A', weight: 50 }, { key: 'B', name: 'B', weight: 50 }];

  it('o mesmo convite cai sempre na mesma versão', () => {
    expect(pickArm(arms, 'exp1:inv1')).toBe(pickArm(arms, 'exp1:inv1'));
  });

  it('respeita os pesos', () => {
    const share = (w: ExperimentArm[]) => {
      let b = 0;
      for (let i = 0; i < 4000; i++) if (pickArm(w, `e:${i}`) === 'B') b++;
      return b / 4000;
    };
    expect(share(arms)).toBeGreaterThan(0.46);
    expect(share(arms)).toBeLessThan(0.54);
    const skew = share([{ key: 'A', name: 'A', weight: 80 }, { key: 'B', name: 'B', weight: 20 }]);
    expect(skew).toBeGreaterThan(0.17);
    expect(skew).toBeLessThan(0.23);
  });
});

describe('o que muda entre as versões', () => {
  it('nada mudou = lista vazia', () => {
    expect(configDiff(base, structuredClone(base))).toEqual([]);
  });

  it('preço, cupom e texto aparecem legíveis', () => {
    const b = withB({
      offers: { ...base.offers, assinatura: { ...base.offers!.assinatura!, monthlyPrice: 59, firstPrice: 59 } },
      coupons: [{ pct: 15, code: 'KEEP15' }],
      copy: { 'end.oferta.title': 'New title' },
    });
    expect(configDiff(base, b)).toEqual([
      'Assinatura: US$ 69 → US$ 59 por mês',
      'Assinatura, 1ª cobrança: US$ 69 → US$ 59',
      'Cupons: 10% → 15%',
      'Texto: end.oferta.title',
    ]);
  });

  it('texto reescrito igual ao padrão não conta como mudança', () => {
    expect(configDiff(base, withB({ copy: { 'nav.back': 'Back' } }))).toEqual([]);
  });
});

describe('estatística', () => {
  it('sem gente = nada a dizer', () => {
    expect(proportionTest(0, 0, 1, 10)).toBeNull();
  });

  it('taxas iguais = confiança zero', () => {
    expect(proportionTest(10, 100, 10, 100)).toEqual({ lift: 0, confidence: 0 });
  });

  it('10% contra 25% com 100 em cada lado passa de 95%', () => {
    const t = proportionTest(10, 100, 25, 100)!;
    expect(t.lift).toBeCloseTo(1.5);
    expect(t.confidence).toBeGreaterThan(0.99);
    expect(t.confidence).toBeLessThan(1);
  });

  it('diferença pequena com pouca gente fica longe de 95%', () => {
    expect(proportionTest(3, 40, 5, 40)!.confidence).toBeLessThan(0.6);
  });

  it('controle zerado: sem lift, mas a confiança existe', () => {
    const t = proportionTest(0, 50, 6, 50)!;
    expect(t.lift).toBeNull();
    expect(t.confidence).toBeGreaterThan(0.95);
  });
});
