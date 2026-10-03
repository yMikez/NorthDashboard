// GET /api/vsl/p/<chave>.js — script da página de upsell/downsell (público).
// Carregado com defer pelo snippet: enquanto ele não chega, a página segura
// os scripts defer seguintes e o DOMContentLoaded. Por isso este endpoint
// NUNCA espera: índice em memória (lib/services/vsl.ts) e corte de 800 ms —
// passou disso, devolve um script vazio e o snippet carrega a reserva.
// Cache curto: trocar a VSL no dash chega na página em até ~1 minuto.

import { loaderScriptFor } from '@/lib/services/vsl';
import { PAGE_KEY_RE } from '@/lib/vsl/catalog';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEADLINE_MS = 800;

const HEADERS = {
  'Content-Type': 'application/javascript; charset=utf-8',
  'Cache-Control': 'public, max-age=30, stale-while-revalidate=30',
  'X-Content-Type-Options': 'nosniff',
  'Access-Control-Allow-Origin': '*',
};

const EMPTY = (why: string) =>
  new Response(`/* NorthScale VSL: ${why} — a página usa a VSL de reserva do snippet */`, {
    status: 200,
    headers: { ...HEADERS, 'Cache-Control': 'no-store' },
  });

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const key = file.endsWith('.js') ? file.slice(0, -3) : file;
  if (!PAGE_KEY_RE.test(key)) {
    return new Response('/* NorthScale VSL: chave inválida */', { status: 404, headers: HEADERS });
  }
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), DEADLINE_MS); });
    const js = await Promise.race([loaderScriptFor(key), late]);
    clearTimeout(timer);
    if (js == null) {
      logger.warn({ key }, 'vsl loader passou do prazo');
      return EMPTY('demorou');
    }
    return new Response(js, { status: 200, headers: HEADERS });
  } catch (err) {
    logger.error({ err, key }, 'vsl loader failed');
    return EMPTY('indisponível');
  }
}
