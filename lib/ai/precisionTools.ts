// Tools de PRECISÃO (contas e agregações determinísticas, comparação de
// períodos, cobertura de dado, resolução de nomes, modelo de lucro):
// calc, aggregate_result, aggregate_orders, compare_periods,
// get_data_coverage, resolve_entities, get_profit_model, get_net_profit.
//
// Pra chamar outra tool (ex.: compare_periods roda get_overview 2×) use
// ctx.exec(name, input) — nunca importe executeTool daqui (import circular).
//
// Schemas com additionalProperties:false e `required` explícito, mas SEM
// strict:true: o modo estrito tem teto de parâmetros opcionais/uniões por
// request somando TODAS as tools — estourar derrubaria o chat inteiro com
// 400. A validação acontece aqui, no handler, com erro que diz o que é
// válido.

import type Anthropic from '@anthropic-ai/sdk';
import type { ModuleHandler, ToolContext, ToolModule } from './toolTypes';
import { CALC_UNITS, CalcError, MAX_EXPRESSIONS, parseCalcInput, runCalc } from './calc';
import { AggregateInputError, METRIC_OPS, WHERE_OPS, parseAggregateSpec, runAggregate } from './aggregate';
import {
  METRIC_UNITS, ORDER_DIMENSIONS, ORDER_METRICS, ORDER_STATUSES, OrderAggInputError, PRODUCT_TYPES,
  parseOrderAggSpec, runOrderAggregate,
} from './orderAggregate';
import { COMPARE_TOOLS, PeriodInputError, brtToday, resolveInstants, runComparePeriods } from './compare';
import { ENTITY_KINDS, resolveEntities, type EntityKind } from './entities';
import { getDataCoverage } from './coverage';
import { NetProfitInputError, getNetProfitForChat, getProfitModel } from './profitTools';

type JsonSchema = Record<string, unknown>;

function tool(name: string, description: string, properties: Record<string, JsonSchema>, required: string[] = []): Anthropic.Tool {
  return { name, description, input_schema: { type: 'object', properties, required, additionalProperties: false } };
}

const DATE: Record<string, JsonSchema> = {
  start_date: { type: 'string', description: 'Início (YYYY-MM-DD, dia BRT). Omitido = período da tela, senão últimos 30 dias.' },
  end_date: { type: 'string', description: 'Fim (YYYY-MM-DD, dia BRT, inclusivo).' },
};
const strList = (description: string, items: JsonSchema = { type: 'string' }): JsonSchema => ({ type: 'array', items, description });
const SCOPE: Record<string, JsonSchema> = {
  platforms: strList('Slugs: clickbank | digistore24 | buygoods | cartpanda | jvzoo (sinônimos cb/d24/bg/cp/jvz são corrigidos)'),
  families: strList('Família canônica (ex.: NeuroMindPro; NeuroPulsePro é OUTRA família) — use resolve_entities se em dúvida'),
  products: strList('externalId do SKU'),
  stages: strList('Etapa (productType)', { type: 'string', enum: [...PRODUCT_TYPES] }),
  countries: strList('ISO-2 (US, GB, CA, AU…)'),
  affiliate_ids: strList('affiliate_id do NorthScale Afiliados (filtro "Afiliado" da tela) — não é o nickname da plataforma'),
};

// ── Erros de input no formato unificado ──────────────────────────────────

function inputError(message: string): Record<string, unknown> {
  const msg = message.replace(/^invalid_input:\s*/, '');
  const m = /— valid: (.+?)(?: · |$)/.exec(msg);
  const validValues = m ? m[1].split(', ').filter((v) => v && !v.startsWith('…')) : undefined;
  return { error: 'invalid_input', message: msg, retryable: false, ...(validValues?.length ? { validValues } : {}) };
}

const INPUT_ERRORS = [CalcError, AggregateInputError, OrderAggInputError, PeriodInputError, NetProfitInputError];

