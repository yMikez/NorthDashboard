// Carteira de afiliados — campos do usuário na tela de Usuários (admin):
// função na equipe, a quem responde e região. Valida a posição na árvore
// (lib/portfolio/core.ts) contra a equipe atual.

import { isPortfolioRole, PARENT_ROLE, PORTFOLIO_ROLE_LABEL, validatePlacement, type PortfolioRole } from './core';
import { loadTeam } from './scope';

interface Body {
  portfolioRole?: unknown;
  portfolioParentId?: unknown;
  region?: unknown;
}

interface Current {
  id: string;
  portfolioRole: PortfolioRole | null;
  portfolioParentId: string | null;
  region: string | null;
}

export type PortfolioFields = { portfolioRole: PortfolioRole | null; portfolioParentId: string | null; region: string | null };

/**
 * Lê e valida os campos de carteira do corpo. `current` = o usuário como
 * está (null na criação); campo ausente no corpo mantém o atual.
 */
export async function parsePortfolioFields(
  body: Body,
  current: Current | null,
  _userRole: string,
): Promise<{ data: PortfolioFields } | { error: string }> {
  let role: PortfolioRole | null = current?.portfolioRole ?? null;
  if ('portfolioRole' in body) {
    const v = body.portfolioRole;
    if (v === null || v === '' || v === undefined) role = null;
    else if (isPortfolioRole(v)) role = v;
    else return { error: 'função na carteira inválida' };
  }
  let parentId: string | null = current?.portfolioParentId ?? null;
  if ('portfolioParentId' in body) {
    const v = body.portfolioParentId;
    parentId = typeof v === 'string' && v.trim() ? v.trim() : null;
  }
  // Gerente não responde a ninguém; sem função também não.
  if (!role || !PARENT_ROLE[role]) parentId = null;
  let region: string | null = current?.region ?? null;
  if ('region' in body) {
    const v = body.region;
    region = typeof v === 'string' && v.trim() ? v.trim().slice(0, 40) : null;
  }

  const team = await loadTeam();
  const userId = current?.id ?? '__novo__';
  const err = validatePlacement(team, userId, role, parentId);
  if (err) return { error: err };

  // Quem está abaixo dele tem que continuar com um líder da função certa.
  if (current) {
    const children = team.filter((u) => u.portfolioParentId === current.id && u.portfolioRole);
    const bad = children.filter((c) => PARENT_ROLE[c.portfolioRole!] !== role);
    if (bad.length) {
      const need = PARENT_ROLE[bad[0].portfolioRole!];
      return {
        error: `${bad.length} ${bad.length === 1 ? 'pessoa responde' : 'pessoas respondem'} a ele como ${need ? PORTFOLIO_ROLE_LABEL[need] : 'líder'} — mude o líder delas antes`,
      };
    }
  }
  return { data: { portfolioRole: role, portfolioParentId: parentId, region } };
}
