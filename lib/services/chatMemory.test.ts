import { describe, expect, it } from 'vitest';
import { mostSimilar, numbersIn, similarity, validateFact, validateFacts } from './chatMemory';

const user =
  'Pra nossa operação, CPA válido é entre $200 e $290. E sempre me mostre a margem de contribuição junto do lucro. ' +
  'Ah, e a receita de ontem foi 12.345?';

const base = {
  title: 'Faixa de CPA válida',
  content: 'CPA válido fica entre $200 e $290.',
  type: 'rule',
  evidence: 'CPA válido é entre $200 e $290',
  confidence: 0.92,
  relation: 'new',
  target_id: '',
};

describe('validação de memória (servidor)', () => {
  it('aceita fato com evidência literal do usuário (acento/caixa não importam)', () => {
    const r = validateFact({ ...base, evidence: 'cpa VALIDO é entre $200 e $290' }, user, []);
    expect(r.ok).toBe(true);
  });

  it('recusa evidência que não está na fala do usuário (paráfrase ou fala do assistente)', () => {
    const r = validateFact({ ...base, evidence: 'o CPA aceitável vai de 200 a 290 dólares' }, user, []);
    expect(r).toEqual({ ok: false, reason: 'evidence_not_literal' });
  });

  it('recusa número que o usuário não disse (veio de consulta)', () => {
    const r = validateFact({ ...base, content: 'CPA válido entre $200 e $290; média atual $245.' }, user, []);
    expect(r).toEqual({ ok: false, reason: 'number_not_from_user' });
  });

  it('recusa resultado de consulta (número + período), mesmo dito pelo usuário', () => {
    const r = validateFact(
      { ...base, title: 'Receita de ontem', content: 'A receita de ontem foi 12.345.', evidence: 'a receita de ontem foi 12.345', type: 'definition' },
      user,
      [],
    );
    expect(r).toEqual({ ok: false, reason: 'query_result' });
  });

  it('recusa dado pessoal', () => {
    const u = 'O afiliado principal é o joao@exemplo.com, sempre trate ele como North.';
    const r = validateFact(
      { ...base, title: 'Afiliado principal', content: 'joao@exemplo.com é tier North.', evidence: 'O afiliado principal é o joao@exemplo.com', type: 'definition' },
      u,
      [],
    );
    expect(r).toEqual({ ok: false, reason: 'pii' });
  });

  it('recusa confiança baixa, duplicata declarada e duplicata por similaridade', () => {
    expect(validateFact({ ...base, confidence: 0.5 }, user, [])).toEqual({ ok: false, reason: 'low_confidence' });
    expect(validateFact({ ...base, relation: 'duplicate_of', target_id: 'k1' }, user, [])).toEqual({ ok: false, reason: 'duplicate' });
    const existing = [{ id: 'k1', title: 'Faixa de CPA válida', content: 'CPA válido fica entre $200 e $290.' }];
    expect(validateFact(base, user, existing)).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('recusa formato quebrado', () => {
    expect(validateFact({ title: 'x' }, user, [])).toEqual({ ok: false, reason: 'malformed' });
    expect(validateFact({ ...base, type: 'fofoca' }, user, [])).toEqual({ ok: false, reason: 'malformed' });
    expect(validateFact(null, user, [])).toEqual({ ok: false, reason: 'malformed' });
  });

  it('lote: duplicata dentro do próprio lote sai e o teto é 3', () => {
    const pref = {
      title: 'Margem junto do lucro',
      content: 'Sempre mostrar a margem de contribuição junto do lucro.',
      type: 'preference',
      evidence: 'sempre me mostre a margem de contribuição junto do lucro',
      confidence: 0.95,
      relation: 'new',
      target_id: '',
    };
    const { accepted, rejected } = validateFacts([base, { ...base }, pref, pref, pref], user, []);
    expect(accepted.map((a) => a.title)).toEqual(['Faixa de CPA válida', 'Margem junto do lucro']);
    expect(rejected.map((r) => r.reason)).toEqual(['duplicate']);
  });
});

describe('similaridade', () => {
  it('Jaccard sem acento/stopword e ranking dos parecidos', () => {
    expect(similarity('Frete é por sessão', 'frete por SESSAO')).toBe(1);
    expect(similarity('abc', '')).toBe(0);
    const pool = [
      { id: '1', title: 'Frete', content: 'frete cobrado por sessão' },
      { id: '2', title: 'CPA', content: 'faixa de CPA do programa' },
    ];
    expect(mostSimilar('como é cobrado o frete da sessão', pool)[0].id).toBe('1');
  });

  it('números normalizados (1.500 = 1,500 = 1500)', () => {
    expect(numbersIn('R$ 1.500 ou $1,500 ou 1500 e 8,5%')).toEqual(['1500', '1500', '1500', '85']);
  });
});
