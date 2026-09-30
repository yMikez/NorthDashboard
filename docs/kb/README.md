# Base de conhecimento da IA (RAG)

Documentos desta pasta são indexados na base GLOBAL da "Análise (IA)" pelo seed
em segundo plano depois do boot (`lib/rag/seed.ts`). Cada arquivo vira um
`KbDocument` (kind/descrição no frontmatter) e trechos pesquisáveis com citação.

- Só conteúdo revisado entra aqui: definições, regras, metodologia e ressalvas.
- Número escrito em documento é HISTÓRICO — números do período vêm das tools.
- Nada de segredo (IP, SSH, chaves) nem dado de cliente.
- Alterou um arquivo? O seed compara o sha256 e reindexa só o que mudou.
