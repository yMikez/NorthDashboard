// /api/admin/users
//   GET  → lista todos os usuários (com lastLoginAt, sem hash)
//   POST → cria novo usuário { email, name?, password, role, allowedTabs[] }
// Ambos exigem session de ADMIN.

import { NextResponse } from 'next/server';
import { Prisma, type UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { hashPassword, validatePasswordStrength } from '@/lib/auth/password';
import { sanitizeTabs } from '@/lib/auth/tabs';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const users = await db.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      allowedTabs: true,
      active: true,
      lastLoginAt: true,
      createdAt: true,
      createdById: true,
    },
    orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
  });
  return NextResponse.json({
    users: users.map((u) => ({
      ...u,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
    })),
  });
}

interface CreateBody {
  email?: unknown;
  name?: unknown;
  password?: unknown;
  role?: unknown;
  allowedTabs?: unknown;
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;
  const password = typeof body.password === 'string' ? body.password : '';
  const role: UserRole = body.role === 'ADMIN' ? 'ADMIN' : 'MEMBER';
  const allowedTabs = role === 'ADMIN' ? [] : sanitizeTabs(body.allowedTabs);

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'email inválido' }, { status: 400 });
  }
  const pwErr = validatePasswordStrength(password);
  if (pwErr) {
    return NextResponse.json({ error: pwErr }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);
  try {
    const created = await db.user.create({
      data: {
        email,
        name,
        passwordHash,
        role,
        allowedTabs,
        createdById: auth.user.id,
        active: true,
      },
      select: {
        id: true, email: true, name: true, role: true, allowedTabs: true,
        active: true, lastLoginAt: true, createdAt: true, createdById: true,
      },
    });
    logger.info({ actorId: auth.user.id, userId: created.id, email }, 'admin.users.create');
    return NextResponse.json({
      user: {
        ...created,
        lastLoginAt: null,
        createdAt: created.createdAt.toISOString(),
      },
    }, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'email já cadastrado' }, { status: 409 });
    }
    logger.error({ err }, 'admin.users.create failed');
    return NextResponse.json({ error: 'create failed' }, { status: 500 });
  }
}
