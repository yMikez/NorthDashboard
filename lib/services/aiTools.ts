// Tools do assistente IA. Cada uma mapeia 1:1 pra um service que TAMBÉM
// alimenta uma aba do dashboard — o chat lê os mesmos números da tela.
//
// Princípios (2026-08-24, "sem limites, sem travar"):
//   - NENHUM corte arbitrário de linhas (antes: top-30 afiliados, top-50
//     produtos). Afiliados e produtos vêm completos; pedidos são paginados
//     (até 1000/página) com `total` pra o modelo saber que precisa paginar.
//   - Datas opcionais: sem start/end a tool usa o período que o usuário
//     está VENDO na UI (ToolContext), senão últimos 30 dias.
//   - Resultado grande NUNCA vira JSON quebrado: fitToolResult() encolhe
//     a maior lista e anota `_truncated` pra o modelo paginar/estreitar.
//     (Antes: JSON.stringify().slice() — cortava no meio e o modelo lia
//     lixo.)
//   - Toda tool tem timeout: uma query travada vira erro legível pro
//     modelo em vez de um turno pendurado.
//   - Todas as abas cobertas: overview, afiliados, funil, produtos,
//     famílias, plataformas, pedidos, lucro front/back, custos,
//     fulfillment, coortes de reembolso, call center, recuperação, SMS,
//     saúde.

import type Anthropic from '@anthropic-ai/sdk';
import {
  getOverview,
  getAffiliates,
  getAffiliateDetail,
  getFunnel,
  getProducts,
  getOrders,
  getPlatforms,
  getCostsOverview,
  type MetricsFilters,
} from './metrics';
import { refreshDailyMetricsNow } from './dailyMetrics';
import { getCallCenterSales } from './callCenterSales';
import { getRefundCohorts } from './refundCohorts';
import { getSms } from './sms';
import { getRecovery } from './recovery';
import { getFulfillment } from './fulfillment';
import { getHealth } from './health';
import { getProfitSplit } from './profitSplit';
import { getFamilies } from './families';
import { getAffiliateAnalysis, getAffiliateExplain, getAffiliateSequence } from './affiliateAnalysis';
import { getFunnelSequence } from './funnelSequence';
import { validAnchor } from '../shared/affiliateAnalysisParams';
import { isValidWindow } from './affiliateAnalysisCore';
import { stagesParam } from '../shared/queryParams';
import { db } from '../db';
import { logger } from '../logger';

// ── Schemas ─────────────────────────────────────────────────────────────

type JsonSchema = Record<string, unknown>;

const DATE_PROPS: Record<string, JsonSchema> = {
  start_date: {
    type: 'string',
    description: 'Início (YYYY-MM-DD, em BRT). Omitido = período que o usuário está vendo na UI, senão últimos 30 dias.',
  },
  end_date: {
    type: 'string',
    description: 'Fim (YYYY-MM-DD, em BRT, inclusivo). Omitido = idem.',
  },
};

const SCOPE_PROPS: Record<string, JsonSchema> = {
  platforms: {
    type: 'array', items: { type: 'string' },
    description: 'Filtrar plataformas (slugs): clickbank | digistore24 | buygoods | cartpanda | jvzoo',
  },
  countries: { type: 'array', items: { type: 'string' }, description: 'Filtrar países (ISO 2 letras)' },
  families: {
    type: 'array', items: { type: 'string' },
    description: 'Filtrar famílias: NeuroMindPro, GlycoPulse, ThermoBurnPro, MaxVitalize, FlexImmuneGuard, NightCalm',
  },
  products: { type: 'array', items: { type: 'string' }, description: 'Filtrar SKUs específicos (externalId do produto)' },
  stages: {
    type: 'array',
    items: { type: 'string', enum: ['FRONTEND', 'UPSELL', 'DOWNSELL', 'BUMP', 'SMS_RECOVERY'] },
    description: 'Filtrar etapa do funil (productType). Vazio = todas.',
  },
};

/** window/anchor/include_today das tools de janela → opções dos serviços (ou erro pro modelo). */
function windowArgs(input: ToolInput): { window: number; anchor?: string; includeToday: boolean } | { error: string; message: string } {
  const win = input.window == null ? 7 : Number(input.window);
  if (!isValidWindow(win)) return { error: 'invalid_input', message: 'window deve ser um inteiro de 1 a 90' };
  const anchorRaw = typeof input.anchor === 'string' ? input.anchor.trim() : '';
  const anchor = anchorRaw ? validAnchor(anchorRaw) : undefined;
  if (anchorRaw && !anchor) return { error: 'invalid_input', message: 'anchor deve ser uma data real YYYY-MM-DD (ano >= 2024), não futura' };
  return { window: win, anchor, includeToday: input.include_today === true };
}
function countArg(input: ToolInput): number {
  const n = Number(input.count);
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 2), 8) : 3;
}

