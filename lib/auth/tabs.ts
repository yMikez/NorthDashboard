// Catálogo das tabs do dashboard. Single source of truth: usado pelo
// servidor pra validar User.allowedTabs no upsert e pelo UI admin pra
// renderizar os checkboxes na criação/edição de usuário.
//
// IDs aqui têm que bater com os ids usados no shell.jsx (sidebar) e com
// o roteamento pretty-URL em router.js.

export type TabId =
  | 'overview'
  | 'funnel'
  | 'vsl'
  | 'refund-cohorts'
  | 'affiliate-ranking'
  | 'affiliate-overview'
  | 'affiliate-refund'
  | 'leaderboard'
  | 'all-affiliates'
  | 'affiliate-analysis'
  | 'affiliate-crm'
  | 'networks'
  | 'recovery'
  | 'tauk'
  | 'leads'
  | 'surveys'
  | 'recurrences'
  | 'products'
  | 'transactions'
  | 'platforms'
  | 'health';

export interface TabSpec {
  id: TabId;
  label: string;
  group: 'Análise' | 'Afiliados' | 'Captação' | 'Clientes' | 'Catálogo' | 'Sistema';
}

export const AVAILABLE_TABS: TabSpec[] = [
  { id: 'overview',       label: 'Visão geral',         group: 'Análise' },
  { id: 'funnel',         label: 'Funil',               group: 'Análise' },
  // VSLs: quem tem a aba vê e edita (troca VSL de página no ar, roda teste A/B).
  { id: 'vsl',            label: 'VSLs',                group: 'Análise' },
  { id: 'refund-cohorts', label: 'Reembolsos',          group: 'Análise' },
  // Visão Geral, Ranking e Reembolso Prev.: modelo do time de dados — base de
  // afiliados com resultado e alertas; nota de 0 a 100 + Premissas + pedidos do
  // afiliado (Premissas: só admin muda); reembolso previsto por safra, produto e funil.
  { id: 'affiliate-overview', label: 'Visão Geral',     group: 'Afiliados' },
  { id: 'affiliate-ranking', label: 'Ranking',          group: 'Afiliados' },
  { id: 'affiliate-refund', label: 'Reembolso Prev.',   group: 'Afiliados' },
  // Telas do Mike: rodam em paralelo às do time de dados até a validação.
  { id: 'leaderboard',    label: 'Afiliados',           group: 'Afiliados' },
  { id: 'all-affiliates', label: 'Todos os afiliados',  group: 'Afiliados' },
  { id: 'affiliate-analysis', label: 'Análise',         group: 'Afiliados' },
  // CRM: aba própria de propósito — quem opera o WhatsApp recebe só ela,
  // sem ver receita, margem nem CPA da operação inteira.
  { id: 'affiliate-crm',  label: 'CRM',                 group: 'Afiliados' },
  // Networks: vendas das REDES de afiliados (NorthAffiliates) — rede e
  // integrante, CPA devido, repasse e margem. Fora das abas dos individuais.
  { id: 'networks',       label: 'Networks',            group: 'Afiliados' },
  // Captação: fontes de receita fora do funil (recuperação, call center).
  { id: 'recovery',       label: 'Recuperação',         group: 'Captação' },
  // id 'tauk' preservado (permissões) — a aba virou Call Center (Tauk + Logicall).
  { id: 'tauk',           label: 'Call Center',         group: 'Captação' },
  // Leads: a pessoa (e-mail) cruzando funil, call center e SalesBound — mostra
  // e-mail e nome de cliente, então só quem o admin liberar.
  { id: 'leads',          label: 'Leads',               group: 'Clientes' },
  // Pesquisas: quiz pós-compra (fim do tratamento) — respostas e a fila do CS
  // com nome, e-mail e telefone, então também só quem o admin liberar.
  { id: 'surveys',        label: 'Pesquisas',           group: 'Clientes' },
  // Recorrências: lista de recompra (quem dispara opera: nome, telefone, link)
  // e assinaturas da Vupim — dado de cliente, só quem o admin liberar.
  { id: 'recurrences',    label: 'Recorrências',        group: 'Clientes' },
  { id: 'products',       label: 'Produtos',            group: 'Catálogo' },
  { id: 'transactions',   label: 'Transações',          group: 'Catálogo' },
  { id: 'platforms',      label: 'Plataformas',         group: 'Sistema' },
  { id: 'health',         label: 'Saúde do dado',       group: 'Sistema' },
];

const TAB_IDS = new Set<string>(AVAILABLE_TABS.map((t) => t.id));

/** Telas do modelo de pontuação (time de dados): qualquer uma delas libera os dados e as premissas. */
export const AFFILIATE_SCORE_TABS: TabId[] = ['affiliate-ranking', 'affiliate-overview', 'affiliate-refund'];

export function isValidTab(id: string): id is TabId {
  return TAB_IDS.has(id);
}

export function sanitizeTabs(input: unknown): TabId[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<TabId>();
  for (const v of input) {
    if (typeof v === 'string' && isValidTab(v)) seen.add(v);
  }
  return Array.from(seen);
}
