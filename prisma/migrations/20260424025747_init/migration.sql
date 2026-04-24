-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('FRONTEND', 'UPSELL', 'DOWNSELL', 'BUMP');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'APPROVED', 'REFUNDED', 'CHARGEBACK', 'CANCELED');

-- CreateEnum
CREATE TYPE "BillingType" AS ENUM ('SINGLE_PAYMENT', 'INSTALLMENT', 'SUBSCRIPTION', 'UNKNOWN');

-- CreateTable
CREATE TABLE "Platform" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Platform_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "productType" "ProductType" NOT NULL,
    "funnelPosition" INTEGER,
    "parentProductId" TEXT,
    "costOfGoods" DECIMAL(10,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Affiliate" (
    "id" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "nickname" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastOrderAt" TIMESTAMP(3),

    CONSTRAINT "Affiliate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "email" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "language" TEXT,
    "country" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastOrderAt" TIMESTAMP(3),

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "parentExternalId" TEXT,
    "previousTransactionId" TEXT,
    "vendorAccount" TEXT,
    "productId" TEXT NOT NULL,
    "affiliateId" TEXT,
    "customerId" TEXT,
    "currencyOriginal" TEXT NOT NULL,
    "grossAmountOrig" DECIMAL(12,2) NOT NULL,
    "grossAmountUsd" DECIMAL(12,2) NOT NULL,
    "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "fees" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netAmountUsd" DECIMAL(12,2) NOT NULL,
    "cpaPaidUsd" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "OrderStatus" NOT NULL,
    "eventType" TEXT NOT NULL,
    "billingType" "BillingType" NOT NULL DEFAULT 'UNKNOWN',
    "paySequenceNo" INTEGER,
    "numberOfInstallments" INTEGER,
    "paymentMethod" TEXT,
    "country" TEXT,
    "state" TEXT,
    "city" TEXT,
    "funnelSessionId" TEXT,
    "funnelStep" INTEGER,
    "clickId" TEXT,
    "trackingId" TEXT,
    "campaignKey" TEXT,
    "trafficSource" TEXT,
    "deviceType" TEXT,
    "browser" TEXT,
    "detailsUrl" TEXT,
    "orderedAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "chargebackAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "rawMetadata" JSONB,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FxRate" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "base" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "rate" DECIMAL(12,6) NOT NULL,

    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestLog" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "platformSlug" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "externalId" TEXT,
    "payload" JSONB NOT NULL,
    "signatureOk" BOOLEAN,
    "processedOk" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "IngestLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Platform_slug_key" ON "Platform"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Product_platformId_externalId_key" ON "Product"("platformId", "externalId");

-- CreateIndex
CREATE INDEX "Affiliate_lastOrderAt_idx" ON "Affiliate"("lastOrderAt");

-- CreateIndex
CREATE UNIQUE INDEX "Affiliate_platformId_externalId_key" ON "Affiliate"("platformId", "externalId");

-- CreateIndex
CREATE INDEX "Customer_email_idx" ON "Customer"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_platformId_externalId_key" ON "Customer"("platformId", "externalId");

-- CreateIndex
CREATE INDEX "Order_orderedAt_idx" ON "Order"("orderedAt");

-- CreateIndex
CREATE INDEX "Order_affiliateId_orderedAt_idx" ON "Order"("affiliateId", "orderedAt");

-- CreateIndex
CREATE INDEX "Order_productId_orderedAt_idx" ON "Order"("productId", "orderedAt");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_funnelSessionId_idx" ON "Order"("funnelSessionId");

-- CreateIndex
CREATE INDEX "Order_parentExternalId_idx" ON "Order"("parentExternalId");

-- CreateIndex
CREATE INDEX "Order_vendorAccount_orderedAt_idx" ON "Order"("vendorAccount", "orderedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_platformId_externalId_key" ON "Order"("platformId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "FxRate_date_base_quote_key" ON "FxRate"("date", "base", "quote");

-- CreateIndex
CREATE INDEX "IngestLog_platformSlug_receivedAt_idx" ON "IngestLog"("platformSlug", "receivedAt");

-- CreateIndex
CREATE INDEX "IngestLog_processedOk_idx" ON "IngestLog"("processedOk");

-- CreateIndex
CREATE INDEX "IngestLog_externalId_idx" ON "IngestLog"("externalId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_parentProductId_fkey" FOREIGN KEY ("parentProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Affiliate" ADD CONSTRAINT "Affiliate_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
