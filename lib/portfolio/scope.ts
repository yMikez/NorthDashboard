// Carteira de afiliados — recorte de leitura por usuário.
//
// Quem tem função na carteira (Gerente, Squad Leader, Hunter) e não é ADMIN
// só enxerga as vendas das contas de afiliado cujas PESSOAS estão na carteira
// dele ou da equipe abaixo. O recorte entra no mesmo ponto do filtro global
// "Afiliado" (lib/shared/affiliateFilter.ts): cada serviço já filtra por
// Order.affiliateId — o recorte só troca/intersecta a lista de contas.
//
// Sem nenhum afiliado na carteira = NO_AFFILIATE (zera tudo), nunca "sem
// filtro". Regras puras em ./core.ts.

import { db } from '../db';
import { descendants, isPortfolioScoped, type PortfolioRole, type TeamUser } from './core';

export { isPortfolioScoped } from './core';

/** Id que não casa com nenhuma conta (o mesmo do filtro global). */
export const NO_AFFILIATE = '__none__';

export interface ScopeUser {
  id: string;
  role: string;
  portfolioRole?: PortfolioRole | null;
}

const TTL_MS = 30_000;
let teamCache: { at: number; users: TeamUser[] } | null = null;
const accountsCache = new Map<string, { at: number; ids: string[] }>();

/** Ownership ou equipe mudou: o recorte vale na hora (sem esperar o TTL). */
export function invalidatePortfolioCache(): void {
  teamCache = null;
  accountsCache.clear();
}

/** Todos os usuários com função na carteira (tabela pequena). */
export async function loadTeam(): Promise<TeamUser[]> {
  if (teamCache && Date.now() - teamCache.at < TTL_MS) return teamCache.users;
  const rows = await db.user.findMany({
    where: { OR: [{ portfolioRole: { not: null } }, { portfolioParentId: { not: null } }] },
    select: { id: true, name: true, email: true, portfolioRole: true, portfolioParentId: true, region: true, active: true },
  });
  const users = rows as TeamUser[];
  teamCache = { at: Date.now(), users };
  return users;
}

/** Captadores cujas carteiras o usuário enxerga (ele + a equipe abaixo). */
export async function scopeOwnerIds(user: ScopeUser): Promise<Set<string>> {
  return descendants(await loadTeam(), user.id);
}

/** Contas de afiliado das pessoas que pertencem a esses captadores. */
export async function accountsOfOwners(ownerIds: Iterable<string>): Promise<string[]> {
  const ids = Array.from(ownerIds);
  if (!ids.length) return [];
  const rows = await db.affiliate.findMany({
    where: { partner: { ownerUserId: { in: ids } } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Contas da carteira que o usuário enxerga (cache curto por usuário). */
export async function portfolioAffiliateIds(user: ScopeUser): Promise<string[]> {
  const hit = accountsCache.get(user.id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.ids;
  const ids = await accountsOfOwners(await scopeOwnerIds(user));
  if (accountsCache.size > 500) accountsCache.clear();
  accountsCache.set(user.id, { at: Date.now(), ids });
  return ids;
}

/**
 * Aplica a carteira sobre o filtro pedido. Sem recorte: devolve o pedido
 * como veio. Com recorte: pedido ∩ carteira (sem pedido = a carteira toda);
 * vazio vira [NO_AFFILIATE].
 */
export async function applyPortfolioScope(
  user: ScopeUser | null | undefined,
  requested: string[] | undefined,
): Promise<string[] | undefined> {
  if (!user || !isPortfolioScoped(user)) return requested;
  const allowed = await portfolioAffiliateIds(user);
  const allowedSet = new Set(allowed);
  const out = requested ? requested.filter((id) => allowedSet.has(id)) : allowed;
  return out.length ? out : [NO_AFFILIATE];
}

/**
 * Chave de entidade da Análise/CRM (`partner:<id>` | `aff:<id>`) está na
 * carteira do usuário? Sempre true sem recorte.
 */
export async function entityKeyAllowed(user: ScopeUser | null | undefined, key: string): Promise<boolean> {
  if (!user || !isPortfolioScoped(user)) return true;
  const [kind, id] = key.split(':');
  if (!id) return false;
  const accounts = kind === 'partner'
    ? (await db.affiliate.findMany({ where: { partnerId: id }, select: { id: true } })).map((a) => a.id)
    : kind === 'aff' ? [id] : [];
  return portfolioAllows(user, accounts);
}

/** Todas essas contas estão na carteira do usuário? (sempre true sem recorte) */
export async function portfolioAllows(user: ScopeUser | null | undefined, affiliateIds: string[]): Promise<boolean> {
  if (!user || !isPortfolioScoped(user)) return true;
  if (!affiliateIds.length) return false;
  const allowed = new Set(await portfolioAffiliateIds(user));
  return affiliateIds.every((id) => allowed.has(id));
}
