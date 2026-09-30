---
title: Call center — Tauk, Logicall e SalesBound
kind: reference
description: Como cada parceiro de telefone entra no dashboard, comissão/parcela, fusos, lente de estorno da aba Call Center e o monitor que indica quando ligar um call center
effectiveDate: 2026-09-18
---

# Call center — Tauk, Logicall e SalesBound

## O que é e por que fica fora das plataformas

Três parceiros vendem por telefone para a operação: Tauk e Logicall (recuperação de venda perdida) e SalesBound (equipe de cross-sell dos nossos produtos). As vendas deles ficam FORA dos pedidos das plataformas de propósito: a mesma venda recuperada pode também transitar pela plataforma principal, e somar as duas contaria duas vezes. Por isso call center não aparece em get_overview nem nas métricas por plataforma; os números estão em get_call_center (aba Call Center) e entram no BACK do lucro.

## Tauk

- Entrada: webhook que chega com os dados na querystring (via n8n). O feed não tem id de transação — a deduplicação é por e-mail + data da compra.
- Produto: desde 2026-09 o feed manda um campo Product (SKU numérico + nome, às vezes cortado no meio); a família é resolvida pelo dicionário do catálogo.
- Estorno: a Tauk não reporta estorno.
- Horário: wall clock America/New_York.
- Comissão: percentual sobre cada venda recuperada, configurável no painel (padrão do código 35%).

## Logicall

- Entrada: o dashboard CONSULTA a API da Logicall a cada 30 minutos (janela curta) e uma vez por dia relê 45 dias (a API filtra por data de criação — mudança tardia na venda só volta relendo). Dados desde 2026-08-22.
- Feed rico: id de transação (deduplicação real), produto/SKU, agente (humano "LC-…" × IA "lc-ai-process"), campos de estorno e chargeback.
- Horário: America/New_York assumido.
- Comissão: configurável; quando não configurada, 35% marcada como ASSUMIDA (commissionAssumed = true) — diga isso na resposta.

## SalesBound

- Fonte de verdade do dinheiro: o export CSV do CRM deles (Transaction Details), importado no razão; o webhook de pedido registra toda venda nova, mas NÃO marca reembolso, void nem recusa — isso só vem do CSV, que precisa ser reimportado periodicamente (a aba avisa quando o período passa da cobertura).
- Fusos: webhook em America/New_York, export em America/Chicago (1 hora atrás); a ponte entre as duas fontes é o clientTxnId.
- Parcela: a SalesBound fica com 65% e a NorthScale com 35% (confirmado em 2026-09-18).
- Estorno: cerca de 27% em valor no histórico importado (p50 de 23 dias após a venda), inclusive parciais; void é estorno total no mesmo dia.
- Origem do cliente: só a SalesBound informa de qual plataforma veio o cliente (BuyGoods, JVZoo…).

## Lente de estorno da aba Call Center

A aba Call Center usa a lente de COORTE: o estorno abate a venda que o gerou, pela data da VENDA. A aba Lucro real conta o estorno pela data do ESTORNO. Os dois números diferem de propósito — diga qual lente usou. commissionPct no resultado da tool é FRAÇÃO (0.30 = 30%).

## Monitor: quando ligar um call center

Na aba Produtos, produtos que ainda não têm call center são vigiados por vendas/dia (pedidos FRONTEND aprovados por dia BRT, sem rebill), pela média dos últimos 3 dias completos:
- média ≥ 30 vendas/dia → conectar a Tauk (recuperação);
- média ≥ 100 vendas/dia → integrar a SalesBound (cross-sell).
Produto integrado sai da lista de vigilância.
