// Normalização dos filtros de escopo ANTES do handler: sinônimo de
// plataforma → slug (cb/d24/digistore → clickbank/digistore24), família pelo
// dicionário (caixa/alias/grafias do banco), país em ISO-2 maiúsculo, etapa
// pelo mesmo parser da querystring, SKU pela caixa do catálogo, affiliate_id
// conferido contra o espelho do NorthScale Afiliados.
//
// Por quê: os serviços filtram com `= ANY(...)` — valor fora do padrão não dá
// erro, dá ZERO (ou, na etapa, o filtro some e volta o total). O modelo lê
// o zero e afirma com confiança. Aqui: corrige o que tem leitura única
// (e anota em `notes`) e LANÇA `invalid_input: … valid: …` no resto.
//
// Sem catálogo (banco fora) a normalização estática (sinônimos, caixa,
// etapa) continua; a validação contra o banco é pulada em vez de travar a
// tool.

import { db } from '../db';
import { logger } from '../logger';
import {
  KNOWN_PLATFORMS, STAGE_VALUES, loadScopeCatalog, matchCountry, matchFamily, matchPlatform, matchStage, normText,
  type ScopeCatalog,
} from './entities';

export interface NormalizedScope {
  input: Record<string, unknown>;
  /** O que foi corrigido (vai pro _meta.notes do resultado). */
  notes: string[];
}

const SCOPE_KEYS = ['platforms', 'platform', 'families', 'countries', 'stages', 'products', 'affiliate_ids'] as const;
const MAX_VALID_LISTED = 40;

function invalid(field: string, bad: string[], valid: string[], hint?: string): Error {
  const shown = valid.slice(0, MAX_VALID_LISTED).join(', ') + (valid.length > MAX_VALID_LISTED ? `, … (+${valid.length - MAX_VALID_LISTED})` : '');
  return new Error(`invalid_input: ${field}: ${bad.map((b) => `"${b}"`).join(', ')} não existe — valid: ${shown || '(nenhum)'}${hint ? ` · ${hint}` : ''}`);
}

function strings(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean);
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
}

function hasScope(input: Record<string, unknown>): boolean {
  return SCOPE_KEYS.some((k) => {
    const v = input[k];
    return Array.isArray(v) ? v.length > 0 : typeof v === 'string' && v.trim() !== '';
  });
}

function normalizePlatformList(values: string[], catalog: ScopeCatalog | null, field: string, notes: string[]): string[] {
  const platforms = catalog?.platforms ?? [];
  const out: string[] = [];
  const bad: string[] = [];
  for (const v of values) {
    const slug = matchPlatform(v, platforms);
    if (!slug) { bad.push(v); continue; }
    if (slug !== v) notes.push(`${field}: "${v}" → "${slug}"`);
    out.push(slug);
  }
  if (bad.length) throw invalid(field, bad, platforms.length ? platforms.map((p) => p.slug) : KNOWN_PLATFORMS);
  return dedupe(out);
}

function normalizeFamilies(values: string[], catalog: ScopeCatalog, notes: string[]): string[] {
  const out: string[] = [];
  const bad: string[] = [];
  for (const v of values) {
    const m = matchFamily(v, catalog);
    if (!m) { bad.push(v); continue; }
    if ('ambiguous' in m) throw invalid('families', [v], m.ambiguous, 'mais de uma família parecida — escolha uma');
    if (m.values.length > 1) notes.push(`families: "${v}" inclui as grafias ${m.values.join(' + ')} do catálogo`);
    else if (m.values[0] !== v) notes.push(`families: "${v}" → "${m.values[0]}"`);
    if (!m.inCatalog) notes.push(`families: "${m.canonical}" é família conhecida, mas sem SKU no catálogo — o resultado sai zerado`);
    out.push(...m.values);
  }
  if (bad.length) throw invalid('families', bad, catalog.mainFamilies, 'NeuroPulsePro e NeuroMindPro são famílias diferentes; use resolve_entities se em dúvida');
  return dedupe(out);
}

function normalizeCountries(values: string[], catalog: ScopeCatalog | null, notes: string[]): string[] {
  const out: string[] = [];
  const bad: string[] = [];
  const known = new Set(catalog?.countries.map((c) => c.code) ?? []);
  for (const v of values) {
    const m = matchCountry(v);
    if (!m) { bad.push(v); continue; }
    if (m.code !== v) notes.push(`countries: "${v}" → "${m.code}"`);
    if (catalog && !known.has(m.code)) notes.push(`countries: nenhum pedido de ${m.code} no histórico — o resultado sai zerado`);
    out.push(m.code);
  }
  if (bad.length) throw invalid('countries', bad, catalog?.countries.map((c) => c.code) ?? [], 'use o código ISO de 2 letras (US, GB, CA, AU…)');
  return dedupe(out);
}

function normalizeStages(values: string[], notes: string[]): string[] {
  const out: string[] = [];
  const bad: string[] = [];
  for (const v of values) {
    const s = matchStage(v);
    if (!s) { bad.push(v); continue; }
    if (s !== v) notes.push(`stages: "${v}" → "${s}"`);
    out.push(s);
  }
  // Etapa inválida era descartada calada e o filtro sumia — o total voltava
  // com cara de filtrado.
  if (bad.length) throw invalid('stages', bad, STAGE_VALUES, 'UP1/UP2/DW1 não são etapas deste filtro — use get_funnel (etapa a etapa) ou aggregate_orders com group_by funnel_step');
  return dedupe(out);
}

// SKUs: cache curto por valor (a tool pode ser chamada várias vezes no turno).
const SKU_TTL_MS = 60_000;
const skuCache = new Map<string, { at: number; hits: string[] }>();

