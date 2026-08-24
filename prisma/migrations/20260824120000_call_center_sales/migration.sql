-- TaukSale vira CallCenterSale (multi-provider: Tauk + Logicall).
-- RENAME preserva todos os dados; índices renomeados pra bater com o que o
-- Prisma espera do nome novo do model.
ALTER TABLE "TaukSale" RENAME TO "CallCenterSale";
ALTER TABLE "CallCenterSale" RENAME CONSTRAINT "TaukSale_pkey" TO "CallCenterSale_pkey";
ALTER INDEX "TaukSale_externalKey_key" RENAME TO "CallCenterSale_externalKey_key";
ALTER INDEX "TaukSale_purchasedAt_idx" RENAME TO "CallCenterSale_purchasedAt_idx";
ALTER INDEX "TaukSale_email_idx" RENAME TO "CallCenterSale_email_idx";

-- Campos novos (todos opcionais/default — linhas Tauk existentes viram
-- provider='tauk', status='APPROVED').
ALTER TABLE "CallCenterSale"
  ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'tauk',
  ADD COLUMN "externalId" TEXT,
  ADD COLUMN "orderId" TEXT,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN "refundedAt" TIMESTAMP(3),
  ADD COLUMN "refundedUsd" DECIMAL(12, 2),
  ADD COLUMN "state" TEXT,
  ADD COLUMN "country" TEXT,
  ADD COLUMN "productName" TEXT,
  ADD COLUMN "productSku" TEXT,
  ADD COLUMN "family" TEXT,
  ADD COLUMN "bottles" INTEGER,
  ADD COLUMN "agentName" TEXT;

CREATE INDEX "CallCenterSale_provider_purchasedAt_idx" ON "CallCenterSale"("provider", "purchasedAt");

-- Config de integrações editável pela UI (chave Logicall, comissões).
CREATE TABLE "IntegrationSetting" (
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IntegrationSetting_pkey" PRIMARY KEY ("key")
);
