import { beforeEach, describe, expect, it, vi } from 'vitest';

// Banco falso em memória: só o que as ações da carteira tocam.
type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  users: [] as Row[], partners: [] as Row[], affiliates: [] as Row[], claims: [] as Row[], events: [] as Row[], seq: 0,
}));
const match = (r: Row, where: Row = {}) => Object.entries(where).every(([k, v]) => r[k] === v);
const fake = vi.hoisted(() => {
  const id = (p: string) => `${p}${++state.seq}`;
  return {
    user: { findMany: async () => state.users },
    affiliatePartner: {
      findUnique: async ({ where }: { where: Row }) => state.partners.find((p) => p.id === where.id) ?? null,
      create: async ({ data }: { data: Row }) => { const p = { id: id('p'), ownerUserId: null, ownerSince: null, ...data }; state.partners.push(p); return p; },
      update: async ({ where, data }: { where: Row; data: Row }) => { const p = state.partners.find((x) => x.id === where.id)!; Object.assign(p, data); return p; },
    },
    affiliate: {
      findUnique: async ({ where }: { where: Row }) => state.affiliates.find((a) => a.id === where.id) ?? null,
      update: async ({ where, data }: { where: Row; data: Row }) => { const a = state.affiliates.find((x) => x.id === where.id)!; Object.assign(a, data); return a; },
    },
    affiliateClaim: {
      findFirst: async ({ where }: { where: Row }) => state.claims.find((c) => match(c, where)) ?? null,
      findUnique: async ({ where }: { where: Row }) => state.claims.find((c) => c.id === where.id) ?? null,
      create: async ({ data }: { data: Row }) => { const c = { id: id('c'), status: 'PENDING', ...data }; state.claims.push(c); return c; },
      update: async ({ where, data }: { where: Row; data: Row }) => { const c = state.claims.find((x) => x.id === where.id)!; Object.assign(c, data); return c; },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => { const l = state.claims.filter((c) => match(c, where)); l.forEach((c) => Object.assign(c, data)); return { count: l.length }; },
    },
    affiliateOwnershipEvent: { create: async ({ data }: { data: Row }) => { state.events.push(data); return data; } },
  };
});
vi.mock('../db', () => {
  const db = { ...fake, $transaction: async (arg: unknown) => (typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(db) : Promise.all(arg as unknown[])) };
  return { db, dbRead: db };
});
vi.mock('../cache/responseCache', () => ({ clearResponseCache: () => {} }));

import { portfolioAction } from './service';
import { invalidatePortfolioCache } from './scope';

const user = (id: string, portfolioRole: string | null, portfolioParentId: string | null = null) =>
  ({ id, name: id.toUpperCase(), email: `${id}@x`, portfolioRole, portfolioParentId, region: null, active: true });
const as = (id: string, portfolioRole: 'AFF_MANAGER' | 'SQUAD_LEADER' | 'HUNTER' | null, role = 'MEMBER') => ({ id, role, portfolioRole });

beforeEach(() => {
  Object.assign(state, {
    users: [user('g1', 'AFF_MANAGER'), user('s1', 'SQUAD_LEADER', 'g1'), user('h1', 'HUNTER', 's1'), user('h2', 'HUNTER', 's1'),
      user('s2', 'SQUAD_LEADER', 'g1'), user('h3', 'HUNTER', 's2')],
    partners: [], claims: [], events: [], seq: 0,
    affiliates: [{ id: 'acc1', partnerId: null, nickname: 'Ana Afiliada', externalId: '3552295' }, { id: 'acc2', partnerId: null, nickname: null, externalId: '62@13457' }],
  });
  invalidatePortfolioCache();
});

