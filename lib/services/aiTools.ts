// Definições das tools que o assistente IA pode chamar.
// Cada tool mapeia 1:1 pra um service existente em metrics.ts +
// insights.ts. Tool calls são server-side — modelo recebe schemas,
// emite tool_use blocks, servidor executa e devolve tool_result.
//
// Filtros: todos aceitam start_date/end_date (ISO 8601 date string).
// platforms/countries/families são opcionais. Sem filtros padrão é
// "últimos 30 dias", populado pelo /api/chat ao executar.

import type Anthropic from '@anthropic-ai/sdk';
import {
  getOverview,
  getAffiliates,
  getAffiliateDetail,
  getFunnel,
  getProducts,
  getOrders,
  type MetricsFilters,
} from './metrics';
import { getInsights } from './insights';

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_overview',
    description: 'Retorna KPIs globais do dashboard pro período: receita, pedidos, aprovação, refund, AOV, lucro estimado, top países, top afiliados, tipos de produto, série diária, heatmap por hora.',
    input_schema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'Data início (YYYY-MM-DD)' },
        end_date: { type: 'string', description: 'Data fim (YYYY-MM-DD)' },
        platforms: { type: 'array', items: { type: 'string' }, description: 'Filtrar plataformas: clickbank | digistore24' },
        countries: { type: 'array', items: { type: 'string' }, description: 'Filtrar países (ISO 2 letras)' },
        families: { type: 'array', items: { type: 'string' }, description: 'Filtrar famílias: NeuroMindPro, GlycoPulse, ThermoBurnPro, MaxVitalize, FlexImmuneGuard, NightCalm' },
      },
      required: ['start_date', 'end_date'],
    },
  },
  {
    name: 'get_affiliates',
    description: 'Lista todos os afiliados do período com métricas: receita, pedidos, aprovação, refund, CPA, lucro direto vs lucro atribuído à sessão, AOV, sparkline 30d, LTV.',
    input_schema: {
      type: 'object',
      properties: {
        start_date: { type: 'string' },
        end_date: { type: 'string' },
        platforms: { type: 'array', items: { type: 'string' } },
        countries: { type: 'array', items: { type: 'string' } },
        families: { type: 'array', items: { type: 'string' } },
      },
      required: ['start_date', 'end_date'],
    },
  },
  {
    name: 'get_affiliate_detail',
    description: 'Detalhe profundo de UM afiliado específico (drill-down): KPIs, série diária, por-produto, por-país, flags automáticas, LTV. Use quando o usuário pergunta sobre um afiliado nominado (ex: "nitrocompany", "fenix2025").',
    input_schema: {
      type: 'object',
      properties: {
        external_id: { type: 'string', description: 'Nickname/externalId do afiliado (ex: nitrocompany, adsmkt9)' },
        start_date: { type: 'string' },
        end_date: { type: 'string' },
      },
      required: ['external_id', 'start_date', 'end_date'],
    },
  },
  {
    name: 'get_funnel',
    description: 'Funil de conversão por família: stages (FE → UP1 → UP2 → UP3 → DW1 → DW2 → DW3) com take rate e revenue. Inclui cross-sell por família. Decisão: cross-sells contam no funil da família FE.',
    input_schema: {
      type: 'object',
      properties: {
        start_date: { type: 'string' },
        end_date: { type: 'string' },
        platforms: { type: 'array', items: { type: 'string' } },
        countries: { type: 'array', items: { type: 'string' } },
        families: { type: 'array', items: { type: 'string' } },
      },
      required: ['start_date', 'end_date'],
    },
  },
  {
    name: 'get_products',
    description: 'Lista SKUs com métricas de performance: receita, pedidos, refund, CB, margem direta e atribuída ao funil, lucro. Use pra responder sobre produtos específicos ou comparar SKUs.',
    input_schema: {
      type: 'object',
      properties: {
        start_date: { type: 'string' },
        end_date: { type: 'string' },
        platforms: { type: 'array', items: { type: 'string' } },
        families: { type: 'array', items: { type: 'string' } },
      },
      required: ['start_date', 'end_date'],
    },
  },
  {
    name: 'get_orders',
    description: 'Lista de pedidos individuais paginados. Útil pra investigar transações específicas (ex: "me mostre os refunds da última semana"). Default limit 100, max 500.',
    input_schema: {
      type: 'object',
      properties: {
        start_date: { type: 'string' },
        end_date: { type: 'string' },
        status: { type: 'string', enum: ['APPROVED', 'REFUNDED', 'CHARGEBACK', 'PENDING', 'CANCELED'] },
        platforms: { type: 'array', items: { type: 'string' } },
        countries: { type: 'array', items: { type: 'string' } },
        families: { type: 'array', items: { type: 'string' } },
        limit: { type: 'integer', default: 100 },
        offset: { type: 'integer', default: 0 },
      },
      required: ['start_date', 'end_date'],
    },
  },
  {
    name: 'get_insights',
    description: 'Retorna os 27 insights automáticos já computados (profit/affiliates/funnel/operations). Use quando o usuário pergunta "o que tá rolando hoje?" ou similar, ou pra responder rapidamente sem precisar consultar dados crus.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
];

interface ToolInput {
  start_date?: string;
  end_date?: string;
  platforms?: string[];
  countries?: string[];
  families?: string[];
  external_id?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

function parseFilters(input: ToolInput): MetricsFilters {
  return {
    startDate: input.start_date ? new Date(input.start_date) : new Date(Date.now() - 30 * 24 * 3600 * 1000),
    endDate: input.end_date ? new Date(input.end_date) : new Date(),
    platformSlugs: input.platforms,
    countries: input.countries,
    productFamilies: input.families,
  };
}

/**
 * Executor de tool calls. Recebe nome + input do tool_use block, devolve
 * o resultado da chamada ao service correspondente. Catch genérico:
 * qualquer falha vira string de erro que o modelo pode interpretar.
 */
export async function executeTool(name: string, input: ToolInput): Promise<unknown> {
  try {
    switch (name) {
      case 'get_overview':
        return await getOverview(parseFilters(input));
      case 'get_affiliates': {
        const data = await getAffiliates(parseFilters(input));
        // Cortar pra evitar payload gigante voltando pro modelo.
        // Modelo lê top 30 por receita; suficiente pra análise.
        return {
          summary: data.summary,
          affiliates: data.affiliates.slice(0, 30),
          totalCount: data.affiliates.length,
        };
      }
      case 'get_affiliate_detail':
        if (!input.external_id) return { error: 'external_id obrigatório' };
        return await getAffiliateDetail(input.external_id, parseFilters(input));
      case 'get_funnel':
        return await getFunnel(parseFilters(input));
      case 'get_products': {
        const data = await getProducts(parseFilters(input));
        return {
          byType: data.byType,
          products: data.products.slice(0, 50),
          totalCount: data.products.length,
        };
      }
      case 'get_orders': {
        const data = await getOrders(parseFilters(input), {
          status: input.status as 'APPROVED' | 'REFUNDED' | 'CHARGEBACK' | 'PENDING' | 'CANCELED' | undefined,
          limit: Math.min(input.limit ?? 100, 500),
          offset: input.offset ?? 0,
        });
        return data;
      }
      case 'get_insights':
        return await getInsights();
      default:
        return { error: `tool desconhecida: ${name}` };
    }
  } catch (err) {
    return {
      error: 'tool_execution_failed',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
