// Authoritative product classifier. Derives funnel role + family from a
// product's SKU / name using the conventions documented in
// Planilhas/Products - {ClickBank,DigiStore}.csv.
//
// The classifier is platform-aware via two patterns:
//   - ClickBank uses SKU strings like "NeuroMindPro-6-FE-vs2" (Family-Bottles-Type-Variant)
//   - DigiStore uses Name strings like "M3 - NeuroMind Pro (6 Bottles)"
// (DigiStore SKUs in our DB are numeric product_ids, so we parse the name.)
//
// When neither pattern matches we return family=null. Callers can treat that
// as "cross-sell / unknown" — UI groups those under an "Outros" bucket.

import type { ProductType } from '@prisma/client';

export interface ProductClassification {
  family: string | null;
  type: ProductType;
  funnelStep: number | null;
  // true quando o PAPEL (type/funnelStep) veio de um marcador EXPLÍCITO —
  // código no SKU (CB), código no nome (D24) ou marcador no nome
  // ("(Upgrade)", "UP01", "/ OTO1", "/ DS 1-A", "/ FE", "Last Chance",
  // "FREE"). false = o papel é só o default do parser ("sem marcador →
  // FRONTEND" no BuyGoods-style, "sem padrão → UPSELL" no fallback). Na
  // JVZoo, false significa: NÃO confie no type — o papel sai da sessão
  // (lib/services/jvzooSessions.ts). Cartpanda é sempre false (connector).
  roleMarked: boolean;
  variant: string | null;
  bottles: number | null;
  // Bonus bottles in combo SKUs (RC "6 + 2 Bottles" → bonusBottles=2,
  // CB "NeuroMindPro-2e1-RC" → bonusBottles=1). We pay COGS + fulfillment
  // for the total (bottles + bonusBottles).
  bonusBottles: number | null;
}

// "2e1" / "3e1" / "6e2" formats appear on RC (recovery) SKUs in the CB CSV.
// They mean "{primary} bottles + {bonus} bottles" as one combo offer. We
// capture both so COGS calc can charge for the total bottles shipped.
//
// Type group aceita UP\d+ / DW\d+ / M\d+ genéricos pra suportar variantes
// futuras (UP3, DW2, DW3, M4, ...) sem precisar mexer aqui de novo.
const CB_SKU_RE =
  /^(?<family>[A-Za-z]+)-(?<bottles>\d+)(?:e(?<bonus>\d+))?-(?<type>FE|UP\d+|DW\d+|DS\d*|RC)(?:-(?<variant>[A-Za-z0-9]+))?$/i;

// DigiStore name pattern. O vendor usa DOIS formatos:
//   antigo: "M3 - NeuroMind Pro (6 Bottles)"          (TYPE - Family (N Bottles))
//   novo:   "M1 Cognizil 2 Bottles"                   (TYPE Family N Bottles, SEM hífen/parênteses)
//           "DS1a Cognizil 3 Bottles $120"            (+ sufixo de preço)
//           "DS3 FlexGuard + ImmuneGuard (1 + 1 Bottles)"
//           "DW1 - V1 Thermo Burn Pro (3 Bottles)"    (prefixo de variante "V1" na frente da família)
//           "UP1A - NeuroMind Pro (6 Bottles)"        (sufixo de variante em LETRA)
//           "UP1.1 - NeuroPulse Pro (12 Bottles)"     (sufixo de variante com PONTO)
//           "DS2.1 - Lumicept (6 Bottles)"            (idem no DS)
//           "M1 - AFF - NeuroMind Pro (2 Bottles)"    (clone de order form com marcador)
// Por isso:
//   - separador é " - " OU só espaço: (?:\s*-\s*|\s+)
//   - todos os slots aceitam sufixo de variante ".N" e/ou letra
//     (UP1A, UP1.1, UP1.2A, UP2b, DS1a, DS2.1) — auditoria prod 2026-08-03:
//     sem isso caíam no fallback (UPSELL sem família) ou, pior, no path
//     BuyGoods virando FRONTEND com família-lixo ("DS1.1 - Hawaiian…").
//   - marcadores de clone "AFF -" / "B -" após o separador são descartados
//   - prefixo de variante "V\d+ " opcional é descartado (fica na família senão)
//   - parênteses dos potes são opcionais: \(? ... \)?
//   - sufixo de preço "$120"/"$49.50" opcional no fim
// Family character class aceita hífen (Flex-ImmuneGuard), "+" (combos) e dígitos.
const D24_NAME_RE =
  /^(?<typeFull>(?:M|UP|DW)\d+(?:\.\d+)?[A-Za-z]?(?:-[A-Za-z0-9]+)?|DS\d*(?:\.\d+)?[A-Za-z]?|RC)(?:\s*-\s*|\s+)(?:(?:AFF|B)\s*-\s*)?(?:V\d+\s+)?(?<family>[A-Za-z][A-Za-z0-9 \-+]*?)\s*\(?\s*(?<bottles>\d+)\s*(?:\+\s*(?<bonus>\d+)\s*)?Bottles?\)?(?:\s*\$[\d.,]+)?$/i;

