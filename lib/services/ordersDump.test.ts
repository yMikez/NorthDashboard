import { describe, expect, it } from 'vitest';
import { reversedAmount, EXTRA_ROW_PLATFORMS } from './ordersDump';

// O consumidor externo não pode precisar saber qual plataforma estorna de
// qual jeito — o valor devolvido sai resolvido e sempre positivo.
describe('reversedAmount', () => {
  it('extra-row (Digistore): a linha É o estorno, negativa → valor absoluto', () => {
    expect(reversedAmount({ gross: -294, originalGross: null, extraRow: true })).toBe(294);
    expect(reversedAmount({ gross: -215.33, originalGross: null, extraRow: true })).toBe(215.33);
  });
  it('in-place total (JVZoo): a venda virou estorno pelo mesmo valor', () => {
    expect(reversedAmount({ gross: 294, originalGross: 294, extraRow: false })).toBe(294);
    expect(reversedAmount({ gross: -294, originalGross: 294, extraRow: false })).toBe(294);
  });
  it('in-place PARCIAL: devolve o que a plataforma reportou, não a venda inteira', () => {
    expect(reversedAmount({ gross: 207, originalGross: 294, extraRow: false })).toBe(207);
  });
  it('nunca devolve mais do que foi vendido (evento com valor inflado)', () => {
    expect(reversedAmount({ gross: 500, originalGross: 294, extraRow: false })).toBe(294);
  });
  it('sem originalGross (order antiga, pré-backfill) cai no valor da linha', () => {
    expect(reversedAmount({ gross: 294, originalGross: null, extraRow: false })).toBe(294);
  });
  it('Digistore é a única extra-row hoje', () => {
    expect([...EXTRA_ROW_PLATFORMS]).toEqual(['digistore24']);
  });
});
