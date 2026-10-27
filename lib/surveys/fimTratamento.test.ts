import { describe, expect, it } from 'vitest';
import {
  availableOutcomes, checkoutUrl, cleanAnswer, decideOutcome, fillText, firstNameOf, surveyVars,
  type SurveyVariantConfig,
} from './fimTratamento';
import { renderSurveyInvalid, renderSurveyPage } from './render';

const ALL = { recorrencia: true, cupom: true };

const CFG: SurveyVariantConfig = {
  productName: 'NeuroMind Pro',
  checkout: { recorrencia: 'https://pay.vupim.com/r/abc', cupom: 'https://pay.vupim.com/c/xyz?x=1' },
  trackingParam: 'src',
  coupon: { code: 'FINISH20', pct: 20, validDays: 7 },
  q4: [{ id: 'nomes', label: 'Remembering names and words more easily' }],
};

describe('decideOutcome — tela final na ordem do desenho', () => {
  it('nota 1–2 vai pro CS, mesmo pedindo desconto', () => {
    expect(decideOutcome({ q2: 2, q5: ['desconto'] }, ALL)).toMatchObject({ outcome: 'cs', csReason: 'nota_baixa' });
  });

  it('parou por médico ou mal-estar vai pro CS', () => {
    expect(decideOutcome({ q2: 4, q3: 'parou', q3b: 'medico' }, ALL)).toMatchObject({ outcome: 'cs', csReason: 'parou_medico' });
    expect(decideOutcome({ q2: 4, q3: 'parou', q3b: 'mal_estar' }, ALL)).toMatchObject({ outcome: 'cs', csReason: 'parou_mal_estar' });
  });

  it('marcou "1 frasco por mês" e "desconto": recorrência, sem cupom', () => {
    expect(decideOutcome({ q2: 4, q5: ['mensal', 'desconto'] }, ALL).outcome).toBe('recorrencia');
  });

  it('desconto, motivo dinheiro ou parou pelo orçamento: cupom', () => {
    expect(decideOutcome({ q2: 3, q5: ['desconto'] }, ALL).outcome).toBe('cupom');
    expect(decideOutcome({ q1: 'dinheiro', q2: 5, q5: ['progresso'] }, ALL).outcome).toBe('cupom');
    expect(decideOutcome({ q2: 3, q3: 'parou', q3b: 'orcamento', q5: ['nao_continuar'] }, ALL).outcome).toBe('cupom');
  });

  it('sem cupom configurado, quem citou dinheiro recebe a recorrência', () => {
    expect(decideOutcome({ q2: 4, q5: ['desconto'] }, { recorrencia: true, cupom: false }).outcome).toBe('recorrencia');
    expect(decideOutcome({ q2: 4, q5: ['desconto'] }, { recorrencia: false, cupom: false }).outcome).toBe('obrigado');
  });

  it('atalho "Reorder now" vai pra recorrência', () => {
    expect(decideOutcome({ atalho: true, q1: 'testar' }, ALL).outcome).toBe('recorrencia');
  });

  it('o resto agradece; "ver mais progresso" ganha acompanhamento', () => {
    expect(decideOutcome({ q2: 4, q5: ['progresso'] }, ALL)).toEqual({ outcome: 'obrigado', csReason: null, followUp: true });
    expect(decideOutcome({ q2: 4, q5: ['nao_continuar'] }, ALL)).toEqual({ outcome: 'obrigado', csReason: null, followUp: false });
  });

  it('cupom só fica disponível com link, código e porcentagem', () => {
    expect(availableOutcomes(CFG)).toEqual(ALL);
    expect(availableOutcomes({ ...CFG, coupon: { code: null, pct: 20 } })).toEqual({ recorrencia: true, cupom: false });
    expect(availableOutcomes({ productName: 'X' })).toEqual({ recorrencia: false, cupom: false });
  });
});