/** Erro de input vira resposta estruturada; o resto sobe (executeTool loga e embrulha). */
function guarded(fn: ModuleHandler): ModuleHandler {
  return async (input, ctx) => {
    try {
      return await fn(input ?? {}, ctx);
    } catch (err) {
      if (err instanceof Error && (INPUT_ERRORS.some((E) => err instanceof E) || err.message.startsWith('invalid_input:'))) {
        return inputError(err.message);
      }
      throw err;
    }
  };
}

const BRT_OFFSET_MS = 3 * 3600 * 1000;
const brtStamp = (d: Date) => new Date(d.getTime() - BRT_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');

// ── Definições ───────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  tool(
    'calc',
    'Calculadora DETERMINÍSTICA. Use para TODA conta com números das tools: soma, diferença, variação %, participação, média ponderada, projeção, break-even. Nunca calcule de cabeça — todo número exibido que não vem literalmente de uma tool precisa sair daqui (os blocos passam por checagem de números). Referencie valores pelo caminho em vez de redigitar: $r3.kpis.gross · $r2.platforms[slug=digistore24].refundRate · $r5.affiliates[*].revenue (lista) · $r4.windows[-1].rows · $r1.scopes["Lumicept Gummies"]. Só resultados de rodadas ANTERIORES (o _ref no topo de cada resultado). Cada expressão pode usar os nomes definidos antes na lista (e de calcs anteriores). Operadores + - * / ^ ( ). Funções: sum, avg, median, min, max, count (aceitam listas); abs; round(x, casas); safe_div(a, b) (null se b = 0); pct_change(novo, antigo) = variação em PONTOS PERCENTUAIS (12.5 = +12.5%); pp_change(fração_nova, fração_antiga) = diferença em pp; share(parte, total) = % do total; weighted_avg(valores, pesos); cagr(fim, início, períodos) em %. Ponto decimal, sem separador de milhar. Divisão por zero = erro (value null). `display` já vem no formato da resposta (US: $1,234.56 · 12.3%) — copie pros blocos.',
    {
      expressions: {
        type: 'array', minItems: 1, maxItems: MAX_EXPRESSIONS,
        description: 'Expressões nomeadas, avaliadas em ordem.',
        items: {
          type: 'object', additionalProperties: false, required: ['name', 'expr'],
          properties: {
            name: { type: 'string', description: 'Identificador em minúsculas, dígitos e _ (ex.: var_receita)' },
            expr: { type: 'string', description: 'Ex.: pct_change($r3.kpis.gross, $r4.kpis.gross)' },
            unit: { type: 'string', enum: [...CALC_UNITS], description: 'usd | percent (pontos: 12.3) | pp | fraction (0–1) | count | number | days. Default: percent em pct_change/share/cagr, pp em pp_change, senão number.' },
          },
        },
      },
    },
    ['expressions'],
  ),
  tool(
    'aggregate_result',
    'Filtra, agrupa e resume uma LISTA de um resultado já lido ($rN), sobre a lista COMPLETA — mesmo que você tenha visto só parte dela (_truncated). Use em vez de somar/contar linhas de cabeça: "receita dos afiliados da Digistore com refund > 15%", "média ponderada do AOV por FEs", "top 10 por NET AFTER CPA". Taxa agregada = ratio_of_sums(num, den) (ex.: refunds ÷ realOrders) — NUNCA avg de taxas. Métricas: sum, avg, min, max, median, count, count_distinct, weighted_avg (field + weight), ratio_of_sums (num + den), first. Filtros: eq, ne, gt, gte, lt, lte, in, contains, is_null, not_null (texto sem diferenciar maiúsculas). Devolve rows, matched (linhas que passaram no filtro), sourceRows (tamanho da lista) e totals (métricas sobre todas as linhas filtradas, antes do limit).',
    {
      ref: { type: 'string', description: 'Ref do resultado: "r3" (o _ref no topo do resultado)' },
      path: { type: 'string', description: 'Lista dentro do resultado: "affiliates", "windows[-1].rows", "windows[*].rows" (todas as janelas). Omitido = a única lista do resultado.' },
      where: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['field', 'op'],
          properties: {
            field: { type: 'string', description: 'Campo (aceita caminho com ponto: "platform.slug")' },
            op: { type: 'string', enum: [...WHERE_OPS] },
            value: { description: 'Número, texto, ou lista (op in)' },
          },
        },
      },
      group_by: { type: 'array', maxItems: 3, items: { type: 'string' }, description: 'Campos de agrupamento (até 3)' },
      metrics: {
        type: 'array', maxItems: 20,
        items: {
          type: 'object', additionalProperties: false, required: ['name', 'op'],
          properties: {
            name: { type: 'string', description: 'Nome da coluna de saída' },
            op: { type: 'string', enum: [...METRIC_OPS] },
            field: { type: 'string' },
            weight: { type: 'string', description: 'Peso (weighted_avg)' },
            num: { type: 'string', description: 'Numerador (ratio_of_sums)' },
            den: { type: 'string', description: 'Denominador (ratio_of_sums)' },
          },
        },
      },
      sort: {
        type: 'object', additionalProperties: false, required: ['by'],
        properties: { by: { type: 'string' }, dir: { type: 'string', enum: ['asc', 'desc'] } },
      },
      limit: { type: 'integer', description: 'Máximo de linhas devolvidas (default 100, máx 1000)' },
      select: { type: 'array', items: { type: 'string' }, description: 'Sem group_by/metrics: campos a devolver de cada linha' },
    },
    ['ref'],
  ),
  tool(
    'aggregate_orders',
    'GROUP BY de pedidos direto no banco — use em vez de paginar get_orders pra somar/contar (nunca some páginas). Dimensões: day/week/month/hour/dow (em BRT; week = segunda), platform, family, product, product_type, country, status, affiliate (plataforma:externalId), mapped_affiliate, payment_method, traffic_source, funnel_step. Métricas: rows (linhas), real_orders (pedidos reais — sem as linhas sintéticas de estorno da Digistore), approved, refunds, chargebacks, gross_approved (= receita bruta da Visão Geral), gross_original (valor original de toda venda, lente "Date of Event"), net, cpa, cogs, fulfillment, refunded_usd (valor devolvido), fe_sessions e aov_session (AOV canônico por sessão com FE, agrupado pela linha do FE), approval_rate e refund_rate (FRAÇÃO, ÷ real_orders). date_axis: sale (data da venda, default) ou refund_event (data em que o estorno/chargeback ACONTECEU — lente caixa dos cards; aí refund_rate = estornos do período ÷ pedidos reais vendidos no período). end_time corta o último dia na hora BRT (hoje até agora × ontem até a mesma hora). Sem group_by devolve só o total.',
    {
      ...DATE,
      end_time: { type: 'string', description: 'HH:MM BRT — o ÚLTIMO dia vai só até essa hora (exige end_date)' },
      date_axis: { type: 'string', enum: ['sale', 'refund_event'], description: 'Eixo da data (default sale)' },
      ...SCOPE,
      status: strList('Filtrar status', { type: 'string', enum: [...ORDER_STATUSES] }),
      group_by: { type: 'array', maxItems: 3, items: { type: 'string', enum: [...ORDER_DIMENSIONS] } },
      metrics: { type: 'array', items: { type: 'string', enum: [...ORDER_METRICS] }, description: 'Default: approved, gross_approved' },
      order_by: { type: 'string', description: 'Métrica pedida ou dimensão (default: tempo crescente quando a 1ª dimensão é de tempo; senão a 1ª métrica)' },
      dir: { type: 'string', enum: ['asc', 'desc'] },
      limit: { type: 'integer', description: 'Linhas devolvidas (default 200, máx 1000); totals sempre cobre todos os grupos' },
    },
  ),
  tool(
    'compare_periods',
    'Compara a MESMA tool em dois períodos com a conta feita no servidor: toda métrica numérica vem como {a, b, delta, deltaPct (pontos %), deltaPp (taxas)}; listas de entidades (afiliados, produtos, plataformas, famílias…) casadas por chave com movers (maiores variações), onlyInA e onlyInB. get_funnel traz a decomposição volume de FEs × AOV de sessão e a take rate por etapa; get_overview traz a mesma decomposição da receita das sessões. Alinhamento: com A incluindo hoje (parcial), o default (auto) compara o MESMO tempo decorrido — em aggregate_orders corta B na mesma hora; nas demais usa só os dias fechados dos dois lados. Períodos com tamanhos diferentes ganham perDayNormalized. Os resultados completos de A e B ficam em refs próprias (a.ref, b.ref) pra aggregate_result/calc. Use pra "vs semana passada", "vs mês anterior", "vs mesmo período do ano passado", "hoje vs ontem até agora" (tool=aggregate_orders).',
    {
      tool: { type: 'string', enum: [...COMPARE_TOOLS] },
      a: {
        type: 'object', additionalProperties: false, required: ['start_date', 'end_date'],
        description: 'Período principal (dias BRT). Omitido = o da tela.',
        properties: { start_date: DATE.start_date, end_date: DATE.end_date },
      },
      b: {
        type: 'object', additionalProperties: false,
        description: 'Base de comparação: datas OU preset. Omitido = previous (janela imediatamente anterior, mesmo tamanho).',
        properties: {
          start_date: DATE.start_date,
          end_date: DATE.end_date,
          preset: { type: 'string', enum: ['previous', 'previous_year', 'same_weekday_last_week'] },
        },
      },
      align: { type: 'string', enum: ['auto', 'full', 'same_elapsed'], description: 'auto (default): same_elapsed quando A inclui hoje; full: períodos como estão' },
      filters: {
        type: 'object', additionalProperties: false, description: 'Filtros aplicados aos dois períodos',
        properties: {
          ...SCOPE,
          provider: { type: 'string', enum: ['all', 'tauk', 'logicall', 'salesbound'], description: 'Só get_call_center' },
          search: { type: 'string', description: 'Só get_affiliates' },
        },
      },
      aggregate: {
        type: 'object', additionalProperties: false, description: 'Só com tool=aggregate_orders: o que agrupar/medir',
        properties: {
          group_by: { type: 'array', maxItems: 3, items: { type: 'string', enum: [...ORDER_DIMENSIONS] } },
          metrics: { type: 'array', items: { type: 'string', enum: [...ORDER_METRICS] } },
          date_axis: { type: 'string', enum: ['sale', 'refund_event'] },
          status: strList('Filtrar status', { type: 'string', enum: [...ORDER_STATUSES] }),
          order_by: { type: 'string' },
          dir: { type: 'string', enum: ['asc', 'desc'] },
          limit: { type: 'integer' },
        },
      },
      top: { type: 'integer', description: 'Quantos movers/onlyIn por lista (default 20, máx 100)' },
    },
    ['tool'],
  ),
  tool(
    'get_data_coverage',
    'Qualidade do dado que MUDA a leitura dos números: plataformas com vendas e zero estorno registrado (falha de ingestão — o reembolso delas sai 0%), lacuna conhecida de IPN da Digistore (~28% dos estornos só entram pelo reconcile CSV, com a data do último), ingestão parada ou com falhas por plataforma, pedidos com custo pendente no catálogo, comissão assumida da Logicall, fuso de cada plataforma e lacunas conhecidas (EPC indisponível, SalesBound fora do BACK do profit split). Chame antes de concluir sobre reembolso, lucro ou "queda de hoje/ontem". Os avisos relevantes também chegam sozinhos em _meta.dataQuality das tools de reembolso/lucro.',
    { platforms: SCOPE.platforms },
  ),
  tool(
    'resolve_entities',
    'Transforma nomes citados pelo usuário nos valores EXATOS dos filtros: plataforma (cb/d24/bg…), família (inclui grafias do banco; NeuroPulsePro ≠ NeuroMindPro), país (ISO-2), etapa, status (CB pode ser chargeback!), SKU, conta de afiliado na plataforma (nickname/ID → get_affiliate_detail), afiliado do NorthScale Afiliados (→ affiliate_ids) e parceiro (identidade unificada → get_affiliate_explain key partner:<id>). Cada candidato traz `use` (argumentos prontos pros filtros) e `drill` (chamada de detalhe). Use ANTES de filtrar quando o nome não for exatamente um valor canônico — filtro errado devolve zero, não erro.',
    {
      terms: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'string' }, description: 'Nomes a resolver (ex.: ["neuro pulse", "fenix2025", "d24"])' },
      kinds: { type: 'array', items: { type: 'string', enum: [...ENTITY_KINDS] }, description: 'Restringe os tipos (default: todos)' },
      limit: { type: 'integer', description: 'Candidatos por termo (default 8, máx 20)' },
    },
    ['terms'],
  ),
  tool(
    'get_profit_model',
    'Premissas do modelo de lucro CPA (o que está por trás de NET AOV, NET AFTER CPA, cpaStatus e do Net after CPA do get_profit_split): fórmulas, opex% global, régua do status (healthyMinUsd/attentionMinUsd), metas de reembolso D30 e chargeback, e por plataforma: fee%, allowance%, refund&cb% USADO pelo modelo (e se veio do manual ou da coorte madura observada) ao lado do observado por pedidos e por valor. Todos os % em pontos percentuais. Use pra "quanto posso pagar de CPA", break-even, sensibilidade e pra explicar por que um afiliado está em renegociar.',
    {},
  ),
  tool(
    'get_net_profit',
    'SÓ ADMIN. Margem de contribuição OFICIAL da aba Lucro real: receita econômica (plataformas + parcela NorthScale do backend), custos variáveis, lucro, margem oficial (÷ receita econômica), lucro por FE, buffer, por canal (front, call center, recuperação, SalesBound), por família e por afiliado, avisos e o que falta o admin informar. daily=true adiciona a série por dia (até 62 dias). Diga sempre que esta é a lente oficial — difere do Net after CPA (modelo) e do lucro de custo real.',
    {
      ...DATE,
      daily: { type: 'boolean', description: 'Inclui a série por dia (período de até 62 dias)' },
    },
  ),
];

