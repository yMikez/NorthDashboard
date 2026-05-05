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
import { parsePagination, paginatedResponse } from '@/lib/pagination';
import { sendPartnerWelcome } from '@/lib/services/emails/partnerWelcome';
import { buildContext } from '@/lib/services/contractTemplate';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const pagination = parsePagination(url, { defaultPageSize: 50 });
  const q = (url.searchParams.get('q') ?? '').trim();

  const where: Prisma.UserWhereInput = q
    ? {
        OR: [
          { email: { contains: q, mode: 'insensitive' } },
          { name: { contains: q, mode: 'insensitive' } },
        ],
      }
    : {};

  const [users, total] = await Promise.all([
    db.user.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
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
        networkId: true,
        network: { select: { id: true, name: true } },
      },
      orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
    }),
    db.user.count({ where }),
  ]);

  const mapped = users.map((u) => ({
    ...u,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  }));

  // Backward-compat: caller antigo lê `users` direto. Mantemos o array no top
  // level + envelope `pagination` ao lado pra novos consumidores.
  const paged = paginatedResponse(mapped, total, pagination);
  return NextResponse.json({ users: paged.items, pagination: { page: paged.page, pageSize: paged.pageSize, total: paged.total, hasMore: paged.hasMore } });
}

interface CreateBody {
  email?: unknown;
  name?: unknown;
  password?: unknown;
  role?: unknown;
  allowedTabs?: unknown;
  networkId?: unknown;
}

function parseRole(v: unknown): UserRole {
  if (v === 'ADMIN') return 'ADMIN';
  if (v === 'NETWORK_PARTNER') return 'NETWORK_PARTNER';
  return 'MEMBER';
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
  const role = parseRole(body.role);
  const allowedTabs = role === 'ADMIN' || role === 'NETWORK_PARTNER' ? [] : sanitizeTabs(body.allowedTabs);
  const networkId = typeof body.networkId === 'string' && body.networkId ? body.networkId : null;

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'email inválido' }, { status: 400 });
  }
  const pwErr = validatePasswordStrength(password);
  if (pwErr) {
    return NextResponse.json({ error: pwErr }, { status: 400 });
  }
  if (role === 'NETWORK_PARTNER' && !networkId) {
    return NextResponse.json({ error: 'networkId obrigatório pra role NETWORK_PARTNER' }, { status: 400 });
  }
  if (networkId) {
    const exists = await db.network.findUnique({ where: { id: networkId }, select: { id: true } });
    if (!exists) return NextResponse.json({ error: 'network não encontrada' }, { status: 400 });
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
        networkId: role === 'NETWORK_PARTNER' ? networkId : null,
        createdById: auth.user.id,
        active: true,
      },
      select: {
        id: true, email: true, name: true, role: true, allowedTabs: true,
        active: true, lastLoginAt: true, createdAt: true, createdById: true,
        networkId: true,
      },
    });
    logger.info({ actorId: auth.user.id, userId: created.id, email, role }, 'admin.users.create');

    // Welcome email pra partners. Fail-soft: se SMTP falhar, log + segue.
    if (role === 'NETWORK_PARTNER' && created.networkId) {
      try {
        const network = await db.network.findUniqueOrThrow({
          where: { id: created.networkId },
          select: {
            name: true, commissionType: true, commissionValue: true,
            paymentPeriodValue: true, paymentPeriodUnit: true, contractStart: true,
            billingEmail: true,
          },
        });
        const ctx = buildContext(network, 1);
        // Fire and forget — não bloquear a criação do user em caso de SMTP lento.
        sendPartnerWelcome({
          to: created.email,
          partnerName: created.name,
          networkName: network.name,
          loginEmail: created.email,
          loginPassword: password,
          commissionDescription: ctx.commissionDescription,
          paymentPeriodText: ctx.paymentPeriodText,
        }).catch((err) => logger.error({ err }, '[users.create] partnerWelcome failed'));
      } catch (err) {
        logger.error({ err }, '[users.create] failed to dispatch welcome email');
      }
    }

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
