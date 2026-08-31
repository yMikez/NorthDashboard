// Dicionário DINÂMICO de famílias canônicas — completa o conjunto estático
// do classificador (productClassification.ts) com o que vive no banco:
//   - FamilyAlias (cada correção humana na fila do catálogo vira alias);
//   - famílias com custo cadastrado (ProductFamilyCost);
//   - famílias de produtos VERIFICADOS.
// Consumido pelo ingest (upsertOrder) e pelos backfills pra resolver família
// de SKU novo sem regex nova: cadastrou uma vez, resolve pra sempre.
//
// Cache in-process 30s (mesmo padrão dos caches de métricas). Invalidar
// junto com invalidateCogsCache quando a UI grava alias/custo.

import { db } from '../db';
import {
  normalizeKey, refineFamilyText, type RefinedFamily,
} from './productClassification';

interface KeyEntry { key: string; family: string }

let cache: { entries: KeyEntry[]; loadedAt: number } | null = null;
const TTL_MS = 30_000;

export function invalidateFamilyDictionary(): void {
  cache = null;
}

export async function getDynamicFamilyEntries(): Promise<KeyEntry[]> {
  if (cache && Date.now() - cache.loadedAt < TTL_MS) return cache.entries;
  const [aliases, costs, verified] = await Promise.all([
    db.familyAlias.findMany(),
    db.productFamilyCost.findMany({ select: { family: true } }),
    db.product.findMany({
      where: { verified: true, family: { not: null } },
      select: { family: true },
      distinct: ['family'],
    }),
  ]);
  const map = new Map<string, string>();
  // Precedência: alias explícito > família com custo > família verificada.
  for (const v of verified) {
    if (v.family) map.set(normalizeKey(v.family), v.family);
  }
  for (const c of costs) map.set(normalizeKey(c.family), c.family);
  for (const a of aliases) map.set(a.alias, a.family);
  const entries = Array.from(map.entries())
    .filter(([k]) => k.length >= 4) // chave curta demais vira falso positivo de substring
    .map(([key, family]) => ({ key, family }));
  cache = { entries, loadedAt: Date.now() };
  return entries;
}

/**
 * Tenta resolver a família de um texto com estáticas + dinâmicas.
 * Uso: SKU cuja família o classificador não resolveu (family null) —
 * um alias/custo cadastrado depois passa a resolver no ingest seguinte.
 */
export async function resolveFamilyDynamic(text: string): Promise<RefinedFamily> {
  const entries = await getDynamicFamilyEntries();
  return refineFamilyText(text, entries);
}
