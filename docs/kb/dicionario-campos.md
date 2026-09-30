---
title: Dicionário de campos das tools
kind: reference
description: Unidade (fração, pontos percentuais, US$, contagem), eixo de data e significado dos campos que as tools de dados devolvem — por tool
effectiveDate: 2026-09-30
---

# Dicionário de campos das tools

## Convenções gerais

- Dinheiro: sempre USD (valores de outras moedas já convertidos na entrada).
- FRAÇÃO 0–1 (0.0823 = 8.23%): campos *Rate (approvalRate, refundRate, cbRate), takeRate, pctCount/pctUsd das coortes, commissionPct do call center e da recuperação, share, dropPct, variações relativas (delta.revenue, fePct, aovPct).
- PONTOS PERCENTUAIS (8.23 = 8.23%): campos *Pct da maior parte dos serviços (marginPct, estimatedMarginPct, feeRatePct, allowancePct, refundCbPct, observedRefundCbPct, refundCbPctUsed, opexPct, refunds.pct, refunds.valuePct, trendPct, pctPackages).
- Exceções de nome enganoso: commissionPct (call center, recuperação) é FRAÇÃO; upsellLiftPct (famílias) e fulfillmentPctOfGross/totalPctOfGross (fulfillment) são FRAÇÃO; takePp (funil por janelas) é fração (0.05 = +5 pp).
- Cada resultado traz _meta.units com a unidade das chaves presentes — ele vence esta lista.
- Datas: instantes em ISO UTC (orderedAt, eventAt, lastOrderAt); dias em 'YYYY-MM-DD' BRT (daily.date, day), exceto get_costs_overview.daily, que está em dia UTC.
- Diferença entre duas taxas é em pontos percentuais (pp); variação relativa é em %. Diga qual.

## get_overview (Visão Geral)

- kpis.gross: receita bruta das vendas APPROVED por data da venda (US$). grossOriginal: valor original de toda venda do dia, mesmo estornada (lente "Evento").
- kpis.net: o que a plataforma credita — já sem fee/impostos E sem CPA (US$). Nunca subtraia CPA do net.
- kpis.approvedCount: linhas APPROVED; kpis.orderGroups: sessões com FE aprovado.
- kpis.aov: receita das sessões com FE ÷ orderGroups (US$). kpis.epo: net ÷ orderGroups.
- kpis.approvalRate / refundRate / cbRate: FRAÇÃO por contagem de linhas pela data da venda (as linhas extras de estorno da Digistore entram no denominador). NÃO são os cards de reembolso da tela.
- kpis.estimatedProfit = net − COGS − fulfillment; estimatedMarginPct em pontos. kpis.netProfit (net − CPA) conta o CPA duas vezes — ignore.
- kpis.cogs / fulfillment: incluem pedidos estornados.
- daily[]: série por dia BRT. deltas.*.pct: variação relativa (fração); deltas.*.pp: diferença em pontos.

## get_profit_split (cards de lucro e de reembolso)

- front.profitUsd: Net after CPA (modelo) do front — card da Visão Geral. front.refundCbUsd: quanto o modelo descontou de reembolso&CB.
- back.sources[]: cada fonte do backend (recuperação, tauk, logicall, sms, salesbound indisponível) com grossUsd, costUsd, netUsd. back.profitUsd: soma. totalUsd = front + back.
- refunds.valuePct (pontos): card "Taxa de reembolso" — |$ estornado no período, pela data do estorno| ÷ $ faturado no período.
- refunds.pct (pontos): card "Reembolso por pedidos" — estornos no período ÷ pedidos reais do período (chargeback fora).
- refunds7d: monitor rolante dos últimos 7 dias a partir de agora (limite de alerta 10% dos pedidos; atenção a partir de 8%).
- opexPct (pontos): opex% global do modelo.

## get_affiliates e get_affiliate_detail (Afiliados)

- revenue, net, cpa, cogs, fulfillment (US$) do afiliado no período, por data da venda.
- feApprovedCount: FEs aprovadas; realOrders: pedidos reais (Digistore sem as linhas extras) — denominador das taxas por afiliado.
- cpaPerFe: CPA negociado = ÚLTIMO CPA pago numa FE com CPA > 0 no período. cpaPerFeApproved: média ponderada (deflacionada por FEs sem CPA).
- netAovUsd, netAfterCpaUsd (por FE), netAfterCpaTotalUsd, cpaStatus (saudavel | atencao | renegociar): modelo CPA. null = sem CPA detectado.
- refundCbPctUsed / opexPctUsed (pontos): premissas usadas no NET AOV; refundCbPctOverride: override do afiliado.
- attributed* (Revenue, Net, Cpa, Cogs, Fulfillment, Profit): lucro atribuído à sessão (FE do afiliado + backend da sessão); attributedMarginPct em pontos.
- mappedAffiliateId: id do sistema NorthScale Afiliados (o filtro "Afiliado" da tela). isRecovery: afiliado de recuperação.

