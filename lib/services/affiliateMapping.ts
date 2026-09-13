// Espelho do mapeamento de afiliados (NorthScale Afiliados → dashboard) —
// camada de banco. Contrato: integration-dashboard.md.
//
//   affiliate_mapping_state   último estado aplicado por afiliado (occurred_at)
//   affiliate_mappings        (platform, external_id) → affiliate_id, UNIQUE
//   unmapped_affiliate_events fila do que chegou em venda e não tem mapeamento
//   Affiliate.mappedAffiliateId / Order.mappedAffiliateId  resolução gravada
//
// Fluxos:
//   ingest  → resolveForIngest(): índice em cache (60s) → affiliate_id ou fila
//   webhook/mapping → applyAffiliateState(): idempotente por occurred_at,
//             substitui o conjunto inteiro, reprocessa contas afetadas
//   backfill → backfillAffiliateMapping(): todas as contas das 3 plataformas
//
// O acesso ao banco passa por MappingRepo (interface) pra os testes rodarem
// com um repositório em memória — o Prisma real é `prismaMappingRepo`.

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { logger } from '../logger';
import { clearResponseCache } from '../cache/responseCache';
import { effectiveInternal } from './affiliateIdentityCore';
import { looksLikeProductTracking } from './digistoreAffiliates';
import {
  MAPPING_PLATFORMS, isMappingPlatform, buildMappingIndex, resolveAffiliateId, planStateChange,
  candidateExternalIds, unmappedEntryFor, mappingKey,
  type AffiliateStateInput, type MappingIndex, type Pair, type StatePlan,
} from './affiliateMappingCore';

// ---------------------------------------------------------------------
// Repositório
// ---------------------------------------------------------------------
export interface MappingAccount {
  id: string;                 // Affiliate.id
  platformSlug: string;
  externalId: string;
  nickname: string | null;
  mappedAffiliateId: string | null;
  // Decisão manual do admin (Identidades); null = heurística.
  isInternal?: boolean | null;
}

/**
 * Pseudo-afiliado interno (tracking de produto/orgânico — "neuromindpro12",
 * ID "0", "blessedkit3"): nunca vai existir no sistema de afiliados, então
 * não polui a fila de não mapeados. Decisão manual (isInternal) vence.
 */
export function isPseudoAffiliate(a: { externalId: string; nickname: string | null; isInternal?: boolean | null }): boolean {
  if (a.isInternal === false) return false;
  return effectiveInternal({ externalId: a.externalId, nickname: a.nickname, isInternal: a.isInternal ?? null })
    || looksLikeProductTracking(a.nickname || a.externalId || '');
}

export interface StoredState {
  affiliateId: string;
  name: string;
  status: string;
  occurredAt: Date;
  platforms: Pair[];
}

export interface UnmappedMeta {
  nickname: string | null;
  affiliateAccountId: string | null;
  eventId: string | null;
  at: Date;
  // count: 'increment' (um evento a mais) | número absoluto (backfill = nº de pedidos)
  count: 'increment' | number;
}

