// Operação da integração com o NorthScale Afiliados.
//
//   GET  /api/admin/affiliate-mapping
//        → status (config, última reconciliação, último webhook, contagens)
//          + fila de não mapeados + afiliados mapeados
//   POST /api/admin/affiliate-mapping  { action: 'sync', full?: bool }
//        → reconciliação agora (pull do mapping; full=1 = carga completa)
//   POST /api/admin/affiliate-mapping  { action: 'backfill', dryRun?: bool }
//        → resolve TODAS as contas das 3 plataformas e grava
//          Order.mappedAffiliateId no histórico; enfileira as sem mapeamento
//
// Auth: sessão ADMIN (painel) OU bearer INGEST_SECRET (curl/n8n).

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { checkIngestSecret } from '@/lib/ingest/auth';
import {
  syncAffiliateMapping, getAffiliateSyncStatus, AffiliatesNotConfiguredError, AffiliatesSyncBusyError,
} from '@/lib/services/affiliateMappingSync';
import { backfillAffiliateMapping, listUnmappedAffiliates, listMappedAffiliates, mappingCounts } from '@/lib/services/affiliateMapping';
import { getAffiliatesInboundKey } from '@/lib/services/integrationSettings';
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
  const inbound = Boolean(await getAffiliatesInboundKey());
  const [status, counts, unmapped, mapped] = await Promise.all([
    getAffiliateSyncStatus(inbound), mappingCounts(), listUnmappedAffiliates(), listMappedAffiliates(),
  ]);
  return NextResponse.json({ status, counts, unmapped, mapped });
}

export async function POST(req: Request) {
  const denied = await authorized(req);
  if (denied) return denied;
  let body: { action?: unknown; full?: unknown; dryRun?: unknown } = {};
  try { body = (await req.json()) as typeof body; } catch { /* corpo vazio = sync */ }
  const { searchParams } = new URL(req.url);
  const action = typeof body.action === 'string' ? body.action : (searchParams.get('action') ?? 'sync');
  const truthy = (v: unknown) => v === true || v === '1' || v === 'true';
  try {
    if (action === 'sync') {
      const full = truthy(body.full) || truthy(searchParams.get('full'));
      const stats = await syncAffiliateMapping({ full, source: 'manual-affiliates' });
      return NextResponse.json({ ok: true, action, ...stats });
    }
    if (action === 'backfill') {
      const dryRun = truthy(body.dryRun) || truthy(searchParams.get('dryRun'));
      const stats = await backfillAffiliateMapping({ dryRun });
      return NextResponse.json({ ok: true, action, dryRun, ...stats });
    }
    return NextResponse.json({ error: 'action deve ser sync ou backfill' }, { status: 400 });
  } catch (err) {
    if (err instanceof AffiliatesNotConfiguredError) {
      return NextResponse.json({ error: 'not_configured', message: err.message }, { status: 409 });
    }
    if (err instanceof AffiliatesSyncBusyError) {
      return NextResponse.json({ error: 'busy', message: err.message }, { status: 409 });
    }
    logger.error({ err, action }, 'admin/affiliate-mapping failed');
    return NextResponse.json({ error: 'failed', message: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
