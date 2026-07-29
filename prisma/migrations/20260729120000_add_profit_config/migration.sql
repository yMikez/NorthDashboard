-- AlterTable: taxa manual de refund+chargeback por plataforma (modelo CPA;
-- PERCENTUAL como feeRatePct/allowancePct: 15.00 = 15%)
ALTER TABLE "Platform" ADD COLUMN "refundCbPct" DECIMAL(5,2);

-- CreateTable: config global do modelo de lucro (singleton)
CREATE TABLE "ProfitConfig" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "opexPct" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "healthyMinUsd" DECIMAL(10,2) NOT NULL DEFAULT 10,
    "attentionMinUsd" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfitConfig_pkey" PRIMARY KEY ("id")
);

-- Seed do singleton com os valores da planilha CPA (opex 10%, régua 10/0).
INSERT INTO "ProfitConfig" ("id", "opexPct", "healthyMinUsd", "attentionMinUsd", "updatedAt")
VALUES ('global', 10, 10, 0, CURRENT_TIMESTAMP);

-- Refund&CB inicial das plataformas com o valor da planilha (15%) — o
-- admin calibra depois na página Plataformas com a taxa observada ao lado.
UPDATE "Platform" SET "refundCbPct" = 15;
