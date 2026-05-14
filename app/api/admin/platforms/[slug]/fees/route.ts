// PATCH /api/admin/platforms/[slug]/fees
//   Body: { feeRatePct?: number, allowancePct?: number }
//   Atualiza taxas + allowance da plataforma. Admin-only.
//
// Inputs em porcentagem (não decimal): "8.37" significa 8.37%.
// Range 0-100; null/undefined preserva o valor atual. feesUpdatedAt é
// bumped pra agora — drive do popup de re-confirmação a cada 7 dias.

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  feeRatePct?: number | null;
  allowancePct?: number | null;
}

function validPct(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { slug } = await params;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const data: Prisma.PlatformUpdateInput = {};
  if (body.feeRatePct === null) {
    data.feeRatePct = null;
  } else if (body.feeRatePct !== undefined) {
    if (!validPct(body.feeRatePct)) {
      return NextResponse.json(
        { error: 'feeRatePct deve estar entre 0 e 100' },
        { status: 400 },
      );
    }
    data.feeRatePct = new Prisma.Decimal(body.feeRatePct.toFixed(2));
  }
  if (body.allowancePct === null) {
    data.allowancePct = null;
  } else if (body.allowancePct !== undefined) {
    if (!validPct(body.allowancePct)) {
      return NextResponse.json(
        { error: 'allowancePct deve estar entre 0 e 100' },
        { status: 400 },
      );
    }
    data.allowancePct = new Prisma.Decimal(body.allowancePct.toFixed(2));
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'nada pra atualizar' }, { status: 400 });
  }
  data.feesUpdatedAt = new Date();

  try {
    const updated = await db.platform.update({
      where: { slug },
      data,
      select: {
        slug: true,
        displayName: true,
        feeRatePct: true,
        allowancePct: true,
        feesUpdatedAt: true,
      },
    });
    logger.info({ slug, by: auth.user.id, fees: data }, 'admin/platforms/fees updated');
    return NextResponse.json({
      ok: true,
      platform: {
        slug: updated.slug,
        displayName: updated.displayName,
        feeRatePct: updated.feeRatePct ? Number(updated.feeRatePct) : null,
        allowancePct: updated.allowancePct ? Number(updated.allowancePct) : null,
        feesUpdatedAt: updated.feesUpdatedAt?.toISOString() ?? null,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return NextResponse.json({ error: 'plataforma não encontrada' }, { status: 404 });
    }
    logger.error({ err, slug }, 'admin/platforms/fees update failed');
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
