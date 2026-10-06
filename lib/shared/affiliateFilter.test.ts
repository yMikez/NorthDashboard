import { beforeEach, describe, expect, it, vi } from 'vitest';

const findMany = vi.fn();
vi.mock('../db', () => ({ db: { affiliate: { findMany: (...a: unknown[]) => findMany(...a) } } }));

import { addAffiliateWhere, affiliateKeysParam, NO_AFFILIATE, resolveAffiliateAccounts, resolveAffiliateFilter } from './affiliateFilter';

describe('filtro "Afiliado" — chaves do param aff', () => {
  it('aceita só a:<conta> e p:<pessoa>, sem repetição; lixo e link antigo caem fora', () => {
    expect(affiliateKeysParam('a:cl1,p:pa2,a:cl1, 3552295 ,x:1,a:')).toEqual(['a:cl1', 'p:pa2']);
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
    const ids = await resolveAffiliateFilter('p:partner1,a:acc_d24');
    expect(ids).toEqual(['acc_jv', 'acc_bg', 'acc_d24']);
    const where = findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ id: { in: ['acc_d24'] } }, { partnerId: { in: ['partner1'] } }]);
    const acc = await resolveAffiliateAccounts('p:partner1');
    expect(acc?.map((a) => `${a.platform}:${a.externalId}`)).toContain('buygoods:62@12595');
  });

  it('escolha que não acha conta ZERA (nunca vira "sem filtro"); sem param = sem filtro', async () => {
    findMany.mockResolvedValue([]);
    expect(await resolveAffiliateFilter('a:sumiu')).toEqual([NO_AFFILIATE]);
    expect(await resolveAffiliateFilter('__NONE__')).toEqual([NO_AFFILIATE]);
    expect(await resolveAffiliateFilter(null)).toBeUndefined();
    expect(findMany).toHaveBeenCalledTimes(1); // "Nenhum" nem consulta
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
