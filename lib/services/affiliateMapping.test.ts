import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyAffiliateState, backfillAffiliateMapping, invalidateMappingIndex, resolveAccounts, resolveForIngest,
  type MappingAccount, type MappingRepo, type StoredState, type UnmappedMeta,
} from './affiliateMapping';
import { candidateExternalIds, mappingKey, type AffiliateStateInput, type Pair, type StatePlan } from './affiliateMappingCore';

// ---------------------------------------------------------------------
// Repositório em memória — mesma semântica do Prisma (UNIQUE em
// (platform, external_id), updateMany só onde difere, fila por par).
// ---------------------------------------------------------------------
interface FakeOrder { id: string; accountId: string; externalId: string; orderedAt: Date; mapped: string | null }
interface FakeUnmapped { platform: string; externalId: string; altExternalId: string | null; nickname: string | null; accountId: string | null; eventId: string | null; first: Date; last: Date; count: number }

function fakeRepo() {
  const states = new Map<string, { name: string; status: string; occurredAt: Date; syncedAt: Date; removedAt: Date | null }>();
  const mappings = new Map<string, { platform: string; externalId: string; affiliateId: string }>();
  const accounts: MappingAccount[] = [];
  const orders: FakeOrder[] = [];
  const unmapped = new Map<string, FakeUnmapped>();
  const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

  const repo: MappingRepo & { states: typeof states; mappings: typeof mappings; accounts: MappingAccount[]; orders: FakeOrder[]; unmapped: typeof unmapped; addAccount: (a: MappingAccount) => void; addOrder: (o: FakeOrder) => void } = {
    states, mappings, accounts, orders, unmapped,
    addAccount: (a) => { accounts.push(a); },
    addOrder: (o) => { orders.push(o); },
    async loadIndexRows() { return [...mappings.values()]; },
    async getState(affiliateId): Promise<StoredState | null> {
      const s = states.get(affiliateId);
      if (!s) return null;
      return { affiliateId, name: s.name, status: s.status, occurredAt: s.occurredAt, platforms: [...mappings.values()].filter((m) => m.affiliateId === affiliateId).map(({ platform, externalId }) => ({ platform, externalId })) };
    },
    async applyState(state: AffiliateStateInput, plan: StatePlan, now: Date) {
      states.set(state.affiliateId, { name: state.name, status: state.status, occurredAt: state.occurredAt, syncedAt: now, removedAt: null });
      for (const p of plan.removed) mappings.delete(mappingKey(p.platform, p.externalId));
      const transferred: Pair[] = [];
      for (const p of state.platforms) {
        const k = mappingKey(p.platform, p.externalId);
        const ex = mappings.get(k);
        if (ex && ex.affiliateId !== state.affiliateId) transferred.push(p);
        mappings.set(k, { platform: p.platform, externalId: p.externalId, affiliateId: state.affiliateId });
      }
      return { transferred };
    },
    async touchState(affiliateId, now) { const s = states.get(affiliateId); if (s) s.syncedAt = now; },
    async findAccountsByPairs(pairs) {
      const wanted = new Set(pairs.map((p) => mappingKey(p.platform, p.externalId)));
      return accounts.filter((a) => wanted.has(mappingKey(a.platformSlug, norm(a.externalId))) || wanted.has(mappingKey(a.platformSlug, norm(a.nickname))));
    },
    async listAccounts(platforms) { return accounts.filter((a) => platforms.includes(a.platformSlug)); },
    async setAccountMapped(accountId, mapped) { const a = accounts.find((x) => x.id === accountId); if (a) a.mappedAffiliateId = mapped; },
    async updateOrdersMapped(accountIds, mapped) {
      let n = 0;
      for (const o of orders) if (accountIds.includes(o.accountId) && o.mapped !== mapped) { o.mapped = mapped; n++; }
      return n;
    },
    async countOrdersByAccounts(accountIds) {
      const out = new Map<string, { count: number; first: Date | null; last: Date | null; lastExternalId: string | null }>();
      for (const id of accountIds) {
        const os = orders.filter((o) => o.accountId === id).sort((a, b) => a.orderedAt.getTime() - b.orderedAt.getTime());
        if (os.length) out.set(id, { count: os.length, first: os[0].orderedAt, last: os[os.length - 1].orderedAt, lastExternalId: os[os.length - 1].externalId });
      }
      return out;
    },
    async upsertUnmapped(entry, meta: UnmappedMeta) {
      const k = mappingKey(entry.platform, entry.externalId);
      const ex = unmapped.get(k);
      if (!ex) {
        unmapped.set(k, { ...entry, nickname: meta.nickname, accountId: meta.affiliateAccountId, eventId: meta.eventId, first: meta.at, last: meta.at, count: meta.count === 'increment' ? 1 : meta.count });
        return;
      }
      ex.last = meta.at > ex.last ? meta.at : ex.last;
      ex.eventId = meta.eventId ?? ex.eventId;
      ex.count = meta.count === 'increment' ? ex.count + 1 : Math.max(ex.count, meta.count);
    },
    async deleteUnmapped(pairs) { let n = 0; for (const p of pairs) if (unmapped.delete(mappingKey(p.platform, p.externalId))) n++; return n; },
    async deleteUnmappedByAccounts(accountIds) { let n = 0; for (const [k, u] of unmapped) if (u.accountId && accountIds.includes(u.accountId)) { unmapped.delete(k); n++; } return n; },
  };
  return repo;
}

