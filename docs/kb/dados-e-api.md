---
title: Dados do dashboard — dump de pedidos, filtros e como ler os números
kind: reference
description: Semântica dos campos do dump de pedidos (refundModel, refundedUsd, originalGross, updated_since), metas configuradas, filtros das abas, caches e regras pra um relatório bater com o dashboard
effectiveDate: 2026-09-25
---

# Dados do dashboard — dump de pedidos, filtros e como ler os números

## O dump de pedidos (reconciliação linha a linha)

O caminho mais direto para levar vendas para fora (BI, planilha, conferência com o painel da plataforma) é o dump de pedidos: por plataforma e por dias inteiros em BRT, com teto de 50,000 linhas por chamada (truncated = true avisa que faltou coisa). Existem duas lentes de janela:
- por data da compra (start/end, dia BRT) — o retrato de um período;
- por atualização (updated_since) — tudo que MUDOU desde então, mesmo com compra antiga. É essa que pega o reembolso que chegou 25 dias depois da venda; a resposta vem em ordem de updatedAt e traz next_updated_since quando bate o teto.

Tudo é JSON, datas em ISO 8601 UTC e dinheiro em USD.

## Campos de cada linha

- externalId: id da transação NA plataforma — a chave de conciliação. parentExternalId: na Digistore, aponta da linha de estorno pra venda original.
- sessionId: agrupa a sessão de compra (front + upsells do mesmo cliente).
- status: APPROVED, REFUNDED, CHARGEBACK, PENDING, CANCELED. productType: FRONTEND, UPSELL, DOWNSELL, BUMP, SMS_RECOVERY. funnelStep: posição no funil (1 = front).
- gross: valor da linha hoje; originalGross: valor da venda no ingest, antes de qualquer evento de estorno; net: o que sobra depois da taxa da plataforma e da comissão do afiliado; cpa: comissão paga ao afiliado nessa venda.
- refundedUsd / chargebackUsd: quanto foi devolvido nesta linha, SEMPRE positivo (0 se não houve). refundedAt / chargebackAt: quando o estorno aconteceu.
- orderedAt / approvedAt / updatedAt (eixo do updated_since), country (ISO-2), productId/productName (crus da plataforma), family (produto normalizado — é por aqui que se agrupa), bottles, affiliateId/affiliateName (da plataforma), mappedAffiliateId (do sistema de afiliados).
- customerEmail é dado pessoal.

## refundModel — leia antes de somar

- in-place (JVZoo, BuyGoods, ClickBank, Cartpanda, PagAmerican): a própria linha da venda vira REFUNDED/CHARGEBACK.
- extra-row (Digistore24): a venda continua APPROVED e entra uma linha nova, negativa, com parentExternalId apontando pra ela.

Somar gross sem saber disso conta a venda da Digistore duas vezes e some com a venda estornada da JVZoo. Use refundedUsd/chargebackUsd e originalGross. Reembolso parcial sai como parcial quando a plataforma reporta o valor devolvido; quando ela manda o valor cheio, refundedUsd sai igual ao total.

## Metas e taxas configuradas

Fonte única das metas de reembolso/chargeback e das taxas do modelo (editáveis pelo admin): meta de reembolso D30, limite de reembolso D30, chargeback de atenção e limite, opex%, e por plataforma fee%, reserva% e refund&cb% do modelo com o modelo de estorno. Os valores vigentes vêm da tool get_profit_model — não presuma.

## De-para de produto

productId/productName são crus da plataforma e o mesmo codinome já apareceu em produtos diferentes. Quem agrupa é family — a mesma dimensão das abas. Família "não verificada" foi inferida pelo classificador e ainda não confirmada por humano.

## Filtros das abas

Todas as abas aceitam início/fim (instantes ISO que representam dias BRT), plataformas (slugs clickbank, digistore24, buygoods, cartpanda, jvzoo), famílias, produtos (id externo), países (ISO-2), affiliate_id (do sistema de afiliados), etapas (FRONTEND, UPSELL…) e comparação com o período anterior. A lista de transações aceita também status, tipo, busca e paginação.

## Como ler os números sem errar

- O dia é BRT, mesmo quando a plataforma informa em outro fuso (ClickBank Pacífico, Digistore Berlim, BuyGoods e JVZoo Eastern, SalesBound Eastern no webhook e Central no export). Timestamps na resposta são UTC: converta antes de agrupar por dia.
- Estorno tem duas lentes: por data do estorno (quanto voltou no caixa naquele dia — Visão Geral, Lucro real) e por coorte (o estorno abate a venda que o gerou — Call Center, coortes de reembolso). Os dois estão certos e são diferentes: escolha um e diga qual.
- Estorno demora semanas: período recente sempre parece melhor do que vai ficar quando a coorte amadurecer.
- A latência do estorno varia: JVZoo, ClickBank e Cartpanda chegam em segundos; na Digistore cerca de 28% dos estornos só entram pela reconciliação por CSV; SalesBound só pelo export; a Tauk não reporta estorno; a BuyGoods não está mandando evento de estorno (reembolso zero = dado ausente).
- gross é valor cheio: taxa da plataforma e comissão do afiliado só saem no net e no Lucro real.
- Venda de call center fica fora das métricas de plataforma, de propósito (evita somar duas vezes).

## Caches e limites

As respostas das abas ficam em cache de 30 segundos por combinação de parâmetros; o ranking de afiliados, 5 minutos. O dump corta em 50,000 linhas; o período custom do ranking vai até 366 dias; o lucro dia a dia, até 62 dias.
