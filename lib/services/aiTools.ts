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
import { refreshDailyMetricsNow } from './dailyMetrics';
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
        platforms: { type: 'array', items: { type: 'string' }, description: 'Filtrar plataformas: clickbank | digistore24 | buygoods' },
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
  {
    name: 'respond_with_blocks',
    description:
      'Tool TERMINAL pra entregar a resposta final em blocos estruturados (cards de KPI, insights, tabelas, charts) em vez de markdown puro. Use SEMPRE que a resposta contém ≥3 números OU lista ≥4 itens OU comparações entre entidades — quando o leitor vai escanear visualmente em vez de ler. Para perguntas curtas/conversa, NÃO use — responda em markdown direto. Chame essa tool no FIM, depois de coletar dados via get_*. Blocos disponíveis: summary (KPIs hero), insights (cartões coloridos com severity), table (linhas/colunas tipadas), markdown (parágrafo de texto), chart (line/bar/area).',
    input_schema: {
      type: 'object',
      properties: {
        blocks: {
          type: 'array',
          description: 'Array ordenado de blocos a renderizar.',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['summary', 'insights', 'table', 'markdown', 'chart'],
              },
              // summary
              title: { type: 'string' },
              kpis: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string' },
                    value: { type: 'string', description: 'Valor formatado, ex "$ 154.318" ou "12,4%"' },
                    delta: {
                      type: 'object',
                      properties: {
                        value: { type: 'string', description: 'ex "+8,2%"' },
                        trend: { type: 'string', enum: ['up', 'down', 'neutral'] },
                      },
                    },
                    hint: { type: 'string' },
                  },
                  required: ['label', 'value'],
                },
              },
              // insights
              insights: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    value: { type: 'string' },
                    description: { type: 'string' },
                    severity: { type: 'string', enum: ['positive', 'warning', 'negative', 'neutral'] },
                  },
                  required: ['title', 'value', 'description', 'severity'],
                },
              },
              // table
              columns: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    key: { type: 'string' },
                    label: { type: 'string' },
                    align: { type: 'string', enum: ['left', 'right', 'center'] },
                    format: { type: 'string', enum: ['currency', 'percent', 'number', 'text'] },
                  },
                  required: ['key', 'label'],
                },
              },
              rows: {
                type: 'array',
                items: { type: 'object', additionalProperties: true },
              },
              exportable: { type: 'boolean' },
              // markdown
              content: { type: 'string', description: 'Markdown puro pra MarkdownBlock' },
              // chart
              variant: { type: 'string', enum: ['line', 'bar', 'area'] },
              series: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          x: {},
                          y: { type: 'number' },
                        },
                        required: ['x', 'y'],
                      },
                    },
                  },
                  required: ['name', 'data'],
                },
              },
            },
            required: ['type'],
          },
        },
      },
      required: ['blocks'],
    },
  },
];

export const TERMINAL_TOOL = 'respond_with_blocks';

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

// BRT é UTC-3 fixo (sem horário de verão desde 2019). Operação fica
// no Brasil; tudo que o modelo diz como "hoje", "ontem", "esta semana"
// é em BRT. Converter "YYYY-MM-DD" → instante BRT antes de filtrar
// previne off-by-one: sem isso, end_date="2026-05-11" caía em
// 00:00 UTC = 21:00 BRT do dia 10, e a query "vendas de hoje" perdia
// toda a tarde/noite real.
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

function parseBrtStart(dateStr: string): Date {
  // "2026-05-11" → 2026-05-11T00:00:00 BRT == 2026-05-11T03:00:00Z
  return new Date(new Date(dateStr + 'T00:00:00Z').getTime() + BRT_OFFSET_MS);
}

function parseBrtEnd(dateStr: string): Date {
  // "2026-05-11" → 2026-05-11T23:59:59.999 BRT == 2026-05-12T02:59:59.999Z
  return new Date(new Date(dateStr + 'T23:59:59.999Z').getTime() + BRT_OFFSET_MS);
}

function parseFilters(input: ToolInput): MetricsFilters {
  return {
    startDate: input.start_date
      ? parseBrtStart(input.start_date)
      : new Date(Date.now() - 30 * 24 * 3600 * 1000),
    endDate: input.end_date ? parseBrtEnd(input.end_date) : new Date(),
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
      case 'get_overview': {
        // getOverview lê da materialized view daily_metrics. O refresh
        // normal é throttled (60s) — pra IA isso causava respostas
        // inconsistentes (MV defasada vs dado real). Aqui forçamos um
        // refresh antes de consultar: chamadas de IA não são frequentes,
        // correção > latência. Alinha com get_products (query direta).
        await refreshDailyMetricsNow();
        return await getOverview(parseFilters(input));
      }
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
      case 'respond_with_blocks':
        // Terminal: route.ts intercepta esta tool antes de chamar executeTool.
        // Se cair aqui é porque alguém esqueceu de filtrar — devolve ack pra
        // não travar o loop, mas log pra investigar.
        return { ok: true };
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
