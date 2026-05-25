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

// DigiStore name pattern. Accepts type variants like "UP1-V1" or "UP1-vsnova"
// e a forma de recovery "RC - Glyco Pulse (6 + 2 Bottles)" onde "+ 2" é
// bonus. Family character class agora aceita hífen (Flex-ImmuneGuard) e
// dígitos no meio (caso futuro). Type group também genérico.
const D24_NAME_RE =
  /^(?<typeFull>M\d+|UP\d+(?:-[A-Za-z0-9]+)?|DW\d+(?:-[A-Za-z0-9]+)?|DS\d*|RC)\s*-\s*(?<family>[A-Za-z][A-Za-z0-9 \-]+?)\s*\((?<bottles>\d+)(?:\s*\+\s*(?<bonus>\d+))?\s*Bottles?\)$/i;

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
];

export function normalizeFamily(raw: string): string {
  const trimmed = raw.trim();
  for (const [re, canonical] of FAMILY_NORMALIZATIONS) {
    if (re.test(trimmed)) return canonical;
  }
  // Unknown family — keep original spelling (UI will show it as-is).
  return trimmed;
}

function classifyType(typeCode: string): { type: ProductType; step: number } {
  const code = typeCode.toUpperCase();
  // Frontend: 'FE' (CB) ou 'M\d+' (D24, multi-bottle pack).
  if (code === 'FE' || /^M\d+$/.test(code)) {
    return { type: 'FRONTEND', step: 1 };
  }
  // Recovery: SMS opt-in flow.
  if (code === 'RC') {
    return { type: 'SMS_RECOVERY', step: 1 };
  }
  // Upsell: UP1=step 2 (após FE), UP2=step 3, UP3=step 4, ...
  // Step indica posição do produto na sequência do funil; permite
  // distinguir UP1 vs UP2 vs UP3 nas agregações sem hardcode.
  const upMatch = code.match(/^UP(\d+)$/);
  if (upMatch) {
    return { type: 'UPSELL', step: parseInt(upMatch[1], 10) + 1 };
  }
  // Downsell: DW1=step 2 (após declinar UP1), DW2=step 3, DW3=step 4, ...
  const dwMatch = code.match(/^DW(\d+)$/);
  if (dwMatch) {
    return { type: 'DOWNSELL', step: parseInt(dwMatch[1], 10) + 1 };
  }
  // Legacy 'DS' (downsell sem número) — mantém step=2 como antes.
  if (/^DS\d*$/.test(code)) {
    return { type: 'DOWNSELL', step: 2 };
  }
  throw new Error(`classifyProduct: unknown type code "${typeCode}"`);
}

// Resolve type/step do BuyGoods a partir do `rest` (parte do nome após
// "Bottles") e da família. Prioridade:
//   1) "Upgrade N" / "Downsell N" explícito → UP<N> / DW<N>
//   2) "Upgrade" / "Last Chance" sem N (formato antigo) → ancorado na família
//   3) Sem modificador → FE
// O caller já tratou FREE antes (não chega aqui).
function buyGoodsType(
  family: string,
  rest: string,
): { type: ProductType; step: number } {
  const r = rest.toLowerCase();
  // Formato novo explícito: "Upgrade N" / "Downsell N" (N=1..9).
  const upN = r.match(/upgrade\s*(\d+)/);
  if (upN) return classifyType(`UP${parseInt(upN[1], 10)}`);
  const dwN = r.match(/(?:downsell|down\s*sell|last\s*chance\s*(\d+))\s*(\d+)/);
  // Captura "Downsell N" ou "Last Chance N" (ambos formatos suportados).
  if (dwN) {
    const num = dwN[1] || dwN[2];
    if (num) return classifyType(`DW${parseInt(num, 10)}`);
  }
  // Formato antigo: "Upgrade" / "Last Chance" sem N → ancorado na família.
  const isLastChance = /last\s*chance/.test(r);
  const isUpgrade = /upgrade/.test(r);
  if (isLastChance || isUpgrade) {
    if (family === 'NightCalm') return classifyType(isLastChance ? 'DW2' : 'UP2');
    if (family === 'FlexImmuneGuard') return classifyType(isLastChance ? 'DW3' : 'UP3');
    return classifyType(isLastChance ? 'DW1' : 'UP1');
  }
  return classifyType('FE');
}

export function classifyProduct(
  sku: string,
  name?: string | null,
): ProductClassification {
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
        : buyGoodsType(family, rest);
      return {
        family: family || null,
        type: t.type,
        funnelStep: t.step,
        variant: null,
        bottles,
        bonusBottles,
      };
    }
  }

  // 4) No match — cross-sell or non-canonical naming. Caller decides what to
  // do; we keep the existing productType assignment by returning UPSELL as a
  // safe default (anything that wasn't recognized is most likely a backend
  // SKU rather than a frontend entry point).
  return {
    family: null,
    type: 'UPSELL',
    funnelStep: null,
    variant: null,
    bottles: null,
    bonusBottles: null,
  };
}