// ── Handlers ─────────────────────────────────────────────────────────────

function readableRef(ctx: ToolContext, ref: string): unknown {
  const store = ctx.results;
  const stored = store?.get(ref);
  if (!store || !stored) {
    const avail = store?.readable().map((r) => `$${r.ref} (${r.tool})`) ?? [];
    throw new CalcError(`$${ref} não existe${avail.length ? ` — disponíveis: ${avail.join(', ')}` : ' — chame as tools de dados antes'}`);
  }
  if (stored.round >= store.currentRound()) {
    throw new CalcError(`$${ref} é desta mesma rodada — referencie só resultados que você já leu (rodadas anteriores)`);
  }
  return stored.value;
}

const HANDLERS: Record<string, ModuleHandler> = {
  async calc(input, ctx) {
    const parsed = parseCalcInput(input);
    if (typeof parsed === 'string') return inputError(parsed);
    const store = ctx.results;
    return runCalc(parsed, {
      ref: (ref) => readableRef(ctx, ref),
      previous: store?.calcValues(),
      save: (name, value) => store?.putCalc(name, value),
    });
  },

  async aggregate_result(input, ctx) {
    const ref = typeof input.ref === 'string' ? input.ref.trim().replace(/^\$/, '') : '';
    if (!/^r\d+$/.test(ref)) return inputError('ref deve ser "rN" (o _ref no topo de um resultado anterior)');
    const value = readableRef(ctx, ref);
    const stored = ctx.results!.get(ref)!;
    const out = runAggregate(value, parseAggregateSpec(input));
    return { source: { ref, tool: stored.tool }, ...out };
  },

  // Filtros de escopo já chegam normalizados: executeTool roda
  // normalizeScope antes de todo handler que tem platforms/families/…
  async aggregate_orders(input, ctx) {
    const now = ctx.now ?? new Date();
    const { startAt, endAt, source } = resolveInstants(input, ctx, now);
    const spec = parseOrderAggSpec(input, { startAt, endAt });
    const result = await runOrderAggregate(spec);
    const notes = ['Dias, semanas e horas em BRT.'];
    if (spec.metrics.includes('approval_rate') || spec.metrics.includes('refund_rate')) {
      notes.push('approval_rate/refund_rate são FRAÇÃO sobre pedidos reais (sem as linhas sintéticas de estorno da Digistore) — não são o kpis.approvalRate/refundRate do get_overview (que dividem por todas as linhas).');
    }
    if (spec.metrics.includes('refund_rate')) {
      notes.push(spec.axis === 'sale'
        ? 'refund_rate no eixo da venda = lente COORTE (estornos das vendas feitas no período; vendas recentes ainda não maturaram). A taxa da tela (cards) é o eixo refund_event.'
        : 'refund_rate no eixo refund_event = lente CAIXA dos cards: estornos que aconteceram no período ÷ pedidos reais vendidos no mesmo período/grupo (sales_real_orders).');
    }
    if (spec.stages?.length && spec.metrics.some((m) => m === 'fe_sessions' || m === 'aov_session')) {
      notes.push('fe_sessions/aov_session ignoram o filtro de etapa: a sessão é definida pelo FE e inclui todas as etapas dela.');
    }
    const units = Object.fromEntries(
      [...spec.metrics, ...(spec.axis === 'refund_event' && spec.metrics.includes('refund_rate') ? ['sales_real_orders' as const] : [])]
        .map((m) => [m, METRIC_UNITS[m]]),
    );
    return {
      period: { startBrt: brtStamp(startAt), endBrt: brtStamp(endAt), axis: spec.axis, source, includesToday: endAt.getTime() >= Date.parse(`${brtToday(now)}T03:00:00Z`) },
      groupBy: spec.groupBy,
      metrics: spec.metrics,
      groups: result.groups,
      returned: result.rows.length,
      rows: result.rows,
      totals: result.totals,
      units,
      notes,
    };
  },

  async compare_periods(input, ctx) {
    return runComparePeriods(input, ctx);
  },

  async get_data_coverage(input) {
    const platforms = Array.isArray(input.platforms) ? input.platforms.filter((p): p is string => typeof p === 'string') : undefined;
    return getDataCoverage(platforms?.length ? platforms : undefined);
  },

  async resolve_entities(input) {
    const terms = Array.isArray(input.terms) ? input.terms.filter((t): t is string => typeof t === 'string' && t.trim() !== '').map((t) => t.trim()) : [];
    if (!terms.length || terms.length > 10) return inputError('terms deve ser uma lista de 1 a 10 nomes');
    const kindsRaw = Array.isArray(input.kinds) ? input.kinds.map(String) : [];
    const badKinds = kindsRaw.filter((k) => !(ENTITY_KINDS as readonly string[]).includes(k));
    if (badKinds.length) return inputError(`kinds inválido: ${badKinds.join(', ')} — valid: ${ENTITY_KINDS.join(', ')}`);
    const limit = Math.min(Math.max(Math.trunc(Number(input.limit) || 8), 1), 20);
    return { results: await resolveEntities(terms, kindsRaw as EntityKind[], limit) };
  },

  async get_profit_model() {
    return getProfitModel();
  },

  async get_net_profit(input, ctx) {
    return getNetProfitForChat(input, ctx);
  },
};

export const PRECISION_TOOL_MODULE: ToolModule = {
  tools: TOOLS,
  handlers: Object.fromEntries(Object.entries(HANDLERS).map(([name, fn]) => [name, guarded(fn)])),
};
