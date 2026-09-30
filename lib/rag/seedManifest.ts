// Lista FECHADA dos documentos de docs/kb que entram na base GLOBAL. Lista
// explícita (e não "todo .md da pasta") pra que nada entre por acidente —
// DEPLOY.md, notas de desenvolvimento e exports com dado de cliente nunca
// vão pro contexto do modelo. Arquivo tirado daqui sai da base no próximo
// seed. Cada arquivo declara title/kind/description/effectiveDate no
// frontmatter (validado no seed e em teste).

export const KB_SEED_DIR = 'docs/kb';

/** Tipos de documento curado (memória/entrada do admin/anexo têm origem própria). */
export const KB_DOC_KINDS = ['policy', 'reference', 'snapshot', 'playbook'] as const;
export type KbDocKind = (typeof KB_DOC_KINDS)[number];

export const SEED_DOCS: readonly string[] = [
  // Políticas: fórmula/regra vigente — ganham de referência em conflito.
  'ressalvas-de-dados.md',
  'modelo-cpa-net-aov.md',
  'lucro-front-back.md',
  'margem-de-contribuicao.md',
  'coorte-de-reembolso.md',
  'funil-e-etapas.md',
  // Referências: como cada parte da operação/integração funciona.
  'dicionario-campos.md',
  'call-center.md',
  'afiliados-recuperacao.md',
  'fulfillment.md',
  'crm-afiliados.md',
  'integracao-afiliados.md',
  'dados-e-api.md',
  'visao-geral-operacao.md',
];
