// Cookie-based session, custom (sem NextAuth). Sessão é uma row na tabela
// Session cujo id é o valor do cookie. Cookie é HttpOnly + SameSite=Lax +
// Secure em prod. SameSite=Lax mitiga CSRF nas POSTs cross-site (suficiente
// pro escopo atual; rotas mutáveis exigem auth, então não tem ação anônima
// pra um atacante orquestrar).
//
// 20 dias de validade, refresh-on-use: cada acesso autenticado estende o
// expiresAt pra rolling window de 20 dias.

import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import type { UserRole } from '@prisma/client';
import { db } from '../db';
import type { TabId } from './tabs';

export const SESSION_COOKIE = 'ns_session';
export const SESSION_TTL_DAYS = 20;
const TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  allowedTabs: TabId[];
  // Apenas pra role=NETWORK_PARTNER. Identifica qual Network esse user
  // representa — usado no auth guard pra escopar /api/network/me.
  networkId: string | null;
}

export function newSessionId(): string {
  return randomBytes(32).toString('hex');
}

export async function createSession(
  userId: string,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {},
): Promise<{ id: string; expiresAt: Date }> {
  const id = newSessionId();
  const expiresAt = new Date(Date.now() + TTL_MS);
  await db.session.create({
    data: {
      id,
      userId,
      expiresAt,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
    },
  });
  return { id, expiresAt };
}

export async function destroySession(sessionId: string): Promise<void> {
  // Best-effort delete; if row doesn't exist (already expired/cleaned), no-op.
  await db.session.deleteMany({ where: { id: sessionId } });
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const cookie = jar.get(SESSION_COOKIE);
  if (!cookie?.value) return null;
  return getSessionUserById(cookie.value);
}

export async function getSessionUserById(sessionId: string): Promise<SessionUser | null> {
  const session = await db.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      expiresAt: true,
      user: {
        select: { id: true, email: true, name: true, role: true, allowedTabs: true, active: true, networkId: true },
      },
    },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await db.session.deleteMany({ where: { id: sessionId } }).catch(() => {});
    return null;
  }
  if (!session.user.active) return null;

  // Rolling refresh: only when more than 1 day has elapsed since the session
  // was last extended, to avoid hammering the DB on every request.
  const remaining = session.expiresAt.getTime() - Date.now();
  if (TTL_MS - remaining > 24 * 60 * 60 * 1000) {
    db.session
      .update({ where: { id: sessionId }, data: { expiresAt: new Date(Date.now() + TTL_MS) } })
      .catch(() => {});
  }

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
    allowedTabs: session.user.allowedTabs as TabId[],
    networkId: session.user.networkId,
  };
}

export function buildCookieHeader(sessionId: string, expiresAt: Date): string {
  const isProd = process.env.NODE_ENV === 'production';
  const parts = [
    `${SESSION_COOKIE}=${sessionId}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (isProd) parts.push('Secure');
  return parts.join('; ');
}

export function buildClearCookieHeader(): string {
  const isProd = process.env.NODE_ENV === 'production';
  const parts = [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'Max-Age=0',
  ];
  if (isProd) parts.push('Secure');
  return parts.join('; ');
}
