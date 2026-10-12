# Integração NorthScale Afiliados ⇄ Dashboard de vendas

Contrato técnico entre **esta API** (NorthScale Afiliados, `api/`) e o **dashboard de vendas** (sistema externo que recebe os webhooks de venda da BuyGoods, Digistore24 e JVZoo). Este documento é a referência para a equipe que implementa o lado do dashboard: tudo aqui reflete o código em `api/src/integrations/`, a migration `api/prisma/migrations/20260912100000_integracao_dashboard/` e os modelos no fim de `api/prisma/schema.prisma`.

Convenções deste documento:

- `{DASHBOARD_URL}` = base do dashboard, configurada nesta API (sem barra final).
- Datas/horas em JSON são sempre **ISO 8601 em UTC com milissegundos** (`2026-09-12T13:37:00.123Z`), exceto `from`/`to` do período custom, que são dias `AAAA-MM-DD`.
- Os nomes de header são case-insensitive (HTTP); aqui aparecem como `X-Api-Key`, `X-Event-Id` etc.

---

## 1. Visão geral

### Quem é fonte de verdade de quê

| Dado | Fonte de verdade | Observação |
| --- | --- | --- |
| Identidade do afiliado: `affiliate_id`, nome, status (`active`/`inactive`) e os identificadores dele em cada plataforma (`platforms`) | **Esta API** | O dashboard consome e espelha; nunca cria nem edita identidade por conta própria. |
| Vendas, reembolsos, pedidos e qualquer métrica agregada | **Dashboard** | Esta API só lê métricas prontas e exibe (ranking); não recalcula nada. |

O dashboard recebe os webhooks de venda das plataformas com o identificador do afiliado **da plataforma** (aff_id, username, Digistore ID, Affiliate ID…). Para saber **de quem** é cada venda, ele precisa do mapeamento `plataforma + external_id → affiliate_id` mantido aqui.

### Fluxo em três setas

```
 Dashboard ──(1) GET /api/integrations/affiliates/mapping ─────────────▶ Esta API   (pull do mapeamento: carga inicial e incremental)
 Esta API  ──(2) POST {DASHBOARD_URL}/api/integrations/affiliates/webhook ─▶ Dashboard (push: evento affiliate.updated a cada mudança)
 Esta API  ──(3) GET {DASHBOARD_URL}/api/integrations/affiliates/metrics ──▶ Dashboard (pull: métricas por afiliado para o ranking, a cada 15 min)
```

1. **Mapping (pull)** — o dashboard lê o mapeamento completo (paginado) e depois só o que mudou (`updated_since`). Seção 5.
2. **Webhook (push)** — sempre que a identidade de um afiliado muda, esta API envia o estado completo dele para o dashboard, com retry e backoff. Seção 6.
3. **Metrics (pull)** — o job de ranking desta API busca no dashboard os agregados por afiliado (7d, 30d, mês corrente e períodos custom sob demanda). Seção 7.

As setas 1 e 2 são redundantes de propósito: o webhook dá latência baixa; o mapping garante consistência (carga inicial, recuperação de falhas, auditoria).

### URLs

| Sistema | URL de produção |
| --- | --- |
| Esta API | `https://api.thenorthscales.com` (painel em `https://app.thenorthscales.com`) |
| Dashboard | Definida em `DASHBOARD_URL` no `.env` desta API (ex.: `https://dashboard.exemplo.com`) |

Endpoints que **esta API expõe** para o dashboard:

- `GET https://api.thenorthscales.com/api/integrations/affiliates/mapping`

Endpoints que **o dashboard precisa expor** para esta API:

- `POST {DASHBOARD_URL}/api/integrations/affiliates/webhook`
- `GET {DASHBOARD_URL}/api/integrations/affiliates/metrics`

---

## 2. Autenticação entre sistemas

Toda chamada entre os dois sistemas leva o header **`X-Api-Key`** com uma chave secreta compartilhada. São **duas chaves distintas, uma por sentido**:

| Sentido | Chave (nome do env nesta API) | Quem gera/guarda |
| --- | --- | --- |
| Dashboard → esta API (`GET …/mapping`) | `INTEGRATION_API_KEY` — é o que o dashboard **envia** para cá | Esta API valida; o dashboard guarda como "chave de saída" |
| Esta API → dashboard (`POST …/webhook`, `GET …/metrics`) | `DASHBOARD_API_KEY` — é o que esta API **envia** para lá | O dashboard valida; esta API guarda como "chave de saída" |

Podem ser valores iguais, mas o recomendado é gerar duas chaves independentes (rotacionar uma não obriga a rotacionar a outra).

### Como esta API valida (`ApiKeyGuard`)

- Lê o header `x-api-key` (se vier repetido, usa o primeiro), faz `trim()` e compara com `INTEGRATION_API_KEY` (também com `trim()`).
- A comparação é em **tempo constante** (sha256 de ambos os lados + `timingSafeEqual`), independente do tamanho das strings.
- Respostas de erro (corpo padrão do NestJS):

| Situação | HTTP | Corpo |
| --- | --- | --- |
| `INTEGRATION_API_KEY` não configurada no servidor | **503** | `{"statusCode":503,"message":"Integração não configurada no servidor","error":"Service Unavailable"}` |
| Header ausente, vazio ou diferente | **401** | `{"statusCode":401,"message":"Chave de integração inválida","error":"Unauthorized"}` |

O guard é usado em rotas marcadas como `@Public()` (o JWT de usuário **não** se aplica a elas) e somente em rotas de integração — a chave nunca dá acesso a rotas do painel.

### O que o dashboard deve fazer (espelho)

- No webhook e no metrics, exigir `X-Api-Key` igual à chave combinada (`DASHBOARD_API_KEY` daqui). Recomenda-se responder **401** para chave ausente/errada e comparar em tempo constante. Qualquer resposta não-2xx aqui vira retry (webhook) ou rodada com falha (metrics) — ver seções 6 e 7.
- Ao chamar o mapping, enviar `X-Api-Key: <INTEGRATION_API_KEY>`.

### Gerar chaves

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Rode duas vezes (uma chave por sentido). As chaves são lidas do ambiente **no boot**: ao trocar, reinicie o container.

---

## 3. Variáveis de ambiente

Bloco de integração do `api/.env.example` (todas lidas via `ConfigService`; valores inválidos caem no padrão):

