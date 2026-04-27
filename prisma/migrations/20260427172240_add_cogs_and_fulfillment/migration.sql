-- AlterTable
ALTER TABLE "Order"
  ADD COLUMN "cogsUsd" DECIMAL(10, 2),
  ADD COLUMN "fulfillmentUsd" DECIMAL(10, 2);

-- AlterTable
ALTER TABLE "Product"
  ADD COLUMN "bonusBottles" INTEGER;

-- CreateTable
CREATE TABLE "ProductFamilyCost" (
  "family"      TEXT NOT NULL,
  "unitCostUsd" DECIMAL(10, 4) NOT NULL,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductFamilyCost_pkey" PRIMARY KEY ("family")
);

-- CreateTable
CREATE TABLE "FulfillmentRate" (
  "bottlesMax" INTEGER NOT NULL,
  "priceUsd"   DECIMAL(10, 2) NOT NULL,
  "label"      TEXT NOT NULL,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FulfillmentRate_pkey" PRIMARY KEY ("bottlesMax")
);

-- Seed initial values matching the supplier price sheet (New Price column)
INSERT INTO "ProductFamilyCost" ("family", "unitCostUsd", "updatedAt") VALUES
  ('ThermoBurnPro',  2.5400, NOW()),
  ('NeuroMindPro',   3.0800, NOW()),
  ('MaxVitalize',    2.4800, NOW()),
  ('GlycoPulse',     2.3300, NOW())
ON CONFLICT ("family") DO NOTHING;

INSERT INTO "FulfillmentRate" ("bottlesMax", "priceUsd", "label", "updatedAt") VALUES
  (2,  6.64, '0 to 2.99 oz',  NOW()),
  (3,  6.74, '3 to 3.99 oz',  NOW()),
  (4,  7.10, '4 to 4.99 oz',  NOW()),
  (5,  7.14, '5 to 5.99 oz',  NOW()),
  (6,  7.68, '6 to 6.99 oz',  NOW()),
  (7,  7.83, '7 to 7.99 oz',  NOW()),
  (8,  8.66, '8 to 8.99 oz',  NOW()),
  (9,  8.96, '9 to 9.99 oz',  NOW()),
  (10, 9.35, '10 to 10.99 oz', NOW()),
  (11, 9.62, '11 to 11.99 oz', NOW()),
  (12, 9.72, '12 to 12.99 oz', NOW())
ON CONFLICT ("bottlesMax") DO NOTHING;