// BuyGoods classifier — convenção do vendor:
//
//   "Neuro Mind Pro 6 Bottles"                         → FE
//   "Neuro Mind Pro 6 Bottles (Upgrade 1)"             → UP1   (explícito, novo)
//   "Neuro Mind Pro 6 Bottles (Upgrade)"               → UP1   (retrocompat, ancorado na família)
//   "Night Calm 6 Bottles (Upgrade 2)"                 → UP2   (explícito)
//   "Night Calm 6 Bottles (Upgrade)"                   → UP2   (retrocompat)
//   "Neuro Mind Pro 3 Bottles (Downsell 1)"            → DW1   (explícito)
//   "Neuro Mind Pro 3 Bottles (Last Chance)"           → DW1   (retrocompat)
//   "Flex + Imune Guard 3 + 3 Bottles (Upgrade 3)"     → UP3 combo
//   "Glyco Pulse 1 FREE Bottle"                        → SMS_RECOVERY (FREE em qualquer lugar)
//   "Neuro Mind Pro 2 Bottles FREE Shipping"           → SMS_RECOVERY
//
// REGRA:
//   1) Se o nome contém "FREE" (case-insensitive, word boundary) → SMS_RECOVERY.
//   2) "(Upgrade N)" → UP<N>; "(Downsell N)" → DW<N> (com N=1,2,3,...).
//   3) "(Upgrade)" sem N → ancorado na família (NightCalm=UP2, FlexImmuneGuard=UP3, resto=UP1).
//   4) "(Last Chance)" sem N → idem mas DW.
//   5) Sem modificador → FRONTEND.
//
// O regex captura family + b1 (+b2 combo) + rest. O `rest` é analisado
// separadamente pra extrair Upgrade N / Downsell N / Upgrade / Last Chance.
// Parênteses são opcionais (tolerância pra variações de nome).
const BUYGOODS_NAME_RE =
  /^(?<family>.+?)\s+(?<b1>\d+)(?:\s*\+\s*(?<b2>\d+))?\s*bottles?\b\s*(?<rest>.*)$/i;

// Combo com a contagem de potes ABREVIADA em "NB" — convenção que só a JVZoo
// usa até agora (auditoria 2026-08-12):
//
//   "FlexGuard 3B+ ImmuneGuard 3B (Upgrade)"
//   "FlexGuard 1B+ ImmuneGuard 1B (LastChance)"
//   "NightCalm 3B + FlexGuard 3B (Upgrade)"
//
// BUYGOODS_NAME_RE exige a palavra literal "Bottles", então esses nomes caíam
// no fallback cego: família null → COGS $0, frete $0 e os potes fora do
// bottlesShipped (96 pedidos em prod). Roda DEPOIS da tentativa BuyGoods —
// nome com "Bottles" nunca chega aqui, e o combo antigo
// ("Flex + Imune Guard 3 + 3 Bottles") não casa este padrão porque o "+"
// aparece antes do primeiro número.
const COMBO_ABBREV_RE =
  /^(?<famA>[A-Za-z][A-Za-z ]*?)\s*(?<b1>\d+)\s*B\s*\+\s*(?<famB>[A-Za-z][A-Za-z ]*?)\s*(?<b2>\d+)\s*B\b\s*(?<rest>.*)$/i;

