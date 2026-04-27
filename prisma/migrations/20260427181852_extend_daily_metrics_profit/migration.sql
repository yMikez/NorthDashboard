-- Extend daily_metrics MV with COGS + fulfillment columns so profit can be
-- computed from the same single MV path used by getOverview.
--
-- Postgres MVs don't support ALTER ADD COLUMN, so we DROP + CREATE. Drop
-- is safe because the MV is a derived projection — REFRESH after recreate
-- repopulates from base tables.

DROP MATERIALIZED VIEW IF EXISTS daily_metrics;

CREATE MATERIALIZED VIEW daily_metrics AS
SELECT
  DATE_TRUNC('day', o."orderedAt")::date AS day,
  pl."slug"                              AS platform,
  COALESCE(pr."family", '_unknown')      AS family,
  COALESCE(o."country", '_unknown')      AS country,
  o."productType"                        AS product_type,
  COUNT(*)                                                                                  AS total_count,
  COUNT(*) FILTER (WHERE o."status" = 'APPROVED')                                            AS approved_count,
  COUNT(*) FILTER (WHERE o."status" = 'REFUNDED')                                            AS refunded_count,
  COUNT(*) FILTER (WHERE o."status" = 'CHARGEBACK')                                          AS chargeback_count,
  COALESCE(SUM(o."grossAmountUsd")  FILTER (WHERE o."status" = 'APPROVED'), 0)::numeric(14,2) AS gross,
  COALESCE(SUM(o."netAmountUsd")    FILTER (WHERE o."status" = 'APPROVED'), 0)::numeric(14,2) AS net,
  COALESCE(SUM(o."cpaPaidUsd"), 0)::numeric(14,2)                                            AS cpa,
  -- Costs we incurred regardless of status (refunded orders still cost us
  -- production + shipping). Sum these unfiltered.
  COALESCE(SUM(o."cogsUsd"), 0)::numeric(14,2)                                               AS cogs,
  COALESCE(SUM(o."fulfillmentUsd"), 0)::numeric(14,2)                                        AS fulfillment
FROM "Order" o
JOIN "Platform" pl ON o."platformId" = pl.id
JOIN "Product"  pr ON o."productId"  = pr.id
GROUP BY 1, 2, 3, 4, 5;

CREATE UNIQUE INDEX daily_metrics_pkey
  ON daily_metrics (day, platform, family, country, product_type);
CREATE INDEX daily_metrics_day_idx     ON daily_metrics (day);
CREATE INDEX daily_metrics_family_idx  ON daily_metrics (family);
CREATE INDEX daily_metrics_country_idx ON daily_metrics (country);

-- Initial populate (REFRESH MATERIALIZED VIEW would also work).
REFRESH MATERIALIZED VIEW daily_metrics;
