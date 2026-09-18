// SalesBound — import do export "Transaction Details" (CSV do CRM deles).
//   GET  /api/admin/salesbound/import → { coverage }  (null = nunca importado)
//   POST /api/admin/salesbound/import  corpo = o CSV cru (text/csv) OU JSON { csv }
//        → { ok, import: { parsed, inserted, updated, skipped, success, … }, coverage }
// Idempotente (transactionId). Auth: sessão ADMIN ou bearer INGEST_SECRET.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { importSalesboundCsv, salesboundBreakdown, salesboundCallCenterRows, salesboundCoverage, salesboundRows } from '@/lib/services/salesboundLedger';
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
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  // ?from=&to= (ISO ou YYYY-MM-DD) → o que cada fonte pôs no razão, por dia.
  const breakdown = from && to ? await salesboundBreakdown(new Date(from), new Date(to)) : null;
  // &detail=1 → as linhas do período (pra cruzar pedido × fonte).
  const rows = from && to && searchParams.get('detail') ? await salesboundRows(new Date(from), new Date(to)) : null;
  // &cc=1 → o mesmo que a aba Call Center enxerga (venda com estorno já
  // abatido, lente de coorte), resumido — confere a conversão sem precisar
  // de sessão de usuário.
  let cc = null;
  if (from && to && searchParams.get('cc')) {
    const ccRows = await salesboundCallCenterRows(new Date(from), new Date(to));
    const approved = ccRows.filter((r) => r.status === 'APPROVED');
    const n2 = (v: number) => Math.round(v * 100) / 100;
    const group = (key: (r: (typeof ccRows)[number]) => string | null) => {
      const m = new Map<string, { sales: number; usd: number }>();
      for (const r of approved) {
        const k = key(r) ?? '—';
        const cur = m.get(k) ?? { sales: 0, usd: 0 };
        cur.sales++; cur.usd += Math.max(0, r.amountUsd - (r.refundedUsd ?? 0));
        m.set(k, cur);
      }
      return [...m.entries()].sort((a, b) => b[1].usd - a[1].usd).map(([k, v]) => ({ key: k, sales: v.sales, usd: n2(v.usd) }));
    };
    cc = {
      rows: ccRows.length,
      approved: approved.length,
      reversed: ccRows.length - approved.length,
      voided: ccRows.filter((r) => r.voided).length,
      grossUsd: n2(approved.reduce((s, r) => s + Math.max(0, r.amountUsd - (r.refundedUsd ?? 0)), 0)),
      refundedUsd: n2(ccRows.reduce((s, r) => s + (r.refundedUsd ?? 0), 0)),
      bySource: group((r) => r.sourcePlatform),
      byAgent: group((r) => r.agentName).slice(0, 10),
      byFamily: group((r) => r.family).slice(0, 10),
    };
  }
  return NextResponse.json({ coverage: await salesboundCoverage(), ...(breakdown ? { breakdown } : {}), ...(rows ? { rows } : {}), ...(cc ? { cc } : {}) });
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
