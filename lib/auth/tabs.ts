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
  | 'leaderboard'
  | 'all-affiliates'
  | 'affiliate-analysis'
  | 'affiliate-crm'
  | 'recovery'
  | 'tauk'
  | 'products'
  | 'transactions'
  | 'platforms'
  | 'health';

export interface TabSpec {
  id: TabId;
  label: string;
  group: 'Análise' | 'Afiliados' | 'Captação' | 'Catálogo' | 'Sistema';
}

export const AVAILABLE_TABS: TabSpec[] = [
  { id: 'overview',       label: 'Visão geral',         group: 'Análise' },
  { id: 'funnel',         label: 'Funil',               group: 'Análise' },
  // VSLs: quem tem a aba vê e edita (troca VSL de página no ar, roda teste A/B).
  { id: 'vsl',            label: 'VSLs',                group: 'Análise' },
  { id: 'refund-cohorts', label: 'Reembolsos',          group: 'Análise' },
  { id: 'leaderboard',    label: 'Ranking',             group: 'Afiliados' },
  { id: 'all-affiliates', label: 'Todos os afiliados',  group: 'Afiliados' },
  { id: 'affiliate-analysis', label: 'Análise',         group: 'Afiliados' },
  // CRM: aba própria de propósito — quem opera o WhatsApp recebe só ela,
  // sem ver receita, margem nem CPA da operação inteira.
  { id: 'affiliate-crm',  label: 'CRM',                 group: 'Afiliados' },
  // Captação: fontes de receita fora do funil (recuperação, call center).
  { id: 'recovery',       label: 'Recuperação',         group: 'Captação' },
  // id 'tauk' preservado (permissões) — a aba virou Call Center (Tauk + Logicall).
  { id: 'tauk',           label: 'Call Center',         group: 'Captação' },
  { id: 'products',       label: 'Produtos',            group: 'Catálogo' },
  { id: 'transactions',   label: 'Transações',          group: 'Catálogo' },
  { id: 'platforms',      label: 'Plataformas',         group: 'Sistema' },
  { id: 'health',         label: 'Saúde do dado',       group: 'Sistema' },
];

const TAB_IDS = new Set<string>(AVAILABLE_TABS.map((t) => t.id));

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
