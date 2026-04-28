// GET /api/me
// Retorna info do usuário autenticado pra SPA decidir o que renderizar.
// 401 quando sem sessão (SPA redireciona pra /login).

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  return NextResponse.json({ user });
}
