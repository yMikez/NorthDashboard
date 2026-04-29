-- daily_metrics MV: bucket por dia em SÃO PAULO (não UTC).
--
-- Antes: DATE_TRUNC('day', orderedAt) bucketava em UTC. Pra um vendor
-- brasileiro, "hoje" no chart não batia com "hoje" no relatório de
-- transações: orders entre 21:00 BRT do dia X e 00:00 BRT do dia X+1
-- caíam em UTC X+1, criando um "deslocamento" de 3 horas.
--
-- Agora: orderedAt (stored as UTC by Prisma) é convertido pra wall
-- clock de America/Sao_Paulo antes do DATE_TRUNC. Bucket "Apr 28"
-- agora corresponde ao dia 28 BRT inteiro (Apr 28 03:00 UTC →
-- Apr 29 03:00 UTC).
--
-- Postgres MVs não têm ALTER ADD COLUMN; drop+recreate com REFRESH.

DROP MATERIALIZED VIEW IF EXISTS daily_metrics;

CREATE MATERIALIZED VIEW daily_metrics AS
SELECT
  DATE_TRUNC('day', (o."orderedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date AS day,
  pl."slug"                              AS platform,
  COALESCE(pr."family", '_unknown')      AS family,
  COALESCE(o."country", '_unknown')      AS country,
  o."productType"                        AS product_type,
  COUNT(*)                                                                                    AS total_count,
  COUNT(*) FILTER (WHERE o."status" = 'APPROVED')                                              AS approved_count,
  COUNT(*) FILTER (WHERE o."status" = 'REFUNDED')                                              AS refunded_count,
  COUNT(*) FILTER (WHERE o."status" = 'CHARGEBACK')                                            AS chargeback_count,
  COALESCE(SUM(o."grossAmountUsd")  FILTER (WHERE o."status" = 'APPROVED'), 0)::numeric(14,2)  AS gross,
  COALESCE(SUM(o."netAmountUsd")    FILTER (WHERE o."status" = 'APPROVED'), 0)::numeric(14,2)  AS net,
  COALESCE(SUM(o."cpaPaidUsd"), 0)::numeric(14,2)                                              AS cpa,
  COALESCE(SUM(o."cogsUsd"), 0)::numeric(14,2)                                                 AS cogs,
  COALESCE(SUM(o."fulfillmentUsd"), 0)::numeric(14,2)                                          AS fulfillment
FROM "Order" o
JOIN "Platform" pl ON o."platformId" = pl.id
JOIN "Product"  pr ON o."productId"  = pr.id
GROUP BY 1, 2, 3, 4, 5;

CREATE UNIQUE INDEX daily_metrics_pkey
  ON daily_metrics (day, platform, family, country, product_type);
CREATE INDEX daily_metrics_day_idx     ON daily_metrics (day);
CREATE INDEX daily_metrics_family_idx  ON daily_metrics (family);
CREATE INDEX daily_metrics_country_idx ON daily_metrics (country);

REFRESH MATERIALIZED VIEW daily_metrics;