function tool(name: string, description: string, props: Record<string, JsonSchema> = {}, required: string[] = []): Anthropic.Tool {
  return {
    name,
    description,
    input_schema: { type: 'object', properties: props, required },
  };
}

const ORDER_STATUSES = ['APPROVED', 'REFUNDED', 'CHARGEBACK', 'PENDING', 'CANCELED'] as const;

const WINDOW_PROPS: Record<string, JsonSchema> = {
  window: { type: 'integer', description: 'Tamanho da janela em dias, 1 a 90 (presets 3/7/15/30/60; default 7)' },
  anchor: { type: 'string', description: 'Janela personalizada: último dia da janela mais recente, YYYY-MM-DD (BRT). Default = ontem (último dia completo). Serve pra "olhar como estava até o dia X".' },
  include_today: { type: 'boolean', description: 'Sem anchor: fecha a janela em HOJE (dia parcial) em vez de ontem. Default false.' },
};

export const TOOLS: Anthropic.Tool[] = [
  tool(
    'get_overview',
    'KPIs globais do dashboard no período: receita, pedidos, aprovação, refund, AOV, lucro estimado, top países, top afiliados, tipos de produto, série diária, heatmap por hora. Mesmos números da aba Visão Geral.',
    {
      ...DATE_PROPS, ...SCOPE_PROPS,
      compare: { type: 'boolean', description: 'true = inclui também o período anterior de mesma duração pra comparação.' },
    },
  ),
  tool(
    'get_affiliates',
    'TODOS os afiliados do período com métricas: receita, pedidos, aprovação, refund, CPA negociado, NET AOV, NET AFTER CPA, lucro direto vs atribuído à sessão, AOV, LTV. Sem corte de linhas. Mesmos números da aba Afiliados (que não filtra por etapa — por isso não há `stages` aqui).',
    {
      ...DATE_PROPS,
      platforms: SCOPE_PROPS.platforms, countries: SCOPE_PROPS.countries, families: SCOPE_PROPS.families, products: SCOPE_PROPS.products,
      search: { type: 'string', description: 'Filtra por trecho do nickname ou ID do afiliado (case-insensitive).' },
    },
  ),
  tool(
    'get_affiliate_detail',
    'Detalhe profundo de UM afiliado (drill-down): KPIs, série diária, por-produto, por-país, flags automáticas, LTV, NET AFTER CPA. Use quando o usuário nomeia um afiliado (ex: "nitrocompany", "fenix2025"). Aceita os mesmos filtros de dimensão da tela (plataforma, família, SKU, etapa, país) — passe os da UI pra bater com o drawer.',
    {
      external_id: { type: 'string', description: 'Nickname ou externalId do afiliado (busca case-insensitive)' },
      platform: { type: 'string', description: 'Slug da plataforma, se o mesmo ID existir em mais de uma (opcional).' },
      ...DATE_PROPS, ...SCOPE_PROPS,
    },
    ['external_id'],
  ),
  tool(
    'get_affiliate_analysis',
    'Análise de afiliados por JANELAS FIXAS (3, 7, 15, 30 ou 60 dias, fechando ontem), cada uma comparada com a janela anterior de mesmo tamanho: ranking com receita, vendas, AOV, aprovação, reembolso, CPA, Net após CPA, tendência (novo/breakout/crescimento/estável/volátil/queda/queda forte/churn) e o principal motivo da variação (topDriver). view=partner soma as contas da mesma pessoa em plataformas diferentes (identidade unificada); view=platform mostra cada conta. Retorna também `windows` (totais das 5 janelas) e cada linha traz `key` (use em get_affiliate_explain). As janelas fecham ONTEM (último dia completo, BRT) — ou no `anchor` (janela personalizada até um dia). Mesmos números da aba Análise de afiliados (modo Ranking). Não recebe datas de início/fim — use `window` (+ `anchor`). Pra VÁRIAS janelas em sequência (Janela 1..K, evolução, quem está parando, saúde), use get_affiliate_sequence.',
    {
      ...WINDOW_PROPS,
      view: { type: 'string', enum: ['partner', 'platform'], description: 'partner = contas unificadas (default); platform = por conta' },
      include_internal: { type: 'boolean', description: 'Incluir pseudo-afiliados internos (tracking de produto). Default false.' },
      platforms: SCOPE_PROPS.platforms, families: SCOPE_PROPS.families,
    },
  ),
  tool(
    'get_affiliate_explain',
    'POR QUÊ um afiliado/parceiro subiu ou caiu: drivers ordenados por impacto (volume de fronts × AOV — decomposição exata da Δreceita —, ticket do front, take rate de upsell, dias com venda, aprovação, reembolso, CPA renegociado, mix de família), janelas 3/7/15/30/60, série diária atual × anterior, quebra por família e por conta. `key` vem de get_affiliate_analysis (partner:<id> ou aff:<id>).',
    {
      key: { type: 'string', description: 'Chave da entidade: partner:<id> ou aff:<id>' },
      ...WINDOW_PROPS,
      include_internal: { type: 'boolean', description: 'Incluir contas internas do parceiro (default false, igual ao ranking)' },
      platforms: SCOPE_PROPS.platforms, families: SCOPE_PROPS.families,
    },
    ['key'],
  ),
  tool(
    'get_affiliate_sequence',
    'Análise de afiliados em SEQUÊNCIA de janelas: K janelas consecutivas de N dias (Janela 1 = mais antiga … Janela K = mais recente, terminando ontem ou no `anchor`). Igual aos modos Janelas / Evolução / Saúde da aba Análise de afiliados. Retorna: `windows` (totais, ativos, concentração top10, ranking completo de cada janela), `transitions` (Janela i → i+1: Δ receita/vendas/AOV com a CAUSA — retidos vs saldo novos−churn, quem mais subiu/caiu), `evolution` (trajetória de cada afiliado nas K janelas com tag novo/breakout/crescimento/estável/volátil/queda/queda forte/churn/intermitente e comentário), `reactivation` (quem parou há 1 janela = mornos), `slowing` (quem está parando de rodar: sumiu na última janela ou caiu ≥ 50% do pico e segue caindo) e `health` (notas de saúde da base + risco de concentração). Use pra "como foram as últimas 3 semanas?", "quem está parando de rodar?", "evolução de X janela a janela", "saúde da base de afiliados".',
    {
      ...WINDOW_PROPS,
      count: { type: 'integer', description: 'Quantas janelas em sequência, 2 a 8 (default 3)' },
      view: { type: 'string', enum: ['partner', 'platform'], description: 'partner = contas unificadas (default); platform = por conta' },
      include_internal: { type: 'boolean', description: 'Incluir pseudo-afiliados internos. Default false.' },
      platforms: SCOPE_PROPS.platforms, families: SCOPE_PROPS.families,
    },
  ),
  tool(
    'get_funnel',
    'Funil de conversão por família: etapas (FE → Bump → UP1 → UP2 → UP3 → DW1 → DW2 → DW3) com take rate e receita. Inclui cross-sell por família (cross-sells contam no funil da família do FE). Mesmos números da aba Funil.',
    { ...DATE_PROPS, platforms: SCOPE_PROPS.platforms, countries: SCOPE_PROPS.countries, families: SCOPE_PROPS.families, products: SCOPE_PROPS.products },
  ),
  tool(
    'get_funnel_sequence',
    'Funil por JANELAS em sequência (modo "Janelas & comparativo" da aba Funil): K janelas consecutivas de N dias terminando ontem ou no `anchor`, e pra cada uma o funil completo (etapas com volume, take rate sobre o FE e receita) + resumo (FEs, receita, AOV de sessão, lift de upsells). `scopes.all` = tudo; `scopes.<família>` = funil isolado da família. Cada escopo traz `notes` (leitura de cada janela) e `transitions` (Janela i → i+1: Δ receita decomposta em EFEITO DO VOLUME de FEs × EFEITO DO AOV de sessão, take rate por estágio com Δ em pp e efeito em $ a ticket constante, `topStage` = estágio que mais mexeu, e `note` com a explicação). Mesmos números do get_funnel, janela a janela. Use pra "o funil piorou nas últimas semanas?", "qual upsell caiu?", "foi volume ou conversão?".',
    {
      ...WINDOW_PROPS,
      count: { type: 'integer', description: 'Quantas janelas em sequência, 2 a 8 (default 3)' },
      platforms: SCOPE_PROPS.platforms, countries: SCOPE_PROPS.countries, families: SCOPE_PROPS.families, products: SCOPE_PROPS.products,
    },
  ),
  tool(
    'get_products',
    'TODOS os SKUs com performance: receita, pedidos, refund, chargeback, margem direta e atribuída ao funil, lucro. Sem corte de linhas. Mesmos números da aba Produtos.',
    { ...DATE_PROPS, ...SCOPE_PROPS },
  ),
  tool(
    'get_families',
    'Visão por família de produto: catálogo (SKUs por tipo), receita, pedidos, refund, funil por família. Mesmos números da aba Famílias.',
    { ...DATE_PROPS, platforms: SCOPE_PROPS.platforms, countries: SCOPE_PROPS.countries, families: SCOPE_PROPS.families },
  ),
  tool(
    'get_platforms',
    'Comparação entre plataformas (ClickBank, Digistore24, BuyGoods, Cartpanda, JVZoo): receita, pedidos, fees, refund observado em coorte madura, NET. Mesmos números da aba Plataformas.',
    { ...DATE_PROPS, ...SCOPE_PROPS },
  ),
  tool(
    'get_orders',
    'Transações individuais, paginadas. Campos: plataforma, produto, etapa, afiliado, país, valores bruto/líquido/fees/CPA, status, data da venda e do evento. `total` = quantas existem no filtro; pagine com offset até cobrir tudo quando precisar da lista completa. Até 1000 por página. Com status REFUNDED ou CHARGEBACK o período vale sobre a data do ESTORNO (igual à aba Transações e aos cards de reembolso); nos demais, sobre a data da venda.',
    {
      ...DATE_PROPS, ...SCOPE_PROPS,
      status: { type: 'string', enum: [...ORDER_STATUSES] },
      limit: { type: 'integer', description: 'Tamanho da página (default 200, máx 1000)' },
      offset: { type: 'integer', description: 'Deslocamento pra paginar (default 0)' },
    },
  ),
  tool(
    'get_profit_split',
    'Lucro FRONT (vendas das plataformas) × BACK (recuperação por SMS, Tauk, Logicall) com custos, comissões e margem de cada fonte. Mesmos números do painel de lucro da Visão Geral.',
    { ...DATE_PROPS, platforms: SCOPE_PROPS.platforms, countries: SCOPE_PROPS.countries, families: SCOPE_PROPS.families },
  ),
  tool(
    'get_costs_overview',
    'Custos e lucro do período: receita, refunds, fulfillment, COGS, fees de plataforma, CPA, allowance reservado, lucro e margem — total, por dia, por plataforma e por família. (Custo por POTE fica em get_fulfillment.) Mesmos números da aba Custos.',
    { ...DATE_PROPS, ...SCOPE_PROPS },
  ),
  tool(
    'get_fulfillment',
    'Operação de envio: potes enviados, gasto, custo por pote, projeções now-relative, saúde do custo, por fornecedor (RedRock/ShipOffers) e por família. Mesmos números da aba Fulfillment.',
    { ...DATE_PROPS, platforms: SCOPE_PROPS.platforms, countries: SCOPE_PROPS.countries, families: SCOPE_PROPS.families },
  ),
  tool(
    'get_refund_cohorts',
    'Coortes de reembolso por dia da VENDA: matriz censurada (idade × coorte), curva de maturação, taxa madura, projeção (mature-cohort pattern + Bornhuetter-Ferguson) e estornos fora do horizonte. Mesmos números da aba Reembolsos.',
    {
      ...DATE_PROPS, ...SCOPE_PROPS,
      horizon: { type: 'integer', description: 'Horizonte em dias da matriz (7–180, default 30)' },
    },
  ),
  tool(
    'get_call_center',
    'Call center de recuperação por telefone (Tauk e Logicall): vendas, receita, comissão, líquido, estornos, pendentes, série diária por parceiro, agentes (humano × IA), produtos, últimas vendas e estado da integração. Fora das ordens das plataformas. Mesmos números da aba Call Center.',
    {
      ...DATE_PROPS,
      provider: { type: 'string', enum: ['all', 'tauk', 'logicall'], description: 'Parceiro (default all)' },
    },
  ),
  tool(
    'get_recovery',
    'Afiliados de recuperação (fonte de tráfego de recuperação, ex: lusk1nha): vendas aprovadas, comissão % vigente e devida, histórico de taxas. Mesmos números da aba Recuperação.',
    { ...DATE_PROPS },
  ),
  tool(
    'get_sms',
    'Saúde e conversão das campanhas de SMS (Mautic → Twilio): enviados, entregues, falhas, respostas, conversões e receita por campanha/número, com semáforo de saúde. Mesmos números da aba SMS.',
    {
      ...DATE_PROPS,
      brand: { type: 'string', description: 'Filtrar marca/família (opcional)' },
      campaign: { type: 'string', description: 'Filtrar campanha (opcional)' },
    },
  ),
  tool(
    'get_health',
    'Saúde da ingestão de dados: último IPN por plataforma (há quanto tempo), recebidos e falhas nas últimas 24h, taxa de aprovação/refund/chargeback 24h vs baseline 30d, SKUs sem família, tamanho da materialized view. Use pra "os dados estão atualizados?" / "alguma plataforma parou de mandar?". Não recebe filtros.',
  ),
  {
    name: 'respond_with_blocks',
    description:
      'Tool TERMINAL pra entregar a resposta final em blocos estruturados (cards de KPI, insights, tabelas, charts) em vez de markdown puro. Use SEMPRE que a resposta contém ≥3 números OU lista ≥4 itens OU comparações entre entidades — quando o leitor vai escanear visualmente em vez de ler. Para perguntas curtas/conversa, NÃO use — responda em markdown direto. Chame essa tool no FIM, depois de coletar dados via get_*. Blocos disponíveis: summary (KPIs hero), insights (cartões coloridos com severity), table (linhas/colunas tipadas, sem limite de linhas), markdown (parágrafo de texto), chart (line/bar/area).',
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

// ── Input / contexto ────────────────────────────────────────────────────

export interface ToolInput {
  start_date?: string;
  end_date?: string;
  platforms?: string[];
  countries?: string[];
  families?: string[];
  products?: string[];
  stages?: string[];
  external_id?: string;
  platform?: string;
  status?: string;
  limit?: number;
  offset?: number;
  compare?: boolean;
  search?: string;
  provider?: string;
  horizon?: number;
  brand?: string;
  campaign?: string;
  window?: number;
  view?: string;
  include_internal?: boolean;
  anchor?: string;
  include_today?: boolean;
  count?: number;
  key?: string;
}

/**
 * Contexto por request: o período que o usuário está vendo na UI. Vira o
 * default de start/end quando o modelo omite datas — assim "por que caiu
 * aqui?" consulta exatamente o que está na tela, não "últimos 30 dias".
 */
export interface ToolContext {
  defaultStart?: Date;
  defaultEnd?: Date;
}

// BRT é UTC-3 fixo (sem horário de verão desde 2019). Operação fica
// no Brasil; tudo que o modelo diz como "hoje", "ontem", "esta semana"
// é em BRT. Converter "YYYY-MM-DD" → instante BRT antes de filtrar
// previne off-by-one: sem isso, end_date="2026-05-11" caía em
// 00:00 UTC = 21:00 BRT do dia 10, e a query "vendas de hoje" perdia
// toda a tarde/noite real.
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function parseBrtStart(dateStr: string): Date {
  // "2026-05-11" → 2026-05-11T00:00:00 BRT == 2026-05-11T03:00:00Z
  return new Date(new Date(dateStr + 'T00:00:00Z').getTime() + BRT_OFFSET_MS);
}

export function parseBrtEnd(dateStr: string): Date {
  // "2026-05-11" → 2026-05-11T23:59:59.999 BRT == 2026-05-12T02:59:59.999Z
  return new Date(new Date(dateStr + 'T23:59:59.999Z').getTime() + BRT_OFFSET_MS);
}

/**
 * Monta o ToolContext a partir do estado da UI. Preferência: os INSTANTES
 * exatos (ISO com hora) que as abas usam nas queries — o chat consulta o
 * mesmíssimo intervalo da tela. Fallback: rótulos YYYY-MM-DD lidos como
 * dias BRT inteiros.
 */
export function uiRangeContext(startAt?: unknown, endAt?: unknown, startDate?: unknown, endDate?: unknown): ToolContext {
  const isInstant = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v));
  if (isInstant(startAt) && isInstant(endAt)) {
    const s = new Date(startAt);
    const e = new Date(endAt);
    if (e.getTime() >= s.getTime()) return { defaultStart: s, defaultEnd: e };
  }
  const isDay = (v: unknown): v is string => typeof v === 'string' && YMD.test(v) && !Number.isNaN(Date.parse(v));
  if (!isDay(startDate) || !isDay(endDate)) return {};
  const s = parseBrtStart(startDate);
  const e = parseBrtEnd(endDate);
  if (e.getTime() < s.getTime()) return {};
  return { defaultStart: s, defaultEnd: e };
}

