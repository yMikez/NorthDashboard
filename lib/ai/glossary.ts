// Glossário canônico do chat IA — FONTE ÚNICA de "o que cada número é e de
// onde ele sai". Alimenta duas coisas com o MESMO objeto:
//   - a seção "# Glossário" do prompt estável (renderGlossaryPrompt);
//   - a tool get_definitions (lib/ai/skillTools.ts).
// Antes as definições eram texto à mão no prompt e divergiam do código
// (CPA "mais frequente" quando o código usa o último; NET AOV sem a reserva;
// 6 famílias de 31; call center sem SalesBound). Mudou uma regra no código?
// Mude aqui — o prompt e a tool acompanham.
//
// `whereToRead` SEMPRE começa com o nome de uma tool (o teste confere contra
// o catálogo): a IA precisa saber exatamente qual campo abrir.
//
// Listas que vêm do código (não de cópia à mão):
//   - famílias: CANONICAL_FAMILIES do classificador, embutida pelo gerador
//     (scripts/gen-chat-skills.mjs → CANONICAL_FAMILY_NAMES);
//   - plataformas e parceiros de call center: conferidos em tempo de
//     compilação contra os tipos PlatformSlug e CallCenterProvider — slug
//     novo no tipo sem entrar aqui = erro de tsc.

import type { PlatformSlug } from '../shared/types';
import type { CallCenterProvider } from '../services/integrationSettings';
import { CANONICAL_FAMILY_NAMES } from '../chat/skills.generated';

/** true só quando `Listed` cobre todos os membros de `All` — AssertTrue<false> não compila. */
type Covers<All extends string, Listed extends All> = [Exclude<All, Listed>] extends [never] ? true : false;
type AssertTrue<T extends true> = T;

export const PLATFORM_SLUGS = ['clickbank', 'digistore24', 'buygoods', 'cartpanda', 'jvzoo'] as const satisfies readonly PlatformSlug[];
type _PlatformsCovered = AssertTrue<Covers<PlatformSlug, (typeof PLATFORM_SLUGS)[number]>>;

export const CALL_CENTER_PROVIDERS = ['tauk', 'logicall', 'salesbound'] as const satisfies readonly CallCenterProvider[];
type _ProvidersCovered = AssertTrue<Covers<CallCenterProvider, (typeof CALL_CENTER_PROVIDERS)[number]>>;

const PLATFORM_ABBR: Record<PlatformSlug, string> = {
  clickbank: 'CB',
  digistore24: 'D24',
  buygoods: 'BG',
  cartpanda: 'CP',
  jvzoo: 'JVZ',
};

export type GlossaryUnit = 'usd' | 'usd_per_fe' | 'count' | 'fraction' | 'percent' | 'text';

export type GlossaryGroup = 'receita' | 'funil' | 'afiliado' | 'lucro' | 'reembolso' | 'backend' | 'custos' | 'dados';

export interface GlossaryEntry {
  group: GlossaryGroup;
  /** Nome curto como aparece na conversa/tela. */
  label: string;
  /** Termos que o usuário usa (busca do get_definitions). */
  aliases: readonly string[];
  definition: string;
  formula?: string;
  unit: GlossaryUnit;
  /** Eixo de data / lente em que o número vive. */
  lens?: string;
  /** "tool.campo" — sempre começa com o nome de uma tool. */
  whereToRead: readonly string[];
  /** Card/aba da tela que mostra o mesmo número. */
  screen?: string;
  /** Armadilhas que já produziram resposta errada. */
  pitfalls: readonly string[];
}

const PLATFORM_LIST = PLATFORM_SLUGS.map((s) => `${s} (${PLATFORM_ABBR[s]})`).join(', ');
const PROVIDER_LIST = CALL_CENTER_PROVIDERS.join(', ');
const FAMILY_LIST = CANONICAL_FAMILY_NAMES.join(', ');

