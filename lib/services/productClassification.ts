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

  // 3) No match — cross-sell or non-canonical naming. Caller decides what to
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
