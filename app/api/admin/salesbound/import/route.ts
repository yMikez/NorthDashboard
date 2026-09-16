// SalesBound — import do export "Transaction Details" (CSV do CRM deles).
//   GET  /api/admin/salesbound/import → { coverage }  (null = nunca importado)
//   POST /api/admin/salesbound/import  corpo = o CSV cru (text/csv) OU JSON { csv }
//        → { ok, import: { parsed, inserted, updated, skipped, success, … }, coverage }
// Idempotente (transactionId). Auth: sessão ADMIN ou bearer INGEST_SECRET.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { importSalesboundCsv, salesboundCoverage } from '@/lib/services/salesboundLedger';
import { clearNetProfitInputsCache } from '@/lib/services/netProfit';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 25 * 1024 * 1024;

async function authorized(req: Request): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  if (bearer && checkIngestSecret(bearer)) return { ok: true };
  const auth = await requireAdmin();
  return auth.ok ? { ok: true } : { ok: false, response: auth.response };
}

export async function GET(req: Request) {
  const auth = await authorized(req);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ coverage: await salesboundCoverage() });
}

export async function POST(req: Request) {
  const auth = await authorized(req);
  if (!auth.ok) return auth.response;
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return NextResponse.json({ error: 'arquivo grande demais (máx. 25 MB)' }, { status: 413 });
  let csv = raw;
  if ((req.headers.get('content-type') ?? '').includes('json')) {
    try { csv = String((JSON.parse(raw) as { csv?: unknown }).csv ?? ''); } catch { return NextResponse.json({ error: 'invalid body' }, { status: 400 }); }
  }
  if (!csv.trim()) return NextResponse.json({ error: 'CSV vazio' }, { status: 400 });
  try {
    const result = await importSalesboundCsv(csv);
    if (result.parsed === 0) {
      return NextResponse.json({ error: result.skipped[0]?.reason ?? 'nenhuma transação reconhecida no arquivo', import: result }, { status: 422 });
    }
    clearNetProfitInputsCache();
    return NextResponse.json({ ok: true, import: result, coverage: await salesboundCoverage() });
  } catch (err) {
    logger.error({ err }, 'admin/salesbound/import failed');
    return NextResponse.json({ error: 'import failed', message: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
