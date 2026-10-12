# Arquitetura

Como o painel funciona por dentro. Para rodar e publicar, ver [README](../README.md)
e [deploy.md](deploy.md).

## Visão geral

```text
Plataformas / parceiros ──► n8n ──► /api/ingest/<fonte> ──► IngestLog (payload cru)
                                              │
                                              ▼
                                  lib/connectors/<fonte>  (parser → NormalizedOrder)
                                              │
                                              ▼
                                  lib/services/upsertOrder  (único ponto de escrita)
                                              │
                         Postgres: Order, Customer, Product, Affiliate…
                                              │
                    views prontas: daily_metrics, lead_summary
                                              │
                         /api/metrics/*  (cache de 30 s)  ──►  SPA (public/src)
```

Logicall e SendTrace são o caminho inverso: o próprio dash consulta a API deles
de tempos em tempos (ver [Rotinas automáticas](#rotinas-automáticas)).

## Ingestão

1. **Autenticação.** `X-Ingest-Secret` (comparação em tempo constante,
   `lib/ingest/auth.ts`). Digistore também confere a assinatura SHA-512 do IPN;
   SalesBound usa um token próprio.
2. **`IngestLog` primeiro.** Todo aviso é gravado cru antes de qualquer
   processamento, então dá pra reprocessar depois (vários backfills fazem isso).
3. **Parser por fonte.** `lib/connectors/<fonte>/ingest.ts` transforma o payload
   em `NormalizedOrder` (`lib/shared/types.ts`). Cada parser tem fixtures reais
   (com dado pessoal trocado) e testes.
4. **`upsertOrder`** grava o pedido e resolve: cliente (com telefone), afiliado,
   produto e família (classificador + catálogo verificado), snapshot de custo e
   de potes enviados, vínculo com o sistema NorthScale Afiliados. No fim, agenda o
   refresh da `daily_metrics`.

### Particularidades por plataforma

| Plataforma | Fuso do horário | Estorno | Sessão (FE + upsells) | Cliente |
| --- | --- | --- | --- | --- |
| BuyGoods | Eastern | Na própria linha | `sessid2` | `user_id` (ou e-mail) |
| JVZoo | Eastern | Na própria linha | e-mail + dia | e-mail |
| Digistore24 | Berlim | **Linha extra** (a venda continua aprovada) | transação pai | `buyer_id` |
| ClickBank | Pacific | Na própria linha | recibo original | **e-mail** (não manda ID) |
| Cartpanda | BRT | Na própria linha | `order.id` (1 pedido por item) | e-mail |

BuyGoods numera o afiliado **por loja**: a conta é `aff_id@loja`.

### Fontes que ficam fora de `Order`

Vendas de parceiros que podem passar também pela plataforma ficam em tabelas
próprias, para não contar duas vezes no faturamento:

| Tabela | Fonte |
| --- | --- |
| `CallCenterSale` | Tauk (webhook) e Logicall (API) |
| `SalesboundTransaction` | SalesBound (webhook + export do CRM) |
| `RetentionOffer` | SendTrace (estornos evitados) |
| `SmsEvent`, `SmsCampaign` | telemetria de SMS (Mautic/Twilio) |
| `RecoveryReportCustomer` | relatório da BuyGoods das vendas da MailX que não mandam IPN (só hash do e-mail) |

## Banco

PostgreSQL 16 via Prisma (`prisma/schema.prisma`). As migrações rodam sozinhas no
boot do container (`prisma migrate deploy`).

Views prontas (materialized views, criadas nas migrações):

| View | O que tem | Quando atualiza |
| --- | --- | --- |
| `daily_metrics` | Pedidos agregados por dia BRT × plataforma × família × país × etapa | 15 s depois de um IPN e quando passa de 60 s |
| `lead_summary` | Uma linha por pessoa (e-mail): LTV, origem, canais, telefone, potes e estoque | Em segundo plano quando passa de 10 min |

Regras de dinheiro usadas em todo o painel:

- **Venda** = `originalGrossUsd` (valor no momento da venda); a linha extra de
  estorno da Digistore vale 0 como venda.
- **Estornado** = Digistore: `|gross|` da linha extra; demais:
  `min(|gross|, venda)` da própria linha (`reversedAmount`, `lib/services/ordersDump.ts`).
- **Dia** = dia de calendário em BRT (`America/Sao_Paulo`).

## API

| Prefixo | Quem usa | Autenticação |
| --- | --- | --- |
| `/api/ingest/*` | n8n, plataformas | `X-Ingest-Secret` (ou token próprio) |
| `/api/metrics/*` | a SPA | sessão + permissão da aba (`requireTab`) |
| `/api/admin/*` | telas de admin e operação por linha de comando | sessão admin **ou** `Authorization: Bearer <INGEST_SECRET>` |
| `/api/integrations/*` | parceiros (SendTrace, NorthScale Afiliados) | `X-Api-Key` própria de cada parceiro |
| `/api/chat`, `/api/me`, `/api/auth/*` | front | sessão |

Detalhe dos endpoints para sistemas externos: [api.md](api.md).

## Login e permissões

Sessão por cookie (`ns_session`). O middleware só checa se o cookie existe; quem
valida é cada rota (`lib/auth/session.ts`). Papéis: `ADMIN` (vê tudo) e `MEMBER`
(vê só as abas de `User.allowedTabs`). O catálogo de abas é `lib/auth/tabs.ts`.
Lucro real e Usuários são só de admin.

## Rotinas automáticas

Iniciadas no boot (`instrumentation-node.ts`), dentro do próprio processo:

| Rotina | Frequência |
| --- | --- |
| Logicall: busca vendas novas | a cada 30 min |
| NorthScale Afiliados: reconcilia o mapeamento | 45 s após o boot, depois diário |
| SendTrace: busca ofertas de retenção | a cada 30 min (só com URL e chave configuradas) |
| Base de conhecimento do chat: indexa `docs/kb` | 20 s após o boot (só o que mudou) |
| Anexos do chat vencidos | 10 min após o boot, depois a cada 6 h |

## Front-end

- **SPA legada** (`public/src/*.jsx`): scripts clássicos com escopo global
  compartilhado, pré-compilados por `scripts/build-spa.mjs` para `public/dist`
  (sem bundler). A **ordem** dos `<script>` em `public/index.html` importa. O build
  tem uma checagem que falha se um arquivo usar uma função global que não existe.
- **Chat** (`app/chat`, `components/chat`): Next.js nativo com TypeScript e Tailwind.
- Visual: [design-system.md](design-system.md). Números em formato en-US, dinheiro
  em verde, tema claro por padrão.

## Chat com IA

- Modelo Anthropic (`CHAT_MODEL`), com ferramentas que chamam os mesmos serviços
  das abas (`lib/services/aiTools.ts`) — o chat não tem acesso direto ao banco.
- Base de conhecimento (`lib/rag`): documentos de `docs/kb` (lista fechada em
  `seedManifest.ts`), entradas do admin e anexos do usuário; busca semântica com
  Voyage e por texto (`pg_trgm`).
- Skills em `lib/chat/skills/*.md`, compiladas por `scripts/gen-chat-skills.mjs`.

## Testes

Vitest. SQL cru é testado de verdade em **PGlite** (Postgres embutido) com todas as
migrações aplicadas (`lib/test/pgliteDb.ts`), sem Docker. Padrão: a lógica pura fica
em funções sem banco (ex.: `netProfitCore.ts`, `leadStock.ts`) e o SQL é exportado
como `Prisma.Sql` para ser executado no PGlite.

## Checklists

### Nova aba

1. `lib/auth/tabs.ts` — id, nome e grupo (vira checkbox em Usuários).
2. `public/src/shell.jsx` — item no menu lateral.
3. `public/src/app.jsx` — entrada em `ROUTES` e o render da página.
4. `middleware.ts` — rota em `SPA_ROUTES` (senão atualizar a página dá 404).
5. Página nova em `public/src/pages/`: adicionar em `scripts/build-spa.mjs`
   (entryPoints **e** a lista da checagem) e o `<script>` em `public/index.html`.
6. `node scripts/gen-chat-nav.mjs` (mapa de abas do chat).
7. Rotas da API com `requireTab('<id>')`.

### Nova plataforma

1. `lib/connectors/<slug>/` com `types.ts`, `ingest.ts` (→ `NormalizedOrder`),
   fixtures de payload real (dado pessoal trocado) e testes.
2. `app/api/ingest/<slug>/route.ts` seguindo uma rota existente (grava `IngestLog`
   antes de processar).
3. Assinatura própria da plataforma? `signature.ts` com teste.
4. Fuso do horário, modelo de estorno e chave de sessão — documentar na tabela acima.
5. Telefone e e-mail do comprador no `NormalizedOrder` (alimentam a aba Leads) e o
   campo de telefone em `lib/services/customerPhones.ts`.