| Variável | Obrigatória? | Padrão | Descrição |
| --- | --- | --- | --- |
| `INTEGRATION_API_KEY` | Sim, para o mapping | — (vazia) | Chave que o **dashboard envia** em `X-Api-Key` ao chamar `GET /api/integrations/affiliates/mapping`. Vazia ⇒ o endpoint responde **503**. Não afeta webhook nem ranking. |
| `DASHBOARD_URL` | Sim, para webhook e ranking | — (vazia) | Base do dashboard, ex.: `https://dashboard.exemplo.com`. Barras finais são removidas; os caminhos `/api/integrations/affiliates/webhook` e `/api/integrations/affiliates/metrics` são acrescentados por esta API. |
| `DASHBOARD_API_KEY` | Sim, para webhook e ranking | — (vazia) | Chave que **esta API envia** em `X-Api-Key` para o dashboard. |
| `RANKING_SYNC_INTERVAL_MIN` | Não | `15` | Intervalo, em minutos, da rodada periódica (reconciliação de identidades + métricas do ranking + outbox). Mínimo 1; inválido ⇒ 15. |
| `RANKING_TOP_N` | Não | `10` | Tamanho padrão do `top` em `GET /api/ranking` quando `limit` não é informado. Inteiro > 0; acima de 100 é limitado a 100. |
| `RANKING_SNAPSHOT_RETENTION_DAYS` | Não | `30` | Retenção, em dias, de `affiliate_metrics_snapshots` e `ranking_sync_runs` (limpeza a cada rodada). Inteiro > 0. |
| `DASHBOARD_TIMEOUT_MS` | Não | `10000` | Timeout (ms) de cada chamada HTTP ao dashboard — webhook **e** metrics. Número > 0. |
| `INTEGRATION_WORKERS` | Não | `true` | `false` desliga os timers (tick da outbox, reconciliação e ranking). Os endpoints continuam funcionando e uma mudança de cadastro ainda dispara **uma** tentativa imediata de entrega (kick pós-commit), mas sem o tick não há retries, reconciliação nem métricas. `NODE_ENV=test` também desliga. |

Comportamento quando `DASHBOARD_URL` **ou** `DASHBOARD_API_KEY` está vazia (`DashboardClient.configured === false`): nenhum webhook é enviado (as linhas ficam `PENDING` na outbox, uma por afiliado, e são entregues assim que a configuração existir e o container reiniciar), o job de métricas não roda e o ranking fica vazio (`fetched_at: null`). Um aviso é logado uma vez.

### Espelho: o que o dashboard precisa ter configurado

| No dashboard | Valor |
| --- | --- |
| Chave que ele **aceita** em `X-Api-Key` (webhook e metrics) | O mesmo valor de `DASHBOARD_API_KEY` desta API |
| Chave que ele **envia** em `X-Api-Key` (mapping) | O mesmo valor de `INTEGRATION_API_KEY` desta API |
| URL desta API | `https://api.thenorthscales.com` |

---

## 4. Identidade do afiliado

### `affiliate_id`

É o `users.id` desta API: um **cuid** (string de ~25 caracteres, ex.: `cmfgq1x2a0000v8l4h3k9d2pw`), gerado no cadastro, **imutável e nunca reutilizado**. É a chave primária do afiliado nos dois sistemas: o dashboard deve usá-lo como identificador do afiliado internamente e devolvê-lo nas métricas (seção 7). Só usuários com papel `AFILIADO` entram na integração; contas de administrador nunca aparecem.

### `platform`

No JSON, sempre em **minúsculas**: `buygoods` | `digistore24` | `jvzoo`. (Internamente é o enum `MappingPlatform` = `BUYGOODS` | `DIGISTORE24` | `JVZOO`.) A **CartPanda não faz parte** do mapeamento — ela não manda webhook para o dashboard — e IDs de CartPanda nunca são publicados.

### `external_id`

Identificador do afiliado **na plataforma**, exatamente como o dashboard o vê no webhook de venda. Regras:

- **Normalizado**: `trim()` + **minúsculas**. É assim que é gravado, comparado e publicado. O dashboard **deve aplicar a mesma normalização** (`trim` + `lower`) no identificador que vem no webhook de venda antes de procurar o `affiliate_id`. Vazio depois do trim não existe (é descartado).
- **Único por plataforma**: o par `(platform, external_id)` tem índice único (`affiliate_platform_ids`); um mesmo ID nunca pertence a dois afiliados ao mesmo tempo.
- Um afiliado pode ter **vários** `external_id` **na mesma plataforma** (veja as fontes abaixo). O dashboard deve casar o webhook de venda contra **qualquer um deles** e guardar o conjunto completo, não só o primeiro.

### De onde vêm os identificadores

| Fonte | O que é | Quem preenche | Plataformas |
| --- | --- | --- | --- |
| **ID da conta** (`checkout_accounts.externalId`) | Identificador global da conta do afiliado na plataforma: **Digistore ID** (Digistore24), **username** da BuyGoods (o e-mail da conta BuyGoods **não** é publicado), **Affiliate ID** da JVZoo | O próprio afiliado, no cadastro ou no perfil; ou o admin ao liberar uma afiliação direta (`grant`) | `digistore24`, `buygoods`, `jvzoo` (uma conta por plataforma por afiliado) |
| **ID por produto** (`affiliations.platformAffiliateId`) | ID que a plataforma emite para o afiliado **em cada produto**: **aff_id** da BuyGoods, **Affiliate ID** da JVZoo neste produto. É o que costuma vir no webhook de venda dessas plataformas | A equipe, ao aprovar a afiliação (obrigatório em BuyGoods/JVZoo) ou ao corrigir depois | Só afiliações com status **`APROVADO`** contam; afiliação pendente, em processo ou rejeitada não publica ID |

Consequências:

- Um afiliado com conta BuyGoods `joao.silva` e afiliações aprovadas em 3 produtos BuyGoods aparece com **4** entradas `buygoods` (username + 3 aff_ids).
- Se o mesmo valor aparece nas duas fontes (ou em duas afiliações), colapsa numa entrada só.
- O ID por produto é obrigatório em BuyGoods/JVZoo e opcional nas demais; se a equipe preencher um numa afiliação Digistore24 aprovada, ele também é publicado como `digistore24` (o backfill da migration só importa BuyGoods/JVZoo, mas a reconciliação completa o resto).
- `platforms` pode ser `[]` (afiliado que cadastrou só CartPanda, ou nenhuma plataforma ainda).
- A lista vem **ordenada** de forma estável: por plataforma (`buygoods`, `digistore24`, `jvzoo`) e depois por `external_id`.

### Conflito de identificador ("um ID, um afiliado")

Se um afiliado informa um `external_id` que já pertence a **outro** afiliado na mesma plataforma:

