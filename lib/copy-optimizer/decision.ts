// Decisão de copy — lógica PURA (sem I/O), testável isoladamente.
//
// Dado o conjunto de regras + identidade do lead (aff_id/aff_name/email),
// decide qual layer mostrar. É o equivalente server-side do decideLayer()
// que rodava no js/utm-webhook.js — mas agora as regras nunca saem do servidor.

import { hashToBucket } from './bucket';

export type CopyLayer = 'white' | 'black1' | 'black2' | 'loading';

export const COPY_LAYERS: readonly CopyLayer[] = ['white', 'black1', 'black2', 'loading'];

export function isCopyLayer(v: string): v is CopyLayer {
  return (COPY_LAYERS as readonly string[]).includes(v);
}

/** Subset de AffiliateCopyRule que a decisão precisa. */
export interface CopyRule {
  key: string;
  keyType: string; // 'id' | 'name'
  black2Pct: number;
  enabled: boolean;
}

export interface DecisionInput {
  orderIdGlobal: string;
  affId: string | null;
  affName: string | null;
  emailValid: boolean;
  rules: CopyRule[];
  /** Layer servido quando o lead NÃO cai em Black 2 (default 'black1'). */
  defaultLayer?: CopyLayer;
}

export interface Decision {
  layer: CopyLayer;
  /** Bucket djb2 quando uma regra com pct>0 se aplicou; null caso contrário. */
  bucket: number | null;
  /** black2Pct resolvido (0 se nenhuma regra casou). */
  pctApplied: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return EMAIL_RE.test(email.trim());
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.trunc(n)));
}

/**
 * Maior black2Pct entre regras HABILITADAS que casam aff_id OU aff_name.
 * "Mais inclusivo vence": se um afiliado bate por id (50%) e por name (80%),
 * vale 80%. Regra com enabled=false é ignorada.
 */
export function resolvePct(
  rules: CopyRule[],
  affId: string | null,
  affName: string | null,
): number {
  let pct = 0;
  for (const r of rules) {
    if (!r.enabled) continue;
    const matches =
      (affId != null && r.key === affId) || (affName != null && r.key === affName);
    if (matches) pct = Math.max(pct, clampPct(r.black2Pct));
  }
  return pct;
}

/**
 * Decide o layer. Black 2 só quando: existe regra casando com pct>0, o email
 * é válido, E o bucket sticky cai dentro do percentual (bucket < pct).
 * Qualquer outro caso → defaultLayer (black1).
 */
export function decideLayer(input: DecisionInput): Decision {
  const fallback = input.defaultLayer ?? 'black1';
  const pct = resolvePct(input.rules, input.affId, input.affName);

  if (pct <= 0 || !input.emailValid) {
    return { layer: fallback, bucket: null, pctApplied: pct };
  }

  const bucket = hashToBucket(input.orderIdGlobal);
  const qualifies = bucket >= 0 && bucket < pct;
  return {
    layer: qualifies ? 'black2' : fallback,
    bucket,
    pctApplied: pct,
  };
}
