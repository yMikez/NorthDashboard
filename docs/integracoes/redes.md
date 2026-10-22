# Redes de afiliados (NorthAffiliates)

Como o dashboard recebe, marca e mostra as vendas das **redes de afiliados**, na aba
**Afiliados › Networks**, separadas dos afiliados individuais. Implementa o
contrato v2 combinado com o NorthAffiliates (`api.thenorthscales.com`) em
22/10/2026.

## O que é uma venda de rede

Uma rede é um grupo de afiliados (**integrantes**) com uma **conta própria na
JVZoo**. A NorthScale paga à rede um **CPA** por venda; o gerente da rede define
quanto vai para cada integrante (**repasse**) e o resto é a **margem da rede**.
O integrante divulga o link da JVZoo com `aid=<conta da rede>` e `nsid=<ID público
do integrante>`.

Na IPN de vendedor, a venda chega com `affiliate_id` = conta da rede. O pedido
continua vindo por `/api/ingest/jvzoo`, como qualquer venda JVZoo; o que muda é a
**marca** de rede.

## Por onde chega

```text
IPN de vendedor ─▶ n8n "Reporting JVzoo" ─▶ POST /api/ingest/jvzoo            (o pedido)
Postback S2S da conta da rede ─▶ n8n "JVZoo Redes" ─▶ POST /api/ingest/jvzoo/network  (a marca)
Dashboard ──GET──▶ NorthAffiliates /api/integrations/networks/{directory,conversions,checkouts}  (conferência)
```

### `POST /api/ingest/jvzoo/network`

- Autenticação: `x-ingest-secret` (a mesma do `/api/ingest/jvzoo`).
- Um evento por chamada. Grava no `IngestLog` (`source = n8n-jvzoo-redes`,
  `platformSlug = jvzoo`, `eventType = purchase | initiated`).
- `purchase` → upsert em `network_sales` pelo `sale.transaction_id`.
- `initiated` → upsert em `network_checkouts` pelo `checkout.session_id` (o mesmo
  checkout não conta duas vezes).
- Rede e integrante do corpo são gravados no cadastro (`affiliate_networks`,
  `affiliate_network_members`).
- `status: "ignored"` só é registrado; `"duplicate"` é tratado como `"accepted"`.
- Respostas: `2xx` = recebido (inclusive quando o pedido ainda não existe), `400` =
  corpo sem rede/transação, `5xx` = erro (o n8n tenta de novo).

### Regras de gravação da venda (`lib/services/networksCore.ts`)

- Campo nulo que chega **não apaga** o valor gravado.
- Venda `attributed` **não volta** para `pending` (nem perde integrante e valores).
- A **leitura vence o evento**: depois que a conferência gravou a venda, um evento
  atrasado só preenche o que ainda está vazio.
- CPA, repasse e margem são os da hora da venda — o dash não recalcula.
- `raw` guarda o último corpo do evento (com postback e tráfego); a leitura só o
  grava quando a venda nasce por ela.

## Classificação do pedido (`lib/services/networks.ts`)

Um pedido JVZoo é **de rede** (`Order.networkId`) quando:

1. existe `network_sales` com o mesmo `transaction_id` (vence os outros); ou
2. a conta do afiliado é uma conta JVZoo de rede (`Affiliate.networkId`, vindo de
   `affiliate_networks.jvzoo_affiliate_ids`); ou
3. é do funil de um pedido de rede (mesma sessão:
   `COALESCE(parentExternalId, externalId)`).

Pedido e conta de rede:

- não recebem `mappedAffiliateId` e não entram na fila de não mapeados;
- saem do Ranking, da Análise e do export de métricas dos afiliados individuais
  (filtro `networkId IS NULL`).

A marca pode chegar antes ou depois do pedido: o `upsertOrder` olha a marca e a
conta na hora do ingest, e a conferência remarca o que faltar.

## Conferência (`lib/services/networksSync.ts`)

Mesma URL e mesma chave do mapeamento de afiliados (`AFFILIATES_API_URL`,
`INTEGRATION_API_KEY` ou o setting `affiliates.integrationApiKey`).

| Rodada | Quando | O que lê |
| --- | --- | --- |
| rápida | 60 s após o boot e a cada 15 min | diretório, vendas de hoje, checkouts de ontem e hoje |
| completa | a primeira rodada de cada dia (BRT) | diretório, vendas e checkouts dos últimos 45 dias, e remarca todos os pedidos |

