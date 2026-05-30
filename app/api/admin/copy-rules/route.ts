// /api/admin/copy-rules
//   GET  → lista todas as AffiliateCopyRule (ordem por key).
//   POST → cria uma regra nova (409 se a key já existe).
//
// Admin-only. Mutações invalidam o cache de regras (rules.ts) pra a decisão
// (/api/copy-decision) refletir na hora.

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { validateRuleCreate } from '@/lib/copy-optimizer/validation';
import { serializeRule } from '@/lib/copy-optimizer/serialize';
import { invalidateRulesCache } from '@/lib/copy-optimizer/rules';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const rules = await db.affiliateCopyRule.findMany({ orderBy: { key: 'asc' } });
  return NextResponse.json({ rules: rules.map(serializeRule) });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const parsed = validateRuleCreate(body);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const v = parsed.value;

  try {
    const created = await db.affiliateCopyRule.create({
      data: {
        key: v.key,
        keyType: v.keyType,
        black2Pct: v.black2Pct,
        enabled: v.enabled,
        autotune: v.autotune,
        minPct: v.minPct,
        maxPct: v.maxPct,
        stepPct: v.stepPct,
        targetAov: v.targetAov != null ? new Prisma.Decimal(v.targetAov) : null,
        updatedBy: 'manual',
      },
    });
    invalidateRulesCache();
    logger.info({ actorId: auth.user.id, key: v.key, black2Pct: v.black2Pct }, 'admin.copy-rules.create');
    return NextResponse.json({ rule: serializeRule(created) }, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'já existe regra com essa key' }, { status: 409 });
    }
    logger.error({ err, key: v.key }, 'admin.copy-rules.create failed');
    return NextResponse.json({ error: 'create failed' }, { status: 500 });
  }
}
