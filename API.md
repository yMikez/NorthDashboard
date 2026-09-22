# API do NorthScale Dashboard — guia de integração

Como um sistema externo lê dados do dashboard (e manda dados pra ele).

**Base URL:** `https://dash.thenorthscales.com`
Tudo é JSON (`Content-Type: application/json`), datas em ISO 8601 (UTC) e dinheiro em **USD**.
Nenhum endpoint de leitura libera CORS (a única exceção é `/api/page-state`, que existe para
o beacon das páginas de funil): chame do **servidor**, nunca do navegador.

---

## 1. Qual credencial usar

| Quero… | Use | Header |
| --- | --- | --- |
| Puxar qualquer dado (ordens, lucro, logs) de um job/backend | **Chave de operação** (`INGEST_SECRET`) | `Authorization: Bearer <chave>` |
| Puxar o ranking por afiliado (sistema de afiliados) | **Chave de integração** (`DASHBOARD_API_KEY`) | `X-Api-Key: <chave>` |
| Ler exatamente o que uma aba mostra | **Sessão de usuário** | `Cookie: ns_session=…` (ver §2.3) |
| Mandar venda/evento pra dentro | **Chave de ingestão** (`INGEST_SECRET`) | `X-Ingest-Secret: <chave>` |

> A chave de operação abre **tudo**, inclusive rotas que escrevem no banco. Guarde como
> segredo de servidor, nunca em front-end, app mobile ou repositório. Para dar acesso
> parcial a um parceiro, prefira a sessão de usuário (§2.3), que respeita permissão por aba.

Cada chave vive numa variável de ambiente do servidor; a de afiliados também pode ficar no
banco (painel → Plataformas → Sistema de afiliados). Peça as chaves a quem administra o
dashboard — elas não estão neste documento.

---

## 2. Autenticação

### 2.1 Chave de operação (Bearer)

```bash
curl -H "Authorization: Bearer $DASH_KEY" \
  "https://dash.thenorthscales.com/api/admin/orders-dump?platform=jvzoo&start=2026-09-20&end=2026-09-20"
```

Vale em todas as rotas `/api/admin/*`. Chave errada ou ausente → `401`.

### 2.2 Chave de integração (X-Api-Key)

Escopo restrito: só os dois endpoints do sistema de afiliados (§3.2 e §5.2).

```bash
curl -H "X-Api-Key: $AFFILIATES_KEY" \
  "https://dash.thenorthscales.com/api/integrations/affiliates/metrics?period=7d"
```

Sem chave configurada no servidor → `503`. Chave errada → `401`.

### 2.3 Sessão de usuário (para ler as abas)

Os endpoints `/api/metrics/*` alimentam a interface e exigem sessão, com permissão por aba.
Crie um usuário dedicado só com as abas necessárias e faça login por API:

```bash
# 1) login — guarda o cookie
curl -s -c cookies.txt -X POST \
  -H "Content-Type: application/json" \
  -d '{"email":"integracao@exemplo.com","password":"…"}' \
  https://dash.thenorthscales.com/api/auth/signin

# 2) usa o cookie nas chamadas seguintes
curl -s -b cookies.txt \
  "https://dash.thenorthscales.com/api/metrics/overview?start_date=2026-09-01T03:00:00.000Z&end_date=2026-10-01T02:59:59.999Z"
```

O cookie `ns_session` é `HttpOnly` e vale **20 dias**, renovando a cada uso. Faça login de
novo quando receber `401`. Sem permissão na aba → `403 {"error":"forbidden","tab":"…"}`.
`GET /api/me` devolve o usuário da sessão — bom para testar se o cookie ainda vale.

---

## 3. Puxar dados

### 3.1 Ordens brutas — reconciliação linha a linha

O caminho mais direto para levar vendas para fora (BI, planilha, conferência com o painel
da plataforma).

```
GET /api/admin/orders-dump?platform=<slug>&start=YYYY-MM-DD&end=YYYY-MM-DD
Auth: Bearer
```

- `platform`: `jvzoo`, `buygoods`, `digistore24`, `clickbank`, `cartpanda`, `pagamerican`
- `start`/`end`: dias **inteiros em BRT** (fuso de São Paulo), inclusivos
- Teto de **50.000 linhas** por chamada; `truncated: true` avisa que bateu o limite — quebre
  o período em pedaços menores.

