// DELETE /api/admin/recovery-affiliates/[id] — remove a marcação de recuperação
// de um afiliado. Admin-only.

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  try {
    await db.recoveryAffiliate.delete({ where: { id } });
    logger.info({ actorId: auth.user.id, id }, 'admin.recovery-affiliates.delete');
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return NextResponse.json({ error: 'não encontrado' }, { status: 404 });
    }
    logger.error({ err, id }, 'admin.recovery-affiliates.delete failed');
    return NextResponse.json({ error: 'delete failed' }, { status: 500 });
  }
}
