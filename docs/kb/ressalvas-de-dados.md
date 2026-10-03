---
title: Ressalvas de dados por plataforma
kind: policy
description: Buracos e pegadinhas conhecidos do dado (estornos que não chegam, fusos, linhas extras, colisões de produto) que mudam a leitura de um número
effectiveDate: 2026-10-01
---

# Ressalvas de dados por plataforma

## Como usar este documento

Os números do período vêm SEMPRE das tools de dados (get_*). Este documento explica por que um número pode estar incompleto ou deslocado e o que dizer ao usuário. Quando a pergunta envolve reembolso, lucro ou comparação entre plataformas, confira a ressalva da plataforma em questão e cite-a na resposta. Datas e contagens abaixo são de auditorias feitas na data indicada — o tamanho atual do problema vem de get_data_coverage / get_health.

## Digistore24: cerca de 28% dos estornos nunca disparam IPN

Auditoria de 2026-08-11 (export do painel × log de ingestão): numa janela de 24 horas o painel mostrava 52 estornos e o dashboard recebeu 36. Os 16 ausentes eram TODOS os executados pelas contas Tauk1Affilliate a Tauk4Affilliate (as contas do serviço de recuperação por telefone Tauk); nenhum estorno feito por outras contas faltou. Desde 2026-04-24 eram 1,176 estornos ausentes (cerca de $197,953), 96% deles dessas contas.

A causa está do lado da plataforma/n8n e não foi resolvida. A ponte é a reconciliação pelo CSV exportado do painel da Digistore, que cria as linhas de estorno faltantes. Consequência: até a reconciliação mais recente, a taxa de reembolso da Digistore24 fica SUBCONTADA — trate a taxa como piso e diga isso. Detalhes do export: vem em latin-1, separador ";", horário em America/New_York (não Berlim como o IPN) e a coluna "Created by" aparece duas vezes (a última é quem executou a transação).

## Digistore24: estorno é uma linha extra

Na Digistore24 o estorno chega como uma transação NOVA (linha REFUNDED/CHARGEBACK com parentExternalId apontando pra venda) e a venda original continua APPROVED. Nas outras plataformas o estorno sobrescreve a própria linha da venda (modelo in-place).

Efeitos:
- Receita bruta da Digistore não abate estorno (fica cerca de 11% acima do líquido de estornos) — decisão do dono; o estorno é descontado no modelo de lucro, não no faturamento.
- Contar todas as linhas infla o denominador das taxas por contagem. Use pedidos reais (realOrders = todas as linhas − estornos − chargebacks na Digistore).
- A linha de estorno guarda a data da venda (orderedAt) e a do estorno (refundedAt/chargebackAt): os cards de reembolso usam a data do estorno; as coortes, a da venda.
- Em aberto: custo de produto e frete das linhas de estorno da Digistore são contados de novo (COGS em dobro nessas linhas).

## BuyGoods: eventos de estorno não chegam

Entre 2026-08-24 e 2026-09-22 o dashboard registrou ZERO reembolso da BuyGoods sobre cerca de $234 mil vendidos; no histórico, zero pedidos REFUNDED em cerca de 70 mil pedidos (os cerca de 200 CANCELED podem ser estornos mal rotulados). O evento de refund da BuyGoods não está chegando. Trate "reembolso 0" da BuyGoods como DADO AUSENTE, nunca como ausência de reembolso, e nunca chame a taxa de reembolso da BuyGoods de boa.

## BuyGoods: sessão, papel e colisão de produto

- Sessão: order_id_global é POR TRANSAÇÃO; a sessão real (FE + upsells) é o sessid2 — é por ele que funil, frete e AOV agrupam.
- Papel: o IPN marca "Last Chance" (downsell) como UPSELL; o dashboard corrige pelo nome do produto.
- Colisão de codename: a BuyGoods reutiliza o mesmo product_codename para produtos diferentes (neu2/neu3/neu6 usados por NeuroMindPro e NeuroPulsePro). A separação é pelo NOME do produto no IPN. NeuroPulsePro ≠ NeuroMindPro.
- Afiliado é POR LOJA: a BuyGoods numera o aff_id separadamente em cada loja (account_id — uma por produto/marca). O 62 da loja 12595 (Nicolas Yago Zapora) não é o 62 da 12610 (Marco Cunha) nem o 62 da 13457 (MailX). Desde 2026-10-01 a conta do afiliado no dashboard é aff_id@loja (ex.: 62@12595); o histórico foi separado por loja. Antes disso 18 contas somavam pessoas diferentes (cerca de 1.900 vendas, US$ 449 mil creditados à pessoa errada). "0" é venda sem afiliado e fica sem loja. A mesma pessoa tem um aff_id diferente em cada loja — somar as contas dela só pela identidade unificada (parceiro), nunca pelo número.
- Horário: wall clock America/New_York.

