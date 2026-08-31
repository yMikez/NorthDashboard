// Product classifier — desde 2026-08-31 é um SUGESTOR, não a autoridade.
// A autoridade da identidade de um SKU (família/papel/etapa/potes) é o
// CATÁLOGO (Product.verified — ver upsertOrder/verify-catalog): uma vez
// verificado, nenhum rename de vendor reescreve nada. Este módulo:
//   - parseia SKU/nome nas convenções conhecidas (CB/D24/BG/JVZoo/Cartpanda);
//   - resolve FAMÍLIA só contra um conjunto CANÔNICO (refineFamilyText) —
//     prefixo de split-test ("TA - NeuroPulse Pro") vira variante, nunca
//     família nova;
//   - lê o PAPEL de marcadores explícitos mesmo quando a família não parseia
//     ("DS3-TAB-NerveBOX" → DOWNSELL etapa 4);
//   - devolve `confidence` pra fila de confirmação do catálogo.
//
// Convenções por plataforma:
//   - ClickBank: SKU "NeuroMindPro-6-FE-vs2" (Family-Bottles-Type-Variant)
//   - DigiStore: nome "M3 - NeuroMind Pro (6 Bottles)" e variações
//   - BuyGoods:  nome natural "Neuro Mind Pro 6 Bottles (Upgrade 1)"
//   - JVZoo:     "NeuroPulse pro 12 Bottles / OTO1", "(Upgrade)", "/ FE"
//   - Cartpanda: papel vem do connector (up_sell_id); nome só dá família.

import type { ProductType } from '@prisma/client';

export interface ComboComponent {
  family: string;
  bottles: number;
}

export interface ProductClassification {
  family: string | null;
  type: ProductType;
  funnelStep: number | null;
  // true quando o PAPEL (type/funnelStep) veio de um marcador EXPLÍCITO —
  // código no SKU (CB), código no nome (D24) ou marcador no nome
  // ("(Upgrade)", "UP01", "/ OTO1", "/ DS 1-A", "/ FE"; "FREE" só conta
  // no BuyGoods). false = o papel é só o default do parser. Na JVZoo,
  // false significa: NÃO confie no type — o papel sai da sessão
  // (lib/services/jvzooSessions.ts). Cartpanda é sempre false (connector).
  roleMarked: boolean;
  variant: string | null;
  bottles: number | null;
  // Bonus bottles in combo SKUs (RC "6 + 2 Bottles" → bonusBottles=2,
  // CB "NeuroMindPro-2e1-RC" → bonusBottles=1). We pay COGS + fulfillment
  // for the total (bottles + bonusBottles).
  bonusBottles: number | null;
  // Combo multi-família ("1 Flex Guard + 1 Night Calm + 1 Honey Flush"):
  // componentes na ORDEM DO NOME, com a contagem de potes de cada um.
  // COGS soma por componente (lib/services/cogs.ts) — sem isso combo novo
  // exigia cadastrar custo por permutação.
  comboComponents: ComboComponent[] | null;
  // 'high' = família canônica + papel marcado (ou SKU CB) — dá pra confiar
  // sem humano. 'low' = alguma parte foi default/chute → fila de catálogo.
  confidence: 'high' | 'low';
}

// ------------------------------------------------------------------
// Famílias canônicas + resolução anti-fantasma
// ------------------------------------------------------------------

/** Normaliza pra chave de comparação: minúsculas, só [a-z0-9]. */
export function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Grafias canônicas (como estão no banco/ProductFamilyCost). Família NOVA
// de verdade entra aqui OU via cadastro (FamilyAlias/ProductFamilyCost —
// lib/services/familyDictionary.ts injeta as dinâmicas por cima).
const CANONICAL_FAMILIES = [
  'NeuroMindPro', 'NeuroPulsePro', 'GlycoPulse', 'GlycoEden', 'ThermoBurnPro',
  'MaxVitalize', 'FlexImmuneGuard', 'NightCalm', 'FlexGuard', 'ImmuneGuard',
  'DigestFlow', 'ProstaFlow', 'RetraBurn', 'MindTrex', 'EvoSlim',
  'Lumicept Gummies', 'Lumicept', 'Horse Peak Gelatin', 'Horse Boost Gelatin',
  'Memovance PRO', 'Blessed Kit', 'Honey Flush', 'HoneyPril',
  'Hawaiian Harmony', 'Cognizil', 'Gelazen', 'Giant Power', 'OptiCore Pro',
  'NeuroRecall', 'NerveBox', 'Heart Flush',
];

// Aliases estáticos (chave normalizada → canônica) além das próprias
// canônicas: grafias/typos históricos.
const STATIC_KEY_ALIASES: Record<string, string> = {
  luminacept: 'Lumicept',
  neuromind: 'NeuroMindPro',
  neurompro: 'NeuroMindPro',
  neuropulse: 'NeuroPulsePro',
  mindtrex: 'MindTrex',
  opticore: 'OptiCore Pro',
  horsepeakgelatintk: 'Horse Peak Gelatin',
};

