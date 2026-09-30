---
name: comparativo-plataformas
title: Comparativo entre plataformas
when: "qual plataforma é melhor", ClickBank × Digistore × BuyGoods × Cartpanda × JVZoo, fee por plataforma, onde escalar
first_tools: get_platforms, get_costs_overview, get_profit_split, get_data_coverage
version: 1
---
## Passos
1. Em paralelo: get_platforms (receita, pedidos, fees, refund observado, NET), get_costs_overview (byPlatform: custo real e margem), get_profit_split com o filtro de cada plataforma quando o lucro do modelo por plataforma for pedido, get_data_coverage (cobertura de estorno por plataforma).
2. Participação, margens comparáveis e diferenças → calc (ou aggregate_result sobre o $rN pra ordenar).

## Checagens obrigatórias
- Fee real × estimada: taxesPaid/feesUpdatedAt nulos = fee estimada pelo feeRatePct do cadastro — diga.
- Taxas por plataforma usam pedidos REAIS (Digistore desconta as linhas extras de estorno).
- Plataforma com estorno silencioso ou lacuna de IPN (_meta.dataQuality) → refund subestimado, não compare como se fosse igual.
- observedRefundCbPct com amostra pequena (observedRefundSample < 30) = sem conclusão.
- Painéis das plataformas em fuso próprio (CB Pacific, D24 Berlim, BuyGoods/JVZoo Eastern): diferença de borda de dia é esperada.
- Allowance (reserva) retida por plataforma muda o caixa, não o faturamento.

## Formato
- table uma linha por plataforma: bruto | pedidos | aprovação | reembolso | CB | fee % | net | lucro | margem.
- Veredito: onde a margem é melhor e o que pesa (fee, reembolso, CPA).
- scope com período e lente de lucro.
