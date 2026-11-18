# Afiliados: devolução D60 (real e prevista)

Tela **Afiliados → Afiliados** (`LeaderboardPage`, `public/src/pages/all-pages.jsx`). Desde 16/11/2026 a tabela mostra,
por afiliado, as colunas Reembolso, Chargeback, Alertas, Taxas e Devol. Total **em %** (pedido do Douglas: "Visto d0 /
Previsto D60"): o **visto** em cima (o que já aconteceu, até 60 dias depois da venda, ÷ vendido do período) e a
**previsão para o dia 60** embaixo (÷ vendido dos pedidos com previsão). Tela, tooltip e card só em % (valor em US$
depende do filtro e não diz muito); US$ só no CSV.

## Vocabulário (decisão de 16/11/2026, vale para todas as telas)

| Nome na tela | O que é | Real (colunas que já existiam) | Previsto |
|---|---|---|---|
| Reembolso | pedido pelo cliente | `reembolso` sem disputa e sem `taxa_alerta` | `r60_reembolso_previsto` |
| Chargeback | valor das disputas | `reembolso` com `disputa` | `r60_disputa_previsto` |
| Alertas | valor dos alertas | `reembolso` sem disputa, com `taxa_alerta` > 0 | `r60_alerta_previsto` |
| Taxas | US$ 23 do alerta + US$ 49 da disputa | `taxa_alerta` + `taxa_disputa` | `r60_alerta_taxa_previsto` + `r60_disputa_taxa_previsto` |
| Devol. Total | soma de tudo | soma das quatro | `r60_total_previsto` (número oficial do modelo) |

Real (na tela, "visto"; no código, `real`) = evento até 60 dias depois da venda (`reembolso_dia − dia` ≤ 60; taxa de disputa por `taxas_dias` ≤ 60), a mesma
regra do modelo: nas vendas com 60+ dias o real da tela bate ao centavo com o real do modelo (conferido em 16/11/2026,
JVZoo de 01/08 a 15/09: US$ 2.353.357,50).

As colunas antigas de devolução observada e de chargeback (quantidade ÷ vendas pagas) saíram da tabela (16/11/2026):
a Devol. Total visto/previsto substitui as duas. O % de devolução usado no NET AOV continua no tooltip do NET AOV e no
botão "Devolução no NET AOV".

## De onde vem

1. Modelo de reembolso do time de dados (job `ml-reembolso`, 06:50 BRT) → BigQuery `ml.reembolso__previsao_pedido`
   (1 linha por venda JVZoo e Vupim, desde 01/08/2026).
2. A view `report_data_quality.afiliados_pedidos` junta a previsão em cada venda (`plataforma` + `venda_id`).
3. A publicação única (`postgres-dados-oficiais`) copia para `dados_oficiais.afiliados_pedidos` no Postgres.
4. `lib/services/affiliateRefundForecast.ts` soma o real e o previsto por conta do afiliado de **entrada do funil**
   (`fe_plataforma` + `fe_afiliado_id`), com o **dia da venda** (`dia`: JVZoo dia de Nova York, Vupim BRT) dentro do
   período do filtro (convertido para dia BRT). A rota `/api/metrics/affiliates` pendura `refundD60` (`real` + `forecast`) em cada linha
   antes de unificar por parceiro (`affiliatesUnified.ts` soma as contas).

## Regras

- Os valores previstos por pedido são **esperados** (ex.: 0,18 × vendido): soma primeiro, divide depois. O % de cima
  é ÷ vendido de todos os pedidos do período; o de baixo, ÷ vendido dos pedidos com previsão. Cada linha usa uma base
  só, então as partes somam a Devol. Total também em %.
- O real funciona com as colunas que a tabela já tem; o previsto depende das colunas `r60_*` (publicadas pelo time de
  dados). Sem elas, a tela mostra o real e "prev. —".
- Venda com 60+ dias (`r60_fechado`): previsto = real.
- Devol. Total: o previsto D60 aparece em destaque (selo colorido) e a cor vem dele (Douglas, 18/11/2026): verde
  abaixo de 22%, amarelo de 22% a 26,9%, vermelho a partir de 27% (% arredondado a 1 casa, como na tela). Vale para a
  coluna e para o card "Devol. Total D60". O visto (em cima) fica sem cor. A régua de pontos do Ranking
  (`ranking-afiliados.md`, 16%/23%) é outra e não mudou.
- A previsão **não** aplica os filtros de produto, família e país (a tela avisa).
- O card "Devol. Total D60" soma **todas** as contas do período (`refundD60Source.totals`): o previsto bate com
  `SUM(r60_total_previsto)` do BigQuery para o mesmo período.
- Com erro de leitura, a lista de afiliados segue igual e as colunas mostram "—".
