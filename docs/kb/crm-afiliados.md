---
title: CRM de afiliados — régua, ciclo e fila
kind: reference
description: Como a aba Afiliados › CRM classifica afiliados (onboarding, dormente, frio, em risco, upgrade), a escada de toques, a ordem da fila por valor e o export pro WhatsApp
effectiveDate: 2026-09-24
---

# CRM de afiliados — régua, ciclo e fila

## O que a aba faz

A aba Afiliados › CRM implementa o playbook de CRM da NorthScale do lado do dashboard: classifica cada afiliado, monta a fila de trabalho, registra o que foi enviado e exporta pro WhatsApp. O DISPARO continua manual (decisão de 2026-09-24): a estrutura registra o envio, não envia. A aba tem permissão própria — dá pra liberar só ela pra quem opera o WhatsApp, sem expor receita, margem ou CPA.

## A ideia central: o ciclo é o dia da última venda

Cada toque registrado fica ancorado num ciclo:
- Dormente e Frio: o dia da última venda;
- Onboarding: o dia do cadastro;
- Em risco, Upgrade e Ativo: a semana ISO.

Vendeu de novo → muda o dia da última venda → muda o ciclo → os toques antigos deixam de contar e o afiliado sai da fila na hora. Não existe job de expiração nem sincronia com a ferramenta de disparo: é o dado da venda que manda, e ele chega por postback em segundos. Isso evita mandar "sumiu, o que aconteceu?" pra quem vendeu ontem.

## Segmentos

- Onboarding: cadastrado há até 10 dias (configurável) — vale pra quem ainda não vendeu e pra quem acabou de fazer a primeira venda.
- Dormente: dias sem vender ≥ limiar DO TIER (Base 7, Ascendente 5, North 3). O limiar é por tier de propósito: perder um North custa mais, então ele entra na régua antes.
- Frio: 30 dias ou mais sem vender (configurável), ou cadastrado e nunca ativou.
- Em risco: caiu 40% ou mais frente à própria média semanal das últimas 4 semanas, mas ainda vendeu nos últimos 7 dias.
- Upgrade: sustenta o volume semanal do tier de cima por 3 semanas seguidas.
- Ativo: vendendo no ritmo.
- Fora: opt-out no dashboard ou status inactive no sistema de afiliados.

## A escada de toques

A escada corre a partir do limiar do tier, com offsets de 0, 4, 7 e 14 dias:
- Base (limiar 7): D7, D11, D14, D21 (reativacao_d7 … reativacao_d21);
- North (limiar 3): D3, D7, D10, D17;
- passou do limiar de frio: um último toque reativacao_frio;
- Onboarding: D0, D1, D3, D5, D7, D10;
- Em risco: risco_checkin uma vez por semana; Upgrade: upgrade_<tier>; Ativo no top 10: top10_semana.

Um toque só aparece depois de vencer, nunca se repete no mesmo ciclo, e se um degrau foi pulado o próximo devido assume. "Pular este ciclo" tira da fila sem contar como enviado.

## Ordem da fila: valor, não dias parados

Metade da base não paga o próprio CPA: reativar todo mundo que parou é caro e às vezes aumenta a perda. A fila ordena por VALOR (o maior entre a receita dos últimos 30 dias e o melhor mês do afiliado no histórico), com alertas:
- sem_whatsapp: falta o número, não dá pra contatar;
- prejuizo: Net após CPA negativo no mês com 5 vendas ou mais — é conversa de CPA, não de régua;
- cpa_acima_do_volume: recebe CPA de North sem entregar volume de North;
- tier_indefinido: sem tier da plataforma e sem CPA conhecido — está caindo em Base.

## Telefone e tier

Resolução, nesta ordem: manual no dashboard → o que o sistema de afiliados mandar no webhook → (só pro tier) inferido pelo CPA pago → Base. Campo ausente no webhook não apaga o que já existe, e edição manual sempre vence o sincronismo. Os CPAs de corte para inferir tier (230 / 240) vieram da página show-app; dois limiares de upgrade são chute inicial declarado (10 vendas/semana pro Ascendente, 25 pro North) e são editáveis no painel de parâmetros.

## Export e medição

O export (CSV) traz por padrão só quem está devendo toque neste ciclo, com nome, WhatsApp, tier, dias sem venda, produto principal, CPA atual e tag sugerida (mais segmento, toque, valor, última venda, prioridade, plataformas e ciclo). Leva WhatsApp de parceiro: é dado pessoal. A aba mede o sinal (não prova causa): dos toques dos últimos 30 dias, quantos foram seguidos de venda em até 7 dias, por segmento. A carga de vendas é a mesma da Análise de afiliados — se as duas divergirem sobre "ele vendeu", é bug.