interface KeyEntry { key: string; family: string }

function buildStaticEntries(): KeyEntry[] {
  const map = new Map<string, string>();
  for (const fam of CANONICAL_FAMILIES) map.set(normalizeKey(fam), fam);
  for (const [k, fam] of Object.entries(STATIC_KEY_ALIASES)) {
    if (!map.has(k)) map.set(k, fam);
  }
  return Array.from(map.entries())
    .map(([key, family]) => ({ key, family }))
    .sort((a, b) => b.key.length - a.key.length); // longest-first
}
const STATIC_ENTRIES = buildStaticEntries();

/**
 * Acha famílias canônicas citadas num texto livre (chaves normalizadas,
 * longest-first, spans DISJUNTOS). Devolve na ordem em que aparecem.
 * `extraEntries` permite injetar o dicionário dinâmico (FamilyAlias +
 * ProductFamilyCost + famílias verificadas) — ver familyDictionary.ts.
 */
export function scanFamilies(text: string, extraEntries?: KeyEntry[]): string[] {
  const key = normalizeKey(text);
  if (!key) return [];
  const entries = extraEntries?.length
    ? [...extraEntries, ...STATIC_ENTRIES].sort((a, b) => b.key.length - a.key.length)
    : STATIC_ENTRIES;
  const taken: Array<[number, number]> = [];
  const found: Array<{ family: string; at: number }> = [];
  for (const e of entries) {
    let from = 0;
    for (;;) {
      const at = key.indexOf(e.key, from);
      if (at === -1) break;
      const end = at + e.key.length;
      const overlaps = taken.some(([s, t]) => at < t && end > s);
      if (!overlaps) {
        taken.push([at, end]);
        if (!found.some((f) => f.family === e.family)) found.push({ family: e.family, at });
      }
      from = at + 1;
    }
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.family);
}

// Prefixo de split-test/variante que o vendor cola na frente da família
// ("TA - NeuroPulse Pro", "TAB - Night Calm", "V1 Thermo Burn Pro").
const TEST_PREFIX_RE = /^\s*[-–]?\s*(T[A-Z]{1,2}|V\d+)\s*[-–]\s*/;

export interface RefinedFamily {
  family: string | null;
  variant: string | null;
  components: string[]; // famílias na ordem do texto (≥2 = combo)
}

/**
 * Resolve um texto-de-família extraído por regex contra o conjunto
 * canônico. NUNCA cunha família nova a partir do texto: ou resolve pra
 * canônica(s), ou devolve null (quem decide é o catálogo/humano).
 * Par FlexGuard+ImmuneGuard colapsa no combo canônico FlexImmuneGuard.
 */
export function refineFamilyText(raw: string, extraEntries?: KeyEntry[]): RefinedFamily {
  const trimmed = raw.trim();
  if (!trimmed) return { family: null, variant: null, components: [] };
  // 1) regra explícita de normalização (comportamento histórico).
  const norm = normalizeFamily(trimmed);
  if (norm !== trimmed) return { family: norm, variant: null, components: [norm] };
  // 2) match exato de chave.
  const exact = STATIC_ENTRIES.find((e) => e.key === normalizeKey(trimmed))
    ?? extraEntries?.find((e) => e.key === normalizeKey(trimmed));
  if (exact) return { family: exact.family, variant: null, components: [exact.family] };
  // 3) scan por substring canônica.
  const fams = scanFamilies(trimmed, extraEntries);
  if (fams.length === 0) return { family: null, variant: null, components: [] };
  const testPrefix = TEST_PREFIX_RE.exec(trimmed);
  const variant = testPrefix ? testPrefix[1].toUpperCase() : null;
  if (fams.length === 1) return { family: fams[0], variant, components: fams };
  const set = new Set(fams);
  if (set.size === 2 && set.has('FlexGuard') && set.has('ImmuneGuard')) {
    return { family: 'FlexImmuneGuard', variant, components: ['FlexImmuneGuard'] };
  }
  return { family: fams.join(' + '), variant, components: fams };
}

/** Mesma família a menos de grafia/pontuação? ("Glyco Pulse + Prosta Flow" ≡ "GlycoPulse + ProstaFlow") */
export function sameFamilyKey(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizeKey(a) === normalizeKey(b);
}

// ------------------------------------------------------------------
// Regexes de convenção (inalteradas — nomes antigos parseiam idêntico)
// ------------------------------------------------------------------

