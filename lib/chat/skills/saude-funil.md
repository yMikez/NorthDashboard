---
name: saude-funil
title: Saúde do funil (take rate, upsells, AOV de sessão)
when: take rate, upsell/downsell, "o funil piorou", "qual upsell caiu", "foi volume ou conversão", AOV de sessão
first_tools: get_funnel, get_funnel_sequence
version: 1
---
## Passos
1. Em paralelo: get_funnel (período pedido) e get_funnel_sequence(window=N, count=K) — família citada → leia scopes.<família> (funil isolado), senão scopes.all.
2. Por etapa: take rate A × B em pontos percentuais e o efeito em $ a ticket constante (transitions.stages); topStage = etapa que mais mexeu.
3. Δreceita = efeito do volume de FEs + efeito do AOV de sessão (transitions) — o veredito "volume ou conversão" sai daqui.
4. Contas derivadas (Δpp, soma de efeitos, participação) → calc.

## Checagens obrigatórias
- Denominador do take rate = sessões com FE aprovado (não pedidos). Sessão BuyGoods = sessid2; JVZoo = e-mail + dia Eastern.
- Cross-sell de outra família fica fora da etapa (aparece em crossSell) e conta no funil da família do FE.
- Sessões órfãs: totalRevenue − revenueFeSessions = backend cujo FE caiu fora do período (normal quando o período é "hoje").
- Compare take rate só com ≥ 50 FEs na família nas duas janelas.
- Reporte variação de take rate em pp, nunca em %.
- revenueLiftFromUpsells = AOV das sessões com upsell × sessões só-FE — não é a participação dos upsells na receita.

## Formato
- Veredito: "foi volume" ou "foi conversão (etapa X, −N pp)" com o $ que cada efeito explica.
- table por etapa: volume | take A | take B | Δpp | efeito $.
- scope com as janelas e o escopo (all ou família).
