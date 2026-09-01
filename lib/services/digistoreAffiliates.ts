// Reatribuição de afiliado nos backends da Digistore.
//
// O IPN de upsell/downsell da D24 vem com o campo de afiliado preenchido
// com o TRACKING do próprio produto ("neuromindpro12", "digestflow6",
// "6296-WGHTLBLND-373-3"...) em vez do afiliado real — 21% dos backends de
// ago/2026 (336 pedidos) creditados a pseudo-afiliados internos, enquanto a
// FE da MESMA sessão tem o afiliado verdadeiro. Como os pseudo são
// filtrados como "internos", a receita de upsell sumia do afiliado e o AOV
// dele ficava irreconhecível (auditoria 2026-08-31).
//
// Regra: backend (UPSELL/DOWNSELL) da D24 cujo afiliado é NULO ou
// interno-pseudo (effectiveInternal) herda o afiliado da FE da sessão
// (parentExternalId). Afiliado REAL divergente nunca é sobrescrito.
// Idempotente; roda no ingest (forward-fix em upsertOrder) e aqui como
// backfill (chamado pelo backfill-classification e pelo boot do container).

import { db } from '../db';
import { effectiveInternal } from './affiliateIdentityCore';
import { normalizeKey, scanFamilies } from './productClassification';
import { getDynamicFamilyEntries } from './familyDictionary';

/**
 * O texto é um TRACKING de produto ("blessedkit3", "gelazen6",
 * "flexguard3nightcalm1neuropulsepro1-bundle")? Regra: cita família(s) do
 * dicionário e o que sobra é só dígitos/"bundle". A heurística genérica
 * (isInternalGuess) só conhece as famílias antigas — esta usa o dicionário
 * inteiro (estáticas + custo + aliases + verificadas).
 */
export function looksLikeProductTracking(
  text: string,
  extraEntries?: Array<{ key: string; family: string }>,
): boolean {
  const fams = scanFamilies(text, extraEntries);
  if (fams.length === 0) return false;
  let rest = normalizeKey(text);
  for (const f of fams) {
    const k = normalizeKey(f);
    while (rest.includes(k)) rest = rest.replace(k, '');
  }
  // aliases podem ter chave diferente da canônica — remove sobras não
  // numéricas conhecidas ("bundle") e aceita só dígitos no resto.
  rest = rest.replace(/bundle/g, '');
  return /^\d*$/.test(rest);
}

export interface DigistoreAffiliateStats {
  scanned: number;       // backends D24 com parent
  candidates: number;    // com afiliado nulo/pseudo
  reattributed: number;  // efetivamente movidos pro afiliado da FE
  sessions: number;
}

export async function reattributeDigistoreBackendAffiliates(dryRun = false): Promise<DigistoreAffiliateStats> {
  const platform = await db.platform.findUnique({ where: { slug: 'digistore24' }, select: { id: true } });
  const stats: DigistoreAffiliateStats = { scanned: 0, candidates: 0, reattributed: 0, sessions: 0 };
  if (!platform) return stats;

  const backs = await db.order.findMany({
    where: {
      platformId: platform.id,
      productType: { in: ['UPSELL', 'DOWNSELL'] },
      parentExternalId: { not: null },
    },
    select: {
      id: true, externalId: true, parentExternalId: true, affiliateId: true,
      affiliate: { select: { externalId: true, nickname: true, isInternal: true } },
    },
  });
  stats.scanned = backs.length;

  const dynEntries = await getDynamicFamilyEntries().catch(() => []);
  const pseudo = (a: { externalId: string; nickname: string | null; isInternal: boolean | null }) =>
    effectiveInternal(a) || looksLikeProductTracking(a.nickname || a.externalId, dynEntries);
  const candidates = backs.filter(
    (b) => b.parentExternalId !== b.externalId
      && (b.affiliateId == null || (b.affiliate != null && pseudo(b.affiliate))),
  );
  stats.candidates = candidates.length;
  if (candidates.length === 0) return stats;

  const parents = Array.from(new Set(candidates.map((b) => b.parentExternalId as string)));
  const fes = await db.order.findMany({
    where: {
      platformId: platform.id,
      productType: 'FRONTEND',
      affiliateId: { not: null },
      OR: [{ externalId: { in: parents } }, { parentExternalId: { in: parents } }],
    },
    select: {
      externalId: true, parentExternalId: true, affiliateId: true,
      affiliate: { select: { externalId: true, nickname: true, isInternal: true } },
    },
  });
  // FE da sessão: indexa pelo próprio externalId E pelo parent (âncora).
  const feBySession = new Map<string, { affiliateId: string; internal: boolean }>();
  for (const f of fes) {
    const internal = f.affiliate != null && effectiveInternal(f.affiliate);
    for (const k of [f.externalId, f.parentExternalId]) {
      if (k && !feBySession.has(k)) feBySession.set(k, { affiliateId: f.affiliateId as string, internal });
    }
  }

  const touched = new Set<string>();
  for (const b of candidates) {
    const fe = feBySession.get(b.parentExternalId as string);
    if (!fe || fe.affiliateId === b.affiliateId) continue;
    // FE também pseudo-interna E backend já tem afiliado: alinhar não muda
    // métrica (ambos filtrados) — ainda assim alinha pra sessão ficar coesa.
    if (!dryRun) {
      await db.order.update({ where: { id: b.id }, data: { affiliateId: fe.affiliateId } });
    }
    stats.reattributed++;
    touched.add(b.parentExternalId as string);
  }
  stats.sessions = touched.size;
  return stats;
}
