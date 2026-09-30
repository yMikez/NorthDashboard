import { describe, expect, it } from 'vitest';
import { SKILL_TOOL_MODULE, getDefinitions, loadSkill } from './skillTools';
import { SKILLS, SKILL_NAMES } from '../chat/skills.generated';
import { GLOSSARY, GLOSSARY_KEYS, searchGlossary } from './glossary';

describe('load_skill', () => {
  it('devolve nome, versão, título e corpo do playbook', async () => {
    const r = await loadSkill({ name: 'diagnostico-variacao' });
    expect(r).toEqual({
      name: 'diagnostico-variacao',
      version: SKILLS['diagnostico-variacao'].version,
      title: SKILLS['diagnostico-variacao'].title,
      body: SKILLS['diagnostico-variacao'].body,
    });
  });

  it('tolera caixa e espaços (o modelo às vezes manda assim)', async () => {
    const r = await loadSkill({ name: '  Arquivo-Anexado ' });
    expect(r).toMatchObject({ name: 'arquivo-anexado' });
  });

  it('nome desconhecido → invalid_input com os válidos', async () => {
    const r = await loadSkill({ name: 'queda_receita' });
    expect(r).toMatchObject({ error: 'invalid_input', retryable: false });
    expect((r as { validValues: readonly string[] }).validValues).toEqual(SKILL_NAMES);
    expect(await loadSkill({})).toMatchObject({ error: 'invalid_input' });
  });

  it('handler do módulo é o mesmo caminho', async () => {
    const r = await SKILL_TOOL_MODULE.handlers.load_skill({ name: 'saude-funil' }, {});
    expect(r).toMatchObject({ name: 'saude-funil' });
  });
});

describe('get_definitions', () => {
  it('termos exatos → definições completas na ordem pedida', async () => {
    const r = (await getDefinitions({ terms: ['net_aov', 'cpa_negotiated'] })) as { definitions: Array<{ key: string; formula: string | null; whereToRead: readonly string[]; pitfalls: readonly string[]; unit: string }> };
    expect(r.definitions.map((d) => d.key)).toEqual(['net_aov', 'cpa_negotiated']);
    expect(r.definitions[0].formula).toContain('reserva%');
    expect(r.definitions[0].whereToRead).toContain('get_affiliates.affiliates[].netAovUsd');
    expect(r.definitions[1].pitfalls.join(' ')).toMatch(/média nem moda/);
  });

  it('rótulo no lugar da chave é resolvido pela busca; o que não existe vai em notFound', async () => {
    const r = (await getDefinitions({ terms: ['take rate', 'xyzzy'] })) as { definitions: Array<{ key: string }>; notFound?: string[] };
    expect(r.definitions.map((d) => d.key)).toEqual(['take_rate']);
    expect(r.notFound).toEqual(['xyzzy']);
  });

  it('search livre, sem acento e em PT/EN', async () => {
    const pt = (await getDefinitions({ search: 'Reembolsó' })) as { definitions: Array<{ key: string }> };
    expect(pt.definitions.map((d) => d.key)).toContain('refund_cash');
    const en = (await getDefinitions({ search: 'chargeback' })) as { definitions: Array<{ key: string }> };
    expect(en.definitions[0].key).toBe('chargeback');
  });

  it('sem termos nem busca → catálogo de chaves', async () => {
    const r = (await getDefinitions({})) as { catalog: Array<{ key: string; label: string }> };
    expect(r.catalog.map((c) => c.key)).toEqual(GLOSSARY_KEYS);
    expect(r.catalog[0].label).toBe(GLOSSARY[GLOSSARY_KEYS[0]].label);
  });

  it('nada encontrado → lista vazia + termos válidos (não inventa)', async () => {
    const r = (await getDefinitions({ search: 'qwertyuiop' })) as { definitions: unknown[]; notFound: string[]; validTerms: string[] };
    expect(r.definitions).toEqual([]);
    expect(r.notFound).toEqual(['qwertyuiop']);
    expect(r.validTerms).toEqual(GLOSSARY_KEYS);
  });

  it('teto de termos por chamada', async () => {
    const r = await getDefinitions({ terms: GLOSSARY_KEYS.slice(0, 13) });
    expect(r).toMatchObject({ error: 'invalid_input' });
  });
});

describe('searchGlossary', () => {
  it('chave/alias exato vence menção na definição', () => {
    expect(searchGlossary('epc')[0]).toBe('unavailable');
    expect(searchGlossary('epo')[0]).toBe('epo');
    expect(searchGlossary('allowance')[0]).toBe('allowance');
    expect(searchGlossary('salesbound')[0]).toBe('call_center');
  });

  it('determinístico e limitado', () => {
    expect(searchGlossary('lucro')).toEqual(searchGlossary('lucro'));
    expect(searchGlossary('a', 3).length).toBeLessThanOrEqual(3);
    expect(searchGlossary('   ')).toEqual([]);
  });
});
