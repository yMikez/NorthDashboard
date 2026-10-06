// Nomes → valores EXATOS dos filtros: plataforma, família, país, etapa,
// SKU, conta de afiliado, afiliado do NorthScale Afiliados e parceiro.
//
// Filtro errado não dá erro nos serviços — dá ZERO (ou o total sem filtro),
// e o modelo relata o zero com confiança. Este módulo alimenta:
//   - normalizeScope (corrige/valida os filtros antes do handler);
//   - a tool resolve_entities (o modelo pergunta "o que é 'neuro pulse'?"
//     e recebe o argumento pronto: {families:['NeuroPulsePro']}).
//
// NeuroPulsePro ≠ NeuroMindPro (codenames da BuyGoods colidem — memória
// project_bg_codename_collision): matching por chave normalizada + alias
// do classificador, nunca por "contém 'neuro'".

import type { ProductType } from '@prisma/client';
import { db } from '../db';
import { logger } from '../logger';
import { getFilterOptions } from '../services/filterOptions';
import { getDynamicFamilyEntries } from '../services/familyDictionary';
import { normalizeKey, scanFamilies } from '../services/productClassification';
import { stagesParam } from '../shared/queryParams';

// ── Normalização de texto ────────────────────────────────────────────────

/** minúsculas, sem acento, só [a-z0-9] — chave de comparação. */
export function normText(s: string): string {
  return normalizeKey(s.normalize('NFD').replace(/[̀-ͯ]/g, ''));
}

/**
 * Similaridade 0..1 por distância de edição com transposição (OSA): typo
 * de uma letra ou duas letras trocadas ("neuromindpor") conta como 1 edição.
 */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return 1 - d[a.length][b.length] / Math.max(a.length, b.length);
}

// ── Catálogo (cache 60s) ─────────────────────────────────────────────────

export interface ScopeCatalog {
  platforms: Array<{ slug: string; label: string }>;
  /** Toda grafia de Product.family no banco (com nº de SKUs). */
  familySpellings: Array<{ value: string; skus: number }>;
  /** Famílias "principais" do dropdown da tela (lista de valores válidos). */
  mainFamilies: string[];
  familyEntries: Array<{ key: string; family: string }>;
  countries: Array<{ code: string; orders: number }>;
  nsAffiliates: Array<{ id: string; name: string; orders: number }>;
}

const CATALOG_TTL_MS = 60_000;
let catalogCache: { at: number; promise: Promise<ScopeCatalog> } | null = null;

async function fetchCatalog(): Promise<ScopeCatalog> {
  const [options, spellings, entries, states, mappedCounts] = await Promise.all([
    getFilterOptions(),
    db.product.groupBy({ by: ['family'], where: { family: { not: null } }, _count: { _all: true } }),
    getDynamicFamilyEntries(),
    db.affiliateMappingState.findMany({ select: { affiliateId: true, name: true } }),
    // Afiliados do NorthScale Afiliados (affiliate_ids das tools) — o filtro
    // da barra virou conta de plataforma, então a contagem vem direto daqui.
    db.order.groupBy({ by: ['mappedAffiliateId'], where: { mappedAffiliateId: { not: null } }, _count: { _all: true } }),
  ]);
  const ordersById = new Map(mappedCounts.map((a) => [a.mappedAffiliateId as string, a._count._all]));
  const ns = new Map<string, { id: string; name: string; orders: number }>();
  for (const s of states) ns.set(s.affiliateId, { id: s.affiliateId, name: s.name, orders: ordersById.get(s.affiliateId) ?? 0 });
  return {
    platforms: options.platforms.map((p) => ({ slug: p.id, label: p.label })),
    familySpellings: spellings.filter((s) => s.family).map((s) => ({ value: s.family as string, skus: s._count._all })),
    mainFamilies: options.families.map((f) => f.id),
    familyEntries: entries,
    countries: options.countries.map((c) => ({ code: c.id, orders: c.orderCount })),
    nsAffiliates: [...ns.values()].sort((a, b) => b.orders - a.orders),
  };
}

