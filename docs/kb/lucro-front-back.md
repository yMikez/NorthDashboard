---
title: Lucro — as quatro lentes e o front × back
kind: policy
description: Qual "lucro" usar em cada pergunta (Net after CPA do modelo como padrão, custo real, estimado, margem de contribuição), fórmulas do front e do back e armadilhas
effectiveDate: 2026-09-30
---

# Lucro — as quatro lentes e o front × back

## Regra de resposta

"Lucro" tem quatro leituras no dashboard, com números diferentes de propósito. Sempre diga qual lente está usando. Decisão do dono: a lente padrão é o Net after CPA (modelo) do card da Visão Geral — o front, e o total com o back — e a resposta sempre traz uma linha com o lucro de custo real para comparação.

## Lente (a) — Net after CPA (modelo), a padrão

Card "Net after CPA (modelo)" da Visão Geral, tool get_profit_split:
- FRONT = Σ por plataforma de gross_p × (1 − (refund&cb%_p + fee%_p + opex%) / 100) − CPA pago.
- BACK = recuperação, call center e SMS próprio, cada fonte com receita − custo.
- Total = front + back (totalUsd).

Pontos de atenção:
- COGS e frete reais NÃO entram no front (o opex% é o guarda-chuva) e a reserva (allowance) não é descontada aqui — diferente do NET AOV por afiliado.
- refund&cb% é a premissa do modelo por plataforma (taxa real da coorte madura na Digistore24).
- O front exclui o que é backend: vendas de afiliados de recuperação, tráfego do SMS próprio (utm_source smsbrdcst) e produtos do tipo SMS_RECOVERY.

## BACK — as fontes

- recuperação: vendas aprovadas dos afiliados de recuperação − comissão % vigente;
- Tauk e Logicall: vendas do call center − comissão do parceiro (configurável);
- SMS próprio: vendas com utm_source smsbrdcst, custo zero (o custo do Twilio não passa pelo dashboard);
- SalesBound: aparece como indisponível (zero) no get_profit_split — os números dela estão em get_call_center (provider salesbound) e na margem de contribuição (get_net_profit).

Com qualquer filtro de pedido (plataforma, país, família, afiliado), Tauk e Logicall saem do BACK, porque as vendas deles não têm essas dimensões. Diga isso quando houver filtro.

## Lente (b) — lucro de custo real

Tool get_costs_overview (lente de custo real; sem aba própria): lucro = gross − fees da plataforma − CPA − COGS − fulfillment; margem = lucro ÷ gross. É a lente de "quanto sobrou com os custos registrados". Atenção: por família (byFamily) o lucro NÃO desconta fee nem CPA; família sem custo cadastrado entra com COGS zero (lucro inflado); fee é a real quando a plataforma informa, senão a do cadastro.

## Lente (c) — lucro estimado

get_overview.kpis.estimatedProfit = net − COGS − fulfillment. Próximo da lente (b). Não é mais card da tela. O campo kpis.netProfit (net − CPA) conta o CPA duas vezes (o net já vem sem CPA) — ignore.

## Lente (d) — margem de contribuição oficial (admin)

Aba Lucro real e tool get_net_profit (só admin): receita econômica = gross das plataformas + parcela NorthScale do backend; margem oficial = lucro de contribuição ÷ receita econômica. Premissas (reembolso %, custo de produto %, parcelas dos parceiros) são do admin e têm histórico. Detalhes no documento de margem de contribuição.

## Lição do front negativo

Em 2026-09 o front fechou negativo para cerca de 96 de 207 afiliados (−$318 mil sobre 90% do gross) e a operação lucrou pelo backend (+$480 mil). Prejuízo de um afiliado no front, isolado, NÃO é sinal de corte: a venda dele alimenta call center, SalesBound e recuperação. Olhe a projeção com o backend (Lucro real, visão Afiliados) antes de recomendar cortar ou renegociar.
