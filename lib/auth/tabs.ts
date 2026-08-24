// Catálogo das tabs do dashboard. Single source of truth: usado pelo
// servidor pra validar User.allowedTabs no upsert e pelo UI admin pra
// renderizar os checkboxes na criação/edição de usuário.
//
// IDs aqui têm que bater com os ids usados no shell.jsx (sidebar) e com
// o roteamento pretty-URL em router.js.

export type TabId =
  | 'overview'
  | 'funnel'
  | 'refund-cohorts'
  | 'custos'
  | 'leaderboard'
  | 'all-affiliates'
  | 'recovery'
  | 'tauk'
  | 'sms'
  | 'products'
  | 'transactions'
  | 'platforms'
  | 'costs'
  | 'health';

export interface TabSpec {
  id: TabId;
  label: string;
  group: 'Análise' | 'Afiliados' | 'Captação' | 'Catálogo' | 'Sistema';
}

export const AVAILABLE_TABS: TabSpec[] = [
  { id: 'overview',       label: 'Visão geral',         group: 'Análise' },
  { id: 'funnel',         label: 'Funil',               group: 'Análise' },
  { id: 'refund-cohorts', label: 'Reembolsos',          group: 'Análise' },
  { id: 'custos',         label: 'Custos',              group: 'Análise' },
  { id: 'leaderboard',    label: 'Ranking',             group: 'Afiliados' },
  { id: 'all-affiliates', label: 'Todos os afiliados',  group: 'Afiliados' },
  // Captação: fontes novas de receita (recuperação/SMS/email). sms/email são
  // placeholders "em breve" — a tab já existe pra permissão ficar pronta.
  { id: 'recovery',       label: 'Recuperação',         group: 'Captação' },
  // id 'tauk' preservado (permissões) — a aba virou Call Center (Tauk + Logicall).
  { id: 'tauk',           label: 'Call Center',         group: 'Captação' },
  { id: 'sms',            label: 'SMS',                 group: 'Captação' },
  { id: 'products',       label: 'Produtos',            group: 'Catálogo' },
  { id: 'transactions',   label: 'Transações',          group: 'Catálogo' },
  { id: 'platforms',      label: 'Plataformas',         group: 'Sistema' },
  { id: 'costs',          label: 'Fulfillment',         group: 'Sistema' },
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
