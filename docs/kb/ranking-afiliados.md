---
title: Ranking de afiliados — nota de 0 a 100, Curva Afiliado + S, premissas e reembolso previsto
kind: policy
description: Ranking, Visão Geral e Reembolso Prev. de afiliados: nota de 0 a 100, Curva Afiliado A/B/C/S, bônus e penalidades, previsão do reembolso 60d, quebras e alertas do reembolso e de onde vêm os dados
effectiveDate: 2026-11-05
---

# Ranking de afiliados — nota de 0 a 100, Curva Afiliado + S, premissas e reembolso previsto

Modelo oficial do time de dados de 28/10/2026, com ajustes de 03, 04 e 05/11/2026. O
cálculo roda na página (`public/src/pages/affiliate-ranking-engine.js`, gerado a
partir do painel de afiliados do time de dados). As premissas (pesos, metas,
bônus e penalidades) ficam no banco (`AffiliateScoreConfig`) e só admin muda.

Três abas usam o mesmo motor e o mesmo modelo (permissões `affiliate-overview`,
`affiliate-ranking`, `affiliate-refund`; qualquer uma libera os dados):

- **Visão Geral** (primeira do grupo Afiliados), com duas subabas:
  - **Afiliados**: a base de afiliados com resultado (receita, CPA, CPA ideal,
    reembolso, chargeback, custo, líquido, call center, Status CPA, tendência) e
    alertas. Um alternador mostra os valores em **Percentual** (% da receita do
    funil), **Por cliente** (÷ FEs) ou **Valor total** da safra. No modo
    Percentual, Chargeback = disputas ÷ vendas; nos outros, as taxas de alerta e
    disputa já cobradas (que já estão dentro do reembolso);
  - **Pontuação por curva**: os big numbers dos critérios e um bloco por curva
    A, B e C (radar das notas, tabela de critérios com bons/médios/ruins,
    bônus e penalidades, top 3 e piores 3), como no painel de afiliados.
- **Ranking**: a nota de cada afiliado, Premissas e a página do afiliado.
- **Reembolso Prev.**: quando o lucro da safra vira zero, as curvas de reembolso
  por safra e por quebra, quem puxa a curva e a tabela afiliado × safra.

As telas do Mike (Afiliados, Análise, CRM, Networks) seguem no menu, com o nome
de sempre, enquanto as duas versões são validadas em paralelo.

**CPA ideal (de equilíbrio)** = o maior CPA que ainda deixa lucro zero no funil,
já com o custo do produto e o reembolso previsto de 60 dias:
CPA ideal = CPA pago + lucro previsto (sem call center, como a nota e o Status
CPA). Aparece ao lado do CPA na Visão Geral e na tabela afiliado × safra do
Reembolso Prev.; o CPA fica vermelho acima do ideal e verde abaixo, e a dica
(ao passar o mouse) mostra a diferença em valor e em %.

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
- **Hoje entra** (dia de Brasília), com as vendas que já chegaram na última
  publicação. Receita, FEs e reembolso somam o que já chegou. FEs em 30 dias, o
  bônus de volume e a variação contra o período anterior contam só a parte do dia
  que já passou, para o dia aberto não parecer queda.
- A venda fica na safra do **FE de origem**: o upsell feito depois da meia-noite
  conta no dia do FE (por isso "Este mês" pode diferir por centavos da tela
  Afiliados, que conta pela data da venda).
- O ranking só inclui quem tem **30+ FEs** no período (dá para mudar).

## Curva Afiliado (A/B/C) e S

- Pela receita do funil dos **2 meses fechados + o mês da safra** (contando a
  partir do fim do período escolhido): **A** até 80% da receita acumulada, **B**
  até 95%, **C** o resto. Assim a curva não muda só porque a safra é curta.
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

- **Previsão de 10 dias** do afiliado: reembolso dos primeiros 10 dias (puxado
  para a média quando ele vende pouco) × fator 10d→60d do próprio afiliado (com
  peso pelo volume de venda madura; o resto vem do fator geral, ~2,4).
- **Reembolso 60d previsto = o que já caiu + a parte que ainda falta de cada
  venda × a previsão de 10 dias.** A parte que falta de uma venda com `d` dias é
  `1 − (d/60)^k`, com `k` ajustado à curva mediana (~0,47): quanto mais velha a
  venda, mais pesa o que já aconteceu.
- Safra fechada (60+ dias): só valores reais.
- Teste com datas passadas (as-of em 20/08, 27/08 e 03/09): erro médio por
  afiliado de 2,0 pp → 1,6 pp contra a conta anterior (10d × fator puro).
- A curva por dia da safra mistura o real de cada venda que já tem aquela idade
  com o previsto das que ainda não têm; no dia 60 bate com o reembolso previsto.

## Reembolso Prev. (aba)

- **Teto para lucro > 0** = (líquido − custo + reembolso já caído) ÷ receita: o
  reembolso acima disso dá prejuízo em 60 dias. A tela mostra o dia em que o lucro
  vira zero.
- Quebras em curvas: mês e semana da safra, Curva Afiliado, produto do FE,
  **caminho no funil** (potes do FE + o que levou depois, ex.: `6p+12p` = FE de 6
  potes + Upsell 1 de 12) e **valor do upsell** da sessão (só FE, até 150,
  150–300, 300–500, 500+). Produto, caminho e valor vêm dos pedidos, com o upsell
  na sessão do FE de origem.
- **Clique numa série** = o porquê: o reembolso de cada afiliado, produto, caminho
  e faixa de valor dentro dela e o efeito em US$ de cada um no resultado (a conta
  fecha no valor da curva).
- **Alertas** (popup ao abrir a aba e ao mudar filtro): safra no prejuízo,
  qualquer série com 20%+ de reembolso nos 10 primeiros dias (ou 5 pp acima da
  safra), semana ou mês piorando, quebra ou afiliado grande puxando a safra, e o
  destaque bom.
- **Tabela afiliado × safra:** a Curva e a nota são as da safra do topo. Quem não
  vendeu nela mostra, esmaecidas, a Curva e a nota da safra mais recente em que
  vendeu (o título da nota diz qual).
- Achado de 05/11 (safras fechadas de jul–set): a sessão com upsell de US$ 300–500
  — quase sempre FE de 6 potes + Upsell 1 de 12 potes sem o Upsell 2 — devolve
  ~35% contra ~21% de quem só leva o FE, e devolve até o FE. Ainda assim deixa mais
  dinheiro por cliente. Associação, não causa: confirmar com teste A/B.

## Pedidos

- Visão Geral e Reembolso Prev. leem todas as vendas de uma vez
  (`GET /api/metrics/affiliate-ranking/all-orders`, colunar, sem dado de cliente).

- A página do afiliado lista todas as vendas cujo FE caiu na safra: valor, CPA,
  reembolso, alerta, chargeback, taxas da plataforma, líquido, custo do produto,
  call center e resultado. Sem dado de cliente.
