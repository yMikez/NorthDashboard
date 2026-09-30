---
name: projecao-mes
title: Projeção de fechamento do mês
when: "quanto vamos fechar o mês", run-rate, projeção de receita/lucro/reembolso, "vamos bater a meta"
first_tools: get_overview, compare_periods, get_refund_cohorts
version: 1
---
## Passos
1. Em paralelo: get_overview do dia 1 até ONTEM (série daily) e compare_periods(tool=get_overview) contra o mesmo intervalo do mês passado; get_refund_cohorts (projeção de reembolso das vendas do mês).
2. Run-rate por dia da semana com calc: média de receita por dia da semana nos dias fechados do mês (ou das últimas 4 semanas fechadas, se o mês tem < 14 dias) × quantidade de cada dia da semana que falta até o fim do mês.
3. Faixa: mínimo e máximo usando o pior e o melhor dia de cada dia da semana; lucro projetado aplica a margem da lente default do período fechado.

## Checagens obrigatórias
- Só dias fechados entram na base; hoje (parcial) fica fora e é dito.
- Sazonalidade semanal: fim de semana ≠ dia útil — nunca média simples × dias restantes.
- Reembolso das vendas recentes ainda vai chegar: use a projeção de coorte, não a taxa de caixa.
- Premissas explícitas (base usada, dias restantes por dia da semana).

## Formato
- summary: realizado até ontem, projeção central, mínimo, máximo, mês passado no mesmo ponto.
- table de premissas.
- scope com os dias fechados usados.