- nos caminhos do usuário/admin (cadastro, perfil, aprovação de afiliação, correção de ID) a operação inteira é recusada com **HTTP 409** (`"O identificador "<id>" da <Plataforma> já está cadastrado por outro afiliado"`) e nada é gravado;
- nos caminhos automáticos (liberar/revogar acesso, exclusão de produto, reconciliação periódica) o ID em conflito é **ignorado** (continua com o dono original), fica registrado no log (`ID <Plataforma> "<id>" do afiliado <x> ignorado: já pertence ao afiliado <y>`) e o afiliado é publicado **sem** esse ID.

Quando um afiliado **troca** um ID, o antigo sai do mapeamento dele (e fica livre) e o novo entra — o dashboard recebe o conjunto novo completo e deve substituir o antigo.

### `status`

| Valor | Significado nesta API | O que o dashboard deve fazer |
| --- | --- | --- |
| `active` | `users.approvedAt` preenchido — a equipe liberou o acesso ao painel | Exibir como ativo |
| `inactive` | `approvedAt` nulo — cadastrou e está **aguardando liberação**, ou teve o acesso **revogado** | **Continuar atribuindo vendas** aos IDs dele (o afiliado pode ter vendas antes da liberação ou depois da revogação); apenas não exibir como ativo |

`status` não tem nada a ver com "vendendo ou não" nem com afiliação em produto — é só o acesso ao painel.

### `name`

`users.name` com `trim()`. Nome de exibição; muda quando o afiliado edita o perfil (e aí vai um webhook).

### O que **não** faz parte da identidade

Login, e-mail, WhatsApp, nível (`level`), preferência de ranking, avisos, IDs de CartPanda, afiliações não aprovadas. Mudanças nesses campos **não** geram webhook nem alteram o `updated_at` do mapping.

---

## 5. `GET /api/integrations/affiliates/mapping` (esta API)

Leitura do mapeamento pelo dashboard.

```
GET https://api.thenorthscales.com/api/integrations/affiliates/mapping?updated_since=<ISO 8601>&cursor=<opaco>&limit=<n>
X-Api-Key: <INTEGRATION_API_KEY>
```

### Query string

| Parâmetro | Opcional | Descrição |
| --- | --- | --- |
| `updated_since` | Sim | Só afiliados cujo `updated_at` é **maior ou igual** (`>=`, inclusivo) a este instante. Qualquer formato aceito por `new Date()`, mas use **ISO 8601 completo com fuso** (`2026-09-12T13:37:00.123Z`). Inválido ⇒ 400. |
| `cursor` | Sim | Cursor opaco devolvido em `next_cursor` da página anterior. Inválido/corrompido ⇒ 400. Combina com `updated_since` (os dois filtros se aplicam). |
| `limit` | Sim | Itens por página. **Padrão 100, máximo 500** (valores maiores são silenciosamente reduzidos a 500). Não-inteiro ou `< 1` ⇒ 400. |

### Regras

- Entram só usuários com papel `AFILIADO` que já tiveram a identidade publicada ao menos uma vez (têm linha em `affiliate_integration_state`). Depois da primeira reconciliação após o deploy (10 s após o boot), isso é **todos** os afiliados — inclusive `inactive` e sem plataformas.
- **Ordenação estável**: `updated_at` crescente e, em empate, `affiliate_id` crescente. O cursor codifica `(updated_at, affiliate_id)` do último item da página; a página seguinte começa estritamente depois dele — sem repetição nem buraco entre páginas.
- `updated_at` = instante em que nome/status/IDs do afiliado mudaram pela última vez (o mesmo valor vai como `occurred_at` no webhook correspondente). Login e outras alterações irrelevantes ao dashboard não mexem nele.
- `platforms` traz o conjunto **completo e atual** do afiliado (ordenado como na seção 4).

### Resposta `200`

```json
{
  "data": [
    {
      "affiliate_id": "cmfgq1x2a0000v8l4h3k9d2pw",
      "name": "Maria Silva",
      "status": "active",
      "platforms": [
        { "platform": "buygoods", "external_id": "mariasilva" },
        { "platform": "buygoods", "external_id": "ms8841" },
        { "platform": "digistore24", "external_id": "maria_ds" },
        { "platform": "jvzoo", "external_id": "1234567" }
      ],
      "updated_at": "2026-09-12T13:37:00.123Z"
    },
    {
      "affiliate_id": "cmfgq5abc0001v8l4qq77zz10",
      "name": "João Souza",
      "status": "inactive",
      "platforms": [],
      "updated_at": "2026-09-12T13:37:00.456Z"
    }
  ],
  "next_cursor": "MjAyNi0wOS0xMlQxMzozNzowMC4xMjNafGNtZmdxMXgyYTAwMDB2OGw0aDNrOWQycHc"
}
```

- `next_cursor` é **`null` na última página** (a API busca `limit + 1` linhas para saber se há mais). Trate-o como opaco (é base64url de `<updated_at ISO>|<affiliate_id>`, mas isso pode mudar).
- Lista vazia ⇒ `{"data":[],"next_cursor":null}`.

### Erros

| HTTP | Quando | `message` |
| --- | --- | --- |
| 400 | `updated_since` não é data | `updated_since deve ser uma data ISO 8601 (ex.: 2026-09-12T10:00:00Z)` |
| 400 | `limit` não é inteiro ≥ 1 | `limit deve ser um inteiro maior que zero` |
| 400 | `cursor` inválido | `cursor inválido` |
| 401 | `X-Api-Key` ausente ou errada | `Chave de integração inválida` |
| 503 | `INTEGRATION_API_KEY` não configurada aqui | `Integração não configurada no servidor` |

### Exemplos (curl)

```bash
API=https://api.thenorthscales.com
KEY=<INTEGRATION_API_KEY>

# Carga inicial — primeira página
curl -s "$API/api/integrations/affiliates/mapping?limit=500" -H "X-Api-Key: $KEY"

# Páginas seguintes: repita enquanto next_cursor != null
curl -s "$API/api/integrations/affiliates/mapping?limit=500&cursor=MjAyNi0wOS0xMlQxMzozNzowMC4xMjNafGNtZmdxMXgyYTAwMDB2OGw0aDNrOWQycHc" \
  -H "X-Api-Key: $KEY"

# Incremental: tudo que mudou desde o maior updated_at já visto (inclusivo)
curl -s "$API/api/integrations/affiliates/mapping?updated_since=2026-09-12T13:37:00.456Z" \
  -H "X-Api-Key: $KEY"
```

Loop de paginação (pseudocódigo):

```
cursor = null
repeat
  page = GET mapping?limit=500[&updated_since=X][&cursor=cursor]
  for item in page.data: upsert(item)
  cursor = page.next_cursor
until cursor == null
```

### Estratégia de sincronização recomendada

