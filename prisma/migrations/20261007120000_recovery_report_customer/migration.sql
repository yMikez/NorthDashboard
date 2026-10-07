-- Backfill da recuperação que não chega por IPN (relatório "Customers" da
-- BuyGoods). Só md5 do e-mail — nenhum dado pessoal.
CREATE TABLE "RecoveryReportCustomer" (
    "id" TEXT NOT NULL,
    "platformSlug" TEXT NOT NULL,
    "affiliateName" TEXT NOT NULL,
    "partner" TEXT,
    "emailHash" TEXT NOT NULL,
    "lifetimeValueUsd" DECIMAL(12,2) NOT NULL,
    "balanceUsd" DECIMAL(12,2) NOT NULL,
    "createdFrom" DATE,
    "createdTo" DATE,
    "reportDate" DATE NOT NULL,
    "importBatch" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecoveryReportCustomer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecoveryReportCustomer_platformSlug_affiliateName_emailHash_key" ON "RecoveryReportCustomer"("platformSlug", "affiliateName", "emailHash");
CREATE INDEX "RecoveryReportCustomer_partner_idx" ON "RecoveryReportCustomer"("partner");