class ToolInputError extends Error {}

function dateArg(raw: unknown, name: string): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string' || !YMD.test(raw) || Number.isNaN(Date.parse(raw))) {
    throw new ToolInputError(`${name} inválido ("${String(raw)}") — use YYYY-MM-DD`);
  }
  return raw;
}

function strList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim());
  return out.length ? out : undefined;
}

export function parseFilters(input: ToolInput, ctx: ToolContext = {}): MetricsFilters {
  const start = dateArg(input.start_date, 'start_date');
  const end = dateArg(input.end_date, 'end_date');
  const now = new Date();
  const THIRTY_D = 30 * 24 * 3600 * 1000;
  let startDate: Date;
  let endDate: Date;
  if (start && end) {
    startDate = parseBrtStart(start);
    endDate = parseBrtEnd(end);
  } else if (start) {
    // Só o início: "desde 10/08" → até agora (o fim da UI pode ser anterior).
    startDate = parseBrtStart(start);
    endDate = now;
  } else if (end) {
    // Só o fim: começa no início da UI se couber, senão 30 dias antes.
    endDate = parseBrtEnd(end);
    startDate = ctx.defaultStart && ctx.defaultStart.getTime() <= endDate.getTime()
      ? ctx.defaultStart
      : new Date(endDate.getTime() - THIRTY_D);
  } else {
    startDate = ctx.defaultStart ?? new Date(now.getTime() - THIRTY_D);
    endDate = ctx.defaultEnd ?? now;
  }
  if (endDate.getTime() < startDate.getTime()) {
    throw new ToolInputError('end_date anterior a start_date');
  }
  const stages = strList(input.stages);
  return {
    startDate,
    endDate,
    platformSlugs: strList(input.platforms),
    countries: strList(input.countries),
    productFamilies: strList(input.families),
    productExternalIds: strList(input.products),
    productTypes: stages ? stagesParam(stages.join(',')) : undefined,
  };
}