// Combo com a CONTAGEM NA FRENTE de cada item — bundle triplo da JVZoo:
//   "1 Flex Guard + 1 Night Calm + 1 Honey Flush (Upgrade)"
// items = tudo antes do marcador entre parênteses; cada item = "N Nome".
// Requer 2+ itens (o split valida) — nome comum "2 Bottles..." não chega
// aqui porque o caminho BuyGoods casa antes.
// `rest` aceita "(Upgrade)" E o esquema real do IPN JVZoo: "- [NeuroMind] / OTO3",
// "/ DS3" (2026-08-26 — antes só "(", e o bundle triplo caía no fallback
// sem família = COGS $0).
const COMBO_COUNT_FIRST_RE =
  /^(?<items>\d+\s+[A-Za-z][A-Za-z ]*?(?:\s*\+\s*\d+\s+[A-Za-z][A-Za-z ]*?)+)\s*(?<rest>[(\-\/].*)?$/;

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
  // Famílias novas (2026-04 em diante) — preservar a grafia oficial.
  [/^flex[\s\-]*immune[\s\-]*guard$/i, 'FlexImmuneGuard'],
  [/^night[\s]*calm$/i, 'NightCalm'],
  // FlexGuard e ImmuneGuard como famílias INDIVIDUAIS (BG vende isolado
  // também — "Flex Guard 1 Bottle" / "Immune Guard 3 Bottles"). Entram
  // ANTES da regex de combo abaixo pra não cair lá. O combo
  // ("Flex Guard + Immune Guard" / "Flex + Imune guard") tem ambos no
  // nome → matcha a regex de combo (FlexImmuneGuard) na sequência.
  [/^flex\s*guard$/i, 'FlexGuard'],
  [/^immune\s*guard$/i, 'ImmuneGuard'],
  // Variações BuyGoods (nome com espaços / "+" / grafia "imune"):
  // "Neuro Mind Pro", "Flex Guard + Immune Guard", "Flex + Imune guard".
  [/^neuro\s*mind\s*pro$/i, 'NeuroMindPro'],
  [/^flex.*imm?une.*guard$/i, 'FlexImmuneGuard'],
  // NeuroPulsePro — produto distinto de NeuroMindPro (compartilha codenames
  // BuyGoods, então a disambiguação vem pelo NOME). O vendor escreve
  // "Neuro Pulse Pro" com espaços; canônico aqui é "NeuroPulsePro" pra
  // bater com a convenção do NeuroMindPro. "NeuroPulse" sem "Pro" também
  // canonicaliza pra NeuroPulsePro (vendor usa os dois informalmente).
  [/^neuro\s*pulse\s*pro$/i, 'NeuroPulsePro'],
  [/^neuropulsepro$/i, 'NeuroPulsePro'],
  [/^neuro\s*pulse$/i, 'NeuroPulsePro'],
  [/^neuropulse$/i, 'NeuroPulsePro'],
  // DigestFlow: vendor escreve "Digest Flow" (D24) e "DigestFlow" (BG) —
  // unifica na grafia canônica.
  [/^digest\s*flow$/i, 'DigestFlow'],
  // ProstaFlow: unifica "ProstaFlow"/"Prostaflow". (NÃO afeta o combo
  // "GlycoPulse + ProstaFlow", que não casa o ^...$ inteiro.)
  [/^prosta\s*flow$/i, 'ProstaFlow'],
  // Duplicatas do filtro de Produto (auditoria prod 2026-08-03) — o mesmo
  // produto grafado diferente por plataforma/era virava 2-3 famílias:
  [/^retra\s*burn$/i, 'RetraBurn'],           // "Retra Burn" (D24) × "RetraBurn"
  [/^mind\s*trex$/i, 'MindTrex'],             // "Mindtrex" (BG) × "MindTrex" (D24)
  [/^evo\s*slim$/i, 'EvoSlim'],               // "Evo Slim" (BG) × "EvoSlim" (D24)
  // "LumiCept"/"Lumicept" (case) + typo BG "Luminacept" → canônica única.
  // "Lumicept Gummies" é produto DISTINTO (formato gummy) — não casa o ^...$
  // e permanece família própria de propósito.
  [/^lumi\s*cept$/i, 'Lumicept'],
  [/^luminacept$/i, 'Lumicept'],
  // Clone TikTok do Cartpanda ("Horse Peak Gelatin - TK") = mesmo produto.
  [/^horse\s*peak\s*gelatin(?:\s*[-–]\s*tk)?$/i, 'Horse Peak Gelatin'],
  // Combo com grafia criativa do vendor ("ImuneGuard + FlexyGuard") —
  // ordem invertida do combo canônico FlexImmuneGuard.
  [/^imm?une\s*guard\s*\+\s*flexy?\s*guard$/i, 'FlexImmuneGuard'],
  // Duplicatas por CAPITALIZAÇÃO entre plataformas (auditoria 2026-08-12): a
  // JVZoo escreve "Memovance Pro"/"Blessed kit" e BG/D24 escrevem
  // "Memovance PRO"/"Blessed Kit" — como o casamento de família é exact-match,
  // viravam duas famílias no filtro E o COGS caía na média global. A canônica
  // é a grafia que JÁ tem ProductFamilyCost cadastrado ("Memovance PRO"),
  // senão a correção quebraria o custo dos 592 pedidos BuyGoods junto.
  [/^memovance\s*pro$/i, 'Memovance PRO'],
  [/^blessed\s*kit$/i, 'Blessed Kit'],
];

