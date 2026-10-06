import { beforeEach, describe, expect, it, vi } from 'vitest';

const findAffiliates = vi.fn();
const findPartners = vi.fn();
const findProducts = vi.fn();
// O catálogo sai das mesmas fontes de produção (filterOptions, grafias do
// banco, dicionário dinâmico, espelho do NorthScale Afiliados) — mockadas.
vi.mock('../db', async () => {
  const { TEST_CATALOG: c } = await import('./entities.fixture');
  return {
    db: {
      affiliate: { findMany: (...a: unknown[]) => findAffiliates(...a) },
      affiliatePartner: { findMany: (...a: unknown[]) => findPartners(...a) },
      product: {
        findMany: (...a: unknown[]) => findProducts(...a),
        groupBy: async () => c.familySpellings.map((f) => ({ family: f.value, _count: { _all: f.skus } })),
      },
      affiliateMappingState: { findMany: async () => c.nsAffiliates.map((a) => ({ affiliateId: a.id, name: a.name })) },
      // contagem de pedidos por affiliate_id do NorthScale Afiliados (catálogo da IA)
      order: { groupBy: async () => c.nsAffiliates.filter((a) => a.orders > 0).map((a) => ({ mappedAffiliateId: a.id, _count: { _all: a.orders } })) },
    },
  };
});
vi.mock('../services/filterOptions', async () => {
  const { TEST_CATALOG: c } = await import('./entities.fixture');
  return {
    getFilterOptions: async () => ({
      platforms: c.platforms.map((p) => ({ id: p.slug, label: p.label, isActive: true })),
      families: c.mainFamilies.map((f) => ({ id: f, label: f, feSkuCount: 1, totalSkuCount: 1, niches: [] })),
      funnels: [],
      countries: c.countries.map((x) => ({ id: x.code, label: x.code, orderCount: x.orders })),
      affiliates: c.nsAffiliates.filter((a) => a.orders > 0).map((a) => ({ id: a.id, label: a.name, status: 'active', removed: false, orderCount: a.orders })),
    }),
  };
});
vi.mock('../services/familyDictionary', () => ({ getDynamicFamilyEntries: async () => [] }));

import { catalogCandidates, loadScopeCatalog, matchCountry, matchFamily, matchPlatform, matchStage, normText, resolveEntities, similarity, ENTITY_KINDS } from './entities';
import { TEST_CATALOG } from './entities.fixture';

describe('matchers puros', () => {
  it('normText tira acento, caixa e pontuação', () => {
    expect(normText('Recuperação Neuro-Mind Pró')).toBe('recuperacaoneuromindpro');
  });

  it('plataforma: slug, rótulo e sinônimos (cb/d24/bg/cp/jvz)', () => {
    const p = TEST_CATALOG.platforms;
    expect(matchPlatform('digistore', p)).toBe('digistore24');
    expect(matchPlatform('D24', p)).toBe('digistore24');
    expect(matchPlatform('Digistore24', p)).toBe('digistore24');
    expect(matchPlatform('cb', p)).toBe('clickbank');
    expect(matchPlatform('Buy Goods', p)).toBe('buygoods');
    expect(matchPlatform('jvz', p)).toBe('jvzoo');
    expect(matchPlatform('cp', p)).toBe('cartpanda');
    expect(matchPlatform('shopify', p)).toBeNull();
    // Sinônimo de plataforma que não existe no banco não vale.
    expect(matchPlatform('cb', [{ slug: 'digistore24', label: 'Digistore24' }])).toBeNull();
  });

  it('família: exata (todas as grafias), alias do classificador, typo — NeuroPulsePro ≠ NeuroMindPro', () => {
    expect(matchFamily('neuromindpro', TEST_CATALOG)).toMatchObject({ values: ['NeuroMindPro'], how: 'exact' });
    expect(matchFamily('Neuro Mind', TEST_CATALOG)).toMatchObject({ values: ['NeuroMindPro'], how: 'alias' });
    expect(matchFamily('neuro pulse', TEST_CATALOG)).toMatchObject({ values: ['NeuroPulsePro'], how: 'alias' });
    expect(matchFamily('NeuroPulse Pro', TEST_CATALOG)).toMatchObject({ values: ['NeuroPulsePro'], how: 'exact' });
    expect(matchFamily('lumicept', TEST_CATALOG)).toMatchObject({ values: ['Lumicept', 'LumiCept'], canonical: 'Lumicept' });
    expect(matchFamily('Lumicept Gummies', TEST_CATALOG)).toMatchObject({ values: ['Lumicept Gummies'] });
    expect(matchFamily('NeuroMindPor', TEST_CATALOG)).toMatchObject({ values: ['NeuroMindPro'], how: 'fuzzy' });
    expect(matchFamily('xyz', TEST_CATALOG)).toBeNull();
    // Texto maior que a família não vira a família por substring.
    expect(matchFamily('NeuroMindPro Max Ultra Bundle', TEST_CATALOG)).toBeNull();
  });

  it('família conhecida pelo classificador mas sem SKU no banco', () => {
    expect(matchFamily('ProstaFlow', TEST_CATALOG)).toMatchObject({ values: ['ProstaFlow'], inCatalog: false });
  });

  it('similaridade', () => {
    expect(similarity('abc', 'abc')).toBe(1);
    expect(similarity('neuropulsepro', 'neuromindpro')).toBeLessThan(0.7);
  });

  it('país ISO-2 e sinônimos; inventado = null', () => {
    expect(matchCountry('us')).toEqual({ code: 'US' });
    expect(matchCountry('USA')).toEqual({ code: 'US' });
    expect(matchCountry('EUA')).toEqual({ code: 'US' });
    expect(matchCountry('UK')).toEqual({ code: 'GB' });
    expect(matchCountry('Alemanha')).toEqual({ code: 'DE' });
    expect(matchCountry('XX')).toBeNull();
  });

  it('etapa pelos rótulos da querystring', () => {
    expect(matchStage('front')).toBe('FRONTEND');
    expect(matchStage('up')).toBe('UPSELL');
    expect(matchStage('recuperação')).toBe('SMS_RECOVERY');
    expect(matchStage('UP1')).toBeNull();
  });
});

