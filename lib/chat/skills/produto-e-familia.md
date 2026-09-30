---
name: produto-e-familia
title: Produto, SKU e família
when: "como está a família X", "qual SKU vende/reembolsa mais", desempenho de produto, catálogo, lançamento
first_tools: resolve_entities, get_families, get_products, get_funnel
version: 1
---
## Passos
1. resolve_entities com o nome citado → família canônica exata e/ou SKUs (externalId + plataforma). Nunca filtre com o nome livre.
2. Em paralelo: get_families (visão por família), get_products(families=[...]) (todos os SKUs com receita, pedidos, refund, CB, margem), get_funnel(families=[...]) (etapas da família).
3. Variação entre períodos: compare_periods(tool=get_products ou get_families). Ranking/filtro de SKUs sobre o $rN: aggregate_result.
4. Taxas por SKU (reembolso ÷ pedidos reais), participação → calc.

## Checagens obrigatórias
- Famílias parecidas são distintas: NeuroPulsePro ≠ NeuroMindPro (codename colide na BuyGoods).
- Cross-sell conta no funil da família do FE, não da família do produto.
- Reembolso por SKU: denominador = pedidos reais (Digistore desconta linhas extras).
- SKUs sem família (get_health.catalog.productsWithoutFamily) ficam fora do filtro por família — diga o volume se relevante.
- AOV de get_families usa a regra da aba Famílias e pode diferir do AOV do get_overview filtrado.

## Formato
- table por SKU (ou família): receita | pedidos | aprovação | reembolso | CB | margem.
- Veredito: o que puxa a família (SKU/etapa) com o número.
- scope com período, família e plataformas.