1. **Carga inicial**: paginar **sem** `updated_since` até `next_cursor == null`. Guardar o **maior `updated_at`** visto.
2. **Incremental** (ex.: a cada 5–15 min, ou como fallback do webhook): chamar com `updated_since = maior updated_at visto`, paginando do mesmo jeito. Como o filtro é inclusivo (`>=`), o último afiliado da rodada anterior **vem de novo** — isso é esperado; não avance o marcador com folga nem subtraia tempo.
3. **Upsert idempotente por `affiliate_id`**: criar se não existe; senão atualizar `name`, `status` e **substituir o conjunto `platforms` inteiro** pelo recebido (apagar o que não veio, inserir o que é novo). Nunca acumular IDs antigos.
4. Aplicar a mesma regra de "mais recente vence" que vale para o webhook: se já aplicou um estado com `occurred_at`/`updated_at` **maior** que o `updated_at` recebido, ignore o item (só acontece se webhook e mapping se cruzarem).
5. Afiliado que estava no dashboard e não aparece mais no mapping completo foi removido desta API (não há evento de exclusão — seção 6); mantenha o histórico de vendas dele e marque como removido, a seu critério.

---

## 6. Webhook `affiliate.updated` (esta API → dashboard)

Esta API avisa o dashboard sempre que a identidade de um afiliado muda. É o **único** evento que existe (`X-Event-Type` é sempre `affiliate.updated`): serve para criação, alteração e mudança de status. Não existe evento de exclusão.

### Endpoint que o dashboard deve expor

```
POST {DASHBOARD_URL}/api/integrations/affiliates/webhook
```

### Headers enviados

| Header | Valor |
| --- | --- |
| `Content-Type` | `application/json` |
| `Accept` | `application/json` |
| `X-Api-Key` | `<DASHBOARD_API_KEY>` |
| `X-Event-Id` | Id da entrega (cuid, ex.: `cmfgqz7yk0003v8l4b1c2d3e4`). **Repete em todas as tentativas** da mesma entrega. |
| `X-Event-Type` | `affiliate.updated` |
| `X-Webhook-Attempt` | Número da tentativa, `1` a `8` |
| `User-Agent` | `NorthScale-Afiliados/1.0` |

### Corpo (JSON)

Sempre o **estado completo e atual** do afiliado — mesmos campos do item do mapping, mais `event` e `occurred_at`:

```json
{
  "event": "affiliate.updated",
  "affiliate_id": "cmfgq1x2a0000v8l4h3k9d2pw",
  "name": "Maria Silva",
  "status": "active",
  "platforms": [
    { "platform": "buygoods", "external_id": "mariasilva" },
    { "platform": "buygoods", "external_id": "ms8841" },
    { "platform": "digistore24", "external_id": "maria_ds" },
    { "platform": "jvzoo", "external_id": "1234567" }
  ],
  "occurred_at": "2026-09-12T13:37:00.123Z"
}
```

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `event` | string | Sempre `"affiliate.updated"` |
| `affiliate_id` | string | `users.id` (seção 4) |
| `name` | string | Nome de exibição |
| `status` | `"active"` \| `"inactive"` | Seção 4 |
| `platforms` | array | Conjunto **completo** de `{platform, external_id}` do afiliado (pode ser `[]`) |
| `occurred_at` | string ISO 8601 UTC | Instante da mudança. É o mesmo valor que aparece em `updated_at` no mapping para esse estado. |

### Quando dispara

Um webhook é enfileirado sempre que o "fingerprint" (nome + status + conjunto de plataformas) do afiliado muda em relação ao último publicado. Na prática:

| Situação | Onde no código | Efeito no corpo |
| --- | --- | --- |
| Afiliado se cadastra | `AuthService.register` | Novo `affiliate_id`, `status: "inactive"`, IDs de conta informados no cadastro |
| Afiliado altera o nome ou os IDs de conta no perfil | `ProfileService.update` / `upsertAccounts` | `name` e/ou `platforms` |
| Equipe libera ou revoga o acesso | `AffiliatesController.approve` / `revoke` | `status` alterna `active` ⇄ `inactive` |
| Equipe aprova uma afiliação informando o ID por produto (via solicitação ou afiliação direta) | `AffiliationsService.conclude` / `AffiliatesController.grant` | Entra o aff_id/Affiliate ID em `platforms` (e, no grant, o ID de conta informado pelo admin) |
| Equipe corrige o ID por produto de uma afiliação | `AffiliationsService.setPlatformAffiliateId` | Troca/remove a entrada em `platforms` |
| Equipe exclui um produto | `CatalogController.deleteProduct` | As afiliações somem em cascata ⇒ os aff_ids daquele produto saem de `platforms` de cada afiliado afetado |
| **Reconciliação periódica** (10 s após o boot e a cada `RANKING_SYNC_INTERVAL_MIN`) | `AffiliateSyncService.syncAll` | Rede de segurança: recalcula a identidade de todos os afiliados e enfileira webhook só para quem mudou (pega qualquer alteração que não passou pelos pontos acima, ex.: ajuste direto no banco) |
| **Carga inicial após o deploy** | Primeira reconciliação (a migration deixa `affiliate_integration_state` vazia) | **Um webhook por afiliado** existente, todos com o estado atual |

Não dispara: login, mudança de e-mail/WhatsApp/nível/preferências, IDs de CartPanda, afiliações pendentes/rejeitadas, exclusão de usuário (não há endpoint; se uma conta for removida direto no banco, as linhas de integração somem em cascata e **nenhum aviso é enviado** — o dashboard só percebe pela ausência no mapping completo).

### Entrega, resposta esperada e retry

- A linha da outbox nasce **na mesma transação** da mudança de negócio (nunca se perde um evento). Um worker entrega: ~250 ms após o commit e, de resto, num tick a cada **20 s**, em lotes de até **25** entregas por tick, ordenados por `next_attempt_at`.
- **Qualquer 2xx = entregue.** Qualquer outro status (3xx, 4xx ou 5xx), erro de rede ou **timeout de 10 s** (`DASHBOARD_TIMEOUT_MS`) = nova tentativa. Não há tratamento especial para 4xx: se o dashboard responder 400/404/409 a um evento que considera inválido ou duplicado, ele vai recebê-lo mais 7 vezes. **Responda 2xx sempre que já tiver processado ou decidido ignorar o evento**; reserve não-2xx para "não consegui processar agora, mande de novo".
- Responda rápido (idealmente < 1–2 s): persista e responda; processe pesado depois. O corpo da resposta é ignorado (só os primeiros 300 caracteres de um corpo de erro são guardados em `last_error` para diagnóstico).

