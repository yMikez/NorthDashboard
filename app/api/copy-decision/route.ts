// POST /api/copy-decision
//
// Chamado server-to-server pelo funnel-renderer a cada page-load de upsell.
// Recebe { order_id_global } e devolve { layer, ... } — a decisão de copy.
// TODA a lógica e as regras ficam aqui; o cliente nunca vê percentuais nem
// lista de afiliados. Auth via shared secret x-ingest-secret (mesmo dos /ingest).
//
// Fail-safe: erro interno NÃO quebra o funil — responde 200 com o layer de
// fallback pra página sempre renderizar algo.

import { NextResponse } from 'next/server';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { decideCopy, defaultLayer } from '@/lib/copy-optimizer/service';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  order_id_global?: unknown;
}

export async function POST(req: Request) {
  if (!checkIngestSecret(req.headers.get('x-ingest-secret'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const orderIdGlobal = typeof body.order_id_global === 'string' ? body.order_id_global : '';
  if (!orderIdGlobal.trim()) {
    return NextResponse.json({ error: 'order_id_global required' }, { status: 400 });
  }

  try {
    const result = await decideCopy(orderIdGlobal);
    return NextResponse.json(result);
  } catch (err) {
    logger.error({ err, orderIdGlobal }, 'copy-decision failed');
    // Nunca derruba o funil: devolve fallback com 200.
    return NextResponse.json(
      {
        found: false,
        layer: defaultLayer(),
        order_id_global: orderIdGlobal,
        aff_id: null,
        aff_name: null,
        email: null,
        email_valid: false,
        bucket: null,
        pct_applied: 0,
        decided_at: new Date().toISOString(),
        error: 'decision_failed',
      },
      { status: 200 },
    );
  }
}
