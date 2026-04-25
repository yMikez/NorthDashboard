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
}

// "2e1" / "3e1" / "6e2" formats appear on RC (recovery) SKUs in the CB CSV.
// They mean "{primary} bottles + {bonus} bottles" as one combo offer. We
// surface the primary count as `bottles`; the bonus is dropped since downstream
// analytics treat the SKU as a single unit anyway.
const CB_SKU_RE =
  /^(?<family>[A-Za-z]+)-(?<bottles>\d+)(?:e\d+)?-(?<type>FE|UP1|UP2|DW1|DS1|RC)(?:-(?<variant>[A-Za-z0-9]+))?$/i;

// DigiStore name pattern. Accepts type variants like "UP1-V1" or "UP1-vsnova"
// and also the recovery format "RC - Glyco Pulse (6 + 2 Bottles)" where bottle
// count uses the first number.
const D24_NAME_RE =
  /^(?<typeFull>M[123]|UP[12](?:-[A-Za-z0-9]+)?|DW1|DS1|RC)\s*-\s*(?<family>[A-Za-z][A-Za-z ]+?)\s*\((?<bottles>\d+)(?:\s*\+\s*\d+)?\s*Bottles?\)$/i;

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
  switch (code) {
    case 'FE':
    case 'M1':
    case 'M2':
    case 'M3':
      return { type: 'FRONTEND', step: 1 };
    case 'UP1':
      return { type: 'UPSELL', step: 2 };
    case 'UP2':
      return { type: 'UPSELL', step: 3 };
    case 'DW1':
    case 'DS1':
      return { type: 'DOWNSELL', step: 2 };
    case 'RC':
      return { type: 'SMS_RECOVERY', step: 1 };
    default:
      throw new Error(`classifyProduct: unknown type code "${typeCode}"`);
  }
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
  };
}