### Backoff

`8` tentativas no total. Depois da falha de número `n`, a espera é `min(30 s × 2^(n−1), 1 h)`:

| Tentativa | Quando |
| --- | --- |
| 1 | Imediata (≈250 ms após o commit, ou no próximo tick de 20 s) |
| 2 | 30 s após a falha da 1ª |
| 3 | 1 min após a falha da 2ª |
| 4 | 2 min após a falha da 3ª |
| 5 | 4 min após a falha da 4ª |
| 6 | 8 min após a falha da 5ª |
| 7 | 16 min após a falha da 6ª |
| 8 | 32 min após a falha da 7ª |
| — | 8ª falhou ⇒ linha vira **`FAILED`** (≈ 63,5 min depois da 1ª tentativa) e a equipe reabre via `POST /api/integrations/outbox/retry` (seção 9), que zera as tentativas e recomeça a tabela |

O teto de 1 h existe no código (`OUTBOX_MAX_DELAY_MS`), mas não chega a ser usado com 8 tentativas. Cada tentativa acontece no primeiro tick (20 s) depois do horário calculado, então os tempos reais podem ser até 20 s maiores.

### Idempotência e ordem — o que o dashboard deve implementar

- **O corpo é sempre o estado COMPLETO e atual** do afiliado. Aplique como **substituição** (`name`, `status` e o conjunto `platforms` inteiro), nunca como acréscimo.
- **`affiliate_id` desconhecido ⇒ crie** o afiliado. Não existe evento `created`; o primeiro `affiliate.updated` é a criação.
- Guarde, por afiliado, o `occurred_at` do último estado aplicado. Ao receber um evento com `occurred_at` **menor** que o guardado, **ignore e responda 2xx** (é uma tentativa atrasada ou reordenada). Igual ⇒ mesmo estado, pode ignorar ou reaplicar (é idempotente).
- `X-Event-Id` identifica a **entrega** (linha da outbox), e repete entre as tentativas da mesma entrega. Use-o para log/rastreio. **Não** use só ele para deduplicar: por causa da coalescência (abaixo), duas tentativas com o mesmo `X-Event-Id` podem trazer corpos **diferentes** (o mais novo tem `occurred_at` maior) — a regra do `occurred_at` cobre os dois casos.
- Ordem entre afiliados diferentes não é garantida (nem importa). Para o mesmo afiliado, a regra do `occurred_at` resolve.

### Coalescência

Existe **no máximo uma entrega `PENDING` por afiliado**. Se a identidade muda de novo antes da entrega anterior ser concluída, a linha pendente é **atualizada** com o payload mais recente (e `next_attempt_at = agora`); o contador de tentativas não é zerado. Efeito: numa rajada de mudanças o dashboard pode receber **um único webhook** (o estado final) em vez de vários — o que é correto, porque cada corpo é o estado completo.

### Testando o endpoint do dashboard

Reproduza exatamente o que esta API envia:

```bash
curl -i -X POST "$DASHBOARD_URL/api/integrations/affiliates/webhook" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "X-Api-Key: $DASHBOARD_API_KEY" \
  -H "X-Event-Id: cmfgqz7yk0003v8l4b1c2d3e4" \
  -H "X-Event-Type: affiliate.updated" \
  -H "X-Webhook-Attempt: 1" \
  -H "User-Agent: NorthScale-Afiliados/1.0" \
  -d '{"event":"affiliate.updated","affiliate_id":"cmfgq1x2a0000v8l4h3k9d2pw","name":"Maria Silva","status":"active","platforms":[{"platform":"buygoods","external_id":"mariasilva"},{"platform":"buygoods","external_id":"ms8841"},{"platform":"digistore24","external_id":"maria_ds"},{"platform":"jvzoo","external_id":"1234567"}],"occurred_at":"2026-09-12T13:37:00.123Z"}'
```

Esperado: `HTTP/1.1 200` (ou qualquer 2xx). Repetir o mesmo comando deve continuar respondendo 2xx sem duplicar nada.

---

## 7. `GET …/metrics` (o dashboard deve implementar)

Esta API busca no dashboard as métricas agregadas **por afiliado** para montar o ranking. O dashboard é a **autoridade** sobre o cálculo: esta API grava o que recebeu e exibe — não soma, não recalcula `net_sales` nem `refund_rate`.

### Requisição (feita por esta API)

```
GET {DASHBOARD_URL}/api/integrations/affiliates/metrics?period=7d
GET {DASHBOARD_URL}/api/integrations/affiliates/metrics?period=30d
GET {DASHBOARD_URL}/api/integrations/affiliates/metrics?period=mtd
GET {DASHBOARD_URL}/api/integrations/affiliates/metrics?period=custom&from=2026-09-01&to=2026-09-12
```

Headers: `Accept: application/json`, `Content-Type: application/json` (enviado mesmo sem corpo), `X-Api-Key: <DASHBOARD_API_KEY>`, `User-Agent: NorthScale-Afiliados/1.0`. Sem corpo.

| Parâmetro | Valores | Descrição |
| --- | --- | --- |
| `period` | `7d` \| `30d` \| `mtd` \| `custom` | Período dos agregados |
| `from`, `to` | `AAAA-MM-DD` | Só com `period=custom`. Esta API garante: datas válidas, `from <= to`, intervalo de no máximo **366 dias**. |

### Semântica recomendada dos períodos

O dashboard define o corte; recomenda-se:

| `period` | Janela |
| --- | --- |
| `7d` | Janela móvel dos **últimos 7 dias, incluindo o dia corrente** (hoje e os 6 anteriores) |
| `30d` | Janela móvel dos **últimos 30 dias, incluindo o dia corrente** |
| `mtd` | Do **dia 1 do mês corrente** até agora (month-to-date) |
| `custom` | De `from` a `to`, **ambos inclusivos**, dias inteiros |

Fuso de referência para "dia": **America/Sao_Paulo**. Se o dashboard usar outro critério (ex.: data do pedido vs. data da aprovação, fuso diferente), o ranking simplesmente refletirá esse critério — documente-o do seu lado.

### Resposta esperada

`200` com JSON: uma **lista** de objetos, ou um objeto `{"data": [...]}` (os dois formatos são aceitos). Qualquer outra forma (objeto sem `data`, string, HTML) invalida a rodada.

```json
[
  { "affiliate_id": "cmfgq1x2a0000v8l4h3k9d2pw", "gross_sales": 1250.50, "refunds": 50.00, "net_sales": 1200.50, "orders_count": 31, "refund_rate": 4.2 },
  { "affiliate_id": "cmfgq5abc0001v8l4qq77zz10", "gross_sales": 0, "refunds": 0, "net_sales": 0, "orders_count": 0, "refund_rate": 0 }
]
```

