// Checagem de números dos blocos (respond_with_blocks) contra o que as
// tools devolveram de fato no turno (ResultStore + contas do calc).
// ESQUELETO da fundação — preenchido pela unidade de precisão.

import type { ResultStore } from './resultStore';

export interface GroundingReport {
  /** Números exibidos que não batem com nenhum resultado (texto como aparece). */
  unmatched: string[];
  /** Quantos números foram conferidos. */
  checked: number;
}

export function verifyBlockNumbers(_blocks: unknown, _store: ResultStore): GroundingReport {
  return { unmatched: [], checked: 0 };
}