// "2e1" / "3e1" / "6e2" formats appear on RC (recovery) SKUs in the CB CSV.
// They mean "{primary} bottles + {bonus} bottles" as one combo offer.
// Type group aceita UP\d+ / DW\d+ / M\d+ genéricos pra suportar variantes
// futuras (UP3, DW2, DW3, M4, ...) sem precisar mexer aqui de novo.
const CB_SKU_RE =
  /^(?<family>[A-Za-z]+)-(?<bottles>\d+)(?:e(?<bonus>\d+))?-(?<type>FE|UP\d+|DW\d+|DS\d*|RC)(?:-(?<variant>[A-Za-z0-9]+))?$/i;

/** O SKU segue o formato estruturado ClickBank/NS (vendor-controlado)? Auto-verifica o catálogo. */
export function isStructuredSku(sku: string): boolean {
  return CB_SKU_RE.test(sku.trim());
}

// DigiStore name pattern — formatos antigo/novo, variantes de letra/ponto,
// marcadores de clone "AFF -"/"B -", prefixo "V1", preço "$120" no fim.
const D24_NAME_RE =
  /^(?<typeFull>(?:M|UP|DW)\d+(?:\.\d+)?[A-Za-z]?(?:-[A-Za-z0-9]+)?|DS\d*(?:\.\d+)?[A-Za-z]?|RC)(?:\s*-\s*|\s+)(?:(?:AFF|B)\s*-\s*)?(?:V\d+\s+)?(?<family>[A-Za-z][A-Za-z0-9 \-+]*?)\s*\(?\s*(?<bottles>\d+)\s*(?:\+\s*(?<bonus>\d+)\s*)?Bottles?\)?(?:\s*\$[\d.,]+)?$/i;

// BuyGoods: "<Família> N[+M] Bottles <resto>" — resto carrega o marcador.
const BUYGOODS_NAME_RE =
  /^(?<family>.+?)\s+(?<b1>\d+)(?:\s*\+\s*(?<b2>\d+))?\s*bottles?\b\s*(?<rest>.*)$/i;

// Combo "NB" abreviado (JVZoo): "FlexGuard 3B+ ImmuneGuard 3B (Upgrade)".
const COMBO_ABBREV_RE =
  /^(?<famA>[A-Za-z][A-Za-z ]*?)\s*(?<b1>\d+)\s*B\s*\+\s*(?<famB>[A-Za-z][A-Za-z ]*?)\s*(?<b2>\d+)\s*B\b\s*(?<rest>.*)$/i;