| Campo | Tipo | Unidade | Descrição |
| --- | --- | --- | --- |
| `affiliate_id` | string, não vazia | — | **O `affiliate_id` desta API** (`users.id`), nunca o ID da plataforma |
| `gross_sales` | número | USD, 2 casas | Vendas brutas no período |
| `refunds` | número | USD, 2 casas | Reembolsos no período |
| `net_sales` | número | USD, 2 casas | Vendas líquidas — **é o critério do ranking** |
| `orders_count` | número inteiro | pedidos | Quantidade de pedidos |
| `refund_rate` | número | **porcentagem 0–100** | Ex.: `4.2` significa 4,2 % (não `0.042`) |

Tipos: envie **números JSON**. Strings numéricas (`"1250.50"`) são aceitas (convertidas com `Number()`), mas desaconselhadas. `NaN`/`Infinity`, `null`, booleanos ou strings não numéricas invalidam a linha. Campos extras são ignorados.

### Regras de processamento (o que esta API faz com a resposta)

- **Uma linha por afiliado.** `affiliate_id` repetido ⇒ **a última vence**.
- Linha sem `affiliate_id` string não vazia, ou sem **qualquer um dos 5 campos** numéricos ⇒ **descartada** e contada em `invalid`.
- `affiliate_id` que não é um usuário `AFILIADO` desta API ⇒ **ignorado** e contado em `unknown` (aparece no log e em `GET /api/integrations/status`). Não é erro.
- **Lista vazia é válida** = ninguém vendeu no período; todos os afiliados ficam com zeros.
- Afiliados **ausentes** da lista ficam com zeros no ranking (`has_data: false`) — pode omitir quem não tem movimento.
- Resposta não-2xx, timeout (**10 s**, `DASHBOARD_TIMEOUT_MS`), corpo não-JSON ou formato inválido ⇒ a rodada daquele período falha (`ranking_sync_runs.ok = false`, `error` com o motivo, ex.: `metrics 7d: HTTP 500: ...` ou `metrics 7d: timeout`) e o ranking continua mostrando a **última rodada boa**.

### Cadência

- A cada `RANKING_SYNC_INTERVAL_MIN` (padrão **15 min**), e 10 s após o boot: **3 chamadas sequenciais** (`7d`, `30d`, `mtd`).
- `custom`: **sob demanda**, quando um usuário abre um período personalizado no painel; o resultado fica em cache por 15 min por par `from:to` (`period` interno `custom:AAAA-MM-DD:AAAA-MM-DD`). Máximo 366 dias.
- O admin pode forçar uma rodada a qualquer momento (`POST /api/integrations/sync`).

Prepare a resposta para caber folgadamente em 10 s (agregados pré-calculados ou consulta indexada).

### Exemplo (curl, simulando esta API)

```bash
curl -s "$DASHBOARD_URL/api/integrations/affiliates/metrics?period=7d" \
  -H "Accept: application/json" \
  -H "X-Api-Key: $DASHBOARD_API_KEY" \
  -H "User-Agent: NorthScale-Afiliados/1.0"

curl -s "$DASHBOARD_URL/api/integrations/affiliates/metrics?period=custom&from=2026-09-01&to=2026-09-12" \
  -H "Accept: application/json" \
  -H "X-Api-Key: $DASHBOARD_API_KEY"
```

Resposta válida também no formato envelopado:

```json
{ "data": [ { "affiliate_id": "cmfgq1x2a0000v8l4h3k9d2pw", "gross_sales": 1250.5, "refunds": 50, "net_sales": 1200.5, "orders_count": 31, "refund_rate": 4.2 } ] }
```

---

## 8. Ranking (interno desta API)

### Job de métricas (`RankingSyncService` + `IntegrationSchedulerService`)

- Primeira rodada **10 s após o boot**; depois a cada `RANKING_SYNC_INTERVAL_MIN` (15 min). Cada rodada = reconciliação de identidades → métricas (`7d`, `30d`, `mtd`) → processamento da outbox. Rodadas sobrepostas são ignoradas (réplica única).
- Para cada período, todas as linhas gravadas em `affiliate_metrics_snapshots` recebem o **mesmo `fetched_at`**, e uma linha é criada em `ranking_sync_runs` (`ok`, `stored`, `unknown`, `invalid`) na mesma transação. Em falha, só a linha de run (`ok = false`, `error`).
- A **rodada vigente** de um período é a última com `ok = true`. Uma rodada com lista vazia é válida e substitui a anterior (período sem vendas mostra zeros, não dados velhos).
- Retenção: snapshots e runs com `fetched_at` mais velho que `RANKING_SNAPSHOT_RETENTION_DAYS` (30) são apagados ao fim de cada rodada.
- Sem `DASHBOARD_URL`/`DASHBOARD_API_KEY`, o job não roda.

### `GET /api/ranking` (JWT do usuário)

```
GET https://api.thenorthscales.com/api/ranking?period=7d|30d|mtd|custom[&from=AAAA-MM-DD&to=AAAA-MM-DD][&limit=1..100]
Authorization: Bearer <access token do usuário>
```

| Parâmetro | Padrão | Regras |
| --- | --- | --- |
| `period` | `7d` | `7d`, `30d`, `mtd` ou `custom`; outro valor ⇒ 400 `period deve ser 7d, 30d, mtd ou custom` |
| `from`, `to` | — | Obrigatórios em `custom`: `AAAA-MM-DD` válidos no calendário, `from <= to`, no máximo 366 dias. Erros 400: `from deve ser uma data AAAA-MM-DD`, `from não é uma data válida`, `from deve ser anterior ou igual a to`, `intervalo custom limitado a 366 dias` |
| `limit` | `RANKING_TOP_N` (10) | Inteiro de 1 a 100; fora disso ⇒ 400 `limit deve ser um inteiro entre 1 e 100` |

Em `custom`, se o último snapshot daquele `from:to` tem mais de 15 min (ou não existe), a API busca no dashboard **antes** de responder; se a busca falhar, responde com o que houver (o `fetched_at` diz de quando é).

Resposta `200`:

