// Golden set v1 do chat IA — perguntas reais da operação, em PT-BR.
//
// Nenhum valor esperado está escrito aqui: cada fato aponta pra tool + caminho
// e é recalculado na execução (ver spec.ts). Datas relativas ($pmstart…) usam
// o calendário BRT do dia da execução; meses fixos (agosto/2026) dão
// regressão estável. Sem anexos: fixture com dado real de cliente não entra
// no repo (os casos de anexo ficam pra fixtures sintéticas).
//
// Categorias: numero, ranking, comparacao, lente, unidade, filtro, deitico,
// indisponivel, paginacao, saude, multiturno, definicao + smoke dos
// SUGGESTED_PROMPTS (o que o usuário de fato clica).

import type { GoldenCase, LensSource } from './spec';

const AUG = { start_date: '2026-08-01', end_date: '2026-08-31' };
const PREV_MONTH = { start_date: '$pmstart', end_date: '$pmend' };
const YESTERDAY = { start_date: '$yesterday', end_date: '$yesterday' };

const overview = (args: Record<string, unknown>, path: string): LensSource => ({ tool: 'get_overview', args, path });

// Consultas de receita que respondem "quanto faturamos" sem trair a lente.
const REVENUE_TOOLS = ['get_overview', 'compare_periods', 'get_platforms', 'get_costs_overview', 'aggregate_orders'];

