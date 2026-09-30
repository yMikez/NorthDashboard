---
title: Fulfillment, custo de produto e fornecedores
kind: reference
description: Como o dashboard calcula potes enviados, frete e custo de produto, qual fornecedor atende cada família, fatura de terça e as projeções da aba Fulfillment
effectiveDate: 2026-07-30
---

# Fulfillment, custo de produto e fornecedores

## Fornecedor vigente

Desde 2026-07-30 a ShipOffers está PAUSADA e todo o envio vai pela RedRock: o fornecedor padrão do cálculo de frete foi trocado para redrock temporariamente e as famílias foram movidas. Quando a ShipOffers voltar, o padrão volta a ser por família. O fornecedor "fullstack" (Mindtrex) está cadastrado com tarifas provisórias espelhadas.

Ordem de resolução do fornecedor de um pedido: override do SKU → padrão da família → fornecedor padrão. O frete sai da tabela de tarifas por (fornecedor, família, faixa de potes).

## Potes enviados e pacote

- Enviado = venda aprovada (o dashboard infere o envio pelas vendas; não há integração com os dados reais do fornecedor). Reembolso NÃO devolve o custo: o pote já foi enviado.
- Potes (bottlesShipped) são gravados no pedido no momento da venda: reclassificar o produto depois não reescreve o histórico.
- Pacote = sessão (FE + upsells do mesmo cliente vão juntos; BuyGoods agrupa por sessid2).

## Custo de produto (COGS)

- COGS = custo unitário do pote da família × potes; em combos, soma por componente (Σ custo × potes de cada família) e o frete é pelo total de potes.
- SKU que não dá para resolver fica com custo NULO e o pedido marcado como pendente de classificação — aparece na fila de /costs e o custo do período fica subestimado até ser resolvido.
- Família sem custo cadastrado entra com custo zero. Algumas famílias novas usam custo unitário médio provisório.

## Fatura e projeções

- A fatura dos fornecedores fecha na TERÇA-FEIRA.
- As projeções da aba (ritmo dos últimos 7 dias BRT completos, projeção do mês, tendência 7d × 30d, fatura por fornecedor) são SEMPRE relativas a agora, não ao período selecionado.
- Não há reconciliação com a fatura real (decisão do dono): o painel de saúde do custo (cobertura de potes, famílias sem custo, faixas sem tarifa) é a única defesa contra contagem errada.

## Onde ler

- get_fulfillment: potes, pacotes, gasto, custo por pote, por fornecedor e família, projeções.
- get_costs_overview: COGS e fulfillment no lucro de custo real (série diária em dia UTC).
- get_overview.kpis.cogs/fulfillment incluem pedidos estornados (o custo já foi pago); get_costs_overview e get_fulfillment somam só as aprovadas.