const at = (s: string) => new Date(s);
const MARIA: AffiliateStateInput = {
  affiliateId: 'aff_maria', name: 'Maria Silva', status: 'active', occurredAt: at('2026-09-12T13:37:00.123Z'),
  platforms: [
    { platform: 'buygoods', externalId: 'mariasilva' },
    { platform: 'buygoods', externalId: 'ms8841' },
    { platform: 'digistore24', externalId: 'maria_ds' },
    { platform: 'jvzoo', externalId: '1234567' },
  ],
};

describe('resolveForIngest — resolução no webhook de venda', () => {
  let repo: ReturnType<typeof fakeRepo>;
  beforeEach(() => { repo = fakeRepo(); invalidateMappingIndex(); });

  it('mapeado → affiliate_id e cache na conta', async () => {
    await applyAffiliateState(MARIA, {}, repo);
    repo.addAccount({ id: 'acc1', platformSlug: 'buygoods', externalId: 'MS8841', nickname: 'Maria', mappedAffiliateId: null });
    const id = await resolveForIngest('buygoods', { externalId: 'MS8841', nickname: 'Maria' }, { accountId: 'acc1', orderExternalId: 'o1', at: at('2026-09-12T10:00:00Z'), currentMapped: null }, repo);
    expect(id).toBe('aff_maria');
    expect(repo.accounts[0].mappedAffiliateId).toBe('aff_maria');
    expect(repo.unmapped.size).toBe(0);
  });

  it('não mapeado → null e entra na fila com contador; segundo evento incrementa e atualiza last_seen/event_id', async () => {
    repo.addAccount({ id: 'acc9', platformSlug: 'digistore24', externalId: '3956536', nickname: 'edugodoy16235294', mappedAffiliateId: null });
    const ctx = { accountId: 'acc9', orderExternalId: 'D-1', at: at('2026-09-10T10:00:00Z'), currentMapped: null };
    expect(await resolveForIngest('digistore24', { externalId: '3956536', nickname: 'edugodoy16235294' }, ctx, repo)).toBeNull();
    expect(await resolveForIngest('digistore24', { externalId: '3956536', nickname: 'edugodoy16235294' }, { ...ctx, orderExternalId: 'D-2', at: at('2026-09-11T10:00:00Z') }, repo)).toBeNull();
    const row = repo.unmapped.get('digistore24:edugodoy16235294');
    expect(row).toMatchObject({ platform: 'digistore24', externalId: 'edugodoy16235294', altExternalId: '3956536', accountId: 'acc9', eventId: 'D-2', count: 2 });
    expect(row?.first.toISOString()).toBe('2026-09-10T10:00:00.000Z');
    expect(row?.last.toISOString()).toBe('2026-09-11T10:00:00.000Z');
  });

  it('plataforma fora do contrato nunca resolve nem enfileira', async () => {
    expect(await resolveForIngest('clickbank', { externalId: 'x', nickname: null }, { accountId: 'a', orderExternalId: 'o', at: new Date(), currentMapped: null }, repo)).toBeNull();
    expect(repo.unmapped.size).toBe(0);
  });

  it('ID que saiu do mapping: venda NOVA não herda o dono antigo — fica sem affiliate_id, cache da conta zera e entra na fila', async () => {
    repo.addAccount({ id: 'acc2', platformSlug: 'jvzoo', externalId: '777', nickname: 'Zé', mappedAffiliateId: 'aff_old' });
    const id = await resolveForIngest('jvzoo', { externalId: '777', nickname: 'Zé' }, { accountId: 'acc2', orderExternalId: 'J1', at: new Date(), currentMapped: 'aff_old' }, repo);
    expect(id).toBeNull();
    expect(repo.accounts[0].mappedAffiliateId).toBeNull();
    expect(repo.unmapped.has('jvzoo:777')).toBe(true);
  });

  it('erro de banco não derruba o IPN (devolve o que já havia)', async () => {
    repo.loadIndexRows = async () => { throw new Error('db down'); };
    const id = await resolveForIngest('jvzoo', { externalId: '1', nickname: null }, { accountId: 'a', orderExternalId: 'o', at: new Date(), currentMapped: 'keep' }, repo);
    expect(id).toBe('keep');
  });
});

