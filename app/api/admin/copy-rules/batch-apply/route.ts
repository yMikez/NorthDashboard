// POST /api/admin/copy-rules/batch-apply — aplica em lote os updates de pct
// sugeridos pela calculadora (Painel B). Cada update vira uma row em
// AutotuneLog (reason='calculator_suggestion') pra auditoria. Admin-only.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { invalidateRulesCache } from '@/lib/copy-optimizer/rules';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Update { key?: unknown; newPct?: unknown }

function pct(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  const t = Math.trunc(n);
  return t >= 0 && t <= 100 ? t : null;
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: { source?: unknown; updates?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  if (!Array.isArray(body.updates) || body.updates.length === 0) {
    return NextResponse.json({ error: 'updates vazio' }, { status: 400 });
  }
  const source = typeof body.source === 'string' ? body.source : 'calculator';

  const logs: string[] = [];
  let applied = 0;
  let skipped = 0;

  for (const u of body.updates as Update[]) {
    const key = typeof u.key === 'string' ? u.key.trim() : '';
    const newPct = pct(u.newPct);
    if (!key || newPct === null) { skipped++; continue; }

    const rule = await db.affiliateCopyRule.findUnique({
      where: { key },
      select: { id: true, black2Pct: true },
    });
    if (!rule) { skipped++; continue; }
    if (rule.black2Pct === newPct) { skipped++; continue; } // no-op

    const [, log] = await db.$transaction([
      db.affiliateCopyRule.update({
        where: { id: rule.id },
        data: { black2Pct: newPct, updatedBy: 'manual' },
      }),
      db.autotuneLog.create({
        data: {
          ruleId: rule.id,
          pctBefore: rule.black2Pct,
          pctAfter: newPct,
          reason: 'calculator_suggestion',
          metrics: { source },
        },
        select: { id: true },
      }),
    ]);
    applied++;
    logs.push(log.id.toString());
  }

  invalidateRulesCache();
  logger.info({ actorId: auth.user.id, applied, skipped, source }, 'admin.copy-rules.batch-apply');
  return NextResponse.json({ applied, skipped, logs });
}
