---
name: diagnostico-variacao
title: Diagnóstico de variação (por que caiu ou subiu)
when: "por que caiu/subiu" receita, vendas ou lucro; "o que aconteceu ontem/na semana"; qualquer variação entre dois períodos
first_tools: get_health, compare_periods, get_funnel_sequence, get_affiliate_sequence
version: 1
---
## Passos
1. Defina A (período em questão) e B (base) como janelas FECHADAS de mesmo tamanho e mesmo mix de dias da semana: "ontem" × mesmo dia da semana passada; "últimos 7 dias" × os 7 anteriores; "semana passada" (seg–dom) × a anterior. Se A inclui hoje, compare até o MESMO horário (compare_periods com alinhamento same_elapsed) e diga que hoje é parcial.
2. Na mesma rodada, em paralelo: get_health (a ingestão está ok?); compare_periods(tool=get_overview, A, B); get_funnel_sequence(window=N, count=2, anchor = último dia de A); get_affiliate_sequence(window=N, count=2, mesmo anchor); compare_periods(tool=get_platforms, A, B). Família/plataforma citada → o mesmo filtro nos dois lados.
3. Decomponha Δreceita = efeito VOLUME de FEs + efeito AOV de sessão (transitions do get_funnel_sequence: volumeEffect, aovEffect, topStage). Depois abra por plataforma (movers do compare_periods), família e afiliado (transitions do get_affiliate_sequence: retidos × saldo novos − churn, quem mais subiu/caiu).
4. Toda conta derivada (participação de cada efeito no Δ, Δ%, Δpp, resíduo) sai de calc referenciando $rN.
5. Queda concentrada numa plataforma ou num dia: get_data_coverage(platforms) e aggregate_orders(group_by day ou hour, a mesma janela) pra achar o momento exato em que parou.

## Checagens obrigatórias
- Ingestão primeiro: último IPN e falhas 24h da plataforma que caiu (get_health) — IPN parado explica queda "de mercado".
- _meta.range de A e B: mesmo tamanho, mesmos filtros, mesma lente; dia parcial sinalizado.
- Os efeitos somam o Δ total com tolerância de ±1% (calc); se não fecharem, mostre o resíduo.
- Borda de fuso: venda de madrugada BRT cai em outro dia no painel da plataforma (CB Pacific, D24 Berlim, BuyGoods/JVZoo Eastern).
- Digistore: estorno é linha extra — use as vendas APPROVED, não todas as linhas.
- Amostra < 30 FEs no período → diga "provisório" antes de apontar causa.
- Causa fora do dado (criativo, página, tráfego, mercado) só como Hipótese, com onde verificar.

## Formato
- Veredito (1–2 frases): Δ$ e Δ% + causa nº 1 com a parcela do Δ que ela explica.
- summary: receita A, receita B, Δ, FEs A/B, AOV de sessão A/B.
- table "Decomposição": efeito | $ | % do Δ (volume de FEs, AOV de sessão, resíduo).
- table com os 5 afiliados/plataformas que mais explicam o Δ.
- Ação com gatilho numérico ("se o FE de X não voltar a ≥ N/dia até D, …").
- scope com as duas janelas BRT e os filtros.
