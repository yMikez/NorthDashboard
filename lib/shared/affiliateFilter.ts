// Filtro global "Afiliado" (barra de filtros da SPA e do /chat).
//
// Escolha = chaves `a:<Affiliate.id>` (uma conta de plataforma) ou
// `p:<AffiliatePartner.id>` (a pessoa: todas as contas unificadas na aba
// Análise de afiliados). O servidor resolve pra lista de Affiliate.id e cada
// serviço filtra por Order.affiliateId — toda venda tem conta de afiliado,
// ao contrário do mapeamento do NorthScale Afiliados (Order.mappedAffiliateId,
// filtro antigo, que em out/2026 cobria 0% das vendas e segue só na API).
//
// Query param: `aff` (CSV). Escolha que não resolve pra nenhuma conta vira
// NO_AFFILIATE — filtra tudo fora, nunca "sem filtro" (nada finge estar
// filtrado com o total).
//
// Carteira (2026-11-12): `c:<User.id>` = a carteira de um captador e da
// equipe abaixo dele (Squad Leader escolhe um Hunter; Gerente, um squad). E
// quem tem função na carteira só enxerga a própria: resolveAffiliateFilter
// recebe o usuário e intersecta (lib/portfolio/scope.ts).

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { accountsOfOwners, applyPortfolioScope, loadTeam, NO_AFFILIATE, type ScopeUser } from '../portfolio/scope';
import { descendants } from '../portfolio/core';

export { NO_AFFILIATE };

const KEY_RE = /^[apc]:[A-Za-z0-9_-]{1,64}$/;
const NONE_TOKEN = '__NONE__';
const MAX_KEYS = 200;

/** Chaves válidas do param `aff` (dedup, teto). `['__NONE__']` = "nenhum". */
export function affiliateKeysParam(raw: string | null | undefined): string[] | undefined {
  if (!raw) return undefined;
  const out = new Set<string>();
  for (const s of raw.split(',').map((x) => x.trim()).filter(Boolean)) {
    if (s === NONE_TOKEN) return [NONE_TOKEN];
    if (KEY_RE.test(s)) out.add(s);
    if (out.size >= MAX_KEYS) break;
  }
  return out.size ? Array.from(out) : undefined;
}

export interface ResolvedAffiliateAccount {
  id: string;
  platform: string;
  externalId: string;
}

/** Contas (com plataforma e externalId) da escolha — base de quem precisa casar pelo ID da plataforma (VSLs). */
export async function resolveAffiliateAccounts(raw: string | null | undefined): Promise<ResolvedAffiliateAccount[] | undefined> {
  const keys = affiliateKeysParam(raw);
  if (!keys) return undefined;
  if (keys[0] === NONE_TOKEN) return [];
  const accountIds = keys.filter((k) => k.startsWith('a:')).map((k) => k.slice(2));
  const partnerIds = keys.filter((k) => k.startsWith('p:')).map((k) => k.slice(2));
  const captadorIds = keys.filter((k) => k.startsWith('c:')).map((k) => k.slice(2));
  if (captadorIds.length) {
    // Carteira do captador = as pessoas dele e da equipe abaixo.
    const team = await loadTeam();
    const owners = new Set<string>();
    for (const id of captadorIds) for (const o of descendants(team, id)) owners.add(o);
    accountIds.push(...(await accountsOfOwners(owners)));
  }
  if (!accountIds.length && !partnerIds.length) return [];
  const rows = await db.affiliate.findMany({
    where: {
      OR: [
        ...(accountIds.length ? [{ id: { in: accountIds } }] : []),
        ...(partnerIds.length ? [{ partnerId: { in: partnerIds } }] : []),
      ],
    },
    select: { id: true, externalId: true, platform: { select: { slug: true } } },
  });
  return rows.map((r) => ({ id: r.id, platform: r.platform.slug, externalId: r.externalId }));
}

/**
 * `aff` → Affiliate.id[] pro filtro dos serviços. undefined = sem filtro;
 * escolha sem conta → [NO_AFFILIATE] (zera, não ignora). `user` = quem pede:
 * com função na carteira, o resultado fica dentro da carteira dele (sem
 * escolha = a carteira toda). Obrigatório de propósito — rota nova não
 * esquece o recorte.
 */
export async function resolveAffiliateFilter(
  raw: string | null | undefined,
  user: ScopeUser | null,
): Promise<string[] | undefined> {
  const accounts = await resolveAffiliateAccounts(raw);
  const requested = accounts === undefined ? undefined : accounts.length ? accounts.map((a) => a.id) : [NO_AFFILIATE];
  return applyPortfolioScope(user, requested);
}

/** Acrescenta o filtro (AND) num where do Prisma sem pisar num affiliateId já presente. */
export function addAffiliateWhere<T extends { AND?: unknown }>(where: T, ids: string[] | undefined): T {
  if (!ids?.length) return where;
  const cur = where.AND;
  const list = Array.isArray(cur) ? cur : cur ? [cur] : [];
  (where as { AND?: unknown }).AND = [...list, { affiliateId: { in: ids } }];
  return where;
}

/** Condição SQL sobre a coluna "affiliateId" de um apelido de pedido (`o`, `b`…). */
export function affiliateSqlCond(ids: string[], alias: string): Prisma.Sql {
  return Prisma.sql`${Prisma.raw(`"${alias.replace(/[^A-Za-z0-9_]/g, '')}"`)}."affiliateId" = ANY(${ids})`;
}
