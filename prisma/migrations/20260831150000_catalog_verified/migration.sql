-- Catálogo VERIFICADO (2026-08-31): identidade do SKU ancorada no banco,
-- imune a rename de vendor. Aditivo — zero rewrite de linhas existentes.
ALTER TABLE "Product"
  ADD COLUMN "verified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "verifiedAt" TIMESTAMP(3),
  ADD COLUMN "verifiedBy" TEXT,
  ADD COLUMN "nameAtVerification" TEXT,
  ADD COLUMN "funnelStep" INTEGER,
  ADD COLUMN "comboComponents" JSONB;

ALTER TABLE "Order"
  ADD COLUMN "classificationPending" BOOLEAN NOT NULL DEFAULT false;

-- Índice parcial: a fila de pendências é minúscula comparada à tabela.
CREATE INDEX "Order_classificationPending_idx"
  ON "Order"("classificationPending") WHERE "classificationPending" = true;

CREATE TABLE "FamilyAlias" (
  "alias" TEXT NOT NULL,
  "family" TEXT NOT NULL,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FamilyAlias_pkey" PRIMARY KEY ("alias")
);
