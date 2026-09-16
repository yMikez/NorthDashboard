// Lucro real por dia (admin-only).
//   POST /api/admin/net-profit/daily { start_date, end_date, params }
//        → { days: [{ start, end, kpis, channels }], truncated }
// Mesma fórmula do cálculo principal aplicada a cada dia (calculo_margem
// §10.8). Até 62 dias; inputs de cada dia ficam no cache de 60s.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { DAILY_MAX_DAYS, evaluateNetProfitDaily } from '@/lib/services/netProfit';
import { normalizeParams } from '@/lib/services/netProfitCore';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function authorized(req: Request): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  if (bearer && checkIngestSecret(bearer)) return { ok: true };
  const auth = await requireAdmin();
  return auth.ok ? { ok: true } : { ok: false, response: auth.response };
}

export async function POST(req: Request) {
  const auth = await authorized(req);
  if (!auth.ok) return auth.response;
  let body: { start_date?: string; end_date?: string; params?: unknown };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: 'invalid body' }, { status: 400 }); }
  const start = new Date(body.start_date ?? ''); const end = new Date(body.end_date ?? '');
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return NextResponse.json({ error: 'invalid date range' }, { status: 400 });
  const t0 = Date.now();
  try {
    const days = await evaluateNetProfitDaily(start, end, normalizeParams(body.params));
    const totalDays = Math.ceil((end.getTime() - start.getTime() + 1) / (24 * 3600_000));
    logger.info({ endpoint: 'admin/net-profit/daily', days: days.length, ms: Date.now() - t0 }, 'metrics.timing');
    return NextResponse.json({ days, truncated: totalDays > DAILY_MAX_DAYS });
  } catch (err) {
    logger.error({ err }, 'admin/net-profit/daily failed');
    return NextResponse.json({ error: 'compute failed', message: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
