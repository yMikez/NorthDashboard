import { describe, expect, it } from 'vitest';
import { firstPhone, normalizePhone } from './phone';

describe('normalizePhone', () => {
  it('fica só com dígitos e mantém o DDI que veio', () => {
    expect(normalizePhone('+1 (555) 123-4567')).toBe('15551234567');
    expect(normalizePhone('555.123.4567')).toBe('5551234567');
    expect(normalizePhone(15056608654)).toBe('15056608654');
  });
  it('tira o 00 de discagem internacional', () => {
    expect(normalizePhone('0049 30 1234567')).toBe('49301234567');
  });
  it('fora de 7–15 dígitos, vazio ou não-texto = null', () => {
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('1234567890123456')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone({})).toBeNull();
  });
  it('firstPhone pula candidato vazio ou inválido', () => {
    expect(firstPhone('', 'abc', '555-123-4567', '999')).toBe('5551234567');
    expect(firstPhone(undefined, '')).toBeNull();
  });
});
