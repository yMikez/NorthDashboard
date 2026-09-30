---
title: Afiliados de recuperação
kind: reference
description: O que é um afiliado de recuperação (fonte paga por comissão %, não por CPA), como a comissão é calculada, onde ele entra no lucro e o que não confundir
effectiveDate: 2026-09-22
---

# Afiliados de recuperação

## Definição

Afiliado de recuperação é uma FONTE de tráfego que re-engaja quem abandonou o carrinho (por SMS ou e-mail) e vende pelo link dele. Não é uma etapa do funil nem um produto: as vendas dele entram como FE/upsell normais, atribuídas a ele. O admin marca a conta como recuperação (cadastro RecoveryAffiliate) e o dashboard passa a tratá-la à parte.

Não confundir com:
- Tauk/Logicall (call center de recuperação por telefone, vendas fora das plataformas);
- o tipo de produto SMS_RECOVERY ("RC", ofertas "FREE bottle" do próprio funil);
- o SMS próprio da operação (tráfego com utm_source smsbrdcst).

## Comissão

A comissão é um percentual sobre o gross de CADA venda APPROVED do afiliado (FE e upsells), calculada no momento da consulta — não vira pagamento registrado. A taxa tem histórico por período (a comissão vigente em cada data vale para as vendas daquela data). Casos registrados: lusk1nha (Digistore24) a 30% desde 2026-06; Skill99 como afiliado de recuperação com 25% vigente em 2026-09. A taxa atual e o histórico vêm de get_recovery — commissionPct lá é FRAÇÃO (0.25 = 25%).

O tracking desses afiliados não separa SMS de e-mail: só existe o total por afiliado.

## Onde entra nos números

- CPA: fica FORA da média de CPA negociado (ele recebe % e teria um "CPA por venda" irrisório que afundaria a média). A linha do afiliado traz isRecovery = true.
- Lucro do modelo (Visão Geral): as vendas dele saem do FRONT e entram no BACK como receita − comissão.
- Margem de contribuição (Lucro real): entra no canal Recuperação com comissão no lugar do CPA, pagando fee, reserva e custo de produto como o front.
- NET AFTER CPA dele não se compara com o dos afiliados de CPA.