export function normalizeFamily(raw: string): string {
  const trimmed = raw.trim();
  for (const [re, canonical] of FAMILY_NORMALIZATIONS) {
    if (re.test(trimmed)) return canonical;
  }
  // Unknown family — keep original spelling (UI will show it as-is).
  return trimmed;
}

// Sufixos de variante (".1", letra — UP1A, UP1.1, DS2.1, DS1a) NÃO mudam a
// posição no funil: são split-tests/clones do MESMO slot. O número que
// importa é o primeiro.
function classifyType(typeCode: string): { type: ProductType; step: number } {
  const code = typeCode.toUpperCase();
  // Frontend: 'FE' (CB) ou 'M\d+' (D24, multi-bottle pack) — com ou sem
  // sufixo de variante.
  if (code === 'FE' || /^M\d+(?:\.\d+)?[A-Z]?$/.test(code)) {
    return { type: 'FRONTEND', step: 1 };
  }
  // Recovery: SMS opt-in flow.
  if (code === 'RC') {
    return { type: 'SMS_RECOVERY', step: 1 };
  }
  // Upsell: UP1=step 2 (após FE), UP2=step 3, UP3=step 4, ...
  // Step indica posição do produto na sequência do funil; permite
  // distinguir UP1 vs UP2 vs UP3 nas agregações sem hardcode.
  const upMatch = code.match(/^UP(\d+)(?:\.\d+)?[A-Z]?$/);
  if (upMatch) {
    return { type: 'UPSELL', step: parseInt(upMatch[1], 10) + 1 };
  }
  // Downsell: DW1=step 2 (após declinar UP1), DW2=step 3, DW3=step 4, ...
  const dwMatch = code.match(/^DW(\d+)(?:\.\d+)?[A-Z]?$/);
  if (dwMatch) {
    return { type: 'DOWNSELL', step: parseInt(dwMatch[1], 10) + 1 };
  }
  // 'DS' (downsell) — mesma escada do DW: DS1=step 2, DS2=step 3, DS3=step 4.
  // Sem número (DS puro) assume o 1º slot (step 2). Sufixos DS1a/DS1b/DS1c e
  // DS1.1/DS2.1 são variantes de preço/clone do MESMO slot.
  // (Antes TODO DS caía em step 2 — DS2/DS3 ficavam na posição errada.)
  const dsMatch = code.match(/^DS(\d+)?(?:\.\d+)?[A-Z]?$/);
  if (dsMatch) {
    const n = dsMatch[1] ? parseInt(dsMatch[1], 10) : 1;
    return { type: 'DOWNSELL', step: n + 1 };
  }
  throw new Error(`classifyProduct: unknown type code "${typeCode}"`);
}

