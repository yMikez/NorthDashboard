-- Per-SKU fulfillment supplier override. NULL = inherit from
-- ProductFamilyCost.fulfillmentSupplier (current behavior). Set to
-- 'redrock' / 'shipoffers' to override per individual SKU.
ALTER TABLE "Product" ADD COLUMN "fulfillmentSupplier" TEXT;
