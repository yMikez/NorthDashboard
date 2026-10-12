-- lead_summary ganha POTES e ESTOQUE (pedido do usuário, 2026-10-12): todo
-- pote tem 30 cápsulas, 1 por dia → 30 dias de produto por pote, em todos os
-- produtos. Resto idêntico a 20261009150000_customer_phone.
--
-- Potes por fonte (regra espelhada em lib/services/leadStock.ts):
--   funil      — potes ENVIADOS do pedido (snapshot Order.bottlesShipped, com
--                bônus; sem snapshot, o catálogo do produto). Pedido estornado
--                conta (o produto foi enviado); a linha extra de estorno da
--                Digistore não.
--   callcenter — Logicall manda os potes; a Tauk não → estimado pelo valor
--                (faixas da Logicall: <120→1, <182→2, <250→3, <345→6, resto 12)
--                e marcado como estimado.
--   salesbound — item a item ("X - 1 Bottle" × qty), cada um na sua família;
--                venda anulada (void) fica fora.
--
-- Estoque por PRODUTO (família): compras do mesmo produto se somam em fila —
-- acaba em max_k(data_k + 30 dias × potes da compra k em diante). Produtos
-- diferentes correm em paralelo; stock_until do lead = quando o ÚLTIMO acaba.
DROP MATERIALIZED VIEW IF EXISTS lead_summary;

