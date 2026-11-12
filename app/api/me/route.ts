// GET /api/me
// Retorna info do usuário autenticado pra SPA decidir o que renderizar.
// 401 quando sem sessão (SPA redireciona pra /login).
//
// Carteira de afiliados: quem tem função (Gerente/SL/Hunter) recebe só as
// abas que de fato abre (PORTFOLIO_TABS) e `portfolioScoped` — a SPA esconde
// chat e painéis da operação inteira. O servidor barra de qualquer jeito.

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { effectiveTabs } from '@/lib/auth/guard';
import { isPortfolioScoped } from '@/lib/portfolio/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  return NextResponse.json({
    user: { ...user, allowedTabs: effectiveTabs(user), portfolioScoped: isPortfolioScoped(user) },
  });
}
