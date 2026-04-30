-- 1. Adiciona originalGrossUsd na Order
ALTER TABLE "Order" ADD COLUMN "originalGrossUsd" DECIMAL(12, 2);

-- 2. Backfill: pra todos os orders existentes preencher com ABS(grossAmountUsd).
--    Justificativa: orders APPROVED têm grossAmountUsd positivo (=> abs idem),
--    refunded/chargeback têm grossAmountUsd negativo (refund value), abs ≈
--    valor da venda original. Não é exato (CB taxa de processamento pode ter
--    pequena diferença), mas é a melhor aproximação retroativa que temos.
UPDATE "Order" SET "originalGrossUsd" = ABS("grossAmountUsd") WHERE "originalGrossUsd" IS NULL;

-- 3. Drop + recreate da MV pra incluir gross_original (sum de originalGrossUsd
--    sem filtro de status — conta toda venda originalmente realizada no dia,
--    igual ao "Gross Sale Amount" do Reporting Dashboard do CB).
DROP MATERIALIZED VIEW IF EXISTS daily_metrics;

CREATE MATERIALIZED VIEW daily_metrics AS
SELECT
  DATE_TRUNC('day', (o."orderedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date AS day,
  pl."slug"                              AS platform,
  COALESCE(pr."family", '_unknown')      AS family,
  COALESCE(o."country", '_unknown')      AS country,
  o."productType"                        AS product_type,
  COUNT(*)                                                                                       AS total_count,
  COUNT(*) FILTER (WHERE o."status" = 'APPROVED')                                                 AS approved_count,
  COUNT(*) FILTER (WHERE o."status" = 'REFUNDED')                                                 AS refunded_count,
  COUNT(*) FILTER (WHERE o."status" = 'CHARGEBACK')                                               AS chargeback_count,
  -- gross "ativo": só APPROVED (status atual) — comportamento original
  COALESCE(SUM(o."grossAmountUsd")  FILTER (WHERE o."status" = 'APPROVED'), 0)::numeric(14,2)     AS gross,
  -- gross_original: soma do valor inicial da venda independente do status
  -- atual. Inclui orders que depois foram refundadas/chargeback. CB-style.
  COALESCE(SUM(COALESCE(o."originalGrossUsd", ABS(o."grossAmountUsd"))), 0)::numeric(14,2)        AS gross_original,
  COALESCE(SUM(o."netAmountUsd")    FILTER (WHERE o."status" = 'APPROVED'), 0)::numeric(14,2)     AS net,
  COALESCE(SUM(o."cpaPaidUsd"), 0)::numeric(14,2)                                                 AS cpa,
  COALESCE(SUM(o."cogsUsd"), 0)::numeric(14,2)                                                    AS cogs,
  COALESCE(SUM(o."fulfillmentUsd"), 0)::numeric(14,2)                                             AS fulfillment
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
