-- Multi-supplier fulfillment: RedRock vs ShipOffers.
-- Roteamento: NeuroMind + funil (NightCalm, FlexImmuneGuard) = redrock;
-- demais famílias = shipoffers. Preços do PDF "Comparativo RR vs SO".
-- Frete = ship+fee+pick + packaging + paper (RR) / + fuel surcharge (SO),
-- SEM o custo do pote (esse fica em ProductFamilyCost.unitCostUsd).

-- 1) ProductFamilyCost: coluna de fornecedor + custo unitário por fornecedor
ALTER TABLE "ProductFamilyCost"
  ADD COLUMN "fulfillmentSupplier" TEXT NOT NULL DEFAULT 'shipoffers';

-- Famílias RedRock (funil NeuroMind). Unit cost RR do PDF (COGNITIVE = 2.41).
-- NightCalm/FlexImmuneGuard não estão no PDF — usam 2.41 como placeholder.
INSERT INTO "ProductFamilyCost" ("family", "unitCostUsd", "fulfillmentSupplier", "updatedAt") VALUES
  ('NeuroMindPro',    2.4100, 'redrock',    NOW()),
  ('NightCalm',       2.4100, 'redrock',    NOW()),
  ('FlexImmuneGuard', 2.4100, 'redrock',    NOW())
ON CONFLICT ("family") DO UPDATE
  SET "unitCostUsd" = EXCLUDED."unitCostUsd",
      "fulfillmentSupplier" = EXCLUDED."fulfillmentSupplier",
      "updatedAt" = NOW();

-- Famílias ShipOffers. Unit cost SO do PDF.
INSERT INTO "ProductFamilyCost" ("family", "unitCostUsd", "fulfillmentSupplier", "updatedAt") VALUES
  ('ThermoBurnPro', 2.5400, 'shipoffers', NOW()),
  ('MaxVitalize',   2.4800, 'shipoffers', NOW()),
  ('GlycoPulse',    2.3300, 'shipoffers', NOW())
ON CONFLICT ("family") DO UPDATE
  SET "unitCostUsd" = EXCLUDED."unitCostUsd",
      "fulfillmentSupplier" = EXCLUDED."fulfillmentSupplier",
      "updatedAt" = NOW();

-- 2) FulfillmentRate: novo PK composto (supplier, family, bottlesMax).
-- Drop + recreate (mudança de PK é destrutiva). Dados anteriores eram
-- a tabela flat antiga, substituídos pelo seed do PDF.
DROP TABLE "FulfillmentRate";

CREATE TABLE "FulfillmentRate" (
  "supplier"   TEXT NOT NULL,
  "family"     TEXT NOT NULL,
  "bottlesMax" INTEGER NOT NULL,
  "priceUsd"   DECIMAL(10, 2) NOT NULL,
  "label"      TEXT NOT NULL,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FulfillmentRate_pkey" PRIMARY KEY ("supplier", "family", "bottlesMax")
);
CREATE INDEX "FulfillmentRate_supplier_family_bottlesMax_idx"
  ON "FulfillmentRate"("supplier", "family", "bottlesMax");

