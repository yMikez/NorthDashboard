// Tools do assistente IA. Cada uma mapeia 1:1 pra um service que TAMBÉM
// alimenta uma aba do dashboard — o chat lê os mesmos números da tela.
//
// Princípios (2026-08-24, "sem limites, sem travar"):
//   - NENHUM corte arbitrário de linhas (antes: top-30 afiliados, top-50
//     produtos). Afiliados e produtos vêm completos; pedidos são paginados
//     (até 1000/página) com `total` pra o modelo saber que precisa paginar.
//   - Datas opcionais: sem start/end a tool usa o período que o usuário
//     está VENDO na UI (ToolContext), senão os últimos 30 dias BRT.
//   - Resultado grande NUNCA vira JSON quebrado: fitToolResult (lib/ai/fit)
//     encolhe pela política da tool e anota `_truncated`.
//   - Toda tool tem timeout: uma query travada vira erro legível pro
//     modelo em vez de um turno pendurado.
//
// Camada de precisão (2026-09-30) — entre o serviço e o modelo, sem mudar
// número de aba:
//   - normalizeScope antes do handler (slug/família/país/etapa corrigidos ou
//     erro com os valores válidos — filtro errado virava "zero" confiante);
//   - visões por tool (lib/ai/views): cards da tela 1:1 no overview, deltas
//     prontos, comparação alinhada com hoje parcial, taxas por SKU, BRT;
//   - `_meta` em todo resultado: janela BRT efetiva, filtros resolvidos,
//     unidades, qualidade do dado, notas, vazio-com-filtro;
//   - UMA forma de erro {error, message, retryable, hint?, validValues?,
//     alternatives?}.

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
import { getCallCenterSales, PROVIDERS } from './callCenterSales';
import type { CallCenterProvider } from './integrationSettings';
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
import { affiliateIdsParam, stagesParam } from '../shared/queryParams';
import { isContentResult, type ToolContext, type ToolModule } from '../ai/toolTypes';
import { SKILL_TOOL_MODULE } from '../ai/skillTools';
import { RAG_TOOL_MODULE } from '../rag/ragTools';
import { ATTACHMENT_TOOL_MODULE } from '../rag/attachmentTools';
import { PRECISION_TOOL_MODULE } from '../ai/precisionTools';
import { normalizeScope } from '../ai/normalizeScope';
import { dataQualityFor, type DataQualityNote } from '../ai/coverage';
import { tagTool } from '../ai/fit';
import { unitsFor } from '../ai/units';
import {
  ToolInputError,
  ToolTimeoutError,
  attachMeta,
  errorFromException,
  formatBrt,
  normalizeErrorResult,
  parseBrtEnd,
  parseBrtStart,
  rangeMeta,
  rangeMetaFromDays,
  toolError,
  type RangeMeta,
  type RangeSource,
  type ToolMeta,
} from '../ai/meta';
import {
  TOOL_NOTES,
  alignedPreviousWindow,
  buildScreenCards,
  isEmptyResult,
  kpiDeltas,
  labelHeatmap,
  orderRows,
  overviewKpisBetween,
  productRows,
  servicePreviousWindow,
  stripNetProfit,
  windowSpanOf,
  type AiOverviewKpis,
} from '../ai/views';
import { db } from '../db';
import { logger } from '../logger';

// O motor (chatEngine) importa fitToolResult daqui — a implementação v2 mora
// em lib/ai/fit.ts (políticas por caminho).
export { fitToolResult, type TruncationNote } from '../ai/fit';
export { parseBrtStart, parseBrtEnd } from '../ai/meta';

// ── Schemas ─────────────────────────────────────────────────────────────

type JsonSchema = Record<string, unknown>;

const DATE_PROPS: Record<string, JsonSchema> = {
  start_date: {
    type: 'string',
    description: 'Início (YYYY-MM-DD, dia BRT). Omitido = período que o usuário está vendo na UI; sem UI = últimos 30 dias BRT (29 fechados + hoje parcial). A janela efetiva volta em _meta.range.',
  },
  end_date: {
    type: 'string',
    description: 'Fim (YYYY-MM-DD, dia BRT, inclusivo). Omitido = idem.',
  },
};

// Filtro "Afiliado" da tela = affiliate_id do NorthScale Afiliados
// (Order.mappedAffiliateId). Só entra nas tools cujo serviço aplica o filtro
// em TODOS os números (auditado tool a tool em 2026-09-29) — nas outras o
// modelo diria "filtrado" sem estar.
const AFFILIATE_PROP: JsonSchema = {
  type: 'array', items: { type: 'string' },
  description: 'Filtrar pelo afiliado do NorthScale Afiliados (affiliate_id — o mesmo do filtro "Afiliado" da tela; NÃO é o ID/nickname da conta na plataforma). Mantém só os pedidos atribuídos a esse(s) affiliate_id.',
};

const AFFILIATE_ACCOUNTS_PROP: JsonSchema = {
  type: 'array', items: { type: 'string' },
  description: 'Filtrar por CONTA de afiliado de plataforma (Affiliate.id do dash — o filtro "Afiliado" da tela já vem com as contas resolvidas no Estado da UI; pra um nome, resolve_entities). Pessoa com contas em várias plataformas = passe todas as contas dela. Mantém só os pedidos dessas contas (sessão: a conta da FE decide).',
};

const SCOPE_PROPS: Record<string, JsonSchema> = {
  platforms: {
    type: 'array', items: { type: 'string' },
    description: 'Filtrar plataformas (slugs): clickbank | digistore24 | buygoods | cartpanda | jvzoo. Sinônimos (cb, d24, bg…) são normalizados; valor desconhecido volta erro com os válidos.',
  },
  countries: { type: 'array', items: { type: 'string' }, description: 'Filtrar países (ISO-2: US, CA, GB…)' },
  families: {
    type: 'array', items: { type: 'string' },
    description: 'Filtrar famílias de produto pelo nome canônico (ex.: NeuroMindPro). Caixa e aliases do catálogo são normalizados; família desconhecida volta erro com a lista válida — em dúvida, resolve_entities.',
  },
  products: { type: 'array', items: { type: 'string' }, description: 'Filtrar SKUs específicos (externalId do produto)' },
  stages: {
    type: 'array',
    items: { type: 'string', enum: ['FRONTEND', 'UPSELL', 'DOWNSELL', 'BUMP', 'SMS_RECOVERY'] },
    description: 'Filtrar etapa do funil (productType). Vazio = todas.',
  },
  affiliate_ids: AFFILIATE_PROP,
  affiliate_accounts: AFFILIATE_ACCOUNTS_PROP,
};