describe('applyAffiliateState — webhook affiliate.updated / item do mapping', () => {
  let repo: ReturnType<typeof fakeRepo>;
  beforeEach(() => { repo = fakeRepo(); invalidateMappingIndex(); });

  it('primeiro evento cria o afiliado com o conjunto inteiro', async () => {
    const r = await applyAffiliateState(MARIA, {}, repo);
    expect(r.action).toBe('apply');
    expect(r.added).toHaveLength(4);
    expect(repo.states.get('aff_maria')).toMatchObject({ name: 'Maria Silva', status: 'active' });
    expect([...repo.mappings.keys()].sort()).toEqual(['buygoods:mariasilva', 'buygoods:ms8841', 'digistore24:maria_ds', 'jvzoo:1234567']);
  });

  it('replay da mesma entrega → unchanged; evento mais antigo → stale (nada muda)', async () => {
    await applyAffiliateState(MARIA, {}, repo);
    expect((await applyAffiliateState(MARIA, {}, repo)).action).toBe('unchanged');
    const older = { ...MARIA, name: 'Nome Velho', occurredAt: at('2026-09-12T13:00:00.000Z'), platforms: [] };
    expect((await applyAffiliateState(older, {}, repo)).action).toBe('stale');
    expect(repo.states.get('aff_maria')?.name).toBe('Maria Silva');
    expect(repo.mappings.size).toBe(4);
  });

  it('estado mais novo SUBSTITUI o conjunto (troca de ID: antigo sai, novo entra) e muda status', async () => {
    await applyAffiliateState(MARIA, {}, repo);
    const newer: AffiliateStateInput = {
      ...MARIA, status: 'inactive', occurredAt: at('2026-09-12T14:00:00.000Z'),
      platforms: [{ platform: 'buygoods', externalId: 'ms8841' }, { platform: 'jvzoo', externalId: '7654321' }],
    };
    const r = await applyAffiliateState(newer, {}, repo);
    expect(r.action).toBe('apply');
    expect(r.added).toEqual([{ platform: 'jvzoo', externalId: '7654321' }]);
    expect(r.removed.map((p) => p.externalId).sort()).toEqual(['1234567', 'maria_ds', 'mariasilva']);
    expect([...repo.mappings.keys()].sort()).toEqual(['buygoods:ms8841', 'jvzoo:7654321']);
    expect(repo.states.get('aff_maria')?.status).toBe('inactive');
  });

  it('reprocessa automaticamente: pedidos da fila ganham affiliate_id e a fila esvazia', async () => {
    // Venda chegou ANTES do mapeamento → fila.
    repo.addAccount({ id: 'acc1', platformSlug: 'buygoods', externalId: '5555', nickname: 'MariaSilva', mappedAffiliateId: null });
    repo.addOrder({ id: 'o1', accountId: 'acc1', externalId: 'BG-1', orderedAt: at('2026-09-01T00:00:00Z'), mapped: null });
    repo.addOrder({ id: 'o2', accountId: 'acc1', externalId: 'BG-2', orderedAt: at('2026-09-02T00:00:00Z'), mapped: null });
    expect(await resolveForIngest('buygoods', { externalId: '5555', nickname: 'MariaSilva' }, { accountId: 'acc1', orderExternalId: 'BG-2', at: at('2026-09-02T00:00:00Z'), currentMapped: null }, repo)).toBeNull();
    expect(repo.unmapped.has('buygoods:5555')).toBe(true);
    // Mapeamento chega com o username (aff_name) — casa pelo segundo candidato.
    const r = await applyAffiliateState(MARIA, {}, repo);
    expect(r.reprocess).toMatchObject({ accounts: 1, resolved: 1, changed: 1, ordersUpdated: 2 });
    expect(repo.orders.every((o) => o.mapped === 'aff_maria')).toBe(true);
    expect(repo.accounts[0].mappedAffiliateId).toBe('aff_maria');
    expect(repo.unmapped.size).toBe(0);
  });

  it('ID transferido pra outro afiliado: pedidos da conta migram pro novo dono', async () => {
    await applyAffiliateState(MARIA, {}, repo);
    repo.addAccount({ id: 'acc1', platformSlug: 'jvzoo', externalId: '1234567', nickname: 'X', mappedAffiliateId: 'aff_maria' });
    repo.addOrder({ id: 'o1', accountId: 'acc1', externalId: 'J-1', orderedAt: at('2026-09-01T00:00:00Z'), mapped: 'aff_maria' });
    const joao: AffiliateStateInput = { affiliateId: 'aff_joao', name: 'João', status: 'active', occurredAt: at('2026-09-12T15:00:00.000Z'), platforms: [{ platform: 'jvzoo', externalId: '1234567' }] };
    const r = await applyAffiliateState(joao, {}, repo);
    expect(r.transferred).toEqual([{ platform: 'jvzoo', externalId: '1234567' }]);
    expect(repo.mappings.get('jvzoo:1234567')?.affiliateId).toBe('aff_joao');
    expect(repo.orders[0].mapped).toBe('aff_joao');
    expect(repo.accounts[0].mappedAffiliateId).toBe('aff_joao');
  });

  it('retry depois de reprocesso falho: estado já gravado → unchanged, mas o reprocesso acontece (pedidos mapeados, fila limpa)', async () => {
    repo.addAccount({ id: 'acc1', platformSlug: 'jvzoo', externalId: '1234567', nickname: null, mappedAffiliateId: null });
    repo.addOrder({ id: 'o1', accountId: 'acc1', externalId: 'J-1', orderedAt: at('2026-09-01T00:00:00Z'), mapped: null });
    await resolveForIngest('jvzoo', { externalId: '1234567', nickname: null }, { accountId: 'acc1', orderExternalId: 'J-1', at: at('2026-09-01T00:00:00Z'), currentMapped: null }, repo);
    expect(repo.unmapped.has('jvzoo:1234567')).toBe(true);
    // 1ª entrega: estado commita, reprocesso estoura (erro transitório) → 500 → retry
    const original = repo.findAccountsByPairs;
    repo.findAccountsByPairs = async () => { throw new Error('db down'); };
    await expect(applyAffiliateState(MARIA, {}, repo)).rejects.toThrow('db down');
    expect(repo.states.has('aff_maria')).toBe(true);
    repo.findAccountsByPairs = original;
    // 2ª entrega (mesmo corpo): unchanged, e AINDA ASSIM reprocessa
    const r = await applyAffiliateState(MARIA, {}, repo);
    expect(r.action).toBe('unchanged');
    expect(r.reprocess).toMatchObject({ resolved: 1, ordersUpdated: 1 });
    expect(repo.orders[0].mapped).toBe('aff_maria');
    expect(repo.accounts[0].mappedAffiliateId).toBe('aff_maria');
    expect(repo.unmapped.size).toBe(0);
  });

  it('ID removido do afiliado: cache da conta zera, histórico dos pedidos fica', async () => {
    repo.addAccount({ id: 'acc1', platformSlug: 'jvzoo', externalId: '1234567', nickname: null, mappedAffiliateId: null });
    repo.addOrder({ id: 'o1', accountId: 'acc1', externalId: 'J-1', orderedAt: at('2026-09-01T00:00:00Z'), mapped: null });
    await applyAffiliateState(MARIA, {}, repo);
    expect(repo.accounts[0].mappedAffiliateId).toBe('aff_maria');
    expect(repo.orders[0].mapped).toBe('aff_maria');
    const without: AffiliateStateInput = { ...MARIA, occurredAt: at('2026-09-12T16:00:00.000Z'), platforms: MARIA.platforms.filter((p) => p.platform !== 'jvzoo') };
    const r = await applyAffiliateState(without, {}, repo);
    expect(r.removed).toEqual([{ platform: 'jvzoo', externalId: '1234567' }]);
    expect(repo.accounts[0].mappedAffiliateId).toBeNull();   // vendas novas não herdam
    expect(repo.orders[0].mapped).toBe('aff_maria');          // histórico preservado (§5.5)
  });

  it('deferReprocess pula o reprocesso (o sync faz um só no fim)', async () => {
    repo.addAccount({ id: 'acc1', platformSlug: 'jvzoo', externalId: '1234567', nickname: null, mappedAffiliateId: null });
    const r = await applyAffiliateState(MARIA, { deferReprocess: true }, repo);
    expect(r.reprocess).toBeNull();
    expect(repo.accounts[0].mappedAffiliateId).toBeNull();
  });
});