## JVZoo: IPN por produto, disputa e data do estorno

- A JVZoo configura o IPN POR PRODUTO: produto novo só chega depois que o IPN é cadastrado nele. Na reconciliação de 2026-08-25, 862 vendas (cerca de $226 mil) de produtos novos estavam faltando e foram importadas pelo CSV do painel.
- "Disputed" chega como reembolso comum: não existe CHARGEBACK da JVZoo no banco; disputa só é distinguível pelo CSV.
- A data que vem no evento de reembolso é a data da VENDA; o instante do estorno é o horário de chegada do IPN.
- Compras-teste do vendor (funil inteiro a cerca de $1) com valor abaixo de $2 são descartadas na ingestão.
- Sessão = e-mail do comprador + dia Eastern (a JVZoo não manda um id de sessão confiável). Duas compras independentes do mesmo e-mail no mesmo dia se fundem.
- O papel no funil vem do NOME do produto (ver o documento de funil e etapas).

## Cartpanda: moeda e estrutura do pedido

- A loja é em BRL mas o campo order.currency vem "USD" (enganoso). O dashboard descobre a moeda real e converte para USD pela taxa de câmbio que a própria Cartpanda manda no payload — sem API externa de câmbio.
- Um webhook = um pedido com vários itens: o dashboard grava uma linha por item (FE e upsells), agrupadas pelo id do pedido (a sessão é o próprio pedido).
- O papel no funil vem do up_sell_id/up_sell_type do item, nunca do nome.
- Upsell de OUTRA marca na mesma sessão (ex.: Horse Peak FE → Giant Power UP2) fragmenta o funil por família.

## Fusos horários de cada fonte

O dashboard agrupa tudo em dia BRT (America/Sao_Paulo, UTC−3, sem horário de verão). As fontes carimbam horários em fusos diferentes, todos convertidos para UTC na entrada:
- ClickBank: horário com offset explícito (Pacífico).
- Digistore24: IPN em Europe/Berlin; export CSV do painel em America/New_York.
- BuyGoods e JVZoo: America/New_York (Eastern).
- SalesBound: webhook em America/New_York; export CSV em America/Chicago (1 hora atrás).
- Tauk e Logicall: America/New_York (Logicall: assumido).

Consequência: comparado ao painel de cada plataforma, uma venda perto da meia-noite pode cair no dia vizinho — diferença de 1 dia na borda é esperada, não é erro. A série diária de get_costs_overview está em dia UTC (as demais séries estão em dia BRT).

## SalesBound, Tauk e Logicall

- SalesBound: o webhook de pedido não marca reembolso, void nem recusa — isso só entra pelo export CSV do CRM deles, que precisa ser reimportado periodicamente. Período depois do último export tem estorno faltando.
- Tauk: o feed não tem id de transação (deduplicação por e-mail + data) e não reporta estorno nenhum.
- Logicall: integrada por consulta à API a cada 30 minutos; dados desde 2026-08-22; comissão e fuso são configuráveis e podem estar como "assumidos" (a tool indica).

## Digistore24: afiliado dos upsells

O IPN de upsell/downsell da Digistore24 às vezes traz no campo de afiliado o tracking do produto (ex.: "neuromindpro12") em vez do afiliado real. O dashboard faz o backend herdar o afiliado da FE da mesma sessão. Pseudo-afiliados internos (família + dígitos, id "0") ficam fora dos rankings por padrão.

## Catálogo, custos e fulfillment

- Família inferida pelo classificador × verificada por humano: SKU ainda não verificado pode estar na família errada; SKU irresolvível fica com custo NULO (pedido marcado como pendente de classificação) — o custo de produto do período fica subestimado até os SKUs pendentes serem confirmados no catálogo.
- Família sem custo cadastrado entra com custo de produto zero: lucro de custo real inflado.
- Desde 2026-07-30 a ShipOffers está pausada e TODO o frete é calculado com as tarifas da RedRock (fornecedor padrão temporário). O fornecedor "fullstack" usa tarifas provisórias.

## Atrasos e o que o dashboard não tem

- Respostas das abas ficam em cache de 30 segundos; a visão materializada diária é recalculada em segundos a um minuto após novas vendas.
- O dashboard não recebe visitantes, cliques nem gasto de mídia: EPC, taxa de conversão da página, CTR e ROAS não existem aqui. A métrica mais próxima do EPC é o EPO (net ÷ sessões com FE).