const SCOPE_KEYS = ['platforms', 'countries', 'families', 'products', 'stages', 'affiliate_ids', 'affiliate_accounts', 'platform'] as const;

/** window/anchor/include_today das tools de janela → opções dos serviços. */
function windowArgs(input: ToolInput): { window: number; anchor?: string; includeToday: boolean } {
  const win = input.window == null ? 7 : Number(input.window);
  if (!isValidWindow(win)) throw new ToolInputError('window deve ser um inteiro de 1 a 90');
  const anchorRaw = typeof input.anchor === 'string' ? input.anchor.trim() : '';
  const anchor = anchorRaw ? validAnchor(anchorRaw) : undefined;
  if (anchorRaw && !anchor) throw new ToolInputError('anchor deve ser uma data real YYYY-MM-DD (ano >= 2024), não futura');
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

const CORE_TOOLS: Anthropic.Tool[] = [
  tool(
    'get_overview',
    'KPIs globais do período (aba Visão Geral): receita bruta (gross = APPROVED por data da venda, dia BRT) e líquida (net = o que a plataforma credita: JÁ sem fee E sem CPA — nunca subtraia CPA do net), pedidos, AOV de sessão, EPO, COGS/frete, estimatedProfit (net − COGS − frete; NÃO é o card de lucro), top países/afiliados/etapas, série diária (dia BRT) e heatmap hora × dia da semana (BRT). `screenCards` = os cards da tela 1:1 (rótulo exato; % já em pontos percentuais): "Taxa de reembolso" e "Reembolso por pedidos" vêm do profit split e contam o estorno pela DATA DO ESTORNO; "Net after CPA (modelo)" = get_profit_split.front.profitUsd. Cite esses — kpis.refundRate/cbRate/approvalRate são FRAÇÃO de contagem ÷ todas as linhas pela data da venda. compare=true traz `previous` + `deltas` (abs; pct = variação relativa em fração; pp nas taxas). Com hoje parcial o anterior é cortado no MESMO horário (_meta.aligned).',
    {
      ...DATE_PROPS, ...SCOPE_PROPS,
      compare: { type: 'boolean', description: 'true = inclui o período anterior de mesma duração (alinhado no mesmo horário quando hoje está na janela) e os deltas prontos.' },
    },
  ),
  tool(
    'get_affiliates',
    'TODOS os afiliados do período com métricas (aba Afiliados), sem corte de linhas: receita, pedidos, realOrders (sem as linhas sintéticas de estorno da Digistore — denominador das taxas), aprovação/reembolso/CB (fração, contagem pela data da VENDA), CPA negociado (cpaPerFe = ÚLTIMO cpaPaidUsd > 0 numa FE aprovada do período), NET AOV = AOV × (1 − (refund&cb% + fee% + opex% + reserva%)/100), NET AFTER CPA por FE e total (netAfterCpaTotalUsd), cpaStatus, lucro direto vs atribuído à sessão, LTV. refundCbPctUsed/opexPctUsed em pontos percentuais. isRecovery = afiliado de recuperação (ganha % da venda, fica fora da média de CPA). A aba não filtra por etapa — por isso não há `stages` aqui.',
    {
      ...DATE_PROPS,
      platforms: SCOPE_PROPS.platforms, countries: SCOPE_PROPS.countries, families: SCOPE_PROPS.families, products: SCOPE_PROPS.products,
      affiliate_ids: AFFILIATE_PROP,
      affiliate_accounts: AFFILIATE_ACCOUNTS_PROP,
      search: { type: 'string', description: 'Filtra por trecho do nickname ou ID do afiliado (case-insensitive).' },
    },
  ),
  tool(
    'get_affiliate_detail',
    'Detalhe profundo de UM afiliado (drill-down): KPIs (taxas em fração sobre realOrders), série diária (dia BRT), por-produto, por-país, flags automáticas, LTV, NET AFTER CPA. Use quando o usuário nomeia um afiliado (ex: "nitrocompany", "fenix2025"). Se o nome casar com mais de uma conta, usa a de venda mais recente e devolve `alternatives` — repita com `platform` pra ver outra. Aceita os mesmos filtros de dimensão da tela (plataforma, família, SKU, etapa, país) — passe os da UI pra bater com o drawer.',
    {
      external_id: { type: 'string', description: 'Nickname ou externalId do afiliado (busca case-insensitive)' },
      platform: { type: 'string', description: 'Slug da plataforma, se o mesmo ID existir em mais de uma (opcional).' },
      ...DATE_PROPS, ...SCOPE_PROPS,
    },
    ['external_id'],
  ),
  tool(
    'get_affiliate_analysis',
    'Análise de afiliados por JANELAS FIXAS (3, 7, 15, 30 ou 60 dias, fechando ontem), cada uma comparada com a janela anterior de mesmo tamanho: ranking com receita, vendas, AOV, aprovação, reembolso, CPA, Net após CPA, tendência (novo/breakout/crescimento/estável/volátil/queda/queda forte/churn) e o principal motivo da variação (topDriver). view=partner soma as contas da mesma pessoa em plataformas diferentes (identidade unificada); view=platform mostra cada conta. Retorna também `windows` (totais das 5 janelas) e cada linha traz `key` (use em get_affiliate_explain). Unidades: *Rate = fração; delta.revenue/sales/aov = variação relativa (fração); delta.refundRate = diferença de fração; delta.netAfterCpa = US$. As janelas fecham ONTEM (último dia completo, BRT) — ou no `anchor`. Mesmos números da aba Análise de afiliados (modo Ranking). Não recebe datas de início/fim — use `window` (+ `anchor`). Pra VÁRIAS janelas em sequência (Janela 1..K, evolução, quem está parando, saúde), use get_affiliate_sequence.',
    {
      ...WINDOW_PROPS,
      view: { type: 'string', enum: ['partner', 'platform'], description: 'partner = contas unificadas (default); platform = por conta' },
      include_internal: { type: 'boolean', description: 'Incluir pseudo-afiliados internos (tracking de produto). Default false.' },
      platforms: SCOPE_PROPS.platforms, families: SCOPE_PROPS.families,
    },
  ),
  tool(
    'get_affiliate_explain',
    'POR QUÊ um afiliado/parceiro subiu ou caiu: drivers ordenados por impacto (volume de fronts × AOV — decomposição exata da Δreceita —, ticket do front, take rate de upsell, dias com venda, aprovação, reembolso, CPA renegociado, mix de família), janelas 3/7/15/30/60, série diária atual × anterior, quebra por família (share = fração) e por conta. drivers[].from/to seguem o `format` do driver (pct = fração). `key` vem de get_affiliate_analysis (partner:<id> ou aff:<id>).',
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
    'Análise de afiliados em SEQUÊNCIA de janelas: K janelas consecutivas de N dias (Janela 1 = mais antiga … Janela K = mais recente, terminando ontem ou no `anchor`). Igual aos modos Janelas / Evolução / Saúde da aba Análise de afiliados. Retorna: `windows` (totais, ativos, concentração top10, ranking de cada janela), `transitions` (Janela i → i+1: Δ receita/vendas/AOV com a CAUSA — retidos vs saldo novos−churn, quem mais subiu/caiu), `evolution` (trajetória de cada afiliado nas K janelas com tag e comentário; deltas = variação relativa em fração), `reactivation` (quem parou há 1 janela = mornos), `slowing` (sumiu na última janela ou caiu ≥ 50% do pico e segue caindo; dropPct = fração) e `health` (notas de saúde + risco de concentração). concentrationTop10/topShare2/retainedChangePct = fração. Use pra "como foram as últimas 3 semanas?", "quem está parando de rodar?", "evolução de X janela a janela", "saúde da base de afiliados".',
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
    'Funil de conversão por família (aba Funil): etapas (FE → Bump → UP1 → UP2 → UP3 → DW1 → DW2 → DW3) com volume, take rate (fração sobre as sessões com FE) e receita. revenueLiftFromUpsells = quanto o AOV das sessões COM upsell supera o das só-FE (fração) — não é a participação do upsell na receita. Cross-sell de outra família fica fora das etapas e aparece em crossSell. Com affiliate_ids, conta as sessões cujo FE é do afiliado (igual à aba).',
    { ...DATE_PROPS, platforms: SCOPE_PROPS.platforms, countries: SCOPE_PROPS.countries, families: SCOPE_PROPS.families, products: SCOPE_PROPS.products, affiliate_ids: AFFILIATE_PROP, affiliate_accounts: AFFILIATE_ACCOUNTS_PROP },
  ),
  tool(
    'get_funnel_sequence',
    'Funil por JANELAS em sequência (modo "Janelas & comparativo" da aba Funil): K janelas consecutivas de N dias terminando ontem ou no `anchor`, e pra cada uma o funil completo (etapas com volume, take rate sobre o FE e receita) + resumo (FEs, receita, AOV de sessão, lift de upsells). `scopes.all` = tudo; `scopes.<família>` = funil isolado da família. Cada escopo traz `notes` e `transitions` (Janela i → i+1: Δ receita decomposta em EFEITO DO VOLUME de FEs × EFEITO DO AOV de sessão, take rate por estágio com takePp = diferença em fração (0.05 = +5 pp) e efeito em $ a ticket constante, `topStage` e `note`). fePct/aovPct/revenuePct = variação relativa (fração). Use pra "o funil piorou nas últimas semanas?", "qual upsell caiu?", "foi volume ou conversão?".',
    {
      ...WINDOW_PROPS,
      count: { type: 'integer', description: 'Quantas janelas em sequência, 2 a 8 (default 3)' },
      platforms: SCOPE_PROPS.platforms, countries: SCOPE_PROPS.countries, families: SCOPE_PROPS.families, products: SCOPE_PROPS.products,
      affiliate_ids: AFFILIATE_PROP,
      affiliate_accounts: AFFILIATE_ACCOUNTS_PROP,
    },
  ),
  tool(
    'get_products',
    'TODOS os SKUs com performance (aba Produtos), sem corte de linhas: receita, pedidos, realOrders, refundRate/cbRate (fração: contagem pela data da VENDA ÷ realOrders — não é o card de reembolso), aprovação (fração), margem direta e atribuída ao funil (Pct = pontos percentuais), lucro estimado. URLs de página/checkout só com include_urls=true.',
    {
      ...DATE_PROPS, ...SCOPE_PROPS,
      include_urls: { type: 'boolean', description: 'Incluir URLs de página de vendas/checkout/obrigado/drive (default false).' },
    },
  ),
  tool(
    'get_families',
    'Visão por família de produto (aba Famílias): catálogo (SKUs por tipo), receita bruta/líquida, pedidos FE e totais, CPA, AOV (receita ÷ FEs), upsellLiftPct (fração: AOV com upsell vs só-FE).',
    { ...DATE_PROPS, platforms: SCOPE_PROPS.platforms, countries: SCOPE_PROPS.countries, families: SCOPE_PROPS.families, affiliate_ids: AFFILIATE_PROP, affiliate_accounts: AFFILIATE_ACCOUNTS_PROP },
  ),
  tool(
    'get_platforms',
    'Comparação entre plataformas (aba Plataformas — ClickBank, Digistore24, BuyGoods, Cartpanda, JVZoo): receita, pedidos, fees, NET. approvalRate/refundRate/cbRate = fração (contagem pela data da venda); feeRatePct, allowancePct (reserva), refundCbPct (manual, usado no modelo CPA) e observedRefundCbPct (coorte madura de 60–150 dias; amostra em observedRefundSample) = pontos percentuais.',
    { ...DATE_PROPS, ...SCOPE_PROPS },
  ),
  tool(
    'get_orders',
    'Transações individuais, paginadas (até 1000 por página; `total` = quantas existem no filtro). Para TOTAIS, somas e contagens por dimensão use aggregate_orders — não some páginas. `search` acha por ID do pedido/sessão ou ID/nickname do afiliado. Com status REFUNDED ou CHARGEBACK o período vale sobre a data do ESTORNO (igual à aba Transações e aos cards de reembolso); nos demais, sobre a data da venda. orderedAtBrt/eventAtBrt = horário de Brasília (orderedAt/eventAt = ISO UTC). Na Digistore o estorno é uma linha EXTRA (a venda original segue APPROVED) e pode vir com gross negativo.',
    {
      ...DATE_PROPS, ...SCOPE_PROPS,
      status: { type: 'string', enum: [...ORDER_STATUSES] },
      search: { type: 'string', description: 'Trecho do ID do pedido, do ID da sessão (parent) ou do ID/nickname do afiliado (case-insensitive).' },
      limit: { type: 'integer', description: 'Tamanho da página (default 200, máx 1000)' },
      offset: { type: 'integer', description: 'Deslocamento pra paginar (default 0)' },
    },
  ),
  tool(
    'get_profit_split',
    'Lucro FRONT × BACK do modelo CPA (painel e cards da Visão Geral). front.profitUsd = card "Net after CPA (modelo)" = Σ gross_p × (1 − (refund&cb%_p + fee%_p + opex%)/100) − CPA pago; totalUsd = front + back. refunds = cards "Taxa de reembolso" (valuePct, lente de VALOR) e "Reembolso por pedidos" (pct), em pontos percentuais: estornos pela DATA DO ESTORNO ÷ pedidos/faturamento do período pela data da venda (sem as linhas sintéticas da Digistore); refunds7d = monitor rolante de 7 dias a partir de agora (alerta > 10%). BACK = recuperação, Tauk, Logicall e SMS; SalesBound e Email aparecem com available:false e 0 — SalesBound NÃO entra no BACK aqui (a receita dele está em get_call_center). Com QUALQUER filtro de pedido (plataforma, país, família, afiliado) Tauk e Logicall saem do BACK — diga isso na resposta.',
    { ...DATE_PROPS, platforms: SCOPE_PROPS.platforms, countries: SCOPE_PROPS.countries, families: SCOPE_PROPS.families, affiliate_ids: AFFILIATE_PROP, affiliate_accounts: AFFILIATE_ACCOUNTS_PROP },
  ),
  tool(
    'get_costs_overview',
    'Custos e lucro de CUSTO REAL (lente de custo registrado; não há aba própria): receita, refunds, fulfillment, COGS, fees de plataforma, CPA, allowance reservado — total, por dia, por plataforma e por família. kpis.profitUsd = gross − fees − CPA − COGS − frete; marginPct = ÷ gross (pontos percentuais). byFamily.profitUsd NÃO desconta fee nem CPA. `daily` agrupa por dia UTC (não BRT). Custo por POTE fica em get_fulfillment.',
    { ...DATE_PROPS, ...SCOPE_PROPS },
  ),
  tool(
    'get_fulfillment',
    'Operação de envio (sem aba própria — só por aqui): potes enviados, gasto, custo por pote, projeções now-relative, saúde do custo, ciclos de fatura (fecham terça), por fornecedor e por família. fulfillmentPctOfGross/totalPctOfGross/invoiceBenchmarkPct = fração; trendPct e pctPackages = pontos percentuais. affiliate_ids restringe aos pedidos do afiliado.',
    { ...DATE_PROPS, platforms: SCOPE_PROPS.platforms, countries: SCOPE_PROPS.countries, families: SCOPE_PROPS.families, affiliate_ids: AFFILIATE_PROP, affiliate_accounts: AFFILIATE_ACCOUNTS_PROP },
  ),
  tool(
    'get_refund_cohorts',
    'Coortes de reembolso pelo dia da VENDA (aba Reembolsos — lente COORTE, censurada; diferente dos cards, que contam pela data do estorno): matriz idade × coorte (cells[i] = acumulado até i dias após a venda; null = coorte ainda não viveu esse dia), curva de maturação, taxa madura, projeção (mature-cohort pattern + Bornhuetter-Ferguson) e estornos fora do horizonte. pctCount/pctUsd, projection.* e periodPct* = fração. Coorte com menos de 30 dias ou base < 30 vendas é imatura/ruído.',
    {
      ...DATE_PROPS, ...SCOPE_PROPS,
      horizon: { type: 'integer', description: 'Horizonte em dias da matriz (7–180, default 30)' },
    },
  ),
  tool(
    'get_call_center',
    'Call center de recuperação por telefone (aba Call Center — Tauk, Logicall e SalesBound): vendas, receita, comissão, líquido, estornos, pendentes, série diária por parceiro (dia BRT), agentes (humano × IA), produtos, últimas vendas e estado da integração. commissionPct = fração (0.35 = 35%); commissionAssumed = comissão não configurada (valor assumido). SalesBound: estorno/void só chegam pelo CSV. Fica fora das ordens das plataformas (não está em get_overview).',
    {
      ...DATE_PROPS,
      provider: { type: 'string', enum: ['all', ...PROVIDERS], description: 'Parceiro (default all)' },
    },
  ),
  tool(
    'get_recovery',
    'Afiliados de recuperação (fonte de tráfego de recuperação, ex: lusk1nha — aba Recuperação): vendas aprovadas, comissão % vigente e devida, histórico de taxas. commissionPct/currentPct/effectivePct = fração (0.30 = 30%).',
    { ...DATE_PROPS },
  ),
  tool(
    'get_sms',
    'Saúde e conversão das campanhas de SMS (Mautic → Twilio; sem aba própria — só por aqui): enviados, entregues, falhas, respostas, conversões e receita por campanha/número, com semáforo de saúde. deliveryRate/stopRate = fração; deliveryRateDeltaPp = pontos percentuais.',
    {
      ...DATE_PROPS,
      brand: { type: 'string', description: 'Filtrar marca/família (opcional)' },
      campaign: { type: 'string', description: 'Filtrar campanha (opcional)' },
    },
  ),
  tool(
    'get_health',
    'Saúde da ingestão de dados: último IPN por plataforma (há quanto tempo), recebidos e falhas nas últimas 24h, taxa de aprovação/refund/chargeback 24h vs baseline 30d (fração), SKUs sem família, tamanho da materialized view. Use pra "os dados estão atualizados?" / "alguma plataforma parou de mandar?". Não recebe filtros.',
  ),
  {
    name: 'respond_with_blocks',
    description:
      'Tool TERMINAL pra entregar a resposta final em blocos estruturados (cards de KPI, insights, tabelas, charts) em vez de markdown puro. Use SEMPRE que a resposta contém ≥3 números OU lista ≥4 itens OU comparações entre entidades — quando o leitor vai escanear visualmente em vez de ler. Para perguntas curtas/conversa, NÃO use — responda em markdown direto. Chame SOZINHA, numa rodada própria, depois de ler os resultados das consultas. Todo número dos blocos é conferido contra os resultados das tools e contas do calc — número sem fonte volta como erro. Blocos: summary (KPIs hero), insights (cartões com severity), table (colunas tipadas, sem limite de linhas), markdown (texto), chart (line/bar/area). Números no formato US ($1,234.56 · 12.3%).',
    input_schema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          description: 'Base da resposta em 1 linha: período em dias BRT (diga se hoje é parcial), filtros aplicados e a LENTE do número principal. Ex.: "01–29/09/2026 BRT · Digistore24 · reembolso pela data do estorno (lente caixa)".',
        },
        sources: {
          type: 'array',
          items: { type: 'string' },
          description: 'Opcional: `source` dos trechos de search_knowledge/anexos em que os blocos se apoiam (ex.: "kb:<id>@v2#3", "anexo:<id>#p4") — viram o rodapé Fontes.',
        },
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
                    value: { type: 'string', description: 'Valor formatado, ex "$154,318" ou "12.4%"' },
                    delta: {
                      type: 'object',
                      properties: {
                        value: { type: 'string', description: 'ex "+8.2%" ou "−1.3 pp"' },
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
                    format: {
                      type: 'string',
                      enum: ['currency', 'percent', 'fraction', 'number', 'text'],
                      description: 'currency = US$; percent = número JÁ em pontos percentuais (12.3 → "12.3%"; campos com unidade pp em _meta.units, deltaPct/deltaPp do compare_periods e screenCards); fraction = 0–1 (0.123 → "12.3%"; campos com unidade fraction em _meta.units — *Rate, takeRate, commissionPct, upsellLiftPct, fePct/aovPct/revenuePct, dropPct, deltas.*.pct do get_overview). Siga _meta.units, não o nome do campo; number; text.',
                    },
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
      required: ['blocks', 'scope'],
    },
  },
];

export const TERMINAL_TOOL = 'respond_with_blocks';

// Pacotes de tools plugáveis (precisão, skills, RAG, anexos). Ordem FIXA: a
// lista de tools faz parte do prefixo cacheado do prompt — mudar a ordem por
// request invalidaria o cache.
const TOOL_MODULES: ToolModule[] = [PRECISION_TOOL_MODULE, SKILL_TOOL_MODULE, RAG_TOOL_MODULE, ATTACHMENT_TOOL_MODULE];

export const TOOLS: Anthropic.Tool[] = [...CORE_TOOLS, ...TOOL_MODULES.flatMap((m) => m.tools)];

// Propriedades de cada tool (define quem tem janela de datas, quem passa por
// normalizeScope e quais filtros entram em _meta.filtersApplied).
const TOOL_PROPS = new Map<string, Set<string>>(
  TOOLS.map((t) => [t.name, new Set(Object.keys((t.input_schema as { properties?: object }).properties ?? {}))]),
);
const SCOPE_TOOLS = new Set(
  [...TOOL_PROPS].filter(([, props]) => SCOPE_KEYS.some((k) => props.has(k))).map(([name]) => name),
);

// ── Input / contexto ────────────────────────────────────────────────────

export interface ToolInput {
  start_date?: string;
  end_date?: string;
  platforms?: string[];
  countries?: string[];
  families?: string[];
  products?: string[];
  stages?: string[];
  affiliate_ids?: string[];
  affiliate_accounts?: string[];
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
  include_urls?: boolean;
}

/**
 * Contexto por request: o período que o usuário está vendo na UI (default de
 * start/end quando o modelo omite datas — "por que caiu aqui?" consulta o que
 * está na tela) + o que o turno do chat carrega (usuário, resultados, fontes,
 * anexos). Definido em lib/ai/toolTypes.ts pros módulos de tools.
 */
export type { ToolContext } from '../ai/toolTypes';

// BRT é UTC-3 fixo. Converter "YYYY-MM-DD" → instante BRT antes de filtrar
// previne off-by-one: sem isso, end_date="2026-05-11" caía em 00:00 UTC =
// 21:00 BRT do dia 10, e a query "vendas de hoje" perdia a tarde/noite real.
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
// Default sem datas e sem UI: 30 dias BRT (29 fechados + hoje).
const DEFAULT_DAYS = 30;

/** Dia BRT `offsetDays` a partir do dia civil de `ref` (YYYY-MM-DD). */
function brtDayShift(ref: Date | string, offsetDays: number): string {
  const day = typeof ref === 'string' ? ref : formatBrt(ref).slice(0, 10);
  return new Date(Date.parse(day + 'T00:00:00Z') + offsetDays * DAY_MS).toISOString().slice(0, 10);
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

function str(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

export function parseFilters(input: ToolInput, ctx: ToolContext = {}): MetricsFilters {
  const start = dateArg(input.start_date, 'start_date');
  const end = dateArg(input.end_date, 'end_date');
  const now = ctx.now ?? new Date();
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
    // Só o fim: começa no início da UI se couber, senão 30 dias BRT antes.
    endDate = parseBrtEnd(end);
    startDate = ctx.defaultStart && ctx.defaultStart.getTime() <= endDate.getTime()
      ? ctx.defaultStart
      : parseBrtStart(brtDayShift(end, -(DEFAULT_DAYS - 1)));
  } else {
    // Sem UI: alinhado a dias BRT (antes: agora − 30×24h, que a MV do
    // overview arredondava pra 31 dias e as queries por instante não).
    startDate = ctx.defaultStart ?? parseBrtStart(brtDayShift(now, -(DEFAULT_DAYS - 1)));
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
    mappedAffiliateIds: affiliateIdsArg(input),
    affiliateIds: affiliateAccountsArg(input),
  };
}

function rangeSource(input: ToolInput, ctx: ToolContext): RangeSource {
  if (input.start_date || input.end_date) return 'explicit';
  return ctx.defaultStart && ctx.defaultEnd ? 'ui' : 'default';
}

/** affiliate_accounts (Affiliate.id) validados: [A-Za-z0-9_-], dedup. */
function affiliateAccountsArg(input: ToolInput): string[] | undefined {
  const raw = strList(input.affiliate_accounts);
  if (!raw) return undefined;
  const ids = affiliateIdsParam(raw.join(','));
  if (!ids) {
    throw new ToolInputError(`affiliate_accounts inválido (${raw.join(', ')}) — use o id da conta (Affiliate.id), não o nickname nem o ID da plataforma`, {
      hint: 'O Estado da UI traz as contas do filtro; pra um nome, resolve_entities.',
    });
  }
  return ids;
}

/** affiliate_ids validados como nas rotas (affiliateIdsParam: [A-Za-z0-9_-], dedup). */
function affiliateIdsArg(input: ToolInput): string[] | undefined {
  const raw = strList(input.affiliate_ids);
  if (!raw) return undefined;
  const ids = affiliateIdsParam(raw.join(','));
  // Tudo inválido: sem erro o filtro sumiria e o TOTAL sairia como "do afiliado".
  if (!ids) {
    throw new ToolInputError(`affiliate_ids inválido (${raw.join(', ')}) — use o affiliate_id do NorthScale Afiliados (letras, dígitos, _ e -), não o nickname da plataforma`, {
      hint: 'Ache o affiliate_id com resolve_entities ou em get_affiliates (campo mappedAffiliateId).',
    });
  }
  return ids;
}

// ── Execução ────────────────────────────────────────────────────────────

// Teto por tool: consulta que passar disso vira erro pro modelo (que pode
// estreitar o período e tentar de novo) em vez de segurar o turno inteiro.
export const TOOL_TIMEOUT_MS = 180_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ToolTimeoutError(label, ms)), ms);
  });
  return Promise.race([p, timeout]).finally(() => { if (timer) clearTimeout(timer); });
}

