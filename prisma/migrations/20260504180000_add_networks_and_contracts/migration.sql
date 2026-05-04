-- Networks feature: sub-affiliate program with per-FE-sale commissions,
-- periodic payouts, versioned contracts (PDF), and partner-scoped users.

-- ============================================================
-- ENUMS
-- ============================================================

-- Add NETWORK_PARTNER to existing UserRole enum.
ALTER TYPE "UserRole" ADD VALUE 'NETWORK_PARTNER';

-- New enums for networks domain.
CREATE TYPE "NetworkStatus" AS ENUM ('ACTIVE', 'PAUSED');
CREATE TYPE "CommissionType" AS ENUM ('FIXED', 'PERCENT');
CREATE TYPE "PaymentPeriodUnit" AS ENUM ('DAYS', 'WEEKS', 'MONTHS');
CREATE TYPE "CommissionStatus" AS ENUM ('ACCRUED', 'PAID');
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PAID');
CREATE TYPE "AuditEntityType" AS ENUM ('NETWORK', 'NETWORK_PAYOUT', 'NETWORK_AFFILIATE', 'NETWORK_CONTRACT');

-- ============================================================
-- ALTER User: networkId FK (only for NETWORK_PARTNER role)
-- ============================================================

ALTER TABLE "User" ADD COLUMN "networkId" TEXT;

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE "Network" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "NetworkStatus" NOT NULL DEFAULT 'ACTIVE',
    "commissionType" "CommissionType" NOT NULL,
    "commissionValue" DECIMAL(10,4) NOT NULL,
    "paymentPeriodValue" INTEGER NOT NULL,
    "paymentPeriodUnit" "PaymentPeriodUnit" NOT NULL DEFAULT 'DAYS',
    "contractStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "billingEmail" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Network_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NetworkAffiliate" (
    "id" TEXT NOT NULL,
    "networkId" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "attachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attachedByUserId" TEXT,

    CONSTRAINT "NetworkAffiliate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NetworkCommission" (
    "id" TEXT NOT NULL,
    "networkId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "amountUsd" DECIMAL(12,4) NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'ACCRUED',
    "commissionType" "CommissionType" NOT NULL,
    "commissionValue" DECIMAL(10,4) NOT NULL,
    "payoutId" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NetworkCommission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NetworkPayout" (
    "id" TEXT NOT NULL,
    "networkId" TEXT NOT NULL,
    "totalUsd" DECIMAL(12,4) NOT NULL,
    "commissionsCount" INTEGER NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "paidByUserId" TEXT,
    "paymentMethod" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NetworkPayout_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NetworkContract" (
    "id" TEXT NOT NULL,
    "networkId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "contentMd" TEXT NOT NULL,
    "pdfPath" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3),
    "signedByUserId" TEXT,
    "signatureIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NetworkContract_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NetworkAuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "entityType" "AuditEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NetworkAuditLog_pkey" PRIMARY KEY ("id")
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE UNIQUE INDEX "Network_slug_key" ON "Network"("slug");
CREATE INDEX "Network_status_idx" ON "Network"("status");

CREATE UNIQUE INDEX "NetworkAffiliate_affiliateId_key" ON "NetworkAffiliate"("affiliateId");
CREATE UNIQUE INDEX "NetworkAffiliate_networkId_affiliateId_key" ON "NetworkAffiliate"("networkId", "affiliateId");
CREATE INDEX "NetworkAffiliate_networkId_idx" ON "NetworkAffiliate"("networkId");

CREATE UNIQUE INDEX "NetworkCommission_orderId_key" ON "NetworkCommission"("orderId");
CREATE INDEX "NetworkCommission_networkId_status_idx" ON "NetworkCommission"("networkId", "status");
CREATE INDEX "NetworkCommission_networkId_createdAt_idx" ON "NetworkCommission"("networkId", "createdAt");
CREATE INDEX "NetworkCommission_payoutId_idx" ON "NetworkCommission"("payoutId");

CREATE INDEX "NetworkPayout_networkId_periodEnd_idx" ON "NetworkPayout"("networkId", "periodEnd");
CREATE INDEX "NetworkPayout_status_idx" ON "NetworkPayout"("status");

CREATE UNIQUE INDEX "NetworkContract_networkId_version_key" ON "NetworkContract"("networkId", "version");
CREATE INDEX "NetworkContract_networkId_idx" ON "NetworkContract"("networkId");

CREATE INDEX "NetworkAuditLog_entityType_entityId_idx" ON "NetworkAuditLog"("entityType", "entityId");
CREATE INDEX "NetworkAuditLog_createdAt_idx" ON "NetworkAuditLog"("createdAt");

-- ============================================================
-- FOREIGN KEYS
-- ============================================================

ALTER TABLE "User" ADD CONSTRAINT "User_networkId_fkey"
  FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NetworkAffiliate" ADD CONSTRAINT "NetworkAffiliate_networkId_fkey"
  FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NetworkAffiliate" ADD CONSTRAINT "NetworkAffiliate_affiliateId_fkey"
  FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NetworkCommission" ADD CONSTRAINT "NetworkCommission_networkId_fkey"
  FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NetworkCommission" ADD CONSTRAINT "NetworkCommission_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NetworkCommission" ADD CONSTRAINT "NetworkCommission_affiliateId_fkey"
  FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NetworkCommission" ADD CONSTRAINT "NetworkCommission_payoutId_fkey"
  FOREIGN KEY ("payoutId") REFERENCES "NetworkPayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NetworkPayout" ADD CONSTRAINT "NetworkPayout_networkId_fkey"
  FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NetworkPayout" ADD CONSTRAINT "NetworkPayout_paidByUserId_fkey"
  FOREIGN KEY ("paidByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NetworkContract" ADD CONSTRAINT "NetworkContract_networkId_fkey"
  FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NetworkContract" ADD CONSTRAINT "NetworkContract_signedByUserId_fkey"
  FOREIGN KEY ("signedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NetworkAuditLog" ADD CONSTRAINT "NetworkAuditLog_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