## get_affiliate_analysis, get_affiliate_explain, get_affiliate_sequence (janelas)

- Janelas de N dias fechando ONTEM (ou no anchor): start/end em dia BRT.
- revenue, aov, feTicket, cpaPerFe, netAov, netAfterCpa, netAfterCpaTotal em US$; approvalRate/refundRate e backendTakeRate em FRAÇÃO; activeDays em dias.
- delta.revenue / delta.sales / delta.aov / delta.refundRate: variação relativa (FRAÇÃO); delta.netAfterCpa em US$.
- concentrationTop10, share, dropPct, retainedChangePct: FRAÇÃO.
- Na explicação, a variação de receita se decompõe exatamente em (ΔFEs × AOV anterior) + (FEs atuais × ΔAOV).

## get_funnel e get_funnel_sequence (Funil)

- stages[].takeRate: FRAÇÃO (volume da etapa ÷ sessões com FE). revenue por etapa em US$.
- summary: aov (de sessão), aovFEOnly, aovWithUpsell, totalRevenue, revenueFeSessions (US$); revenueLiftFromUpsells em FRAÇÃO (AOV com upsell × só-FE, não participação na receita).
- Sequência: volumeEffect, aovEffect, takeEffectUsd, revenueDelta em US$; fePct, aovPct, revenuePct em FRAÇÃO; takePp em FRAÇÃO (0.05 = +5 pp).

## get_products, get_families, get_platforms

- get_products: por SKU, revenue/net/cpa/cogs/fulfillment/estimatedProfit em US$; taxas por contagem em FRAÇÃO; estimatedMarginPct e attributedMarginPct em pontos.
- get_families: grossRevenue, netRevenue, cpaPaid, aov em US$; upsellLiftPct em FRAÇÃO.
- get_platforms: feeRatePct, allowancePct, refundCbPct (premissa do modelo) e observedRefundCbPct (observado em coorte madura) em PONTOS, observedRefundSample em contagem; approvalRate/refundRate em FRAÇÃO — no mesmo objeto convivem fração e pontos.

## get_orders

- Uma linha por transação: plataforma, produto, etapa, afiliado, país, gross/net/fees/CPA (US$), status.
- orderedAt (venda) e eventAt (estorno) em ISO UTC. Com status REFUNDED/CHARGEBACK o período filtra pela data do ESTORNO; nos demais, pela data da venda.
- Paginado (limit ≤ 1000, offset). Para somar ou contar, use aggregate_orders em vez de paginar.

## get_costs_overview (Custos)

- kpis: grossUsd (APPROVED), refundsUsd e refundsCount (REFUNDED + CHARGEBACK), platformFeesUsd (real quando a plataforma informa, senão estimada pelo cadastro), cpaUsd, cogsUsd, fulfillmentUsd, profitUsd (US$); marginPct em pontos. allowanceReservedUsd é a reserva retida numa janela rolante de 60 dias — não é do período.
- profitUsd = gross − fees − CPA − COGS − fulfillment (tudo sobre as APPROVED). byPlatform[].feeRatePctEffective em pontos.
- byFamily[].profitUsd = gross − COGS − fulfillment: NÃO desconta fee nem CPA; isCataloged = false → família sem custo cadastrado (COGS zero).
- daily[]: em dia UTC (as outras abas usam dia BRT).

## get_fulfillment

- Potes, pacotes, gasto e custo por pote em US$/contagem; por fornecedor (bySupplier) e família.
- fulfillmentPctOfGross / totalPctOfGross: FRAÇÃO; trendPct e pctPackages: pontos.
- Projeções (forecast) relativas a AGORA; cycleStart/closesOn em dia BRT (a fatura fecha na terça).

## get_refund_cohorts (Reembolsos)

- cohorts[]: dia da venda (BRT) × idade; pctCount / pctUsd em FRAÇÃO acumulada; células censuradas ficam vazias.
- projection.periodPctCount / periodPctUsd: FRAÇÃO projetada; tailIncomplete = true → a projeção é piso.
- horizonDays, ageDays em dias.

## get_call_center, get_recovery, get_sms, get_health

- get_call_center: vendas, receita, comissão e líquido por parceiro (US$); commissionPct em FRAÇÃO; commissionAssumed = comissão assumida; estorno na lente de coorte; daily.* por dia BRT.
- get_recovery: commissionPct / currentPct / effectivePct em FRAÇÃO; comissão devida em US$.
- get_sms: deliveryRate (entregues ÷ finais) e stopRate em FRAÇÃO; deliveryRateDeltaPp em pontos.
- get_health: taxas de 24h e baseline de 30 dias em FRAÇÃO; último IPN por plataforma.
