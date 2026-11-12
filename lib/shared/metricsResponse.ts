// Wrapper padrão dos handlers GET de /api/metrics/*: cache de resposta por
// querystring (TTL 30s, invalidado no refresh da MV) + timing estruturado
// no log. Usar SEMPRE depois do guard de auth — quem não pode ver a tab não
// chega aqui.
//
// Carteira de afiliados (2026-11-12): a resposta de quem tem função na
// carteira é recortada pelo servidor (os mesmos params dão números
// diferentes) — a chave ganha o usuário. Lido aqui da sessão de propósito:
// rota nenhuma consegue esquecer e servir o total da operação a um Hunter.

import { NextResponse } from 'next/server';
import { getCachedResponse, setCachedResponse } from '../cache/responseCache';
import { getSessionUser } from '../auth/session';
import { isPortfolioScoped } from '../portfolio/core';
import { logger } from '../logger';

/** Prefixo da chave de cache: vazio pra quem vê a operação toda. */
export async function cacheScopePrefix(): Promise<string> {
  const user = await getSessionUser().catch(() => null);
  return user && isPortfolioScoped(user) ? `u:${user.id}|` : '';
}

export async function respondCached(
  endpoint: string,
  searchParams: URLSearchParams,
  compute: () => Promise<unknown>,
): Promise<NextResponse> {
  const key = `${await cacheScopePrefix()}${endpoint}?${searchParams.toString()}`;
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
