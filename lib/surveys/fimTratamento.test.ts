import { describe, expect, it } from 'vitest';
import {
  availableOffers, checkoutUrl, cleanAnswer, couponTier, couponVars, decideOutcome, fillText, firstNameOf,
  kitSizeFor, questionOrder, regularPerBottle, segmentOf, surveyVars,
  type Availability, type SurveyVariantConfig,
} from './fimTratamento';
import { endSectionId, renderSurveyInvalid, renderSurveyPage } from './render';

// Proposta de preços do NeuroRecall (front Vupim: 2 = $158, 3 = $207, 6 = $294).
const CFG: SurveyVariantConfig = {
  productName: 'NeuroRecall',
  image: '/survey-assets/neurorecall.webp',
  eligibleBottles: [2, 3],
  fullPlanFrom: 6,
  trackingParam: 'src',
  frontPrices: { 2: 158, 3: 207, 6: 294 },
  offers: {
    assinatura: { url: 'https://pay.vupim.com/sub', firstPrice: 39, monthlyPrice: 49 },
    kits: {
      3: { url: 'https://pay.vupim.com/k3', price: 177 },
      4: { url: 'https://pay.vupim.com/k4?x=1', price: 216 },
      6: { url: 'https://pay.vupim.com/k6', price: 264 },
    },
  },
  coupons: [{ pct: 10, code: 'KEEP10' }, { pct: 15, code: 'KEEP15' }, { pct: 20, code: 'KEEP20', kits: { 6: 'https://pay.vupim.com/k6-20' } }],
  couponValidDays: 7,
  q4: [{ id: 'nomes', label: 'Remembering names and words more easily' }],
};

const ALL: Availability = { assinatura: true, kit: true, cupons: [10, 15, 20] };

describe('públicos e kit oferecido', () => {
  it('2–3 frascos = plano incompleto; 6+ = plano completo', () => {
    expect(segmentOf(CFG, 2)).toBe('parcial');
    expect(segmentOf(CFG, 3)).toBe('parcial');
    expect(segmentOf(CFG, 6)).toBe('completo');
    expect(segmentOf(CFG, 18)).toBe('completo');
    expect(segmentOf({ ...CFG, fullPlanFrom: null }, 6)).toBe('parcial');
  });

  it('o público completo pula a pergunta 1 (por que não levou 6)', () => {
    expect(questionOrder('parcial')).toEqual(['q1', 'q2', 'q3', 'q4', 'q5']);
    expect(questionOrder('completo')).toEqual(['q2', 'q3', 'q4', 'q5']);
  });

  it('kit completa o plano (2 → 4, 3 → 3); quem levou 6+ recebe o kit de 6', () => {
    expect(kitSizeFor(CFG, 'parcial', 2)).toBe(4);
    expect(kitSizeFor(CFG, 'parcial', 3)).toBe(3);
    expect(kitSizeFor(CFG, 'completo', 6)).toBe(6);
    // Sem o kit de 4, o mais perto.
    const sem4 = { ...CFG, offers: { ...CFG.offers, kits: { 3: CFG.offers!.kits![3], 6: CFG.offers!.kits![6] } } };
    expect(kitSizeFor(sem4, 'parcial', 2)).toBe(3);
  });

  it('preço normal por frasco vem do kit do front do mesmo tamanho (ou o maior abaixo)', () => {
    expect(regularPerBottle(CFG, 3)).toBe(69);
    expect(regularPerBottle(CFG, 4)).toBe(69);
    expect(regularPerBottle(CFG, 6)).toBe(49);
  });
});

describe('couponTier — quanto mais perto de desistir, maior o cupom', () => {
  it('20%: nota 2, "não vou continuar", parou por orçamento/sem diferença/outro', () => {
    expect(couponTier({ q2: 2 })).toBe(20);
    expect(couponTier({ q2: 4, q5: ['nao_continuar'] })).toBe(20);
    expect(couponTier({ q2: 4, q3: 'parou', q3b: 'sem_diferenca' })).toBe(20);
  });
  it('15%: objeção de dinheiro', () => {
    expect(couponTier({ q2: 4, q5: ['desconto'] })).toBe(15);
    expect(couponTier({ q1: 'dinheiro', q2: 5 })).toBe(15);
  });
  it('10%: hesitante', () => {
    expect(couponTier({ q2: 4, q5: ['progresso'] })).toBe(10);
    expect(couponTier({ q2: 4, q4: ['cedo'] })).toBe(10);
  });
  it('sem objeção: sem cupom', () => {
    expect(couponTier({ q1: 'testar', q2: 5, q3: 'todo_dia', q4: ['nomes'] })).toBe(0);
  });
});

