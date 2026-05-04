// Catálogo das tabs do dashboard. Single source of truth: usado pelo
// servidor pra validar User.allowedTabs no upsert e pelo UI admin pra
// renderizar os checkboxes na criação/edição de usuário.
//
// IDs aqui têm que bater com os ids usados no shell.jsx (sidebar) e com
// o roteamento pretty-URL em router.js.

export type TabId =
  | 'overview'
  | 'funnel'
  | 'insights'
  | 'leaderboard'
  | 'all-affiliates'
  | 'products'
  | 'transactions'
  | 'platforms'
  | 'costs'
  | 'health'
  | 'networks';

export interface TabSpec {
  id: TabId;
  label: string;
  group: 'Análise' | 'Afiliados' | 'Catálogo' | 'Sistema';
}

export const AVAILABLE_TABS: TabSpec[] = [
  { id: 'overview',       label: 'Visão geral',         group: 'Análise' },
  { id: 'funnel',         label: 'Funil',               group: 'Análise' },
  { id: 'insights',       label: 'Insights',            group: 'Análise' },
  { id: 'leaderboard',    label: 'Ranking',             group: 'Afiliados' },
  { id: 'all-affiliates', label: 'Todos os afiliados',  group: 'Afiliados' },
  { id: 'networks',       label: 'Networks',            group: 'Afiliados' },
  { id: 'products',       label: 'Produtos',            group: 'Catálogo' },
  { id: 'transactions',   label: 'Transações',          group: 'Catálogo' },
  { id: 'platforms',      label: 'Plataformas',         group: 'Sistema' },
  { id: 'costs',          label: 'Custos',              group: 'Sistema' },
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