// ── Encolhimento seguro do resultado ────────────────────────────────────

/** Arredonda floats longos (0.123456789 → 0.1235): menos tokens, mesma leitura. */
function compactNumbers(value: unknown): unknown {
  if (typeof value === 'number') {
    return Number.isFinite(value) && !Number.isInteger(value) ? Math.round(value * 10_000) / 10_000 : value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(compactNumbers);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = compactNumbers(v);
    }
    return out;
  }
  return value;
}

interface ArrayRef { parent: Record<string, unknown> | unknown[]; key: string | number; path: string; arr: unknown[]; bytes: number }

function findLargestArray(node: unknown, path: string, depth: number, best: ArrayRef | null): ArrayRef | null {
  if (depth > 5 || !node || typeof node !== 'object') return best;
  const entries: Array<[string | number, unknown]> = Array.isArray(node)
    ? node.map((v, i) => [i, v] as [number, unknown])
    : Object.entries(node as Record<string, unknown>);
  for (const [key, val] of entries) {
    if (Array.isArray(val) && val.length > 1) {
      const bytes = JSON.stringify(val).length;
      if (!best || bytes > best.bytes) {
        best = { parent: node as Record<string, unknown> | unknown[], key, path: path ? `${path}.${key}` : String(key), arr: val, bytes };
      }
    }
    if (val && typeof val === 'object' && !Array.isArray(val)) best = findLargestArray(val, path ? `${path}.${key}` : String(key), depth + 1, best);
  }
  return best;
}