- O **diretório** traz a lista completa de contas JVZoo de cada rede (substitui a
  gravada) e os integrantes.
- **Checkouts**: a contagem lida por dia × rede × integrante × produto vai para
  `network_checkout_daily` (substitui o intervalo lido). A aba usa o maior número
  entre os eventos recebidos e a contagem lida.
- O resumo da última rodada fica em `IntegrationSetting` (`networks.sync.status`).
- Rodar na mão: `POST /api/admin/networks-sync?mode=quick|full` (admin ou bearer
  `INGEST_SECRET`); estado em `GET` na mesma rota. A aba mostra o estado e o botão
  "Conferir agora" para admin.
- Desligar: `NETWORKS_SYNC_ENABLED=0`.

## A aba Afiliados › Networks

Permissão `networks`. Do filtro global, só o **período** vale; a aba tem filtros
próprios: rede, integrante, produto (`jvzoo_product_id`), `utm_source`,
`utm_campaign`, `sub1` e "incluir testes" (desligado).

| Métrica | Como é calculada |
| --- | --- |
| Vendas | `network_sales` `attributed`, sem teste, vendidas no período |
| Faturamento | gross das linhas `APPROVED` dos pedidos dessas vendas e do funil delas (estorno in-place da JVZoo já tira a venda) |
| Checkouts iniciados | por dia × rede × integrante × produto, o maior entre eventos e leitura; com filtro de tráfego, só eventos |
| Conversão | vendas ÷ checkouts |
| CPA devido / repasse / margem | soma das vendas `approved`, `held` ou com comissão `paid` |
| Repasse pago | `member_amount` com comissão `paid` |
| Reembolsos / chargebacks | situação `refunded` / `chargeback` pela leitura **ou** pelo próprio pedido (o que vier primeiro) |
| Lucro NS | faturamento − CPA devido (sem taxas, produto e frete) |
| Retidas | vendas `held` e o CPA delas |

Abaixo dos cartões: tabela por rede (clique filtra a rede), por integrante (ranking
por vendas líquidas), gráfico diário (vendas ou checkouts por rede), vendas recentes
(clique abre o pedido) e diagnóstico recolhido (sem atribuição por motivo e
pendentes há mais de 1 hora). SQL em `lib/services/networkMetrics.ts`.

## Tabelas

| Tabela | Chave | Conteúdo |
| --- | --- | --- |
| `affiliate_networks` | `network_id` | nome, situação, modo, contas JVZoo |
| `affiliate_network_members` | `member_id` | rede, ID público, nome, situação |
| `network_sales` | `transaction_id` | a marca da venda: rede, integrante, produto, atribuição, valores, comissão, clique, tráfego |
| `network_checkouts` | `session_id` | checkout iniciado (evento) |
| `network_checkout_daily` | dia, rede, integrante, produto | contagem lida na conferência |

As tabelas `Network*` antigas (programa de sub-afiliados, sem uso desde agosto/2026)
ficam no schema com os dados guardados; não têm relação com estas.

## Reenvio de IPNs ao NorthAffiliates

O NorthAffiliates recebe a IPN de vendedor pelo nó "NorthAffiliates (redes)" do
workflow "Reporting JVzoo". IPN que não chegou lá (nó fora do ar, rascunho não
publicado) é reenviada **pelo dashboard**, a partir do `IngestLog` — o retry do
n8n rodaria o workflow inteiro e mandaria e-mail e SMS de novo ao comprador.

```text
POST /api/admin/networks-ipn-replay?since=2026-10-14[&accounts=3649735][&send=1]
```

- Sem `send=1` só lista o que seria enviado (simulação).
- `accounts` padrão = contas numéricas das redes no diretório.
- Uma IPN por transação × tipo (venda, rebill, estorno…), em ordem de chegada.
- Mesmo formato do nó: corpo form-urlencoded, `X-Api-Key` = `JVZOO_IPN_FORWARD_KEY`
  (env) ou o setting `affiliates.jvzooIpnForwardApiKey`.
- O NorthAffiliates não duplica; depois do envio o dash roda a conferência completa.

## Pendências

- O `affiliate_id` da leitura de checkouts é o `member_id` do integrante
  (confirmado pelo NorthAffiliates em 22/10/2026).
- A conferência do `cverify` na IPN de vendedor (contrato §8) não foi feita no dash.
- Modo "página única" (`go.thenorthscales.com`, `cid`) não existe ainda; quando
  existir, a venda chega pelo mesmo `network_sales`.
