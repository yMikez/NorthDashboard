// Wrapper padrão dos handlers GET de /api/metrics/*: cache de resposta por
// querystring (TTL 30s, invalidado no refresh da MV) + timing estruturado
// no log. Usar SEMPRE depois do guard de auth — quem não pode ver a tab não
// chega aqui, e a resposta em si não varia por usuário autorizado.

import { NextResponse } from 'next/server';
import { getCachedResponse, setCachedResponse } from '../cache/responseCache';
import { logger } from '../logger';

export async function respondCached(
  endpoint: string,
  searchParams: URLSearchParams,
  compute: () => Promise<unknown>,
): Promise<NextResponse> {
  const key = `${endpoint}?${searchParams.toString()}`;
  const cached = getCachedResponse(key);
  if (cached !== undefined) {
    return NextResponse.json(cached);
  }
  const t0 = Date.now();
  const data = await compute();
  setCachedResponse(key, data);
  logger.info({ endpoint, ms: Date.now() - t0 }, 'metrics.timing');
  return NextResponse.json(data);
}
