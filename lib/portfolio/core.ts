// Carteira de afiliados — regras puras da equipe de captação.
//
// Hierarquia: Gerente de afiliados (por região) > Squad Leader > Hunter.
// Cada captador vê os afiliados que ELE trouxe e os de quem está abaixo dele:
//   Hunter       → só os dele
//   Squad Leader → os dele + os dos Hunters do squad
//   Gerente      → os dele + os dos Squad Leaders e dos Hunters deles
// O dono é a PESSOA afiliada (AffiliatePartner): todas as contas dela, em
// qualquer plataforma, entram na carteira.

export type PortfolioRole = 'AFF_MANAGER' | 'SQUAD_LEADER' | 'HUNTER';

export const PORTFOLIO_ROLE_LABEL: Record<PortfolioRole, string> = {
  AFF_MANAGER: 'Gerente de afiliados',
  SQUAD_LEADER: 'Squad Leader',
  HUNTER: 'Hunter',
};

/** A quem cada função responde. */
export const PARENT_ROLE: Record<PortfolioRole, PortfolioRole | null> = {
  AFF_MANAGER: null,
  SQUAD_LEADER: 'AFF_MANAGER',
  HUNTER: 'SQUAD_LEADER',
};

export function isPortfolioRole(v: unknown): v is PortfolioRole {
  return v === 'AFF_MANAGER' || v === 'SQUAD_LEADER' || v === 'HUNTER';
}

export interface TeamUser {
  id: string;
  name: string | null;
  email: string;
  portfolioRole: PortfolioRole | null;
  portfolioParentId: string | null;
  region: string | null;
  active: boolean;
}

/** Quem tem função na carteira e não é admin só vê a própria carteira. */
export function isPortfolioScoped(user: { role: string; portfolioRole?: PortfolioRole | null } | null | undefined): boolean {
  return !!user && user.role !== 'ADMIN' && !!user.portfolioRole;
}

/** O próprio + todos abaixo dele na árvore (à prova de ciclo). */
export function descendants(users: TeamUser[], rootId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const u of users) {
    if (!u.portfolioParentId) continue;
    const list = children.get(u.portfolioParentId) ?? [];
    list.push(u.id);
    children.set(u.portfolioParentId, list);
  }
  const out = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const c of children.get(id) ?? []) {
      if (!out.has(c)) { out.add(c); stack.push(c); }
    }
  }
  return out;
}

/** Cadeia acima (pai, avô…), sem o próprio. */
export function ancestors(users: TeamUser[], id: string): string[] {
  const byId = new Map(users.map((u) => [u.id, u]));
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let cur = byId.get(id)?.portfolioParentId ?? null;
  while (cur && !seen.has(cur)) {
    out.push(cur);
    seen.add(cur);
    cur = byId.get(cur)?.portfolioParentId ?? null;
  }
  return out;
}

/**
 * Valida a posição de alguém na árvore: o "responde a" tem que ter a função
 * de cima (Hunter → Squad Leader → Gerente) e não pode criar ciclo.
 */
export function validatePlacement(
  users: TeamUser[],
  userId: string,
  role: PortfolioRole | null,
  parentId: string | null,
): string | null {
  if (!role) return parentId ? 'sem função na carteira não responde a ninguém' : null;
  const need = PARENT_ROLE[role];
  if (!need) return parentId ? 'o Gerente de afiliados não responde a ninguém na carteira' : null;
  if (!parentId) return null; // pode ficar sem líder até ser encaixado
  if (parentId === userId) return 'não pode responder a si mesmo';
  const parent = users.find((u) => u.id === parentId);
  if (!parent) return 'o líder escolhido não existe';
  if (parent.portfolioRole !== need) return `${PORTFOLIO_ROLE_LABEL[role]} responde a um ${PORTFOLIO_ROLE_LABEL[need]}`;
  if (descendants(users, userId).has(parentId)) return 'isso criaria um ciclo na equipe';
  return null;
}

/**
 * Quem pode gerir a carteira de `targetUserId` (atribuir, transferir,
 * aprovar pedido dele): admin e quem não tem função (operação, com a aba),
 * ou um captador ACIMA dele. O próprio Hunter não aprova o próprio pedido.
 */
export function canManageUser(
  actor: { id: string; role: string; portfolioRole?: PortfolioRole | null },
  users: TeamUser[],
  targetUserId: string,
): boolean {
  if (!isPortfolioScoped(actor)) return true;
  if (actor.id === targetUserId) return false;
  return descendants(users, actor.id).has(targetUserId);
}

/** Pode pôr um afiliado na carteira de `targetUserId` (o próprio SL/Gerente pode se atribuir). */
export function canAssignTo(
  actor: { id: string; role: string; portfolioRole?: PortfolioRole | null },
  users: TeamUser[],
  targetUserId: string,
): boolean {
  if (!isPortfolioScoped(actor)) return true;
  if (actor.portfolioRole === 'HUNTER') return false; // Hunter pede; não atribui
  return descendants(users, actor.id).has(targetUserId);
}

/** Árvore pra tela: Gerentes > Squad Leaders > Hunters (+ quem está solto). */
export interface TeamNode {
  id: string;
  name: string;
  email: string;
  role: PortfolioRole;
  region: string | null;
  active: boolean;
  children: TeamNode[];
}

const ROLE_RANK: Record<PortfolioRole, number> = { AFF_MANAGER: 0, SQUAD_LEADER: 1, HUNTER: 2 };

export function teamTree(users: TeamUser[], rootIds?: string[]): TeamNode[] {
  const withRole = users.filter((u): u is TeamUser & { portfolioRole: PortfolioRole } => !!u.portfolioRole);
  const ids = new Set(withRole.map((u) => u.id));
  const build = (u: TeamUser & { portfolioRole: PortfolioRole }, seen: Set<string>): TeamNode => ({
    id: u.id,
    name: u.name?.trim() || u.email,
    email: u.email,
    role: u.portfolioRole,
    region: u.region,
    active: u.active,
    children: withRole
      .filter((c) => c.portfolioParentId === u.id && !seen.has(c.id))
      .sort((a, b) => ROLE_RANK[a.portfolioRole] - ROLE_RANK[b.portfolioRole] || (a.name ?? a.email).localeCompare(b.name ?? b.email))
      .map((c) => build(c, new Set([...seen, c.id]))),
  });
  const roots = rootIds
    ? withRole.filter((u) => rootIds.includes(u.id))
    : withRole.filter((u) => !u.portfolioParentId || !ids.has(u.portfolioParentId));
  return roots
    .sort((a, b) => ROLE_RANK[a.portfolioRole] - ROLE_RANK[b.portfolioRole] || (a.region ?? '').localeCompare(b.region ?? '') || (a.name ?? a.email).localeCompare(b.name ?? b.email))
    .map((u) => build(u, new Set([u.id])));
}
