-- AlterTable
ALTER TABLE "Order" ADD COLUMN "bottlesShipped" INTEGER;

-- Backfill: potes das orders existentes a partir do catálogo ATUAL
-- (bottles + bonusBottles do Product). Daqui em diante o upsertOrder
-- snapshota na ingestão; reclassificações futuras só entram no histórico
-- via backfill explícito (/api/admin/backfill-cogs).
UPDATE "Order" o
SET "bottlesShipped" = COALESCE(p."bottles", 0) + COALESCE(p."bonusBottles", 0)
FROM "Product" p
WHERE p."id" = o."productId";
