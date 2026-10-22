// Conferência manual das redes (NorthAffiliates → dash).
//
//   POST /api/admin/networks-sync[?mode=quick|full]
//     quick (padrão): diretório + vendas de hoje + checkouts de ontem/hoje
//     full: diretório + vendas e checkouts dos últimos 45 dias + varredura
//           de todos os pedidos (ajuste único dos antigos)
//   GET  /api/admin/networks-sync → estado (última rodada, eventos 24h)
//
// Auth: sessão ADMIN OU bearer INGEST_SECRET (curl/n8n).

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { checkIngestSecret } from '@/lib/ingest/auth';
import {
  syncNetworks, getNetworksSyncStatus, NetworksNotConfiguredError, NetworksSyncBusyError,
} from '@/lib/services/networksSync';
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

export async function GET(req: Request) {
  const denied = await authorized(req);
  if (denied) return denied;
  return NextResponse.json(await getNetworksSyncStatus());
}

export async function POST(req: Request) {
  const denied = await authorized(req);
  if (denied) return denied;
  const mode = new URL(req.url).searchParams.get('mode') === 'full' ? 'full' : 'quick';
  try {
    const stats = await syncNetworks({ mode, source: `manual-networks-${mode}` });
    return NextResponse.json({ ok: stats.errors.length === 0, ...stats });
  } catch (err) {
    if (err instanceof NetworksNotConfiguredError) {
      return NextResponse.json({ error: 'not_configured', message: err.message }, { status: 409 });
    }
    if (err instanceof NetworksSyncBusyError) {
      return NextResponse.json({ error: 'busy', message: err.message }, { status: 409 });
    }
    logger.error({ err }, 'admin/networks-sync failed');
    return NextResponse.json(
      { error: 'sync failed', message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