export const GLOSSARY = {
  // ── Receita ──────────────────────────────────────────────────────────
  gross: {
    group: 'receita',
    label: 'Receita bruta (gross)',
    aliases: ['receita', 'faturamento', 'vendas', 'gross', 'bruto', 'revenue', 'faturado'],
    definition: 'Soma do valor bruto das vendas APPROVED do período pela data da VENDA (dia BRT). Venda estornada sai do total.',
    unit: 'usd',
    lens: 'data da venda',
    whereToRead: ['get_overview.kpis.gross', 'get_costs_overview.kpis.grossUsd', 'get_platforms (receita por plataforma)'],
    screen: 'Visão Geral › Receita bruta',
    pitfalls: [
      'Não é o "Gross Sale Amount" da ClickBank — esse é grossOriginal.',
      'Call center (Tauk, Logicall, SalesBound) não entra: fica fora das plataformas.',
    ],
  },
  grossOriginal: {
    group: 'receita',
    label: 'Receita bruta — lente Evento (grossOriginal)',
    aliases: ['gross original', 'data do evento', 'gross sale amount', 'evento'],
    definition: 'Valor ORIGINAL de toda venda do dia, mesmo que depois estornada (toggle "Evento" da Visão Geral).',
    unit: 'usd',
    lens: 'data da venda',
    whereToRead: ['get_overview.kpis.grossOriginal'],
    screen: 'Visão Geral › Receita bruta com o toggle "Evento"',
    pitfalls: ['Bate com o Gross Sale Amount do reporting da ClickBank; não use como "receita que ficou".'],
  },
  net: {
    group: 'receita',
    label: 'Receita líquida (net)',
    aliases: ['líquido', 'net', 'receita líquida', 'vendor earnings'],
    definition: 'O que a plataforma credita ao vendor pelas vendas APPROVED: JÁ sem a fee (e impostos) da plataforma E sem o CPA pago ao afiliado.',
    formula: 'net = gross − fee/impostos da plataforma − CPA',
    unit: 'usd',
    lens: 'data da venda',
    whereToRead: ['get_overview.kpis.net'],
    screen: 'Visão Geral › Receita líquida',
    pitfalls: [
      'Nunca subtraia CPA do net: qualquer campo "net − CPA" (ex.: kpis.netProfit) conta o CPA duas vezes — ignore.',
      'Não é o "Net Sales" de glossários antigos (gross − comissão − reembolso − COGS − impostos).',
    ],
  },
  approved_orders: {
    group: 'receita',
    label: 'Pedidos aprovados',
    aliases: ['pedidos', 'vendas aprovadas', 'orders', 'quantidade de vendas'],
    definition: 'Linhas de pedido APPROVED no período (FE, bump, upsells e downsells contam cada uma).',
    unit: 'count',
    lens: 'data da venda',
    whereToRead: ['get_overview.kpis.approvedCount', 'aggregate_orders (approved)'],
    screen: 'Visão Geral › Pedidos aprovados',
    pitfalls: ['Pedido ≠ sessão: sessões com FE aprovado = get_overview.kpis.orderGroups.'],
  },
  aov: {
    group: 'receita',
    label: 'AOV (canônico, de sessão)',
    aliases: ['aov', 'ticket médio', 'ticket', 'aov de sessão', 'average order value'],
    definition: 'Receita APPROVED das sessões com FE aprovado no período ÷ nº dessas sessões. Sessão = funil inteiro (FE + bump + upsells + downsells).',
    formula: 'AOV = receita das sessões com FE ÷ sessões com FE (kpis.orderGroups)',
    unit: 'usd',
    lens: 'data da venda',
    whereToRead: ['get_overview.kpis.aov', 'get_funnel.summary.aov'],
    screen: 'Visão Geral › AOV',
    pitfalls: [
      'Upsell cujo FE caiu fora do período (sessão órfã) fica fora do numerador: get_funnel.summary.revenueFeSessions × totalRevenue.',
      'Não é o AOV do afiliado (ranking) nem o AOV da aba Famílias.',
    ],
  },
  epo: {
    group: 'receita',
    label: 'EPO (earnings per order)',
    aliases: ['epo', 'ganho por pedido', 'earnings per order'],
    definition: 'Net ÷ sessões com FE aprovado (kpis.orderGroups).',
    formula: 'EPO = net ÷ orderGroups',
    unit: 'usd',
    lens: 'data da venda',
    whereToRead: ['get_overview.kpis.epo'],
    pitfalls: ['EPC (por visitante) NÃO existe: o dash não recebe visitantes nem cliques.'],
  },

  // ── Funil ────────────────────────────────────────────────────────────
  session: {
    group: 'funil',
    label: 'Sessão (funil de compra)',
    aliases: ['sessão', 'funil', 'session', 'pacote'],
    definition: 'Uma compra inteira do mesmo cliente no funil: FE + bump + upsells/downsells.',
    unit: 'count',
    whereToRead: ['get_overview.kpis.orderGroups', 'get_funnel.summary.feGroups'],
    pitfalls: [
      'BuyGoods agrupa por sessid2 (order_id_global é por transação); JVZoo por e-mail + dia Eastern.',
      'Pacote de fulfillment = sessão.',
    ],
  },
  funnel_stages: {
    group: 'funil',
    label: 'Etapas do funil',
    aliases: ['etapa', 'stage', 'upsell', 'downsell', 'bump', 'front', 'fe', 'oto'],
    definition: 'FE (front) → Bump → UP1/UP2/UP3 → DW1/DW2/DW3; RC = recuperação por SMS. Valores do filtro stages: FRONTEND, UPSELL, DOWNSELL, BUMP, SMS_RECOVERY.',
    unit: 'text',
    whereToRead: ['get_funnel.stages', 'get_funnel_sequence.scopes'],
    pitfalls: ['JVZoo: o papel vem do NOME do produto (OTO/Upgrade = upsell, DS/Last Chance = downsell).'],
  },
  take_rate: {
    group: 'funil',
    label: 'Take rate da etapa',
    aliases: ['take rate', 'conversão do upsell', 'taxa de aceite', 'take'],
    definition: 'Volume da etapa ÷ sessões com FE aprovado.',
    formula: 'take rate = volume da etapa ÷ sessões com FE',
    unit: 'fraction',
    whereToRead: ['get_funnel.stages (takeRate)', 'get_funnel_sequence.scopes (transitions)'],
    screen: 'Funil',
    pitfalls: [
      'Variação de take rate se diz em pontos percentuais (pp), não em %.',
      'Cross-sell de outra família fica fora da etapa (crossSell) e conta no funil da família do FE.',
      'revenueLiftFromUpsells = AOV das sessões com upsell × sessões só-FE — não é a participação dos upsells na receita.',
    ],
  },

  // ── Afiliado ─────────────────────────────────────────────────────────
  mapped_affiliate: {
    group: 'afiliado',
    label: 'Afiliado NorthScale (affiliate_id)',
    aliases: ['affiliate_id', 'afiliado do sistema', 'mappedAffiliateId', 'filtro afiliado'],
    definition: 'Identidade do sistema NorthScale Afiliados (Order.mappedAffiliateId) — o filtro "Afiliado" da tela. Diferente do nickname/ID da conta na plataforma.',
    unit: 'text',
    whereToRead: ['get_affiliates.affiliates[].mappedAffiliateId', 'resolve_entities'],
    pitfalls: ['affiliate_ids só filtra nas tools que aceitam o parâmetro; nas demais o número é do total — diga.'],
  },
  aov_affiliate: {
    group: 'afiliado',
    label: 'AOV do afiliado',
    aliases: ['aov do afiliado', 'ticket do afiliado'],
    definition: 'Receita dos pedidos do afiliado (FE + upsells dele) ÷ FEs aprovadas dele. É o AOV do ranking e o que entra no NET AOV.',
    formula: 'AOV afiliado = revenue ÷ feApprovedCount',
    unit: 'usd',
    lens: 'data da venda',
    whereToRead: ['get_affiliates.affiliates[] (revenue ÷ feApprovedCount)', 'get_affiliate_analysis.rows'],
    screen: 'Afiliados',
    pitfalls: ['Não compare com o AOV canônico de sessão da Visão Geral.'],
  },
  cpa_negotiated: {
    group: 'afiliado',
    label: 'CPA negociado (cpaPerFe)',
    aliases: ['cpa', 'cpa negociado', 'cpa por venda', 'cpa de contrato', 'cpaPerFe'],
    definition: 'ÚLTIMO cpaPaidUsd observado numa FE aprovada com CPA > 0 no período — o CPA de contrato vigente.',
    unit: 'usd_per_fe',
    whereToRead: ['get_affiliates.affiliates[].cpaPerFe', 'get_affiliate_detail', 'get_affiliate_analysis.rows'],
    screen: 'Afiliados › CPA',
    pitfalls: [
      'Não é média nem moda (a média ponderada é cpaPerFeApproved, deflacionada por FEs sem CPA).',
      'Reembolso e chargeback zeram o cpaPaidUsd da venda.',
      'Afiliado de recuperação (isRecovery) ganha comissão % e fica fora da média de CPA.',
    ],
  },
  cpa_total: {
    group: 'afiliado',
    label: 'CPA pago (total)',
    aliases: ['cpa total', 'cpa pago', 'custo de afiliado', 'comissão de afiliado'],
    definition: 'Soma do cpaPaidUsd das vendas do período.',
    unit: 'usd',
    lens: 'data da venda',
    whereToRead: ['get_overview.kpis.cpa', 'get_costs_overview.kpis.cpaUsd'],
    pitfalls: ['Já está descontado do net.'],
  },
  net_aov: {
    group: 'afiliado',
    label: 'NET AOV',
    aliases: ['net aov', 'aov líquido'],
    definition: 'AOV do afiliado depois de reembolso&CB, fee, opex e reserva (modelo da planilha CPA).',
    formula: 'NET AOV = AOV × (1 − (refund&cb% + fee% + opex% + reserva%) / 100)',
    unit: 'usd_per_fe',
    whereToRead: ['get_affiliates.affiliates[].netAovUsd', 'get_profit_model'],
    screen: 'Afiliados › NET AOV',
    pitfalls: [
      'A reserva (allowance) entra na fórmula desde 2026-09-23.',
      'refund&cb% = override do afiliado ou taxa da plataforma (Digistore: observada em coorte madura) — é premissa; veja refundCbPctUsed.',
      'Percentuais em pontos (15 = 15%).',
    ],
  },
  net_after_cpa: {
    group: 'afiliado',
    label: 'NET AFTER CPA e cpaStatus',
    aliases: ['net after cpa', 'lucro por afiliado', 'cpa status', 'renegociar', 'saudável'],
    definition: 'Margem por FE do afiliado no modelo CPA; o total multiplica pelas FEs aprovadas.',
    formula: 'NET AFTER CPA (por FE) = NET AOV − CPA negociado; total = × FEs aprovadas',
    unit: 'usd_per_fe',
    whereToRead: [
      'get_affiliates.affiliates[].netAfterCpaUsd',
      'get_affiliates.affiliates[].netAfterCpaTotalUsd',
      'get_affiliates.affiliates[].cpaStatus',
    ],
    screen: 'Afiliados › NET AFTER CPA / status',
    pitfalls: [
      'null = sem CPA detectado (não é zero).',
      'cpaStatus: saudavel ≥ healthyMinUsd; atencao ≥ attentionMinUsd; senão renegociar (régua em get_profit_model).',
      'Σ NET AFTER CPA dos afiliados ≠ get_profit_split.front.profitUsd (o front não desconta reserva e usa a taxa da plataforma).',
    ],
  },
  recovery_affiliate: {
    group: 'afiliado',
    label: 'Afiliado de recuperação',
    aliases: ['recuperação', 'recovery', 'lusk1nha', 'skill99', 'isRecovery'],
    definition: 'Fonte de tráfego de recuperação paga por comissão % sobre cada venda aprovada (não por CPA).',
    unit: 'usd',
    whereToRead: ['get_recovery.kpis', 'get_recovery.byCompany', 'get_affiliates.affiliates[].isRecovery'],
    screen: 'Recuperação',
    pitfalls: ['Fica fora da média de CPA negociado; a comissão vigente muda por período (histórico em get_recovery).'],
  },

  // ── Lucro — 4 lentes ─────────────────────────────────────────────────
  profit_model: {
    group: 'lucro',
    label: 'Lucro (a) — Net after CPA (modelo) — LENTE DEFAULT',
    aliases: ['lucro', 'net after cpa modelo', 'lucro front', 'lucro back', 'profit split', 'lucro total'],
    definition: 'Card "Net after CPA (modelo)" da Visão Geral: lucro do FRONT pelo modelo da planilha CPA; total com o BACK (recuperação, call center, SMS) = totalUsd.',
    formula: 'front = Σ por plataforma gross_p × (1 − (refund&cb%_p + fee%_p + opex%) / 100) − CPA pago; total = front + back',
    unit: 'usd',
    lens: 'data da venda (modelo)',
    whereToRead: ['get_profit_split.front.profitUsd', 'get_profit_split.back.profitUsd', 'get_profit_split.totalUsd'],
    screen: 'Visão Geral › Net after CPA (modelo)',
    pitfalls: [
      'COGS e frete reais NÃO entram (o opex% é o guarda-chuva) e a reserva não é descontada aqui.',
      'Com filtro de pedido (plataforma, país, família, afiliado) Tauk e Logicall saem do BACK.',
    ],
  },
  profit_real_cost: {
    group: 'lucro',
    label: 'Lucro (b) — custo real',
    aliases: ['lucro real de custo', 'lucro custos', 'margem custos', 'custo real'],
    definition: 'Lucro com os custos registrados: fee da plataforma, CPA, COGS e fulfillment.',
    formula: 'lucro = gross − fees − CPA − COGS − fulfillment; margem = lucro ÷ gross',
    unit: 'usd',
    lens: 'data da venda',
    whereToRead: ['get_costs_overview.kpis.profitUsd', 'get_costs_overview.kpis.marginPct', 'get_costs_overview.byPlatform'],
    screen: 'Custos',
    pitfalls: [
      'get_costs_overview.byFamily.profitUsd NÃO desconta fee nem CPA.',
      'Família sem custo cadastrado (isCataloged=false) → COGS zero, lucro inflado.',
      'Fee real quando a plataforma informa; senão estimada pelo feeRatePct do cadastro.',
    ],
  },
  profit_estimated: {
    group: 'lucro',
    label: 'Lucro (c) — estimado',
    aliases: ['lucro estimado', 'estimated profit', 'margem estimada'],
    definition: 'Net menos COGS e fulfillment. Próximo da lente (b); a diferença vem de fee real × estimada e do custo de pedidos estornados.',
    formula: 'estimatedProfit = net − COGS − fulfillment; estimatedMarginPct = ÷ gross',
    unit: 'usd',
    lens: 'data da venda',
    whereToRead: ['get_overview.kpis.estimatedProfit', 'get_overview.kpis.estimatedMarginPct'],
    pitfalls: ['Não é mais card da tela (virou Net after CPA). Ignore kpis.netProfit (net − CPA).'],
  },
  contribution_margin: {
    group: 'lucro',
    label: 'Lucro (d) — margem de contribuição oficial (aba Lucro real, admin)',
    aliases: ['lucro real', 'margem de contribuição', 'receita econômica', 'margem oficial', 'net profit'],
    definition: 'Receita econômica = gross das plataformas (front + recuperação) + parcela NorthScale do backend (call centers e SalesBound). Custos variáveis = CPA/comissão + reembolso + fee + reserva + custo de produto. Margem oficial = lucro ÷ receita econômica.',
    formula: 'margem oficial = (receita econômica − custos variáveis) ÷ receita econômica',
    unit: 'usd',
    lens: 'reembolso por data do estorno',
    whereToRead: ['get_net_profit (admin)'],
    screen: 'Lucro real (admin)',
    pitfalls: [
      'Só admin.',
      'Reembolso %, custo de produto % e parcelas dos parceiros são parâmetros do admin (com histórico) — diga que são premissas.',
      'Buffer de risco fica em linha separada.',
    ],
  },

  // ── Reembolso ────────────────────────────────────────────────────────
  refund_cash: {
    group: 'reembolso',
    label: 'Reembolso — lente CAIXA (cards da tela)',
    aliases: ['taxa de reembolso', 'reembolso', 'refund', 'estorno', 'reembolso por pedidos', 'refunds7d'],
    definition: 'Estornos que ACONTECERAM no período (data do estorno, inclusive de vendas antigas) ÷ vendas do período (pedidos reais / faturamento). valuePct = lente de valor; pct = por pedidos (sem CB); refunds7d = monitor rolante dos últimos 7 dias a partir de agora.',
    unit: 'percent',
    lens: 'data do estorno ÷ vendas do período',
    whereToRead: [
      'get_profit_split.refunds.valuePct',
      'get_profit_split.refunds.pct',
      'get_profit_split.refunds7d',
      'aggregate_orders (date_axis refund_event)',
      'get_orders (status REFUNDED/CHARGEBACK: o período vale sobre a data do estorno)',
    ],
    screen: 'Visão Geral › Taxa de reembolso / Reembolso por pedidos',
    pitfalls: [
      'get_overview.kpis.refundRate NÃO é o card da tela.',
      'Período curto pega estornos de vendas antigas contra poucas vendas — taxa alta sem significar piora; confira a coorte.',
    ],
  },
  refund_cohort: {
    group: 'reembolso',
    label: 'Reembolso — lente COORTE',
    aliases: ['coorte', 'cohort', 'taxa madura', 'maturação', 'projeção de reembolso'],
    definition: 'Das vendas do dia X (data da VENDA), quantas/quanto voltaram até a idade N. Matriz censurada (vendas recentes ainda não maturaram) + curva de maturação + projeção.',
    unit: 'fraction',
    lens: 'data da venda',
    whereToRead: [
      'get_refund_cohorts.cohorts (pctCount / pctUsd)',
      'get_refund_cohorts.projection (periodPctCount / periodPctUsd)',
      'get_platforms (observedRefundCbPct, observedRefundSample)',
    ],
    screen: 'Reembolsos',
    pitfalls: [
      'pctCount/pctUsd são frações; observedRefundCbPct está em pontos — confira _meta.units.',
      'projection.tailIncomplete=true → a projeção é piso.',
      'Coorte com < 30 vendas = ruído; coorte madura = vendas de 60–150 dias atrás.',
    ],
  },
  refund_rate_sale_date: {
    group: 'reembolso',
    label: 'Taxas por data da venda (kpis.refundRate / approvalRate / cbRate)',
    aliases: ['refundRate', 'approvalRate', 'taxa de aprovação', 'aprovação', 'cbRate'],
    definition: 'Contagem de linhas por status ÷ TODAS as linhas do período por data da venda (as linhas extras de estorno da Digistore entram no denominador).',
    unit: 'fraction',
    lens: 'data da venda',
    whereToRead: ['get_overview.kpis.approvalRate', 'get_overview.kpis.refundRate', 'get_affiliates.affiliates[].refundRate'],
    screen: 'Visão Geral › Taxa de aprovação',
    pitfalls: [
      'refundRate não é o card de reembolso (lente caixa).',
      'Por afiliado as taxas usam realOrders (sem as linhas extras da Digistore).',
    ],
  },
  chargeback: {
    group: 'reembolso',
    label: 'Chargeback',
    aliases: ['chargeback', 'cb', 'disputa', 'contestação'],
    definition: 'Chargebacks ÷ todas as linhas do período por data da venda.',
    unit: 'fraction',
    lens: 'data da venda',
    whereToRead: ['get_overview.kpis.cbRate', 'get_profit_split.refunds.chargebackCount'],
    screen: 'Visão Geral › Chargeback',
    pitfalls: [
      '"CB" também é ClickBank — confirme pelo contexto.',
      'JVZoo não manda chargeback: disputa entra como reembolso.',
    ],
  },
  digistore_extra_row: {
    group: 'reembolso',
    label: 'Estorno da Digistore (linha extra)',
    aliases: ['linha extra', 'digistore refund', 'estorno digistore', 'in-place'],
    definition: 'Na Digistore o estorno cria uma LINHA EXTRA (REFUNDED/CHARGEBACK) e a venda original segue APPROVED; nas demais plataformas o estorno sobrescreve a própria venda.',
    unit: 'text',
    whereToRead: ['get_orders (platforms digistore24, status REFUNDED)', 'aggregate_orders (real_orders)'],
    pitfalls: ['Contar todas as linhas infla o denominador — use pedidos reais (realOrders).'],
  },
  real_orders: {
    group: 'reembolso',
    label: 'Pedidos reais (realOrders)',
    aliases: ['pedidos reais', 'realOrders', 'denominador'],
    definition: 'Denominador honesto das taxas: na Digistore, todas as linhas menos as linhas de estorno/CB; nas demais, todas as linhas.',
    formula: 'Digistore: allOrders − refunds − chargebacks; demais: allOrders',
    unit: 'count',
    whereToRead: ['get_affiliates.affiliates[].realOrders', 'aggregate_orders (real_orders)'],
    pitfalls: ['Taxa de reembolso/aprovação por SKU ou afiliado calculada à mão deve usar este denominador.'],
  },

  // ── Backend ──────────────────────────────────────────────────────────
  backend: {
    group: 'backend',
    label: 'Backend (BACK) — recuperação e retenção',
    aliases: ['back', 'backend', 'recuperação', 'retenção'],
    definition: 'Receita fora do FRONT: call center, SMS próprio (trafficSource smsbrdcst) e afiliados de recuperação. Call center não é pedido das plataformas (fica fora do get_overview); SMS e recuperação SÃO pedidos das plataformas (estão no get_overview) mas saem do FRONT e entram no BACK do get_profit_split.',
    unit: 'usd',
    whereToRead: ['get_profit_split.back', 'get_call_center', 'get_sms', 'get_recovery'],
    pitfalls: [
      'Com filtro de pedido, Tauk e Logicall saem do BACK do get_profit_split.',
      'SalesBound vem available:false (0) no get_profit_split.back — os números dela estão em get_call_center(provider=salesbound) e get_net_profit.',
    ],
  },
  call_center: {
    group: 'backend',
    label: 'Call center',
    aliases: ['call center', 'tauk', 'logicall', 'salesbound', 'telefone', 'parceiro'],
    definition: `Parceiros de recuperação/cross-sell por telefone: ${PROVIDER_LIST}. Vendas fora de Order (não entram nas plataformas).`,
    unit: 'usd',
    lens: 'coorte (estorno abate a venda pela data da venda)',
    whereToRead: ['get_call_center.totals', 'get_call_center.providers', 'get_call_center.byAgent'],
    screen: 'Call Center',
    pitfalls: [
      'commissionPct é FRAÇÃO (0.30 = 30%); commissionAssumed=true = comissão assumida — diga.',
      'SalesBound: estorno, void e recusa só entram pelo export CSV; webhook em Eastern, export em Central.',
      'O Lucro real conta estorno pela data do estorno — número diferente de propósito.',
    ],
  },

  // ── Custos ───────────────────────────────────────────────────────────
  allowance: {
    group: 'custos',
    label: 'Reserva (allowance)',
    aliases: ['allowance', 'reserva', 'retenção da plataforma', 'rolling reserve'],
    definition: 'Percentual do faturamento retido pela plataforma e liberado depois (janela rolante de 60 dias).',
    unit: 'usd',
    whereToRead: ['get_costs_overview.allowance', 'get_profit_model'],
    pitfalls: [
      'Entra como custo no NET AOV; o front do get_profit_split não desconta reserva.',
      'É caixa retido, não perda definitiva.',
    ],
  },
  cogs: {
    group: 'custos',
    label: 'Custo de produto (COGS) e frete',
    aliases: ['cogs', 'custo de produto', 'frete', 'fulfillment cost', 'custo do pote'],
    definition: 'COGS = custo dos potes por SKU/família (por componente em combos); fulfillment = frete e manuseio do pacote.',
    unit: 'usd',
    whereToRead: ['get_costs_overview.kpis.cogsUsd', 'get_costs_overview.kpis.fulfillmentUsd', 'get_overview.kpis.cogs', 'get_fulfillment.kpis'],
    pitfalls: [
      'get_overview.kpis.cogs/fulfillment incluem pedidos estornados (custo já pago); get_costs_overview e get_fulfillment somam as aprovadas.',
      'Família sem custo cadastrado → COGS zero.',
    ],
  },
  fulfillment: {
    group: 'custos',
    label: 'Fulfillment (envio)',
    aliases: ['fulfillment', 'envio', 'redrock', 'shipoffers', 'potes enviados', 'fatura'],
    definition: 'Operação de envio: potes, pacotes (pacote = sessão), gasto e custo por pote. Desde 30/07/2026 tudo vai pela RedRock (ShipOffers pausada).',
    unit: 'usd',
    whereToRead: ['get_fulfillment.kpis', 'get_fulfillment.bySupplier', 'get_fulfillment.byFamily', 'get_fulfillment.forecast'],
    screen: 'Fulfillment',
    pitfalls: ['A fatura fecha na terça-feira.', 'Projeções (forecast) são relativas a AGORA, não ao período.'],
  },

  // ── Dados, fusos e unidades ──────────────────────────────────────────
  timezones: {
    group: 'dados',
    label: 'Fusos horários',
    aliases: ['fuso', 'timezone', 'brt', 'utc', 'horário', 'dia errado'],
    definition: 'O dash bucketa tudo em dia BRT (America/Sao_Paulo, UTC−3, sem horário de verão). As fontes usam fuso próprio: ClickBank Pacific; Digistore24 IPN Berlim e export do painel Eastern; BuyGoods e JVZoo Eastern; SalesBound webhook Eastern e export Central; Tauk/Logicall Eastern.',
    unit: 'text',
    whereToRead: ['get_data_coverage (timezones)'],
    pitfalls: [
      'Diferença de 1 dia na borda entre dash e painel da plataforma é esperada.',
      'get_costs_overview.daily está em dia UTC; instantes de get_orders vêm em UTC — _meta.units marca iso_utc × date_brt.',
    ],
  },
  units: {
    group: 'dados',
    label: 'Unidades',
    aliases: ['unidade', 'fração', 'percentual', 'pontos percentuais', 'pp'],
    definition: 'FRAÇÃO (0.0823 = 8.23%; em _meta.units = fraction): *Rate, takeRate, pctCount/pctUsd, commissionPct do call center e da recuperação. PONTOS PERCENTUAIS (8.23 = 8.23%; em _meta.units = pp): *Pct, pct, valuePct, marginPct, observedRefundCbPct, refundCbPctUsed. Dinheiro sempre em USD. O _meta.units de cada resultado vence esta regra de nome.',
    unit: 'text',
    whereToRead: ['get_overview._meta.units (cada tool traz o próprio _meta.units)'],
    pitfalls: ['Variação entre duas taxas = pp; variação relativa = %. Diga qual.'],
  },
  platforms: {
    group: 'dados',
    label: 'Plataformas (slugs dos filtros)',
    aliases: ['plataforma', 'slug', 'clickbank', 'digistore', 'buygoods', 'cartpanda', 'jvzoo'],
    definition: `Slugs exatos: ${PLATFORM_LIST}.`,
    unit: 'text',
    whereToRead: ['get_platforms', 'resolve_entities'],
    pitfalls: ['Filtro com slug errado não filtra: use o slug exato ou resolve_entities.'],
  },
  families: {
    group: 'dados',
    label: 'Famílias de produto',
    aliases: ['família', 'produto', 'family', 'marca'],
    definition: `Famílias canônicas do código: ${FAMILY_LIST}. O banco completa com aliases e famílias novas cadastradas.`,
    unit: 'text',
    whereToRead: ['resolve_entities', 'get_families'],
    pitfalls: [
      'Nome livre ("neuro mind", "digest flow") → resolve_entities antes de filtrar.',
      'NeuroPulsePro ≠ NeuroMindPro (o codename colide na BuyGoods).',
    ],
  },
  data_gaps: {
    group: 'dados',
    label: 'Lacunas conhecidas de dado',
    aliases: ['lacuna', 'cobertura', 'ipn', 'dado faltando', 'estorno silencioso', 'reconcile'],
    definition: 'Digistore: 28% dos estornos (auditoria de 2026-08: os executados pelas contas Tauk*Affilliate) nunca chegam por IPN — só pelo reconcile do CSV do painel. Plataforma com vendas e zero eventos de estorno = estorno silencioso. JVZoo: IPN configurado por produto (produto novo sem IPN não chega) e disputa entra como reembolso. SalesBound: estorno/void só pelo CSV.',
    unit: 'text',
    whereToRead: ['get_data_coverage', 'get_health'],
    pitfalls: ['Com lacuna no escopo (_meta.dataQuality), a taxa de reembolso é piso — nunca chame de boa.'],
  },
  unavailable: {
    group: 'dados',
    label: 'Métricas que o dash não tem',
    aliases: ['epc', 'roas', 'ctr', 'visitantes', 'cliques', 'conversão da página', 'gasto de mídia'],
    definition: 'EPC e conversão por visitante (sem visitantes/cliques), ROAS/gasto de mídia (Facebook/Google Ads), CTR, custo do Twilio do SMS.',
    unit: 'text',
    whereToRead: ['get_overview.kpis.epo (mais próxima do EPC)', 'get_funnel (take rate por etapa)'],
    pitfalls: ['Diga em uma frase que não existe e ofereça a métrica mais próxima (EPO, AOV, take rate).'],
  },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof GLOSSARY;

export const GLOSSARY_KEYS = Object.keys(GLOSSARY) as GlossaryKey[];

const GROUP_TITLE: Record<GlossaryGroup, string> = {
  receita: 'Receita e pedidos',
  funil: 'Funil',
  afiliado: 'Afiliados e modelo CPA',
  lucro: 'Lucro — 4 lentes (diga SEMPRE qual)',
  reembolso: 'Reembolso e chargeback — duas lentes, nunca misture',
  backend: 'Backend',
  custos: 'Custos',
  dados: 'Dados, fusos, unidades e listas válidas',
};

const UNIT_LABEL: Record<GlossaryUnit, string> = {
  usd: 'US$',
  usd_per_fe: 'US$ por FE',
  count: 'contagem',
  fraction: 'fração 0–1',
  percent: 'pontos percentuais',
  text: '',
};

/** Seção "# Glossário" do prompt estável — mesma ordem e texto do objeto. */
export function renderGlossaryPrompt(): string {
  const out: string[] = [];
  let group: GlossaryGroup | null = null;
  for (const key of GLOSSARY_KEYS) {
    const e: GlossaryEntry = GLOSSARY[key];
    if (e.group !== group) {
      group = e.group;
      out.push(`## ${GROUP_TITLE[group]}`);
    }
    const parts = [`- ${e.label} [${key}] — ${e.definition}`];
    if (e.formula) parts.push(`Fórmula: ${e.formula}.`);
    const unit = UNIT_LABEL[e.unit];
    if (unit) parts.push(`Unidade: ${unit}.`);
    parts.push(`Onde: ${e.whereToRead.join('; ')}.`);
    if (e.pitfalls.length) parts.push(`Atenção: ${e.pitfalls.join(' ')}`);
    out.push(parts.join(' '));
  }
  return out.join('\n');
}

export interface DefinitionView {
  key: GlossaryKey;
  label: string;
  definition: string;
  formula: string | null;
  unit: GlossaryUnit;
  lens: string | null;
  whereToRead: readonly string[];
  screen: string | null;
  pitfalls: readonly string[];
}

export function definitionView(key: GlossaryKey): DefinitionView {
  const e: GlossaryEntry = GLOSSARY[key];
  return {
    key,
    label: e.label,
    definition: e.definition,
    formula: e.formula ?? null,
    unit: e.unit,
    lens: e.lens ?? null,
    whereToRead: e.whereToRead,
    screen: e.screen ?? null,
    pitfalls: e.pitfalls,
  };
}

/** Minúsculas, sem acento, só [a-z0-9 ] — busca tolerante a "reembolso"/"Reembolsó". */
export function normalizeTerm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Busca textual no glossário. Ordem: chave ou alias exatos > rótulo/alias
 * contendo o termo > definição contendo o termo. Empate mantém a ordem do
 * glossário (determinístico).
 */
export function searchGlossary(query: string, limit = 8): GlossaryKey[] {
  const q = normalizeTerm(query);
  if (!q) return [];
  const scored: Array<{ key: GlossaryKey; score: number; at: number }> = [];
  GLOSSARY_KEYS.forEach((key, at) => {
    const e: GlossaryEntry = GLOSSARY[key];
    const names = [normalizeTerm(key), ...e.aliases.map(normalizeTerm)];
    let score = 0;
    if (names.includes(q)) score = 3;
    else if (normalizeTerm(e.label).includes(q) || names.some((n) => n.includes(q) || (n.length >= 4 && q.includes(n)))) score = 2;
    else if (normalizeTerm(`${e.definition} ${e.formula ?? ''}`).includes(q)) score = 1;
    if (score) scored.push({ key, score, at });
  });
  return scored
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .slice(0, limit)
    .map((s) => s.key);
}

