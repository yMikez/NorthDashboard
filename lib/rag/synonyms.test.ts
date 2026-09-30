import { describe, expect, it } from 'vitest';
import { expandQueries, MAX_EXPANDED_QUERIES, mentionsDate, queryVariants } from './synonyms';
import { containsPii, foldForMatch, maskPii, normalizeText, stripRepeatedPageLines } from './normalize';

describe('expansão por sinônimos', () => {
  it('estorno ↔ reembolso ↔ refund e D24 → Digistore24 numa variante só', () => {
    const v = queryVariants('Estorno D24');
    expect(v).toHaveLength(1);
    expect(v[0].text).toBe('reembolso estorno refund digistore24 digistore');
    expect(v[0].weight).toBe(0.7);
    expect(v[0].original).toBe(false);
  });

  it('CB é ambíguo: uma variante ClickBank e uma chargeback, peso 0.5 cada', () => {
    const v = queryVariants('taxa de CB');
    expect(v.map((x) => x.text)).toEqual(['taxa de clickbank', 'taxa de chargeback']);
    expect(v.every((x) => x.weight === 0.5)).toBe(true);
  });

  it('FE, BG, CP, JVZ, contestação', () => {
    expect(queryVariants('AOV do FE na BG')[0].text).toBe('aov do front frontend fe na buygoods');
    expect(queryVariants('vendas CP')[0].text).toBe('vendas cartpanda');
    expect(queryVariants('funil JVZ')[0].text).toBe('funil jvzoo');
    expect(queryVariants('contestação')[0].text).toContain('chargeback');
  });

  it('sem termo conhecido não gera variante', () => {
    expect(queryVariants('régua do CRM')).toEqual([]);
  });

  it('originais primeiro (peso 1), dedup e teto de 6', () => {
    const out = expandQueries(['estorno D24', 'Estorno D24', 'CB em BG', 'fee JVZ', 'lucro CP']);
    expect(out.length).toBeLessThanOrEqual(MAX_EXPANDED_QUERIES);
    expect(out.slice(0, 4).every((q) => q.original && q.weight === 1)).toBe(true);
    expect(out.filter((q) => q.text.toLowerCase() === 'estorno d24')).toHaveLength(1);
  });

  it('detecta pergunta com data/período', () => {
    expect(mentionsDate('reembolso em setembro')).toBe(true);
    expect(mentionsDate('margem de 2026')).toBe(true);
    expect(mentionsDate('como calcula o NET AOV')).toBe(false);
  });
});

describe('normalização', () => {
  it('junta hifenização de PDF, tira zero-width e normaliza bullets', () => {
    expect(normalizeText('reem-\nbolso​ da  plataforma', { prose: true })).toBe('reembolso da plataforma');
    expect(normalizeText('• item')).toBe('- item');
    expect(normalizeText('Pós-\nVenda', { prose: true })).toBe('Pós-\nVenda');
  });

  it('remove cabeçalho/rodapé repetido só na borda da página', () => {
    const pages = [1, 2, 3].map((page) => ({ page, text: `ACME Relatório\nconteúdo ${page}\nACME Relatório no meio\nfim ${page}\nPágina ${page}` }));
    const out = stripRepeatedPageLines(pages);
    expect(out[0].text).not.toMatch(/^ACME Relatório\n/);
    expect(out[0].text).not.toContain('Página 1');
    expect(out[1].text).toContain('conteúdo 2');
  });

  it('máscara de PII sem pegar dinheiro, data ou id numérico', () => {
    const t = 'cliente joao@exemplo.com, tel +55 (11) 98888-7777, ip 10.0.0.12, total $12,345,678.90 em 2026-09-30, pedido 5511988887777';
    const m = maskPii(t);
    expect(m).toContain('[email]');
    expect(m).toContain('[telefone]');
    expect(m).toContain('[ip]');
    expect(m).toContain('$12,345,678.90');
    expect(m).toContain('2026-09-30');
    expect(m).toContain('5511988887777');
    expect(containsPii('sem nada pessoal aqui')).toBe(false);
  });

  it('intervalo de data e hora não vira telefone (preâmbulo de export)', () => {
    for (const t of [
      'Período 2026-09-01 00:00:00 - 2026-09-15 23:59:59',
      'De 01/09/2026 - 15/09/2026 10:00',
      'Report 2026-08-01 - 2026-08-31',
    ]) {
      expect(maskPii(t)).toBe(t);
    }
    expect(maskPii('ligar (11) 98765-4321')).toContain('[telefone]');
  });

  it('foldForMatch ignora acento, caixa, aspas e espaços', () => {
    expect(foldForMatch('  Frete “é” por   SESSÃO ')).toBe('frete "e" por sessao');
  });
});