CREATE MATERIALIZED VIEW lead_summary AS
WITH ev AS (
  SELECT lower(trim(c.email)) AS email,
         o."orderedAt" AS at,
         'funil'::text AS channel,
         pl.slug AS platform,
         o."affiliateId" AS affiliate_id,
         pr.family AS family,
         pr.name AS product,
         o.country AS country,
         NULLIF(trim(concat_ws(' ', c."firstName", c."lastName")), '') AS name,
         c.phone AS phone,
         CASE WHEN pl.slug = 'digistore24' AND o.status IN ('REFUNDED', 'CHARGEBACK') THEN 0
              ELSE COALESCE(o."originalGrossUsd", ABS(o."grossAmountUsd")) END AS sale,
         CASE WHEN o.status IN ('REFUNDED', 'CHARGEBACK') THEN
           CASE WHEN pl.slug = 'digistore24' THEN ABS(o."grossAmountUsd")
                ELSE LEAST(ABS(o."grossAmountUsd"), ABS(COALESCE(o."originalGrossUsd", o."grossAmountUsd"))) END
         ELSE 0 END AS refunded
  FROM "Order" o
  JOIN "Customer" c ON c.id = o."customerId"
  JOIN "Platform" pl ON pl.id = o."platformId"
  JOIN "Product" pr ON pr.id = o."productId"
  WHERE c.email LIKE '%@%' AND o.status IN ('APPROVED', 'REFUNDED', 'CHARGEBACK')
  UNION ALL
  SELECT lower(trim(s.email)), s."purchasedAt", 'callcenter', s.provider, NULL, s.family, s."productName", s.country,
         NULLIF(trim(concat_ws(' ', s."firstName", s."lastName")), ''),
         CASE WHEN length(regexp_replace(regexp_replace(s.phone, '\D', '', 'g'), '^00', '')) BETWEEN 7 AND 15
              THEN regexp_replace(regexp_replace(s.phone, '\D', '', 'g'), '^00', '') END,
         s."amountUsd",
         CASE WHEN s.status IN ('REFUNDED', 'CHARGEBACK') THEN COALESCE(s."refundedUsd", s."amountUsd")
              ELSE COALESCE(s."refundedUsd", 0) END
  FROM "CallCenterSale" s
  WHERE s.email LIKE '%@%'
  UNION ALL
  SELECT lower(trim(t.email)), t."txnAt", 'salesbound', 'salesbound', NULL, t.family, t.items->0->>'name', NULL, NULL, t.phone,
         CASE WHEN t.type = 'SALE' THEN t."amountUsd" ELSE 0 END,
         CASE WHEN t.type IN ('REFUND', 'VOID') THEN t."amountUsd" ELSE 0 END
  FROM "SalesboundTransaction" t
  WHERE t.result = 'SUCCESS' AND t.type IN ('SALE', 'REFUND', 'VOID') AND t.email LIKE '%@%'
),
evf AS (
  SELECT ev.*, MIN(at) FILTER (WHERE sale > 0) OVER (PARTITION BY email) AS f
  FROM ev
),
agg AS (
  SELECT email,
         MIN(at) FILTER (WHERE sale > 0) AS first_at,
         MAX(at) FILTER (WHERE sale > 0) AS last_at,
         COUNT(*) FILTER (WHERE sale > 0)::int AS purchases,
         COUNT(DISTINCT ((at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date) FILTER (WHERE sale > 0)::int AS purchase_days,
         ROUND(SUM(sale)::numeric, 2) AS gross_usd,
         ROUND(SUM(refunded)::numeric, 2) AS refunded_usd,
         ROUND(COALESCE(SUM(sale - refunded) FILTER (WHERE channel = 'funil'), 0)::numeric, 2) AS funnel_usd,
         ROUND(COALESCE(SUM(sale - refunded) FILTER (WHERE channel = 'callcenter'), 0)::numeric, 2) AS callcenter_usd,
         ROUND(COALESCE(SUM(sale - refunded) FILTER (WHERE channel = 'salesbound'), 0)::numeric, 2) AS salesbound_usd,
         ROUND(COALESCE(SUM(sale - refunded) FILTER (WHERE at < f + interval '24 hours'), 0)::numeric, 2) AS ltv_24h,
         ROUND(COALESCE(SUM(sale - refunded) FILTER (WHERE at < f + interval '30 days'), 0)::numeric, 2) AS ltv_30d,
         ROUND(COALESCE(SUM(sale - refunded) FILTER (WHERE at < f + interval '90 days'), 0)::numeric, 2) AS ltv_90d,
         ROUND(COALESCE(SUM(sale - refunded) FILTER (WHERE at < f + interval '180 days'), 0)::numeric, 2) AS ltv_180d,
         (array_agg(channel ORDER BY at, sale DESC) FILTER (WHERE sale > 0))[1] AS origin_channel,
         (array_agg(platform ORDER BY at, sale DESC) FILTER (WHERE sale > 0))[1] AS origin_platform,
         (array_agg(affiliate_id ORDER BY at, sale DESC) FILTER (WHERE sale > 0))[1] AS origin_affiliate_id,
         (array_agg(family ORDER BY at, sale DESC) FILTER (WHERE sale > 0))[1] AS origin_family,
         (array_agg(product ORDER BY at, sale DESC) FILTER (WHERE sale > 0))[1] AS origin_product,
         (array_agg(country ORDER BY at, sale DESC) FILTER (WHERE sale > 0 AND country IS NOT NULL))[1] AS country,
         (array_agg(name ORDER BY at DESC) FILTER (WHERE name IS NOT NULL))[1] AS name,
         (array_agg(phone ORDER BY at DESC) FILTER (WHERE phone IS NOT NULL))[1] AS phone,
         array_agg(DISTINCT channel) AS channels,
         array_agg(DISTINCT platform) AS platforms,
         COALESCE(array_agg(DISTINCT family) FILTER (WHERE family IS NOT NULL), ARRAY[]::text[]) AS families
  FROM evf
  GROUP BY email
  HAVING COUNT(*) FILTER (WHERE sale > 0) > 0
),
bev AS (
  SELECT lower(trim(c.email)) AS email,
         COALESCE(NULLIF(trim(pr.family), ''), '—') AS family,
         o."orderedAt" AS at,
         COALESCE(NULLIF(o."bottlesShipped", 0), COALESCE(pr.bottles, 0) + COALESCE(pr."bonusBottles", 0)) AS bottles,
         false AS estimated
  FROM "Order" o
  JOIN "Customer" c ON c.id = o."customerId"
  JOIN "Platform" pl ON pl.id = o."platformId"
  JOIN "Product" pr ON pr.id = o."productId"
  WHERE c.email LIKE '%@%' AND o.status IN ('APPROVED', 'REFUNDED', 'CHARGEBACK')
    AND NOT (pl.slug = 'digistore24' AND o.status IN ('REFUNDED', 'CHARGEBACK'))
  UNION ALL
  SELECT lower(trim(s.email)), COALESCE(NULLIF(trim(s.family), ''), '—'), s."purchasedAt",
         CASE WHEN COALESCE(s.bottles, 0) > 0 THEN s.bottles
              WHEN s."amountUsd" <= 0 THEN 0
              WHEN s."amountUsd" < 120 THEN 1
              WHEN s."amountUsd" < 182 THEN 2
              WHEN s."amountUsd" < 250 THEN 3
              WHEN s."amountUsd" < 345 THEN 6
              ELSE 12 END,
         COALESCE(s.bottles, 0) = 0
  FROM "CallCenterSale" s
  WHERE s.email LIKE '%@%'
  UNION ALL
  SELECT lower(trim(t.email)), COALESCE(NULLIF(trim(i->>'family'), ''), '—'), t."txnAt",
         ROUND(COALESCE(NULLIF(i->>'qty', '')::numeric, 0) * COALESCE(NULLIF(i->>'bottles', '')::numeric, 1))::int,
         false
  FROM "SalesboundTransaction" t
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(t.items) = 'array' THEN t.items ELSE '[]'::jsonb END) i
  WHERE t.result = 'SUCCESS' AND t.type = 'SALE' AND t.email LIKE '%@%'
    AND NOT EXISTS (
      SELECT 1 FROM "SalesboundTransaction" v
      WHERE v."orderId" = t."orderId" AND v.type = 'VOID' AND v.result = 'SUCCESS'
    )
),
bfam AS (
  SELECT email, family, at, bottles, estimated,
         SUM(bottles) OVER (PARTITION BY email, family ORDER BY at ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING) AS suffix
  FROM bev
  WHERE bottles > 0
),
bstock AS (
  SELECT email, family,
         SUM(bottles)::int AS bottles,
         COALESCE(SUM(bottles) FILTER (WHERE estimated), 0)::int AS est_bottles,
         MAX(at + make_interval(days => (30 * suffix)::int)) AS stock_until
  FROM bfam
  GROUP BY email, family
),
blead AS (
  SELECT email,
         SUM(bottles)::int AS bottles,
         SUM(est_bottles)::int AS bottles_estimated,
         MAX(stock_until) AS stock_until,
         (array_agg(family ORDER BY stock_until DESC))[1] AS stock_family
  FROM bstock
  GROUP BY email
)
SELECT agg.*,
       ROUND(gross_usd - refunded_usd, 2) AS ltv_usd,
       COALESCE(blead.bottles, 0) AS bottles,
       COALESCE(blead.bottles_estimated, 0) AS bottles_estimated,
       blead.stock_until,
       blead.stock_family,
       now() AS computed_at
FROM agg
LEFT JOIN blead USING (email);

CREATE UNIQUE INDEX lead_summary_email_idx ON lead_summary (email);
CREATE INDEX lead_summary_first_at_idx ON lead_summary (first_at);
CREATE INDEX lead_summary_last_at_idx ON lead_summary (last_at);
CREATE INDEX lead_summary_ltv_idx ON lead_summary (ltv_usd);
CREATE INDEX lead_summary_stock_until_idx ON lead_summary (stock_until);
