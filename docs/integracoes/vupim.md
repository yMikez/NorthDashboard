# Vupim (checkout)

Webhook da Vupim → n8n → `POST /api/ingest/vupim`. Documentação deles:
<https://vupim.com/docs/webhook> (lida em 2026-10-21).

## Como funciona

1. A Vupim manda um POST JSON assinado: header `X-Webhook-Signature: sha256=<hex>`
   = HMAC-SHA256 do **corpo cru** com o segredo do webhook.
2. O n8n (workflow [`vupim-n8n-workflow.json`](vupim-n8n-workflow.json)) recebe com
   *Raw Body* ligado e repassa os **mesmos bytes** ao dash, com a assinatura e o
   `X-Ingest-Secret`. Reformatar o JSON no caminho quebra a assinatura.
3. O dash confere a assinatura (`VUPIM_WEBHOOK_SECRET`), grava o envelope inteiro em
   `IngestLog` e, se o evento for de pedido, grava em `Order` (conector em
   `lib/connectors/vupim`).
4. O n8n responde 200 à Vupim quando o dash aceitou, ou 502 quando falhou — aí a
   Vupim tenta de novo (8 tentativas em ~28 h, fila durável do lado deles).

Com `VUPIM_WEBHOOK_SECRET` configurado, a Vupim também pode apontar **direto** para
`https://dash.thenorthscales.com/api/ingest/vupim`: a assinatura válida basta como
autenticação.

## Eventos

| Evento | No dash |
| --- | --- |
| `sale.approved` | Pedido `APPROVED` |
| `sale.refunded` | Mesmo pedido vira `REFUNDED` (valor devolvido = total) |
| `sale.partial_refund` | Mesmo pedido vira `REFUNDED` com o **total devolvido até agora** |
| `sale.chargeback` | Mesmo pedido vira `CHARGEBACK` |
| `sale.created`, `sale.declined`, `sale.shipped`, `subscription.*`, `checkout.initiated`, `checkout.abandoned` | Só ficam no `IngestLog` (não viram venda) |
| `webhook.test` | Responde 200 (teste do painel) |

Estorno reescreve a linha da própria venda (mesmo `transactionId`), como JVZoo e
ClickBank: a data da venda fica em `orderedAt` e a data do estorno (o `timestamp` do
envelope) em `refundedAt`/`chargebackAt`.

## Mapeamento dos campos

| Vupim (`data.*`) | Dash |
| --- | --- |
| `transactionId` | `Order.externalId` |
| `checkoutSessionId` | sessão do funil (`parentExternalId` = `funnelSessionId`), como na Cartpanda |
| `origin` | `direct` → FRONTEND · `upsell` → UPSELL (DOWNSELL só se o nome da oferta marcar) |
| `offerId` / `offerName` + `productName` | produto (SKU = oferta; nome = produto + oferta) |
| `amount` | bruto (unidade mínima: 9700 = US$ 97,00) |
| `commission` | líquido do produtor (`netAmountUsd`) |
| `affiliateCommission` | CPA pago ao afiliado (`cpaPaidUsd`) |
| `taxAmount` | imposto; a taxa da Vupim = bruto − imposto − produtor − afiliado |
| `affiliateId` | conta do afiliado |
| `customer.email` / `name` / `phone` | cliente (e-mail é a chave), nome, telefone só dígitos |
| `utmSource`, `utmCampaign`, `clickId`, `src`/`sck` | origem do tráfego, campanha, click id, tracking |
| `createdAt` (UTC) | data da venda |

## Entrega duplicada e fora de ordem

A Vupim entrega "pelo menos uma vez" e pode entregar fora de ordem. O dash:

- ignora a mesma entrega (`id` do envelope) já processada;
- ignora uma aprovação antiga que chega depois de um estorno ou chargeback;
- quando o estorno chega antes da venda, grava a venda e aplica o estorno em seguida;
- estorno parcial só avança (um parcial antigo não desfaz um estorno maior).

## Configuração

1. **n8n:** importar [`vupim-n8n-workflow.json`](vupim-n8n-workflow.json) (substitui o
   webhook vazio `vupim-northscale`) e ativar. Usa `$env.INGEST_SECRET`, como os
   outros workflows.
2. **Vupim:** Integrations → Webhooks → New webhook
   - Endereço: a URL de **produção** do webhook do n8n (`…/webhook/vupim-northscale`).
   - Produto: todos os seus (um webhook só = um segredo só).
   - Eventos: pelo menos `sale.approved`, `sale.refunded`, `sale.partial_refund` e
     `sale.chargeback`. Os outros podem ser marcados (ficam registrados para uso futuro).
3. **Segredo:** copiar o *signing secret* (aparece inteiro só na criação) e gravar no
   `.env` do servidor como `VUPIM_WEBHOOK_SECRET=whsec_…`; depois
   `docker compose up -d app`. Na troca de segredo, dá para pôr os dois separados por
   vírgula por alguns minutos.
4. **Teste:** botão *Send test* no painel da Vupim → deve responder 200.
5. **Histórico:** *Send past sales* manda as vendas aprovadas dos últimos 30 dias.
6. **Lucro real:** cadastrar a taxa e a reserva da Vupim em Plataformas.

## Limitações conhecidas

- **Só USD.** O dash não converte moeda; venda em outra moeda fica no `IngestLog`
  com erro (`processedOk = false`) e não entra no faturamento.
- A Vupim não manda o pedido pai do upsell: front e upsells se ligam pelo
  `checkoutSessionId`. Conferir no primeiro upsell real se ele vem igual ao da venda
  de front.
- Não há quantidade/itens no payload: os potes saem do nome da oferta (classificador
  do catálogo), como nas outras plataformas.
- Assinaturas (`subscription.renewed`) ainda não viram pedido de rebill.
