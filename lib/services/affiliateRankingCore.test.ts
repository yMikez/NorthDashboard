import { describe, expect, it } from 'vitest';
import {
  CAMPOS, contaDe, empacotarPedidos, isDiaIso, mapearContas, montarPayload, parseContas, PREMISSAS_PADRAO, sanitizarPremissas,
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
  it('o nome real da plataforma vence o apelido provisório do cadastro', () => {
    const { nomes, parceiros } = mapearContas(
      [
        { slug: 'jvzoo', externalId: '3565681', nickname: 'xxxxxxUS', partnerId: null, partnerName: null },
        { slug: 'jvzoo', externalId: '2', nickname: 'Bia', partnerId: 'p2', partnerName: null },
      ],
      [
        { slug: 'jvzoo', externalId: '3565681', nickname: ' Fares Kellou ' },
        { slug: 'jvzoo', externalId: '2', nickname: '' },
        { slug: 'jvzoo', externalId: '9', nickname: 'Só no oficial' },
      ],
    );
    expect(nomes).toEqual({ 'JVZoo 3565681': 'Fares Kellou', 'JVZoo 2': 'Bia', 'JVZoo 9': 'Só no oficial' });
    expect(parceiros).toEqual({ 'JVZoo 2': ['p2', 'Bia'] });
  });
  it('converte entidades HTML dos nomes em acentos', () => {
    const { nomes, parceiros } = mapearContas(
      [{ slug: 'jvzoo', externalId: '5', nickname: null, partnerId: 'p5', partnerName: 'Jo&atilde;o &amp; Cia' }],
      [
        { slug: 'jvzoo', externalId: '4', nickname: 'Andr&eacute; Pupo' },
        { slug: 'jvzoo', externalId: '5', nickname: 'Lu&iacute;s M&#252;ller &amp;eacute;' },
        { slug: 'jvzoo', externalId: '6', nickname: 'Fran&ccedil;a &foo; R&D' },
      ],
    );
    expect(nomes).toEqual({ 'JVZoo 4': 'André Pupo', 'JVZoo 5': 'Luís Müller é', 'JVZoo 6': 'França &foo; R&D' });
    expect(parceiros).toEqual({ 'JVZoo 5': ['p5', 'João & Cia'] });
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

describe('empacotarPedidos', () => {
  const base = { conta: 'JVZoo 1', plataforma: 'JVZoo', fe_dia: '2026-10-01', dia: '2026-10-01', produto: 'NeuroRecall 6 Bottles - FE',
    bruto: 294, cpa: 150, reembolso: 0, reembolso_dia: null, taxa_alerta: 0, taxa_disputa: 0 };
  it('liga o upsell ao FE de origem e conta os dias desde o primeiro FE', () => {
    const p = empacotarPedidos([
      { ...base, venda_id: 'WP-1', fe_venda_id: 'WP-1', etapa: 'FE' },
      { ...base, venda_id: 'WP-2', fe_venda_id: 'WP-1', etapa: 'Upsell', produto: 'NeuroRecall 12 Bottles (Upgrade) - OTO1 (6B)', bruto: '348.5', cpa: null,
        reembolso: 348.5, reembolso_dia: '2026-10-05' },
      { ...base, conta: 'Vupim abc', plataforma: 'Vupim', venda_id: 'v9', fe_venda_id: 'WP-1', fe_dia: '2026-10-03', etapa: 'FE' },
    ]);
    expect(p.d0).toBe('2026-10-01');
    expect(p.col.fid).toEqual([0, 0, -1]);   // a conta Vupim procura o FE na Vupim: não acha
    expect(p.col.fe).toEqual([0, 0, 2]);
    expect(p.dic.etapa).toEqual(['FE', 'Upsell']);
    expect(p.col.et).toEqual([0, 1, 0]);
    expect(p.col.bruto[1]).toBe(348.5);
    expect(p.col.cpa[1]).toBe(0);
    expect(p.col.red).toEqual([null, '2026-10-05', null]);
    expect(p.dic.conta).toEqual(['JVZoo 1', 'Vupim abc']);
  });
  it('lista vazia não quebra', () => {
    expect(empacotarPedidos([]).col.af).toEqual([]);
  });
});
