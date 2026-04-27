-- Materialized view: daily_metrics
--
-- Pre-aggregates Order data along the dimensions the dashboard's overview/
-- platforms/byCountry/byProductType queries need. Saves a full-table
-- findMany() + JS-side reduction on every request. Refresh is decoupled
-- from writes (REFRESH MATERIALIZED VIEW CONCURRENTLY) so updates don't
-- block reads.
--
-- Granularity: (day, platform, family, country, productType). Status is
-- not a dim — instead pre-computed per-status counts/sums via FILTER.
--
-- NULLs collapsed to '_unknown' so the unique index works without
-- Postgres-15+ NULLS NOT DISTINCT.

CREATE MATERIALIZED VIEW IF NOT EXISTS daily_metrics AS
SELECT
  DATE_TRUNC('day', o."orderedAt")::date AS day,
  pl."slug"                              AS platform,
  COALESCE(pr."family", '_unknown')      AS family,
  COALESCE(o."country", '_unknown')      AS country,
  o."productType"                        AS product_type,
  COUNT(*)                                                                                AS total_count,
  COUNT(*) FILTER (WHERE o."status" = 'APPROVED')                                          AS approved_count,
  COUNT(*) FILTER (WHERE o."status" = 'REFUNDED')                                          AS refunded_count,
  COUNT(*) FILTER (WHERE o."status" = 'CHARGEBACK')                                        AS chargeback_count,
  COALESCE(SUM(o."grossAmountUsd") FILTER (WHERE o."status" = 'APPROVED'), 0)::numeric(14,2) AS gross,
  COALESCE(SUM(o."netAmountUsd")   FILTER (WHERE o."status" = 'APPROVED'), 0)::numeric(14,2) AS net,
  COALESCE(SUM(o."cpaPaidUsd"), 0)::numeric(14,2)                                          AS cpa
FROM "Order" o
JOIN "Platform" pl ON o."platformId" = pl.id
JOIN "Product"  pr ON o."productId"  = pr.id
GROUP BY 1, 2, 3, 4, 5;

-- Required for REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX IF NOT EXISTS daily_metrics_pkey
  ON daily_metrics (day, platform, family, country, product_type);

-- Most queries filter by day range; secondary indexes for common slices.
CREATE INDEX IF NOT EXISTS daily_metrics_day_idx     ON daily_metrics (day);
CREATE INDEX IF NOT EXISTS daily_metrics_family_idx  ON daily_metrics (family);
CREATE INDEX IF NOT EXISTS daily_metrics_country_idx ON daily_metrics (country);
