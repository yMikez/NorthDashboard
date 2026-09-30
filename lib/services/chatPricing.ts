// Preço por token dos modelos do chat — base do costUsd da telemetria
// (ChatTurnLog) e do custo por caso do eval.
//
// Valores em US$ por MILHÃO de tokens (tabela oficial da API, conferida em
// 2026-09). Cache: leitura = 0,1× o preço de entrada, salvo modelo com preço
// próprio de leitura (Opus 5.5: $0,20, metade do 0,1×); escrita (TTL 5 min,
// o único que o chat usa) = 1,25×. `input_tokens` da API já vem SEM os
// tokens de cache — as três parcelas somam, não se sobrepõem.
//
// Match por PREFIXO do id servido: a API devolve ids com sufixo de data
// (claude-haiku-4-5-20251001). Ordem importa: 'claude-opus-5-5' antes de
// 'claude-opus-5', senão o 5.5 sairia cobrado como 5.

export interface ModelPricing {
  /** US$ por MTok de entrada (sem cache). */
  inputPerMTok: number;
  /** US$ por MTok de saída (inclui thinking). */
  outputPerMTok: number;
  /** Leitura de cache com preço próprio (senão 0,1× a entrada). */
  cacheReadPerMTok?: number;
}

export interface UsageTokens {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_WRITE_MULTIPLIER = 1.25;

const PRICING: ReadonlyArray<readonly [prefix: string, pricing: ModelPricing]> = [
  ['claude-opus-5-5', { inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.2 }],
  ['claude-opus-5', { inputPerMTok: 5, outputPerMTok: 25 }],
  ['claude-sonnet-5', { inputPerMTok: 2, outputPerMTok: 10 }],
  ['claude-haiku-4-5', { inputPerMTok: 1, outputPerMTok: 5 }],
];

/** Preço do modelo, ou null se desconhecido (custo fica null, nunca chutado). */
export function pricingFor(model: string | null | undefined): ModelPricing | null {
  const id = (model ?? '').trim().toLowerCase();
  if (!id) return null;
  for (const [prefix, p] of PRICING) {
    // Prefixo exato OU prefixo + '-sufixo' — 'claude-opus-5' não pode casar
    // 'claude-opus-50' se um dia existir.
    if (id === prefix || id.startsWith(`${prefix}-`)) return p;
  }
  return null;
}

/** Custo em US$ de UMA chamada (uma rodada do loop). null = modelo sem preço. */
export function usageCostUsd(model: string | null | undefined, u: UsageTokens): number | null {
  const p = pricingFor(model);
  if (!p) return null;
  const inRate = p.inputPerMTok / 1_000_000;
  const outRate = p.outputPerMTok / 1_000_000;
  const readRate = p.cacheReadPerMTok !== undefined ? p.cacheReadPerMTok / 1_000_000 : inRate * CACHE_READ_MULTIPLIER;
  return (
    (u.input_tokens || 0) * inRate +
    (u.cache_read_input_tokens || 0) * readRate +
    (u.cache_creation_input_tokens || 0) * inRate * CACHE_WRITE_MULTIPLIER +
    (u.output_tokens || 0) * outRate
  );
}

/**
 * Custo do turno = Σ rodadas, cada uma no modelo que REALMENTE serviu
 * (round.model; fallback pro pedido). Se alguma rodada tem modelo sem preço,
 * o total é null — custo parcial apresentado como total engana o painel.
 */
export function roundsCostUsd(
  rounds: ReadonlyArray<{ model?: string | null; usage: UsageTokens }>,
  requestedModel?: string | null,
): number | null {
  let total = 0;
  for (const r of rounds) {
    const c = usageCostUsd(r.model || requestedModel, r.usage);
    if (c == null) return null;
    total += c;
  }
  return Math.round(total * 1_000_000) / 1_000_000;
}
