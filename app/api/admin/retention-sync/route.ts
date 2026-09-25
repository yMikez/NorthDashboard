// Pull manual da retenção do SendTrace + estado da integração.
//
//   GET  /api/admin/retention-sync → configuração, última rodada, contagem
//   POST /api/admin/retention-sync[?since=<ISO>|?full=1]
//     sem parâmetro → continua do marcador incremental
//     full=1        → relê tudo (idempotente: upsert por id deles)
//
// Auth: sessão ADMIN OU bearer INGEST_SECRET (curl). Nunca chave de parceiro:
// isto dispara chamada de saída e escreve no banco.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { db } from '@/lib/db';
import { syncRetention, relinkOrphanRetention, RetentionNotConfiguredError, RetentionSyncBusyError } from '@/lib/services/retentionSync';
import { getRetentionConfig, getSetting, INTERNAL_SETTING_KEYS } from '@/lib/services/integrationSettings';
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
  const [cfg, since, total, semPedido, ultima] = await Promise.all([
    getRetentionConfig(),
    getSetting(INTERNAL_SETTING_KEYS.retentionSyncSince),
    db.retentionOffer.count(),
    db.retentionOffer.count({ where: { orderId: null } }),
    db.ingestLog.findFirst({
      where: { platformSlug: 'sendtrace', eventType: 'retention-sync' },
      orderBy: { receivedAt: 'desc' },
      select: { receivedAt: true, source: true, signatureOk: true, payload: true },
    }),
  ]);
  return NextResponse.json({
    configurado: !!(cfg.url && cfg.apiKey),
    url: cfg.url,                       // a chave NÃO sai na resposta
    https: cfg.url ? /^https:\/\//i.test(cfg.url) : null,
    permite_http: cfg.allowInsecure,
    marcador_incremental: since,
    registros: total,
    sem_pedido_vinculado: semPedido,
    ultima_rodada: ultima,
  });
}

export async function POST(req: Request) {
  const denied = await authorized(req);
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const full = searchParams.get('full') === '1';
  const sinceRaw = searchParams.get('since');
  if (sinceRaw && Number.isNaN(new Date(sinceRaw).getTime())) {
    return NextResponse.json({ error: 'since inválido (use ISO 8601)' }, { status: 400 });
  }
  try {
    const stats = await syncRetention({
      source: 'manual-retencao',
      since: full ? null : sinceRaw ?? undefined,
    });
    const religadas = await relinkOrphanRetention();
    return NextResponse.json({ ok: true, ...stats, religadas });
  } catch (err) {
    if (err instanceof RetentionNotConfiguredError) return NextResponse.json({ error: err.message }, { status: 409 });
    if (err instanceof RetentionSyncBusyError) return NextResponse.json({ error: err.message }, { status: 409 });
    logger.error({ err }, 'admin/retention-sync failed');
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