function callCenterProvider(raw: unknown): CallCenterProvider | 'all' {
  return (PROVIDERS as readonly unknown[]).includes(raw) ? (raw as CallCenterProvider) : 'all';
}

type Handler = (input: ToolInput, ctx: ToolContext) => Promise<unknown>;

/**
 * KPIs do anterior alinhado ([início−L, agora−L]). Com afiliado/SKU o
 * overview já lê a Order por instante (caminho legacy) — mesma função; no
 * caminho da MV (diária) usa a agregação por instante de views.ts.
 */
async function alignedPreviousKpis(filters: MetricsFilters, win: { start: Date; end: Date }): Promise<AiOverviewKpis> {
  const prevFilters: MetricsFilters = { ...filters, startDate: win.start, endDate: win.end };
  if (filters.mappedAffiliateIds?.length || filters.affiliateIds?.length || filters.productExternalIds?.length) {
    return stripNetProfit((await getOverview(prevFilters, false)).kpis);
  }
  return overviewKpisBetween(prevFilters);
}

const HANDLERS: Record<string, Handler> = {
  async get_overview(input, ctx) {
    const filters = parseFilters(input, ctx);
    const now = ctx.now ?? new Date();
    const compare = input.compare === true;
    // Janela atual inclui agora → anterior no MESMO tempo decorrido.
    const aligned = compare ? alignedPreviousWindow(filters.startDate, filters.endDate, now) : null;
    // Com afiliado ou SKU o serviço lê direto da Order (a MV não tem essas
    // dimensões) — o refresh forçado seria só espera. Sem eles, refresh antes
    // (o throttle de 60s dava MV defasada vs dado real; correção > latência).
    const viaMv = !filters.mappedAffiliateIds?.length && !filters.affiliateIds?.length && !filters.productExternalIds?.length;
    const [data, split, alignedPrev] = await Promise.all([
      (viaMv ? refreshDailyMetricsNow() : Promise.resolve()).then(() => getOverview(filters, compare && !aligned)),
      // Mesmo escopo do painel da tela: o profit split não recebe etapa/SKU.
      getProfitSplit({
        startDate: filters.startDate, endDate: filters.endDate, platformSlugs: filters.platformSlugs,
        productFamilies: filters.productFamilies, countries: filters.countries, mappedAffiliateIds: filters.mappedAffiliateIds,
        affiliateIds: filters.affiliateIds,
      }),
      aligned ? alignedPreviousKpis(filters, aligned) : Promise.resolve(null),
    ]);
    const kpis = stripNetProfit(data.kpis);
    const previous = alignedPrev ?? (data.previous ? stripNetProfit(data.previous) : null);
    const prevWindow = aligned ?? (previous ? servicePreviousWindow(filters.startDate, filters.endDate) : null);
    const notes: string[] = [];
    if (filters.productTypes?.length || filters.productExternalIds?.length) {
      notes.push('Cards de reembolso e Net after CPA (screenCards) vêm do profit split, que — como na tela — ignora o filtro de etapa/SKU.');
    }
    const meta: ToolMeta = {
      ...(prevWindow ? { previousRange: { startBrt: formatBrt(prevWindow.start), endBrt: formatBrt(prevWindow.end) } } : {}),
      ...(aligned ? { aligned: true } : {}),
      notes,
    };
    return {
      _meta: meta,
      range: data.range,
      kpis,
      ...(previous ? { previous, deltas: kpiDeltas(kpis, previous) } : {}),
      screenCards: buildScreenCards(kpis, split),
      daily: data.daily,
      byCountry: data.byCountry,
      byProductType: data.byProductType,
      topAffiliates: data.topAffiliates,
      platformHealth: data.platformHealth,
      hourlyHeatmap: labelHeatmap(data.hourlyHeatmap),
    };
  },
  async get_affiliates(input, ctx) {
    // A aba Afiliados NÃO aplica o filtro de etapa — aqui também não, senão
    // o chat mostraria receita só de FE enquanto a tela mostra tudo.
    const filters = parseFilters(input, ctx);
    filters.productTypes = undefined;
    const data = await getAffiliates(filters);
    const q = str(input.search).toLowerCase();
    // Sparkline (30 pontos/afiliado) só serve pra UI — fora do payload do
    // modelo. Sem corte de linhas: o modelo vê TODOS os afiliados.
    // Com affiliate_ids o serviço devolve TODAS as contas (as de fora zeradas);
    // pro modelo só interessam as que têm pedido no recorte.
    const byAffiliate = !!filters.mappedAffiliateIds?.length || !!filters.affiliateIds?.length;
    const affiliates = data.affiliates
      .filter((a) => !byAffiliate || a.allOrders > 0)
      .filter((a) => !q || String(a.externalId ?? '').toLowerCase().includes(q) || String(a.nickname ?? '').toLowerCase().includes(q))
      .map((a) => {
        const { sparkline: _sparkline, ...rest } = a;
        return rest;
      });
    return { summary: data.summary, totalCount: data.affiliates.length, returned: affiliates.length, affiliates };
  },
  async get_affiliate_detail(input, ctx) {
    const id = str(input.external_id);
    if (!id) throw new ToolInputError('external_id obrigatório', { hint: 'Passe o nickname ou o ID da conta do afiliado (get_affiliates com search ajuda a achar).' });
    const hint = str(input.platform) || undefined;
    const filters = parseFilters(input, ctx);
    // O service casa externalId EXATO. O usuário costuma citar o nickname
    // (ou o ID em outra caixa) — resolve antes, case-insensitive. Várias
    // contas casando (mesmo nick em plataformas diferentes): usa a de venda
    // mais recente e devolve as outras em `alternatives` (antes escolhia
    // calado).
    // BuyGoods: a conta é `aff_id@loja` (o aff_id é numerado por loja) — o "62"
    // citado casa todas as lojas, e cada loja é uma pessoa diferente.
    const matches = await db.affiliate.findMany({
      where: {
        OR: [
          { externalId: { equals: id, mode: 'insensitive' } },
          { nickname: { equals: id, mode: 'insensitive' } },
          ...(id.includes('@') ? [] : [{ externalId: { startsWith: `${id}@` }, platform: { slug: 'buygoods' } }]),
        ],
        ...(hint ? { platform: { slug: hint } } : {}),
      },
      orderBy: { lastOrderAt: { sort: 'desc', nulls: 'last' } },
      take: 10,
      select: { externalId: true, nickname: true, lastOrderAt: true, platform: { select: { slug: true } } },
    });
    const chosen = matches[0];
    const detail = await getAffiliateDetail(chosen?.externalId ?? id, filters, hint ?? chosen?.platform.slug);
    if (!detail) {
      return toolError('not_found', `Afiliado "${id}" não encontrado.`, { hint: 'Procure com get_affiliates (search) ou resolve_entities pra achar o ID exato.' });
    }
    const alternatives = matches.slice(1).map((m) => ({
      externalId: m.externalId,
      nickname: m.nickname,
      platform: m.platform.slug,
      lastOrderAt: m.lastOrderAt ? m.lastOrderAt.toISOString() : null,
    }));
    if (!alternatives.length) return detail;
    return {
      _meta: {
        notes: [
          `"${id}" casa com ${matches.length} contas — este é ${chosen.platform.slug}:${chosen.externalId} (venda mais recente). Pra outra, repita com platform + external_id de alternatives.`,
          ...(matches.some((m) => m.platform.slug === 'buygoods' && m.externalId.includes('@'))
            ? ['BuyGoods numera o afiliado por loja (aff_id@loja): o mesmo número em lojas diferentes é outra pessoa — nunca some as contas sem confirmar que são a mesma.']
            : []),
        ],
      },
      ...detail,
      alternatives,
    };
  },
  async get_affiliate_analysis(input) {
    const w = windowArgs(input);
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
    const key = str(input.key);
    if (!/^(partner|aff):[A-Za-z0-9_-]+$/.test(key)) {
      throw new ToolInputError('key deve ser partner:<id> ou aff:<id>', { hint: 'Pegue a `key` de uma linha de get_affiliate_analysis.' });
    }
    const w = windowArgs(input);
    const r = await getAffiliateExplain(key, {
      ...w, view: 'partner', includeInternal: input.include_internal === true,
      platformSlugs: strList(input.platforms), families: strList(input.families), includeContact: false,
    });
    return r ?? toolError('not_found', `entidade ${key} não encontrada`, { hint: 'Confira a key em get_affiliate_analysis (a entidade precisa ter atividade nas janelas).' });
  },
  async get_affiliate_sequence(input) {
    const w = windowArgs(input);
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
    return getFunnelSequence({
      ...w, count: countArg(input),
      platformSlugs: strList(input.platforms), countries: strList(input.countries),
      productFamilies: strList(input.families), productExternalIds: strList(input.products),
      mappedAffiliateIds: affiliateIdsArg(input),
      affiliateIds: affiliateAccountsArg(input),
    });
  },
  async get_products(input, ctx) {
    const data = await getProducts(parseFilters(input, ctx));
    const products = productRows(data.products, input.include_urls === true);
    return { ...data, totalCount: products.length, products };
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
    const search = str(input.search);
    const data = await getOrders(parseFilters(input, ctx), { status, limit, offset, ...(search ? { search } : {}) });
    return {
      ...data,
      orders: orderRows(data.orders),
      page: { limit, offset, returned: data.orders.length, total: data.total, hasMore: offset + data.orders.length < data.total },
    };
  },
  async get_profit_split(input, ctx) {
    const f = parseFilters(input, ctx);
    return getProfitSplit({ startDate: f.startDate, endDate: f.endDate, platformSlugs: f.platformSlugs, productFamilies: f.productFamilies, countries: f.countries, mappedAffiliateIds: f.mappedAffiliateIds, affiliateIds: f.affiliateIds });
  },
  async get_costs_overview(input, ctx) {
    return getCostsOverview(parseFilters(input, ctx));
  },
  async get_fulfillment(input, ctx) {
    const f = parseFilters(input, ctx);
    return getFulfillment({ startDate: f.startDate, endDate: f.endDate, platformSlugs: f.platformSlugs, countries: f.countries, productFamilies: f.productFamilies, mappedAffiliateIds: f.mappedAffiliateIds, affiliateIds: f.affiliateIds });
  },
  async get_refund_cohorts(input, ctx) {
    const f = parseFilters(input, ctx);
    const horizon = Math.trunc(Number(input.horizon) || 30);
    return getRefundCohorts(
      { startDate: f.startDate, endDate: f.endDate, platformSlugs: f.platformSlugs, productFamilies: f.productFamilies, productExternalIds: f.productExternalIds, productTypes: f.productTypes, countries: f.countries, mappedAffiliateIds: f.mappedAffiliateIds, affiliateIds: f.affiliateIds },
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
    const brand = str(input.brand) || null;
    const campaign = str(input.campaign) || null;
    return getSms({ startDate: f.startDate, endDate: f.endDate, brand, campaign });
  },
  async get_health() {
    return getHealth();
  },
  async respond_with_blocks() {
    // Terminal: o motor intercepta esta tool antes de chamar executeTool.
    // Se cair aqui é porque alguém esqueceu de filtrar — devolve ack pra
    // não travar o loop.
    return { ok: true };
  },
};

const MODULE_HANDLERS: Record<string, Handler> = Object.assign(
  {},
  ...TOOL_MODULES.map((m) => m.handlers as Record<string, Handler>),
);

/** Nomes das tools que têm handler — usado pelos testes de cobertura. */
export const HANDLED_TOOL_NAMES = [...Object.keys(HANDLERS), ...Object.keys(MODULE_HANDLERS)];

// ── _meta ───────────────────────────────────────────────────────────────

// Filtros "extra" (além do escopo) que mudam o número e por isso entram em
// filtersApplied quando a tool os aceita.
const EXTRA_FILTER_KEYS = [
  'status', 'search', 'provider', 'horizon', 'compare', 'window', 'anchor', 'include_today', 'count', 'view',
  'key', 'external_id', 'platform', 'brand', 'campaign', 'include_internal', 'include_urls', 'limit', 'offset',
] as const;
// Filtros que restringem o conjunto (vazio com eles = conferir antes de dizer "zero").
const NARROWING_KEYS = ['platforms', 'countries', 'families', 'products', 'stages', 'affiliate_ids', 'affiliate_accounts', 'search', 'status', 'external_id', 'platform', 'brand', 'campaign'];

function appliedFilters(props: Set<string>, input: ToolInput, f: MetricsFilters | undefined): Record<string, unknown> {
  const raw = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const put = (k: string, v: unknown) => {
    if (props.has(k) && v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)) out[k] = v;
  };
  // Valores RESOLVIDOS (pós-normalização e parse: etapa 'FE' → FRONTEND).
  put('platforms', f ? f.platformSlugs : strList(raw.platforms));
  put('countries', f ? f.countries : strList(raw.countries));
  put('families', f ? f.productFamilies : strList(raw.families));
  put('products', f ? f.productExternalIds : strList(raw.products));
  put('stages', f ? f.productTypes : strList(raw.stages));
  put('affiliate_ids', f ? f.mappedAffiliateIds : strList(raw.affiliate_ids));
  put('affiliate_accounts', f ? f.affiliateIds : strList(raw.affiliate_accounts));
  for (const k of EXTRA_FILTER_KEYS) put(k, raw[k]);
  if (out.provider === 'all') delete out.provider;
  return out;
}

