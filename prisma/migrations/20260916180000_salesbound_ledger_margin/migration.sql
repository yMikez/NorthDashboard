-- Lucro real: histórico de premissas + razão de transações da SalesBound
-- (import do export CSV do CRM deles).

-- CreateTable
CREATE TABLE "NetProfitParamsLog" (
    "id" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "changes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "NetProfitParamsLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NetProfitParamsLog_createdAt_idx" ON "NetProfitParamsLog"("createdAt");

-- Snapshot inicial: as premissas vigentes viram a 1ª entrada do histórico,
-- datadas de quando foram salvas.
INSERT INTO "NetProfitParamsLog" ("id", "params", "changes", "createdAt", "createdById")
SELECT 'initial-' || "id", "params", '[]'::jsonb, "updatedAt", "updatedById" FROM "NetProfitParams";

-- CreateTable
CREATE TABLE "SalesboundTransaction" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "amountUsd" DECIMAL(12,2) NOT NULL,
    "txnAt" TIMESTAMP(3) NOT NULL,
    "saleAt" TIMESTAMP(3),
    "chargedback" BOOLEAN NOT NULL DEFAULT false,
    "agentName" TEXT,
    "customerId" TEXT,
    "email" TEXT,
    "sourcePlatform" TEXT,
    "merchant" TEXT,
    "response" TEXT,
    "items" JSONB NOT NULL,
    "family" TEXT,
    "bottles" INTEGER,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesboundTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesboundTransaction_transactionId_key" ON "SalesboundTransaction"("transactionId");
CREATE INDEX "SalesboundTransaction_txnAt_idx" ON "SalesboundTransaction"("txnAt");
CREATE INDEX "SalesboundTransaction_saleAt_idx" ON "SalesboundTransaction"("saleAt");
CREATE INDEX "SalesboundTransaction_orderId_idx" ON "SalesboundTransaction"("orderId");
