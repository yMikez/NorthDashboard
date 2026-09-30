// Rótulo PT-BR dos chips de tool na resposta do chat ("Visão geral" em vez
// de get_overview). O nome técnico continua no title do chip — quem audita
// a resposta ainda vê exatamente qual tool rodou.

const TOOL_LABELS: Record<string, string> = {
  // Consultas do dashboard
  get_overview: 'Visão geral',
  get_affiliates: 'Afiliados',
  get_affiliate_detail: 'Detalhe do afiliado',
  get_affiliate_analysis: 'Análise de afiliados',
  get_affiliate_explain: 'Por que o afiliado mudou',
  get_affiliate_sequence: 'Afiliado por janelas',
  get_funnel: 'Funil',
  get_funnel_sequence: 'Funil por janelas',
  get_products: 'Produtos',
  get_families: 'Famílias',
  get_platforms: 'Plataformas',
  get_orders: 'Transações',
  get_profit_split: 'Lucro front × back',
  get_costs_overview: 'Custos',
  get_fulfillment: 'Fulfillment',
  get_refund_cohorts: 'Coortes de reembolso',
  get_call_center: 'Call center',
  get_recovery: 'Recuperação',
  get_sms: 'SMS',
  get_health: 'Saúde dos dados',
  respond_with_blocks: 'Montando a resposta',
  // Precisão (cálculo determinístico, períodos, entidades)
  calc: 'Cálculo',
  aggregate_result: 'Agregação',
  aggregate_orders: 'Agregação',
  compare_periods: 'Comparação de períodos',
  get_data_coverage: 'Qualidade do dado',
  resolve_entities: 'Identificação',
  get_profit_model: 'Modelo de lucro',
  get_net_profit: 'Lucro real',
  // Skills
  load_skill: 'Playbook',
  get_definitions: 'Glossário',
  // RAG e anexos
  search_knowledge: 'Base de conhecimento',
  read_attachment: 'Leitura do anexo',
  query_attachment_table: 'Planilha anexada',
};

/** "margin_analysis" → "margin analysis" (nome de skill vindo do input). */
function humanize(id: string): string {
  return id.replace(/[_-]+/g, ' ').trim();
}

/**
 * Rótulo do chip. `input` só existe no histórico (o stream manda só o nome):
 * aí o playbook ganha o nome da skill ("Playbook: margin analysis").
 */
export function toolChipLabel(name: string, input?: unknown): string {
  const base = TOOL_LABELS[name] ?? name;
  if (name === 'load_skill' && input && typeof input === 'object') {
    const skill = (input as { name?: unknown }).name;
    if (typeof skill === 'string' && skill.trim()) return `${base}: ${humanize(skill)}`;
  }
  return base;
}

export type ToolChipStatus = 'running' | 'ok' | 'error';

/**
 * Estado de um uso de tool persistido (`result` do motor: {ok?, error?}).
 * Sem result = registro antigo, tratado como concluído.
 */
export function storedToolStatus(result: unknown): ToolChipStatus {
  if (!result || typeof result !== 'object') return 'ok';
  const r = result as { ok?: unknown; error?: unknown };
  if (r.ok === false || (typeof r.error === 'string' && r.error)) return 'error';
  return 'ok';
}
