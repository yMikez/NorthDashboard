// SalesBound — reprocessa os IngestLogs do postback pro razão.
//   POST /api/admin/salesbound/replay[?limit=500]       → { ok, replay, coverage }
//   POST /api/admin/salesbound/replay?dedupe=1[&dry=1]  → só junta as linhas de
//        webhook com a linha do export que for a mesma transação (exports
//        importados antes da coluna clientTxnId existir); dry=1 só relata.
// Serve pros eventos capturados antes da fase 2 existir e pra qualquer janela
// em que a gravação no razão tenha falhado (o payload nunca se perde).
// Idempotente: linha já vinda do export NÃO é sobrescrita.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { mergeWebhookIntoCsv, replaySalesboundLogs, salesboundCoverage } from '@/lib/services/salesboundLedger';
import { clearNetProfitInputsCache } from '@/lib/services/netProfit';
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
  const { searchParams } = new URL(req.url);
  const limitRaw = Number(searchParams.get('limit') ?? '500');
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 5000) : 500;
  try {
    if (searchParams.get('dedupe')) {
      const dry = searchParams.get('dry') === '1';
      const dedupe = await mergeWebhookIntoCsv(dry);
      if (!dry) clearNetProfitInputsCache();
      return NextResponse.json({ ok: true, dryRun: dry, dedupe, coverage: await salesboundCoverage() });
    }
    const replay = await replaySalesboundLogs(limit);
    clearNetProfitInputsCache();
    return NextResponse.json({ ok: true, replay, coverage: await salesboundCoverage() });
  } catch (err) {
    logger.error({ err }, 'admin/salesbound/replay failed');
    return NextResponse.json({ error: 'replay failed', message: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
