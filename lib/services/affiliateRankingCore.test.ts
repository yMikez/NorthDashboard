import { describe, expect, it } from 'vitest';
import {
  CAMPOS, contaDe, isDiaIso, mapearContas, montarPayload, parseContas, PREMISSAS_PADRAO, sanitizarPremissas,
} from './affiliateRankingCore';

describe('contaDe', () => {
  it('monta a chave JVZoo e Vupim', () => {
    expect(contaDe('jvzoo', '3552213')).toBe('JVZoo 3552213');
    expect(contaDe('vupim', 'W4TjAcBsZFSW9SkB5K25OmPSKbLeE9sO')).toBe('Vupim W4TjAcBsZFSW9SkB5K25OmPSKbLeE9sO');
  });
  it('tira o prefixo VP antigo da Vupim (34 caracteres)', () => {
    expect(contaDe('vupim', 'VPW4TjAcBsZFSW9SkB5K25OmPSKbLeE9sO')).toBe('Vupim W4TjAcBsZFSW9SkB5K25OmPSKbLeE9sO');
  });
  it('ignora outras plataformas', () => {
    expect(contaDe('digistore24', '123')).toBeNull();
    expect(contaDe('jvzoo', '')).toBeNull();
  });
});

describe('mapearContas', () => {
  it('liga contas do mesmo parceiro e guarda o apelido', () => {
    const { nomes, parceiros } = mapearContas([
      { slug: 'jvzoo', externalId: '1', nickname: 'Ana', partnerId: 'p1', partnerName: 'Ana Souza' },
      { slug: 'vupim', externalId: 'VP' + 'x'.repeat(32), nickname: null, partnerId: 'p1', partnerName: 'Ana Souza' },
      { slug: 'jvzoo', externalId: '2', nickname: 'Bia', partnerId: null, partnerName: null },
    ]);
    expect(nomes).toEqual({ 'JVZoo 1': 'Ana', 'JVZoo 2': 'Bia' });
    expect(parceiros).toEqual({ 'JVZoo 1': ['p1', 'Ana Souza'], ['Vupim ' + 'x'.repeat(32)]: ['p1', 'Ana Souza'] });
  });
});

describe('montarPayload', () => {
  const linhas = [
    { afiliado: 'JVZoo 2', dia: '2026-07-08', fes: 3, funil: '450.5', dev10: 10 },
    { afiliado: 'JVZoo 1', dia: '2026-07-06', fes: 1, funil: 100 },
    { afiliado: 'Vupim abc', dia: '2026-10-22', fes: 2, funil: 300, liq_call: null },
  ];
  const p = montarPayload(linhas, { 'JVZoo 1': 'Ana' }, { 'JVZoo 1': ['p1', 'Ana'], 'JVZoo 9': ['p9', 'X'] }, '2026-11-04T19:00:00Z', 253);

  it('ordena as contas e põe a plataforma', () => {
    expect(p.afs).toEqual([['JVZoo 1', 'Ana', 'JVZoo'], ['JVZoo 2', '', 'JVZoo'], ['Vupim abc', '', 'Vupim']]);
  });
  it('conta os dias a partir do primeiro dia', () => {
    expect(p.d0).toBe('2026-07-06');
    expect(p.d1).toBe('2026-10-22');
    expect(p.rows.map((r) => r.slice(0, 2))).toEqual([[1, 2], [0, 0], [2, 108]]);
  });
  it('põe os campos na ordem e converte texto/vazio em número', () => {
    const r = p.rows[0];
    expect(r).toHaveLength(2 + CAMPOS.length);
    expect(r[2 + CAMPOS.indexOf('funil')]).toBe(450.5);
    expect(r[2 + CAMPOS.indexOf('dev10')]).toBe(10);
    expect(p.rows[2][2 + CAMPOS.indexOf('liq_call')]).toBe(0);
  });
  it('só leva os parceiros das contas que aparecem', () => {
    expect(p.parceiros).toEqual({ 'JVZoo 1': ['p1', 'Ana'] });
  });
  it('sem linhas não quebra', () => {
    const v = montarPayload([], {}, {}, '2026-11-04T19:00:00Z', null);
    expect(v.rows).toEqual([]);
    expect(v.d0).toBe('2026-11-04');
  });
});

describe('sanitizarPremissas', () => {
  it('sem entrada volta ao padrão', () => {
    expect(sanitizarPremissas(null)).toEqual(PREMISSAS_PADRAO);
  });
  it('aceita números válidos, limita faixas e ignora chaves estranhas', () => {
    const s = sanitizarPremissas({ pesos: { re60: '50', lpf: 250, x: 1 }, ajustes: { cb: -3 }, metas: { re9: 14, aov9: 'abc' }, outro: 1 });
    expect(s.pesos).toEqual({ re60: 50, lpf: 100, fes: 20, aov: 10 });
    expect(s.ajustes.cb).toBe(0);
    expect(s.metas.re9).toBe(14);
    expect(s.metas.aov9).toBe(410);
    expect(s).not.toHaveProperty('outro');
  });
});

describe('parseContas / isDiaIso', () => {
  it('valida as contas e remove repetidas', () => {
    expect(parseContas('JVZoo 1, Vupim abc,JVZoo 1,Digistore 2,JVZoo 1;DROP')).toEqual(['JVZoo 1', 'Vupim abc']);
    expect(parseContas(null)).toEqual([]);
  });
  it('aceita só AAAA-MM-DD', () => {
    expect(isDiaIso('2026-11-04')).toBe(true);
    expect(isDiaIso('04/11/2026')).toBe(false);
    expect(isDiaIso(null)).toBe(false);
  });
});
