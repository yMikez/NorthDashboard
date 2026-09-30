---
name: reconciliar-numero
title: Reconciliar número (tela, painel da plataforma, planilha)
when: "não bate com a tela", "no painel da ClickBank/Digistore está diferente", "a planilha diz outra coisa", divergência entre dois números
first_tools: get_overview, get_profit_split, get_data_coverage
version: 1
---
## Passos
1. Identifique a tela e o campo exato. Mapa tela → tool.campo:
   Receita bruta → get_overview.kpis.gross (grossOriginal com o toggle "Evento") · Receita líquida → kpis.net · Pedidos aprovados → kpis.approvedCount · AOV → kpis.aov · Taxa de aprovação → kpis.approvalRate · Taxa de reembolso → get_profit_split.refunds.valuePct · Reembolso por pedidos → refunds.pct e refunds7d · Chargeback → get_overview.kpis.cbRate · Net after CPA (modelo) → get_profit_split.front.profitUsd (total com back = totalUsd) · Custos → get_costs_overview.kpis · Afiliados → get_affiliates · Funil → get_funnel · Call Center → get_call_center · Lucro real → get_net_profit (admin).
2. Reproduza com os MESMOS instantes e filtros da tela: omita as datas pra usar o intervalo da UI e passe os filtros do Estado da UI.
3. Número de fora (painel da plataforma, planilha): traga o mesmo período no fuso da fonte — aggregate_orders com o recorte certo (date_axis sale × refund_event, status) — e monte a ponte com calc.
4. Planilha/CSV anexado: load_skill arquivo-anexado.

## Checagens obrigatórias
- gross (só APPROVED) × grossOriginal (valor original de toda venda do dia, lente "Evento" = Gross Sale Amount da ClickBank).
- Fuso do painel (CB Pacific, D24 Berlim no IPN e Eastern no export, BuyGoods/JVZoo Eastern) × dia BRT do dash.
- Digistore: estorno é linha extra (a venda segue APPROVED).
- Data do estorno × data da venda; APPROVED × todas as linhas; net já sem fee e sem CPA.
- Cache/MV: o dash pode estar 30–60 s atrás.
- Lacunas conhecidas (_meta.dataQuality / get_data_coverage) explicam divergência de estorno.

## Formato
- table "Ponte": número A → cada ajuste (motivo | $ ou unidades) → número B; resíduo final explícito.
- Veredito: qual número está certo pra qual pergunta (lente) e por quê.
