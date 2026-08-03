// POST /api/admin/backfill-jvzoo-sessions  (Bearer INGEST_SECRET)
//   Body opcional: { "dryRun": true }
//
// Fix 2026-08-03: a premissa do prekey morreu (é sempre auto-referente),
// então TODO pedido JVZoo nasceu FRONTEND com sessão própria — upsells
// nunca foram contabilizados. Este backfill:
//   1. Recomputa funnelSessionId de cada pedido não-rebill a partir do
//      payload do IngestLog de SALE (fonte correta: o rawMetadata do
//      Order pode ter sido sobrescrito por um payload de RFND, cuja data
//      é a do refund e quebraria a âncora).
//   2. Reconcilia cada sessão agrupada: mais antiga = FRONTEND, demais =
//      UPSELL com parent apontando pra FE.
//   3. Reagrupa o frete das sessões alteradas (pacote = sessão, âncora
//      na FE) via rebalanceSessionFulfillment.
//
// Idempotente — rodar 2x não muda nada na 2ª passada.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { jvzooSessionAnchor } from '@/lib/connectors/jvzoo/ingest';
import type { JvzooPayload } from '@/lib/connectors/jvzoo/types';
import { reconcileJvzooSession } from '@/lib/services/jvzooSessions';
import { rebalanceSessionFulfillment } from '@/lib/services/sessionFulfillment';
import { clearResponseCache } from '@/lib/cache/responseCache';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REBILL_EVENTS = new Set(['bill', 'uncancel-rebill']);

export async function POST(req: Request) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  if (!checkIngestSecret(token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let dryRun = false;
  try {
    const body = (await req.json()) as { dryRun?: boolean };
    dryRun = body?.dryRun === true;
  } catch {
    // sem body = execução real
  }

  const platform = await db.platform.findUnique({ where: { slug: 'jvzoo' }, select: { id: true } });
  if (!platform) {
    return NextResponse.json({ error: 'plataforma jvzoo não existe' }, { status: 404 });
  }

  // Âncora por transação a partir do payload de VENDA (o único que tem
  // other_params/date da compra). Logs duplicados (redelivery) colapsam
  // no Map — mesmo payload, mesma âncora.
  const saleLogs = await db.ingestLog.findMany({
    where: { platformSlug: 'jvzoo', eventType: 'sale', externalId: { not: null } },
    select: { externalId: true, payload: true },
    orderBy: { receivedAt: 'asc' },
  });
  const anchorByTx = new Map<string, string>();
  for (const l of saleLogs) {
    const anchor = jvzooSessionAnchor(l.payload as unknown as JvzooPayload);
    if (anchor) anchorByTx.set(l.externalId as string, anchor);
  }

  const orders = await db.order.findMany({
    where: { platformId: platform.id },
    select: { id: true, externalId: true, eventType: true, funnelSessionId: true, productType: true },
  });

  let sessionChanged = 0;
  const touchedSessions = new Set<string>();
  for (const o of orders) {
    if (REBILL_EVENTS.has(o.eventType ?? '')) continue; // rebill ancora em si
    const anchor = anchorByTx.get(o.externalId);
    if (!anchor) continue; // sem log de SALE (não deveria acontecer) — não mexe
    if (anchor !== o.funnelSessionId) {
      sessionChanged++;
      if (!dryRun) {
        await db.order.update({ where: { id: o.id }, data: { funnelSessionId: anchor } });
      }
    }
    if (anchor.startsWith('jvz:')) touchedSessions.add(anchor);
  }

  let reclassified = 0;
  let rebalanced = 0;
  if (!dryRun) {
    for (const session of touchedSessions) {
      const changed = await reconcileJvzooSession(session);
      reclassified += changed;
      if (changed > 0) {
        await rebalanceSessionFulfillment(platform.id, session, 'session');
        rebalanced++;
      }
    }
    clearResponseCache();
  }

  const summary = {
    ok: true,
    dryRun,
    scanned: orders.length,
    saleLogs: saleLogs.length,
    sessionChanged,
    sessions: touchedSessions.size,
    reclassified,
    rebalanced,
  };
  logger.info(summary, 'backfill-jvzoo-sessions done');
  return NextResponse.json(summary);
}