export function loadScopeCatalog(): Promise<ScopeCatalog> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.promise;
  const promise = fetchCatalog();
  catalogCache = { at: Date.now(), promise };
  promise.catch((err) => {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[chat] catálogo de filtros indisponível');
    if (catalogCache?.promise === promise) catalogCache = null;
  });
  return promise;
}

// ── Plataforma ───────────────────────────────────────────────────────────

export const KNOWN_PLATFORMS = ['clickbank', 'digistore24', 'buygoods', 'cartpanda', 'jvzoo'];

// "cb" num campo de PLATAFORMA é ClickBank; fora dele pode ser chargeback
// (resolve_entities devolve os dois).
const PLATFORM_SYNONYMS: Record<string, string> = {
  cb: 'clickbank', clickbank: 'clickbank', clickbankcom: 'clickbank', click: 'clickbank',
  d24: 'digistore24', ds24: 'digistore24', digistore: 'digistore24', digistore24: 'digistore24', digi: 'digistore24', dg: 'digistore24',
  bg: 'buygoods', buygoods: 'buygoods', buygood: 'buygoods',
  cp: 'cartpanda', cartpanda: 'cartpanda', panda: 'cartpanda',
  jvz: 'jvzoo', jvzoo: 'jvzoo', jv: 'jvzoo',
};

export function matchPlatform(raw: string, platforms: Array<{ slug: string; label: string }>): string | null {
  const k = normText(raw);
  if (!k) return null;
  for (const p of platforms) if (normText(p.slug) === k || normText(p.label) === k) return p.slug;
  const syn = PLATFORM_SYNONYMS[k];
  if (syn && (platforms.length === 0 || platforms.some((p) => p.slug === syn))) return syn;
  return null;
}

// ── Família ──────────────────────────────────────────────────────────────

export type FamilyMatch =
  | { values: string[]; canonical: string; how: 'exact' | 'alias' | 'fuzzy'; inCatalog: boolean }
  | { ambiguous: string[] };

/** Todas as grafias do banco com a mesma chave normalizada ("Lumicept" × "LumiCept"). */
function spellingsFor(key: string, catalog: Pick<ScopeCatalog, 'familySpellings'>): string[] {
  return catalog.familySpellings
    .filter((s) => normText(s.value) === key)
    .sort((a, b) => b.skus - a.skus)
    .map((s) => s.value);
}

export function matchFamily(raw: string, catalog: Pick<ScopeCatalog, 'familySpellings' | 'familyEntries' | 'mainFamilies'>): FamilyMatch | null {
  const k = normText(raw);
  if (!k) return null;
  const exact = spellingsFor(k, catalog);
  if (exact.length) return { values: exact, canonical: exact[0], how: 'exact', inCatalog: true };

  // Alias do classificador + dicionário dinâmico (FamilyAlias, famílias com
  // custo): "neuro pulse" → NeuroPulsePro, "neuromind" → NeuroMindPro. Só
  // aceita quando a família encontrada cobre quase todo o texto — "neuro
  // mind pro max" não vira NeuroMindPro.
  const scanned = scanFamilies(raw, catalog.familyEntries);
  if (scanned.length === 1) {
    const fk = normText(scanned[0]);
    const coverage = Math.min(fk.length, k.length) / Math.max(fk.length, k.length);
    if ((fk.includes(k) || k.includes(fk)) && coverage >= 0.6) {
      const values = spellingsFor(fk, catalog);
      return { values: values.length ? values : [scanned[0]], canonical: values[0] ?? scanned[0], how: 'alias', inCatalog: values.length > 0 };
    }
  }

  // Typo: melhor candidato único com similaridade alta (≈ 1 edição numa
  // família de 8+ letras). Mais frouxo que isso vira filtro errado calado.
  const pool = [...new Set([...catalog.mainFamilies, ...catalog.familyEntries.map((e) => e.family)])];
  const scored = pool
    .map((f) => ({ f, s: similarity(k, normText(f)) }))
    .filter((x) => x.s >= 0.85)
    .sort((a, b) => b.s - a.s);
  if (!scored.length) return null;
  if (scored.length > 1 && scored[0].s - scored[1].s < 0.05) return { ambiguous: scored.slice(0, 4).map((x) => x.f) };
  const values = spellingsFor(normText(scored[0].f), catalog);
  return { values: values.length ? values : [scored[0].f], canonical: values[0] ?? scored[0].f, how: 'fuzzy', inCatalog: values.length > 0 };
}