```json
{
  "period": "7d",
  "fetched_at": "2026-09-12T13:45:00.512Z",
  "total": 42,
  "me": {
    "position": 7,
    "affiliate_id": "cmfgq1x2a0000v8l4h3k9d2pw",
    "name": "Maria Silva",
    "level": "PLENO",
    "anonymous": false,
    "is_me": true,
    "has_data": true,
    "gross_sales": 1250.5,
    "refunds": 50,
    "net_sales": 1200.5,
    "orders_count": 31,
    "refund_rate": 4.2
  },
  "top": [
    { "position": 1, "affiliate_id": "cmfg…01", "name": "Carlos Lima", "level": "FUNDADOR", "anonymous": false, "is_me": false, "has_data": true, "gross_sales": 9800, "refunds": 200, "net_sales": 9600, "orders_count": 210, "refund_rate": 2.04 },
    { "position": 2, "affiliate_id": "cmfg…02", "name": null, "level": "BASE", "anonymous": true, "is_me": false, "has_data": true, "gross_sales": 5100, "refunds": 0, "net_sales": 5100, "orders_count": 97, "refund_rate": 0 }
  ]
}
```

| Campo | Descrição |
| --- | --- |
| `period`, `from`, `to` | Ecoam a requisição (`from`/`to` só em `custom`) |
| `fetched_at` | `fetched_at` da rodada vigente; **`null` = nenhuma rodada bem-sucedida ainda** (então `total: 0`, `me: null`, `top: []`) |
| `total` | Quantidade de afiliados ranqueados (todos os afiliados com acesso liberado) |
| `me` | Entrada do próprio usuário (sempre presente para afiliado liberado); **`null` para ADMIN** |
| `top` | As `limit` primeiras posições |
| `position` | 1-based |
| `name` | `null` quando o afiliado optou por não aparecer no ranking (`showInRanking = false`) **e** quem está vendo não é ele mesmo nem admin |
| `level` | `BASE` \| `PLENO` \| `FUNDADOR` |
| `anonymous` | `true` se o afiliado optou por não aparecer (visível para todos, inclusive quando `name` vem preenchido para o próprio/admin) |
| `is_me` | `true` na entrada do usuário logado |
| `has_data` | `false` = o dashboard não devolveu linha para ele nesta rodada (métricas zeradas) |
| Métricas | Como vieram do dashboard, arredondadas a 2 casas (`orders_count` a inteiro) |

Regras:

- Entram **todos** os usuários `AFILIADO` com acesso liberado (`approvedAt` preenchido), tenham ou não vendas — todo afiliado liberado tem posição.
- Ordem: `net_sales` desc → `orders_count` desc → `refund_rate` asc → nome asc → `affiliate_id` asc (determinística).
- Quem optou por não aparecer **mantém a posição** (senão as demais mudariam), mas fica anônimo para os outros afiliados.
- Admin vê todos os nomes e não tem `me`.

### Tela no painel

A tela **`/ranking`** do painel (`app.thenorthscales.com/ranking`) consome este endpoint: mostra a posição do usuário (`me`), o top e o seletor de período (7 dias, 30 dias, mês e personalizado), com `fetched_at` como "atualizado em".

---

## 9. Operação

Rotas de administração (JWT de usuário `ADMIN` em `Authorization: Bearer …`; outro papel ⇒ 403).

### `GET /api/integrations/status`

```bash
curl -s https://api.thenorthscales.com/api/integrations/status -H "Authorization: Bearer $JWT_ADMIN"
```

```json
{
  "inbound": { "configured": true },
  "dashboard": { "configured": true, "baseUrl": "https://dashboard.exemplo.com" },
  "scheduler": { "enabled": true, "intervalMin": 15 },
  "mapping": { "affiliates": 42, "platformIds": 97 },
  "outbox": { "pending": 0, "sent": 130, "failed": 0, "oldestPendingAt": null },
  "ranking": [
    { "period": "7d",  "last": { "fetched_at": "2026-09-12T13:45:00.512Z", "ok": true,  "stored": 40, "unknown": 1, "invalid": 0, "error": null } },
    { "period": "30d", "last": { "fetched_at": "2026-09-12T13:45:01.020Z", "ok": false, "stored": 0,  "unknown": 0, "invalid": 0, "error": "metrics 30d: timeout" } },
    { "period": "mtd", "last": null }
  ]
}
```

| Campo | Significado |
| --- | --- |
| `inbound.configured` | `INTEGRATION_API_KEY` presente (mapping responde 200/401 em vez de 503) |
| `dashboard.configured` / `baseUrl` | `DASHBOARD_URL` + `DASHBOARD_API_KEY` presentes; `baseUrl` `null` se vazia |
| `scheduler.enabled` / `intervalMin` | Timers ligados (`INTEGRATION_WORKERS`, `NODE_ENV`) e intervalo efetivo |
| `mapping.affiliates` | Afiliados com identidade publicada (`affiliate_integration_state`) |
| `mapping.platformIds` | Total de pares plataforma/ID (`affiliate_platform_ids`) |
| `outbox.pending/sent/failed` | Contagem por status; `oldestPendingAt` = `created_at` da pendência mais antiga (atraso de entrega) ou `null` |
| `ranking[].last` | **Última rodada** de cada período fixo (bem-sucedida ou não); `null` = nunca rodou |

### `POST /api/integrations/sync`

Roda agora reconciliação + métricas + outbox (não espera o timer). Resposta `200`:

```json
{
  "reconcile": { "total": 42, "changed": 0, "conflicts": 0 },
  "ranking": {
    "ok": [ { "period": "7d", "fetchedAt": "2026-09-12T14:01:00.100Z", "stored": 40, "unknown": 1, "invalid": 0 } ],
    "failed": [ { "period": "30d", "error": "metrics 30d: HTTP 500: Internal Server Error" } ]
  },
  "outbox": { "sent": 2, "retried": 0, "failed": 0 },
  "ran": true
}
```

`ran: false` (com os demais zerados/`null`) = já havia uma rodada em andamento e nada foi feito; chame de novo depois. `reconcile`/`ranking` vêm `null` só se a etapa lançou erro inesperado (ex.: banco fora); com o dashboard não configurado, `ranking` é `{"ok":[],"failed":[]}`.

### `POST /api/integrations/outbox/retry`

Reabre todas as entregas `FAILED` (volta para `PENDING`, `attempts = 0`, `next_attempt_at = agora`) e dispara o processamento. Resposta `200`: `{ "reopened": 3 }`.

### Onde ver falhas