// Resolve type/step do BuyGoods a partir do `rest` (parte do nome após
// "Bottles") e da família. Prioridade:
//   1) "Upgrade N" / "Downsell N" explícito → UP<N> / DW<N>
//   2) "Upgrade" / "Last Chance" sem N (formato antigo) → ancorado na família
//   3) Sem modificador → FE
// O caller já tratou FREE antes (não chega aqui).
// Marcadores NUMERADOS de papel (convenção do vendor, confirmada pelo
// usuário 2026-08-19 pra JVZoo: o funil é SEMPRE UP01/Up02/Up03 +
// Downsell 01/Down 02/Down 03). Aceita zero à esquerda, espaço opcional e
// as variações de grafia: Upgrade/Upsell/UP × Downsell/Down Sell/Down/DS/
// Last Chance. \b nos dois lados evita falso positivo em palavra que
// contém "up"/"ds" ("syrup", "hands"...).
// "OTO N" (one-time offer) é como a JVZoo escreve o upsell no nome REAL do
// IPN desde 2026-08 ("NeuroPulse pro 12 Bottles / OTO1", "Neuro Mind Pro 6
// Bottles / OTO1 - A"). Não estava aqui → 171+ pedidos de OTO1 gravados
// como FRONTEND (auditoria 2026-08-26).
const UP_N_RE = /\b(?:upgrade|upsell|oto|up)\s*0*(\d+)\b/;
const DW_N_RE = /\b(?:down\s*sell|last\s*chance|down|ds)\s*0*(\d+)\b/;
// FE explícito no nome: "NeuroPulse pro 6 Bottles / FE", "... / FE (AFF)".
const FE_MARK_RE = /\bfe\b/;
// Qualquer marcador de papel que o parser sabe ler (sem número também:
// "(Upgrade)", "(Last Chance)", "(Downsell)", FREE, FE).
const ROLE_MARK_RE = /\b(?:upgrade|upsell|oto|up)\s*0*\d+\b|\b(?:down\s*sell|last\s*chance|down|ds)\s*0*\d+\b|last\s*chance|down\s*sell|upgrade|\bfe\b|\bfree\b/i;

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
  return ROLE_MARK_RE.test(n);
}

