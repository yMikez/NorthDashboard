// POST /api/copy-view
//
// Chamado fire-and-forget pelo funnel-renderer logo após renderizar a copy.
// Grava em CopyView "quem viu o quê e quando" — source-of-truth das métricas.
// Auth via x-ingest-secret. Não precisa ser idempotente: reloads geram views
// extras, deduplicadas por order_id_global nas queries (DISTINCT ON).

import { NextResponse } from 'next/server';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { recordCopyView } from '@/lib/copy-optimizer/service';
import { isCopyLayer } from '@/lib/copy-optimizer/decision';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  order_id_global?: unknown;
  layer?: unknown;
  aff_id?: unknown;
  aff_name?: unknown;
  bucket?: unknown;
  page_url?: unknown;
  referrer?: unknown;
  sessid2?: unknown;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
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

  const orderIdGlobal = str(body.order_id_global);
  const layer = str(body.layer);
  if (!orderIdGlobal || !layer) {
    return NextResponse.json({ error: 'order_id_global and layer required' }, { status: 400 });
  }
  if (!isCopyLayer(layer)) {
    return NextResponse.json({ error: 'invalid layer' }, { status: 400 });
  }

  const bucket =
    typeof body.bucket === 'number' && Number.isFinite(body.bucket)
      ? Math.trunc(body.bucket)
      : null;

  try {
    await recordCopyView({
      orderIdGlobal,
      layer,
      affId: str(body.aff_id),
      affName: str(body.aff_name),
      bucket,
      pageUrl: str(body.page_url),
      referrer: str(body.referrer),
      sessid2: str(body.sessid2),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error({ err, orderIdGlobal, layer }, 'copy-view failed');
    return NextResponse.json({ error: 'write failed' }, { status: 500 });
  }
}