describe('carteira — pedir e aprovar', () => {
  it('Hunter pede conta solta (vira pessoa); um pedido por vez; só o líder dele aprova', async () => {
    const { partnerId } = await portfolioAction(as('h1', 'HUNTER'), { action: 'claim', key: 'aff:acc1', note: 'trouxe pelo Instagram' });
    expect(state.partners).toMatchObject([{ id: partnerId, displayName: 'Ana Afiliada', ownerUserId: null }]);
    expect(state.affiliates[0].partnerId).toBe(partnerId);

    await expect(portfolioAction(as('h2', 'HUNTER'), { action: 'claim', key: `partner:${partnerId}` })).rejects.toThrow(/em análise/);
    const claimId = state.claims[0].id as string;
    // SL de outro squad e o próprio Hunter não aprovam.
    await expect(portfolioAction(as('s2', 'SQUAD_LEADER'), { action: 'approve', claimId })).rejects.toThrow(/líder/);
    await expect(portfolioAction(as('h1', 'HUNTER'), { action: 'approve', claimId })).rejects.toThrow(/líder/);

    await portfolioAction(as('s1', 'SQUAD_LEADER'), { action: 'approve', claimId, note: 'ok' });
    expect(state.partners[0]).toMatchObject({ ownerUserId: 'h1' });
    expect(state.claims[0]).toMatchObject({ status: 'APPROVED', decidedById: 's1' });
    expect(state.events).toMatchObject([{ partnerId, fromUserId: null, toUserId: 'h1', byUserId: 's1', kind: 'claim' }]);
    // Com dono, não se pede mais.
    await expect(portfolioAction(as('h2', 'HUNTER'), { action: 'claim', key: `partner:${partnerId}` })).rejects.toThrow(/já tem dono/);
  });

  it('operação (sem função) não pede: atribui direto', async () => {
    await expect(portfolioAction(as('op', null), { action: 'claim', key: 'aff:acc1' })).rejects.toThrow(/atribui direto/);
  });
});

describe('carteira — atribuir, transferir, liberar', () => {
  it('Hunter não atribui; SL atribui pro squad; SL de outro squad não transfere; Gerente transfere', async () => {
    await expect(portfolioAction(as('h1', 'HUNTER'), { action: 'assign', key: 'aff:acc2', ownerUserId: 'h1' })).rejects.toThrow(/abaixo de você/);
    const { partnerId } = await portfolioAction(as('s1', 'SQUAD_LEADER'), { action: 'assign', key: 'aff:acc2', ownerUserId: 'h2' });
    expect(state.partners.find((p) => p.id === partnerId)).toMatchObject({ ownerUserId: 'h2' });
    expect(state.events.at(-1)).toMatchObject({ kind: 'assign', toUserId: 'h2', byUserId: 's1' });

    await expect(portfolioAction(as('s2', 'SQUAD_LEADER'), { action: 'assign', key: `partner:${partnerId}`, ownerUserId: 'h3' }))
      .rejects.toThrow(/outra equipe/);
    await portfolioAction(as('g1', 'AFF_MANAGER'), { action: 'assign', key: `partner:${partnerId}`, ownerUserId: 'h3' });
    expect(state.events.at(-1)).toMatchObject({ kind: 'transfer', fromUserId: 'h2', toUserId: 'h3' });

    // Liberar: só quem está acima do dono.
    await expect(portfolioAction(as('s1', 'SQUAD_LEADER'), { action: 'release', key: `partner:${partnerId}` })).rejects.toThrow(/líder/);
    await portfolioAction(as('s2', 'SQUAD_LEADER'), { action: 'release', key: `partner:${partnerId}` });
    expect(state.partners.find((p) => p.id === partnerId)).toMatchObject({ ownerUserId: null });
  });

  it('atribuir resolve o pedido aberto e não aceita dono sem função', async () => {
    const { partnerId } = await portfolioAction(as('h1', 'HUNTER'), { action: 'claim', key: 'aff:acc1' });
    await expect(portfolioAction(as('op', null), { action: 'assign', key: `partner:${partnerId}`, ownerUserId: 'op' })).rejects.toThrow(/função ativa/);
    await portfolioAction(as('op', null), { action: 'assign', key: `partner:${partnerId}`, ownerUserId: 'h2' });
    expect(state.claims[0]).toMatchObject({ status: 'CANCELED' });
    expect(String(state.claims[0].decisionNote)).toMatch(/H2/);
  });
});
