// /api/admin/users/[id]
//   PATCH  → atualiza name/role/allowedTabs/active
//   DELETE → soft delete (active=false). Sessão do user é invalidada.
//
// Footguns bloqueados: admin não pode se auto-rebaixar, se desativar
// nem se deletar — feitos pra impedir ficar trancado fora do dashboard.

import { NextResponse } from 'next/server';
import type { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { invalidateSessionCache } from '@/lib/auth/session';
import { sanitizeTabs } from '@/lib/auth/tabs';
import { parsePortfolioFields } from '@/lib/portfolio/admin';
import { invalidatePortfolioCache } from '@/lib/portfolio/scope';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PatchBody {
  name?: unknown;
  role?: unknown;
  allowedTabs?: unknown;
  active?: unknown;
  portfolioRole?: unknown;
  portfolioParentId?: unknown;
  region?: unknown;
}

function parseRole(v: unknown): UserRole {
  if (v === 'ADMIN') return 'ADMIN';
  return 'MEMBER';
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const target = await db.user.findUnique({
    where: { id },
    select: { id: true, role: true, active: true, networkId: true, portfolioRole: true, portfolioParentId: true, region: true },
  });
  if (!target) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const isSelf = target.id === auth.user.id;

  const data: {
    name?: string | null;
    role?: UserRole;
    allowedTabs?: string[];
    active?: boolean;
    networkId?: string | null;
    portfolioRole?: 'AFF_MANAGER' | 'SQUAD_LEADER' | 'HUNTER' | null;
    portfolioParentId?: string | null;
    region?: string | null;
  } = {};

  if ('name' in body) {
    data.name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;
  }
  if ('role' in body) {
    const newRole = parseRole(body.role);
    if (isSelf && target.role === 'ADMIN' && newRole !== 'ADMIN') {
      return NextResponse.json(
        { error: 'admin não pode se rebaixar (use outra conta admin pra fazer)' },
        { status: 400 },
      );
    }
    data.role = newRole;
    // Promover pra admin limpa allowedTabs (admin acessa tudo). Qualquer
    // troca de role sai do mundo networks (programa removido 2026-08-18):
    // networkId é sempre limpo.
    if (newRole === 'ADMIN') data.allowedTabs = [];
    data.networkId = null;
  }
  if ('allowedTabs' in body) {
    const incomingRole = data.role ?? target.role;
    data.allowedTabs = incomingRole === 'ADMIN' ? [] : sanitizeTabs(body.allowedTabs);
  }
  if ('active' in body) {
    const next = !!body.active;
    if (isSelf && target.active && !next) {
      return NextResponse.json(
        { error: 'você não pode desativar sua própria conta' },
        { status: 400 },
      );
    }
    data.active = next;
  }

  if ('portfolioRole' in body || 'portfolioParentId' in body || 'region' in body) {
    const portfolio = await parsePortfolioFields(body, target, data.role ?? target.role);
    if ('error' in portfolio) return NextResponse.json({ error: portfolio.error }, { status: 400 });
    Object.assign(data, portfolio.data);
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'nada pra atualizar' }, { status: 400 });
  }

  // Se o role final for NETWORK_PARTNER, garantir que ele tem networkId
  // (ou no body, ou já gravado no target).
  const finalRole = data.role ?? target.role;
  const finalNetworkId = 'networkId' in data ? data.networkId : target.networkId;
  if (finalRole === 'NETWORK_PARTNER' && !finalNetworkId) {
    return NextResponse.json(
      { error: 'networkId obrigatório pra role NETWORK_PARTNER' },
      { status: 400 },
    );
  }

  const updated = await db.user.update({
    where: { id },
    data,
    select: {
      id: true, email: true, name: true, role: true, allowedTabs: true,
      active: true, lastLoginAt: true, createdAt: true, createdById: true,
      networkId: true, portfolioRole: true, portfolioParentId: true, region: true,
    },
  });

  // Se desativamos, derruba todas as sessões ativas do user.
  if (data.active === false) {
    await db.session.deleteMany({ where: { userId: id } }).catch(() => {});
  }
  // Role/tabs/active mudaram → derruba o cache de sessão pra propagar já
  // (sem isso a mudança levaria até 30s pra valer em requests autenticados).
  invalidateSessionCache();
  invalidatePortfolioCache();

  logger.info({ actorId: auth.user.id, userId: id, changes: Object.keys(data) }, 'admin.users.patch');

  return NextResponse.json({
    user: {
      ...updated,
      lastLoginAt: updated.lastLoginAt?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
    },
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  if (id === auth.user.id) {
    return NextResponse.json(
      { error: 'você não pode deletar sua própria conta' },
      { status: 400 },
    );
  }

  // Soft delete: marca active=false e derruba sessões. Preserva linhagem
  // de createdById e lastLoginAt pra audit.
  const target = await db.user.findUnique({ where: { id }, select: { id: true } });
  if (!target) return NextResponse.json({ error: 'not found' }, { status: 404 });

  await db.user.update({ where: { id }, data: { active: false } });
  await db.session.deleteMany({ where: { userId: id } }).catch(() => {});
  invalidateSessionCache();

  logger.info({ actorId: auth.user.id, userId: id }, 'admin.users.delete');
  return NextResponse.json({ ok: true });
}
