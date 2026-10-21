# NorthScale Dashboard

Painel de operação da NorthScale (nutra, afiliados internacionais). Junta num
lugar só as vendas de todas as plataformas e parceiros, calcula funil, reembolso,
margem e LTV, e dá as ferramentas do dia a dia (afiliados, VSLs, recuperação,
call center, chat com IA).

Produção: <https://dash.thenorthscales.com> · deploy automático a cada push em `main`.

## O que tem no painel

| Grupo | Aba | Para que serve |
| --- | --- | --- |
| Análise | Visão geral | Faturamento, pedidos, AOV, reembolso e lucro do período |
| | Funil | Front, upsells e downsells: conversão e AOV por sessão |
| | VSLs | Qual VSL roda em cada página do funil, testes A/B e desempenho |
| | Reembolsos | Coorte de reembolso por dia da venda (curva de maturação) |
| Afiliados | Afiliados | Ranking e diretório, com o modelo de lucro por CPA |
| | Análise | Janelas de 3 a 60 dias contra o período anterior, com os motivos |
| | CRM | Régua de relacionamento por WhatsApp (disparo manual) |
| Captação | Recuperação | Vendas de afiliados de recuperação e comissão devida |
| | Call Center | Tauk, Logicall e SalesBound |
| Clientes | Leads | Cada cliente (e-mail) com LTV, potes, estoque e linha do tempo |
| Catálogo | Produtos, Transações | Catálogo por família e o razão de pedidos |
| Sistema | Plataformas, Saúde do dado | Integrações, taxas e alertas de qualidade dos dados |
| IA | Análise (IA) | Chat que consulta os dados do painel |
| Admin | Usuários, Lucro real | Permissões por aba e margem de contribuição da operação |

Cada aba (menos as de Admin) é liberada por usuário em **Usuários**; o admin vê tudo.

## De onde vêm os dados

| Fonte | Como chega | Onde fica |
| --- | --- | --- |
| BuyGoods, Digistore24, JVZoo, ClickBank, Cartpanda, Vupim | IPN/webhook → `/api/ingest/<plataforma>` (via n8n) | `Order`, `Customer`, `Product`, `Affiliate` |
| PagAmerican | webhook (fase 1: só captura) | `IngestLog` |
| Tauk | webhook → n8n → `/api/ingest/tauk` | `CallCenterSale` |
| Logicall | o dash consulta a API a cada 30 min | `CallCenterSale` |
| SalesBound | webhook + import do export do CRM | `SalesboundTransaction` |
| SMS (Mautic/Twilio) | eventos → `/api/ingest/sms-events` | `SmsEvent`, `SmsCampaign` |
| NorthScale Afiliados | webhook + reconciliação diária | `AffiliateMapping*` |
| SendTrace (retenção) | o dash consulta a cada 30 min | `RetentionOffer` |

Todo aviso recebido é gravado cru em `IngestLog` antes de ser processado (dá pra
reprocessar). Detalhes em [`docs/arquitetura.md`](docs/arquitetura.md).

## Stack

Next.js 15 (rotas de API, login e chat) · SPA legada em React (`public/src`,
pré-compilada) · Prisma 5 + PostgreSQL 16 · Vitest + PGlite (Postgres embutido
nos testes) · Docker Compose na VPS · Anthropic (chat) e Voyage (busca semântica).

## Rodar localmente

Pré-requisitos: Node 20+, npm e um PostgreSQL 16.

```bash
npm install
cp .env.example .env          # preencha DATABASE_URL e INGEST_SECRET (o resto é opcional)
npx prisma migrate deploy     # aplica as migrações
npm run create:admin          # cria o primeiro usuário admin
npm run dev                   # compila a SPA e sobe em http://localhost:3000
```

Variáveis de ambiente: [`docs/configuracao.md`](docs/configuracao.md).

## Comandos

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento (compila a SPA antes) |
| `npm run dev:spa` | Recompila a SPA a cada mudança em `public/src` |
| `npm test` | Roda todos os testes (inclui SQL real no PGlite, sem Docker) |
| `npx tsc --noEmit -p .` | Checagem de tipos |
| `npm run build` | Build de produção (SPA + Next) |
| `npm run prisma:migrate` | Cria uma migração nova a partir do `schema.prisma` |
| `node scripts/gen-chat-nav.mjs` | Regenera o mapa de abas do chat (o build falha se ficar desatualizado) |

## Estrutura

```text
app/                rotas do Next: api/ (ingest, metrics, admin, integrations, chat…), login, chat
components/         componentes React do chat (Next) e UI compartilhada
lib/
  connectors/       um parser por plataforma/parceiro → NormalizedOrder
  services/         regras de negócio (métricas, lucro, leads, recuperação…)
  auth/ ingest/     sessão, permissões por aba, chave de operação
  rag/ chat/ ai/    chat com IA: base de conhecimento, ferramentas, prompts
  shared/ cache/    tipos, filtros, cache de resposta
public/src/         SPA legada (JSX → public/dist via scripts/build-spa.mjs)
prisma/             schema e migrações (aplicadas no boot do container)
scripts/            build da SPA, seeds e backfills de linha de comando
docs/               documentação (ver docs/README.md)
Planilhas/          catálogo de produtos de referência (seed)
arquivos/           pasta LOCAL para exports e documentos de trabalho (fora do git)
```

## Deploy

Push em `main` → GitHub Actions roda os testes → entra por SSH na VPS, atualiza o
código e reconstrói o container (`docker compose up -d --build app`) → espera
`/api/health` responder. As migrações rodam no boot do container. Passo a passo, servidor e recuperação: [`docs/deploy.md`](docs/deploy.md).

## Regras do repositório

- **Nenhum dado de cliente entra no git.** Exports das plataformas (CSV/XLSX),
  relatórios e respostas a parceiros vão para `arquivos/` (ignorada pelo git).
  O `.gitignore` já barra `*.csv` e `*.xlsx` fora de `Planilhas/`.
- **Nenhuma chave real entra no git.** O `.env` fica só na máquina e no servidor;
  o `.env.example` tem só texto de exemplo.
- **`public/` é servido sem login.** Nada de arquivo de trabalho lá.
- A chave de operação (`INGEST_SECRET`) nunca vai para terceiros: parceiro recebe
  uma chave própria de leitura (ver [`docs/api.md`](docs/api.md)).

## Documentação

Índice completo em [`docs/README.md`](docs/README.md).