export interface TruncationNote { path: string; kept: number; total: number }

/**
 * Serializa o resultado de uma tool garantindo JSON VÁLIDO dentro de
 * maxBytes. Se estourar, corta a maior lista pela metade (repetidamente)
 * e anota `_truncated` — o modelo lê o aviso e pagina/estreita filtros.
 * Nunca devolve string cortada no meio (o formato antigo fazia isso e o
 * modelo interpretava lixo como dado).
 */
export function fitToolResult(value: unknown, maxBytes: number): string {
  const compact = compactNumbers(value);
  let json = JSON.stringify(compact);
  if (json === undefined) return 'null';
  if (json.length <= maxBytes) return json;
  if (!compact || typeof compact !== 'object') {
    return JSON.stringify({ error: 'result_too_large', bytes: json.length, maxBytes });
  }
  const root = JSON.parse(json) as Record<string, unknown> | unknown[];
  const notes = new Map<string, TruncationNote>();
  for (let guard = 0; guard < 60 && json.length > maxBytes; guard++) {
    const target = findLargestArray(root, '', 0, null);
    if (!target) break;
    const keep = Math.max(1, Math.floor(target.arr.length / 2));
    const prev = notes.get(target.path);
    notes.set(target.path, { path: target.path, kept: keep, total: prev?.total ?? target.arr.length });
    (target.parent as Record<string | number, unknown>)[target.key] = target.arr.slice(0, keep);
    json = JSON.stringify(withNotes(root, notes));
  }
  if (json.length > maxBytes) {
    return JSON.stringify({
      error: 'result_too_large',
      bytes: json.length,
      maxBytes,
      hint: 'Estreite o período ou os filtros e tente de novo.',
    });
  }
  return json;
}