```json
{
  "platform": "jvzoo", "start": "2026-09-20", "end": "2026-09-20",
  "count": 1688, "truncated": false,
  "orders": [{
    "externalId": "MRZI8U9PDAOB40NWW",
    "parentExternalId": "MRZI8U9PDAOB40NWW",
    "sessionId": "jvz:cliente@exemplo.com:2026-09-19",
    "status": "APPROVED",
    "productType": "FRONTEND",
    "funnelStep": 1,
    "trafficSource": null, "trackingId": "6aaf49dd…", "clickId": null, "campaignKey": null,
    "gross": 294, "net": 23.01, "cpa": 245,
    "orderedAt": "2026-09-20T03:00:57.000Z",
    "refundedAt": null, "chargebackAt": null,
    "country": "US",
    "productId": "450941", "productName": "NeuroRecall 6 Bottles", "family": "NeuroRecall",
    "affiliateId": "3552183", "affiliateName": "xx483",
    "customerEmail": "cliente@exemplo.com"
  }]
}
```

Campos que costumam gerar dúvida:

| Campo | O que é |
| --- | --- |
| `status` | `APPROVED`, `REFUNDED`, `CHARGEBACK`, `PENDING`, `CANCELED` |
| `productType` | papel da venda no funil: `FRONTEND`, `UPSELL`, `DOWNSELL`, `BUMP`, `SMS_RECOVERY` |
| `sessionId` | agrupa a sessão de compra (front + upsells do mesmo cliente) |
| `gross` | valor cheio da venda |
| `net` | o que sobrou depois da taxa da plataforma e da comissão do afiliado |
| `cpa` | comissão paga ao afiliado por essa venda |
| `refundedAt` / `chargebackAt` | quando o estorno aconteceu (pode ser muito depois da venda) |

### 3.2 Ranking por afiliado

```
GET /api/integrations/affiliates/metrics?period=7d|30d|mtd|custom&from=YYYY-MM-DD&to=YYYY-MM-DD
Auth: X-Api-Key
```

`custom` exige `from` e `to` (máximo de 366 dias). Resposta:

```json
[{ "affiliate_id": "af_123", "gross_sales": 128400.5, "refunds": 9310.2,
   "net_sales": 119090.3, "orders_count": 412, "refund_rate": 4.85 }]
```

Ordenado por `net_sales` decrescente. `refund_rate` é **% de pedidos** estornados, não % de
valor. Cabeçalhos úteis: `X-Period`, `X-Period-From`, `X-Period-To`, `X-Cache` (`HIT`/`MISS`).
A resposta fica em cache por **5 minutos**.

O `affiliate_id` aqui é o do sistema de afiliados, não o ID da plataforma. Contrato completo
em [`integration-dashboard.md`](integration-dashboard.md).

### 3.3 Lucro e margem de contribuição

```
GET  /api/admin/net-profit?start_date=<ISO>&end_date=<ISO>     → cálculo do período
POST /api/admin/net-profit/daily {start_date, end_date, params} → o mesmo, dia a dia (≤62 dias)
GET  /api/admin/net-profit/params                               → premissas vigentes
Auth: Bearer
```

O `GET` devolve `result.kpis` (receita econômica, custos variáveis, lucro de contribuição,
margem oficial, lucro por FE, CPA médio), `result.channels` (plataformas, call centers,
recuperação, SalesBound), `result.products`, `result.affiliates`, `needs` (o que falta
informar) e `history` (quem mudou qual taxa e quando). A régua está em
[`calculo_margem_northscale.md`](calculo_margem_northscale.md).

> As premissas (reembolso %, custo de produto %, comissões) são definidas por quem opera o
> dashboard. **Leia** por aqui; mudar (`PUT …/params`) altera o número que todo mundo vê.

### 3.4 Call center e SalesBound

```
GET /api/admin/salesbound/import?from=<ISO>&to=<ISO>[&detail=1][&cc=1]
Auth: Bearer
```

Sem parâmetros devolve só a cobertura do razão. `breakdown` traz o total por dia e por fonte
(export CSV × webhook), `detail=1` lista as transações e `cc=1` mostra o que a aba Call
Center enxerga (venda com estorno já abatido).

### 3.5 Auditoria da ingestão