// ── País ─────────────────────────────────────────────────────────────────

// ISO 3166-1 alpha-2: separa "código real sem venda" (resultado zero é
// verdade) de "código inventado" (UK, EUA) — que vira erro com sugestão.
const ISO2 = new Set(('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ '
  + 'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY '
  + 'HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY '
  + 'MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY '
  + 'QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ '
  + 'VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' '));

const COUNTRY_SYNONYMS: Record<string, string> = {
  usa: 'US', eua: 'US', estadosunidos: 'US', unitedstates: 'US', america: 'US',
  uk: 'GB', inglaterra: 'GB', reinounido: 'GB', unitedkingdom: 'GB', greatbritain: 'GB', england: 'GB',
  canada: 'CA', australia: 'AU', novazelandia: 'NZ', newzealand: 'NZ', irlanda: 'IE', ireland: 'IE',
  alemanha: 'DE', germany: 'DE', franca: 'FR', france: 'FR', brasil: 'BR', brazil: 'BR',
  mexico: 'MX', espanha: 'ES', spain: 'ES', portugal: 'PT', italia: 'IT', italy: 'IT',
  holanda: 'NL', paisesbaixos: 'NL', netherlands: 'NL', suica: 'CH', switzerland: 'CH', africadosul: 'ZA', southafrica: 'ZA',
  aus: 'AU', can: 'CA', gbr: 'GB', deu: 'DE', fra: 'FR', bra: 'BR', nzl: 'NZ', irl: 'IE',
};

export function matchCountry(raw: string): { code: string } | null {
  const t = raw.trim();
  if (/^[A-Za-z]{2}$/.test(t) && ISO2.has(t.toUpperCase())) return { code: t.toUpperCase() };
  const syn = COUNTRY_SYNONYMS[normText(t)];
  return syn ? { code: syn } : null;
}

// ── Etapa ────────────────────────────────────────────────────────────────

export const STAGE_VALUES: ProductType[] = ['FRONTEND', 'UPSELL', 'DOWNSELL', 'BUMP', 'SMS_RECOVERY'];

export function matchStage(raw: string): ProductType | null {
  const r = stagesParam(raw.replace(/,/g, ' '));
  return r?.length === 1 ? r[0] : null;
}

// ── resolve_entities ─────────────────────────────────────────────────────

export const ENTITY_KINDS = ['platform', 'family', 'country', 'stage', 'status', 'product', 'affiliate_account', 'ns_affiliate', 'partner'] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export interface EntityCandidate {
  kind: EntityKind;
  value: string;
  label: string;
  score: number;
  /** Argumentos EXATOS pros filtros das tools. */
  use: Record<string, unknown> | null;
  /** Chamada de detalhe pronta (tool + args), quando existe. */
  drill?: { tool: string; args: Record<string, unknown> };
  detail?: Record<string, unknown>;
}

export interface EntityResolution {
  term: string;
  candidates: EntityCandidate[];
  ambiguous: boolean;
  note?: string;
}

const STATUS_SYNONYMS: Record<string, { value: string; label: string }> = {
  cb: { value: 'CHARGEBACK', label: 'chargeback' }, chargeback: { value: 'CHARGEBACK', label: 'chargeback' }, chargebacks: { value: 'CHARGEBACK', label: 'chargeback' },
  reembolso: { value: 'REFUNDED', label: 'reembolso' }, reembolsos: { value: 'REFUNDED', label: 'reembolso' }, refund: { value: 'REFUNDED', label: 'reembolso' },
  refunds: { value: 'REFUNDED', label: 'reembolso' }, estorno: { value: 'REFUNDED', label: 'reembolso' }, estornos: { value: 'REFUNDED', label: 'reembolso' },
  aprovado: { value: 'APPROVED', label: 'aprovado' }, aprovados: { value: 'APPROVED', label: 'aprovado' }, approved: { value: 'APPROVED', label: 'aprovado' },
  pendente: { value: 'PENDING', label: 'pendente' }, pending: { value: 'PENDING', label: 'pendente' },
  cancelado: { value: 'CANCELED', label: 'cancelado' }, canceled: { value: 'CANCELED', label: 'cancelado' },
};

/** Candidatos que saem só do catálogo em memória (sem consulta extra). Puro. */
export function catalogCandidates(term: string, catalog: ScopeCatalog, kinds: Set<EntityKind>): EntityCandidate[] {
  const out: EntityCandidate[] = [];
  const k = normText(term);
  if (kinds.has('platform')) {
    const slug = matchPlatform(term, catalog.platforms);
    if (slug) {
      const exact = catalog.platforms.some((p) => normText(p.slug) === k || normText(p.label) === k);
      out.push({ kind: 'platform', value: slug, label: catalog.platforms.find((p) => p.slug === slug)?.label ?? slug, score: exact ? 1 : 0.9, use: { platforms: [slug] } });
    }
  }
  if (kinds.has('status') && STATUS_SYNONYMS[k]) {
    const s = STATUS_SYNONYMS[k];
    out.push({ kind: 'status', value: s.value, label: s.label, score: 0.9, use: { status: s.value } });
  }
  if (kinds.has('family')) {
    const f = matchFamily(term, catalog);
    if (f && 'values' in f) {
      out.push({
        kind: 'family', value: f.canonical, label: f.canonical, score: f.how === 'exact' ? 1 : f.how === 'alias' ? 0.9 : 0.75,
        use: { families: f.values },
        detail: { match: f.how, ...(f.values.length > 1 ? { spellings: f.values } : {}), ...(f.inCatalog ? {} : { warning: 'família conhecida, mas sem SKU no catálogo — filtro dará zero' }) },
      });
    } else if (f && 'ambiguous' in f) {
      for (const name of f.ambiguous) out.push({ kind: 'family', value: name, label: name, score: 0.6, use: { families: [name] }, detail: { match: 'fuzzy_ambiguous' } });
    }
  }
  if (kinds.has('country')) {
    const c = matchCountry(term);
    if (c) {
      const orders = catalog.countries.find((x) => x.code === c.code)?.orders ?? 0;
      out.push({ kind: 'country', value: c.code, label: c.code, score: 1, use: { countries: [c.code] }, detail: { orders } });
    }
  }
  if (kinds.has('stage')) {
    const s = matchStage(term);
    if (s) out.push({ kind: 'stage', value: s, label: s, score: 1, use: { stages: [s] } });
  }
  if (kinds.has('ns_affiliate') && k.length >= 2) {
    for (const a of catalog.nsAffiliates) {
      const nk = normText(a.name);
      const score = a.id === term.trim() ? 1 : nk === k ? 0.95 : nk.includes(k) && k.length >= 3 ? 0.7 : 0;
      if (score > 0) {
        out.push({ kind: 'ns_affiliate', value: a.id, label: a.name, score, use: { affiliate_ids: [a.id] }, detail: { mappedOrders: a.orders } });
      }
    }
  }
  return out;
}

async function dbCandidates(term: string, kinds: Set<EntityKind>, take: number): Promise<EntityCandidate[]> {
  const q = term.trim();
  if (q.length < 2) return [];
  const out: EntityCandidate[] = [];
  const lower = q.toLowerCase();
  const [accounts, partners, products] = await Promise.all([
    kinds.has('affiliate_account')
      ? db.affiliate.findMany({
          where: { OR: [{ externalId: { contains: q, mode: 'insensitive' } }, { nickname: { contains: q, mode: 'insensitive' } }] },
          orderBy: { lastOrderAt: { sort: 'desc', nulls: 'last' } },
          take,
          select: { externalId: true, nickname: true, lastOrderAt: true, mappedAffiliateId: true, partnerId: true, platform: { select: { slug: true } } },
        })
      : [],
    kinds.has('partner')
      ? db.affiliatePartner.findMany({
          where: { displayName: { contains: q, mode: 'insensitive' } },
          take,
          select: { id: true, displayName: true, affiliates: { select: { externalId: true, mappedAffiliateId: true, platform: { select: { slug: true } } } } },
        })
      : [],
    kinds.has('product')
      ? db.product.findMany({
          where: { OR: [{ externalId: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }] },
          take,
          select: { externalId: true, name: true, family: true, productType: true, platform: { select: { slug: true } } },
        })
      : [],
  ]);
  for (const a of accounts) {
    // BuyGoods `aff_id@loja`: o "62" citado é exato pra cada loja (pessoas diferentes).
    const bareId = a.platform.slug === 'buygoods' ? a.externalId.split('@')[0].toLowerCase() : null;
    const exact = a.externalId.toLowerCase() === lower || bareId === lower || (a.nickname ?? '').toLowerCase() === lower;
    out.push({
      kind: 'affiliate_account', value: `${a.platform.slug}:${a.externalId}`, label: a.nickname ?? a.externalId, score: exact ? 0.95 : 0.7,
      use: a.mappedAffiliateId ? { affiliate_ids: [a.mappedAffiliateId] } : null,
      drill: { tool: 'get_affiliate_detail', args: { external_id: a.externalId, platform: a.platform.slug } },
      detail: {
        platform: a.platform.slug, externalId: a.externalId, lastOrderAt: a.lastOrderAt?.toISOString() ?? null,
        mappedAffiliateId: a.mappedAffiliateId, ...(a.partnerId ? { partnerKey: `partner:${a.partnerId}` } : {}),
      },
    });
  }
  for (const p of partners) {
    const mapped = [...new Set(p.affiliates.map((x) => x.mappedAffiliateId).filter((x): x is string => !!x))];
    out.push({
      kind: 'partner', value: `partner:${p.id}`, label: p.displayName, score: p.displayName.toLowerCase() === lower ? 0.95 : 0.7,
      use: mapped.length ? { affiliate_ids: mapped } : null,
      drill: { tool: 'get_affiliate_explain', args: { key: `partner:${p.id}` } },
      detail: { accounts: p.affiliates.map((x) => `${x.platform.slug}:${x.externalId}`) },
    });
  }
  for (const pr of products) {
    const exact = pr.externalId.toLowerCase() === lower;
    out.push({
      kind: 'product', value: pr.externalId, label: pr.name, score: exact ? 1 : 0.7,
      use: { products: [pr.externalId], platforms: [pr.platform.slug] },
      detail: { platform: pr.platform.slug, family: pr.family, catalogType: pr.productType },
    });
  }
  return out;
}

export async function resolveEntities(terms: string[], kindsIn: EntityKind[] | undefined, limit: number): Promise<EntityResolution[]> {
  const kinds = new Set<EntityKind>(kindsIn?.length ? kindsIn : ENTITY_KINDS);
  const catalog = await loadScopeCatalog();
  return Promise.all(terms.map(async (term) => {
    const candidates = [...catalogCandidates(term, catalog, kinds), ...(await dbCandidates(term, kinds, limit))]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    const top = candidates[0]?.score ?? 0;
    const tied = candidates.filter((c) => top - c.score < 0.1);
    const ambiguous = tied.length > 1 && new Set(tied.map((c) => `${c.kind}:${c.value}`)).size > 1;
    const k = normText(term);
    const note = k === 'cb' && kinds.has('platform') && kinds.has('status')
      ? '"CB" pode ser ClickBank (plataforma) ou chargeback (status) — decida pelo contexto da pergunta.'
      : !candidates.length ? 'nada encontrado — confira a grafia ou use get_affiliates(search) / get_products.' : undefined;
    return { term, candidates, ambiguous, ...(note ? { note } : {}) };
  }));
}
