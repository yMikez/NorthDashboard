---
name: custos-fulfillment
title: Custos, COGS e fulfillment
when: custo de produto, COGS, frete, fulfillment, potes enviados, custo por pote, fatura, RedRock/ShipOffers, projeção de gasto
first_tools: get_fulfillment, get_costs_overview
version: 1
---
## Passos
1. Em paralelo: get_fulfillment (potes, pacotes, gasto, custo por pote, bySupplier, byFamily, forecast) e get_costs_overview (COGS, fulfillment, fees, CPA, lucro de custo real).
2. Custo por pote, participação no bruto, variação × período anterior → calc (compare_periods(tool=get_fulfillment) pra comparar).

## Checagens obrigatórias
- Fornecedor: desde 30/07/2026 tudo vai pela RedRock (ShipOffers pausada) — número "ShipOffers" depois disso é histórico.
- Família sem custo cadastrado (get_costs_overview.byFamily.isCataloged=false) → COGS zerado, custo subestimado.
- Pacote = sessão (FE + upsells no mesmo envio); potes = bottlesShipped.
- Fatura do fulfillment fecha na terça-feira; projeções (forecast) são relativas a AGORA, não ao período.
- get_costs_overview.daily está em dia UTC; get_fulfillment.daily em dia BRT.
- COGS/frete do get_overview.kpis incluem pedidos estornados (custo já pago); get_costs_overview e get_fulfillment somam as aprovadas.

## Formato
- summary: potes, pacotes, gasto de fulfillment, COGS, custo por pote, projeção.
- table por família e/ou fornecedor.
- scope com período e filtros.