```
GET /api/admin/ingest-logs?platform=<slug>&limit=50   → últimos eventos recebidos
GET /api/admin/ingest-logs?id=<id>                    → payload completo de um evento
Auth: Bearer
```

Serve para conferir se um evento chegou e com que corpo. Campos: `source`, `platformSlug`,
`eventType`, `externalId`, `signatureOk`, `processedOk`, `error`, `receivedAt`.

### 3.6 Saúde

```
GET /api/health     (aberto, sem chave)
```

`200` com `{"ok":true,…}` quando o banco responde; `503` quando não. Bom para monitoramento.

### 3.7 Endpoints das abas (exigem sessão)

Mesma resposta que a interface consome. Todos aceitam os filtros da §4.

| Endpoint | Aba | Traz |
| --- | --- | --- |
| `/api/metrics/overview` | overview | faturamento, pedidos, AOV, estornos, série diária |
| `/api/metrics/funnel` | funnel | conversão por etapa do funil |
| `/api/metrics/orders` | transactions | lista de vendas (paginada) |
| `/api/metrics/orders-export` | transactions | mesma lista em CSV |
| `/api/metrics/products` | products | desempenho por produto/família |
| `/api/metrics/platforms` | platforms | comparação entre plataformas |
| `/api/metrics/affiliates` | (qualquer aba) | ranking de afiliados |
| `/api/metrics/affiliate-analysis` | affiliate-analysis | janelas 3/7/15/30/60 dias e variação |
| `/api/metrics/refund-cohorts` | refund-cohorts | maturação de reembolso por coorte |
| `/api/metrics/recovery` | recovery | vendas de recuperação |
| `/api/metrics/tauk` | tauk | call center (Tauk, Logicall e SalesBound) |
| `/api/metrics/sms` | sms | saúde do envio de SMS |
| `/api/metrics/costs`, `/api/metrics/fulfillment*` | costs | custo de produto e envio |
| `/api/metrics/health` | health | consistência dos dados |

---

## 4. Filtros comuns dos `/api/metrics/*`

| Parâmetro | Formato | Observação |
| --- | --- | --- |
| `start_date`, `end_date` | ISO 8601 | **obrigatórios**; mande o início e o fim do dia em BRT |
| `platforms` | slugs separados por vírgula | `jvzoo,buygoods` |
| `families` | nomes separados por vírgula | família do produto |
| `products` | IDs externos | |
| `countries` | ISO-2 | `US,CA` |
| `affiliate_id` | IDs separados por vírgula | ID do sistema de afiliados |
| `stages` | `FRONTEND,UPSELL,…` | etapa do funil |
| `compare=1` | — | inclui o período anterior para comparação |

Só em `/api/metrics/orders`: `status`, `product_type`, `search`, `limit`, `offset`.

Exemplo de janela "setembro inteiro" em BRT:
`start_date=2026-09-01T03:00:00.000Z&end_date=2026-10-01T02:59:59.999Z`

---

## 5. Mandar dados para dentro

### 5.1 Ingestão de vendas

```
POST /api/ingest/{clickbank|digistore24|buygoods|jvzoo|cartpanda|pagamerican|tauk|sms-events}
Header: X-Ingest-Secret: <chave>
```

Cada plataforma tem seu formato (é o payload nativo dela, normalmente repassado pelo n8n).
A ingestão é **idempotente**: reenviar o mesmo evento atualiza a venda em vez de duplicar.

A SalesBound é a exceção no auth — aceita o token na query, no header `X-Postback-Token` ou
**dentro do corpo JSON** (`"token": "…"`), porque o CRM deles não manda querystring:

```
GET|POST /api/ingest/salesbound?token=<token>
```

Esses endpoints respondem `200` sempre que conseguiram gravar o evento, mesmo com payload
estranho — para um postback, erro significa retentativa sem ganho. `401` só com token
errado; `500` só quando o banco falha (aí sim, reenvie).

### 5.2 Webhook do sistema de afiliados

```
POST /api/integrations/affiliates/webhook     (evento affiliate.updated)
Header: X-Api-Key: <chave de integração>
```

---

## 6. Como ler os números sem errar

Estes detalhes decidem se o seu relatório vai bater com o dashboard:

- **O dia é BRT.** Toda agregação por dia usa o fuso de São Paulo, mesmo que a plataforma
  informe em outro fuso (ClickBank em Pacífico, Digistore em Berlim, BuyGoods e JVZoo em
  Eastern, SalesBound em Eastern no webhook e Central no export). Os timestamps na resposta
  são UTC; converta antes de agrupar por dia.
- **Estorno tem duas lentes.** Por *data do estorno* (quanto voltou no caixa naquele dia,
  usado na Visão Geral e no Lucro real) e por *coorte* (o estorno abate a venda que o gerou,
  usado na aba Call Center e nas coortes de reembolso). Os dois números são certos e
  diferentes — escolha um e diga qual está usando.
- **Estorno demora semanas.** Um período recente sempre parece melhor do que vai ficar
  depois que a coorte amadurece (a aba de coortes de reembolso mostra essa curva).
- **`gross` é valor cheio.** Taxa da plataforma e comissão de afiliado só saem no `net` e no
  Lucro real.
- **Venda de call center fica fora das métricas de plataforma**, de propósito: a mesma venda
  pode transitar pelas duas e somar duas vezes.

---

## 7. Erros, cache e limites

| Status | Quando |
| --- | --- |
| `400` | parâmetro faltando ou inválido (a mensagem diz qual) |
| `401` | chave errada, cookie expirado ou ausente |
| `403` | sessão válida, mas sem permissão naquela aba |
| `413` | corpo grande demais (ingestão) |
| `503` | integração não configurada no servidor, ou banco fora |

O corpo de erro é `{"error":"…"}` na maioria das rotas e
`{"statusCode":…,"message":"…","error":"…"}` nos endpoints do sistema de afiliados.

- Respostas de `/api/metrics/*` ficam em **cache de 30 segundos** por combinação de
  parâmetros; o ranking de afiliados, **5 minutos**.
- Limites: `orders-dump` corta em 50.000 linhas; período `custom` do ranking vai até 366
  dias; o lucro dia a dia até 62 dias.
- **Não há limite de requisições por enquanto** — o que significa que um laço mal feito
  derruba o dashboard para todo mundo. Puxe em janelas, guarde o resultado do seu lado e
  evite chamadas em paralelo sem necessidade.

---

## 8. Receitas

**Sincronizar as vendas de ontem (Node):**

```js
const dia = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
for (const plataforma of ['jvzoo', 'buygoods', 'digistore24']) {
  const r = await fetch(
    `https://dash.thenorthscales.com/api/admin/orders-dump?platform=${plataforma}&start=${dia}&end=${dia}`,
    { headers: { Authorization: `Bearer ${process.env.DASH_KEY}` } },
  );
  if (!r.ok) throw new Error(`${plataforma}: HTTP ${r.status}`);
  const { orders, truncated } = await r.json();
  if (truncated) throw new Error(`${plataforma}: passou de 50k linhas — quebre o período`);
  await gravarNoMeuBanco(plataforma, orders);   // chave: externalId
}
```

**Ranking dos últimos 7 dias (Python):**

```python
import requests
r = requests.get(
    "https://dash.thenorthscales.com/api/integrations/affiliates/metrics",
    params={"period": "7d"},
    headers={"X-Api-Key": AFFILIATES_KEY},
    timeout=30,
)
r.raise_for_status()
for a in r.json()[:10]:
    print(a["affiliate_id"], a["net_sales"], f'{a["refund_rate"]}%')
```

**Margem do mês (curl):**

```bash
curl -s -H "Authorization: Bearer $DASH_KEY" \
  "https://dash.thenorthscales.com/api/admin/net-profit?start_date=2026-09-01T03:00:00.000Z&end_date=2026-10-01T02:59:59.999Z" \
  | jq '.result.kpis | {receita: .revenue, lucro: .profit, margem: .marginPct}'
```

---

## 9. Segurança

- Chave só no servidor. Se vazar, gere outra e atualize o `.env` do dashboard (e o n8n, que
  usa a mesma chave de ingestão).
- Para acesso de terceiro, crie um usuário com as abas mínimas em vez de entregar a chave de
  operação.
- Todo tráfego é HTTPS. O endpoint de login não diz se o erro foi no e-mail ou na senha —
  não tente inferir.
- Dados de cliente (e-mail, telefone, endereço) aparecem em `orders-dump` e nos logs de
  ingestão. Trate como dado pessoal no seu lado também.
