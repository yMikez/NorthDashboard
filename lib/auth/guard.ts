// Server-side helpers pra Route Handlers protegerem endpoints. Cada
// endpoint /api/metrics/* importa uma destas e checa antes de retornar
// dados. Devolve a NextResponse de erro pronta quando bloqueia, ou o
// SessionUser quando permite.

import { NextResponse } from 'next/server';
import { getSessionUser, type SessionUser } from './session';
import type { TabId } from './tabs';

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
  if (auth.user.allowedTabs.includes(tab)) return auth;
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
  if (tabs.some((t) => auth.user.allowedTabs.includes(t))) return auth;
  return {
    ok: false,
    response: NextResponse.json({ error: 'forbidden', tabs }, { status: 403 }),
  };
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

/**
 * Partner-only guard. Garante que o user é NETWORK_PARTNER E tem
 * networkId setado. Endpoints /api/network/me/* usam isso pra resolver
 * qual network mostrar sem confiar em params do path.
 */
export async function requireNetworkPartner(): Promise<
  | { ok: true; user: SessionUser & { networkId: string } }
  | { ok: false; response: NextResponse }
> {
  const auth = await requireAuth();
  if (!auth.ok) return auth;
  if (auth.user.role !== 'NETWORK_PARTNER' || !auth.user.networkId) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'network partner required' }, { status: 403 }),
    };
  }
  return { ok: true, user: { ...auth.user, networkId: auth.user.networkId } };
}
