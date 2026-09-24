// GET /api/integrations/orders — dump de ordens pra sistemas parceiros.
//
//   ?platform=jvzoo|buygoods|digistore24|clickbank|cartpanda|pagamerican|all
//   ?start=YYYY-MM-DD&end=YYYY-MM-DD   janela por DATA DA COMPRA (dia BRT)
//   ?updated_since=<ISO 8601>          OU tudo que MUDOU desde então
//   ?limit=<1..50000>                  (default 50000)
//
// Auth: X-Api-Key de parceiro (lib/auth/partnerKey) · bearer INGEST_SECRET ·
// sessão ADMIN. Só leitura.
//
// Cada linha traz `refundedUsd`/`chargebackUsd` já resolvidos e `refundModel`
// dizendo se a plataforma estorna in-place ou por linha extra — o consumidor
// não precisa conhecer a diferença. No modo updated_since, `next_updated_since`
// continua a paginação sem pular nem repetir.

import { NextResponse } from 'next/server';
import { requirePartnerRead, callerLabel } from '@/lib/auth/partnerKey';
import { ordersDump } from '@/lib/services/ordersDump';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: Request) {
  const auth = await requirePartnerRead(req);
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(req.url);
  const t0 = Date.now();
  try {
    const res = await ordersDump({
      platform: searchParams.get('platform'),
      start: searchParams.get('start'),
      end: searchParams.get('end'),
      updatedSince: searchParams.get('updated_since'),
      limit: searchParams.get('limit') ? Number(searchParams.get('limit')) : null,
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    logger.info(
      { endpoint: 'integrations/orders', caller: callerLabel(auth.caller), mode: res.mode, count: res.count, ms: Date.now() - t0 },
      'metrics.timing',
    );
    return NextResponse.json(res);
  } catch (err) {
    logger.error({ err }, 'integrations/orders failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
