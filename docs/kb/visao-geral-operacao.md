---
title: Visão geral da operação e do dashboard
kind: reference
description: O que a NorthScale vende e por onde, quais plataformas e parceiros alimentam o dashboard, como os dados chegam e o que cada aba mostra
effectiveDate: 2026-09-30
---

# Visão geral da operação e do dashboard

## A operação

A NorthScale é vendedora (vendor) de suplementos nutra em marketing de resposta direta com afiliados, para público internacional. Cada produto é uma FAMÍLIA (NeuroMindPro, GlycoPulse, ThermoBurnPro, MaxVitalize, NeuroPulsePro, DigestFlow e outras) vendida num funil: front-end + bump + upsells + downsells, em pacotes de potes. Afiliados levam o tráfego e recebem CPA (valor fixo por venda de front) ou, no caso dos afiliados de recuperação, comissão percentual.

## Plataformas de venda

As vendas passam por cinco plataformas integradas: ClickBank, Digistore24, BuyGoods, Cartpanda e JVZoo (slugs clickbank, digistore24, buygoods, cartpanda, jvzoo). A PagAmerican está em captura (os eventos são gravados, mas ainda não viram pedidos). Cada plataforma tem seu formato de evento, seu fuso horário e seu jeito de registrar estorno — ver o documento de ressalvas de dados.

## Backend: recuperação e cross-sell

Além das plataformas, a receita tem um "backend":
- call centers Tauk e Logicall (recuperação por telefone) e SalesBound (cross-sell por telefone), com vendas fora dos pedidos das plataformas;
- afiliados de recuperação (SMS/e-mail, pagos por comissão %);
- SMS próprio (Mautic → n8n → Twilio), atribuído pelo utm_source smsbrdcst.

## Como os dados chegam

Cada plataforma manda um evento por venda, reembolso ou chargeback (IPN/webhook/postback), normalmente repassado pelo n8n para o endpoint de ingestão do dashboard. Toda chamada é gravada no log de ingestão antes de ser processada (auditável e reprocessável), e a ingestão é idempotente: reenviar o mesmo evento atualiza a venda em vez de duplicar. A Logicall é consultada pelo próprio dashboard a cada 30 minutos; os exports CSV (Digistore, JVZoo, SalesBound) fecham os buracos de evento que não chega.

## As abas

- Visão Geral: receita bruta e líquida, pedidos, AOV, aprovação, cards de reembolso (lente caixa), chargeback e lucro front × back (Net after CPA do modelo).
- Afiliados e Análise de afiliados: ranking com NET AOV, CPA negociado, NET AFTER CPA e status; janelas 3/7/15/30/60 dias fechando ontem, com o "por quê" de cada variação; identidade unificada entre plataformas.
- CRM de afiliados: régua de reativação e fila de toques pro WhatsApp.
- Funil: etapas com take rate e receita por família; janelas comparativas.
- Produtos e Famílias: desempenho por SKU e por família; monitor de call center.
- Plataformas: comparação entre plataformas com fee, reserva e reembolso observado em coorte madura.
- Transações: lista de pedidos com filtros e export.
- Reembolsos: coortes de reembolso (matriz censurada, maturação, projeção).
- Custos e Fulfillment: COGS, frete, potes enviados, fornecedores, fila de catálogo.
- Call Center, Recuperação e SMS: backend por fonte.
- Saúde: último evento por plataforma, falhas e cobertura de dados.
- Lucro real (admin): margem de contribuição oficial da operação.
- Análise (IA): este chat.

## Quem vê o quê

Cada usuário tem permissão por aba; o admin vê tudo. O chat lê os mesmos dados das abas (cada tool chama a mesma função que alimenta a tela). A aba Lucro real e a tool de margem de contribuição são só de admin.