-- RedRock — schedule é FLAT entre blends no PDF (ship+pkg+paper).
-- 1:6.29+0.38+0.12  2:6.92+0.38+0.12  3:7.18+0.38+0.12
-- 4:7.45+0.38+0.12  5:8.30+0.39+0.12  6:9.43+0.67+0.12
-- 999 = 7+ potes (combos), conservador no preço de 6.
INSERT INTO "FulfillmentRate" ("supplier","family","bottlesMax","priceUsd","label","updatedAt") VALUES
  ('redrock','_default',1,6.79,'1 pote',NOW()),
  ('redrock','_default',2,7.42,'2 potes',NOW()),
  ('redrock','_default',3,7.68,'3 potes',NOW()),
  ('redrock','_default',4,7.95,'4 potes',NOW()),
  ('redrock','_default',5,8.81,'5 potes',NOW()),
  ('redrock','_default',6,10.22,'6 potes',NOW()),
  ('redrock','_default',999,10.22,'7+ potes',NOW()),
  ('redrock','NeuroMindPro',1,6.79,'1 pote',NOW()),
  ('redrock','NeuroMindPro',2,7.42,'2 potes',NOW()),
  ('redrock','NeuroMindPro',3,7.68,'3 potes',NOW()),
  ('redrock','NeuroMindPro',4,7.95,'4 potes',NOW()),
  ('redrock','NeuroMindPro',5,8.81,'5 potes',NOW()),
  ('redrock','NeuroMindPro',6,10.22,'6 potes',NOW()),
  ('redrock','NeuroMindPro',999,10.22,'7+ potes',NOW()),
  ('redrock','NightCalm',1,6.79,'1 pote',NOW()),
  ('redrock','NightCalm',2,7.42,'2 potes',NOW()),
  ('redrock','NightCalm',3,7.68,'3 potes',NOW()),
  ('redrock','NightCalm',4,7.95,'4 potes',NOW()),
  ('redrock','NightCalm',5,8.81,'5 potes',NOW()),
  ('redrock','NightCalm',6,10.22,'6 potes',NOW()),
  ('redrock','NightCalm',999,10.22,'7+ potes',NOW()),
  ('redrock','FlexImmuneGuard',1,6.79,'1 pote',NOW()),
  ('redrock','FlexImmuneGuard',2,7.42,'2 potes',NOW()),
  ('redrock','FlexImmuneGuard',3,7.68,'3 potes',NOW()),
  ('redrock','FlexImmuneGuard',4,7.95,'4 potes',NOW()),
  ('redrock','FlexImmuneGuard',5,8.81,'5 potes',NOW()),
  ('redrock','FlexImmuneGuard',6,10.22,'6 potes',NOW()),
  ('redrock','FlexImmuneGuard',999,10.22,'7+ potes',NOW());

-- ShipOffers — varia por blend (ship+addItem+pkg+fuel+bubble; addItem/bubble=0).
-- pkg: 0.21 (1-5), 0.32 (6). fuel: 0.50 flat.
-- WEIGHT LOSS = ThermoBurnPro | TESTOSTERONE = MaxVitalize | BLOOD SUGAR = GlycoPulse
INSERT INTO "FulfillmentRate" ("supplier","family","bottlesMax","priceUsd","label","updatedAt") VALUES
  ('shipoffers','_default',1,7.35,'1 pote',NOW()),
  ('shipoffers','_default',2,7.45,'2 potes',NOW()),
  ('shipoffers','_default',3,7.85,'3 potes',NOW()),
  ('shipoffers','_default',4,8.39,'4 potes',NOW()),
  ('shipoffers','_default',5,9.37,'5 potes',NOW()),
  ('shipoffers','_default',6,10.17,'6 potes',NOW()),
  ('shipoffers','_default',999,10.17,'7+ potes',NOW()),
  ('shipoffers','ThermoBurnPro',1,7.35,'1 pote',NOW()),
  ('shipoffers','ThermoBurnPro',2,7.45,'2 potes',NOW()),
  ('shipoffers','ThermoBurnPro',3,7.85,'3 potes',NOW()),
  ('shipoffers','ThermoBurnPro',4,8.39,'4 potes',NOW()),
  ('shipoffers','ThermoBurnPro',5,9.37,'5 potes',NOW()),
  ('shipoffers','ThermoBurnPro',6,10.17,'6 potes',NOW()),
  ('shipoffers','ThermoBurnPro',999,10.17,'7+ potes',NOW()),
  ('shipoffers','MaxVitalize',1,7.35,'1 pote',NOW()),
  ('shipoffers','MaxVitalize',2,7.45,'2 potes',NOW()),
  ('shipoffers','MaxVitalize',3,7.85,'3 potes',NOW()),
  ('shipoffers','MaxVitalize',4,8.39,'4 potes',NOW()),
  ('shipoffers','MaxVitalize',5,9.37,'5 potes',NOW()),
  ('shipoffers','MaxVitalize',6,10.17,'6 potes',NOW()),
  ('shipoffers','MaxVitalize',999,10.17,'7+ potes',NOW()),
  ('shipoffers','GlycoPulse',1,7.35,'1 pote',NOW()),
  ('shipoffers','GlycoPulse',2,7.45,'2 potes',NOW()),
  ('shipoffers','GlycoPulse',3,7.85,'3 potes',NOW()),
  ('shipoffers','GlycoPulse',4,8.54,'4 potes',NOW()),
  ('shipoffers','GlycoPulse',5,9.67,'5 potes',NOW()),
  ('shipoffers','GlycoPulse',6,10.44,'6 potes',NOW()),
  ('shipoffers','GlycoPulse',999,10.44,'7+ potes',NOW());
