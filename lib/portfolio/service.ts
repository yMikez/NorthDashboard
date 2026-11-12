// Carteira de afiliados — leitura da aba Carteira e ações de dono.
//
// Leitura (getPortfolio): equipe visível, desempenho por captador (o dele e
// com a equipe abaixo), afiliados da carteira, fila de afiliados SEM dono
// (com venda nos últimos 90 dias) e pedidos de reivindicação.
// Ações (portfolioAction): Hunter pede (claim) → SL/Gerente/admin aprova ou
// recusa; SL/Gerente/admin atribui, transfere e libera. Toda troca de dono
// vira AffiliateOwnershipEvent.
//
// Números = vendas APROVADAS (mesma régua do Ranking/Funil), sem venda de
// rede, em dias de Brasília: últimos 7 e 30 dias fechando ONTEM (como a
// Análise) e os 30 anteriores.

import { Prisma } from '@prisma/client';
import { db, dbRead } from '../db';
import { effectiveInternal } from '../services/affiliateIdentityCore';
import {
  canAssignTo, canManageUser, descendants, isPortfolioScoped, PORTFOLIO_ROLE_LABEL, teamTree,
  type PortfolioRole, type TeamNode, type TeamUser,
} from './core';
import { invalidatePortfolioCache, loadTeam, type ScopeUser } from './scope';
import { clearResponseCache } from '../cache/responseCache';

const DAY_MS = 86_400_000;
const BRT_MS = 3 * 3_600_000;
const UNOWNED_DAYS = 90;
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface PortfolioActor extends ScopeUser {
  name?: string | null;
  email?: string;
}

interface Money { revenue7d: number; revenue30d: number; revenuePrev30d: number; fe30d: number }
const zero = (): Money => ({ revenue7d: 0, revenue30d: 0, revenuePrev30d: 0, fe30d: 0 });
const add = (a: Money, b: Money) => {
  a.revenue7d += b.revenue7d; a.revenue30d += b.revenue30d; a.revenuePrev30d += b.revenuePrev30d; a.fe30d += b.fe30d;
};

export interface MemberStats extends Money {
  userId: string;
  name: string;
  role: PortfolioRole;
  region: string | null;
  parentId: string | null;
  active: boolean;
  /** Pessoas na carteira dele (só dele). */
  affiliates: number;
  /** Com venda aprovada nos últimos 30 dias. */
  active30d: number;
  /** Atribuídas a ele nos últimos 30 dias. */
  added30d: number;
  /** Ele + a equipe abaixo. */
  team: Money & { affiliates: number; active30d: number; members: number };
}

export interface PortfolioAffiliate extends Money {
  partnerId: string;
  name: string;
  platforms: string[];
  accounts: number;
  ownerId: string;
  ownerName: string;
  ownerSince: string | null;
  lastSaleAt: string | null;
  firstSeenAt: string | null;
}

export interface UnownedAffiliate {
  /** partner:<id> | aff:<id> (conta solta — vira pessoa ao ser atribuída). */
  key: string;
  name: string;
  platforms: string[];
  accounts: number;
  firstSeenAt: string | null;
  lastSaleAt: string | null;
  /** Só pra quem vê a operação inteira (fora da carteira de quem tem função). */
  revenue30d: number | null;
  pendingClaim: { id: string; userId: string; userName: string } | null;
}

export interface ClaimView {
  id: string;
  partnerId: string;
  partnerName: string;
  userId: string;
  userName: string;
  note: string | null;
  status: string;
  createdAt: string;
  decidedAt: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
  canDecide: boolean;
  mine: boolean;
}

export interface OwnershipEventView {
  at: string;
  partnerId: string;
  partnerName: string;
  kind: string;
  fromName: string | null;
  toName: string | null;
  byName: string | null;
  note: string | null;
}

export interface PortfolioResponse {
  me: {
    id: string;
    scoped: boolean;
    role: PortfolioRole | null;
    roleLabel: string | null;
    /** Pode atribuir/transferir (SL, Gerente, operação). */
    canAssign: boolean;
    /** Pode pedir afiliado sem dono (quem tem função). */
    canClaim: boolean;
  };
  range: { start7: string; start30: string; startPrev30: string; end: string };
  team: TeamNode[];
  /** Captadores visíveis, pra escolher o dono numa atribuição. */
  assignable: Array<{ id: string; name: string; role: PortfolioRole; roleLabel: string }>;
  members: MemberStats[];
  totals: Money & { affiliates: number; active30d: number };
  affiliates: PortfolioAffiliate[];
  unowned: UnownedAffiliate[];
  claims: ClaimView[];
  history: OwnershipEventView[];
}

