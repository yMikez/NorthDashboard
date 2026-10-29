# Documentação

| Documento | O que tem |
| --- | --- |
| [arquitetura.md](arquitetura.md) | Como o sistema funciona por dentro: ingestão, banco, views prontas, rotinas automáticas, SPA, chat, testes. Checklists de "nova aba" e "nova plataforma". |
| [configuracao.md](configuracao.md) | Todas as variáveis de ambiente, agrupadas, e o que dá pra configurar pela tela |
| [deploy.md](deploy.md) | Servidor, deploy automático, migrações, logs, backup e como agir quando algo quebra |
| [api.md](api.md) | API para sistemas externos: autenticação, endpoints de leitura, semântica dos números |
| [design-system.md](design-system.md) | Identidade visual (DS 1.0): cores, tipografia, componentes — vale para toda tela |

## Especificações de negócio (`specs/`)

Regras definidas pelo dono da operação. O código segue estes documentos; mudou a
regra, atualize aqui junto.

| Documento | Regra |
| --- | --- |
| [specs/calculo-margem.md](specs/calculo-margem.md) | Margem de contribuição da operação (aba Lucro real) |
| [specs/cohort-reembolso.md](specs/cohort-reembolso.md) | Coorte de reembolso por dia da venda (aba Reembolsos) |
| [specs/crm-afiliados.md](specs/crm-afiliados.md) | Régua do CRM de afiliados (aba CRM) |
| [specs/recorrencias.md](specs/recorrencias.md) | Assinaturas de todas as plataformas (aba Recorrências) |

## Integrações com parceiros (`integracoes/`)

| Documento | Parceiro |
| --- | --- |
| [integracoes/northscale-afiliados.md](integracoes/northscale-afiliados.md) | Contrato com o sistema NorthScale Afiliados (webhook, mapeamento, métricas) |
| [integracoes/redes.md](integracoes/redes.md) | Redes de afiliados do NorthAffiliates: marca da venda, conferência e a aba Networks |
| [integracoes/sendtrace.md](integracoes/sendtrace.md) | Respostas e acordos com o SendTrace (API de leitura, retenção) |
| [integracoes/vupim.md](integracoes/vupim.md) | Checkout Vupim: webhook assinado, eventos, mapeamento e o workflow do n8n |

## Base de conhecimento do chat (`kb/`)

Textos curtos que o chat com IA consulta. Só entram os arquivos listados em
`lib/rag/seedManifest.ts` (lista fechada). Ver [kb/README.md](kb/README.md).

## Onde guardar documento novo

- **Documentação do sistema, spec ou contrato** → aqui em `docs/` (vai pro git).
  Sem dado de cliente e sem chave.
- **Export de plataforma, relatório, apresentação, resposta pontual** → na pasta
  `arquivos/` da raiz (fica só na sua máquina). Ver `arquivos/README.md`.