function withNotes(root: Record<string, unknown> | unknown[], notes: Map<string, TruncationNote>): unknown {
  if (!notes.size) return root;
  const list = [...notes.values()];
  const hint = 'Listas encolhidas por tamanho — pagine (offset) ou estreite o período/filtros pra ver o restante antes de concluir.';
  if (Array.isArray(root)) return { items: root, _truncated: list, _hint: hint };
  return { ...root, _truncated: list, _hint: hint };
}

// ── Execução ────────────────────────────────────────────────────────────

// Teto por tool: consulta que passar disso vira erro pro modelo (que pode
// estreitar o período e tentar de novo) em vez de segurar o turno inteiro.
export const TOOL_TIMEOUT_MS = 180_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} excedeu ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => { if (timer) clearTimeout(timer); });
}

type CallCenterProvider = 'tauk' | 'logicall';

function callCenterProvider(raw: unknown): CallCenterProvider | 'all' {
  return raw === 'tauk' || raw === 'logicall' ? raw : 'all';
}

type Handler = (input: ToolInput, ctx: ToolContext) => Promise<unknown>;

const HANDLERS: Record<string, Handler> = {
  async get_overview(input, ctx) {
    // getOverview lê da materialized view daily_metrics. O refresh normal
    // é throttled (60s) — pra IA isso causava respostas inconsistentes
    // (MV defasada vs dado real). Forçamos um refresh antes: chamadas de
    // IA não são frequentes, correção > latência.
    await refreshDailyMetricsNow();
    return getOverview(parseFilters(input, ctx), input.compare === true);
  },
  async get_affiliates(input, ctx) {
    // A aba Afiliados NÃO aplica o filtro de etapa — aqui também não, senão
    // o chat mostraria receita só de FE enquanto a tela mostra tudo.
    const filters = parseFilters(input, ctx);
    filters.productTypes = undefined;
    const data = await getAffiliates(filters);
    const q = typeof input.search === 'string' ? input.search.trim().toLowerCase() : '';
    // Sparkline (30 pontos/afiliado) só serve pra UI — fora do payload do
    // modelo. Sem corte de linhas: o modelo vê TODOS os afiliados.
    const affiliates = data.affiliates
      .filter((a) => !q || String(a.externalId ?? '').toLowerCase().includes(q) || String(a.nickname ?? '').toLowerCase().includes(q))
      .map((a) => {
        const { sparkline: _sparkline, ...rest } = a as Record<string, unknown> & { sparkline?: unknown };
        return rest;
      });
    return { summary: data.summary, totalCount: data.affiliates.length, returned: affiliates.length, affiliates };
  },
  async get_affiliate_detail(input, ctx) {
    const id = typeof input.external_id === 'string' ? input.external_id.trim() : '';
    if (!id) return { error: 'external_id obrigatório' };
    const hint = typeof input.platform === 'string' && input.platform.trim() ? input.platform.trim() : undefined;
    const filters = parseFilters(input, ctx);
    // O service casa externalId EXATO. O usuário costuma citar o nickname
    // (ou o ID em outra caixa) — resolve antes, case-insensitive, preferindo
    // o afiliado com pedido mais recente.
    const resolved = await db.affiliate.findFirst({
      where: {
        OR: [
          { externalId: { equals: id, mode: 'insensitive' } },
          { nickname: { equals: id, mode: 'insensitive' } },
        ],
        ...(hint ? { platform: { slug: hint } } : {}),
      },
      orderBy: { lastOrderAt: { sort: 'desc', nulls: 'last' } },
      select: { externalId: true, platform: { select: { slug: true } } },
    });
    const externalId = resolved?.externalId ?? id;
    const detail = await getAffiliateDetail(externalId, filters, hint ?? resolved?.platform.slug);
    return detail ?? { error: 'affiliate_not_found', message: `Afiliado "${id}" não encontrado no período. Tente get_affiliates com search.` };
  },
  async get_affiliate_analysis(input) {
    const w = windowArgs(input);
    if ('error' in w) return w;
    const data = await getAffiliateAnalysis({
      ...w, view: input.view === 'platform' ? 'platform' : 'partner',
      includeInternal: input.include_internal === true,
      platformSlugs: strList(input.platforms), families: strList(input.families),
      includeContact: false,
    });
    // Série diária e sparklines são pra gráfico — fora do payload do modelo.
    const { daily: _daily, topKeys: _topKeys, ...rest } = data;
    return { ...rest, rows: data.rows.map(({ sparkline: _s, ...r }) => r) };
  },
  async get_affiliate_explain(input) {
    const key = typeof input.key === 'string' ? input.key.trim() : '';
    if (!/^(partner|aff):[A-Za-z0-9_-]+$/.test(key)) return { error: 'invalid_input', message: 'key deve ser partner:<id> ou aff:<id> (veja get_affiliate_analysis)' };
    const w = windowArgs(input);
    if ('error' in w) return w;
    const r = await getAffiliateExplain(key, {
      ...w, view: 'partner', includeInternal: input.include_internal === true,
      platformSlugs: strList(input.platforms), families: strList(input.families), includeContact: false,
    });
    return r ?? { error: 'not_found', message: `entidade ${key} não encontrada` };
  },
  async get_affiliate_sequence(input) {
    const w = windowArgs(input);
    if ('error' in w) return w;
    return getAffiliateSequence({
      ...w, count: countArg(input), view: input.view === 'platform' ? 'platform' : 'partner',
      includeInternal: input.include_internal === true,
      platformSlugs: strList(input.platforms), families: strList(input.families), includeContact: false,
    });
  },
  async get_funnel(input, ctx) {
    return getFunnel(parseFilters(input, ctx));
  },
  async get_funnel_sequence(input) {
    const w = windowArgs(input);
    if ('error' in w) return w;
    return getFunnelSequence({
      ...w, count: countArg(input),
      platformSlugs: strList(input.platforms), countries: strList(input.countries),
      productFamilies: strList(input.families), productExternalIds: strList(input.products),
    });
  },
  async get_products(input, ctx) {
    const data = await getProducts(parseFilters(input, ctx));
    return { ...data, totalCount: data.products.length };
  },
  async get_families(input, ctx) {
    return getFamilies(parseFilters(input, ctx));
  },
  async get_platforms(input, ctx) {
    return getPlatforms(parseFilters(input, ctx));
  },
  async get_orders(input, ctx) {
    const limit = Math.min(Math.max(Math.trunc(Number(input.limit) || 200), 1), 1000);
    const offset = Math.max(Math.trunc(Number(input.offset) || 0), 0);
    // getOrders decide o EIXO da data pelo status em minúsculo ('refunded'
    // → refundedAt, 'chargeback' → chargebackAt) — é o que a aba manda.
    // Passar maiúsculo filtrava estornos pela data da VENDA (número
    // diferente do card da Visão Geral).
    const status = (ORDER_STATUSES as readonly string[]).includes(String(input.status)) ? String(input.status).toLowerCase() : undefined;
    const data = await getOrders(parseFilters(input, ctx), { status, limit, offset });
    return { ...data, page: { limit, offset, returned: data.orders.length, total: data.total, hasMore: offset + data.orders.length < data.total } };
  },
  async get_profit_split(input, ctx) {
    const f = parseFilters(input, ctx);
    return getProfitSplit({ startDate: f.startDate, endDate: f.endDate, platformSlugs: f.platformSlugs, productFamilies: f.productFamilies, countries: f.countries });
  },
  async get_costs_overview(input, ctx) {
    return getCostsOverview(parseFilters(input, ctx));
  },
  async get_fulfillment(input, ctx) {
    const f = parseFilters(input, ctx);
    return getFulfillment({ startDate: f.startDate, endDate: f.endDate, platformSlugs: f.platformSlugs, countries: f.countries, productFamilies: f.productFamilies });
  },
  async get_refund_cohorts(input, ctx) {
    const f = parseFilters(input, ctx);
    const horizon = Math.trunc(Number(input.horizon) || 30);
    return getRefundCohorts(
      { startDate: f.startDate, endDate: f.endDate, platformSlugs: f.platformSlugs, productFamilies: f.productFamilies, productExternalIds: f.productExternalIds, productTypes: f.productTypes, countries: f.countries },
      horizon,
    );
  },
  async get_call_center(input, ctx) {
    const f = parseFilters(input, ctx);
    return getCallCenterSales({ startDate: f.startDate, endDate: f.endDate, provider: callCenterProvider(input.provider) });
  },
  async get_recovery(input, ctx) {
    const f = parseFilters(input, ctx);
    return getRecovery({ startDate: f.startDate, endDate: f.endDate });
  },
  async get_sms(input, ctx) {
    const f = parseFilters(input, ctx);
    const brand = typeof input.brand === 'string' && input.brand.trim() ? input.brand.trim() : null;
    const campaign = typeof input.campaign === 'string' && input.campaign.trim() ? input.campaign.trim() : null;
    return getSms({ startDate: f.startDate, endDate: f.endDate, brand, campaign });
  },
  async get_health() {
    return getHealth();
  },
  async respond_with_blocks() {
    // Terminal: route.ts intercepta esta tool antes de chamar executeTool.
    // Se cair aqui é porque alguém esqueceu de filtrar — devolve ack pra
    // não travar o loop.
    return { ok: true };
  },
};

/** Nomes das tools que têm handler — usado pelos testes de cobertura. */
export const HANDLED_TOOL_NAMES = Object.keys(HANDLERS);

/**
 * Executor de tool calls. Recebe nome + input do tool_use block, devolve
 * o resultado da chamada ao service correspondente. Qualquer falha (input
 * inválido, query quebrada, timeout) vira objeto de erro que o modelo
 * consegue interpretar e contornar — nunca uma exceção que derrube o turno.
 */
export async function executeTool(name: string, input: ToolInput, ctx: ToolContext = {}): Promise<unknown> {
  const handler = HANDLERS[name];
  if (!handler) return { error: `tool desconhecida: ${name}` };
  const startedAt = Date.now();
  try {
    return await withTimeout(handler(input ?? {}, ctx), TOOL_TIMEOUT_MS, name);
  } catch (err) {
    if (err instanceof ToolInputError) {
      return { error: 'invalid_input', message: err.message };
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ tool: name, ms: Date.now() - startedAt, err: message }, '[chat] tool falhou');
    return { error: 'tool_execution_failed', tool: name, message };
  }
}
