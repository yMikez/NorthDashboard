// POST /api/admin/net-profit/realized  { start_date, end_date, params }
//   → { cutoff, end, empty, result }
//
// Visão "Realizado" dos afiliados no Lucro real: o período é cortado em
// agora − 48h (só vendas que o backend já teve tempo de alcançar) e cada
// afiliado ganha o backend que os leads dele JÁ renderam (call center +
// SalesBound), pelos parâmetros enviados — ver evaluateNetProfitRealized.
// Auth: sessão ADMIN OU bearer INGEST_SECRET (mesmo par da rota mãe).

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { evaluateNetProfitRealized } from '@/lib/services/netProfit';
import { normalizeParams } from '@/lib/services/netProfitCore';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  if (!(bearer && checkIngestSecret(bearer))) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
  }
  let body: { start_date?: string; end_date?: string; params?: unknown };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: 'invalid body' }, { status: 400 }); }
  const start = new Date(body.start_date ?? '');
  const end = new Date(body.end_date ?? '');
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return NextResponse.json({ error: 'invalid date range' }, { status: 400 });
  }
  const t0 = Date.now();
  try {
    const out = await evaluateNetProfitRealized(start, end, normalizeParams(body.params));
    logger.info({ endpoint: 'admin/net-profit/realized', ms: Date.now() - t0 }, 'metrics.timing');
    return NextResponse.json(out);
  } catch (err) {
    logger.error({ err }, 'admin/net-profit/realized failed');
    return NextResponse.json({ error: 'compute failed', message: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
