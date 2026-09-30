# Base de conhecimento da IA (RAG)

Documentos desta pasta são indexados na base GLOBAL da "Análise (IA)" pelo seed
em segundo plano depois do boot (`lib/rag/seed.ts`) ou sob demanda
(`POST /api/admin/kb/seed`). Cada arquivo vira um `KbDocument` e trechos
pesquisáveis com citação (search_knowledge).

- Só entra o que está listado em `lib/rag/seedManifest.ts` (este README não entra).
- Frontmatter obrigatório: `title`, `kind` (policy | reference | snapshot | playbook),
  `description` (1 linha — vai no índice do prompt) e `effectiveDate` (YYYY-MM-DD).
- Só conteúdo revisado: definições, regras, metodologia e ressalvas. Número escrito
  em documento é HISTÓRICO — números do período vêm das tools.
- Nada de segredo (IP, SSH, chaves, tokens) nem dado de cliente — o teste
  `lib/rag/seed.test.ts` barra os padrões mais comuns.
- Seções `##` curtas e autossuficientes: cada seção vira (em geral) um trecho citável.
- Alterou um arquivo? O seed compara o sha256 e reindexa só o que mudou (versão + 1);
  arquivo tirado do manifesto sai da base.
