import { describe, expect, it } from 'vitest';
import { affiliateKeyReadable, affiliateSourceFor, affRuleHash } from './affiliate';

describe('regra por afiliado — formato que a página lê', () => {
  it('só JVZoo e BuyGoods têm afiliado legível na página', () => {
    expect(affiliateSourceFor('jvzoo')).toBe('aid');
    expect(affiliateSourceFor('buygoods')).toBe('mem');
    expect(affiliateSourceFor('clickbank')).toBeNull();
  });

  it('JVZoo: só dígitos; BuyGoods: só aff_id@loja (ID solto é ambíguo e a página nunca lê)', () => {
    expect(affiliateKeyReadable('jvzoo', '3552295')).toBe(true);
    expect(affiliateKeyReadable('jvzoo', '62@13457')).toBe(false);
    expect(affiliateKeyReadable('buygoods', '62@13457')).toBe(true);
    expect(affiliateKeyReadable('buygoods', '62')).toBe(false);
    expect(affiliateKeyReadable('jvzoo', '0')).toBe(false);
    expect(affiliateKeyReadable('clickbank', '123')).toBe(false);
  });

  it('hash da regra: estável, por página e por afiliado', () => {
    const h = affRuleHash('glycoeden-up01-jvzoo', '3552295');
    expect(h).toMatch(/^[0-9a-z]+$/);
    expect(affRuleHash('glycoeden-up01-jvzoo', '3552295')).toBe(h);
    expect(affRuleHash('glycoeden-up02-jvzoo', '3552295')).not.toBe(h);
    expect(affRuleHash('glycoeden-up01-jvzoo', '3552296')).not.toBe(h);
  });
});
