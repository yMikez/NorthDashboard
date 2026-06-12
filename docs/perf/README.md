# Performance — baseline e otimizações (2026-06-12)

## Baseline de produção (antes das otimizações)

Capturada com `scripts/perf-baseline.sh` contra https://dash.thenorthscales.com
(arquivo: `baseline-2026-06-12-prod.txt`). Mediana de 5 runs, `total=` em segundos:

| Endpoint   | 7d    | 30d   | 90d   |
|------------|-------|-------|-------|
| overview   | 0.43  | 0.77  | 0.66  |
| funnel     | 1.28  | 3.32  | 4.44  |
| products   | 3.15  | 10.80 | 11.37 |
| platforms  | 1.14  | 2.96  | 5.04  |
| affiliates | 6.01  | 11.17 | 11.31 |
| orders     | 0.88  | 0.85  | 0.85  |

Diagnóstico: `affiliates` e `products` buscavam TODAS as orders do período e
agregavam em JS (O(orders) por request); refresh da MV `daily_metrics` era
awaited inline na primeira request a cada 60s; zero caching em qualquer camada;
frontend transpilava ~11k linhas de JSX no browser via Babel standalone.

## O que mudou

- **A.1** Índices compostos em `Order`: `(platformId, orderedAt)`,
  `(status, orderedAt)`, `(productType, status, orderedAt)`,
  `(country, orderedAt)`; removido `(status)` solto.
  Migration `20260612130000_add_order_composite_indexes`.
- **A.2** Refresh da MV fora do caminho crítico: stale-while-revalidate no
  `getOverview` + `scheduleDailyMetricsRefresh()` (debounce 15s) chamado no
  fim de `upsertOrder()`. Backstop recomendado: cron n8n chamando
  `POST /api/admin/refresh-metrics` a cada 5 min.
- **A.3** `Promise.all` em getOverview/getAffiliates/getAffiliateDetail/
  getPlatforms/getOverviewLegacy.
- **A.4** Queries duplicadas fundidas (getProducts 2×findMany → 1;
  getOrders 2×groupBy → 1 groupBy composto).
- **A.5** `fetchOrders` com select explícito (não traz mais `rawMetadata`).
- **A.6** N+1 do getAffiliateDetail → `aggregate` por plataforma em paralelo.
- **C.1** Cache in-process de sessão (TTL 30s; invalidação no signout e nas
  mutações de admin/users) — elimina 1 query Postgres de todo request autenticado.
- **C.2** Cache de resposta por querystring (TTL 30s) em 15 rotas
  `/api/metrics/*` via `respondCached()`; invalidado a cada refresh da MV.
- **C.3** Timing estruturado por endpoint nos logs (`metrics.timing`).
- **B** `getAffiliates` e `getProducts` com pushdown SQL (CTEs com
  `DISTINCT ON` pra session attribution) atrás da flag
  `METRICS_SQL_ATTRIBUTION` (default ON; `=0` volta pra legacy sem deploy).
  Prova de paridade: `npx tsx scripts/parityCheck.ts` (gate de merge).
- **D** Frontend: JSX pré-compilado em build time (`scripts/build-spa.mjs`,
  esbuild → `public/dist/`), React production self-hosted em `public/vendor/`,
  Babel standalone removido, formatters Intl memoizados, cache client-side de
  GETs (TTL 15s) com dedup de requests em voo, 3,6MB de fonts mortas removidas.

## Como re-medir

```bash
COOKIE='ns_session=<valor>' BASE='https://dash.thenorthscales.com' \
  bash scripts/perf-baseline.sh > docs/perf/after-$(date +%F)-prod.txt
```

Comparar com `baseline-2026-06-12-prod.txt`. O outlier "1ª request após idle"
(refresh da MV inline) deve desaparecer; `affiliates`/`products` devem cair de
~11s pra sub-segundo; segunda request idêntica em <50ms (cache hit).