describe('cleanAnswer — o servidor só aceita o que a página oferece', () => {
  it('escolha única fora da lista é recusada', () => {
    expect(cleanAnswer(CFG, 'q1', 'dinheiro')).toEqual({ key: 'q1', value: 'dinheiro' });
    expect(cleanAnswer(CFG, 'q1', 'hack')).toBeNull();
    expect(cleanAnswer(CFG, 'q2', 6)).toBeNull();
    expect(cleanAnswer(CFG, 'q2', '4')).toEqual({ key: 'q2', value: 4 });
    expect(cleanAnswer(CFG, 'nope', 'x')).toBeNull();
  });

  it('pergunta 5 corta em 2 e tira repetidas; a 4 aceita as opções da variante', () => {
    expect(cleanAnswer(CFG, 'q5', ['mensal', 'mensal', 'desconto', 'progresso'])).toEqual({ key: 'q5', value: ['mensal', 'desconto'] });
    expect(cleanAnswer(CFG, 'q4', ['nomes', 'cedo', 'xx'])).toEqual({ key: 'q4', value: ['nomes', 'cedo'] });
  });

  it('comentário é aparado e limitado', () => {
    expect(cleanAnswer(CFG, 'comentario', `  ${'a'.repeat(3000)} `)?.value).toHaveLength(2000);
  });
});

describe('texto da página', () => {
  const vars = surveyVars(CFG, { firstName: 'John', bottles: 3 });

  it('variáveis do plano', () => {
    expect(vars).toMatchObject({ frascos: '3', dias: '90', faltam: '3', plano: '6', desconto: '20', cupom: 'FINISH20' });
  });

  it('sem nome a frase continua natural', () => {
    const anon = surveyVars(CFG, { firstName: null, bottles: 2 });
    expect(fillText("{nome}, you're about to finish bottle {frascos}.", anon)).toBe("You're about to finish bottle 2.");
    expect(fillText('Thank you, {nome}.', anon)).toBe('Thank you.');
    expect(fillText('Thank you, {nome}.', vars)).toBe('Thank you, John.');
  });

  it('primeiro nome legível', () => {
    expect(firstNameOf('JOHN SMITH')).toBe('John');
    expect(firstNameOf('  mary-ann  lee')).toBe('Mary-ann');
    expect(firstNameOf('123 Test')).toBeNull();
    expect(firstNameOf(null)).toBeNull();
  });

  it('checkout leva o rastreio da resposta sem perder os parâmetros do link', () => {
    expect(checkoutUrl(CFG, 'cupom', 'r1')).toBe('https://pay.vupim.com/c/xyz?x=1&src=qz_r1');
    expect(checkoutUrl({ productName: 'X' }, 'recorrencia', 'r1')).toBeNull();
  });
});

describe('renderSurveyPage', () => {
  const base = { cfg: CFG, ctx: { firstName: 'John', bottles: 3 }, slug: 'neuromind-pro', token: 'tok123', preview: false, answers: {}, outcome: null, followUp: false };

  it('monta a página personalizada, com as telas e sem script injetável', () => {
    const html = renderSurveyPage({ ...base, ctx: { firstName: '<script>x</script>', bottles: 3 } });
    expect(html).toContain('bottle 3 of your 6-month NeuroMind Pro plan');
    expect(html).not.toContain('<script>x</script>');
    for (const id of ['intro', 'q1', 'q2', 'q3', 'q3b', 'q4', 'q5', 'end-cs', 'end-recorrencia', 'end-cupom', 'end-obrigado']) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('/api/survey/go?t=tok123&amp;o=recorrencia');
    expect(html).toContain('<span class="code">FINISH20</span>');
  });

  it('sem cupom não há tela de cupom; sem recorrência não há atalho', () => {
    const html = renderSurveyPage({ ...base, cfg: { ...CFG, coupon: undefined, checkout: { recorrencia: null } } });
    expect(html).not.toContain('id="end-cupom"');
    expect(html).not.toContain('id="atalho"');
  });

  it('pesquisa concluída abre na tela final', () => {
    expect(renderSurveyPage({ ...base, outcome: 'cs' })).toContain('"start":"end-cs"');
  });

  it('link inválido', () => {
    expect(renderSurveyInvalid(CFG)).toContain('This link is no longer active');
  });
});