const brtDayStart = (d: Date) => {
  const shifted = new Date(d.getTime() - BRT_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) + BRT_MS);
};
const brtYmd = (d: Date) => new Date(d.getTime() - BRT_MS).toISOString().slice(0, 10);
const userName = (u: TeamUser | undefined) => (u ? u.name?.trim() || u.email : null);

/** Vendas aprovadas por conta nas janelas (sem venda de rede). */
async function moneyByAccount(ids: string[] | null, now: Date) {
  const end = brtDayStart(now); // fecha ONTEM
  const s7 = new Date(end.getTime() - 7 * DAY_MS);
  const s30 = new Date(end.getTime() - 30 * DAY_MS);
  const s60 = new Date(end.getTime() - 60 * DAY_MS);
  const idCond = ids ? Prisma.sql`AND o."affiliateId" IN (${Prisma.join(ids.length ? ids : ['__none__'])})` : Prisma.empty;
  const rows = await dbRead.$queryRaw<Array<{ id: string; r7: number; r30: number; rp30: number; fe30: number }>>(Prisma.sql`
    SELECT o."affiliateId" AS id,
           COALESCE(SUM(o."grossAmountUsd") FILTER (WHERE o."orderedAt" >= ${s7}), 0)::float8 AS r7,
           COALESCE(SUM(o."grossAmountUsd") FILTER (WHERE o."orderedAt" >= ${s30}), 0)::float8 AS r30,
           COALESCE(SUM(o."grossAmountUsd") FILTER (WHERE o."orderedAt" < ${s30}), 0)::float8 AS rp30,
           COUNT(*) FILTER (WHERE o."orderedAt" >= ${s30} AND o."productType" = 'FRONTEND')::int AS fe30
    FROM "Order" o
    WHERE o."status" = 'APPROVED' AND o."networkId" IS NULL AND o."affiliateId" IS NOT NULL
      AND o."orderedAt" >= ${s60} AND o."orderedAt" < ${end} ${idCond}
    GROUP BY 1`);
  const map = new Map<string, Money>();
  for (const r of rows) map.set(r.id, { revenue7d: r.r7, revenue30d: r.r30, revenuePrev30d: r.rp30, fe30d: r.fe30 });
  return {
    map,
    range: { start7: brtYmd(s7), start30: brtYmd(s30), startPrev30: brtYmd(s60), end: brtYmd(new Date(end.getTime() - 1)) },
  };
}

