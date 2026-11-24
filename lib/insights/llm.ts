// Chamada única à IA pras leituras fora do chat (briefing da Visão geral e
// decisões do ClickUp): uma pergunta, resposta em JSON validado por esquema.
//
// - Modelo: ANTHROPIC_INSIGHTS_MODEL (Opus 5.5 por padrão). No Opus 5.5 o
//   raciocínio é sempre adaptativo — o controle é o esforço (padrão dele é
//   medium; passamos sempre explícito).
// - Saída estruturada (output_config.format + zod): nada de "extrair JSON
//   do texto".
// - Recusa por política: fallback no servidor (beta server-side-fallback),
//   que reexecuta no modelo certo pra categoria. O SDK instalado (0.95) ainda
//   não tipa `fallbacks`, mas repassa o campo no corpo — por isso o cast.

import type { ZodType, infer as zodInfer } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { ANTHROPIC_INSIGHTS_MODEL, getAnthropicClient } from '../services/ai';
import { logger } from '../logger';

export class InsightsRefusedError extends Error {
  constructor(public category: string | null) {
    super(`a IA recusou (${category ?? 'sem categoria'})`);
    this.name = 'InsightsRefusedError';
  }
}

export interface StructuredResult<T> {
  data: T;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export async function askStructured<S extends ZodType>(opts: {
  system: string;
  user: string;
  schema: S;
  effort?: 'low' | 'medium' | 'high';
  maxTokens?: number;
  label: string;
}): Promise<StructuredResult<zodInfer<S>>> {
  const client = getAnthropicClient();
  const params = {
    model: ANTHROPIC_INSIGHTS_MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    system: opts.system,
    messages: [{ role: 'user' as const, content: opts.user }],
    output_config: { effort: opts.effort ?? 'medium', format: betaZodOutputFormat(opts.schema) },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  };
  const res = await client.beta.messages.parse(params as typeof params & Parameters<typeof client.beta.messages.parse>[0]);
  if (res.stop_reason === 'refusal') {
    const details = (res as { stop_details?: { category?: string | null } | null }).stop_details;
    throw new InsightsRefusedError(details?.category ?? null);
  }
  if (res.stop_reason === 'max_tokens') throw new Error(`${opts.label}: resposta cortada (max_tokens)`);
  const data = res.parsed_output as zodInfer<S> | null;
  if (data == null) throw new Error(`${opts.label}: a IA não devolveu o JSON esperado`);
  logger.info({
    label: opts.label, model: res.model, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens,
  }, 'insights.llm');
  return { data, model: res.model, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
}
