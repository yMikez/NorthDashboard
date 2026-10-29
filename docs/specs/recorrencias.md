# Recorrências (aba Recorrências)

Todas as assinaturas, de qualquer plataforma. Código: `lib/recurrences/core.ts`
(regras, puro) e `lib/services/recurrences.ts` (leitura do banco).
O disparo do link da pesquisa (SMS/e-mail) fica em **Pesquisas → Disparos**.

## O que é uma assinatura

Mesma plataforma + mesmo cliente (e-mail) + mesmo produto recorrente. A 1ª
cobrança é a compra; as seguintes são renovações. Cobranças a menos de 5 dias
uma da outra contam como o mesmo ciclo (2 unidades, nova tentativa).

**Produto recorrente** = já teve renovação ou já teve aviso de recorrência.
Não dá pra usar o tipo de cobrança do produto: a JVZoo manda
`product_type=RECURRING` no catálogo inteiro.

## De onde vem cada coisa

Tudo do schema `public` (é onde chegam os avisos; o dado oficial não marca recorrência).

| Plataforma | Renovação (pedido) | Cancelamento (IngestLog) | Falha (IngestLog) |
| --- | --- | --- | --- |
| JVZoo | `bill`, `uncancel-rebill` | `cancel-rebill` | `insf` |
| ClickBank | `BILL` | `CANCEL-REBILL` | `INSF` |
| BuyGoods | `rebill` | `canceledfromrebill` | `failedrebill` |
| Digistore24 | `pay_sequence_no` > 1 | `rebill_cancelled`, `last_paid_day` | `payment_missed`, `payment_denial` |
| Vupim | `Subscription`/`SubscriptionEvent` (webhook de assinatura) | idem | idem |

`uncancel-rebill`/`rebill_resumed` desfazem um cancelamento anterior.

- Pedido que foi aprovado e depois virou estorno/cancelamento continua sendo
  cobrança (`approvedAt` fica gravado). Linha criada só pelo aviso, nunca
  aprovada, não conta.
- Estorno em linha extra (Digistore) marca a cobrança apontada por `previousTransactionId`.
- O aviso liga pela chave plataforma + e-mail + produto. Sem produto que case,
  só liga se o cliente tem uma assinatura só naquela plataforma.
- Produto JVZoo sem IPN cadastrado não aparece (não temos as cobranças dele).

## Status

- **Ciclo**: mediana dos intervalos entre as cobranças do próprio assinante;
  sem renovação, a da oferta (Vupim: frascos × 30); senão a do produto (≥ 3
  intervalos medidos); senão 30 dias.
- **Esperada** = última cobrança + ciclo (Vupim: fim do período pago, quando vem).
- **Em atraso**: passou 3 dias da esperada, ou a plataforma avisou falha depois da última cobrança.
- **Encerrada**:
  - *pediu cancelamento*: aviso depois da última cobrança;
  - *reembolso*: a última cobrança foi estornada;
  - *parou de pagar*: 15 dias depois da esperada sem cobrança. A data do encerramento é a esperada.

## Números

- **Recebido de renovação**: cobranças depois do 1º ciclo, no período, sem as
  estornadas. **Ticket médio** = recebido ÷ renovações.
- **Encerradas no período** e **tempo até encerrar** (dias da compra ao
  encerramento). Só entra quem encerrou; a retenção mostra o quadro completo.
- **Chegam na n-ª cobrança**: entre quem já teve tempo de pagar a n-ª
  (início + (n−1) ciclos + 15 dias), quantos pagaram.
- **Previsto**: cobranças futuras de quem não encerrou, no valor da última
  renovação (sem renovação, a mediana do produto), vezes a chance de continuar
  medida por ciclo. Com menos de 10 assinaturas no ciclo, usa a média de todos
  os ciclos. Sem histórico nenhum, mostra só o "se ninguém cancelar".
- **Receita mensal recorrente**: ativas e em atraso, renovação × 30 ÷ ciclo.
- Período do topo: recebido, novas e encerradas. Ativas, mensal e previsão são de agora.

Leitura em cache de 2 min (varre os pedidos dos produtos recorrentes e os avisos do IngestLog).
