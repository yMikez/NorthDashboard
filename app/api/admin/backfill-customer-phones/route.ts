// POST /api/admin/backfill-customer-phones[?dryRun=1]
//
// Preenche Customer.phone (e SalesboundTransaction.phone) dos clientes
// anteriores a 2026-10-09 com o telefone dos IPNs guardados — ver
// lib/services/customerPhones.ts. Idempotente: só toca quem está sem número.
// Auth: bearer INGEST_SECRET OU sessão ADMIN.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { backfillCustomerPhones } from '@/lib/services/customerPhones';
import { refreshLeadSummary } from '@/lib/services/leads';
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
    const result = await backfillCustomerPhones(dryRun);
    if (!dryRun && result.total > 0) await refreshLeadSummary();
    logger.info(result, 'backfill-customer-phones');
    return NextResponse.json(result);
  } catch (err) {
    logger.error({ err }, 'backfill-customer-phones failed');
    return NextResponse.json({ error: 'backfill failed' }, { status: 500 });
  }
}
