// POST /api/auth/signout
// Destroys the session row + clears the cookie. Safe to call sem sessão.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { destroySession, SESSION_COOKIE, buildClearCookieHeader } from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const jar = await cookies();
  const c = jar.get(SESSION_COOKIE);
  if (c?.value) {
    await destroySession(c.value);
  }
  const res = NextResponse.json({ ok: true });
  res.headers.set('Set-Cookie', buildClearCookieHeader());
  return res;
}
