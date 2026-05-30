// GET/PATCH /api/admin/copy-autotune/config — config global do auto-tune
// (Painel D). Singleton row 'global'. Admin-only.

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serialize(c: {
  cooldownH: number; windowH: number; minSample: number;
  liftThresholdPp: number; adverseThresholdPp: number;
  globalTargetAov: Prisma.Decimal; updatedAt: Date;
}) {
  return {
    cooldownH: c.cooldownH,
    windowH: c.windowH,
    minSample: c.minSample,
    liftThresholdPp: c.liftThresholdPp,
    adverseThresholdPp: c.adverseThresholdPp,
    globalTargetAov: Number(c.globalTargetAov),
    updatedAt: c.updatedAt.toISOString(),
  };
}

async function ensureConfig() {
  return db.copyAutotuneConfig.upsert({
    where: { id: 'global' },
    update: {},
    create: { id: 'global' },
  });
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const c = await ensureConfig();
  return NextResponse.json({ config: serialize(c) });
}

function intIn(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  const t = Math.trunc(n);
  return t >= min && t <= max ? t : null;
}

export async function PATCH(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const data: Prisma.CopyAutotuneConfigUpdateInput = {};
  const checks: Array<[string, number, number, (n: number) => void]> = [
    ['cooldownH', 0, 720, (n) => (data.cooldownH = n)],
    ['windowH', 1, 720, (n) => (data.windowH = n)],
    ['minSample', 1, 100000, (n) => (data.minSample = n)],
    ['liftThresholdPp', 0, 100, (n) => (data.liftThresholdPp = n)],
    ['adverseThresholdPp', -100, 0, (n) => (data.adverseThresholdPp = n)],
  ];
  for (const [field, min, max, set] of checks) {
    if (field in body) {
      const n = intIn(body[field], min, max);
      if (n === null) return NextResponse.json({ error: `${field} inválido` }, { status: 400 });
      set(n);
    }
  }
  if ('globalTargetAov' in body) {
    const n = typeof body.globalTargetAov === 'number' ? body.globalTargetAov : Number(body.globalTargetAov);
    if (!Number.isFinite(n) || n <= 0) return NextResponse.json({ error: 'globalTargetAov inválido' }, { status: 400 });
    data.globalTargetAov = new Prisma.Decimal(Math.round(n * 100) / 100);
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'nada pra atualizar' }, { status: 400 });
  }

  await ensureConfig();
  const updated = await db.copyAutotuneConfig.update({ where: { id: 'global' }, data });
  logger.info({ actorId: auth.user.id, patch: data }, 'admin.copy-autotune.config patch');
  return NextResponse.json({ config: serialize(updated) });
}