export const GOLDEN_CASES: GoldenCase[] = [
  // ── numero ────────────────────────────────────────────────────────────
  {
    id: 'G01',
    category: 'numero',
    turns: ['Quanto faturamos em agosto de 2026?'],
    facts: [
      {
        label: 'receita bruta',
        kind: 'usd',
        lenses: [
          { name: 'bruta aprovada', source: overview(AUG, 'kpis.gross') },
          { name: 'bruta original (evento)', source: overview(AUG, 'kpis.grossOriginal'), keywords: ['original', 'incluindo reembols', 'evento', 'antes dos estornos'] },
        ],
      },
    ],
    tools: [{ anyOf: REVENUE_TOOLS, args: AUG }],
    maxRounds: 5,
  },
  {
    id: 'G02',
    category: 'numero',
    turns: ['Qual foi a taxa de aprovação da Digistore ontem?'],
    facts: [
      {
        label: 'aprovação',
        kind: 'ratio',
        lenses: [{ name: 'aprovação por data da venda', source: overview({ ...YESTERDAY, platforms: ['digistore24'] }, 'kpis.approvalRate') }],
      },
    ],
    tools: [{ anyOf: ['get_overview', 'compare_periods', 'get_platforms'], args: { ...YESTERDAY, platforms: ['digistore24'] } }],
  },
  {
    id: 'G03',
    category: 'numero',
    turns: ['Quantas vendas aprovadas tivemos de 01/09 a 07/09 de 2026?'],
    facts: [
      {
        label: 'vendas aprovadas',
        kind: 'int',
        lenses: [
          { name: 'pedidos aprovados', source: overview({ start_date: '2026-09-01', end_date: '2026-09-07' }, 'kpis.approvedCount') },
          { name: 'sessões com FE', source: overview({ start_date: '2026-09-01', end_date: '2026-09-07' }, 'kpis.orderGroups'), keywords: ['sess', 'front', 'FE'] },
        ],
      },
    ],
    tools: [{ anyOf: [...REVENUE_TOOLS, 'get_orders'], args: { start_date: '2026-09-01', end_date: '2026-09-07' } }],
  },
  {
    id: 'G04',
    category: 'numero',
    turns: ['Qual foi o AOV da BuyGoods no mês passado?'],
    facts: [
      {
        label: 'AOV',
        kind: 'usd',
        lenses: [{ name: 'AOV de sessão', source: overview({ ...PREV_MONTH, platforms: ['buygoods'] }, 'kpis.aov') }],
      },
    ],
    tools: [{ anyOf: ['get_overview', 'compare_periods', 'get_funnel'], args: { ...PREV_MONTH, platforms: ['buygoods'] } }],
  },
  {
    id: 'G05',
    category: 'numero',
    turns: ['Quanto pagamos de CPA em agosto de 2026?'],
    facts: [
      {
        label: 'CPA pago',
        kind: 'usd',
        lenses: [
          { name: 'CPA (visão geral)', source: overview(AUG, 'kpis.cpa') },
          { name: 'CPA (custos)', source: { tool: 'get_costs_overview', args: AUG, path: 'kpis.cpaUsd' } },
        ],
      },
    ],
    tools: [{ anyOf: ['get_overview', 'get_costs_overview', 'get_profit_split', 'compare_periods'], args: AUG }],
  },

  // ── ranking ───────────────────────────────────────────────────────────
  {
    id: 'G06',
    category: 'ranking',
    turns: ['Quem foi o afiliado que mais faturou em agosto de 2026 e quanto ele trouxe?'],
    facts: [
      {
        label: 'afiliado nº 1',
        kind: 'text',
        lenses: [{ name: 'ranking por receita', source: { tool: 'get_affiliates', args: AUG, path: 'affiliates[max:revenue].nickname|externalId' } }],
      },
      {
        label: 'receita do nº 1',
        kind: 'usd',
        lenses: [{ name: 'receita própria', source: { tool: 'get_affiliates', args: AUG, path: 'affiliates[max:revenue].revenue' } }],
      },
    ],
    tools: [{ anyOf: ['get_affiliates', 'get_overview', 'aggregate_orders'], args: AUG }],
  },
  {
    id: 'G07',
    category: 'ranking',
    turns: ['Quais foram os 5 afiliados com maior NET AFTER CPA total em agosto de 2026? Em ordem.'],
    facts: [
      {
        label: 'top 5 NET AFTER CPA',
        kind: 'text',
        ordered: true,
        lenses: [
          {
            name: 'modelo CPA',
            source: { tool: 'get_affiliates', args: AUG, path: 'affiliates[sort:-netAfterCpaTotalUsd][0..5].nickname|externalId' },
          },
        ],
      },
    ],
    tools: [{ anyOf: ['get_affiliates', 'aggregate_result'], args: AUG }],
  },
  {
    id: 'G08',
    category: 'ranking',
    turns: ['Qual SKU teve mais reembolsos em agosto de 2026, e quantos?'],
    facts: [
      {
        label: 'SKU com mais reembolsos',
        kind: 'text',
        lenses: [{ name: 'por data da venda', source: { tool: 'get_products', args: AUG, path: 'products[max:refunds].externalId|name' } }],
      },
      {
        label: 'reembolsos do SKU',
        kind: 'int',
        lenses: [{ name: 'por data da venda', source: { tool: 'get_products', args: AUG, path: 'products[max:refunds].refunds' } }],
      },
    ],
    tools: [{ anyOf: ['get_products', 'aggregate_orders', 'get_orders'] }],
  },
  {
    id: 'G09',
    category: 'ranking',
    turns: ['Qual família de produto mais faturou no mês passado?'],
    facts: [
      {
        label: 'família nº 1',
        kind: 'text',
        lenses: [{ name: 'receita bruta', source: { tool: 'get_families', args: PREV_MONTH, path: 'families[max:grossRevenue].family' } }],
      },
    ],
    tools: [{ anyOf: ['get_families', 'get_costs_overview', 'aggregate_orders', 'get_overview'], args: PREV_MONTH }],
  },

  // ── comparacao ────────────────────────────────────────────────────────
  {
    id: 'G10',
    category: 'comparacao',
    turns: ['A receita de ontem foi maior ou menor que a de anteontem? Quanto em %?'],
    facts: [
      {
        label: 'variação',
        kind: 'pct',
        absolute: true,
        tol: { abs: 0.5 },
        lenses: [
          {
            name: 'receita bruta dia × dia',
            calc: {
              op: 'pct_change',
              inputs: [overview(YESTERDAY, 'kpis.gross'), overview({ start_date: '$d-2', end_date: '$d-2' }, 'kpis.gross')],
            },
          },
        ],
      },
    ],
    direction: { fact: 'variação' },
    tools: [{ anyOf: ['get_overview', 'compare_periods'] }],
  },
  {
    id: 'G11',
    category: 'comparacao',
    turns: ['Qual afiliado mais caiu em receita nos últimos 7 dias contra os 7 anteriores?'],
    facts: [
      {
        label: 'maior queda',
        kind: 'text',
        lenses: [
          { name: 'janela 7d (parceiro)', source: { tool: 'get_affiliate_analysis', args: { window: 7 }, path: 'rows[min:cur.revenue-prev.revenue].name' } },
          { name: 'janela 7d (conta)', source: { tool: 'get_affiliate_analysis', args: { window: 7, view: 'platform' }, path: 'rows[min:cur.revenue-prev.revenue].name' } },
        ],
      },
    ],
    tools: [{ anyOf: ['get_affiliate_analysis', 'get_affiliate_sequence', 'compare_periods', 'get_affiliates'] }],
  },
  {
    id: 'G12',
    category: 'comparacao',
    turns: ['O funil piorou nas últimas 3 semanas? Foi volume ou AOV?'],
    facts: [
      {
        label: 'fator dominante',
        kind: 'text',
        lenses: [
          {
            name: 'efeito volume × AOV (última transição)',
            calc: {
              op: 'dominant',
              inputs: [
                { tool: 'get_funnel_sequence', args: { window: 7, count: 3 }, path: 'scopes.all.transitions[-1].volumeEffect' },
                { tool: 'get_funnel_sequence', args: { window: 7, count: 3 }, path: 'scopes.all.transitions[-1].aovEffect' },
              ],
              labels: ['volume|sessões|FEs', 'AOV|ticket'],
            },
          },
        ],
      },
      {
        label: 'Δ receita',
        kind: 'usd',
        absolute: true,
        tol: { rel: 0.01 },
        lenses: [{ name: 'última transição', source: { tool: 'get_funnel_sequence', args: { window: 7, count: 3 }, path: 'scopes.all.transitions[-1].revenueDelta' } }],
      },
    ],
    direction: { fact: 'Δ receita' },
    tools: [{ anyOf: ['get_funnel_sequence', 'get_funnel', 'compare_periods'] }],
  },

  // ── lente ─────────────────────────────────────────────────────────────
  {
    id: 'G13',
    category: 'lente',
    turns: ['Qual foi a taxa de reembolso de agosto de 2026?'],
    facts: [
      {
        label: 'taxa de reembolso',
        kind: 'pct',
        lenses: [
          { name: 'caixa (valor)', kind: 'pct', source: { tool: 'get_profit_split', args: AUG, path: 'refunds.valuePct' }, keywords: ['valor', 'caixa', 'data do estorno', 'faturado'] },
          { name: 'caixa (pedidos)', kind: 'pct', source: { tool: 'get_profit_split', args: AUG, path: 'refunds.pct' }, keywords: ['pedidos', 'caixa', 'data do estorno'] },
          { name: 'por data da venda', kind: 'ratio', source: overview(AUG, 'kpis.refundRate'), keywords: ['data da venda', 'linhas', 'por venda'] },
          { name: 'coorte projetada', kind: 'ratio', source: { tool: 'get_refund_cohorts', args: AUG, path: 'projection.periodPctCount' }, keywords: ['coorte', 'projeç', 'projetad', 'madur'] },
        ],
      },
    ],
    tools: [{ anyOf: ['get_profit_split', 'get_overview', 'get_refund_cohorts', 'compare_periods'] }],
  },
  {
    id: 'G14',
    category: 'lente',
    turns: ['Qual foi o lucro de ontem?'],
    facts: [
      {
        label: 'lucro',
        kind: 'usd',
        tol: { rel: 0.005 },
        lenses: [
          { name: 'Net after CPA (modelo)', source: { tool: 'get_profit_split', args: YESTERDAY, path: 'front.profitUsd' }, keywords: ['net after cpa', 'modelo', 'front'] },
          { name: 'total front + back', source: { tool: 'get_profit_split', args: YESTERDAY, path: 'totalUsd' }, keywords: ['back', 'total', 'call center'] },
          { name: 'custo real', source: { tool: 'get_costs_overview', args: YESTERDAY, path: 'kpis.profitUsd' }, keywords: ['custo real', 'custos', 'cogs'] },
          { name: 'lucro estimado', source: overview(YESTERDAY, 'kpis.estimatedProfit'), keywords: ['estimado'] },
        ],
      },
    ],
    // Decisão do dono: lente default + UMA linha com o lucro de custo real.
    mention: ['net after cpa|modelo( cpa)?', 'custo real|custos'],
    oracle: ['Lente: Net after CPA (modelo CPA); pelo custo real (aba Custos) o número difere.'],
    tools: [{ anyOf: ['get_profit_split', 'get_costs_overview', 'get_overview', 'get_profit_model'], args: YESTERDAY }],
  },
  {
    id: 'G15',
    category: 'lente',
    turns: ['Quantos reembolsos a Digistore teve no mês passado?'],
    facts: [
      {
        label: 'reembolsos',
        kind: 'int',
        lenses: [
          { name: 'caixa (data do estorno)', source: { tool: 'get_orders', args: { ...PREV_MONTH, platforms: ['digistore24'], status: 'REFUNDED', limit: 1 }, path: 'total' } },
          { name: 'caixa (split)', source: { tool: 'get_profit_split', args: { ...PREV_MONTH, platforms: ['digistore24'] }, path: 'refunds.refundedCount' } },
        ],
      },
    ],
    tools: [{ anyOf: ['get_orders', 'get_profit_split', 'aggregate_orders', 'get_overview'], args: { ...PREV_MONTH, platforms: ['digistore24'] } }],
  },
  {
    id: 'G16',
    category: 'lente',
    turns: ['Quanto o call center vendeu em agosto de 2026? Isso entra na receita da visão geral?'],
    facts: [
      {
        label: 'vendas do call center',
        kind: 'usd',
        lenses: [{ name: 'Tauk + Logicall + SalesBound', source: { tool: 'get_call_center', args: AUG, path: 'totals.grossUsd' } }],
      },
    ],
    mention: ['(n[ãa]o|fora)[^.]{0,80}(vis[ãa]o geral|receita das plataformas|get_overview|plataformas)'],
    oracle: ['Não: o call center fica fora da visão geral — entra só como lucro BACK.'],
    tools: [{ anyOf: ['get_call_center', 'get_profit_split'], args: AUG }],
  },

  // ── unidade ───────────────────────────────────────────────────────────
  {
    id: 'G17',
    category: 'unidade',
    turns: ['Qual é a comissão da Logicall?'],
    facts: [
      {
        label: 'comissão Logicall',
        kind: 'ratio',
        lenses: [{ name: 'comissão configurada', source: { tool: 'get_call_center', args: { start_date: '$d-30', end_date: '$yesterday' }, path: 'providers[provider=logicall].commissionPct' } }],
      },
    ],
    tools: [{ anyOf: ['get_call_center', 'get_profit_model', 'get_net_profit'] }],
  },
  {
    id: 'G18',
    category: 'unidade',
    turns: ['Qual foi a taxa de chargeback da ClickBank no mês passado?'],
    facts: [
      {
        label: 'chargeback',
        kind: 'ratio',
        lenses: [{ name: 'por data da venda', source: overview({ ...PREV_MONTH, platforms: ['clickbank'] }, 'kpis.cbRate') }],
      },
    ],
    tools: [{ anyOf: ['get_overview', 'get_platforms', 'get_profit_split'], args: { ...PREV_MONTH, platforms: ['clickbank'] } }],
  },
  {
    id: 'G19',
    category: 'unidade',
    turns: ['Qual foi a margem de lucro pelo custo real em agosto de 2026?'],
    facts: [
      {
        label: 'margem (custo real)',
        kind: 'pct',
        lenses: [{ name: 'custos', kind: 'pct', source: { tool: 'get_costs_overview', args: AUG, path: 'kpis.marginPct' } }],
      },
    ],
    tools: [{ anyOf: ['get_costs_overview'], args: AUG }],
  },

  // ── filtro ────────────────────────────────────────────────────────────
  {
    id: 'G20',
    category: 'filtro',
    turns: ['Quanto a DigestFlow faturou no mês passado?'],
    facts: [{ label: 'receita DigestFlow', kind: 'usd', lenses: [{ name: 'bruta', source: overview({ ...PREV_MONTH, families: ['DigestFlow'] }, 'kpis.gross') }] }],
    tools: [{ anyOf: ['get_overview', 'get_families', 'compare_periods', 'aggregate_orders'], args: { ...PREV_MONTH, families: ['DigestFlow'] } }],
  },
  {
    id: 'G21',
    category: 'filtro',
    turns: ['Quanto a digest flow faturou no mês passado?'],
    notes: 'Grafia livre da família — o filtro tem que chegar como DigestFlow, não voltar $0.',
    facts: [{ label: 'receita DigestFlow', kind: 'usd', lenses: [{ name: 'bruta', source: overview({ ...PREV_MONTH, families: ['DigestFlow'] }, 'kpis.gross') }] }],
    tools: [{ anyOf: ['get_overview', 'get_families', 'compare_periods', 'aggregate_orders'], args: { ...PREV_MONTH, families: ['DigestFlow'] } }],
  },

  // ── deitico ───────────────────────────────────────────────────────────
  {
    id: 'G22',
    category: 'deitico',
    ui: { route: 'overview', preset: 'yesterday', families: ['GlycoPulse'] },
    turns: ['Quanto essa família faturou nesse período?'],
    facts: [{ label: 'receita GlycoPulse', kind: 'usd', lenses: [{ name: 'tela', source: overview({ ...YESTERDAY, families: ['GlycoPulse'] }, 'kpis.gross') }] }],
    tools: [{ anyOf: ['get_overview', 'get_families', 'compare_periods'], args: { ...YESTERDAY, families: ['GlycoPulse'] } }],
  },
  {
    id: 'G23',
    category: 'deitico',
    ui: { route: 'overview', preset: 'yesterday', families: ['GlycoPulse'] },
    turns: ['Quanto vendemos em agosto de 2026?'],
    notes: 'Pergunta GERAL com filtro na tela: herda nada além do contexto — sem GlycoPulse.',
    facts: [{ label: 'receita total', kind: 'usd', lenses: [{ name: 'bruta sem filtro', source: overview(AUG, 'kpis.gross') }] }],
    tools: [{ anyOf: REVENUE_TOOLS, args: { ...AUG, families: [] } }],
  },

  // ── indisponivel ──────────────────────────────────────────────────────
  {
    id: 'G24',
    category: 'indisponivel',
    turns: ['Qual o EPC dos afiliados em agosto de 2026?'],
    unavailable: true,
    forbid: ['EPC[^.\\n]{0,40}\\$\\s?\\d'],
  },
  {
    id: 'G25',
    category: 'indisponivel',
    turns: ['Qual a taxa de conversão da página de vendas da NeuroMindPro?'],
    unavailable: true,
    forbid: ['(taxa de convers[ãa]o|CVR)[^.\\n]{0,30}\\d+([.,]\\d+)?\\s?%'],
  },
  {
    id: 'G26',
    category: 'indisponivel',
    turns: ['Qual foi o ROAS do Facebook Ads no mês passado?'],
    unavailable: true,
    forbid: ['ROAS[^.\\n]{0,40}\\d+([.,]\\d+)?\\s?(x|×)'],
  },
  {
    id: 'G27',
    category: 'indisponivel',
    turns: ['Qual o EPO de agosto de 2026?'],
    notes: 'Reverso: EPO EXISTE (net ÷ sessões com FE) — negar é falso negativo.',
    facts: [{ label: 'EPO', kind: 'usd', lenses: [{ name: 'net ÷ sessões', source: overview(AUG, 'kpis.epo') }] }],
    tools: [{ anyOf: ['get_overview'], args: AUG }],
  },

  // ── paginacao ─────────────────────────────────────────────────────────
  {
    id: 'G28',
    category: 'paginacao',
    turns: ['Liste todos os chargebacks de agosto de 2026 com plataforma, afiliado e valor.'],
    facts: [
      {
        label: 'nº de chargebacks',
        kind: 'int',
        lenses: [{ name: 'data do chargeback', source: { tool: 'get_orders', args: { ...AUG, status: 'CHARGEBACK', limit: 1 }, path: 'total' } }],
      },
    ],
    tools: [{ anyOf: ['get_orders'], args: AUG, mustPaginate: true }],
    maxRounds: 10,
  },

  // ── saude ─────────────────────────────────────────────────────────────
  {
    id: 'G29',
    category: 'saude',
    turns: ['Os dados estão atualizados? Alguma plataforma parou de mandar venda?'],
    mention: ['(atualizad|parad|sem (venda|IPN)|[úu]ltim[oa] (venda|IPN|evento)|h[áa] \\d)'],
    oracle: ['Todas as plataformas estão atualizadas: último IPN há poucos minutos.'],
    tools: [{ anyOf: ['get_health', 'get_data_coverage'] }],
  },

  // ── multiturno ────────────────────────────────────────────────────────
  {
    id: 'G30',
    category: 'multiturno',
    turns: ['Qual foi a receita de agosto de 2026 por plataforma?', 'E só a ClickBank em julho de 2026?'],
    facts: [
      {
        label: 'receita ClickBank julho',
        kind: 'usd',
        lenses: [{ name: 'bruta', source: overview({ start_date: '2026-07-01', end_date: '2026-07-31', platforms: ['clickbank'] }, 'kpis.gross') }],
      },
    ],
    tools: [{ anyOf: ['get_overview', 'get_platforms', 'compare_periods', 'aggregate_orders'], args: { start_date: '2026-07-01', end_date: '2026-07-31' } }],
  },
  {
    id: 'G31',
    category: 'multiturno',
    turns: ['Mostre em tabela os 10 afiliados que mais faturaram em agosto de 2026.', 'Qual o CPA negociado do terceiro da lista?'],
    facts: [
      {
        label: 'terceiro da lista',
        kind: 'text',
        lenses: [{ name: 'ranking por receita', source: { tool: 'get_affiliates', args: AUG, path: 'affiliates[sort:-revenue][2].nickname|externalId' } }],
      },
      {
        label: 'CPA negociado',
        kind: 'usd',
        lenses: [{ name: 'cpaPerFe', source: { tool: 'get_affiliates', args: AUG, path: 'affiliates[sort:-revenue][2].cpaPerFe' } }],
      },
    ],
  },

  // ── definicao (RAG) ───────────────────────────────────────────────────
  {
    id: 'G32',
    category: 'definicao',
    turns: ['Como é calculado o NET AOV?'],
    mention: ['AOV\\s*[×x*]\\s*\\(?\\s*1\\s*[−-]', 'reembolso|refund', 'fee|taxa da plataforma', 'opex'],
    oracle: ['NET AOV = AOV × (1 − (refund&cb% + fee da plataforma + opex% + reserva%) / 100).'],
    maxDataCalls: 1,
  },
  {
    id: 'G33',
    category: 'definicao',
    turns: ['Como a margem de contribuição oficial da aba Lucro real é calculada?'],
    requires: { tools: ['search_knowledge'] },
    mention: ['receita econ[ôo]mica', 'backend|parcela'],
    oracle: ['Margem de contribuição = resultado ÷ receita econômica (plataformas + parcela NorthScale do backend).'],
    citations: { required: true, titlePattern: 'margem' },
    maxDataCalls: 1,
  },
  {
    id: 'G34',
    category: 'definicao',
    turns: ['Na matriz de coorte de reembolso, por que algumas células ficam em branco em vez de zero?'],
    requires: { tools: ['search_knowledge'] },
    mention: ['censur|ainda n[ãa]o (teve|chegou|viveu)'],
    oracle: ['A célula é censurada: a coorte ainda não teve tempo de chegar naquele dia.'],
    citations: { required: true, titlePattern: 'cohort|coorte' },
    maxDataCalls: 1,
  },

  // ── smoke (SUGGESTED_PROMPTS; "quem cresceu" já está no G11) ──────────
  {
    id: 'S01',
    category: 'comparacao',
    turns: ['Compara performance da NeuroMindPro vs GlycoPulse esta semana.'],
    mention: ['NeuroMindPro', 'GlycoPulse'],
    oracle: ['NeuroMindPro e GlycoPulse na semana atual.'],
    tools: [{ anyOf: ['get_overview', 'get_families', 'compare_periods', 'get_funnel', 'aggregate_orders'] }],
  },
];
