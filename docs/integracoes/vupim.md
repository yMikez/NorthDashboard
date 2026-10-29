# Vupim (checkout)

Webhook da Vupim → n8n → `POST /api/ingest/vupim`. Documentação deles:
<https://vupim.com/docs/webhook> (lida em 2026-10-21 e relida em 2026-10-22, depois dos
ajustes que pedimos — quase todos atendidos).

## Como funciona

1. A Vupim manda um POST JSON assinado no header `X-Webhook-Signature`:
   - **com data** (todo webhook criado desde 21/10/2026): `t=<unix>,v1=<hex>`, com
     `v1` = HMAC-SHA256 de `"<t>.<corpo cru>"`. O dash recusa `t` a mais de 5 min
     do relógio (aviso copiado não é reaproveitado);
   - **antigo** (webhook que não trocou): `sha256=<hex>` = HMAC-SHA256 do corpo cru.
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
| `sale.chargeback_won` | Mesmo pedido volta a `APPROVED` (a venda fica de pé) |
| `sale.chargeback_lost` | Mesmo pedido fica `CHARGEBACK` |
| `subscription.renewed` | Pedido próprio da renovação (`SUBSCRIPTION`, nº da cobrança, sessão própria) |
| `subscription.payment_failed`, `subscription.canceled` | Não viram venda; entram no histórico da assinatura (aba Recorrências: em atraso / cancelada) |
| `sale.created`, `sale.declined`, `sale.shipped`, `checkout.initiated`, `checkout.abandoned` | Só ficam no `IngestLog` (não viram venda) |
| `webhook.test` e qualquer evento com `livemode: false` | Só registra (teste do painel ou venda-teste do checkout) |

Toda entrega com `subscriptionId` (1ª cobrança, renovação, falha de pagamento, cancelamento, estorno) também vai pro histórico da assinatura (`SubscriptionEvent`, idempotente pelo `eventId`); o estado em `Subscription` é recalculado do histórico inteiro (`lib/subscriptions/core.ts`). A Vupim não tem API de assinatura: cancelar/pausar é no painel dela. A aba Recorrências lê esse histórico junto com as outras plataformas ([specs/recorrencias.md](../specs/recorrencias.md)).

Estorno reescreve a linha da própria venda (mesmo `transactionId`), como JVZoo e
ClickBank: a data da venda fica em `orderedAt` e a data do estorno em
`refundedAt`/`chargebackAt` — vinda de `data.refundedAt` / `data.chargebackAt`
(o `timestamp` do envelope é só a hora da entrega; fica de reserva).

## Mapeamento dos campos

| Vupim (`data.*`) | Dash |
| --- | --- |
| `transactionId` | `Order.externalId` |
| `checkoutSessionId` | sessão do funil (`parentExternalId` = `funnelSessionId`), igual no front e em todos os upsells/downsells; renovação usa o próprio `transactionId` |
| `origin` | `direct`/`call_center` → FRONTEND · `upsell` → UPSELL · `downsell` → DOWNSELL · `renewal` → renovação |
| `funnelStep` | etapa (0 no front, 1 = primeira página depois da compra…) |
| `offerId` / `offerName` + `productName` | produto (SKU = oferta; nome = produto + oferta) |
| `amount` / `amountUsd` | bruto (unidade mínima: 9700 = US$ 97,00; `*Usd` em centavos) |
| `netAmount` (ou `commission`) | líquido do produtor (`netAmountUsd`) |
| `affiliateCommission` | CPA pago ao afiliado (`cpaPaidUsd`) |
| `taxAmount` | imposto |
| `fees` / `feesUsd` | taxa da Vupim; sem ela (webhook antigo), bruto − imposto − produtor − afiliado |
| `affiliateId`, `affiliate.name`, `affiliate.email` | conta do afiliado, nome, e-mail (vínculo entre plataformas) |
| `customer.id` / `email` / `firstName` / `lastName` / `phone` / `locale` / `state` / `city` | cliente (id estável; e-mail se faltar), nome, telefone só dígitos, idioma, local |
| `utmSource`, `utmCampaign`, `clickId`, `src`/`sck`/`subIds.sub1` | origem do tráfego, campanha, click id, tracking |
| `createdAt` (UTC) | data da venda |
| `version`, `eventId`, `parentTransactionId`, `items[].sku`, `subIds`, `landingUrl`, `referrer`, reserva, `exchangeRate` | guardados em `rawMetadata` |

## Entrega duplicada e fora de ordem

A Vupim entrega "pelo menos uma vez" e pode entregar fora de ordem. O dash:

- ignora o mesmo evento já processado pelo `eventId` (igual em retry, *Resend* e
  *Send past sales*; no webhook antigo, o `id` da entrega);
- guarda a `version` da venda e ignora evento com versão menor ou igual (sem versão:
  ignora uma aprovação antiga que chega depois de um estorno ou chargeback);
- quando o estorno chega antes da venda, grava a venda e aplica o estorno em seguida;
- estorno parcial só avança (um parcial antigo não desfaz um estorno maior).

## Configuração

1. **n8n:** importar [`vupim-n8n-workflow.json`](vupim-n8n-workflow.json) (substitui o
   webhook vazio `vupim-northscale`) e ativar. A chave de operação vai pela credencial
   Header Auth "Autenticação Webhook" (a mesma do Reporting JVzoo) — o n8n bloqueia
   `$env` nos nós ("access to env vars denied"), e com `$env` toda entrega voltava 502.
   No ar desde 22/10/2026 como "Vupim → Dashboard".
2. **Vupim:** Integrations → Webhooks → New webhook
   - Endereço: a URL de **produção** do webhook do n8n (`…/webhook/vupim-northscale`).
   - Produto: todos os seus (um webhook só = um segredo só).
   - Eventos: pelo menos `sale.approved`, `sale.refunded`, `sale.partial_refund` e
     `sale.chargeback`. Os outros podem ser marcados (ficam registrados para uso futuro).
3. **Segredo:** copiar o *signing secret* (aparece inteiro só na criação) e gravar no
   `.env` do servidor como `VUPIM_WEBHOOK_SECRET=whsec_…`; depois
   `docker compose up -d app`. Na troca de segredo, dá para pôr os dois separados por
   vírgula por alguns minutos.
   O segredo do `.env` tem que ser o **mesmo** que está salvo no webhook da Vupim:
   assinatura que não bate volta 401 do dash e 502 do n8n (a Vupim tenta de novo).
4. **Teste:** botão *Send test* no painel da Vupim → deve responder 200.
5. **Histórico:** *Send past sales* manda as vendas do período escolhido (até 1 ano),
   com estornos, chargebacks e o desfecho — sem duplicar (mesmo `eventId`).
6. **Lucro real:** cadastrar a taxa e a reserva da Vupim em Plataformas.

## Limitações conhecidas

- **Order bump** vem como item (`items[].type = order_bump`) dentro da mesma venda:
  o valor entra no pedido, mas o produto e os potes são os da oferta principal.
  Custo e estoque do bump ainda não são contados.
- O `sku` dos itens fica guardado, mas o produto do dash continua sendo a oferta
  (`offerId`) — os potes saem do nome da oferta (classificador do catálogo).
- Estado e cidade do cliente vêm do endereço de entrega; venda sem frete não tem.
- A doc não diz se a renovação também dispara `sale.approved`. Se disparar, cai no
  mesmo `transactionId` e não duplica.