describe('backfillAffiliateMapping / resolveAccounts — histórico', () => {
  let repo: ReturnType<typeof fakeRepo>;
  beforeEach(() => { repo = fakeRepo(); invalidateMappingIndex(); });

  it('grava affiliate_id em todos os pedidos das contas mapeadas e enfileira as não mapeadas COM pedidos (count = nº de pedidos)', async () => {
    await applyAffiliateState(MARIA, { deferReprocess: true }, repo);
    repo.addAccount({ id: 'a1', platformSlug: 'digistore24', externalId: '111', nickname: 'Maria_DS', mappedAffiliateId: null });
    repo.addAccount({ id: 'a2', platformSlug: 'jvzoo', externalId: '999', nickname: 'Desconhecido', mappedAffiliateId: null });
    repo.addAccount({ id: 'a3', platformSlug: 'jvzoo', externalId: '888', nickname: 'Sem pedido', mappedAffiliateId: null });
    repo.addAccount({ id: 'a4', platformSlug: 'clickbank', externalId: 'cb', nickname: null, mappedAffiliateId: null });
    for (let i = 0; i < 3; i++) repo.addOrder({ id: `d${i}`, accountId: 'a1', externalId: `D-${i}`, orderedAt: at(`2026-08-0${i + 1}T00:00:00Z`), mapped: null });
    for (let i = 0; i < 2; i++) repo.addOrder({ id: `j${i}`, accountId: 'a2', externalId: `J-${i}`, orderedAt: at(`2026-08-1${i}T00:00:00Z`), mapped: null });

    const dry = await backfillAffiliateMapping({ dryRun: true }, repo);
    expect(dry).toMatchObject({ accounts: 3, resolved: 1, unresolved: 2, changed: 1, ordersUpdated: 0, queued: 0 });
    expect(repo.orders.every((o) => o.mapped === null)).toBe(true);

    const stats = await backfillAffiliateMapping({}, repo);
    expect(stats).toMatchObject({ accounts: 3, resolved: 1, unresolved: 2, changed: 1, ordersUpdated: 3, queued: 1 });
    expect(repo.orders.filter((o) => o.accountId === 'a1').every((o) => o.mapped === 'aff_maria')).toBe(true);
    expect(repo.unmapped.get('jvzoo:999')).toMatchObject({ accountId: 'a2', count: 2, eventId: 'J-1' });
    expect(repo.unmapped.has('jvzoo:888')).toBe(false); // sem pedido não interessa
  });

  it('é idempotente: segunda rodada não muda nada', async () => {
    await applyAffiliateState(MARIA, { deferReprocess: true }, repo);
    repo.addAccount({ id: 'a1', platformSlug: 'buygoods', externalId: 'ms8841', nickname: null, mappedAffiliateId: null });
    repo.addOrder({ id: 'o', accountId: 'a1', externalId: 'B', orderedAt: at('2026-08-01T00:00:00Z'), mapped: null });
    await backfillAffiliateMapping({}, repo);
    const again = await backfillAffiliateMapping({}, repo);
    expect(again).toMatchObject({ changed: 0, ordersUpdated: 0, queued: 0 });
  });

  it('candidatos usados no reprocesso são os mesmos do ingest', () => {
    const acc: MappingAccount = { id: 'x', platformSlug: 'buygoods', externalId: '12', nickname: 'Nick', mappedAffiliateId: null };
    expect(candidateExternalIds(acc.platformSlug, acc)).toEqual(['12', 'nick']);
  });

  it('resolveAccounts sem contas → zeros', async () => {
    expect(await resolveAccounts([], { enqueueUnresolved: true }, repo)).toMatchObject({ accounts: 0, resolved: 0 });
  });
});
