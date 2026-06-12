// Cache in-memory de respostas dos endpoints /api/metrics/*, keyed por
// querystring. Viável porque prod roda 1 instância Node e as respostas de
// métricas não variam por usuário (o guard de auth roda ANTES do cache —
// quem não pode ver a tab nem chega aqui).
//
// Staleness máximo: TTL de 30s, MAS clearResponseCache() é chamado ao fim
// de cada REFRESH da MV (dailyMetrics.doRefresh), então dado novo derruba
// o cache antes do TTL na prática.

const TTL_MS = 30_000;
const MAX_ENTRIES = 500; // guarda de memória — querystrings são ilimitadas

interface Entry {
  body: unknown;
  at: number;
}

const cache = new Map<string, Entry>();

export function getCachedResponse(key: string): unknown | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return hit.body;
}

export function setCachedResponse(key: string, body: unknown): void {
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(key, { body, at: Date.now() });
}

export function clearResponseCache(): void {
  cache.clear();
}