function buyGoodsType(
  family: string,
  rest: string,
  platform?: string | null,
): { type: ProductType; step: number } {
  const r = rest.toLowerCase();
  // Formato explícito numerado — vale pra "Upgrade 2", "UP01", "Up 02",
  // "Downsell 01", "Down 03", "DS 2", "Last Chance 2".
  const upN = r.match(UP_N_RE);
  if (upN) return classifyType(`UP${parseInt(upN[1], 10)}`);
  const dwN = r.match(DW_N_RE);
  if (dwN) return classifyType(`DW${parseInt(dwN[1], 10)}`);
  // "/ FE" explícito (JVZoo) — antes de "upgrade"/"last chance" por ser o
  // marcador mais específico; nunca coexiste com os outros.
  if (FE_MARK_RE.test(r)) return classifyType('FE');
  // Formato antigo sem N → ancorado na família. "Downsell" NU entra aqui
  // junto com "Last Chance": antes a palavra sozinha não estava em lugar
  // nenhum e caía no FE — 135 pedidos BuyGoods gravados como FRONTEND
  // ("Luminacept 3 Bottles (Downsell)" 129 + "Glyco Pulse 3 Bottles
  // (Downsell)" 6), auditoria 2026-08-12.
  const isDownsell = /last\s*chance|down\s*sell/.test(r);
  const isUpgrade = /upgrade/.test(r);
  if (isDownsell || isUpgrade) {
    if (family === 'NightCalm') return classifyType(isDownsell ? 'DW2' : 'UP2');
    if (family === 'FlexImmuneGuard') return classifyType(isDownsell ? 'DW3' : 'UP3');
    // JVZoo (funil NeuroMind, convenção 2026-08-19): DigestFlow não tem FE
    // lá — "(Upgrade)"/"(Last Chance)" dele é SEMPRE o slot 2 (Up02/Down02).
    // Só na JVZoo: na BuyGoods a mesma família pode ocupar outro slot.
    if (platform === 'jvzoo' && family === 'DigestFlow') {
      return classifyType(isDownsell ? 'DW2' : 'UP2');
    }
    return classifyType(isDownsell ? 'DW1' : 'UP1');
  }
  return classifyType('FE');
}

// Cartpanda classifier. Diferente de CB/D24/BG, o PAPEL no funil (FE/UP/DW +
// etapa) NÃO sai do nome — vem do `up_sell_id` do webhook, lido no connector
// (lib/connectors/cartpanda/ingest.ts). Os nomes usam "Upsell 0X", que o
// classificador genérico do BuyGoods leria errado como FRONTEND. Aqui só
// derivamos a FAMÍLIA (limpa e CONSISTENTE entre o FE e seus upsells, pra o
// funil conectar) + a contagem de potes. O type/step retornados são
// best-effort do nome e servem só de fallback — upsertOrder e
// classifyExistingProducts tratam o Cartpanda como "papel vem do connector"
// e NÃO sobrescrevem productType/funnelStep com o do nome.
//
// Família = 1º segmento antes de " | " (ex "Giant Power | 6 Bottles | Upsell 02"
// → "Giant Power"); sem pipe, remove "N Bottles" + o sufixo "- FE" (ex
// "Horse Peak Gelatin - FE 6 Bottles" → "Horse Peak Gelatin"). Assim o FE
// ("... - FE") e os upsells ("..." puro) caem na MESMA família.
type BaseClassification = Omit<ProductClassification, 'roleMarked'>;

