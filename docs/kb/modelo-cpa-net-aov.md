---
title: Modelo CPA — NET AOV, NET AFTER CPA e status
kind: policy
description: Fórmula da planilha CPA usada por afiliado (NET AOV com reserva, NET AFTER CPA, cpaStatus), de onde vem cada premissa e como calcular o CPA máximo sustentável
effectiveDate: 2026-09-23
---

# Modelo CPA — NET AOV, NET AFTER CPA e status

## Fórmulas

O modelo vem da planilha "CPA.xlsx" da operação e é aplicado por afiliado (aba Afiliados e Análise de afiliados):

- NET AOV = AOV × (1 − (refund&cb% + fee% + opex% + reserva%) / 100)
- NET AFTER CPA (por FE) = NET AOV − CPA negociado
- NET AFTER CPA total = NET AFTER CPA por FE × FEs aprovadas do afiliado

Os percentuais estão em pontos (15 = 15%). A reserva (allowance) entrou na fórmula em 2026-09-23, a pedido do dono ("allowance também deve ser considerado como custo"); antes o modelo saía otimista. O opex% continua na fórmula.

## Status do afiliado (cpaStatus)

- saudável: NET AFTER CPA por FE ≥ healthyMinUsd
- atenção: NET AFTER CPA por FE ≥ attentionMinUsd
- renegociar: abaixo disso

A régua é configurável pelo admin (padrão: saudável a partir de $10 por FE, atenção a partir de $0). O valor vigente vem de get_profit_model — nunca presuma a régua.

## De onde vem cada premissa

- AOV do afiliado: receita dos pedidos dele (FE + upsells + downsells) ÷ FEs aprovadas dele. Não é o AOV de sessão da Visão Geral.
- fee%: taxa REAL da plataforma (cadastro da plataforma, % do faturamento).
- refund&cb%: premissa manual POR PLATAFORMA, porque o evento de estorno chega semanas depois e a taxa recente subestima. Exceção Digistore24: o modelo usa a taxa REAL em valor da coorte madura (vendas de 60 a 150 dias atrás, |$ estornado| ÷ $ vendido), com o valor manual só como reserva quando a amostra madura tem menos de 50 vendas.
- Override por afiliado: o admin pode fixar um refund&cb% próprio para um afiliado (refundCbPctOverride); a linha mostra qual foi usado (refundCbPctUsed).
- opex%: percentual global de custos operacionais (padrão 10%), guarda-chuva para custo de produto, frete e operação.
- reserva%: percentual retido pela plataforma (cadastro da plataforma).
- CPA negociado (cpaPerFe): o ÚLTIMO CPA pago observado numa FE aprovada com CPA > 0 dentro do período — o CPA de contrato vigente, não a média. Reembolso e chargeback zeram o CPA da venda estornada.

## Afiliados de recuperação e contas unificadas

- Afiliado de recuperação (isRecovery) é pago por comissão % sobre cada venda, não por CPA: fica fora da média de CPA e o NET AFTER CPA dele não se compara com o dos demais.
- Visão por parceiro (a mesma pessoa em várias plataformas): NET AOV e CPA por venda são ponderados pela MESMA base (contas com CPA), então NET AOV − CPA por venda = NET AFTER CPA na linha do parceiro.
- NET AFTER CPA vazio (null) significa "sem CPA detectado", não zero.

## CPA máximo sustentável e sensibilidade

- CPA máximo para ficar saudável = NET AOV − healthyMinUsd.
- CPA de equilíbrio (lucro zero no modelo) = NET AOV.
- Cada 1 ponto de refund&cb% a mais custa 1% do AOV por FE. Ex.: AOV de $400 com 1 ponto a mais de reembolso reduz o NET AOV em $4 por FE.
- Use a calculadora (calc) com os valores das tools; não faça a conta de cabeça.

## Relação com o lucro da Visão Geral

A soma dos NET AFTER CPA dos afiliados NÃO é igual ao lucro FRONT do card "Net after CPA (modelo)" da Visão Geral: o card usa a taxa da plataforma (sem override por afiliado), não desconta a reserva e soma por plataforma. Veja o documento de lucro front × back.
