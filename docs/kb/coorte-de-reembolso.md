---
title: Coorte de reembolso — matriz censurada, maturação e projeção
kind: policy
description: Por que o reembolso é medido por coorte (data da venda), como ler a matriz censurada e a curva de maturação, amostra mínima e o método de projeção
effectiveDate: 2026-08-18
---

# Coorte de reembolso — matriz censurada, maturação e projeção

## O problema que a coorte resolve

A taxa "reembolso do período ÷ venda do período" quebra quando o volume muda rápido: o estorno de uma venda de duas semanas atrás cai no mês errado e distorce a taxa sem nenhuma mudança real de qualidade. A coorte prende cada estorno ao dia em que a VENDA original aconteceu, não ao dia em que o estorno caiu.

Regra central: dias_para_reembolso = data do estorno − data da venda. O estorno é sempre atribuído à data da venda original, não importa quantos dias depois aconteceu.

## Duas lentes de reembolso — nunca misture

- Lente CAIXA (cards da Visão Geral, get_profit_split.refunds): estornos que ACONTECERAM no período (pela data do estorno, inclusive de vendas antigas) ÷ vendas do período. Responde "quanto voltou no caixa".
- Lente COORTE (aba Reembolsos, get_refund_cohorts): das vendas do dia X, quantas/quanto voltaram até a idade N. Responde "qual é a qualidade das vendas".

As duas estão certas e dão números diferentes. Diga sempre qual está usando.

## Matriz censurada

Linha = dia da venda (BRT). Coluna = dias desde a venda (0, 1, 2… até o horizonte: 14, 30, 60, 90 ou 180). Célula = % ACUMULADO estornado (reembolso + chargeback) das vendas daquele dia até aquela idade.

Censura: se a coorte ainda não viveu a idade N (hoje − dia da venda < N), a célula fica EM BRANCO, não em zero — "ainda não chegou lá" é diferente de "chegou e não estornou". A matriz alterna entre contagem de pedidos e valor em $ (divergem quando o ticket dos estornados é diferente do ticket médio).

## Curva de maturação e taxa madura

Para cada idade N, a curva olha só as coortes que já têm N dias e calcula a taxa agregada (estornados até N ÷ base elegível). É a curva que mostra a saúde mês a mês sem o viés das coortes recentes ainda imaturas puxando a média para baixo. Estorno chega até 60–90 dias depois da venda (a Digistore24 garante reembolso por 180 dias): a "coorte madura" usada para calibrar o modelo de lucro é a de vendas de 60 a 150 dias atrás.

## Amostra mínima

Coorte com menos de 30 vendas é ruído, não taxa: 2 vendas com 1 estorno mostram 50%. A aba marca as células de amostra baixa; na resposta, não tire conclusão de coorte pequena.

## Projeção de maturidade

A coluna "final" projeta onde a taxa de cada coorte recente deve estabilizar ao atingir o horizonte:
- o padrão de desenvolvimento é ancorado nas coortes MADURAS (quanto do total final já tinha acontecido em cada idade, medido só em quem completou o horizonte);
- a projeção por coorte usa Bornhuetter-Ferguson com prior Cape Cod (a taxa agregada observada ajustada pelo desenvolvimento) — o agregado das projeções bate com o prior por construção;
- sem coorte madura no escopo, a projeção vira PISO (célula com sufixo "+", tailIncomplete = true).

## Regras de dado da coorte

- Base = vendas APPROVED + vendas in-place estornadas que têm data de aprovação.
- Estorno de linha reconciliada por CSV sem venda original casada fica fora (entraria com lag zero no dia errado); estornos de dia sem base aparecem no rodapé (orphanEventCount).
- JVZoo: o evento de reembolso traz a data da venda; o instante do estorno é a chegada do IPN.
- BuyGoods: os eventos de estorno não chegam (ver ressalvas de dados) — a coorte da BuyGoods sai próxima de zero por falta de dado.
- A matriz não tem mapeamento fixo de produto no código: o filtro por família usa o catálogo (nome bruto → família).
