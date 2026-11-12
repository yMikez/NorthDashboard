import { describe, expect, it, vi } from 'vitest';

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock('./session', () => ({ getSessionUser: async () => current.user }));

import { denyPortfolio, effectiveTabs, requireAnyTab, requireFullAccess, requireTab } from './guard';
import type { SessionUser } from './session';

const user = (o: Partial<SessionUser>): SessionUser => ({
  id: 'u1', email: 'u@x', name: null, role: 'MEMBER', allowedTabs: [], networkId: null, portfolioRole: null, ...o,
});

describe('guard — carteira de afiliados', () => {
  it('quem tem função só abre as abas de vendas, mesmo marcadas outras; Carteira abre sempre', async () => {
    current.user = user({ portfolioRole: 'HUNTER', allowedTabs: ['overview', 'transactions', 'tauk', 'leaderboard'] });
    expect((await requireTab('overview')).ok).toBe(true);
    expect((await requireTab('leaderboard')).ok).toBe(true);
    expect((await requireTab('transactions')).ok).toBe(false); // dado de cliente
    expect((await requireTab('tauk')).ok).toBe(false);         // não filtra por afiliado
    expect((await requireTab('portfolio')).ok).toBe(true);
    expect((await requireTab('funnel')).ok).toBe(false);       // não marcada
    expect((await requireAnyTab(['transactions', 'platforms'])).ok).toBe(false);
    expect((await requireFullAccess()).ok).toBe(false);        // chat
    expect(effectiveTabs(current.user as SessionUser)).toEqual(['overview', 'leaderboard', 'portfolio']);
    expect(denyPortfolio(current.user as SessionUser)?.status).toBe(403);
  });

  it('sem função (ou admin) segue como antes', async () => {
    current.user = user({ allowedTabs: ['transactions'] });
    expect((await requireTab('transactions')).ok).toBe(true);
    expect((await requireTab('portfolio')).ok).toBe(false);
    expect((await requireFullAccess()).ok).toBe(true);
    current.user = user({ role: 'ADMIN', portfolioRole: 'AFF_MANAGER' });
    expect((await requireTab('tauk')).ok).toBe(true);
    expect(denyPortfolio(current.user as SessionUser)).toBeNull();
  });
});
