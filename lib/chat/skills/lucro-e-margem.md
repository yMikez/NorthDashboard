---
name: lucro-e-margem
title: Lucro e margem (as 4 lentes)
when: "lucro", "margem", "estamos no azul", "quanto sobrou", lucro por plataforma/família, margem de contribuição
first_tools: get_profit_split, get_costs_overview, get_profit_model
version: 1
---
## Passos
1. Em paralelo: get_profit_split (lente default: Net after CPA do modelo, front + back), get_costs_overview (lucro de custo real), get_profit_model (premissas do modelo). Admin pedindo margem oficial/"lucro real": get_net_profit.
2. Margem de cada lente sobre a MESMA base, participação do back no total, diferença entre lentes → calc.
3. Quebra por plataforma: get_costs_overview.byPlatform (custo real) e get_profit_split com filtro de plataforma (modelo). Por família: get_costs_overview.byFamily (sem fee e sem CPA — diga).

## Checagens obrigatórias
- Cada número de lucro com a lente dita (Glossário, "Lucro — 4 lentes"). Nunca subtraia CPA do net.
- Premissas do modelo: refund&cb% manual por plataforma (Digistore usa a observada madura), opex% global, reserva — são premissas, diga.
- get_costs_overview.byFamily.profitUsd NÃO desconta fee nem CPA.
- Família com isCataloged=false: COGS zerado infla o lucro.
- Allowance = reserva retida pela plataforma (volta depois); no modelo entra como custo.
- Filtro de pedido (plataforma/país/família/afiliado) tira Tauk e Logicall do BACK; SalesBound não soma no BACK do get_profit_split (aparece em get_call_center e no Lucro real).
- get_costs_overview.daily está em dia UTC — não compare dia a dia com o overview (dia BRT).
- Front negativo com back positivo: não leia prejuízo de front isolado como sinal de corte.

## Formato
- Veredito na lente default (Net after CPA modelo: front, back, total) + UMA linha com o lucro de custo real.
- table "Lentes": lente | valor | margem | fórmula | fonte (tool.campo).
- Por plataforma/família quando pedido.
- scope com período, filtros e lente.
