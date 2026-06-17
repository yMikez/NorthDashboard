// POST /api/page-state  (público, sem segredo — auto-corrigível)
//
// Beacon chamado pelas páginas de Upsell 01 (navigator.sendBeacon, fire-and-
// forget) reportando o estado da copy: { platform, product, state, url? }.
// Guarda só o ÚLTIMO estado por (plataforma, produto). Como cada visita à
// página reescreve o estado real, um POST falso é sobrescrito na visita
// seguinte — por isso é seguro deixar aberto (sem expor segredo no client-side).
//
// sendBeacon manda Content-Type text/plain → lemos o body como texto e
// parseamos JSON (também aceita application/json e form-urlencoded). CORS
// liberado pra rodar de qualquer domínio de landing page.

import { NextResponse } from 'next/server';
import { recordPageState } from '@/lib/services/pageState';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: Request) {
  let data: Record<string, unknown> = {};
  try {
    const raw = await req.text();
    if (raw) {
      const ct = (req.headers.get('content-type') ?? '').toLowerCase();
      if (ct.includes('application/x-www-form-urlencoded')) {
        data = Object.fromEntries(new URLSearchParams(raw));
      } else {
        // sendBeacon (text/plain) ou application/json → JSON.
        data = JSON.parse(raw) as Record<string, unknown>;
      }
    }
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400, headers: CORS });
  }

  const res = await recordPageState({
    platform: String(data.platform ?? data.plataforma ?? ''),
    product: String(data.product ?? data.produto ?? ''),
    state: String(data.state ?? data.estado ?? ''),
    pageUrl: data.url != null ? String(data.url) : (data.page_url != null ? String(data.page_url) : null),
  });

  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: 400, headers: CORS });
  }
  logger.info({ platform: data.platform, product: data.product, state: data.state }, 'page-state beacon');
  return NextResponse.json({ ok: true }, { headers: CORS });
}
