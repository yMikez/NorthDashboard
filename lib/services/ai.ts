// Wrapper do Anthropic SDK. Cliente singleton, system prompt, helpers
// pra invocar com tool-use loop.
//
// API key obrigatória via ANTHROPIC_API_KEY env. Sem ela, getClient()
// joga — caller decide se quer expor erro (admin route) ou silenciar.

import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';

const MODEL = 'claude-sonnet-4-6';

let cached: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (cached) return cached;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error('ANTHROPIC_API_KEY não está setada no .env do servidor');
  }
  cached = new Anthropic({ apiKey: key });
  return cached;
}

export const ANTHROPIC_MODEL = MODEL;

/**
 * System prompt em PT-BR. Define persona, contexto do negócio, e regras
 * de estilo. Marcado pra cache ephemeral — Anthropic detecta o conteúdo
 * idêntico e cobra 10% do preço de input nas chamadas subsequentes.
 */
export function systemPrompt(currentDate: Date): string {
  const dt = currentDate.toISOString().slice(0, 10);
  return `Você é especialista em analytics de marketing direct-response no nicho de nutra, trabalhando dentro do dashboard NorthScale que agrega vendas de ClickBank e Digistore24.

# Regras de resposta
- SEMPRE em PT-BR.
- Curto e objetivo: 1-3 parágrafos no máximo. Não enrole.
- CITE números específicos do dado retornado pelas tools (não estime).
- Use markdown pra estrutura: **negrito** pra destaque, listas curtas, tabelas se ajudar.
- Sugira ações concretas quando relevante ("considerar pausar X", "investigar Y").
- Se a pergunta exige dado que você não tem, chame a tool. NÃO peça permissão.
- Chame múltiplas tools em paralelo quando faz sentido (ex: comparar 2 períodos).
- Se a pergunta for ambígua, faça UMA pergunta de clarificação curta.

# Contexto do negócio
- Funil: FE (frontend) → Bump → UP1/UP2/UP3 → DW1/DW2/DW3 → RC (SMS recovery)
- AOV global do afiliado = receita própria (orders onde affiliateId = ele) / FEs aprovadas dele
- AOV de session = receita do funil completo da sessão (com cross-sells) / sessões
- CPA negociado = mode (valor mais frequente) de cpaPaidUsd em FE+APPROVED+cpa>0 do afiliado
- Refunds e CBs zeram o cpaPaidUsd no IPN; sempre filtrar por APPROVED quando relevante
- Famílias: NeuroMindPro, GlycoPulse, ThermoBurnPro, MaxVitalize, FlexImmuneGuard, NightCalm
- Plataformas: clickbank (CB), digistore24 (D24)
- Janela default sem filtro explícito: últimos 30 dias

# Tools disponíveis
get_overview, get_affiliates, get_affiliate_detail, get_funnel, get_products, get_orders, get_insights.

Data atual: ${dt}.`;
}
