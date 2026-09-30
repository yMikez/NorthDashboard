---
name: reembolso-e-chargeback
title: Reembolso e chargeback (caixa × coorte)
when: reembolso, estorno, refund, chargeback, disputa, coorte, "o reembolso subiu", "qual a taxa real de reembolso"
first_tools: get_profit_split, get_refund_cohorts, get_data_coverage, get_platforms
version: 1
---
## Passos
1. Em paralelo: get_profit_split (refunds e refunds7d = os cards da tela), get_refund_cohorts(horizon=60), get_data_coverage (plataformas sem evento de estorno, lacuna da Digistore), get_platforms (observedRefundCbPct + observedRefundSample por plataforma).
2. Quebra na lente CAIXA (por data do estorno) por plataforma/família/afiliado: aggregate_orders(date_axis=refund_event, group_by platform ou family). get_orders(status REFUNDED/CHARGEBACK) só pra LISTAR pedidos.
3. Coorte: projection.periodPctUsd/periodPctCount (projeção do período), curve (maturação), matureCohortCount.
4. Taxas por quebra, variação e projeção → calc.

## Checagens obrigatórias
- Duas lentes, nunca misturadas, sempre nomeadas: CAIXA (estornos que aconteceram no período ÷ vendas do período) × COORTE (das vendas do dia X, quantas voltaram). get_overview.kpis.refundRate NÃO é o card da tela.
- Coorte censurada: vendas recentes ainda vão estornar; tailIncomplete=true → a projeção é piso.
- Coorte com < 30 vendas = ruído.
- _meta.dataQuality / get_data_coverage: plataforma sem evento de estorno ou Digistore com a lacuna do IPN (28% dos estornos, na auditoria de 2026-08, só entram pelo reconcile do CSV) → a taxa real é MAIOR; nunca chame essa taxa de boa.
- JVZoo: disputa chega como reembolso (não há CHARGEBACK) e a data do estorno é a chegada do IPN.
- Chargeback: atenção ≥ 1%, limite 2%.
- Contagem × valor: diga qual (pct = pedidos, valuePct = valor).

## Formato
- summary: reembolso em valor (%), por pedidos (%), monitor 7d (% e contagem), chargeback (%), taxa madura de coorte.
- table por plataforma (ou família): vendas, estornos, % valor, % pedidos, CB %, observada madura e amostra.
- Ressalvas específicas (cobertura, maturação) em uma linha cada.
- scope com período, lente e filtros.