describe('decideOutcome — sempre vende, menos nota 1, médico e mal-estar', () => {
  it('nota 1 vai pro CS sem oferta; nota 2 recebe o cupom de 20%', () => {
    expect(decideOutcome({ q2: 1, q5: ['mensal'] }, ALL)).toMatchObject({ outcome: 'cs', csReason: 'nota_minima', couponPct: null });
    expect(decideOutcome({ q2: 2 }, ALL)).toMatchObject({ outcome: 'cupom', couponPct: 20 });
  });

  it('parou por médico ou mal-estar vai pro CS sem oferta', () => {
    expect(decideOutcome({ q2: 5, q3: 'parou', q3b: 'medico' }, ALL)).toMatchObject({ outcome: 'cs', csReason: 'parou_medico' });
    expect(decideOutcome({ q2: 5, q3: 'parou', q3b: 'mal_estar' }, ALL)).toMatchObject({ outcome: 'cs', csReason: 'parou_mal_estar' });
  });

  it('"1 frasco por mês" ganha a assinatura, mesmo pedindo desconto', () => {
    expect(decideOutcome({ q2: 4, q5: ['mensal', 'desconto'] }, ALL).outcome).toBe('recorrencia');
  });

  it('objeção vira cupom na faixa certa; sem objeção, o kit no preço de recompra', () => {
    expect(decideOutcome({ q2: 4, q5: ['desconto'] }, ALL)).toMatchObject({ outcome: 'cupom', couponPct: 15 });
    expect(decideOutcome({ q2: 5, q3: 'todo_dia', q4: ['nomes'] }, ALL)).toMatchObject({ outcome: 'oferta', couponPct: null });
  });

  it('faixa não configurada usa a maior abaixo (ou a menor que existir)', () => {
    expect(decideOutcome({ q2: 2 }, { ...ALL, cupons: [10, 15] }).couponPct).toBe(15);
    expect(decideOutcome({ q2: 4, q5: ['progresso'] }, { ...ALL, cupons: [15] }).couponPct).toBe(15);
  });

  it('sem cupom cai no kit; sem kit na assinatura; sem nada agradece', () => {
    expect(decideOutcome({ q2: 2 }, { assinatura: true, kit: true, cupons: [] }).outcome).toBe('oferta');
    expect(decideOutcome({ q2: 2 }, { assinatura: true, kit: false, cupons: [] }).outcome).toBe('recorrencia');
    expect(decideOutcome({ q2: 2 }, { assinatura: false, kit: false, cupons: [] }).outcome).toBe('obrigado');
  });

  it('atalho "Reorder now" vai pra assinatura (ou pro kit), nunca com cupom', () => {
    expect(decideOutcome({ atalho: true, q1: 'dinheiro' }, ALL).outcome).toBe('recorrencia');
    expect(decideOutcome({ atalho: true }, { ...ALL, assinatura: false }).outcome).toBe('oferta');
  });

  it('"ver mais progresso" marca o acompanhamento de 30 dias', () => {
    expect(decideOutcome({ q2: 4, q5: ['progresso'] }, ALL).followUp).toBe(true);
  });

  it('disponibilidade: kit precisa de link e preço; cupom precisa de código e kit', () => {
    expect(availableOffers(CFG, 4)).toEqual(ALL);
    expect(availableOffers({ ...CFG, coupons: [{ pct: 10, code: null }] }, 4).cupons).toEqual([]);
    expect(availableOffers({ productName: 'X' }, null)).toEqual({ assinatura: false, kit: false, cupons: [] });
  });
});

describe('checkoutUrl', () => {
  it('leva o rastreio da resposta sem perder os parâmetros do link', () => {
    expect(checkoutUrl(CFG, 'kit', 'r1', { kit: 4 })).toBe('https://pay.vupim.com/k4?x=1&src=qz_r1');
    expect(checkoutUrl(CFG, 'assinatura', 'r1', { kit: 4 })).toBe('https://pay.vupim.com/sub?src=qz_r1');
  });

  it('cupom usa a oferta já com desconto quando existe; senão o kit, com o código no link se a plataforma aceitar', () => {
    expect(checkoutUrl(CFG, 'cupom', 'r1', { kit: 6, couponPct: 20 })).toBe('https://pay.vupim.com/k6-20?src=qz_r1');
    expect(checkoutUrl(CFG, 'cupom', 'r1', { kit: 3, couponPct: 15 })).toBe('https://pay.vupim.com/k3?src=qz_r1');
    expect(checkoutUrl({ ...CFG, couponParam: 'coupon' }, 'cupom', 'r1', { kit: 3, couponPct: 15 }))
      .toBe('https://pay.vupim.com/k3?coupon=KEEP15&src=qz_r1');
    expect(checkoutUrl(CFG, 'cupom', 'r1', { kit: 3, couponPct: 50 })).toBeNull();
  });
});

