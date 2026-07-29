// PATCH /api/admin/affiliates/refund-override — override de refund&cb% do
// modelo CPA pra UM afiliado. Body: { platformSlug, externalId,
// refundCbPct: number|null } — null volta a herdar o default da
// plataforma. Admin-only.

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { clearResponseCache } from '@/lib/cache/responseCache';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const platformSlug = String(body.platformSlug ?? '').trim().toLowerCase();
  const externalId = String(body.externalId ?? '').trim();
  if (!platformSlug || !externalId) {
    return NextResponse.json({ error: 'platformSlug e externalId obrigatórios' }, { status: 400 });
  }
  let value: Prisma.Decimal | null = null;
  if (body.refundCbPct !== null && body.refundCbPct !== undefined) {
    const n = Number(body.refundCbPct);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return NextResponse.json({ error: 'refundCbPct deve estar entre 0 e 100 (ou null pra herdar)' }, { status: 400 });
    }
    value = new Prisma.Decimal(n.toFixed(2));
  }

  const platform = await db.platform.findUnique({ where: { slug: platformSlug }, select: { id: true } });
  if (!platform) return NextResponse.json({ error: 'plataforma não encontrada' }, { status: 404 });

  try {
    const aff = await db.affiliate.update({
      where: { platformId_externalId: { platformId: platform.id, externalId } },
      data: { refundCbPctOverride: value },
      select: { externalId: true, refundCbPctOverride: true },
    });
    clearResponseCache();
    logger.info({ platformSlug, externalId, value: value ? Number(value) : null, by: auth.user.id }, 'affiliate refund override set');
    return NextResponse.json({
      ok: true,
      affiliate: { externalId: aff.externalId, refundCbPctOverride: aff.refundCbPctOverride ? Number(aff.refundCbPctOverride) : null },
    });
  } catch {
    return NextResponse.json({ error: 'afiliado não encontrado' }, { status: 404 });
  }
}
