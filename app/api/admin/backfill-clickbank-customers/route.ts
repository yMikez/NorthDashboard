// POST /api/admin/backfill-clickbank-customers[?dryRun=1]
//
// Pedidos ClickBank antigos ficaram sem Customer (o conector não tinha chave
// de cliente). Recria pelos IPNs guardados em IngestLog — chave = e-mail
// normalizado, igual ao conector corrigido — e atualiza a aba Leads.
// Idempotente. Auth: bearer INGEST_SECRET OU sessão ADMIN.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { backfillClickbankCustomers, refreshLeadSummary } from '@/lib/services/leads';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: Request) {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  if (!(bearer && checkIngestSecret(bearer))) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
  }
  const dryRun = /^(1|true)$/i.test(new URL(req.url).searchParams.get('dryRun') ?? '');
  try {
    const result = await backfillClickbankCustomers(dryRun);
    if (!dryRun && result.linked > 0) await refreshLeadSummary();
    logger.info(result, 'backfill-clickbank-customers');
    return NextResponse.json(result);
  } catch (err) {
    logger.error({ err }, 'backfill-clickbank-customers failed');
    return NextResponse.json({ error: 'backfill failed' }, { status: 500 });
  }
}
