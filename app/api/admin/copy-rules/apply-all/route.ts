// POST /api/admin/copy-rules/apply-all — cria uma regra pra TODO afiliado
// BuyGoods que ainda não tem (key = aff_id), com o % e auto-tune escolhidos.
// Não toca em regras existentes (preserva % já ajustado manualmente/auto-tune).
// Admin-only. É o "botão pra cobrir todos os afiliados de uma vez".

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { invalidateRulesCache } from '@/lib/copy-optimizer/rules';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function pct(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  const t = Math.trunc(n);
  return t >= 0 && t <= 100 ? t : null;
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: { black2Pct?: unknown; autotune?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const black2Pct = pct(body.black2Pct);
  if (black2Pct === null) {
    return NextResponse.json({ error: 'black2Pct deve estar entre 0 e 100' }, { status: 400 });
  }
  const autotune = body.autotune === true || body.autotune === 'true';

  // Todos os afiliados BuyGoods (a copy só roda nessa plataforma).
  const affs = await db.affiliate.findMany({
    where: { platform: { slug: 'buygoods' } },
    select: { externalId: true },
  });
  const keys = Array.from(new Set(affs.map((a) => a.externalId).filter((k): k is string => !!k)));

  const existing = await db.affiliateCopyRule.findMany({
    where: { key: { in: keys } },
    select: { key: true },
  });
  const existingSet = new Set(existing.map((e) => e.key));
  const toCreate = keys.filter((k) => !existingSet.has(k));

  if (toCreate.length > 0) {
    const now = new Date();
    await db.affiliateCopyRule.createMany({
      data: toCreate.map((key) => ({
        key, keyType: 'id', black2Pct, enabled: true, autotune,
        updatedBy: 'manual', updatedAt: now,
      })),
      skipDuplicates: true,
    });
  }

  invalidateRulesCache();
  logger.info(
    { actorId: auth.user.id, created: toCreate.length, skipped: existingSet.size, black2Pct, autotune },
    'admin.copy-rules.apply-all',
  );
  return NextResponse.json({ created: toCreate.length, skipped: existingSet.size, total: keys.length });
}
