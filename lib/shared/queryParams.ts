// Helpers comuns pra parsing de query params dos endpoints /api/metrics/*.
// Mantém o boilerplate fora dos route handlers.

import type { ProductType } from '@prisma/client';

const VALID_PRODUCT_TYPES = new Set<ProductType>([
  'FRONTEND',
  'UPSELL',
  'DOWNSELL',
  'BUMP',
  'SMS_RECOVERY',
]);

/**
 * Parse CSV → array of trimmed non-empty strings, or undefined se vazio.
 */
export function csvParam(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : undefined;
}

/**
 * `affiliate_id` (CSV) — affiliate_id do sistema NorthScale Afiliados
 * (Order.mappedAffiliateId). Só ids "cuid-like"/seguros: letras, dígitos,
 * `_` e `-` (o valor vai parametrizado no SQL de qualquer forma; a
 * restrição só evita lixo no cache de resposta).
 */
export function affiliateIdsParam(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  const out = new Set<string>();
  for (const s of raw.split(',').map((x) => x.trim()).filter(Boolean)) {
    if (/^[A-Za-z0-9_-]{1,64}$/.test(s)) out.add(s);
  }
  return out.size ? Array.from(out) : undefined;
}

/**
 * Parse o `stages` query param em ProductType[]. Aceita tanto os enum
 * values (FRONTEND, UPSELL, ...) quanto os labels em PT-BR usados no UI
 * (front, upsell, downsell, recuperacao/recuperação). Case-insensitive.
 * Valores inválidos são silenciosamente descartados.
 */
export function stagesParam(raw: string | null): ProductType[] | undefined {
  if (!raw) return undefined;
  const out: ProductType[] = [];
  const seen = new Set<ProductType>();
  for (const s of raw.split(',').map((x) => x.trim()).filter(Boolean)) {
    const upper = s.toUpperCase();
    let mapped: ProductType | null = null;
    if (upper === 'FRONT' || upper === 'FRONTEND' || upper === 'FE') {
      mapped = 'FRONTEND';
    } else if (upper === 'UPSELL' || upper === 'UP') {
      mapped = 'UPSELL';
    } else if (upper === 'DOWNSELL' || upper === 'DW' || upper === 'DS') {
      mapped = 'DOWNSELL';
    } else if (upper === 'BUMP') {
      mapped = 'BUMP';
    } else if (
      upper === 'RECUPERACAO'
      || upper === 'RECUPERAÇÃO'
      || upper === 'RECOVERY'
      || upper === 'SMS_RECOVERY'
      || upper === 'RC'
    ) {
      mapped = 'SMS_RECOVERY';
    }
    if (mapped && VALID_PRODUCT_TYPES.has(mapped) && !seen.has(mapped)) {
      seen.add(mapped);
      out.push(mapped);
    }
  }
  return out.length ? out : undefined;
}
