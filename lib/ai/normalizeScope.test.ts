import { beforeEach, describe, expect, it, vi } from 'vitest';

const findProducts = vi.fn();
const findAffiliates = vi.fn();
const state = { catalogFails: false, catalogLoads: 0 };

vi.mock('../db', async () => {
  const { TEST_CATALOG: c } = await import('./entities.fixture');
  return {
    db: {
      product: {
        findMany: (...a: unknown[]) => findProducts(...a),
        groupBy: async () => c.familySpellings.map((f) => ({ family: f.value, _count: { _all: f.skus } })),
      },
      affiliate: { findMany: (...a: unknown[]) => findAffiliates(...a) },
      affiliateMappingState: { findMany: async () => c.nsAffiliates.map((a) => ({ affiliateId: a.id, name: a.name })) },
    },
  };
});
vi.mock('../services/filterOptions', async () => {
  const { TEST_CATALOG: c } = await import('./entities.fixture');
  return {
    getFilterOptions: async () => {
      state.catalogLoads += 1;
      if (state.catalogFails) throw new Error('db down');
      return {
        platforms: c.platforms.map((p) => ({ id: p.slug, label: p.label, isActive: true })),
        families: c.mainFamilies.map((f) => ({ id: f, label: f, feSkuCount: 1, totalSkuCount: 1, niches: [] })),
        funnels: [],
        countries: c.countries.map((x) => ({ id: x.code, label: x.code, orderCount: x.orders })),
        affiliates: c.nsAffiliates.filter((a) => a.orders > 0).map((a) => ({ id: a.id, label: a.name, status: 'active', removed: false, orderCount: a.orders })),
      };
    },
  };
});
vi.mock('../services/familyDictionary', () => ({ getDynamicFamilyEntries: async () => [] }));

import { normalizeScope } from './normalizeScope';

const norm = (input: Record<string, unknown>, tool = 'get_overview') => normalizeScope(tool, input);

describe('normalizeScope — sem banco', () => {
  it('sem catálogo: sinônimos/caixa/etapa seguem; validação por banco é pulada', async () => {
    state.catalogFails = true;
    const r = await norm({ platforms: ['d24'], countries: ['us'], stages: ['front'], families: ['qualquer'] });
    expect(r.input).toMatchObject({ platforms: ['digistore24'], countries: ['US'], stages: ['FRONTEND'], families: ['qualquer'] });
    await expect(norm({ platforms: ['shopify'] })).rejects.toThrow(/valid: clickbank, digistore24, buygoods, cartpanda, jvzoo/);
    state.catalogFails = false;
  });

  it('sem filtro de escopo não consulta nada', async () => {
    const before = state.catalogLoads;
    const r = await norm({ start_date: '2026-09-01', compare: true, platforms: [] });
    expect(r).toEqual({ input: { start_date: '2026-09-01', compare: true, platforms: [] }, notes: [] });
    expect(state.catalogLoads).toBe(before);
  });
});

