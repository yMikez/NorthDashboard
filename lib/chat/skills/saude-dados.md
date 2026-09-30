---
name: saude-dados
title: Saúde dos dados (preflight)
when: "os dados estão atualizados?", "alguma plataforma parou?", antes de concluir qualquer coisa sobre hoje/ontem ou uma queda brusca
first_tools: get_health, get_data_coverage
version: 1
---
## Passos
1. Em paralelo: get_health (último IPN por plataforma, recebidos/falhas 24h, aprovação/refund/CB 24h × baseline 30d, catálogo) e get_data_coverage (estornos silenciosos, lacuna da Digistore, cobertura de import, fusos).
2. Plataforma com IPN antigo: meça o ritmo normal dela com aggregate_orders(group_by hour, últimos 7 dias fechados, platforms=[slug]) antes de chamar de parada — plataforma de baixo volume passa horas sem venda.

## Checagens obrigatórias
- Parada = sem IPN há mais tempo do que o intervalo normal entre vendas da própria plataforma, OU failedCount24h > 0 com successRate24h caindo.
- Estorno silencioso (plataforma com vendas e zero eventos de estorno) → toda taxa de reembolso dela está subestimada.
- SKUs sem família / catálogo pendente (pendingOrders, pendingGrossUsd) → filtro por família perde esse volume.
- Dado do dia pode ter atraso de 30–60 s (cache/MV).

## Formato
- table semáforo por plataforma: último IPN (há quanto tempo) | recebidos 24h | falhas 24h | estorno silencioso | status (ok / atenção / parada).
- Uma linha dizendo QUAIS números da resposta ficam afetados e em que direção.
