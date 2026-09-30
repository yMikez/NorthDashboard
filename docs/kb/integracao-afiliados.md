---
title: Integração com o NorthScale Afiliados — identidade do afiliado
kind: reference
description: Quem é fonte de verdade de quê entre o sistema de afiliados e o dashboard, o que é affiliate_id × ID da plataforma, como o mapeamento chega e a semântica das métricas do ranking
effectiveDate: 2026-09-12
---

# Integração com o NorthScale Afiliados — identidade do afiliado

## Quem é fonte de verdade de quê

- O sistema NorthScale Afiliados é a fonte de verdade da IDENTIDADE do afiliado: affiliate_id, nome, status (active/inactive) e os identificadores dele em cada plataforma.
- O dashboard é a fonte de verdade das VENDAS, reembolsos e métricas agregadas; o sistema de afiliados só lê e exibe (ranking), não recalcula nada.

As vendas chegam das plataformas com o identificador do afiliado DA PLATAFORMA (aff_id, username, Digistore ID, Affiliate ID). Para saber de quem é cada venda, o dashboard espelha o mapeamento plataforma + external_id → affiliate_id.

## affiliate_id × ID da plataforma

- affiliate_id: id interno do sistema de afiliados (um cuid de ~25 caracteres, imutável, nunca reutilizado). É o que o filtro "Afiliado" da tela usa (Order.mappedAffiliateId) e o que as métricas do ranking devolvem.
- external_id: o identificador do afiliado NA plataforma, normalizado (trim + minúsculas). Um afiliado pode ter vários na mesma plataforma (ID da conta + um ID por produto aprovado na BuyGoods/JVZoo); o par plataforma + external_id pertence a um único afiliado.
- Plataformas no mapeamento: buygoods, digistore24 e jvzoo. A Cartpanda não faz parte.
- Na BuyGoods o dashboard resolve aff_id → aff_name; na Digistore24, o Digistore ID do afiliado; na JVZoo, o affiliate_id da plataforma. Venda sem mapeamento vai pra fila de "não mapeados" (contador, primeiro/último visto); quando o mapeamento chega, as contas afetadas são reprocessadas.

## status

- active: a equipe liberou o acesso ao painel de afiliados.
- inactive: aguardando liberação ou acesso revogado. As vendas CONTINUAM sendo atribuídas a ele — status não tem nada a ver com "vendendo ou não".

## Como o mapeamento chega

- Webhook affiliate.updated (sistema de afiliados → dashboard): sempre o estado COMPLETO do afiliado; aplicado como substituição. Evento mais antigo que o último aplicado (occurred_at menor) é ignorado com sucesso. Não existe evento de exclusão.
- Reconciliação diária (dashboard → sistema de afiliados): o dashboard relê o mapeamento completo 45 segundos após o boot e depois diariamente — rede de segurança pra evento perdido.
- Campos opcionais de CRM no webhook: phone (e apelidos) e tier; ausentes não apagam o que existe, e edição manual no dashboard vence.

## Métricas do ranking (o que o dashboard devolve)

Endpoint de métricas por afiliado (7d, 30d, mês corrente ou período custom de até 366 dias; dia = America/Sao_Paulo):
- gross_sales: faturado pela data da venda;
- refunds: estornos (reembolso + chargeback) pela data do estorno;
- net_sales = gross_sales − refunds — é o critério do ranking;
- orders_count: pedidos reais (sem as linhas extras de estorno da Digistore);
- refund_rate: % de PEDIDOS estornados, em PONTOS 0–100 (4.2 = 4.2%), não % de valor.
A resposta fica em cache de 5 minutos. O ranking do painel de afiliados ordena por net_sales, depois pedidos, depois menor refund_rate.
