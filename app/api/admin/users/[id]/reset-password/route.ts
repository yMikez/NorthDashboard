// POST /api/admin/users/[id]/reset-password
// Body: { password }
// Admin define nova senha pro usuário. Derruba sessões existentes do user
// pra forçar reauth com a nova senha (segurança contra session hijack após
// reset).

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { hashPassword, validatePasswordStrength } from '@/lib/auth/password';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  let body: { password?: unknown };
  try {
    body = (await req.json()) as { password?: unknown };
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const password = typeof body.password === 'string' ? body.password : '';
  const err = validatePasswordStrength(password);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  const target = await db.user.findUnique({ where: { id }, select: { id: true, email: true } });
  if (!target) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const passwordHash = await hashPassword(password);
  await db.user.update({ where: { id }, data: { passwordHash } });

  // Derruba sessões — se está mudando a senha do próprio user logado, ele
  // vai precisar logar de novo na próxima requisição.
  await db.session.deleteMany({ where: { userId: id } }).catch(() => {});

  logger.info({ actorId: auth.user.id, userId: id, email: target.email }, 'admin.users.resetPassword');
  return NextResponse.json({ ok: true });
}
