---
title: Funil, etapas e sessão de compra
kind: policy
description: Etapas do funil (FE, bump, upsells, downsells, RC), chave de sessão por plataforma, de onde vem o papel de cada produto, take rate e AOV do funil
effectiveDate: 2026-08-26
---

# Funil, etapas e sessão de compra

## Etapas

Um funil de venda direta tem: FE (front-end, a oferta de entrada) → Bump (adicional no checkout) → UP1, UP2, UP3 (upsells) → DW1, DW2, DW3 (downsells, a oferta mais barata depois de um "não"). RC = recuperação por SMS (tipo SMS_RECOVERY). No filtro de etapa (stages) os valores são FRONTEND, UPSELL, DOWNSELL, BUMP e SMS_RECOVERY. A posição no funil (funnelStep) é 1 para o FE, 2/3/4 para o primeiro/segundo/terceiro slot de upsell ou downsell.

## Sessão = uma compra inteira

Sessão (ou pacote) é o funil inteiro do mesmo cliente: FE + bump + upsells + downsells. É a unidade do AOV canônico, do take rate e do frete (pacote de fulfillment = sessão). A chave muda por plataforma:
- BuyGoods: sessid2 (o order_id_global é por transação e não agrupa);
- JVZoo: e-mail do comprador + dia Eastern;
- Cartpanda: o id do pedido (FE e upsells são itens do mesmo pedido);
- ClickBank e Digistore24: o id de sessão/pedido pai da própria plataforma.

## De onde vem o papel de cada produto

- ClickBank: pelo SKU "{Família}-{potes}-{tipo}[-{variante}]" (ex.: NeuroMindPro-6-FE-vs2).
- Digistore24: pelo prefixo do nome "{tipo} - {Família} ({N} Bottles)": M1/M2/M3 e FE = front; UP1/UP2/UP3 = upsell no slot 2/3/4; DS/DW 1/2/3 = downsell no slot 2/3/4; variantes (UP1A, DS1b, UP1.2) não mudam o slot. O campo upsell_no do IPN diz só a posição, não o papel — o nome vence.
- BuyGoods: pelo nome ("(Upgrade)" = upsell, "(Last Chance)" = downsell); o IPN marca Last Chance como upsell e o dashboard corrige pelo nome. Nome com "FREE" é oferta de recuperação (RC).
- Cartpanda: pelo up_sell_id/up_sell_type do item ("Upsell N" → slot N+1, "Downsell N" → downsell), nunca pelo nome.
- JVZoo: pelo nome do produto — "/ FE", "/ OTO1", "/ OTO2", "/ DS 1" no esquema novo; "(Upgrade)" = upsell e "(Last Chance)" = downsell nos produtos antigos; sem marcador vale a memória do catálogo e depois a posição na sessão.

## Convenção do funil JVZoo

Decisão do dono (2026-08-19): o funil JVZoo é SEMPRE UP01/Up02/Up03 + Down01/Down02/Down03, com slots UP01 = etapa 2, Up02 = 3, Up03 = 4 e Down01 = 2, Down02 = 3, Down03 = 4. Sem número no nome: DigestFlow ancora no slot 2 (só na JVZoo), o bundle triplo "1 Flex Guard + 1 Night Calm + 1 Honey Flush" no slot 3, NightCalm no 2 e FlexImmuneGuard no 3. Rebill de assinatura (BILL) é uma venda FE nova da própria compra original — não é upsell.

## Take rate e AOV do funil

- Take rate da etapa = volume da etapa ÷ sessões com FE aprovado (fração). Variação de take rate se diz em pontos percentuais.
- AOV de sessão = receita das sessões COM FE aprovado no período ÷ número dessas sessões. Nunca receita total ÷ FEs: upsell cujo FE caiu fora do período (ex.: FE ontem, upsell hoje) é uma sessão "órfã" e fica fora do numerador — o funil mostra quanto isso soma (revenueFeSessions × totalRevenue). Em filtro de um dia só, é normal ter órfãs.
- revenueLiftFromUpsells compara o AOV das sessões com upsell ao das sessões só-FE; não é a participação dos upsells na receita.
- Cross-sell de OUTRA família na mesma sessão conta no funil da família do FE (listado à parte como cross-sell).

## Comparar funis entre janelas

Para "o funil piorou?" compare janelas fechadas de mesmo tamanho (get_funnel_sequence): a variação da receita se decompõe em efeito do VOLUME de FEs (ΔFEs × AOV anterior) e efeito do AOV de sessão (FEs atuais × ΔAOV). Take rate por estágio só é comparável com pelo menos cerca de 50 FEs na família.
