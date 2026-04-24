-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "productType" "ProductType" NOT NULL DEFAULT 'FRONTEND';

-- Backfill: populate Order.productType from existing Product.productType so that
-- the catalog-level classification is preserved as the initial per-order value.
-- Subsequent ingestions write per-order productType directly. Pre-existing orders
-- of misclassified products (e.g. NeuroMindPro-6-FE-vs2 stuck as UPSELL) keep the
-- legacy classification until they're re-ingested or manually corrected.
UPDATE "Order" SET "productType" = p."productType"
FROM "Product" p
WHERE "Order"."productId" = p."id";
