// Lucro real (admin-only).
//   GET  /api/admin/net-profit?start_date&end_date
//        → { period, params, paramsUpdatedAt, result, needs, scenarios }
//   POST /api/admin/net-profit  { start_date, end_date, params }
//        → { result, needs }  (recálculo "em tempo real": inputs medidos
//          ficam em cache 60s no servidor; só a fórmula roda de novo)
// Parâmetros vigentes e projeções: ./params e ./scenarios.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { evaluateNetProfit, getNetProfitParams, listNetProfitScenarios } from '@/lib/services/netProfit';
import { normalizeParams } from '@/lib/services/netProfitCore';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Auth: sessão ADMIN (aba) OU bearer INGEST_SECRET (curl/ops) — mesmo padrão
// das demais rotas /api/admin/* com operação por linha de comando.
async function authorized(req: Request): Promise<{ ok: true; userId: string | null } | { ok: false; response: NextResponse }> {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  if (bearer && checkIngestSecret(bearer)) return { ok: true, userId: null };
  const auth = await requireAdmin();
  return auth.ok ? { ok: true, userId: auth.user.id } : { ok: false, response: auth.response };
}

function parsePeriod(startRaw: string | null, endRaw: string | null): { start: Date; end: Date } | NextResponse {
  if (!startRaw || !endRaw) return NextResponse.json({ error: 'start_date and end_date are required (ISO 8601)' }, { status: 400 });
  const start = new Date(startRaw); const end = new Date(endRaw);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return NextResponse.json({ error: 'invalid date range' }, { status: 400 });
  return { start, end };
}

export async function GET(req: Request) {
  const auth = await authorized(req);
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(req.url);
  const period = parsePeriod(searchParams.get('start_date'), searchParams.get('end_date'));
  if (period instanceof NextResponse) return period;
  const t0 = Date.now();
  try {
    const [{ params, updatedAt }, scenarios] = await Promise.all([getNetProfitParams(), listNetProfitScenarios()]);
    const { result, needs } = await evaluateNetProfit(period.start, period.end, params);
    logger.info({ endpoint: 'admin/net-profit', ms: Date.now() - t0 }, 'metrics.timing');
    return NextResponse.json({
      period: { start: period.start.toISOString(), end: period.end.toISOString() },
      params, paramsUpdatedAt: updatedAt, result, needs, scenarios,
    });
  } catch (err) {
    logger.error({ err }, 'admin/net-profit failed');
    return NextResponse.json({ error: 'query failed', message: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await authorized(req);
  if (!auth.ok) return auth.response;
  let body: { start_date?: string; end_date?: string; params?: unknown };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: 'invalid body' }, { status: 400 }); }
  const period = parsePeriod(body.start_date ?? null, body.end_date ?? null);
  if (period instanceof NextResponse) return period;
  try {
    const params = normalizeParams(body.params);
    const { result, needs } = await evaluateNetProfit(period.start, period.end, params);
    return NextResponse.json({ params, result, needs });
  } catch (err) {
    logger.error({ err }, 'admin/net-profit compute failed');
    return NextResponse.json({ error: 'compute failed', message: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
