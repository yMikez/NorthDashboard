// Admin (Bearer INGEST_SECRET): comparação custo × faturamento por CICLO DE
// FATURA (qua→ter BRT, fechando terça) — régua de sanidade contra a
// referência operacional de ~10% do gross por invoice semanal. Read-only;
// serve pra auditar o modelo de custo sem sessão do dashboard.
//
//   GET /api/admin/fulfillment-check?cycles=8

import { NextResponse } from 'next/server';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { getInvoiceCycles, INVOICE_PCT_BENCHMARK } from '@/lib/services/fulfillment';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  const token = auth?.replace(/^Bearer\s+/i, '') ?? null;
  if (!checkIngestSecret(token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const cycles = Math.min(Math.max(parseInt(searchParams.get('cycles') ?? '8', 10) || 8, 1), 26);

  try {
    const rows = await getInvoiceCycles(cycles);
    return NextResponse.json({ benchmarkPct: INVOICE_PCT_BENCHMARK, cycles: rows });
  } catch (err) {
    logger.error({ err }, 'admin/fulfillment-check failed');
    return NextResponse.json(
      { error: 'failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