describe('cleanAnswer — o servidor só aceita o que a página oferece', () => {
  it('escolha fora da lista é recusada', () => {
    expect(cleanAnswer(CFG, 'q1', 'dinheiro')).toEqual({ key: 'q1', value: 'dinheiro' });
    expect(cleanAnswer(CFG, 'q1', 'hack')).toBeNull();
    expect(cleanAnswer(CFG, 'q2', 6)).toBeNull();
    expect(cleanAnswer(CFG, 'q2', '4')).toEqual({ key: 'q2', value: 4 });
  });
  it('pergunta 5 corta em 2; a 4 aceita as opções da variante', () => {
    expect(cleanAnswer(CFG, 'q5', ['mensal', 'mensal', 'desconto', 'progresso'])).toEqual({ key: 'q5', value: ['mensal', 'desconto'] });
    expect(cleanAnswer(CFG, 'q4', ['nomes', 'cedo', 'xx'])).toEqual({ key: 'q4', value: ['nomes', 'cedo'] });
  });
});

describe('texto e preços da página', () => {
  it('variáveis de preço: kit, por frasco, preço normal, assinatura e cupom', () => {
    const ctx = { firstName: 'John', bottles: 2 };
    expect(surveyVars(CFG, ctx)).toMatchObject({
      frascos: '2', dias: '60', faltam: '4', total: '5', kit: '4',
      preco_kit: '$216', preco_pote: '$54', preco_regular_pote: '$69', preco_1o: '$39', preco_mes: '$49',
    });
    expect(couponVars(CFG, ctx, 15)).toEqual({ desconto: '15', cupom: 'KEEP15', preco_cupom: '$183.60' });
    expect(surveyVars(CFG, { firstName: 'John', bottles: 6 })).toMatchObject({ total: '4', kit: '6', preco_kit: '$264', preco_pote: '$44', preco_regular_pote: '$49' });
  });

  it('sem nome a frase continua natural', () => {
    const anon = surveyVars(CFG, { firstName: null, bottles: 2 });
    expect(fillText("{nome}, you're about to finish bottle {frascos}.", anon)).toBe("You're about to finish bottle 2.");
    expect(fillText('Thank you, {nome}.', anon)).toBe('Thank you.');
  });

  it('primeiro nome legível', () => {
    expect(firstNameOf('JOHN SMITH')).toBe('John');
    expect(firstNameOf('123 Test')).toBeNull();
  });
});

describe('renderSurveyPage', () => {
  const base = {
    cfg: CFG, ctx: { firstName: 'John', bottles: 3 }, slug: 'neurorecall', token: 'tok123', preview: false,
    answers: {}, outcome: null, couponPct: null, followUp: false,
  };

  it('plano incompleto: copy de completar o plano, kit de 3, uma tela por faixa de cupom', () => {
    const html = renderSurveyPage(base);
    // Título curto (1 linha); o "terminando o frasco X do plano" fica no texto.
    expect(html).toContain('<h1 class="fit" tabindex="-1">John, how&#39;s NeuroRecall going?</h1>');
    expect(html).toContain('finish bottle 3 of your 6-month plan');
    expect(html).toContain('id="q1"');
    expect(html).toContain('Complete my plan for $177');
    expect(html).toContain('Continue my plan for $39');
    for (const id of ['end-cs', 'end-recorrencia', 'end-oferta', 'end-cupom-10', 'end-cupom-15', 'end-cupom-20', 'end-obrigado']) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('<span class="code">KEEP20</span>');
    expect(html).toContain('/api/survey/go?t=tok123&amp;o=cupom');
    expect(html).toContain('src="/survey-assets/neurorecall.webp"');
  });

  it('plano completo: sem a pergunta 1, copy de doses perdidas e versão pra quem tomou todo dia', () => {
    const html = renderSurveyPage({ ...base, ctx: { firstName: 'John', bottles: 6 } });
    expect(html).not.toContain('id="q1"');
    expect(html).toContain('Make up for the days you missed');
    expect(html).toContain('data-body="constante"');
    expect(html).toContain('Keep going for $264');
  });

  it('sem links não há oferta nem atalho; nome é escapado', () => {
    const html = renderSurveyPage({ ...base, cfg: { productName: 'X' }, ctx: { firstName: '<script>x</script>', bottles: 3 } });
    expect(html).not.toContain('id="end-oferta"');
    expect(html).not.toContain('id="atalho"');
    expect(html).not.toContain('<script>x</script>');
  });

  it('pesquisa concluída abre na tela final certa', () => {
    expect(renderSurveyPage({ ...base, outcome: 'cupom', couponPct: 15 })).toContain('"start":"end-cupom-15"');
    expect(endSectionId('oferta', null)).toBe('end-oferta');
  });

  it('link inválido', () => {
    expect(renderSurveyInvalid(CFG)).toContain('This link is no longer active');
  });
});
