// /api/admin/profit-config — config global do modelo de lucro CPA.
//   GET   → { opexPct, healthyMinUsd, attentionMinUsd, metas de reembolso/CB }
//   PATCH → atualiza qualquer campo (admin). opexPct em percentual
//           (10 = 10%); régua do STATUS em USD sobre o NET AFTER CPA.
//
// As metas de reembolso/chargeback (2026-09-23) existem pra virar fonte única
// dos dois lados: o dash mostra e o SendTrace lê por
// GET /api/integrations/targets, em vez de cada sistema repetir o número.

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { clearResponseCache } from '@/lib/cache/responseCache';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ConfigRow = {
  opexPct: Prisma.Decimal; healthyMinUsd: Prisma.Decimal; attentionMinUsd: Prisma.Decimal;
  refundTargetD30Pct: Prisma.Decimal; refundLimitD30Pct: Prisma.Decimal;
  chargebackWarnPct: Prisma.Decimal; chargebackLimitPct: Prisma.Decimal;
};

function serialize(c: ConfigRow) {
  return {
    opexPct: Number(c.opexPct),
    healthyMinUsd: Number(c.healthyMinUsd),
    attentionMinUsd: Number(c.attentionMinUsd),
    refundTargetD30Pct: Number(c.refundTargetD30Pct),
    refundLimitD30Pct: Number(c.refundLimitD30Pct),
    chargebackWarnPct: Number(c.chargebackWarnPct),
    chargebackLimitPct: Number(c.chargebackLimitPct),
  };
}

const PCT_FIELDS = ['refundTargetD30Pct', 'refundLimitD30Pct', 'chargebackWarnPct', 'chargebackLimitPct'] as const;

async function ensureConfig() {
  return db.profitConfig.upsert({
    where: { id: 'global' },
    create: { id: 'global' },
    update: {},
  });
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ config: serialize(await ensureConfig()) });
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

  const data: Prisma.ProfitConfigUpdateInput = {};
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  const opex = num(body.opexPct);
  if (body.opexPct !== undefined) {
    if (opex === null || opex < 0 || opex > 100) {
      return NextResponse.json({ error: 'opexPct deve estar entre 0 e 100' }, { status: 400 });
    }
    data.opexPct = new Prisma.Decimal(opex.toFixed(2));
  }
  const healthy = num(body.healthyMinUsd);
  if (body.healthyMinUsd !== undefined) {
    if (healthy === null) return NextResponse.json({ error: 'healthyMinUsd inválido' }, { status: 400 });
    data.healthyMinUsd = new Prisma.Decimal(healthy.toFixed(2));
  }
  const attention = num(body.attentionMinUsd);
  if (body.attentionMinUsd !== undefined) {
    if (attention === null) return NextResponse.json({ error: 'attentionMinUsd inválido' }, { status: 400 });
    data.attentionMinUsd = new Prisma.Decimal(attention.toFixed(2));
  }
  for (const f of PCT_FIELDS) {
    if (body[f] === undefined) continue;
    const v = num(body[f]);
    if (v === null || v < 0 || v > 100) {
      return NextResponse.json({ error: `${f} deve estar entre 0 e 100` }, { status: 400 });
    }
    data[f] = new Prisma.Decimal(v.toFixed(2));
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'nada pra atualizar' }, { status: 400 });
  }

  await ensureConfig();
  const updated = await db.profitConfig.update({ where: { id: 'global' }, data });
  clearResponseCache();
  logger.info({ by: auth.user.id, data }, 'profit-config updated');
  return NextResponse.json({ ok: true, config: serialize(updated) });
}
