import { describe, expect, it } from 'vitest';
import { extractNumbers, interpretBody, numberMatches } from './numbers';

const one = (text: string) => {
  const all = extractNumbers(text);
  expect(all.length).toBeGreaterThan(0);
  return all[0];
};
const values = (text: string) => one(text).readings.map((r) => r.value);

describe('extractNumbers — formatos US e pt-BR', () => {
  it('US com milhar e centavos', () => {
    const n = one('Receita de $154,318.42 no mês');
    expect(n.unit).toBe('usd');
    expect(n.readings).toEqual([{ value: 154318.42, granularity: 0.01 }]);
  });

  it('pt-BR "$ 154.318" é ambíguo: mantém as duas leituras', () => {
    const n = one('faturou $ 154.318');
    expect(n.unit).toBe('usd');
    expect(values('faturou $ 154.318')).toEqual([154318, 154.318]);
    expect(n.readings.map((r) => r.granularity)).toEqual([1, 0.001]);
  });

  it('"1.234" sem moeda também é ambíguo; "0,123" não (zero à esquerda)', () => {
    expect(values('foram 1.234 pedidos')).toEqual([1234, 1.234]);
    expect(values('taxa de 0,123')).toEqual([0.123]);
  });

  it('pt-BR com os dois separadores: o último é o decimal', () => {
    expect(values('US$ 1.234.567,89')).toEqual([1234567.89]);
    expect(values('$1,234,567.89')).toEqual([1234567.89]);
  });

  it('multiplicadores mil / k / M com granularidade escalada', () => {
    const mil = one('US$ 1,2 mil');
    expect(mil.readings).toEqual([{ value: 1200, granularity: 100 }]);
    const k = one('$154.3K');
    expect(k.readings[0].value).toBeCloseTo(154300);
    expect(k.readings[0].granularity).toBeCloseTo(100);
    expect(one('$1.2M').readings[0].value).toBeCloseTo(1_200_000);
    expect(one('$ 3 milhões').readings[0]).toEqual({ value: 3_000_000, granularity: 1_000_000 });
  });

  it('percentual e pontos percentuais, inclusive negativo com sinal unicode', () => {
    const p = one('aprovação de 12,4%');
    expect(p.unit).toBe('pct');
    expect(p.readings).toEqual([{ value: 12.4, granularity: 0.1 }]);
    const pp = one('caiu −3,5 pp');
    expect(pp.unit).toBe('pp');
    expect(pp.readings[0].value).toBe(-3.5);
    expect(one('variação de -12.5%').readings[0].value).toBe(-12.5);
  });

  it('R$ é marcado como brl', () => {
    expect(one('custou R$ 500').unit).toBe('brl');
  });

  it('ignora datas, horas, ordinais e números colados em letras', () => {
    const text = 'Em 2026-08-01, 01/09 e às 14:05 (G01, UP1, 30d, 1ª) vendemos $10';
    const nums = extractNumbers(text);
    expect(nums.map((n) => n.raw)).toEqual(['$10']);
  });

  it('marca ano solto como yearLike', () => {
    const [n] = extractNumbers('em agosto de 2026');
    expect(n.yearLike).toBe(true);
    expect(extractNumbers('$2,026')[0].yearLike).toBe(false);
  });

  it('não confunde faixa "7-10%" com número negativo', () => {
    const nums = extractNumbers('entre 7-10%');
    expect(nums.map((n) => n.readings[0].value)).toEqual([7, 10]);
  });

  it('índice aponta pro início do número no texto original', () => {
    const text = 'Total: $1,000';
    const [n] = extractNumbers(text);
    expect(text.slice(n.index, n.end)).toBe('$1,000');
  });
});

describe('interpretBody', () => {
  it('separador repetido é sempre milhar', () => {
    expect(interpretBody('1.234.567')).toEqual([{ value: 1234567, granularity: 1 }]);
  });
  it('decimal com 1–2 casas não é ambíguo', () => {
    expect(interpretBody('12,34')).toEqual([{ value: 12.34, granularity: 0.01 }]);
  });
});

describe('numberMatches — precisão do número escrito', () => {
  it('"$ 154,3 mil" passa pra 154.318; "$ 150 mil" não', () => {
    expect(numberMatches(one('$ 154,3 mil'), 154_318, { rel: 0.002 })).toBe(true);
    expect(numberMatches(one('$ 150 mil'), 154_318, { rel: 0.002 })).toBe(false);
  });

  it('contagem exige forma exata', () => {
    expect(numberMatches(one('1,2 mil vendas'), 1234, {}, { integerOnly: true })).toBe(false);
    expect(numberMatches(one('1.234 vendas'), 1234, {}, { integerOnly: true })).toBe(true);
  });

  it('absolute compara em módulo (queda escrita sem sinal)', () => {
    expect(numberMatches(one('queda de 5,3%'), -5.3, { abs: 0.05 }, { absolute: true })).toBe(true);
    expect(numberMatches(one('queda de 5,3%'), -5.3, { abs: 0.05 })).toBe(false);
  });

  it('tolerância relativa e absoluta', () => {
    expect(numberMatches(one('$1,000'), 1001.5, { rel: 0.002 })).toBe(true);
    expect(numberMatches(one('8,2%'), 8.23, { abs: 0.05 })).toBe(true);
    expect(numberMatches(one('8,4%'), 8.23, { abs: 0.05 })).toBe(false);
  });
});