export async function getPortfolio(actor: PortfolioActor, now = new Date()): Promise<PortfolioResponse> {
  const team = await loadTeam();
  const scoped = isPortfolioScoped(actor);
  const byId = new Map(team.map((u) => [u.id, u]));
  const me = byId.get(actor.id);
  // Captadores visíveis: a equipe abaixo (com ele) ou, pra operação, todos.
  const visible = scoped ? descendants(team, actor.id) : new Set(team.filter((u) => u.portfolioRole).map((u) => u.id));

  const partners = await db.affiliatePartner.findMany({
    where: { ownerUserId: { in: [...visible] } },
    select: {
      id: true, displayName: true, ownerUserId: true, ownerSince: true,
      affiliates: { select: { id: true, lastOrderAt: true, firstSeenAt: true, platform: { select: { slug: true } } } },
    },
  });
  const accountIds = partners.flatMap((p) => p.affiliates.map((a) => a.id));
  const { map: money, range } = await moneyByAccount(accountIds, now);

  const since30 = new Date(brtDayStart(now).getTime() - 30 * DAY_MS);
  const affiliates: PortfolioAffiliate[] = partners.map((p) => {
    const m = zero();
    for (const a of p.affiliates) { const x = money.get(a.id); if (x) add(m, x); }
    const last = Math.max(0, ...p.affiliates.map((a) => a.lastOrderAt?.getTime() ?? 0));
    const first = Math.min(...p.affiliates.map((a) => a.firstSeenAt.getTime()));
    return {
      partnerId: p.id, name: p.displayName,
      platforms: [...new Set(p.affiliates.map((a) => a.platform.slug))],
      accounts: p.affiliates.length,
      ownerId: p.ownerUserId!, ownerName: userName(byId.get(p.ownerUserId!)) ?? 'captador',
      ownerSince: p.ownerSince?.toISOString() ?? null,
      lastSaleAt: last ? new Date(last).toISOString() : null,
      firstSeenAt: Number.isFinite(first) ? new Date(first).toISOString() : null,
      revenue7d: r2(m.revenue7d), revenue30d: r2(m.revenue30d), revenuePrev30d: r2(m.revenuePrev30d), fe30d: m.fe30d,
    };
  }).sort((a, b) => b.revenue30d - a.revenue30d || a.name.localeCompare(b.name));

  // Por captador: o dele e com a equipe abaixo.
  const own = new Map<string, { m: Money; affiliates: number; active30d: number; added30d: number }>();
  for (const a of affiliates) {
    const o = own.get(a.ownerId) ?? { m: zero(), affiliates: 0, active30d: 0, added30d: 0 };
    add(o.m, a);
    o.affiliates += 1;
    if (a.revenue30d > 0) o.active30d += 1;
    if (a.ownerSince && new Date(a.ownerSince) >= since30) o.added30d += 1;
    own.set(a.ownerId, o);
  }
  const members: MemberStats[] = [...visible]
    .map((id) => byId.get(id))
    .filter((u): u is TeamUser & { portfolioRole: PortfolioRole } => !!u?.portfolioRole)
    .map((u) => {
      const o = own.get(u.id) ?? { m: zero(), affiliates: 0, active30d: 0, added30d: 0 };
      const t = { ...zero(), affiliates: 0, active30d: 0, members: 0 };
      for (const d of descendants(team, u.id)) {
        if (!byId.get(d)?.portfolioRole) continue;
        t.members += 1;
        const x = own.get(d);
        if (x) { add(t, x.m); t.affiliates += x.affiliates; t.active30d += x.active30d; }
      }
      return {
        userId: u.id, name: userName(u)!, role: u.portfolioRole, region: u.region, parentId: u.portfolioParentId, active: u.active,
        affiliates: o.affiliates, active30d: o.active30d, added30d: o.added30d,
        revenue7d: r2(o.m.revenue7d), revenue30d: r2(o.m.revenue30d), revenuePrev30d: r2(o.m.revenuePrev30d), fe30d: o.m.fe30d,
        team: { ...t, revenue7d: r2(t.revenue7d), revenue30d: r2(t.revenue30d), revenuePrev30d: r2(t.revenuePrev30d) },
      };
    })
    .sort((a, b) => b.team.revenue30d - a.team.revenue30d || a.name.localeCompare(b.name));
  const totals = { ...zero(), affiliates: affiliates.length, active30d: affiliates.filter((a) => a.revenue30d > 0).length };
  for (const a of affiliates) add(totals, a);

  // Fila sem dono: pessoas/contas com venda nos últimos 90 dias.
  const unowned = await loadUnowned(scoped, now, byId);

  // Pedidos: os que ele decide (equipe abaixo), os dele e os decididos há pouco.
  const claimRows = await db.affiliateClaim.findMany({
    where: {
      OR: [
        { status: 'PENDING' },
        { decidedAt: { gte: new Date(now.getTime() - 30 * DAY_MS) } },
      ],
      ...(scoped ? { userId: { in: [...visible] } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true, partnerId: true, userId: true, note: true, status: true, createdAt: true, decidedAt: true, decidedById: true, decisionNote: true,
      partner: { select: { displayName: true } },
    },
  });
  const claims: ClaimView[] = claimRows.map((c) => ({
    id: c.id, partnerId: c.partnerId, partnerName: c.partner.displayName,
    userId: c.userId, userName: userName(byId.get(c.userId)) ?? 'captador',
    note: c.note, status: c.status, createdAt: c.createdAt.toISOString(),
    decidedAt: c.decidedAt?.toISOString() ?? null,
    decidedByName: c.decidedById ? userName(byId.get(c.decidedById)) ?? 'operação' : null,
    decisionNote: c.decisionNote,
    canDecide: c.status === 'PENDING' && canManageUser(actor, team, c.userId),
    mine: c.userId === actor.id,
  }));

  const events = await db.affiliateOwnershipEvent.findMany({
    where: scoped
      ? { OR: [{ toUserId: { in: [...visible] } }, { fromUserId: { in: [...visible] } }] }
      : {},
    orderBy: { at: 'desc' },
    take: 50,
    select: { at: true, partnerId: true, kind: true, fromUserId: true, toUserId: true, byUserId: true, note: true, partner: { select: { displayName: true } } },
  });
  const history: OwnershipEventView[] = events.map((e) => ({
    at: e.at.toISOString(), partnerId: e.partnerId, partnerName: e.partner.displayName, kind: e.kind,
    fromName: e.fromUserId ? userName(byId.get(e.fromUserId)) : null,
    toName: e.toUserId ? userName(byId.get(e.toUserId)) : null,
    byName: e.byUserId ? userName(byId.get(e.byUserId)) ?? 'operação' : null,
    note: e.note,
  }));

  const role = me?.portfolioRole ?? null;
  const canAssign = !scoped || role === 'SQUAD_LEADER' || role === 'AFF_MANAGER';
  const assignable = [...visible]
    .map((id) => byId.get(id))
    .filter((u): u is TeamUser & { portfolioRole: PortfolioRole } => !!u?.portfolioRole && u.active)
    .filter((u) => canAssignTo(actor, team, u.id))
    .map((u) => ({ id: u.id, name: userName(u)!, role: u.portfolioRole, roleLabel: PORTFOLIO_ROLE_LABEL[u.portfolioRole] }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    me: {
      id: actor.id, scoped, role: scoped ? role : null, roleLabel: scoped && role ? PORTFOLIO_ROLE_LABEL[role] : null,
      canAssign, canClaim: scoped,
    },
    range,
    team: scoped ? teamTree(team, [actor.id]) : teamTree(team),
    assignable,
    members,
    totals: { ...totals, revenue7d: r2(totals.revenue7d), revenue30d: r2(totals.revenue30d), revenuePrev30d: r2(totals.revenuePrev30d) },
    affiliates,
    unowned,
    claims,
    history,
  };
}

async function loadUnowned(scoped: boolean, now: Date, byId: Map<string, TeamUser>): Promise<UnownedAffiliate[]> {
  const since = new Date(now.getTime() - UNOWNED_DAYS * DAY_MS);
  const accounts = await db.affiliate.findMany({
    where: {
      lastOrderAt: { gte: since },
      networkId: null,
      OR: [{ partnerId: null }, { partner: { ownerUserId: null } }],
    },
    select: {
      id: true, externalId: true, nickname: true, isInternal: true, partnerId: true, firstSeenAt: true, lastOrderAt: true,
      platform: { select: { slug: true } },
      partner: { select: { displayName: true } },
    },
  });
  const kept = accounts.filter((a) => !effectiveInternal(a));
  const money = scoped ? null : (await moneyByAccount(kept.map((a) => a.id), now)).map;
  const groups = new Map<string, UnownedAffiliate & { _ids: string[] }>();
  for (const a of kept) {
    const key = a.partnerId ? `partner:${a.partnerId}` : `aff:${a.id}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key, name: a.partner?.displayName ?? (a.nickname?.trim() || a.externalId),
        platforms: [], accounts: 0, firstSeenAt: null, lastSaleAt: null,
        revenue30d: money ? 0 : null, pendingClaim: null, _ids: [],
      };
      groups.set(key, g);
    }
    if (!g.platforms.includes(a.platform.slug)) g.platforms.push(a.platform.slug);
    g.accounts += 1;
    g._ids.push(a.id);
    const fs = a.firstSeenAt.toISOString();
    if (!g.firstSeenAt || fs < g.firstSeenAt) g.firstSeenAt = fs;
    const ls = a.lastOrderAt?.toISOString() ?? null;
    if (ls && (!g.lastSaleAt || ls > g.lastSaleAt)) g.lastSaleAt = ls;
    if (money && g.revenue30d != null) g.revenue30d = r2(g.revenue30d + (money.get(a.id)?.revenue30d ?? 0));
  }
  const pids = [...groups.values()].filter((g) => g.key.startsWith('partner:')).map((g) => g.key.slice(8));
  const pending = pids.length
    ? await db.affiliateClaim.findMany({ where: { status: 'PENDING', partnerId: { in: pids } }, select: { id: true, partnerId: true, userId: true } })
    : [];
  for (const c of pending) {
    const g = groups.get(`partner:${c.partnerId}`);
    if (g) g.pendingClaim = { id: c.id, userId: c.userId, userName: userName(byId.get(c.userId)) ?? 'captador' };
  }
  return [...groups.values()]
    .map(({ _ids, ...g }) => g)
    // Novos primeiro (1ª venda mais recente): é a fila de quem acabou de chegar.
    .sort((a, b) => (b.revenue30d ?? 0) - (a.revenue30d ?? 0) || (b.firstSeenAt ?? '').localeCompare(a.firstSeenAt ?? ''))
    .slice(0, 300);
}

// ---------- Ações ----------

export class PortfolioError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** Pessoa da chave (partner:<id>); conta solta (aff:<id>) vira pessoa de 1. */
async function ensurePartner(key: string): Promise<string> {
  const [kind, id] = key.split(':');
  if (kind === 'partner' && id) {
    const p = await db.affiliatePartner.findUnique({ where: { id }, select: { id: true } });
    if (!p) throw new PortfolioError('afiliado não encontrado', 404);
    return p.id;
  }
  if (kind === 'aff' && id) {
    const a = await db.affiliate.findUnique({ where: { id }, select: { id: true, partnerId: true, nickname: true, externalId: true } });
    if (!a) throw new PortfolioError('afiliado não encontrado', 404);
    if (a.partnerId) return a.partnerId;
    return db.$transaction(async (tx) => {
      const p = await tx.affiliatePartner.create({ data: { displayName: a.nickname?.trim() || a.externalId }, select: { id: true } });
      await tx.affiliate.update({ where: { id: a.id }, data: { partnerId: p.id } });
      return p.id;
    });
  }
  throw new PortfolioError('afiliado inválido (partner:<id> ou aff:<id>)');
}

export type PortfolioActionInput =
  | { action: 'claim'; key: string; note?: string | null }
  | { action: 'cancel'; claimId: string }
  | { action: 'approve'; claimId: string; note?: string | null }
  | { action: 'reject'; claimId: string; note?: string | null }
  | { action: 'assign'; key: string; ownerUserId: string; note?: string | null }
  | { action: 'release'; key: string; note?: string | null };

export async function portfolioAction(actor: PortfolioActor, input: PortfolioActionInput): Promise<{ ok: true; partnerId?: string }> {
  const team = await loadTeam();
  const scoped = isPortfolioScoped(actor);
  const member = (id: string) => team.find((u) => u.id === id && u.portfolioRole && u.active);

  try {
    switch (input.action) {
      case 'claim': {
        if (!scoped) throw new PortfolioError('pedido é de quem tem carteira; a operação atribui direto', 403);
        const partnerId = await ensurePartner(input.key);
        const p = await db.affiliatePartner.findUnique({ where: { id: partnerId }, select: { ownerUserId: true } });
        if (p?.ownerUserId) throw new PortfolioError('esse afiliado já tem dono', 409);
        const open = await db.affiliateClaim.findFirst({ where: { partnerId, status: 'PENDING' }, select: { userId: true } });
        if (open) throw new PortfolioError(open.userId === actor.id ? 'você já pediu esse afiliado' : 'já existe um pedido em análise pra esse afiliado', 409);
        await db.affiliateClaim.create({ data: { partnerId, userId: actor.id, note: input.note?.trim() || null } });
        return { ok: true, partnerId };
      }
      case 'cancel': {
        const c = await db.affiliateClaim.findUnique({ where: { id: input.claimId }, select: { userId: true, status: true } });
        if (!c || c.status !== 'PENDING') throw new PortfolioError('pedido não está em análise', 404);
        if (c.userId !== actor.id && !canManageUser(actor, team, c.userId)) throw new PortfolioError('sem permissão', 403);
        await db.affiliateClaim.update({ where: { id: input.claimId }, data: { status: 'CANCELED', decidedAt: new Date(), decidedById: actor.id } });
        return { ok: true };
      }
      case 'approve':
      case 'reject': {
        const c = await db.affiliateClaim.findUnique({ where: { id: input.claimId }, select: { userId: true, status: true, partnerId: true } });
        if (!c || c.status !== 'PENDING') throw new PortfolioError('pedido não está em análise', 404);
        if (!canManageUser(actor, team, c.userId)) throw new PortfolioError('quem aprova é o líder de quem pediu (ou a operação)', 403);
        const note = input.note?.trim() || null;
        if (input.action === 'reject') {
          await db.affiliateClaim.update({ where: { id: input.claimId }, data: { status: 'REJECTED', decidedAt: new Date(), decidedById: actor.id, decisionNote: note } });
          return { ok: true, partnerId: c.partnerId };
        }
        if (!member(c.userId)) throw new PortfolioError('quem pediu não está mais ativo na carteira', 409);
        await db.$transaction(async (tx) => {
          const p = await tx.affiliatePartner.findUnique({ where: { id: c.partnerId }, select: { ownerUserId: true } });
          if (p?.ownerUserId) throw new PortfolioError('esse afiliado ganhou dono enquanto o pedido esperava', 409);
          const at = new Date();
          await tx.affiliatePartner.update({ where: { id: c.partnerId }, data: { ownerUserId: c.userId, ownerSince: at } });
          await tx.affiliateClaim.update({ where: { id: input.claimId }, data: { status: 'APPROVED', decidedAt: at, decidedById: actor.id, decisionNote: note } });
          await tx.affiliateOwnershipEvent.create({ data: { partnerId: c.partnerId, fromUserId: null, toUserId: c.userId, byUserId: actor.id, kind: 'claim', note } });
        });
        return { ok: true, partnerId: c.partnerId };
      }
      case 'assign': {
        const target = member(input.ownerUserId);
        if (!target) throw new PortfolioError('o novo dono precisa ter função ativa na carteira');
        if (!canAssignTo(actor, team, target.id)) throw new PortfolioError('você só atribui pra você ou pra quem está abaixo de você', 403);
        const partnerId = await ensurePartner(input.key);
        const p = await db.affiliatePartner.findUnique({ where: { id: partnerId }, select: { ownerUserId: true } });
        const from = p?.ownerUserId ?? null;
        if (from === target.id) return { ok: true, partnerId };
        // Transferir: o dono atual tem que estar sob quem transfere.
        if (from && scoped && !descendants(team, actor.id).has(from)) {
          throw new PortfolioError('esse afiliado é de outra equipe — peça à operação', 403);
        }
        const note = input.note?.trim() || null;
        await db.$transaction(async (tx) => {
          const at = new Date();
          await tx.affiliatePartner.update({ where: { id: partnerId }, data: { ownerUserId: target.id, ownerSince: at } });
          await tx.affiliateOwnershipEvent.create({
            data: { partnerId, fromUserId: from, toUserId: target.id, byUserId: actor.id, kind: from ? 'transfer' : 'assign', note },
          });
          // Pedido aberto pra essa pessoa fica resolvido pela atribuição.
          await tx.affiliateClaim.updateMany({
            where: { partnerId, status: 'PENDING' },
            data: { status: 'CANCELED', decidedAt: at, decidedById: actor.id, decisionNote: `atribuído a ${userName(target)}` },
          });
        });
        return { ok: true, partnerId };
      }
      case 'release': {
        const partnerId = await ensurePartner(input.key);
        const p = await db.affiliatePartner.findUnique({ where: { id: partnerId }, select: { ownerUserId: true } });
        if (!p?.ownerUserId) return { ok: true, partnerId };
        if (scoped && !canManageUser(actor, team, p.ownerUserId)) throw new PortfolioError('só o líder de quem é dono (ou a operação) libera', 403);
        await db.$transaction([
          db.affiliatePartner.update({ where: { id: partnerId }, data: { ownerUserId: null, ownerSince: null } }),
          db.affiliateOwnershipEvent.create({
            data: { partnerId, fromUserId: p.ownerUserId, toUserId: null, byUserId: actor.id, kind: 'release', note: input.note?.trim() || null },
          }),
        ]);
        return { ok: true, partnerId };
      }
    }
  } finally {
    // Dono mudou: recorte e respostas em cache valem na hora.
    invalidatePortfolioCache();
    clearResponseCache();
  }
  throw new PortfolioError('ação inválida');
}
