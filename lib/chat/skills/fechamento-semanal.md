---
name: fechamento-semanal
title: Fechamento semanal (relatório da semana)
when: "resumo da semana", "fechamento da semana passada", "relatório semanal", "como foi a semana"
first_tools: compare_periods, get_profit_split, get_affiliate_analysis, get_funnel_sequence, get_health
version: 1
---
## Passos
1. Semana = segunda a domingo. "Semana passada" = a última seg–dom fechada; base = a semana anterior a ela. "Esta semana" = segunda → agora, comparada até o mesmo ponto (same_elapsed).
2. Em paralelo: compare_periods(tool=get_overview, semana, base); get_profit_split da semana e da base; get_affiliate_analysis(window=7, anchor = domingo da semana); get_funnel_sequence(window=7, count=2, anchor = domingo); get_refund_cohorts da semana; get_health.
3. Variações, participações e margem → calc.

## Checagens obrigatórias
- Datas das duas semanas explícitas (BRT); semana corrente é parcial.
- Lucro na lente default + linha do custo real (get_costs_overview) se o lucro for destaque.
- Reembolso na lente caixa + coorte em uma linha; plataformas com cobertura parcial citadas.
- Afiliados: janela de 7 dias ancorada no domingo, não "últimos 7 dias".

## Formato
- summary: receita, pedidos aprovados, AOV, reembolso, Net after CPA (front/back/total) — semana × base, com Δ.
- insights: 3 destaques (positivos e negativos) com o número.
- table dos maiores movimentos de afiliados e do funil.
- 3 ações para a próxima semana com gatilho numérico.
