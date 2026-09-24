-- API de parceiro (SendTrace): metas de reembolso/chargeback configuráveis no
-- dash (fonte única pros dois lados) + índice pro pull incremental por updatedAt.

-- AlterTable
ALTER TABLE "ProfitConfig" ADD COLUMN "refundTargetD30Pct" DECIMAL(5,2) NOT NULL DEFAULT 10;
ALTER TABLE "ProfitConfig" ADD COLUMN "refundLimitD30Pct" DECIMAL(5,2) NOT NULL DEFAULT 18;
ALTER TABLE "ProfitConfig" ADD COLUMN "chargebackWarnPct" DECIMAL(5,2) NOT NULL DEFAULT 0.5;
ALTER TABLE "ProfitConfig" ADD COLUMN "chargebackLimitPct" DECIMAL(5,2) NOT NULL DEFAULT 0.9;

-- CreateIndex
CREATE INDEX "Order_updatedAt_idx" ON "Order"("updatedAt");
