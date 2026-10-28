import { describe, expect, it } from 'vitest';
import { decideOutcome, plansOf, surveyVars, type SurveyVariantConfig } from './fimTratamento';
import { renderSurveyPage } from './render';
import { sanitizeVariantConfig } from './variantConfig';
import { catalogNameKey, parseCatalog } from '../services/northAffiliatesCatalog';

// Ofertas criadas na Vupim em 2026-10-28 (todas recorrentes).
const NR: SurveyVariantConfig = {
  productName: 'NeuroRecall',
  eligibleBottles: [2, 3],
  fullPlanFrom: 6,
  frontPrices: { 2: 158, 3: 207, 6: 294 },
  offers: {
    assinatura: { url: 'https://vupim.com/c/1', firstPrice: 49, monthlyPrice: 49 },
    kits: {
      2: { url: 'https://vupim.com/c/2', price: 138, everyMonths: 2 },
      3: { url: 'https://vupim.com/c/3', price: 192, everyMonths: 3 },
      4: { url: 'https://vupim.com/c/4', price: 207, everyMonths: 4 },
      6: { url: 'https://vupim.com/c/6', price: 234, everyMonths: 6 },
    },
  },
  coupons: [{ pct: 10, code: null }, { pct: 15, code: null }, { pct: 20, code: null }],
};

describe('planos e cobrança recorrente', () => {
  it('lista todos os planos com link, do menor pro maior, e marca o melhor preço por frasco', () => {
    const plans = plansOf(NR);
    expect(plans.map((p) => p.bottles)).toEqual([1, 2, 3, 4, 6]);
    expect(plans.filter((p) => p.best).map((p) => p.bottles)).toEqual([6]);
    expect(plans.find((p) => p.bottles === 4)?.perBottle).toBe(51.75);
  });

  it('assinatura sem 1ª cobrança diferente não promete "first month"', () => {
    const v = surveyVars(NR, { firstName: 'John', bottles: 3 });
    expect(v.assinatura_frase).toBe("It's just $49 a month. Skip or cancel anytime.");
    expect(v.assinatura_curto).toBe('$49 each');
    expect(v.cobranca_kit).toBe('every 3 months');
  });

  it('a página diz a cobrança recorrente sob o botão e mostra todos os planos', () => {
    const html = renderSurveyPage({
      cfg: NR, ctx: { firstName: 'John', bottles: 2 }, slug: 'neurorecall', token: 'tok', preview: false,
      answers: {}, outcome: null, couponPct: null, followUp: false,
    });
    expect(html).toContain('4 bottles delivered and billed every 4 months, $207 each time. Skip or cancel anytime.');
    expect(html).toContain('1 bottle delivered and billed every month.');
    expect(html).toContain('See all plans');
    expect(html).toContain('/api/survey/go?t=tok&amp;o=kit&amp;n=6');
    expect(html).toContain('Best value');
    expect(html).not.toContain('first month');
  });

  it('sem cupom, quem não consegue pagar tudo de uma vez recebe a assinatura', () => {
    const av = { assinatura: true, kit: true, cupons: [] };
    expect(decideOutcome({ q1: 'dinheiro', q2: 4 }, av).outcome).toBe('recorrencia');
    expect(decideOutcome({ q2: 4, q3: 'parou', q3b: 'orcamento' }, av).outcome).toBe('recorrencia');
    expect(decideOutcome({ q2: 4, q5: ['desconto'] }, av).outcome).toBe('oferta');
  });
});

describe('sanitizeVariantConfig — o formulário do dash', () => {
  const base = {
    productName: 'NeuroRecall', accent: '#136e94', image: '/survey-assets/neurorecall.webp',
    eligibleBottles: ['3', 2, 2], fullPlanFrom: '6',
    frontPrices: { 6: '294' },
    offers: {
      assinatura: { url: 'https://vupim.com/c/1', monthlyPrice: '49', firstPrice: '' },
      kits: { 4: { url: 'https://vupim.com/c/4', price: '207', everyMonths: '4' }, 6: { url: '', price: 234, everyMonths: '' } },
    },
    coupons: [{ pct: '15', code: 'keep15' }],
    copy: { 'end.oferta.title@completo': 'Keep going' },
    lixo: 'descartado',
  };

  it('normaliza números, ordena frascos, 1ª cobrança vazia = preço do mês, descarta campo desconhecido', () => {
    const r = sanitizeVariantConfig(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.eligibleBottles).toEqual([2, 3]);
    expect(r.config.fullPlanFrom).toBe(6);
    expect(r.config.offers?.assinatura).toEqual({ url: 'https://vupim.com/c/1', monthlyPrice: 49, firstPrice: 49 });
    expect(r.config.offers?.kits?.['4']).toEqual({ url: 'https://vupim.com/c/4', price: 207, everyMonths: 4 });
    expect(r.config.offers?.kits?.['6']).toEqual({ url: null, price: 234, everyMonths: null });
    expect(r.config.coupons).toEqual([{ pct: 15, code: 'keep15' }]);
    expect(r.config.copy).toEqual({ 'end.oferta.title@completo': 'Keep going' });
    expect('lixo' in r.config).toBe(false);
  });

  it('recusa link sem https, preço zerado, frase com chave que não existe e cupom repetido', () => {
    const bad = (patch: Record<string, unknown>) => sanitizeVariantConfig({ ...base, ...patch });
    expect(bad({ offers: { kits: { 3: { url: 'http://x.com', price: 10 } } } })).toEqual({ ok: false, error: 'Link do kit de 3: o link precisa começar com https://' });
    expect(bad({ offers: { kits: { 3: { url: 'https://x.com', price: 0 } } } }).ok).toBe(false);
    expect(bad({ copy: { 'nao.existe': 'x' } })).toEqual({ ok: false, error: 'Texto: a chave "nao.existe" não existe' });
    expect(bad({ coupons: [{ pct: 10, code: 'A' }, { pct: 10, code: 'B' }] }).ok).toBe(false);
    expect(bad({ productName: '' })).toEqual({ ok: false, error: 'Nome do produto: obrigatório' });
    expect(bad({ image: 'https://site/x.png' }).ok).toBe(false);
  });
});

describe('catálogo do NorthAffiliates', () => {
  it('lê produtos, mockups dos kits e conta materiais por tipo', () => {
    const r = parseCatalog({
      generatedAt: '2026-10-28T15:00:00.000Z',
      products: [
        {
          id: 'p1', name: 'Neuro Mind Pro', niche: 'Memória', release: { status: 'active' },
          image: { url: 'https://cdn/x', downloadUrl: 'https://cdn/x?dl=1' },
          kits: [{ packSize: 6, url: 'https://cdn/6' }, { packSize: 2, url: 'https://cdn/2' }],
          offers: [{ materials: [{ type: 'VSL' }, { type: 'VTURB' }, { type: 'VSL' }] }],
        },
        { id: '', name: 'sem id' },
      ],
    }, 'TESTE');
    expect(r.network).toBe('TESTE');
    expect(r.products).toHaveLength(1);
    expect(r.products[0]).toMatchObject({
      name: 'Neuro Mind Pro', status: 'active', image: 'https://cdn/x?dl=1', offers: 1, materials: { VSL: 2, VTURB: 1 },
    });
    expect(r.products[0].kits.map((k) => k.packSize)).toEqual([2, 6]);
  });

  it('casa o nome do produto ignorando espaço e caixa', () => {
    expect(catalogNameKey('Neuro Mind Pro')).toBe(catalogNameKey('NeuroMind Pro'));
  });
});