describe('catálogo', () => {
  it('monta das fontes de produção (e bate com a fixture)', async () => {
    const c = await loadScopeCatalog();
    expect(c.platforms).toEqual(TEST_CATALOG.platforms);
    expect(c.familySpellings).toEqual(TEST_CATALOG.familySpellings);
    expect(c.nsAffiliates).toEqual(TEST_CATALOG.nsAffiliates);
    expect(c.countries).toEqual(TEST_CATALOG.countries);
  });
});

describe('resolve_entities', () => {
  beforeEach(() => {
    findAffiliates.mockReset().mockResolvedValue([]);
    findPartners.mockReset().mockResolvedValue([]);
    findProducts.mockReset().mockResolvedValue([]);
  });

  it('"CB" é ambíguo: ClickBank (plataforma) ou chargeback (status)', () => {
    const c = catalogCandidates('CB', TEST_CATALOG, new Set(ENTITY_KINDS));
    expect(c.map((x) => [x.kind, x.value])).toEqual([['platform', 'clickbank'], ['status', 'CHARGEBACK']]);
    expect(c[0].use).toEqual({ platforms: ['clickbank'] });
    expect(c[1].use).toEqual({ status: 'CHARGEBACK' });
  });

  it('família, país e afiliado do sistema devolvem os argumentos exatos', () => {
    const fam = catalogCandidates('neuro pulse', TEST_CATALOG, new Set(['family']));
    expect(fam[0]).toMatchObject({ kind: 'family', value: 'NeuroPulsePro', use: { families: ['NeuroPulsePro'] } });
    const lumi = catalogCandidates('lumicept', TEST_CATALOG, new Set(['family']));
    expect(lumi[0].use).toEqual({ families: ['Lumicept', 'LumiCept'] });
    expect(catalogCandidates('eua', TEST_CATALOG, new Set(['country']))[0]).toMatchObject({ value: 'US', detail: { orders: 1000 } });
    expect(catalogCandidates('nitro', TEST_CATALOG, new Set(['ns_affiliate']))[0]).toMatchObject({ value: 'aff_1', use: { affiliate_ids: ['aff_1'] } });
  });

  it('contas de plataforma, parceiros e SKUs vêm do banco com `use` e `drill`', async () => {
    findAffiliates.mockResolvedValue([
      { externalId: 'fenix2025', nickname: 'Fenix', lastOrderAt: new Date('2026-09-29T12:00:00Z'), mappedAffiliateId: 'aff_9', partnerId: 'p1', platform: { slug: 'digistore24' } },
    ]);
    findPartners.mockResolvedValue([
      { id: 'p1', displayName: 'Fenix Group', affiliates: [{ externalId: 'fenix2025', mappedAffiliateId: 'aff_9', platform: { slug: 'digistore24' } }] },
    ]);
    findProducts.mockResolvedValue([{ externalId: 'NM-FE-6', name: 'NeuroMindPro 6', family: 'NeuroMindPro', productType: 'FRONTEND', platform: { slug: 'clickbank' } }]);
    const [r] = await resolveEntities(['fenix2025'], undefined, 8);
    const account = r.candidates.find((c) => c.kind === 'affiliate_account')!;
    expect(account).toMatchObject({
      value: 'digistore24:fenix2025', score: 0.95, use: { affiliate_ids: ['aff_9'] },
      drill: { tool: 'get_affiliate_detail', args: { external_id: 'fenix2025', platform: 'digistore24' } },
      detail: { partnerKey: 'partner:p1' },
    });
    const partner = r.candidates.find((c) => c.kind === 'partner')!;
    expect(partner.drill).toEqual({ tool: 'get_affiliate_explain', args: { key: 'partner:p1' } });
    expect(r.candidates.find((c) => c.kind === 'product')?.use).toEqual({ products: ['NM-FE-6'], platforms: ['clickbank'] });
  });

  it('nota de ambiguidade pra CB e nota de "nada encontrado"', async () => {
    const [cb, nada] = await resolveEntities(['CB', 'qwertyuiop'], undefined, 8);
    expect(cb.ambiguous).toBe(true);
    expect(cb.note).toMatch(/chargeback/);
    expect(nada.candidates).toEqual([]);
    expect(nada.note).toMatch(/nada encontrado/);
  });

  it('kinds restringe as consultas', async () => {
    await resolveEntities(['nitro'], ['ns_affiliate'], 5);
    expect(findAffiliates).not.toHaveBeenCalled();
    expect(findProducts).not.toHaveBeenCalled();
  });
});
