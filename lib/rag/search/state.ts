// Estado de processo da busca: versão da base GLOBAL (chave dos caches de
// denso e rerank) e detecção do pg_trgm (pode faltar em produção — a
// migração cria a extensão de forma tolerante).

import { db } from '../../db';
import { logger } from '../../logger';
import { kbVersionSql, trigramAvailableSql } from './sql';

const VERSION_TTL_MS = 15_000;
let versionCache: { value: string; at: number } | null = null;

/** Mudou algo na base (indexação, sync, exclusão): caches vencem na hora. */
export function bumpKbVersion(): void {
  versionCache = null;
}

/**
 * max(updatedAt) + contagem dos documentos GLOBAL. TTL curto cobre escrita
 * feita por outro caminho (ex.: seed rodando enquanto o chat busca).
 */
export async function getKbVersion(): Promise<string> {
  if (versionCache && Date.now() - versionCache.at < VERSION_TTL_MS) return versionCache.value;
  const rows = await db.$queryRaw<Array<{ v: string; n: number }>>(kbVersionSql);
  const value = `${rows[0]?.v ?? 'epoch'}:${rows[0]?.n ?? 0}`;
  versionCache = { value, at: Date.now() };
  return value;
}

let trigram: Promise<boolean> | null = null;

/** pg_trgm instalado? Detecta uma vez por processo (erro = tenta de novo depois). */
export function hasTrigram(): Promise<boolean> {
  if (!trigram) {
    trigram = db
      .$queryRaw<Array<{ ok: number }>>(trigramAvailableSql)
      .then((r) => r.length > 0)
      .catch((err) => {
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[rag] detecção do pg_trgm falhou');
        trigram = null;
        return false;
      });
  }
  return trigram;
}
