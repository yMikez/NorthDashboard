# arquivos/ — documentos de trabalho (fora do git)

Tudo o que for criado ou baixado para uma tarefa e **não** é documentação do
sistema fica aqui. O git ignora esta pasta inteira (só este README é versionado),
então nada daqui vai para o GitHub.

| Pasta | O que guardar |
| --- | --- |
| `exports/` | Exports dos painéis das plataformas e parceiros (CSV/XLSX de transações, clientes, reembolsos). Têm dado de cliente. |
| `entregas/` | Relatórios, apresentações, briefs, respostas a parceiros, análises pontuais |

Convenção de nome: `AAAA-MM-DD-assunto.ext` (ex.: `2026-10-07-customers-buygoods-mailx.xlsx`).

Regras:

- Export com dado de cliente: depois de importado no dash, pode apagar — o painel
  da plataforma continua com o original.
- Documento que virar regra permanente (spec, contrato) vai para `docs/`, sem dado
  de cliente e sem chave.
- Nunca coloque nada disto em `public/`: aquela pasta é servida na internet sem login.