// Combo com a CONTAGEM NA FRENTE (bundle triplo JVZoo):
// "1 Flex Guard + 1 Night Calm + 1 Honey Flush (Upgrade)" / "- [NeuroMind] / OTO3".
const COMBO_COUNT_FIRST_RE =
  /^(?<items>\d+\s+[A-Za-z][A-Za-z ]*?(?:\s*\+\s*\d+\s+[A-Za-z][A-Za-z ]*?)+)\s*(?<rest>[(\-\/].*)?$/;

// Código de papel D24 no PREFIXO do nome, lido mesmo quando o resto do nome
// não segue convenção nenhuma ("DS3-TAB-NerveBOX", "UP3 - Honey Flush +
// RetraBurn + Night Calm (3+1+1 Bottles)"). Sufixos de variante
// (letra/".1") não mudam o slot.
const D24_CODE_PREFIX_RE =
  /^\s*(?<code>(?:M|UP|DW|DS)\s*0*\d+)(?:\.\d+)?[A-Za-z]?\s*(?<restName>[-–\s(].*)?$/i;

// FE novo da Digistore sem a palavra Bottles: "NeuroMind Pro (3 + 2 FREE)"
// — N potes pagos + M de bônus. NÃO é recovery (FREE→RC é convenção do
// BuyGoods; ver freeIsRecovery).
const D24_FREE_PACK_RE =
  /^(?<fam>.+?)\s*\(\s*(?<b>\d+)\s*\+\s*(?<bo>\d+)\s*free\s*\)\s*$/i;

const FAMILY_NORMALIZATIONS: Array<[RegExp, string]> = [
  [/^glycopulse$/i, 'GlycoPulse'],
  [/^glyco\s*pulse$/i, 'GlycoPulse'],
  [/^neurompro$/i, 'NeuroMindPro'],
  [/^neuromindpro$/i, 'NeuroMindPro'],
  [/^neuromind\s*pro$/i, 'NeuroMindPro'],
  [/^thermoburnpro$/i, 'ThermoBurnPro'],
  [/^thermo\s*burn\s*pro$/i, 'ThermoBurnPro'],
  [/^maxvitalize?$/i, 'MaxVitalize'],
  [/^max\s*vitalize?$/i, 'MaxVitalize'],
  [/^flex[\s\-]*immune[\s\-]*guard$/i, 'FlexImmuneGuard'],
  [/^night[\s]*calm$/i, 'NightCalm'],
  [/^flex\s*guard$/i, 'FlexGuard'],
  [/^immune\s*guard$/i, 'ImmuneGuard'],
  [/^neuro\s*mind\s*pro$/i, 'NeuroMindPro'],
  [/^flex.*imm?une.*guard$/i, 'FlexImmuneGuard'],
  [/^neuro\s*pulse\s*pro$/i, 'NeuroPulsePro'],
  [/^neuropulsepro$/i, 'NeuroPulsePro'],
  [/^neuro\s*pulse$/i, 'NeuroPulsePro'],
  [/^neuropulse$/i, 'NeuroPulsePro'],
  [/^digest\s*flow$/i, 'DigestFlow'],
  [/^prosta\s*flow$/i, 'ProstaFlow'],
  [/^retra\s*burn$/i, 'RetraBurn'],
  [/^mind\s*trex$/i, 'MindTrex'],
  [/^evo\s*slim$/i, 'EvoSlim'],
  [/^lumi\s*cept$/i, 'Lumicept'],
  [/^luminacept$/i, 'Lumicept'],
  [/^horse\s*peak\s*gelatin(?:\s*[-–]\s*tk)?$/i, 'Horse Peak Gelatin'],
  [/^imm?une\s*guard\s*\+\s*flexy?\s*guard$/i, 'FlexImmuneGuard'],
  [/^memovance\s*pro$/i, 'Memovance PRO'],
  [/^blessed\s*kit$/i, 'Blessed Kit'],
  [/^nerve\s*box$/i, 'NerveBox'],
  [/^honey\s*flush$/i, 'Honey Flush'],
  [/^honey\s*pril$/i, 'HoneyPril'],
  [/^hawaiian\s*harmony$/i, 'Hawaiian Harmony'],
  [/^glyco\s*eden$/i, 'GlycoEden'],
  [/^giant\s*power$/i, 'Giant Power'],
  [/^opti\s*core(?:\s*pro)?$/i, 'OptiCore Pro'],
  [/^neuro\s*recall$/i, 'NeuroRecall'],
  [/^heart\s*flush$/i, 'Heart Flush'],
  [/^horse\s*boost\s*gelatin$/i, 'Horse Boost Gelatin'],
];

export function normalizeFamily(raw: string): string {
  const trimmed = raw.trim();
  for (const [re, canonical] of FAMILY_NORMALIZATIONS) {
    if (re.test(trimmed)) return canonical;
  }
  // Unknown family — keep original spelling (UI will show it as-is).
  return trimmed;
}

// Refina a família extraída pelos parsers de convenção: canoniza prefixo de
// teste ("TA - NeuroPulse Pro" → NeuroPulsePro, variant TA). Quando o texto
// não resolve pra canônica nenhuma, MANTÉM o comportamento histórico
// (grafia original) — família realmente nova continua aparecendo; a fila
// do catálogo e o guard anti-fantasma do ingest seguram o estrago.
function refineExtractedFamily(raw: string): { family: string; variant: string | null } {
  const norm = normalizeFamily(raw);
  if (norm !== raw.trim()) return { family: norm, variant: null };
  if (STATIC_ENTRIES.some((e) => e.key === normalizeKey(raw))) {
    const hit = STATIC_ENTRIES.find((e) => e.key === normalizeKey(raw))!;
    return { family: hit.family, variant: null };
  }
  const refined = refineFamilyText(raw);
  if (refined.family) return { family: refined.family, variant: refined.variant };
  return { family: raw.trim(), variant: null };
}

// ------------------------------------------------------------------
// Potes — extrator genérico (o vendor escreve de N formas)
// ------------------------------------------------------------------

interface BottlesInfo { bottles: number | null; bonusBottles: number | null; counts: number[] }

/** Extrai contagem de potes de texto livre. `counts` lista cada número achado (pra mapear em combos). */
export function extractBottles(text: string): BottlesInfo {
  // (i) soma explícita "(3+1+1 Bottles)" / "3 + 3 Bottles"
  const multi = text.match(/(\d+(?:\s*\+\s*\d+)+)\s*bottles?\b/i);
  if (multi) {
    const counts = multi[1].split('+').map((x) => parseInt(x.trim(), 10));
    return { bottles: counts[0], bonusBottles: counts.slice(1).reduce((s, n) => s + n, 0) || null, counts };
  }
  // (ii) "(3 + 2 FREE)" — pago + bônus
  const freePack = text.match(/(\d+)\s*\+\s*(\d+)\s*free\b/i);
  if (freePack) {
    const a = parseInt(freePack[1], 10); const b = parseInt(freePack[2], 10);
    return { bottles: a, bonusBottles: b, counts: [a, b] };
  }
  // (iii) parentéticos múltiplos "Fam (3 Bottles) + Fam (3 Bottles)"
  const parens = Array.from(text.matchAll(/\(\s*(\d+)\s*bottles?\s*\)/gi)).map((m) => parseInt(m[1], 10));
  if (parens.length >= 2) {
    return { bottles: parens.reduce((s, n) => s + n, 0), bonusBottles: null, counts: parens };
  }
  // (iv) "N [até 2 palavras] Bottles" ("12 Additional Bottles")
  const worded = text.match(/(\d+)\s*(?:[A-Za-z]+\s+){0,2}bottles?\b/i);
  if (worded) {
    const n = parseInt(worded[1], 10);
    return { bottles: n, bonusBottles: null, counts: [n] };
  }
  // (v) abreviado "6B"
  const abbrev = Array.from(text.matchAll(/(\d+)\s*B\b/g)).map((m) => parseInt(m[1], 10));
  if (abbrev.length > 0) {
    return { bottles: abbrev.reduce((s, n) => s + n, 0), bonusBottles: null, counts: abbrev };
  }
  return { bottles: null, bonusBottles: null, counts: [] };
}

// ------------------------------------------------------------------
// Papel (type/step)
// ------------------------------------------------------------------

// Sufixos de variante (".1", letra — UP1A, UP1.1, DS2.1, DS1a) NÃO mudam a
// posição no funil: são split-tests/clones do MESMO slot.
function classifyType(typeCode: string): { type: ProductType; step: number } {
  const code = typeCode.toUpperCase();
  if (code === 'FE' || /^M\d+(?:\.\d+)?[A-Z]?$/.test(code)) {
    return { type: 'FRONTEND', step: 1 };
  }
  if (code === 'RC') {
    return { type: 'SMS_RECOVERY', step: 1 };
  }
  const upMatch = code.match(/^UP(\d+)(?:\.\d+)?[A-Z]?$/);
  if (upMatch) {
    return { type: 'UPSELL', step: parseInt(upMatch[1], 10) + 1 };
  }
  const dwMatch = code.match(/^DW(\d+)(?:\.\d+)?[A-Z]?$/);
  if (dwMatch) {
    return { type: 'DOWNSELL', step: parseInt(dwMatch[1], 10) + 1 };
  }
  // 'DS' — mesma escada do DW: DS1=step 2, DS2=step 3, DS3=step 4.
  const dsMatch = code.match(/^DS(\d+)?(?:\.\d+)?[A-Z]?$/);
  if (dsMatch) {
    const n = dsMatch[1] ? parseInt(dsMatch[1], 10) : 1;
    return { type: 'DOWNSELL', step: n + 1 };
  }
  throw new Error(`classifyProduct: unknown type code "${typeCode}"`);
}

// Marcadores NUMERADOS de papel. "OTO N" = upsell no IPN real da JVZoo.
const UP_N_RE = /\b(?:upgrade|upsell|oto|up)\s*0*(\d+)\b/;
const DW_N_RE = /\b(?:down\s*sell|last\s*chance|down|ds)\s*0*(\d+)\b/;
// FE explícito no nome: "NeuroPulse pro 6 Bottles / FE", "... / FE (AFF)".
const FE_MARK_RE = /\bfe\b/;
// Qualquer marcador de papel que o parser sabe ler (sem número também).
// "FREE" NÃO entra aqui — só conta como marcador (RC) no BuyGoods.
const ROLE_MARK_RE = /\b(?:upgrade|upsell|oto|up)\s*0*\d+\b|\b(?:down\s*sell|last\s*chance|down|ds)\s*0*\d+\b|last\s*chance|down\s*sell|upgrade|\bupsell\b|\bfe\b/i;

// FREE→SMS_RECOVERY é convenção do BUYGOODS. Sem plataforma (chamadas
// legadas/testes) mantém o comportamento histórico; na Digistore "FREE" é
// bônus de potes ("(3 + 2 FREE)") e na JVZoo não significa recovery.
function freeIsRecovery(platform?: string | null): boolean {
  return platform == null || platform === 'buygoods';
}

/**
 * O marcador de papel no NOME traz o NÚMERO do slot ("OTO2", "UP01",
 * "DS 1-A")? Sem número ("(Upgrade)") o tipo vale mas o slot é chute —
 * na JVZoo o slot verdadeiro vem da POSIÇÃO na sessão.
 */
export function hasNumberedRoleMarker(name?: string | null): boolean {
  const n = (name ?? '').toLowerCase();
  return UP_N_RE.test(n) || DW_N_RE.test(n);
}

/**
 * O papel deste SKU está ANOTADO em algum lugar (SKU CB, código D24 ou
 * marcador no nome)? Cartpanda: nunca (o papel é do connector). Quando
 * false, o `type` do classificador é só o default do parser.
 */
export function hasRoleMarker(sku: string, name?: string | null, platform?: string | null): boolean {
  if (platform === 'cartpanda') return false;
  if (CB_SKU_RE.test(sku.trim())) return true;
  const n = (name ?? '').trim();
  if (!n) return false;
  if (D24_NAME_RE.test(n)) return true;
  if (D24_CODE_PREFIX_RE.test(n)) return true;
  if (ROLE_MARK_RE.test(n)) return true;
  if (freeIsRecovery(platform) && /\bfree\b/i.test(n)) return true;
  return false;
}

function buyGoodsType(
  family: string,
  rest: string,
  platform?: string | null,
): { type: ProductType; step: number } {
  const r = rest.toLowerCase();
  const upN = r.match(UP_N_RE);
  if (upN) return classifyType(`UP${parseInt(upN[1], 10)}`);
  const dwN = r.match(DW_N_RE);
  if (dwN) return classifyType(`DW${parseInt(dwN[1], 10)}`);
  // "/ FE" explícito (JVZoo) — marcador mais específico.
  if (FE_MARK_RE.test(r)) return classifyType('FE');
  // Sem N → ancorado na família (retrocompat).
  const isDownsell = /last\s*chance|down\s*sell/.test(r);
  const isUpgrade = /upgrade/.test(r);
  if (isDownsell || isUpgrade) {
    if (family === 'NightCalm') return classifyType(isDownsell ? 'DW2' : 'UP2');
    if (family === 'FlexImmuneGuard') return classifyType(isDownsell ? 'DW3' : 'UP3');
    // JVZoo (funil NeuroMind): DigestFlow não tem FE lá — slot 2 sempre.
    if (platform === 'jvzoo' && family === 'DigestFlow') {
      return classifyType(isDownsell ? 'DW2' : 'UP2');
    }
    return classifyType(isDownsell ? 'DW1' : 'UP1');
  }
  return classifyType('FE');
}

// ------------------------------------------------------------------
// Cartpanda (papel vem do connector; nome só dá família/potes)
// ------------------------------------------------------------------

type BaseClassification = Omit<ProductClassification, 'roleMarked' | 'confidence' | 'comboComponents'> & {
  comboComponents?: ComboComponent[] | null;
};

function classifyCartpanda(sku: string, name?: string | null): BaseClassification {
  const raw = (name || sku || '').trim();

  let fam = raw;
  if (fam.includes('|')) {
    fam = fam.split('|')[0];
  } else {
    fam = fam.replace(/\s+\d+\s*(?:\+\s*\d+\s*)?bottles?.*$/i, '');
  }
  fam = fam.replace(/\s*[-–]\s*FE\b.*$/i, '').replace(/\s{2,}/g, ' ').trim();
  const family = fam ? normalizeFamily(fam) : null;

  const bm = raw.match(/(\d+)\s*(?:\+\s*(\d+))?\s*bottles?/i);
  const bottles = bm ? parseInt(bm[1], 10) : null;
  const bonusBottles = bm && bm[2] ? parseInt(bm[2], 10) : null;

  let type: ProductType = 'FRONTEND';
  let funnelStep: number | null = 1;
  const dw = raw.match(/down\s*sell\s*0*(\d+)/i);
  const up = raw.match(/up\s*sell\s*0*(\d+)/i);
  if (dw) {
    type = 'DOWNSELL';
    funnelStep = parseInt(dw[1], 10) + 1;
  } else if (up) {
    type = 'UPSELL';
    funnelStep = parseInt(up[1], 10) + 1;
  }

  return { family, type, funnelStep, variant: null, bottles, bonusBottles };
}

// Plataformas cujo PAPEL no funil (productType/funnelStep) vem do CONNECTOR,
// nunca do nome do produto: Cartpanda (up_sell_id).
export const CONNECTOR_ROLE_PLATFORMS = new Set(['cartpanda']);

export function classifyProduct(
  sku: string,
  name?: string | null,
  platform?: string | null,
): ProductClassification {
  const base = classifyProductBase(sku, name, platform);
  const roleMarked = hasRoleMarker(sku, name, platform);
  return {
    ...base,
    comboComponents: base.comboComponents ?? null,
    roleMarked,
    confidence: base.family !== null && roleMarked ? 'high' : 'low',
  };
}

function classifyProductBase(
  sku: string,
  name?: string | null,
  platform?: string | null,
): BaseClassification {
  // Cartpanda tem caminho próprio: família do nome, papel do connector.
  if (platform === 'cartpanda') {
    return classifyCartpanda(sku, name);
  }

  // 1) ClickBank pattern on SKU (most informative — has family in the prefix).
  const cb = CB_SKU_RE.exec(sku.trim());
  if (cb?.groups) {
    const t = classifyType(cb.groups.type);
    return {
      family: normalizeFamily(cb.groups.family),
      type: t.type,
      funnelStep: t.step,
      variant: cb.groups.variant ?? null,
      bottles: parseInt(cb.groups.bottles, 10),
      bonusBottles: cb.groups.bonus ? parseInt(cb.groups.bonus, 10) : null,
    };
  }

  // 2) DigiStore pattern on Name.
  if (name) {
    const d24 = D24_NAME_RE.exec(name.trim());
    if (d24?.groups) {
      const typeFull = d24.groups.typeFull;
      const dashIdx = typeFull.indexOf('-');
      const typeCode = dashIdx === -1 ? typeFull : typeFull.slice(0, dashIdx);
      const variantFromType = dashIdx === -1 ? null : typeFull.slice(dashIdx + 1);
      const t = classifyType(typeCode);
      // Prefixo de split-test na família ("TA - NeuroPulse Pro") canoniza —
      // sem isso virava família fantasma rachando funil/COGS (2026-08-31).
      const fam = refineExtractedFamily(d24.groups.family);
      return {
        family: fam.family,
        type: t.type,
        funnelStep: t.step,
        variant: variantFromType ?? fam.variant,
        bottles: parseInt(d24.groups.bottles, 10),
        bonusBottles: d24.groups.bonus ? parseInt(d24.groups.bonus, 10) : null,
      };
    }

    // 2.5) FE novo da Digistore "(N + M FREE)" — sem a palavra Bottles.
    if (platform === 'digistore24') {
      const fp = D24_FREE_PACK_RE.exec(name.trim());
      if (fp?.groups) {
        const fam = refineExtractedFamily(fp.groups.fam);
        return {
          family: fam.family,
          type: 'FRONTEND',
          funnelStep: 1,
          variant: fam.variant,
          bottles: parseInt(fp.groups.b, 10),
          bonusBottles: parseInt(fp.groups.bo, 10),
        };
      }
    }
  }

  // 3) BuyGoods: nome em linguagem natural.
  if (name) {
    const trimmed = name.trim();
    const isFree = /\bfree\b/i.test(trimmed);
    const treatFreeAsRc = isFree && freeIsRecovery(platform);
    const cleanedForParse = isFree
      ? trimmed.replace(/\bfree\b/gi, ' ').replace(/\s+/g, ' ').trim()
      : trimmed;
    const bg = BUYGOODS_NAME_RE.exec(cleanedForParse);
    if (bg?.groups) {
      const fam = refineExtractedFamily(bg.groups.family.replace(/\s+/g, ' ').trim());
      const family = fam.family;
      const bottles = parseInt(bg.groups.b1, 10);
      const bonusBottles = bg.groups.b2 ? parseInt(bg.groups.b2, 10) : null;
      const rest = bg.groups.rest || '';
      const t = treatFreeAsRc
        ? classifyType('RC')
        : buyGoodsType(family, rest, platform);
      return {
        family: family || null,
        type: t.type,
        funnelStep: t.step,
        variant: fam.variant,
        bottles,
        bonusBottles,
      };
    }

    // Combo com potes abreviados ("FlexGuard 3B+ ImmuneGuard 3B (Upgrade)").
    const combo = COMBO_ABBREV_RE.exec(trimmed);
    if (combo?.groups) {
      const famA = normalizeFamily(combo.groups.famA.replace(/\s+/g, ' ').trim());
      const famB = normalizeFamily(combo.groups.famB.replace(/\s+/g, ' ').trim());
      const family = normalizeFamily(`${famA} + ${famB}`);
      const b1 = parseInt(combo.groups.b1, 10);
      const b2 = parseInt(combo.groups.b2, 10);
      const t = buyGoodsType(family, combo.groups.rest || '', platform);
      return {
        family: family || null,
        type: t.type,
        funnelStep: t.step,
        variant: null,
        bottles: b1,
        bonusBottles: b2,
        comboComponents: [{ family: famA, bottles: b1 }, { family: famB, bottles: b2 }],
      };
    }

    // Combo com a CONTAGEM NA FRENTE ("1 Flex Guard + 1 Night Calm + ...").
    const cf = COMBO_COUNT_FIRST_RE.exec(trimmed);
    if (cf?.groups) {
      const items = cf.groups.items.split('+').map((part) => {
        const m = part.trim().match(/^(\d+)\s+(.+)$/);
        return m ? { n: parseInt(m[1], 10), name: normalizeFamily(m[2].trim()) } : null;
      }).filter((x): x is { n: number; name: string } => x !== null);
      if (items.length >= 2) {
        const family = items.map((i) => i.name).join(' + ');
        const bottles = items.reduce((s, i) => s + i.n, 0);
        const rest = cf.groups.rest || '';
        const marked = buyGoodsType(family, rest, platform);
        // Sem número no marcador → slot 3 (Up03/Down03 da convenção).
        const t = marked.type === 'FRONTEND'
          ? marked
          : (UP_N_RE.test(rest.toLowerCase()) || DW_N_RE.test(rest.toLowerCase()))
            ? marked
            : classifyType(marked.type === 'DOWNSELL' ? 'DW3' : 'UP3');
        return {
          family,
          type: t.type,
          funnelStep: t.step,
          variant: null,
          bottles,
          bonusBottles: null,
          comboComponents: items.map((i) => ({ family: i.name, bottles: i.n })),
        };
      }
    }

    // 3.5) Código de papel D24 no prefixo com o RESTO fora de convenção
    // ("DS3-TAB-NerveBOX", "UP3 - Honey Flush + RetraBurn + Night Calm
    // (3+1+1 Bottles)", "UP3 NightCalm (3 Bottles) + FlexGuard (3 Bottles)").
    // O papel/etapa saem do código; família só se resolver pra canônica(s).
    const cp = D24_CODE_PREFIX_RE.exec(trimmed);
    if (cp?.groups) {
      const t = classifyType(cp.groups.code.replace(/\s+/g, ''));
      const restName = (cp.groups.restName ?? '').trim();
      const fams = scanFamilies(restName);
      const binfo = extractBottles(restName);
      let family: string | null = null;
      let comboComponents: ComboComponent[] | null = null;
      const testPrefix = TEST_PREFIX_RE.exec(restName);
      if (fams.length === 1) {
        family = fams[0];
      } else if (fams.length >= 2) {
        const set = new Set(fams);
        if (set.size === 2 && set.has('FlexGuard') && set.has('ImmuneGuard')) {
          family = 'FlexImmuneGuard';
        } else {
          family = fams.join(' + ');
          // Contagens na mesma quantidade que as famílias → componentes na
          // ordem do nome ("(3+1+1 Bottles)" → [3,1,1]; parentéticos idem;
          // "3 Flex Guard + 1 Night Calm and 1 Neuro Pulse Pro" → leading).
          let counts = binfo.counts;
          if (counts.length !== fams.length) {
            const segs = restName.split(/\s*(?:\+|\band\b|&)\s*/i);
            const lead = segs.map((s) => s.match(/^\s*[-–]?\s*(\d+)\s+/)).map((m) => (m ? parseInt(m[1], 10) : null));
            if (lead.length === fams.length && lead.every((x) => x !== null)) counts = lead as number[];
          }
          if (counts.length === fams.length) {
            comboComponents = fams.map((f, i) => ({ family: f, bottles: counts[i] }));
          }
        }
      }
      const totalBottles = comboComponents
        ? comboComponents.reduce((s, c) => s + c.bottles, 0)
        : binfo.bottles;
      return {
        family,
        type: t.type,
        funnelStep: t.step,
        variant: testPrefix ? testPrefix[1].toUpperCase() : null,
        bottles: totalBottles,
        bonusBottles: comboComponents ? null : binfo.bonusBottles,
        comboComponents,
      };
    }
  }

  // 4) No match — o papel ainda pode estar ANOTADO no nome mesmo quando a
  // estrutura não parseia; família só se resolver pra canônica (scan).
  if (name) {
    const raw = name.toLowerCase();
    const famsRaw = scanFamilies(name);
    const fams = (() => {
      if (famsRaw.length < 2) return famsRaw;
      const set = new Set(famsRaw);
      if (set.size === 2 && set.has('FlexGuard') && set.has('ImmuneGuard')) return ['FlexImmuneGuard'];
      return famsRaw;
    })();
    const family = fams.length === 0 ? null : fams.length === 1 ? fams[0] : fams.join(' + ');
    const binfo = extractBottles(name);
    const mk = (type: ProductType, step: number | null): BaseClassification => ({
      family, type, funnelStep: step, variant: null, bottles: binfo.bottles, bonusBottles: binfo.bonusBottles,
    });
    const dwN = raw.match(DW_N_RE);
    if (dwN) {
      const t = classifyType(`DW${parseInt(dwN[1], 10)}`);
      return mk(t.type, t.step);
    }
    // "/ FE" explícito num nome fora de padrão → porta de entrada mesmo assim.
    if (FE_MARK_RE.test(raw)) {
      return mk('FRONTEND', 1);
    }
    if (/last\s*chance|down\s*sell/.test(raw)) {
      return mk('DOWNSELL', null);
    }
    const upN = raw.match(UP_N_RE);
    if (upN) {
      const t = classifyType(`UP${parseInt(upN[1], 10)}`);
      return mk(t.type, t.step);
    }
    // "(Upgrade)"/"(Upsell)" nu — tipo sem slot (sessão/humano decidem).
    if (/\b(?:upgrade|upsell)\b/.test(raw)) {
      return mk('UPSELL', null);
    }
    if (family !== null) {
      // Família canônica citada mas zero marcador → default histórico
      // (backend mais provável que porta de entrada), com a família.
      return mk('UPSELL', null);
    }
  }
  return {
    family: null,
    type: 'UPSELL',
    funnelStep: null,
    variant: null,
    bottles: null,
    bonusBottles: null,
  };
}
