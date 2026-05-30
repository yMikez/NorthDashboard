// /api/admin/copy-rules/[id]
//   PATCH  → atualiza campos da regra (updatedBy='manual').
//   DELETE → remove a regra (AutotuneLog cascateia via FK).
//
// Admin-only. Ambas invalidam o cache de regras pra a decisão refletir na hora.

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { validateRulePatch, railsError } from '@/lib/copy-optimizer/validation';
import { serializeRule } from '@/lib/copy-optimizer/serialize';
import { invalidateRulesCache } from '@/lib/copy-optimizer/rules';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const parsed = validateRulePatch(body);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const patch = parsed.value;

  const existing = await db.affiliateCopyRule.findUnique({
    where: { id },
    select: { minPct: true, maxPct: true, stepPct: true },
  });
  if (!existing) {
    return NextResponse.json({ error: 'regra não encontrada' }, { status: 404 });
  }

  // Revalida rails combinando o patch com os valores atuais (ex: PATCH só de
  // minPct=90 com maxPct=80 existente → incoerente).
  const effMin = patch.minPct ?? existing.minPct;
  const effMax = patch.maxPct ?? existing.maxPct;
  const effStep = patch.stepPct ?? existing.stepPct;
  const railsErr = railsError(effMin, effMax, effStep);
  if (railsErr) {
    return NextResponse.json({ error: railsErr }, { status: 400 });
  }

  const data: Prisma.AffiliateCopyRuleUpdateInput = { updatedBy: 'manual' };
  if (patch.black2Pct !== undefined) data.black2Pct = patch.black2Pct;
  if (patch.enabled !== undefined) data.enabled = patch.enabled;
  if (patch.autotune !== undefined) data.autotune = patch.autotune;
  if (patch.minPct !== undefined) data.minPct = patch.minPct;
  if (patch.maxPct !== undefined) data.maxPct = patch.maxPct;
  if (patch.stepPct !== undefined) data.stepPct = patch.stepPct;
  if (patch.targetAov !== undefined) {
    data.targetAov = patch.targetAov != null ? new Prisma.Decimal(patch.targetAov) : null;
  }

  try {
    const updated = await db.affiliateCopyRule.update({ where: { id }, data });
    invalidateRulesCache();
    logger.info({ actorId: auth.user.id, id, patch }, 'admin.copy-rules.patch');
    return NextResponse.json({ rule: serializeRule(updated) });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return NextResponse.json({ error: 'regra não encontrada' }, { status: 404 });
    }
    logger.error({ err, id }, 'admin.copy-rules.patch failed');
    return NextResponse.json({ error: 'update failed' }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  try {
    await db.affiliateCopyRule.delete({ where: { id } });
    invalidateRulesCache();
    logger.info({ actorId: auth.user.id, id }, 'admin.copy-rules.delete');
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return NextResponse.json({ error: 'regra não encontrada' }, { status: 404 });
    }
    logger.error({ err, id }, 'admin.copy-rules.delete failed');
    return NextResponse.json({ error: 'delete failed' }, { status: 500 });
  }
}