async function safeDataQuality(tool: string, platformSlugs: string[] | undefined): Promise<DataQualityNote[] | undefined> {
  try {
    return await dataQualityFor(tool, platformSlugs);
  } catch (err) {
    // Ressalva é complemento: falhar aqui não pode derrubar o número.
    logger.warn({ tool, err: err instanceof Error ? err.message : String(err) }, '[chat] dataQuality falhou');
    return undefined;
  }
}

async function buildMeta(tool: string, input: ToolInput, ctx: ToolContext, value: Record<string, unknown>, scopeNotes: string[]): Promise<ToolMeta> {
  const props = TOOL_PROPS.get(tool) ?? new Set<string>();
  const now = ctx.now ?? new Date();
  let range: RangeMeta | undefined;
  let filters: MetricsFilters | undefined;
  let platformSlugs = strList((input as Record<string, unknown>).platforms);
  if (props.has('start_date')) {
    try {
      // parseFilters é pura: recalcular dá exatamente a janela que o handler usou.
      filters = parseFilters(input, ctx);
      range = rangeMeta(filters.startDate, filters.endDate, now, rangeSource(input, ctx));
      platformSlugs = filters.platformSlugs;
    } catch {
      // Tool de módulo com semântica de data própria: sem range aqui.
    }
  } else if (props.has('window')) {
    const span = windowSpanOf(tool, value);
    if (span) range = rangeMetaFromDays(span.start, span.end, now, input.anchor ? 'explicit' : 'default');
  }
  // Tool que resolve o próprio período (aggregate_orders com end_time,
  // get_net_profit) devolve `period` — esse é o autoritativo; um range
  // recalculado aqui divergiria (parseFilters não conhece end_time).
  const own = value.period as { startBrt?: unknown } | undefined;
  if (own && typeof own === 'object' && typeof own.startBrt === 'string') range = undefined;
  const filtersApplied = appliedFilters(props, input, filters);
  const narrowed = NARROWING_KEYS.some((k) => k in filtersApplied);
  return {
    range,
    filtersApplied,
    units: unitsFor(tool, value),
    // dataQualityFor decide quais tools têm ressalva (reembolso/lucro/comissão)
    // e devolve [] pras demais — uma lista só, a dela.
    dataQuality: await safeDataQuality(tool, platformSlugs),
    notes: [...scopeNotes, ...(TOOL_NOTES[tool] ?? [])],
    ...(narrowed && isEmptyResult(tool, value) ? { emptyWithFilters: true as const } : {}),
  };
}