describe('normalizeScope — com catálogo', () => {
  beforeEach(() => {
    findProducts.mockReset().mockResolvedValue([]);
    findAffiliates.mockReset().mockResolvedValue([]);
  });

  it('plataforma: sinônimos viram slug (lista e campo único), com nota; desconhecida = invalid_input com válidos', async () => {
    const r = await norm({ platforms: ['digistore', 'CB', 'clickbank'], platform: 'bg' });
    expect(r.input.platforms).toEqual(['digistore24', 'clickbank']);
    expect(r.input.platform).toBe('buygoods');
    expect(r.notes).toContain('platforms: "digistore" → "digistore24"');
    await expect(norm({ platforms: ['shopee'] })).rejects.toThrow(/^invalid_input: platforms: "shopee" não existe — valid: buygoods, cartpanda, clickbank, digistore24, jvzoo/);
  });

  it('família: caixa, alias, todas as grafias; NeuroPulsePro ≠ NeuroMindPro; desconhecida lista as válidas', async () => {
    const r = await norm({ families: ['neuromindpro', 'neuro pulse', 'lumicept'] });
    expect(r.input.families).toEqual(['NeuroMindPro', 'NeuroPulsePro', 'Lumicept', 'LumiCept']);
    expect(r.notes.join(' | ')).toMatch(/inclui as grafias Lumicept \+ LumiCept/);
    await expect(norm({ families: ['neuromid pro x'] })).rejects.toThrow(/invalid_input: families: .* — valid: GlycoPulse, Lumicept, Lumicept Gummies, NeuroMindPro, NeuroPulsePro/);
    const ghost = await norm({ families: ['ProstaFlow'] });
    expect(ghost.notes.join(' ')).toMatch(/sem SKU no catálogo/);
  });

  it('país: ISO-2 maiúsculo e sinônimos; código real sem venda vira nota; inventado vira erro', async () => {
    const r = await norm({ countries: ['us', 'Canada', 'UK'] });
    expect(r.input.countries).toEqual(['US', 'CA', 'GB']);
    expect(r.notes.join(' ')).toMatch(/nenhum pedido de GB/);
    await expect(norm({ countries: ['XX'] })).rejects.toThrow(/invalid_input: countries: "XX" .* valid: US, CA, AU/);
  });

  it('etapa: rótulos viram enum; UP1 é erro (antes o filtro sumia calado)', async () => {
    expect((await norm({ stages: ['fe', 'upsell', 'DW'] })).input.stages).toEqual(['FRONTEND', 'UPSELL', 'DOWNSELL']);
    await expect(norm({ stages: ['UP1'] })).rejects.toThrow(/invalid_input: stages: "UP1" não existe — valid: FRONTEND, UPSELL, DOWNSELL, BUMP, SMS_RECOVERY/);
    await expect(norm({ stages: ['FRONTEND', 'UP2'] })).rejects.toThrow(/"UP2"/);
  });

  it('SKU: caixa do catálogo; inexistente lista sugestões', async () => {
    findProducts.mockImplementation(async (args: { where: { externalId?: { equals: string }; OR?: unknown } }) => {
      if (args.where.externalId?.equals === 'nm-fe-6') return [{ externalId: 'NM-FE-6' }];
      if (args.where.OR) return [{ externalId: 'NM-FE-6' }, { externalId: 'NM-UP-3' }];
      return [];
    });
    const r = await norm({ products: ['nm-fe-6'] });
    expect(r.input.products).toEqual(['NM-FE-6']);
    await expect(norm({ products: ['NeuroMind'] })).rejects.toThrow(/valid: NM-FE-6, NM-UP-3/);
  });

  it('affiliate_ids: id conhecido, nome do afiliado, conta de plataforma mapeada; resto é erro', async () => {
    findAffiliates.mockImplementation(async (args: { where: { OR: Array<{ externalId?: { equals: string } }> } }) =>
      args.where.OR[0].externalId?.equals === 'fenix2025'
        ? [{ mappedAffiliateId: 'aff_9', externalId: 'fenix2025', platform: { slug: 'digistore24' } }]
        : []);
    const r = await norm({ affiliate_ids: ['aff_1', 'Nitro Company', 'fenix2025', 'aff_2'] });
    expect(r.input.affiliate_ids).toEqual(['aff_1', 'aff_9', 'aff_2']);
    expect(r.notes.join(' | ')).toMatch(/"fenix2025" é conta de plataforma \(digistore24:fenix2025\) → affiliate_id aff_9/);
    expect(r.notes.join(' | ')).toMatch(/aff_2 \(Sem Pedido\) não tem pedido mapeado/);
    await expect(norm({ affiliate_ids: ['ninguem'] })).rejects.toThrow(/invalid_input: affiliate_ids: "ninguem" .*aff_1 \(Nitro Company\)/);
  });

  it('compare_periods: normaliza os filtros aninhados com prefixo nas notas', async () => {
    const r = await norm({ tool: 'get_overview', filters: { platforms: ['d24'], families: ['glycopulse'] } }, 'compare_periods');
    expect(r.input.filters).toEqual({ platforms: ['digistore24'], families: ['GlycoPulse'] });
    expect(r.notes).toEqual(['filters.platforms: "d24" → "digistore24"', 'filters.families: "glycopulse" → "GlycoPulse"']);
  });
});
