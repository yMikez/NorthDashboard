// GET /api/admin/copy-autotune/logs?limit=50&ruleId=xxx — histórico de decisões
// do auto-tune (Painel D). Read-only, admin-only.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const ruleId = searchParams.get('ruleId') || undefined;
  const limitRaw = Number(searchParams.get('limit'));
  const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, Math.trunc(limitRaw))) : 50;

  const logs = await db.autotuneLog.findMany({
    where: ruleId ? { ruleId } : undefined,
    orderBy: { decidedAt: 'desc' },
    take: limit,
    include: { rule: { select: { key: true } } },
  });

  return NextResponse.json({
    logs: logs.map((l) => ({
      id: l.id.toString(),
      ruleKey: l.rule?.key ?? null,
      pctBefore: l.pctBefore,
      pctAfter: l.pctAfter,
      reason: l.reason,
      metrics: l.metrics,
      decidedAt: l.decidedAt.toISOString(),
    })),
  });
}