async function runTool(name: string, handler: Handler, rawInput: ToolInput, ctx: ToolContext): Promise<unknown> {
  const scoped = SCOPE_TOOLS.has(name)
    ? await normalizeScope(name, rawInput as Record<string, unknown>)
    : { input: rawInput as Record<string, unknown>, notes: [] as string[] };
  const input = scoped.input as ToolInput;
  const value = await handler(input, ctx);
  if (!value || typeof value !== 'object' || Array.isArray(value) || isContentResult(value)) return value;
  const obj = value as Record<string, unknown>;
  if (obj.error) return normalizeErrorResult(obj);
  if (name === TERMINAL_TOOL) return value;
  const meta = await buildMeta(name, input, ctx, obj, scoped.notes);
  return tagTool(attachMeta(obj, meta), name);
}

/**
 * Executor de tool calls. Recebe nome + input do tool_use block, devolve
 * o resultado (com `_meta`) ou um erro na forma única — nunca uma exceção
 * que derrube o turno.
 */
export async function executeTool(name: string, input: ToolInput, ctx: ToolContext = {}): Promise<unknown> {
  const handler = HANDLERS[name] ?? MODULE_HANDLERS[name];
  if (!handler) return toolError('unknown_tool', `tool desconhecida: ${name}`, { hint: 'Use só as tools da lista.' });
  const startedAt = Date.now();
  // ctx.exec: módulos chamam outras tools pelo mesmo caminho (validação,
  // timeout, erro estruturado) sem importar este arquivo.
  const execCtx: ToolContext = ctx.exec ? ctx : { ...ctx, exec: (n, i) => executeTool(n, i as ToolInput, ctx) };
  try {
    return await withTimeout(runTool(name, handler, (input ?? {}) as ToolInput, execCtx), TOOL_TIMEOUT_MS, name);
  } catch (err) {
    const { result, log } = errorFromException(err);
    if (log) logger.warn({ tool: name, ms: Date.now() - startedAt, err: err instanceof Error ? err.message : String(err) }, '[chat] tool falhou');
    return result;
  }
}
