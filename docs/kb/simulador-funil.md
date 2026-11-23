# Simulador de Funil (Análise › Simulador de Funil)

Tela do time de dados (Douglas) para pensar uma oferta com afiliados: parâmetros gerais, funil por etapa e o
resultado até o lucro final, com o lucro do call center. Cada campo tem o **Real** (dados publicados) e a
**Simulação** (meta digitada). Campo vazio usa o real.

## Blocos

1. **Parâmetros gerais** (% da receita bruta): Vendas FE, Reembolso, Chargeback, Alertas, Taxas (alerta + disputa),
   Devol. Total (soma), Taxa da plataforma, Fulfillment e Lucro do call center.
2. **Funil detalhado**: FE, Bump, OTO1–3, DS1–3 (e etapas incluídas à mão, ex.: infoproduto). Por etapa:
   conversão (% das vendas FE, cada etapa independente), preço e CPA por venda.
3. **Resultado** (lateral): Simulação, Real ou Diferença; veredito, AOV, lucro por FE, CPA de equilíbrio,
   call center para empatar e "Onde mexer" (as 4 alavancas de maior efeito no lucro final).

## Conta (igual para Real e Simulação)

```
vendas_etapa   = vendas FE × conversão
receita bruta  = Σ vendas_etapa × preço
CPA            = Σ vendas_etapa × CPA da etapa
fulfillment    = receita × % fulfillment
lucro funil    = receita − CPA − taxa plataforma − fulfillment − (reembolso + chargeback + alertas + taxas)
lucro final    = lucro funil + receita × % lucro do call center
```

Conferida com a planilha "BIFI - North Scale" (20/11/2026): realista −146.941,54; simulação +29.942,26
(`lib/services/funnelSimEngine.test.ts`).

## Real (fonte)

`GET /api/metrics/funnel-sim` lê `dados_oficiais.afiliados_pedidos` (publicação atual) + "Order" (produto, `fees`,
`cpaPaidUsd`), por plataforma × família do FE × dia do FE (safra) × etapa. JVZoo: dia de Nova York, etapa da gold
(`rawMetadata.etapa`). Vupim: dia de Brasília, etapa pelo `funnelStep` da Vupim (OTO N = N; Last Chance N = N+1).

- Conversão = vendas da etapa ÷ FEs da mesma safra; preço e CPA = médias por venda.
- Devoluções = previsão D60 (`r60_*`, safra fechada = real) ÷ vendido com previsão.
- Fulfillment = `custo_fs` ÷ receita dos funis achados no armazém da Full Stack. Sem nenhum: padrão de 9%.
- Taxa da plataforma = `fees` ÷ receita. Sem dado: padrão de 7,9%.
- Call center = `call_liquido` ÷ receita (atribuído ao FE mais recente do cliente; safra recente ainda recebe).

## Análises salvas

Tabela `FunnelSimulation` (nome, base, parâmetros, resumo). Quem tem a aba vê e salva; atualizar e apagar só quem
salvou ou admin. Rotas: `/api/funnel-sim/simulations` (GET, POST, PUT `?id=`, DELETE `?id=`).