async function skuHits(value: string): Promise<string[]> {
  const c = skuCache.get(value);
  if (c && Date.now() - c.at < SKU_TTL_MS) return c.hits;
  const rows = await db.product.findMany({
    where: { externalId: { equals: value, mode: 'insensitive' } },
    select: { externalId: true },
    take: 10,
  });
  const hits = [...new Set(rows.map((r) => r.externalId))];
  skuCache.set(value, { at: Date.now(), hits });
  if (skuCache.size > 500) skuCache.clear();
  return hits;
}

async function skuSuggestions(value: string): Promise<string[]> {
  const rows = await db.product.findMany({
    where: { OR: [{ externalId: { contains: value, mode: 'insensitive' } }, { name: { contains: value, mode: 'insensitive' } }] },
    select: { externalId: true },
    take: 8,
  });
  return [...new Set(rows.map((r) => r.externalId))];
}

async function normalizeProducts(values: string[], notes: string[]): Promise<string[]> {
  const out: string[] = [];
  const bad: string[] = [];
  for (const v of values) {
    const hits = await skuHits(v);
    if (!hits.length) { bad.push(v); continue; }
    if (!hits.includes(v)) notes.push(`products: "${v}" → "${hits.join('", "')}" (caixa do catálogo)`);
    out.push(...(hits.includes(v) ? [v] : hits));
  }
  if (bad.length) {
    const suggestions = (await Promise.all(bad.map(skuSuggestions))).flat();
    throw invalid('products', bad, dedupe(suggestions), 'products = externalId do SKU; nome de família vai em families (use resolve_entities)');
  }
  return dedupe(out);
}

async function normalizeAffiliateIds(values: string[], catalog: ScopeCatalog, notes: string[]): Promise<string[]> {
  const known = new Map(catalog.nsAffiliates.map((a) => [a.id, a]));
  const out: string[] = [];
  const bad: string[] = [];
  for (const v of values) {
    if (known.has(v)) {
      if (known.get(v)!.orders === 0) notes.push(`affiliate_ids: ${v} (${known.get(v)!.name}) não tem pedido mapeado — o resultado sai zerado`);
      out.push(v);
      continue;
    }
    // Nome do afiliado no lugar do id.
    const byName = catalog.nsAffiliates.filter((a) => normText(a.name) === normText(v));
    if (byName.length === 1) {
      notes.push(`affiliate_ids: "${v}" → ${byName[0].id} (${byName[0].name})`);
      out.push(byName[0].id);
      continue;
    }
    // Nickname/ID da CONTA na plataforma no lugar do affiliate_id do sistema.
    const accounts = await db.affiliate.findMany({
      where: { OR: [{ externalId: { equals: v, mode: 'insensitive' } }, { nickname: { equals: v, mode: 'insensitive' } }] },
      select: { mappedAffiliateId: true, externalId: true, platform: { select: { slug: true } } },
      take: 10,
    });
    const mapped = dedupe(accounts.map((a) => a.mappedAffiliateId).filter((x): x is string => !!x));
    if (mapped.length === 1) {
      notes.push(`affiliate_ids: "${v}" é conta de plataforma (${accounts.map((a) => `${a.platform.slug}:${a.externalId}`).join(', ')}) → affiliate_id ${mapped[0]}`);
      out.push(mapped[0]);
      continue;
    }
    bad.push(v);
  }
  if (bad.length) {
    throw invalid('affiliate_ids', bad, catalog.nsAffiliates.slice(0, 20).map((a) => `${a.id} (${a.name})`),
      'affiliate_ids é o id do NorthScale Afiliados; pra conta de plataforma use get_affiliate_detail(external_id) — resolve_entities acha os dois');
  }
  return dedupe(out);
}

async function normalizeFlat(input: Record<string, unknown>, notes: string[], prefix: string): Promise<Record<string, unknown>> {
  if (!hasScope(input)) return input;
  let catalog: ScopeCatalog | null = null;
  try {
    catalog = await loadScopeCatalog();
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[chat] normalizeScope sem catálogo — só normalização estática');
  }
  const out: Record<string, unknown> = { ...input };
  const local: string[] = [];
  const platforms = strings(input.platforms);
  if (platforms?.length) out.platforms = normalizePlatformList(platforms, catalog, 'platforms', local);
  if (typeof input.platform === 'string' && input.platform.trim()) {
    out.platform = normalizePlatformList([input.platform.trim()], catalog, 'platform', local)[0];
  }
  const stages = strings(input.stages);
  if (stages?.length) out.stages = normalizeStages(stages, local);
  const countries = strings(input.countries);
  if (countries?.length) out.countries = normalizeCountries(countries, catalog, local);
  if (catalog) {
    const families = strings(input.families);
    if (families?.length) out.families = normalizeFamilies(families, catalog, local);
    const affiliateIds = strings(input.affiliate_ids);
    if (affiliateIds?.length) out.affiliate_ids = await normalizeAffiliateIds(affiliateIds, catalog, local);
    const products = strings(input.products);
    if (products?.length) out.products = await normalizeProducts(products, local);
  }
  notes.push(...local.map((n) => prefix + n));
  return out;
}

export async function normalizeScope(tool: string, input: Record<string, unknown>): Promise<NormalizedScope> {
  const notes: string[] = [];
  const src = input ?? {};
  let out = await normalizeFlat(src, notes, '');
  // compare_periods carrega os filtros aninhados em `filters`.
  if (tool === 'compare_periods' && src.filters && typeof src.filters === 'object' && !Array.isArray(src.filters)) {
    out = { ...out, filters: await normalizeFlat(src.filters as Record<string, unknown>, notes, 'filters.') };
  }
  return { input: out, notes };
}
