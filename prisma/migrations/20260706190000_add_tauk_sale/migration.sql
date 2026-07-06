-- CreateTable
CREATE TABLE "TaukSale" (
    "id" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "email" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "amountUsd" DECIMAL(12,2) NOT NULL,
    "fulfillmentStatus" TEXT,
    "purchasedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "raw" JSONB,

    CONSTRAINT "TaukSale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaukSale_externalKey_key" ON "TaukSale"("externalKey");

-- CreateIndex
CREATE INDEX "TaukSale_purchasedAt_idx" ON "TaukSale"("purchasedAt");

-- CreateIndex
CREATE INDEX "TaukSale_email_idx" ON "TaukSale"("email");
