// POST /api/auth/signin
// Body: { email, password }
// On success: 200 with Set-Cookie ns_session, returns { user }.
// On failure: 401 (não diferencia "email não existe" de "senha errada"
// pra não vazar enumeração de usuários).

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyPassword } from '@/lib/auth/password';
import { createSession, buildCookieHeader } from '@/lib/auth/session';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  email?: unknown;
  password?: unknown;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password) {
    return NextResponse.json({ error: 'invalid credentials' }, { status: 401 });
  }

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, role: true, allowedTabs: true, passwordHash: true, active: true },
  });
  if (!user || !user.active) {
    return NextResponse.json({ error: 'invalid credentials' }, { status: 401 });
  }
  const match = await verifyPassword(password, user.passwordHash);
  if (!match) {
    return NextResponse.json({ error: 'invalid credentials' }, { status: 401 });
  }

  const ipAddress =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    null;
  const userAgent = req.headers.get('user-agent') || null;
  const session = await createSession(user.id, { ipAddress, userAgent });
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  logger.info({ userId: user.id, email: user.email }, 'auth.signin');

  const res = NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      allowedTabs: user.allowedTabs,
    },
  });
  res.headers.set('Set-Cookie', buildCookieHeader(session.id, session.expiresAt));
  return res;
}
