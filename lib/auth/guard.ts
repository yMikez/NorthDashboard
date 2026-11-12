// Server-side helpers pra Route Handlers protegerem endpoints. Cada
// endpoint /api/metrics/* importa uma destas e checa antes de retornar
// dados. Devolve a NextResponse de erro pronta quando bloqueia, ou o
// SessionUser quando permite.

import { NextResponse } from 'next/server';
import { getSessionUser, type SessionUser } from './session';
import { isPortfolioTab, type TabId } from './tabs';
import { isPortfolioScoped } from '../portfolio/core';

// Carteira de afiliados: quem tem função (Gerente/SL/Hunter, não ADMIN) só
// abre as abas recortáveis pela carteira (PORTFOLIO_TABS), mesmo se outras
// estiverem marcadas no usuário.
// A aba Carteira abre sempre pra quem tem função (é a casa dele).
const tabOpen = (user: SessionUser, tab: TabId) => {
  if (!isPortfolioScoped(user)) return user.allowedTabs.includes(tab);
  return tab === 'portfolio' || (user.allowedTabs.includes(tab) && isPortfolioTab(tab));
};

/** Abas que o usuário de fato abre (o que a SPA recebe em /api/me). */
export function effectiveTabs(user: SessionUser): TabId[] {
  if (!isPortfolioScoped(user)) return user.allowedTabs;
  const tabs = user.allowedTabs.filter((t) => isPortfolioTab(t));
  return tabs.includes('portfolio') ? tabs : [...tabs, 'portfolio'];
}

export async function requireAuth(): Promise<
  | { ok: true; user: SessionUser }
  | { ok: false; response: NextResponse }
> {
  const user = await getSessionUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }),
    };
  }
  return { ok: true, user };
}

export async function requireTab(
  tab: TabId,
): Promise<
  | { ok: true; user: SessionUser }
  | { ok: false; response: NextResponse }
> {
  const auth = await requireAuth();
  if (!auth.ok) return auth;
  if (auth.user.role === 'ADMIN') return auth;
  if (tabOpen(auth.user, tab)) return auth;
  return {
    ok: false,
    response: NextResponse.json({ error: 'forbidden', tab }, { status: 403 }),
  };
}

export async function requireAnyTab(
  tabs: TabId[],
): Promise<
  | { ok: true; user: SessionUser }
  | { ok: false; response: NextResponse }
> {
  const auth = await requireAuth();
  if (!auth.ok) return auth;
  if (auth.user.role === 'ADMIN') return auth;
  if (tabs.some((t) => tabOpen(auth.user, t))) return auth;
  return {
    ok: false,
    response: NextResponse.json({ error: 'forbidden', tabs }, { status: 403 }),
  };
}

/**
 * Dado que só existe na visão da operação inteira (resultado oficial por
 * plataforma, monitor de call center, mapeamento, chat IA…): quem tem
 * função na carteira não recebe. Usar DEPOIS do guard da aba.
 */
export function denyPortfolio(user: SessionUser): NextResponse | null {
  if (!isPortfolioScoped(user)) return null;
  return NextResponse.json({ error: 'forbidden', reason: 'carteira' }, { status: 403 });
}

/** requireAuth que barra quem tem função na carteira (rotas sem recorte, ex.: chat). */
export async function requireFullAccess(): Promise<
  | { ok: true; user: SessionUser }
  | { ok: false; response: NextResponse }
> {
  const auth = await requireAuth();
  if (!auth.ok) return auth;
  const denied = denyPortfolio(auth.user);
  if (denied) return { ok: false, response: denied };
  return auth;
}

export async function requireAdmin(): Promise<
  | { ok: true; user: SessionUser }
  | { ok: false; response: NextResponse }
> {
  const auth = await requireAuth();
  if (!auth.ok) return auth;
  if (auth.user.role !== 'ADMIN') {
    return {
      ok: false,
      response: NextResponse.json({ error: 'admin required' }, { status: 403 }),
    };
  }
  return auth;
}
