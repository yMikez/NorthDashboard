import { beforeEach, describe, expect, it, vi } from 'vitest';

const findMany = vi.fn();
const userFindMany = vi.fn();
vi.mock('../db', () => ({ db: {
  affiliate: { findMany: (...a: unknown[]) => findMany(...a) },
  user: { findMany: (...a: unknown[]) => userFindMany(...a) },
} }));

import { addAffiliateWhere, affiliateKeysParam, NO_AFFILIATE, resolveAffiliateAccounts, resolveAffiliateFilter } from './affiliateFilter';

describe('filtro "Afiliado" — chaves do param aff', () => {
  it('aceita só a:<conta>, p:<pessoa> e c:<captador>, sem repetição; lixo e link antigo caem fora', () => {
    expect(affiliateKeysParam('a:cl1,p:pa2,a:cl1, 3552295 ,x:1,a:,c:us1')).toEqual(['a:cl1', 'p:pa2', 'c:us1']);
    expect(affiliateKeysParam('ckzmapped1')).toBeUndefined(); // id antigo do NorthScale Afiliados
    expect(affiliateKeysParam('')).toBeUndefined();
    expect(affiliateKeysParam(null)).toBeUndefined();
  });
  it('"Nenhum" vence o resto', () => {
    expect(affiliateKeysParam('a:cl1,__NONE__')).toEqual(['__NONE__']);
  });
});

describe('filtro "Afiliado" — resolução pras contas', () => {
  beforeEach(() => findMany.mockReset());

  it('pessoa vira todas as contas dela; conta solta entra junto', async () => {
    findMany.mockResolvedValue([
      { id: 'acc_jv', externalId: '3615849', platform: { slug: 'jvzoo' } },
      { id: 'acc_bg', externalId: '62@12595', platform: { slug: 'buygoods' } },
      { id: 'acc_d24', externalId: 'skill99', platform: { slug: 'digistore24' } },
    ]);
    const ids = await resolveAffiliateFilter('p:partner1,a:acc_d24', null);
    expect(ids).toEqual(['acc_jv', 'acc_bg', 'acc_d24']);
    const where = findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ id: { in: ['acc_d24'] } }, { partnerId: { in: ['partner1'] } }]);
    const acc = await resolveAffiliateAccounts('p:partner1');
    expect(acc?.map((a) => `${a.platform}:${a.externalId}`)).toContain('buygoods:62@12595');
  });

  it('escolha que não acha conta ZERA (nunca vira "sem filtro"); sem param = sem filtro', async () => {
    findMany.mockResolvedValue([]);
    expect(await resolveAffiliateFilter('a:sumiu', null)).toEqual([NO_AFFILIATE]);
    expect(await resolveAffiliateFilter('__NONE__', null)).toEqual([NO_AFFILIATE]);
    expect(await resolveAffiliateFilter(null, null)).toBeUndefined();
    expect(findMany).toHaveBeenCalledTimes(1); // "Nenhum" nem consulta
  });

  it('carteira: Hunter só vê a dele; pedido fora dela zera; SL vê o squad; admin passa direto', async () => {
    const { invalidatePortfolioCache } = await import('../portfolio/scope');
    invalidatePortfolioCache();
    // Gerente g1 > SL s1 > Hunters h1, h2.
    userFindMany.mockResolvedValue([
      { id: 'g1', name: 'G', email: 'g@x', portfolioRole: 'AFF_MANAGER', portfolioParentId: null, region: 'Brasil', active: true },
      { id: 's1', name: 'S', email: 's@x', portfolioRole: 'SQUAD_LEADER', portfolioParentId: 'g1', region: null, active: true },
      { id: 'h1', name: 'H1', email: 'h1@x', portfolioRole: 'HUNTER', portfolioParentId: 's1', region: null, active: true },
      { id: 'h2', name: 'H2', email: 'h2@x', portfolioRole: 'HUNTER', portfolioParentId: 's1', region: null, active: true },
    ]);
    const owned: Record<string, string[]> = { h1: ['acc_h1'], h2: ['acc_h2'], s1: ['acc_s1'], g1: ['acc_g1'] };
    findMany.mockImplementation(async (args: { where: { partner?: { ownerUserId: { in: string[] } }; OR?: Array<{ id?: { in: string[] } }> } }) => {
      if (args.where.partner) return args.where.partner.ownerUserId.in.flatMap((u) => owned[u] ?? []).map((id) => ({ id }));
      const ids = (args.where.OR ?? []).flatMap((c) => c.id?.in ?? []);
      return ids.map((id) => ({ id, externalId: id, platform: { slug: 'jvzoo' } }));
    });
    const hunter = { id: 'h1', role: 'MEMBER', portfolioRole: 'HUNTER' as const };
    const sl = { id: 's1', role: 'MEMBER', portfolioRole: 'SQUAD_LEADER' as const };
    const gerente = { id: 'g1', role: 'MEMBER', portfolioRole: 'AFF_MANAGER' as const };

    expect(await resolveAffiliateFilter(null, hunter)).toEqual(['acc_h1']);
    expect(await resolveAffiliateFilter('a:acc_h2', hunter)).toEqual([NO_AFFILIATE]);
    expect((await resolveAffiliateFilter(null, sl))?.sort()).toEqual(['acc_h1', 'acc_h2', 'acc_s1']);
    expect((await resolveAffiliateFilter(null, gerente))?.sort()).toEqual(['acc_g1', 'acc_h1', 'acc_h2', 'acc_s1']);
    // Captador no filtro: o SL escolhe um Hunter; o Hunter não alcança o colega.
    expect(await resolveAffiliateFilter('c:h2', sl)).toEqual(['acc_h2']);
    expect(await resolveAffiliateFilter('c:h2', hunter)).toEqual([NO_AFFILIATE]);
    // Sem função (ou admin): sem recorte; c: funciona como filtro comum.
    expect(await resolveAffiliateFilter(null, { id: 'm', role: 'MEMBER', portfolioRole: null })).toBeUndefined();
    expect((await resolveAffiliateFilter('c:s1', { id: 'adm', role: 'ADMIN', portfolioRole: 'HUNTER' }))?.sort()).toEqual(['acc_h1', 'acc_h2', 'acc_s1']);
    findMany.mockReset();
    userFindMany.mockReset();
    invalidatePortfolioCache();
  });

  it('addAffiliateWhere soma ao AND sem pisar num affiliateId já presente', () => {
    const w: { affiliateId?: string; AND?: unknown } = { affiliateId: 'acc_x' };
    addAffiliateWhere(w, ['acc_x', 'acc_y']);
    expect(w).toEqual({ affiliateId: 'acc_x', AND: [{ affiliateId: { in: ['acc_x', 'acc_y'] } }] });
    const w2: { AND?: unknown } = { AND: { status: 'APPROVED' } };
    addAffiliateWhere(w2, ['a']);
    expect(w2.AND).toEqual([{ status: 'APPROVED' }, { affiliateId: { in: ['a'] } }]);
    const w3: { AND?: unknown } = {};
    addAffiliateWhere(w3, undefined);
    expect(w3).toEqual({});
  });
});
