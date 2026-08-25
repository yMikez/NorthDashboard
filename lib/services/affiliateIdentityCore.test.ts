import { describe, expect, it } from 'vitest';
import {
  normalizeEmail, normalizeName, nameTokens, isInternalGuess, effectiveInternal, suggestLinks, pickPartnerName,
  type IdentityAffiliate,
} from './affiliateIdentityCore';

const aff = (over: Partial<IdentityAffiliate> & { id: string; platformSlug: string }): IdentityAffiliate => ({
  externalId: over.id, nickname: null, email: null, partnerId: null, isInternal: null, lastOrderAt: new Date('2026-08-20T00:00:00Z'),
  ...over,
});

describe('normalização', () => {
  it('e-mail minúsculo/trim; inválido → null', () => {
    expect(normalizeEmail('  Joao@Ex.COM ')).toBe('joao@ex.com');
    expect(normalizeEmail('sem-arroba')).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });
  it('nome sem acento/espaço/pontuação', () => {
    expect(normalizeName('Eduardo Godoy')).toBe('eduardogodoy');
    expect(normalizeName('Nicolás Ýago-Zapora!')).toBe('nicolasyagozapora');
  });
  it('tokens fortes: ≥5 letras, sem dígitos, sem stopword', () => {
    expect(nameTokens('XM Group LLC')).toEqual([]);
    expect(nameTokens('Nicolas Yago Zapora')).toEqual(['nicolas', 'zapora']);
    expect(nameTokens('edugodoy16235294')).toEqual(['edugodoy']);
    expect(nameTokens('xx483')).toEqual([]);
  });
});

describe('isInternalGuess', () => {
  it('nick de família + número, ID "0" e código de campanha são internos', () => {
    expect(isInternalGuess({ externalId: 'neuromindpro12', nickname: 'neuromindpro12' })).toBe(true);
    expect(isInternalGuess({ externalId: '0', nickname: null })).toBe(true);
    expect(isInternalGuess({ externalId: '6296-WGHTLBLND-XYZ', nickname: null })).toBe(true);
    expect(isInternalGuess({ externalId: 'glycoeden6', nickname: 'glycoeden6' })).toBe(true);
    expect(isInternalGuess({ externalId: '3552183', nickname: 'xx483' })).toBe(false);
    expect(isInternalGuess({ externalId: '200690', nickname: 'Neha Singh' })).toBe(false);
    // sufixo de letras = afiliado real
    expect(isInternalGuess({ externalId: '1', nickname: 'hawaiianads' })).toBe(false);
    expect(isInternalGuess({ externalId: '2', nickname: 'neuromindproreviews' })).toBe(false);
  });
  it('decisão manual vence a heurística', () => {
    expect(effectiveInternal({ externalId: 'neuromindpro12', nickname: null, isInternal: false })).toBe(false);
    expect(effectiveInternal({ externalId: 'skill99', nickname: 'skill99', isInternal: true })).toBe(true);
  });
});

describe('suggestLinks', () => {
  it('e-mail igual = alta; nome igual = média; token = baixa; mesma plataforma nunca', () => {
    const list = [
      aff({ id: 'a', platformSlug: 'jvzoo', nickname: 'Eduardo Godoy', email: 'edu@x.com' }),
      aff({ id: 'b', platformSlug: 'digistore24', nickname: 'edugodoy16235294', email: 'edu@x.com' }),
      aff({ id: 'c', platformSlug: 'clickbank', nickname: 'testaff01', externalId: 'testaff01' }),
      aff({ id: 'd', platformSlug: 'digistore24', nickname: 'testaff01', externalId: '1111111' }),
      aff({ id: 'e', platformSlug: 'buygoods', nickname: 'Neha Singh' }),
      aff({ id: 'f', platformSlug: 'jvzoo', nickname: 'Singh Media' }),
      aff({ id: 'g', platformSlug: 'jvzoo', nickname: 'Neha Singh' }),
    ];
    const s = suggestLinks(list);
    const pair = (x: string, y: string) => s.find((p) => [p.a.id, p.b.id].sort().join() === [x, y].sort().join());
    expect(pair('a', 'b')?.confidence).toBe('alta');
    expect(pair('c', 'd')?.confidence).toBe('media');
    expect(pair('e', 'g')?.confidence).toBe('media');
    expect(pair('e', 'f')?.confidence).toBe('baixa');
    expect(pair('f', 'g')).toBeUndefined(); // mesma plataforma
    expect(s[0].confidence).toBe('alta');
  });
  it('sobrenome embutido no nick ("Eduardo Godoy" ↔ "edugodoy16235294") vira sugestão baixa', () => {
    const s = suggestLinks([
      aff({ id: 'a', platformSlug: 'jvzoo', nickname: 'Eduardo Godoy' }),
      aff({ id: 'b', platformSlug: 'digistore24', nickname: 'edugodoy16235294' }),
      aff({ id: 'c', platformSlug: 'digistore24', nickname: 'skill99' }),
    ]);
    expect(s).toHaveLength(1);
    expect([s[0].a.id, s[0].b.id].sort()).toEqual(['a', 'b']);
    expect(s[0].confidence).toBe('baixa');
    expect(s[0].evidence).toContain('godoy');
  });

  it('nick genérico igual ("Marketing", "admin") não vira sugestão', () => {
    expect(suggestLinks([
      aff({ id: 'a', platformSlug: 'jvzoo', nickname: 'Marketing' }),
      aff({ id: 'b', platformSlug: 'digistore24', nickname: 'marketing' }),
      aff({ id: 'c', platformSlug: 'buygoods', nickname: 'admin' }),
      aff({ id: 'd', platformSlug: 'clickbank', nickname: 'admin', externalId: 'admin' }),
    ])).toEqual([]);
  });

  it('ignora internos e pares já no mesmo parceiro', () => {
    const s = suggestLinks([
      aff({ id: 'a', platformSlug: 'jvzoo', nickname: 'neuromindpro12', externalId: 'neuromindpro12' }),
      aff({ id: 'b', platformSlug: 'clickbank', nickname: 'neuromindpro12', externalId: 'neuromindpro12' }),
      aff({ id: 'c', platformSlug: 'jvzoo', nickname: 'skill99', partnerId: 'p1' }),
      aff({ id: 'd', platformSlug: 'digistore24', nickname: 'skill99', partnerId: 'p1' }),
    ]);
    expect(s).toEqual([]);
  });
  it('pickPartnerName prefere nick recente que não seja número', () => {
    expect(pickPartnerName([
      aff({ id: 'a', platformSlug: 'jvzoo', nickname: '12345', lastOrderAt: new Date('2026-08-24T00:00:00Z') }),
      aff({ id: 'b', platformSlug: 'digistore24', nickname: 'Eduardo Godoy', lastOrderAt: new Date('2026-08-01T00:00:00Z') }),
    ])).toBe('Eduardo Godoy');
  });
});