export interface MappingRepo {
  loadIndexRows(): Promise<Array<{ platform: string; externalId: string; affiliateId: string }>>;
  getState(affiliateId: string): Promise<StoredState | null>;
  /** Upsert do estado + substituição do conjunto. Devolve os pares que pertenciam a OUTRO afiliado. */
  applyState(state: AffiliateStateInput, plan: StatePlan, now: Date): Promise<{ transferred: Pair[] }>;
  touchState(affiliateId: string, now: Date): Promise<void>;
  /** Contas (Affiliate) das plataformas do contrato cujo externalId OU nickname normalizado bate com algum par. */
  findAccountsByPairs(pairs: Pair[]): Promise<MappingAccount[]>;
  listAccounts(platforms: readonly string[]): Promise<MappingAccount[]>;
  setAccountMapped(accountId: string, mappedAffiliateId: string | null): Promise<void>;
  /** Grava mappedAffiliateId nos pedidos das contas (só onde difere). Devolve linhas afetadas. */
  updateOrdersMapped(accountIds: string[], mappedAffiliateId: string): Promise<number>;
  countOrdersByAccounts(accountIds: string[]): Promise<Map<string, { count: number; first: Date | null; last: Date | null; lastExternalId: string | null }>>;
  upsertUnmapped(entry: { platform: string; externalId: string; altExternalId: string | null }, meta: UnmappedMeta): Promise<void>;
  deleteUnmapped(pairs: Pair[]): Promise<number>;
  deleteUnmappedByAccounts(accountIds: string[]): Promise<number>;
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

export const prismaMappingRepo: MappingRepo = {
  async loadIndexRows() {
    return db.affiliateMapping.findMany({ select: { platform: true, externalId: true, affiliateId: true } });
  },
  async getState(affiliateId) {
    const s = await db.affiliateMappingState.findUnique({
      where: { affiliateId },
      include: { mappings: { select: { platform: true, externalId: true } } },
    });
    if (!s) return null;
    return { affiliateId: s.affiliateId, name: s.name, status: s.status, occurredAt: s.occurredAt, platforms: s.mappings };
  },
  async applyState(state, plan, now) {
    return db.$transaction(async (tx) => {
      await tx.affiliateMappingState.upsert({
        where: { affiliateId: state.affiliateId },
        create: { affiliateId: state.affiliateId, name: state.name, status: state.status, occurredAt: state.occurredAt, syncedAt: now },
        update: { name: state.name, status: state.status, occurredAt: state.occurredAt, syncedAt: now, removedAt: null },
      });
      if (plan.removed.length) {
        await tx.affiliateMapping.deleteMany({
          where: { affiliateId: state.affiliateId, OR: plan.removed.map((p) => ({ platform: p.platform, externalId: p.externalId })) },
        });
      }
      const transferred: Pair[] = [];
      for (const p of state.platforms) {
        const existing = await tx.affiliateMapping.findUnique({
          where: { platform_externalId: { platform: p.platform, externalId: p.externalId } },
          select: { affiliateId: true },
        });
        if (existing && existing.affiliateId !== state.affiliateId) {
          // "Um ID, um afiliado" (§4): o sistema de afiliados garante a
          // unicidade — o dono anterior perdeu o ID (ou ainda vamos receber
          // o estado dele). Transfere e reprocessa as contas depois.
          transferred.push(p);
          logger.warn({ platform: p.platform, externalId: p.externalId, from: existing.affiliateId, to: state.affiliateId }, '[affiliateMapping] external_id transferido entre afiliados');
        }
        await tx.affiliateMapping.upsert({
          where: { platform_externalId: { platform: p.platform, externalId: p.externalId } },
          create: { affiliateId: state.affiliateId, name: state.name, status: state.status, platform: p.platform, externalId: p.externalId, syncedAt: now },
          update: { affiliateId: state.affiliateId, name: state.name, status: state.status, syncedAt: now },
        });
      }
      // Nome/status também nas linhas que já existiam e não mudaram.
      await tx.affiliateMapping.updateMany({
        where: { affiliateId: state.affiliateId },
        data: { name: state.name, status: state.status, syncedAt: now },
      });
      return { transferred };
    });
  },
  async touchState(affiliateId, now) {
    await db.affiliateMappingState.updateMany({ where: { affiliateId }, data: { syncedAt: now, removedAt: null } });
  },
  async findAccountsByPairs(pairs) {
    if (pairs.length === 0) return [];
    // Mesma normalização do contrato (trim + minúsculas) dos dois lados,
    // direto no SQL — externalId OU nickname da conta casando com o par.
    const platforms = [...new Set(pairs.map((p) => p.platform))];
    const ids = [...new Set(pairs.map((p) => p.externalId))];
    const rows = await db.$queryRaw<Array<{ id: string; slug: string; externalId: string; nickname: string | null; mappedAffiliateId: string | null; isInternal: boolean | null }>>(Prisma.sql`
      SELECT a.id, pl."slug" AS slug, a."externalId", a."nickname", a."mappedAffiliateId", a."isInternal"
      FROM "Affiliate" a
      JOIN "Platform" pl ON a."platformId" = pl.id
      WHERE pl."slug" = ANY(${platforms})
        AND (LOWER(BTRIM(a."externalId")) = ANY(${ids}) OR LOWER(BTRIM(COALESCE(a."nickname", ''))) = ANY(${ids}))
    `);
    const wanted = new Set(pairs.map((p) => mappingKey(p.platform, p.externalId)));
    return rows
      .filter((r) => wanted.has(mappingKey(r.slug, norm(r.externalId))) || wanted.has(mappingKey(r.slug, norm(r.nickname))))
      .map((r) => ({ id: r.id, platformSlug: r.slug, externalId: r.externalId, nickname: r.nickname, mappedAffiliateId: r.mappedAffiliateId, isInternal: r.isInternal }));
  },
  async listAccounts(platforms) {
    const rows = await db.affiliate.findMany({
      where: { platform: { slug: { in: [...platforms] } } },
      select: { id: true, externalId: true, nickname: true, mappedAffiliateId: true, isInternal: true, platform: { select: { slug: true } } },
    });
    return rows.map((r) => ({ id: r.id, platformSlug: r.platform.slug, externalId: r.externalId, nickname: r.nickname, mappedAffiliateId: r.mappedAffiliateId, isInternal: r.isInternal }));
  },
  async setAccountMapped(accountId, mappedAffiliateId) {
    await db.affiliate.update({ where: { id: accountId }, data: { mappedAffiliateId } });
  },
  async updateOrdersMapped(accountIds, mappedAffiliateId) {
    if (accountIds.length === 0) return 0;
    const res = await db.order.updateMany({
      where: {
        affiliateId: { in: accountIds },
        OR: [{ mappedAffiliateId: null }, { mappedAffiliateId: { not: mappedAffiliateId } }],
      },
      data: { mappedAffiliateId },
    });
    return res.count;
  },
  async countOrdersByAccounts(accountIds) {
    const out = new Map<string, { count: number; first: Date | null; last: Date | null; lastExternalId: string | null }>();
    if (accountIds.length === 0) return out;
    const rows = await db.$queryRaw<Array<{ affiliate_id: string; cnt: bigint; first: Date | null; last: Date | null; last_external_id: string | null }>>(Prisma.sql`
      SELECT o."affiliateId" AS affiliate_id, COUNT(*)::bigint AS cnt,
             MIN(o."orderedAt") AS first, MAX(o."orderedAt") AS last,
             (ARRAY_AGG(o."externalId" ORDER BY o."orderedAt" DESC, o.id DESC))[1] AS last_external_id
      FROM "Order" o
      WHERE o."affiliateId" = ANY(${accountIds})
      GROUP BY o."affiliateId"
    `);
    for (const r of rows) out.set(r.affiliate_id, { count: Number(r.cnt), first: r.first, last: r.last, lastExternalId: r.last_external_id });
    return out;
  },
  async upsertUnmapped(entry, meta) {
    const where = { platform_externalId: { platform: entry.platform, externalId: entry.externalId } };
    const existing = await db.unmappedAffiliateEvent.findUnique({ where, select: { id: true, count: true, firstSeen: true, lastSeen: true } });
    if (!existing) {
      await db.unmappedAffiliateEvent.create({
        data: {
          platform: entry.platform, externalId: entry.externalId, altExternalId: entry.altExternalId,
          nickname: meta.nickname, affiliateAccountId: meta.affiliateAccountId, eventId: meta.eventId,
          firstSeen: meta.at, lastSeen: meta.at, count: meta.count === 'increment' ? 1 : Math.max(1, meta.count),
        },
      });
      return;
    }
    await db.unmappedAffiliateEvent.update({
      where: { id: existing.id },
      data: {
        altExternalId: entry.altExternalId ?? undefined,
        nickname: meta.nickname ?? undefined,
        affiliateAccountId: meta.affiliateAccountId ?? undefined,
        eventId: meta.eventId ?? undefined,
        firstSeen: meta.at < existing.firstSeen ? meta.at : existing.firstSeen,
        lastSeen: meta.at > existing.lastSeen ? meta.at : existing.lastSeen,
        count: meta.count === 'increment' ? { increment: 1 } : Math.max(existing.count, meta.count),
      },
    });
  },
  async deleteUnmapped(pairs) {
    if (pairs.length === 0) return 0;
    const res = await db.unmappedAffiliateEvent.deleteMany({
      where: { OR: pairs.map((p) => ({ platform: p.platform, externalId: p.externalId })) },
    });
    return res.count;
  },
  async deleteUnmappedByAccounts(accountIds) {
    if (accountIds.length === 0) return 0;
    const res = await db.unmappedAffiliateEvent.deleteMany({ where: { affiliateAccountId: { in: accountIds } } });
    return res.count;
  },
};

// ---------------------------------------------------------------------
// Índice em cache (1 instância Node; invalidado em toda escrita)
// ---------------------------------------------------------------------
const INDEX_TTL_MS = 60_000;
let indexCache: { at: number; map: Map<string, string>; repo: MappingRepo } | null = null;

export function invalidateMappingIndex(): void {
  indexCache = null;
}

export async function getMappingIndex(repo: MappingRepo = prismaMappingRepo): Promise<MappingIndex> {
  if (indexCache && indexCache.repo === repo && Date.now() - indexCache.at < INDEX_TTL_MS) return indexCache.map;
  const map = buildMappingIndex(await repo.loadIndexRows());
  indexCache = { at: Date.now(), map, repo };
  return map;
}

// Escrita no mapeamento muda o que os relatórios/metrics devolvem.
const onMappingChanged: Array<() => void> = [];
export function onAffiliateMappingChanged(fn: () => void): void {
  onMappingChanged.push(fn);
}
function notifyChanged(): void {
  invalidateMappingIndex();
  clearResponseCache();
  for (const fn of onMappingChanged) {
    try { fn(); } catch { /* nunca propaga */ }
  }
}

// ---------------------------------------------------------------------
// Ingest: resolve ou enfileira. NUNCA lança (o IPN não pode falhar por
// causa da integração).
// ---------------------------------------------------------------------
export interface IngestResolveContext {
  accountId: string;          // Affiliate.id
  orderExternalId: string;    // event_id da fila
  at: Date;                   // orderedAt
  currentMapped: string | null;
  isInternal?: boolean | null; // Affiliate.isInternal (decisão manual)
}

export async function resolveForIngest(
  platformSlug: string,
  ids: { externalId: string; nickname: string | null },
  ctx: IngestResolveContext,
  repo: MappingRepo = prismaMappingRepo,
): Promise<string | null> {
  if (!isMappingPlatform(platformSlug)) return null;
  try {
    const index = await getMappingIndex(repo);
    const res = resolveAffiliateId(index, platformSlug, ids);
    if (res.affiliateId) {
      if (ctx.currentMapped !== res.affiliateId) await repo.setAccountMapped(ctx.accountId, res.affiliateId);
      return res.affiliateId;
    }
    const entry = unmappedEntryFor(platformSlug, ids);
    if (entry && !isPseudoAffiliate({ externalId: ids.externalId, nickname: ids.nickname, isInternal: ctx.isInternal })) {
      await repo.upsertUnmapped(entry, {
        nickname: ids.nickname, affiliateAccountId: ctx.accountId, eventId: ctx.orderExternalId, at: ctx.at, count: 'increment',
      });
    }
    // ID saiu do mapping (§4: "o antigo sai e fica livre"): a venda NOVA não
    // herda o dono antigo — fica sem affiliate_id (e na fila). O histórico
    // dos pedidos já gravados permanece (§5.5); só o cache da conta zera.
    if (ctx.currentMapped != null) await repo.setAccountMapped(ctx.accountId, null);
    return null;
  } catch (err) {
    // Falha TRANSITÓRIA de banco: mantém o que a conta já tinha.
    logger.warn({ err, platformSlug }, '[affiliateMapping] resolução no ingest falhou (pedido herda o cache da conta)');
    return ctx.currentMapped;
  }
}

// ---------------------------------------------------------------------
// Reprocesso de contas (webhook novo, mapping, backfill)
// ---------------------------------------------------------------------
export interface ReprocessStats {
  accounts: number;
  resolved: number;
  unresolved: number;
  changed: number;      // contas cujo mappedAffiliateId mudou
  ordersUpdated: number;
  queued: number;       // contas enfileiradas em unmapped (só no backfill)
  dequeued: number;     // entradas removidas da fila
}

export async function resolveAccounts(
  accounts: MappingAccount[],
  opts: { enqueueUnresolved: boolean; dryRun?: boolean },
  repo: MappingRepo = prismaMappingRepo,
): Promise<ReprocessStats> {
  const stats: ReprocessStats = { accounts: accounts.length, resolved: 0, unresolved: 0, changed: 0, ordersUpdated: 0, queued: 0, dequeued: 0 };
  if (accounts.length === 0) return stats;
  invalidateMappingIndex();
  const index = await getMappingIndex(repo);
  // Agrupa por affiliate_id resolvido → um updateMany por afiliado.
  const byMapped = new Map<string, MappingAccount[]>();
  const unresolved: MappingAccount[] = [];
  for (const acc of accounts) {
    const res = resolveAffiliateId(index, acc.platformSlug, acc);
    if (res.affiliateId) {
      stats.resolved++;
      byMapped.set(res.affiliateId, [...(byMapped.get(res.affiliateId) ?? []), acc]);
    } else {
      stats.unresolved++;
      unresolved.push(acc);
    }
  }
  for (const [mapped, accs] of byMapped) {
    const changed = accs.filter((a) => a.mappedAffiliateId !== mapped);
    stats.changed += changed.length;
    if (opts.dryRun) continue;
    for (const a of changed) await repo.setAccountMapped(a.id, mapped);
    stats.ordersUpdated += await repo.updateOrdersMapped(accs.map((a) => a.id), mapped);
    // Resolvida = sai da fila (por conta e pelos próprios candidatos).
    stats.dequeued += await repo.deleteUnmappedByAccounts(accs.map((a) => a.id));
    const pairs: Pair[] = accs.flatMap((a) => candidateExternalIds(a.platformSlug, a).map((externalId) => ({ platform: a.platformSlug, externalId })));
    stats.dequeued += await repo.deleteUnmapped(pairs);
  }
  // Conta que PERDEU o mapeamento (ID removido/transferido): zera o cache
  // da conta — vendas novas não herdam o dono antigo; pedidos já gravados
  // ficam como estão (histórico, §5.5).
  const stale = unresolved.filter((a) => a.mappedAffiliateId != null);
  stats.changed += stale.length;
  if (!opts.dryRun) for (const a of stale) await repo.setAccountMapped(a.id, null);
  if (opts.enqueueUnresolved && unresolved.length && !opts.dryRun) {
    const counts = await repo.countOrdersByAccounts(unresolved.map((a) => a.id));
    for (const a of unresolved) {
      const c = counts.get(a.id);
      if (!c || c.count === 0) continue; // conta sem pedido não interessa à fila
      if (isPseudoAffiliate(a)) continue; // tracking interno nunca terá mapeamento
      const entry = unmappedEntryFor(a.platformSlug, a);
      if (!entry) continue;
      await repo.upsertUnmapped(entry, {
        nickname: a.nickname, affiliateAccountId: a.id, eventId: c.lastExternalId,
        at: c.last ?? new Date(), count: c.count,
      });
      stats.queued++;
    }
  }
  if (!opts.dryRun && (stats.changed > 0 || stats.dequeued > 0 || stats.queued > 0)) notifyChanged();
  return stats;
}

/** Contas afetadas por pares que entraram/saíram/mudaram de dono. */
export async function reprocessPairs(pairs: Pair[], repo: MappingRepo = prismaMappingRepo): Promise<ReprocessStats> {
  if (pairs.length === 0) return { accounts: 0, resolved: 0, unresolved: 0, changed: 0, ordersUpdated: 0, queued: 0, dequeued: 0 };
  const accounts = await repo.findAccountsByPairs(pairs);
  return resolveAccounts(accounts, { enqueueUnresolved: false }, repo);
}

// ---------------------------------------------------------------------
// Webhook affiliate.updated / item do mapping
// ---------------------------------------------------------------------
export interface ApplyResult {
  action: StatePlan['action'];
  added: Pair[];
  removed: Pair[];
  transferred: Pair[];
  reprocess: ReprocessStats | null;
}

export async function applyAffiliateState(
  state: AffiliateStateInput,
  opts: { now?: Date; deferReprocess?: boolean } = {},
  repo: MappingRepo = prismaMappingRepo,
): Promise<ApplyResult> {
  const now = opts.now ?? new Date();
  const current = await repo.getState(state.affiliateId);
  const plan = planStateChange(current, state);
  if (plan.action === 'stale') return { action: 'stale', added: [], removed: [], transferred: [], reprocess: null };
  if (plan.action === 'unchanged') {
    await repo.touchState(state.affiliateId, now);
    // Replay (retry do webhook depois de um 500, item re-buscado pelo
    // updated_since inclusivo): o estado já está gravado, mas o reprocesso
    // da tentativa anterior pode ter falhado — reprocessa os pares atuais
    // (idempotente e barato).
    const reprocess = opts.deferReprocess ? null : await reprocessPairs(state.platforms, repo);
    return { action: 'unchanged', added: [], removed: [], transferred: [], reprocess };
  }
  const { transferred } = await repo.applyState(state, plan, now);
  notifyChanged();
  const touched: Pair[] = [...plan.added, ...plan.removed, ...transferred];
  const reprocess = opts.deferReprocess ? null : await reprocessPairs(touched, repo);
  return { action: 'apply', added: plan.added, removed: plan.removed, transferred, reprocess };
}

// ---------------------------------------------------------------------
// Backfill histórico: todas as contas das plataformas do contrato
// ---------------------------------------------------------------------
export async function backfillAffiliateMapping(
  opts: { dryRun?: boolean } = {},
  repo: MappingRepo = prismaMappingRepo,
): Promise<ReprocessStats> {
  const accounts = await repo.listAccounts(MAPPING_PLATFORMS);
  const stats = await resolveAccounts(accounts, { enqueueUnresolved: true, dryRun: opts.dryRun }, repo);
  logger.info({ ...stats, dryRun: !!opts.dryRun }, '[affiliateMapping] backfill');
  return stats;
}

// ---------------------------------------------------------------------
// Leitura pra UI / status
// ---------------------------------------------------------------------
export interface UnmappedRow {
  id: string;
  platform: string;
  externalId: string;
  altExternalId: string | null;
  nickname: string | null;
  affiliateAccountId: string | null;
  eventId: string | null;
  firstSeen: string;
  lastSeen: string;
  count: number;
  // Enriquecimento pra decidir rápido: receita 90d da conta.
  revenue90d: number;
}

export async function listUnmappedAffiliates(limit = 300): Promise<{ total: number; rows: UnmappedRow[] }> {
  const [total, rows] = await Promise.all([
    db.unmappedAffiliateEvent.count(),
    db.unmappedAffiliateEvent.findMany({ orderBy: [{ count: 'desc' }, { lastSeen: 'desc' }], take: limit }),
  ]);
  const accountIds = rows.map((r) => r.affiliateAccountId).filter((x): x is string => !!x);
  const since = new Date(Date.now() - 90 * 86_400_000);
  const rev = accountIds.length
    ? await db.order.groupBy({
        by: ['affiliateId'],
        where: { affiliateId: { in: accountIds }, status: 'APPROVED', orderedAt: { gte: since } },
        _sum: { grossAmountUsd: true },
      })
    : [];
  const revById = new Map<string, number>();
  for (const r of rev) if (r.affiliateId) revById.set(r.affiliateId, Math.round(Number(r._sum.grossAmountUsd ?? 0) * 100) / 100);
  return {
    total,
    rows: rows.map((r) => ({
      id: r.id, platform: r.platform, externalId: r.externalId, altExternalId: r.altExternalId, nickname: r.nickname,
      affiliateAccountId: r.affiliateAccountId, eventId: r.eventId,
      firstSeen: r.firstSeen.toISOString(), lastSeen: r.lastSeen.toISOString(), count: r.count,
      revenue90d: r.affiliateAccountId ? (revById.get(r.affiliateAccountId) ?? 0) : 0,
    })),
  };
}

export interface MappedAffiliateSummary {
  affiliateId: string;
  name: string;
  status: string;
  removed: boolean;
  platforms: Pair[];
  occurredAt: string;
}

export async function listMappedAffiliates(): Promise<MappedAffiliateSummary[]> {
  const states = await db.affiliateMappingState.findMany({
    include: { mappings: { select: { platform: true, externalId: true }, orderBy: [{ platform: 'asc' }, { externalId: 'asc' }] } },
    orderBy: { name: 'asc' },
  });
  return states.map((s) => ({
    affiliateId: s.affiliateId, name: s.name, status: s.status, removed: s.removedAt != null,
    platforms: s.mappings, occurredAt: s.occurredAt.toISOString(),
  }));
}

export async function mappingCounts(): Promise<{ affiliates: number; active: number; removed: number; platformIds: number; byPlatform: Record<string, number>; accountsMapped: number; accountsUnmapped: number; ordersMapped: number }> {
  const [affiliates, active, removed, platformIds, byPlatform, accountsMapped, accountsUnmapped, ordersMapped] = await Promise.all([
    db.affiliateMappingState.count(),
    db.affiliateMappingState.count({ where: { status: 'active', removedAt: null } }),
    db.affiliateMappingState.count({ where: { removedAt: { not: null } } }),
    db.affiliateMapping.count(),
    db.affiliateMapping.groupBy({ by: ['platform'], _count: { _all: true } }),
    db.affiliate.count({ where: { mappedAffiliateId: { not: null } } }),
    db.affiliate.count({ where: { mappedAffiliateId: null, platform: { slug: { in: [...MAPPING_PLATFORMS] } } } }),
    db.order.count({ where: { mappedAffiliateId: { not: null } } }),
  ]);
  return {
    affiliates, active, removed, platformIds,
    byPlatform: Object.fromEntries(byPlatform.map((r) => [r.platform, r._count._all])),
    accountsMapped, accountsUnmapped, ordersMapped,
  };
}

/** Nome/status por affiliate_id pra enriquecer linhas dos relatórios. */
export async function mappedIdentityMap(ids?: string[]): Promise<Map<string, { name: string; status: string }>> {
  const rows = await db.affiliateMappingState.findMany({
    where: ids?.length ? { affiliateId: { in: ids } } : undefined,
    select: { affiliateId: true, name: true, status: true },
  });
  return new Map(rows.map((r) => [r.affiliateId, { name: r.name, status: r.status }]));
}
