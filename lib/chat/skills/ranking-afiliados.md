---
name: ranking-afiliados
title: Ranking e movimento dos afiliados
when: "quem cresceu/caiu", "top da semana", "quem parou de rodar", "concentração da base", ranking por receita ou NET AFTER CPA
first_tools: get_affiliate_analysis, get_affiliate_sequence
version: 1
---
## Passos
1. get_affiliate_analysis(window=N, view=partner) — janelas fixas fechando ONTEM (ou no anchor) contra a janela anterior de mesmo tamanho; cada linha traz tendência, topDriver e key.
2. Pra trajetória: get_affiliate_sequence(window=N, count=3) → slowing (quem está parando), reactivation (mornos), health (concentração top 10, notas de saúde).
3. Pergunta sobre o período da TELA ("top de agosto"): get_affiliates(start_date, end_date) e ordene/filtre com aggregate_result sobre o $rN (nunca ordene de cabeça). Não misture com as janelas fixas.
4. Participação, concentração ou soma que não venha pronta → calc.

## Checagens obrigatórias
- Diga as datas exatas das janelas (vêm em windows / _meta.range): "7 dias fechados até ontem" ≠ período da tela.
- Pseudo-afiliados internos ficam fora (include_internal=false), igual à aba.
- Breakout/queda forte só com volume mínimo (≥ 30 FEs numa das janelas); abaixo disso, "oscilação de amostra pequena".
- Ranking por NET AFTER CPA: linha com netAfterCpaTotalUsd null = sem CPA detectado — liste à parte, não como zero.
- view=partner soma contas da mesma pessoa em plataformas diferentes; view=platform mostra conta a conta.

## Formato
- table: afiliado | receita | Δ% | FEs | AOV | NET AFTER CPA | tendência | principal motivo.
- insights: 3 maiores altas, 3 maiores quedas, concentração do top 10, quem está parando.
- scope com a janela (datas BRT) e a view.
