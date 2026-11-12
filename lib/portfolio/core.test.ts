import { describe, expect, it } from 'vitest';
import {
  ancestors, canAssignTo, canManageUser, descendants, isPortfolioScoped, teamTree, validatePlacement, type TeamUser,
} from './core';

const u = (id: string, role: TeamUser['portfolioRole'], parent: string | null = null, region: string | null = null): TeamUser =>
  ({ id, name: id.toUpperCase(), email: `${id}@x`, portfolioRole: role, portfolioParentId: parent, region, active: true });

// Gerente BR (g1) > SL s1 > Hunters h1, h2 ; Gerente USA (g2) > SL s2 > Hunter h3.
const TEAM: TeamUser[] = [
  u('g1', 'AFF_MANAGER', null, 'Brasil'), u('s1', 'SQUAD_LEADER', 'g1'), u('h1', 'HUNTER', 's1'), u('h2', 'HUNTER', 's1'),
  u('g2', 'AFF_MANAGER', null, 'USA'), u('s2', 'SQUAD_LEADER', 'g2'), u('h3', 'HUNTER', 's2'),
];
const as = (id: string, role: TeamUser['portfolioRole'], userRole = 'MEMBER') => ({ id, role: userRole, portfolioRole: role });

describe('carteira — quem vê o quê', () => {
  it('Hunter vê só a dele; SL o squad; Gerente a região inteira', () => {
    expect([...descendants(TEAM, 'h1')]).toEqual(['h1']);
    expect([...descendants(TEAM, 's1')].sort()).toEqual(['h1', 'h2', 's1']);
    expect([...descendants(TEAM, 'g1')].sort()).toEqual(['g1', 'h1', 'h2', 's1']);
    expect(descendants(TEAM, 'g1').has('h3')).toBe(false);
    expect(ancestors(TEAM, 'h1')).toEqual(['s1', 'g1']);
  });

  it('ciclo na árvore não trava', () => {
    const loop = [u('a', 'SQUAD_LEADER', 'b'), u('b', 'SQUAD_LEADER', 'a')];
    expect([...descendants(loop, 'a')].sort()).toEqual(['a', 'b']);
    expect(ancestors(loop, 'a')).toEqual(['b']);
  });

  it('recorte vale pra quem tem função e não é admin', () => {
    expect(isPortfolioScoped(as('h1', 'HUNTER'))).toBe(true);
    expect(isPortfolioScoped(as('x', null))).toBe(false);
    expect(isPortfolioScoped(as('adm', 'AFF_MANAGER', 'ADMIN'))).toBe(false);
    expect(isPortfolioScoped(null)).toBe(false);
  });
});

describe('carteira — quem gere quem', () => {
  it('aprovar pedido: líder acima (não o próprio, não outra equipe) ou operação', () => {
    expect(canManageUser(as('s1', 'SQUAD_LEADER'), TEAM, 'h1')).toBe(true);
    expect(canManageUser(as('g1', 'AFF_MANAGER'), TEAM, 'h2')).toBe(true);
    expect(canManageUser(as('h1', 'HUNTER'), TEAM, 'h1')).toBe(false);
    expect(canManageUser(as('h2', 'HUNTER'), TEAM, 'h1')).toBe(false);
    expect(canManageUser(as('s2', 'SQUAD_LEADER'), TEAM, 'h1')).toBe(false);
    expect(canManageUser(as('op', null), TEAM, 'h1')).toBe(true);
  });

  it('atribuir: SL/Gerente pra si ou pra baixo; Hunter só pede', () => {
    expect(canAssignTo(as('s1', 'SQUAD_LEADER'), TEAM, 's1')).toBe(true);
    expect(canAssignTo(as('s1', 'SQUAD_LEADER'), TEAM, 'h2')).toBe(true);
    expect(canAssignTo(as('s1', 'SQUAD_LEADER'), TEAM, 'h3')).toBe(false);
    expect(canAssignTo(as('g1', 'AFF_MANAGER'), TEAM, 'h1')).toBe(true);
    expect(canAssignTo(as('h1', 'HUNTER'), TEAM, 'h1')).toBe(false);
    expect(canAssignTo(as('op', null), TEAM, 'h3')).toBe(true);
  });
});

describe('carteira — posição na equipe', () => {
  it('cada função responde à de cima; sem ciclo; Gerente não responde a ninguém', () => {
    expect(validatePlacement(TEAM, 'novo', 'HUNTER', 's1')).toBeNull();
    expect(validatePlacement(TEAM, 'novo', 'HUNTER', null)).toBeNull(); // pode ficar sem líder até ser encaixado
    expect(validatePlacement(TEAM, 'novo', 'HUNTER', 'g1')).toMatch(/Squad Leader/);
    expect(validatePlacement(TEAM, 'novo', 'SQUAD_LEADER', 'g2')).toBeNull();
    expect(validatePlacement(TEAM, 'novo', 'AFF_MANAGER', 'g2')).toMatch(/não responde/);
    expect(validatePlacement(TEAM, 's1', 'SQUAD_LEADER', 's1')).toMatch(/si mesmo/);
    expect(validatePlacement(TEAM, 'novo', 'HUNTER', 'sumiu')).toMatch(/não existe/);
    expect(validatePlacement(TEAM, 'novo', null, 's1')).toMatch(/sem função/);
  });

  it('árvore pra tela: Gerentes por região, squads e hunters dentro', () => {
    const tree = teamTree(TEAM);
    expect(tree.map((n) => [n.id, n.region])).toEqual([['g1', 'Brasil'], ['g2', 'USA']]);
    expect(tree[0].children.map((c) => c.id)).toEqual(['s1']);
    expect(tree[0].children[0].children.map((c) => c.id)).toEqual(['h1', 'h2']);
    // Só a subárvore de quem pede.
    expect(teamTree(TEAM, ['s2']).map((n) => [n.id, n.children.map((c) => c.id)])).toEqual([['s2', ['h3']]]);
  });
});
