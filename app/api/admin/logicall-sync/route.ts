// Sync manual/backfill da Logicall.
//
//   POST /api/admin/logicall-sync[?start=YYYY-MM-DD&end=YYYY-MM-DD]
//     sem datas → janela deslizante default (últimos 3 dias)
//   GET  /api/admin/logicall-sync → estado da integração (última rodada)
//
// Auth: sessão ADMIN (botão da aba) OU bearer INGEST_SECRET (curl/n8n).

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { syncLogicall, getLogicallSyncStatus, LogicallNotConfiguredError, LogicallSyncBusyError } from '@/lib/services/logicallSync';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function authorized(req: Request): Promise<NextResponse | null> {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  if (bearer && checkIngestSecret(bearer)) return null;
  const auth = await requireAdmin();
  return auth.ok ? null : auth.response;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const denied = await authorized(req);
  if (denied) return denied;
  return NextResponse.json(await getLogicallSyncStatus());
}

export async function POST(req: Request) {
  const denied = await authorized(req);
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const start = searchParams.get('start');
  const end = searchParams.get('end');
  if ((start && !YMD.test(start)) || (end && !YMD.test(end))) {
    return NextResponse.json({ error: 'start/end no formato YYYY-MM-DD' }, { status: 400 });
  }
  if ((start && !end) || (!start && end)) {
    return NextResponse.json({ error: 'informe start E end (ou nenhum)' }, { status: 400 });
  }
  try {
    const stats = await syncLogicall(start && end ? { startDate: start, endDate: end } : undefined, {
      source: 'manual-logicall',
    });
    return NextResponse.json({ ok: true, ...stats });
  } catch (err) {
    if (err instanceof LogicallNotConfiguredError) {
      return NextResponse.json({ error: 'not_configured', message: err.message }, { status: 409 });
    }
    if (err instanceof LogicallSyncBusyError) {
      return NextResponse.json({ error: 'busy', message: err.message }, { status: 409 });
    }
    logger.error({ err }, 'admin/logicall-sync failed');
    return NextResponse.json(
      { error: 'sync failed', message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
