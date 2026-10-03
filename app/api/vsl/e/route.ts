// POST /api/vsl/e — beacon das páginas com o snippet de VSL (público, sem
// segredo). Registra a visita: view → play → pitch → aceite/recusa. Corpo
// via sendBeacon (text/plain com JSON, ~300 bytes). Responde 204 sempre: o
// beacon é fire-and-forget e a página não espera nada daqui.

import { recordVslEvent } from '@/lib/services/vsl';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 4096;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

/** Lê no máximo MAX_BYTES — corpo maior (ou sem tamanho declarado e grande) é descartado. */
async function readCapped(req: Request): Promise<string | null> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > MAX_BYTES) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function POST(req: Request) {
  try {
    const raw = await readCapped(req);
    if (raw) {
      const res = await recordVslEvent(JSON.parse(raw), {
        userAgent: req.headers.get('user-agent'),
        origin: req.headers.get('origin'),
      });
      if (!res.ok && res.reason !== 'bot') logger.debug({ reason: res.reason }, 'vsl event ignored');
    }
  } catch (err) {
    logger.warn({ err }, 'vsl event failed');
  }
  return new Response(null, { status: 204, headers: CORS });
}
