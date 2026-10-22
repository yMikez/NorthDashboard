// Reenvio das IPNs das contas de rede ao NorthAffiliates (lib/services/networksReplay.ts).
//
//   POST /api/admin/networks-ipn-replay?since=2026-10-14[&accounts=3649735,…][&send=1]
//     since     dia BRT inicial (padrão 2026-10-14, quando o nó ficou em rascunho)
//     accounts  affiliate_id JVZoo (padrão: as contas das redes no diretório)
//     send=1    envia de verdade; sem ele, só lista o que seria enviado
//   Depois de enviar, roda a conferência completa (45 dias) das redes.
//
// Auth: sessão ADMIN OU bearer INGEST_SECRET.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { db } from '@/lib/db';
import { replayNetworkIpns, ReplayNotConfiguredError } from '@/lib/services/networksReplay';
import { syncNetworks, NetworksSyncBusyError } from '@/lib/services/networksSync';
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

export async function POST(req: Request) {
  const denied = await authorized(req);
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const day = searchParams.get('since') ?? '2026-10-14';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return NextResponse.json({ error: 'since no formato YYYY-MM-DD' }, { status: 400 });
  const since = new Date(`${day}T03:00:00Z`); // 00:00 BRT
  let accounts = (searchParams.get('accounts') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!accounts.length) {
    const nets = await db.affiliateNetwork.findMany({ select: { jvzooAffiliateIds: true } });
    // affiliate_id da JVZoo é número; "mdi"/"nt" no diretório são placeholders.
    accounts = [...new Set(nets.flatMap((n) => n.jvzooAffiliateIds))].filter((a) => /^\d+$/.test(a));
  }
  if (!accounts.length) return NextResponse.json({ error: 'nenhuma conta JVZoo de rede (informe accounts=)' }, { status: 400 });
  const send = searchParams.get('send') === '1';

  try {
    const result = await replayNetworkIpns({ since, accounts, send });
    let sync: unknown = null;
    if (send && result.sent > 0) {
      try {
        sync = await syncNetworks({ mode: 'full', source: 'replay-networks' });
      } catch (err) {
        sync = { error: err instanceof NetworksSyncBusyError ? 'conferência já rodando — roda sozinha em até 15 min' : String(err) };
      }
    }
    logger.info({ mode: result.mode, accounts, items: result.items.length, sent: result.sent, failed: result.failed }, 'admin/networks-ipn-replay');
    return NextResponse.json({ ...result, sync });
  } catch (err) {
    if (err instanceof ReplayNotConfiguredError) {
      return NextResponse.json({ error: 'not_configured', message: err.message }, { status: 409 });
    }
    logger.error({ err }, 'admin/networks-ipn-replay failed');
    return NextResponse.json({ error: 'replay failed', message: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
