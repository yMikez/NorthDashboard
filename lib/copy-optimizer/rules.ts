// Cache em memória das AffiliateCopyRule habilitadas.
//
// /api/copy-decision é chamado a cada page-load de upsell — não dá pra bater
// no DB toda vez. Cache de 60s no processo Next.js (alvo p99 < 50ms). O painel
// /copy-optimizer e o auto-tune chamam invalidateRulesCache() após editar,
// pra mudança refletir imediatamente sem esperar o TTL.

import { db } from '@/lib/db';
import type { CopyRule } from './decision';

const TTL_MS = 60_000;

let cache: { at: number; rules: CopyRule[] } | null = null;
let inflight: Promise<CopyRule[]> | null = null;

async function loadRules(): Promise<CopyRule[]> {
  return db.affiliateCopyRule.findMany({
    where: { enabled: true },
    select: { key: true, keyType: true, black2Pct: true, enabled: true },
  });
}

export async function getRulesCached(): Promise<CopyRule[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rules;
  if (inflight) return inflight;

  inflight = loadRules()
    .then((rules) => {
      cache = { at: Date.now(), rules };
      return rules;
    })
    .catch((err) => {
      // Em erro de DB, serve cache stale (se houver) pra não derrubar a
      // decisão — melhor uma regra de 1min atrás do que quebrar o funil.
      if (cache) return cache.rules;
      throw err;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export function invalidateRulesCache(): void {
  cache = null;
}