| Sintoma | Onde olhar |
| --- | --- |
| Webhook não chega no dashboard | `integration_outbox`: linhas `PENDING` com `attempts > 0` ou `FAILED`; `last_error` (ex.: `HTTP 401: ...`, `timeout`, `ECONNREFUSED`) e `last_status` (status HTTP; `null` sem resposta). Log `WebhookOutboxService` (`warn` por tentativa, `error` ao virar FAILED). |
| Ranking vazio ou parado | `ranking_sync_runs` com `ok = false` e `error`; `GET /api/integrations/status` → `ranking[].last`. Log `RankingSyncService`. `unknown > 0` = o dashboard mandou `affiliate_id` que não existe aqui (IDs listados no log). |
| ID de plataforma "sumiu" do afiliado | Log `AffiliateSyncService` (`ID <Plataforma> "<id>" do afiliado <x> ignorado: já pertence ao afiliado <y>`); `reconcile.conflicts` no `POST /sync`. |
| Mapping responde 503 / 401 | `INTEGRATION_API_KEY` vazia / chave errada; log `ApiKeyGuard`. |
| Nada acontece | `scheduler.enabled = false` (`INTEGRATION_WORKERS=false`); `dashboard.configured = false`. Log `DashboardClient` avisa uma vez. |

---

## 10. Tabelas novas

Migration `20260912100000_integracao_dashboard`. Enums: `MappingPlatform` (`BUYGOODS`, `DIGISTORE24`, `JVZOO`) e `OutboxStatus` (`PENDING`, `SENT`, `FAILED`).

| Tabela | Para quê | Colunas principais |
| --- | --- | --- |
| `affiliate_platform_ids` | Identidade por plataforma (derivada de `checkout_accounts` + `affiliations.platformAffiliateId` aprovadas) | `id`, `affiliate_id` (FK `users`, cascade), `platform` (`MappingPlatform`), `external_id` (normalizado), `created_at`, `updated_at`. **Único** `(platform, external_id)`; índice `affiliate_id` |
| `affiliate_integration_state` | Último estado publicado por afiliado | `affiliate_id` (PK, FK `users`, cascade), `fingerprint` (sha256 de nome+status+IDs), `created_at`, `updated_at` (= cursor do `updated_since`; só muda quando o fingerprint muda). Índice `updated_at` |
| `integration_outbox` | Fila de entrega do webhook | `id` (= `X-Event-Id`), `affiliate_id`, `event` (`affiliate.updated`), `payload` (JSONB = corpo enviado), `status`, `attempts`, `next_attempt_at`, `last_error`, `last_status`, `created_at`, `updated_at`, `sent_at`. Índices `(status, next_attempt_at)`, `affiliate_id` |
| `affiliate_metrics_snapshots` | Métricas como vieram do dashboard, por rodada | `id`, `affiliate_id`, `period` (`7d` · `30d` · `mtd` · `custom:AAAA-MM-DD:AAAA-MM-DD`), `metrics` (JSONB `{gross_sales, refunds, net_sales, orders_count, refund_rate}`), `fetched_at`. Índices `(period, fetched_at)`, `affiliate_id` |
| `ranking_sync_runs` | Uma linha por rodada e período | `id`, `period`, `fetched_at`, `ok`, `stored`, `unknown`, `invalid`, `error`, `created_at`. Índice `(period, ok, fetched_at)` |

### Backfill (roda na migration)

1. `affiliate_platform_ids` recebe os **IDs de conta** já cadastrados (`checkout_accounts` de usuários `AFILIADO`, plataformas `BUYGOODS`/`DIGISTORE24`/`JVZOO`, valor não vazio), normalizados com `lower(btrim(...))`, na ordem `createdAt, id`, com `ON CONFLICT (platform, external_id) DO NOTHING`.
2. Depois recebe os **IDs por produto** (`affiliations` com `status = 'APROVADO'`, plataformas `BUYGOODS`/`JVZOO`, `platformAffiliateId` não vazio), na ordem `requestedAt, id`, também com `DO NOTHING`.
3. Regra **"cadastro mais antigo vence"**: se dois afiliados tinham o mesmo ID na mesma plataforma, fica com quem cadastrou primeiro (IDs de conta têm precedência sobre IDs por produto porque são inseridos antes). Os perdedores aparecem no log da primeira reconciliação como conflito, para a equipe resolver.
4. `affiliate_integration_state` fica **vazia de propósito**: a primeira reconciliação (10 s após o boot) publica o estado de todos os afiliados e enfileira **um webhook por afiliado** — essa é a carga inicial do dashboard.

Linhas do backfill têm `id` no formato `apid_c_<md5>` (conta) / `apid_a_<md5>` (afiliação); as criadas depois são cuid.

---

## 11. Checklist de implantação

1. **Gerar as duas chaves** (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`, duas vezes): uma vira `INTEGRATION_API_KEY` (dashboard → esta API), outra `DASHBOARD_API_KEY` (esta API → dashboard).
2. **Configurar o ambiente nos dois lados**:
   - Esta API (`.env` de produção): `INTEGRATION_API_KEY`, `DASHBOARD_URL`, `DASHBOARD_API_KEY` (+ opcionais da seção 3).
   - Dashboard: chave aceita = `DASHBOARD_API_KEY`; chave enviada = `INTEGRATION_API_KEY`; URL desta API = `https://api.thenorthscales.com`.
3. **Subir no dashboard** o `POST /api/integrations/affiliates/webhook` (seção 6) e o `GET /api/integrations/affiliates/metrics` (seção 7) — o metrics pode começar devolvendo `[]`. Testar com os curls das seções 6 e 7 **antes** do passo seguinte, para os webhooks da carga inicial não caírem em `FAILED`.
4. **Deploy desta API** (push na `main` ⇒ auto-deploy; o container roda `prisma migrate deploy` no boot, antes de subir a aplicação — a migration cria as tabelas e faz o backfill).
5. **Carga inicial automática**: 10 s após o boot a reconciliação publica todos os afiliados e enfileira um webhook por afiliado; a outbox entrega em lotes de 25 a cada 20 s (≈ 75/min). Na mesma rodada acontece a primeira busca de métricas.
6. **Conferir `GET /api/integrations/status`** (admin): `inbound.configured` e `dashboard.configured` `true`; `outbox.pending` caindo até 0 e `failed = 0`; `ranking[].last.ok = true` nos três períodos; `unknown` baixo (o dashboard está devolvendo `affiliate_id` corretos). Conferir também `GET /health` e um `curl …/mapping` com a chave, feito do lado do dashboard.
7. **Carga inicial alternativa via mapping**: se o dashboard subiu depois desta API (ou perdeu webhooks), basta paginar `GET …/mapping` sem `updated_since` (seção 5) — o resultado é idêntico ao que os webhooks entregariam. Webhooks `FAILED` podem ser reabertos com `POST /api/integrations/outbox/retry`.
8. Validar de ponta a ponta: aprovar uma afiliação de teste com aff_id, ver o webhook chegar com o novo `external_id`, receber uma venda de teste no dashboard atribuída ao `affiliate_id` certo, e ver o afiliado subir no `GET /api/ranking` na próxima rodada (ou após `POST /api/integrations/sync`).