function classifyCartpanda(sku: string, name?: string | null): BaseClassification {
  const raw = (name || sku || '').trim();

  let fam = raw;
  if (fam.includes('|')) {
    fam = fam.split('|')[0];
  } else {
    // Remove a contagem de potes e tudo depois ("... 6 Bottles ...").
    fam = fam.replace(/\s+\d+\s*(?:\+\s*\d+\s*)?bottles?.*$/i, '');
  }
  // Remove o rótulo de frontend "- FE" (e qualquer cauda).
  fam = fam.replace(/\s*[-–]\s*FE\b.*$/i, '').replace(/\s{2,}/g, ' ').trim();
  const family = fam ? normalizeFamily(fam) : null;

  // Potes: "N Bottles" ou combo "N + M Bottles" / "N+M Bottles".
  const bm = raw.match(/(\d+)\s*(?:\+\s*(\d+))?\s*bottles?/i);
  const bottles = bm ? parseInt(bm[1], 10) : null;
  const bonusBottles = bm && bm[2] ? parseInt(bm[2], 10) : null;

  // Papel best-effort do nome (FALLBACK — o connector/up_sell_id é a verdade).
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
// nunca do nome do produto: Cartpanda (up_sell_id). O nome ali não anota o
// papel, então o classificador só é autoritativo pra FAMÍLIA/potes.
// Consumido por upsertOrder e classifyExistingProducts — mudou aqui, vale
// pros dois.
//
// JVZoo SAIU daqui em 2026-08-12. A premissa ("o nome não anota o papel")
// era factualmente falsa: 15 dos 28 SKUs trazem "(Upgrade)" ou "(Last
// Chance)" no nome. Enquanto esteve no set, o papel vinha 100% da POSIÇÃO
// na sessão (jvzooSessions.ts), que só sabe emitir FRONTEND|UPSELL — daí
// DOWNSELL=0 em 3.156 pedidos, Product.productType=FRONTEND em 28/28 SKUs e
// ~55 upsells marcados FRONTEND quando a sessão rachava. Agora o nome manda
// e a posição é o fallback pros SKUs que o classificador não sabe ler.
export const CONNECTOR_ROLE_PLATFORMS = new Set(['cartpanda']);

export function classifyProduct(
  sku: string,
  name?: string | null,
  platform?: string | null,
): ProductClassification {
  const base = classifyProductBase(sku, name, platform);
  return { ...base, roleMarked: hasRoleMarker(sku, name, platform) };
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

  // 2) DigiStore pattern on Name. We split typeFull (e.g. "UP1-vsnova") into
  // typeCode + variant so the same row spelling collapses to the canonical
  // funnel step but keeps the variant for split-test analysis.
  if (name) {
    const d24 = D24_NAME_RE.exec(name.trim());
    if (d24?.groups) {
      const typeFull = d24.groups.typeFull;
      const dashIdx = typeFull.indexOf('-');
      const typeCode = dashIdx === -1 ? typeFull : typeFull.slice(0, dashIdx);
      const variant = dashIdx === -1 ? null : typeFull.slice(dashIdx + 1);
      const t = classifyType(typeCode);
      return {
        family: normalizeFamily(d24.groups.family),
        type: t.type,
        funnelStep: t.step,
        variant,
        bottles: parseInt(d24.groups.bottles, 10),
        bonusBottles: d24.groups.bonus ? parseInt(d24.groups.bonus, 10) : null,
      };
    }
  }

  // 3) BuyGoods: nome em linguagem natural. Roda DEPOIS de CB/D24 (que têm
  // formatos próprios) — só pega o que sobrou.
  //
  // FONTE DE VERDADE = NOME (não codename). Codenames BuyGoods colidem
  // entre produtos (NeuroMindPro/NeuroPulse compartilham slugs), então a
  // classificação tem que vir do nome humano.
  //
  // CONVENÇÃO NOVA (vendor): "(Upgrade N)" / "(Downsell N)" com N explícito.
  // FREE em qualquer lugar do nome → SMS_RECOVERY (recuperação por email/SMS).
  // Sem marcador → FRONTEND. Família vem da parte antes da contagem de potes.
  if (name) {
    const trimmed = name.trim();
    // FREE detection: word boundary, case-insensitive — pega "FREE", "free",
    // "Free Bottle", "FREE Shipping" etc. mas não palavras como "freeze".
    const isFree = /\bfree\b/i.test(trimmed);
    // Pra extrair família/potes, remove FREE temporariamente (pra não poluir
    // o grupo `family` da regex).
    const cleanedForParse = isFree
      ? trimmed.replace(/\bfree\b/gi, ' ').replace(/\s+/g, ' ').trim()
      : trimmed;
    const bg = BUYGOODS_NAME_RE.exec(cleanedForParse);
    if (bg?.groups) {
      const family = normalizeFamily(
        bg.groups.family.replace(/\s+/g, ' ').trim(),
      );
      const bottles = parseInt(bg.groups.b1, 10);
      const bonusBottles = bg.groups.b2 ? parseInt(bg.groups.b2, 10) : null;
      const rest = bg.groups.rest || '';
      // FREE no nome → recuperação (email/SMS). Override de qualquer marcador.
      const t = isFree
        ? classifyType('RC')
        : buyGoodsType(family, rest, platform);
      return {
        family: family || null,
        type: t.type,
        funnelStep: t.step,
        variant: null,
        bottles,
        bonusBottles,
      };
    }

    // Combo com potes abreviados ("FlexGuard 3B+ ImmuneGuard 3B (Upgrade)").
    // Só chega aqui quem não tem a palavra "Bottles" — ver COMBO_ABBREV_RE.
    const combo = COMBO_ABBREV_RE.exec(trimmed);
    if (combo?.groups) {
      const famA = combo.groups.famA.replace(/\s+/g, ' ').trim();
      const famB = combo.groups.famB.replace(/\s+/g, ' ').trim();
      // Normaliza o par inteiro: "FlexGuard + ImmuneGuard" tem regra de combo
      // (→ FlexImmuneGuard, com custo cadastrado). Pares sem regra ficam com
      // o nome composto — família própria, que é o que eles são de fato.
      const family = normalizeFamily(`${famA} + ${famB}`);
      const t = buyGoodsType(family, combo.groups.rest || '', platform);
      return {
        family: family || null,
        type: t.type,
        funnelStep: t.step,
        variant: null,
        bottles: parseInt(combo.groups.b1, 10),
        bonusBottles: parseInt(combo.groups.b2, 10),
      };
    }

    // Combo com a CONTAGEM NA FRENTE — convenção JVZoo do bundle de 3
    // produtos ("1 Flex Guard + 1 Night Calm + 1 Honey Flush (Upgrade)").
    // Nenhuma regex anterior casa (não há a palavra "Bottles" nem o "NB"
    // colado), então esses nomes caíam no fallback cego: família null →
    // COGS $0 e, pior, "(LastChance)" lido como UPSELL. Pela convenção do
    // funil (2026-08-19: UP01/Up02/Up03 + Down01/02/03), o bundle triplo é
    // o SLOT 3 quando o marcador não traz número.
    const cf = COMBO_COUNT_FIRST_RE.exec(trimmed);
    if (cf?.groups) {
      const items = cf.groups.items.split('+').map((part) => {
        const m = part.trim().match(/^(\d+)\s+(.+)$/);
        return m ? { n: parseInt(m[1], 10), name: m[2].trim() } : null;
      }).filter((x): x is { n: number; name: string } => x !== null);
      if (items.length >= 2) {
        const family = items.map((i) => normalizeFamily(i.name)).join(' + ');
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
        };
      }
    }
  }

  // 4) No match — cross-sell or non-canonical naming. O papel ainda pode
  // estar ANOTADO no nome mesmo quando a família não é parseável — ler o
  // marcador aqui evita o pior caso do fallback cego ("(LastChance)" de um
  // SKU não reconhecido virando UPSELL, 30 pedidos JVZoo em 2026-08-19).
  // Sem marcador nenhum, mantém o default histórico: UPSELL sem etapa
  // (SKU desconhecido é mais provável backend que porta de entrada).
  if (name) {
    const raw = name.toLowerCase();
    const dwN = raw.match(DW_N_RE);
    if (dwN) {
      const t = classifyType(`DW${parseInt(dwN[1], 10)}`);
      return { family: null, type: t.type, funnelStep: t.step, variant: null, bottles: null, bonusBottles: null };
    }
    // "/ FE" explícito num nome fora de padrão → porta de entrada mesmo assim.
    if (FE_MARK_RE.test(raw)) {
      return { family: null, type: 'FRONTEND', funnelStep: 1, variant: null, bottles: null, bonusBottles: null };
    }
    if (/last\s*chance|down\s*sell/.test(raw)) {
      return { family: null, type: 'DOWNSELL', funnelStep: null, variant: null, bottles: null, bonusBottles: null };
    }
    const upN = raw.match(UP_N_RE);
    if (upN) {
      const t = classifyType(`UP${parseInt(upN[1], 10)}`);
      return { family: null, type: t.type, funnelStep: t.step, variant: null, bottles: null, bonusBottles: null };
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
