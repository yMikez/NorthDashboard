---
title: Ranking de afiliados — nota de 0 a 100, curva ABC + S e premissas
kind: policy
description: Como a aba Afiliados › Ranking dá a nota de cada afiliado (reembolso 60d previsto, lucro por cliente, FEs e AOV), as curvas A/B/C/S, bônus e penalidades, a previsão do reembolso e de onde vêm os dados
effectiveDate: 2026-11-04
---

# Ranking de afiliados — nota de 0 a 100, curva ABC + S e premissas

Modelo oficial do time de dados de 28/10/2026, com ajustes de 03 e 04/11/2026. O
cálculo roda na página (`public/src/pages/affiliate-ranking-engine.js`, gerado a
partir do painel de afiliados do time de dados). As premissas (pesos, metas,
bônus e penalidades) ficam no banco (`AffiliateScoreConfig`) e só admin muda.

## De onde vêm os dados

- Tabela `dados_oficiais.afiliados_pedidos`, publicada pelo time de dados de hora
  em hora junto com os outros dados oficiais: uma linha por venda JVZoo e Vupim.
- Cada venda aponta para o **FE de origem**: upsell, downsell e bump herdam o FE da
  sessão; o call center fica com o FE mais recente do cliente.
- Dia: **JVZoo no dia de Nova York** (bate com o extrato); Vupim no dia de Brasília.
- Reembolso = o que o cliente pede + taxa de alerta (US$ 23) + taxa de disputa
  (US$ 49), como no extrato da JVZoo.
- Custo do produto: custo real da Full Stack (produto + separação + frete da fatura
  semanal) quando o pedido do FE foi achado no armazém; no resto, a média real
  (~9% da receita).
- Afiliados que rodam em mais de uma plataforma são somados pelo cadastro de
  parceiros (`AffiliatePartner`). A tela também mostra cada conta separada.

## Safra e período

- O filtro de período define a **safra**: as vendas do período, com tudo o que
  renderam até hoje. Padrão: últimos 30 dias.
- O ranking só inclui quem tem **30+ FEs** no período (dá para mudar).

## Curva ABC e S

- Pela receita do funil no período: **A** até 80% da receita acumulada, **B** até
  95%, **C** o resto.
- **S** = curva A com mais de 100 pontos.

## Os 4 critérios (nota 0–10 × peso)

| Critério | Peso | Régua (valor → nota) | Meta (nota 9) |
|---|---|---|---|
| Reembolso 60d previsto | 45 | 0→10 · 12%→10 · 16%→9 · 23%→7 · 45%→0 | ≤ 16% |
| Lucro/cliente previsto | 25 | −60→0 · −15→7 · +5→9 · +30→10 (US$) | ≥ US$ 5 |
| FEs em 30 dias | 20 | 0→0 · meta/2→7 · meta→9 · 2×meta→10 | A 400 · B 120 · C 40 |
| AOV | 10 | 310→0 · 380→7 · 410→9 · 420→10 (US$) | ≥ US$ 410 |

- Faixas: bom 9–10, médio 7–8, ruim 0–6. A nota é interpolada em linha reta.
- Base = média das notas ponderada pelos pesos × 10. Sem dado de reembolso, nota 7.
- Lucro/cliente previsto = (líquido do funil − custo do produto − reembolso que
  ainda vai cair) ÷ FEs, sem call center.

## Bônus e penalidades

| Item | Quando | Quanto |
|---|---|---|
| + Volume alto | mais de 12 FEs por dia | 20/dia = +3 · 50/dia ou mais = +5 |
| + Reembolso baixo | reembolso 60d abaixo de 16% | 12% = +3 · 8% ou menos = +5 |
| − Risco de chargeback | disputas acima de 2% das vendas (vendas com 30+ dias, mínimo 20) | 3% = −5 · 4% ou mais = −10 |
| − Prejuízo por cliente | líquido previsto com call center ÷ FEs pior que −US$ 30 | proporcional até −50 em −US$ 90 |

Pontuação = base + bônus + penalidades (pode passar de 100). Selo: 80+ forte,
60–79 bom, 40–59 atenção, abaixo de 40 ruim.

## Previsão do reembolso de 60 dias

- Reembolso de 10 dias do afiliado (puxado para a média quando ele vende pouco)
  × fator 10d→60d do próprio afiliado (com peso pelo volume de venda madura; o
  resto vem do fator geral, ~2,4).
- Safra fechada (60+ dias): só valores reais.
- A curva por dia usa o histórico do próprio afiliado misturado com a mediana
  geral; quem não tem histórico usa só a mediana.

## Pedidos do afiliado

- A página do afiliado lista todas as vendas cujo FE caiu na safra: valor, CPA,
  reembolso, alerta, chargeback, taxas da plataforma, líquido, custo do produto,
  call center e resultado. Sem dado de cliente.
