---
name: performance-afiliado
title: Performance de um afiliado (e renegociação de CPA)
when: afiliado nomeado — "como está X", "X caiu?", "vale renegociar o CPA de X", "quanto X dá de lucro"
first_tools: resolve_entities, get_affiliate_detail, get_affiliate_analysis, get_profit_model
version: 1
---
## Passos
1. resolve_entities com o nome citado → contas (plataforma + externalId), chave partner:/aff: e mappedAffiliateId. Mais de uma conta da mesma pessoa → trabalhe na visão partner e diga quantas contas somou.
2. Em paralelo: get_affiliate_detail(external_id, platform) no período pedido; get_affiliate_analysis(window=7) e get_affiliate_analysis(window=30) pra linha do afiliado e a tendência; get_profit_model (régua do cpaStatus, opex%, fee/refund&cb/reserva da plataforma).
3. get_affiliate_explain(key, window=7) → drivers por impacto (volume de fronts × AOV, ticket, take rate, dias com venda, aprovação, reembolso, CPA renegociado, mix de família).
4. calc: CPA máximo sustentável = netAovUsd − healthyMinUsd; folga atual = netAfterCpaUsd − healthyMinUsd; variação 7d × janela anterior; NET AFTER CPA total = por FE × FEs aprovadas quando não vier pronto.

## Checagens obrigatórias
- CPA negociado (cpaPerFe) = ÚLTIMO CPA observado numa FE aprovada — diga se mudou dentro da janela (driver "CPA renegociado").
- refundCbPctUsed: é override do afiliado ou a taxa da plataforma? Diga qual, e que é premissa do modelo.
- Coorte recente (< 30 dias) ainda não maturou: o reembolso do afiliado tende a subir.
- isRecovery = afiliado de recuperação: ganha comissão %, não CPA — NET AFTER CPA por CPA não se aplica e ele fica fora da média de CPA.
- FEs < 30 na janela → leitura provisória.
- Não misture a janela fixa (get_affiliate_analysis, fecha ontem) com o período da tela (get_affiliate_detail) sem dizer as duas datas.

## Formato
- Veredito: cpaStatus + NET AFTER CPA por FE e total do período, com a lente dita.
- table 7d × 30d × janela anterior: receita, FEs, AOV, aprovação, reembolso, CPA negociado, NET AOV, NET AFTER CPA.
- insights com os drivers quantificados do explain (o maior primeiro).
- Recomendação: renegociar para ≤ $X (calc), escalar, manter ou pausar — com o gatilho numérico.
