// Serialização de AffiliateCopyRule pro JSON da API admin (Decimal→number,
// Date→ISO). Usado pelas rotas de list/create/patch pra resposta consistente.

import type { AffiliateCopyRule } from '@prisma/client';

export interface SerializedRule {
  id: string;
  key: string;
  keyType: string;
  black2Pct: number;
  enabled: boolean;
  autotune: boolean;
  minPct: number;
  maxPct: number;
  stepPct: number;
  targetAov: number | null;
  updatedBy: string;
  updatedAt: string;
  createdAt: string;
}

export function serializeRule(r: AffiliateCopyRule): SerializedRule {
  return {
    id: r.id,
    key: r.key,
    keyType: r.keyType,
    black2Pct: r.black2Pct,
    enabled: r.enabled,
    autotune: r.autotune,
    minPct: r.minPct,
    maxPct: r.maxPct,
    stepPct: r.stepPct,
    targetAov: r.targetAov != null ? Number(r.targetAov) : null,
    updatedBy: r.updatedBy,
    updatedAt: r.updatedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  };
}
