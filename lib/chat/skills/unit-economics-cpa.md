---
name: unit-economics-cpa
title: Unit economics e CPA máximo (what-if)
when: "quanto posso pagar de CPA", break-even, what-if, "se o reembolso subir 5pp", "se o AOV cair 10%", simulação de NET AOV
first_tools: get_profit_model, get_affiliates, get_platforms
version: 1
---
## Passos
1. get_profit_model (opex%, régua healthyMinUsd/attentionMinUsd, fee/refund&cb/reserva por plataforma) e, em paralelo, o AOV do MESMO escopo: linha do afiliado em get_affiliates (search) ou get_platforms / get_overview para a plataforma ou operação.
2. calc: NET AOV = AOV × (1 − (refund&cb% + fee% + opex% + reserva%) / 100); CPA de break-even = NET AOV; CPA máximo saudável = NET AOV − healthyMinUsd; NET AFTER CPA = NET AOV − CPA.
3. Sensibilidade em calc: reembolso ±5 pp × AOV ±10% (grade 3×3), e o CPA máximo em cada célula.

## Checagens obrigatórias
- Toda premissa explícita e com a fonte (get_profit_model ou o usuário). Premissa do usuário que muda o resultado: use a dele e mostre a do sistema ao lado.
- AOV do mesmo escopo e período do CPA: pra afiliado, o AOV do ranking (revenue ÷ feApprovedCount — o mesmo que gera netAovUsd e o cpaStatus), não o AOV de sessão da operação nem attributedRevenue ÷ attributedSessions.
- Reembolso: use a taxa madura (coorte / refund&cb% do modelo), não a de caixa de poucos dias.
- Percentuais em pontos (15 = 15%) na fórmula; confira a unidade em _meta.units.

## Formato
- table de premissas: item | valor | fonte.
- Resultado: NET AOV, CPA de break-even, CPA máximo saudável, NET AFTER CPA no CPA atual.
- table de sensibilidade (reembolso × AOV) com o CPA máximo.
