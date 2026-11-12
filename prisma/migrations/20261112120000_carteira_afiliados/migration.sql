-- Carteira de afiliados (2026-11-12): função do usuário na equipe de captação
-- (Gerente > Squad Leader > Hunter), dono da pessoa afiliada, histórico de
-- trocas de dono e pedidos de reivindicação. Só acrescenta colunas/tabelas.

-- CreateEnum
CREATE TYPE "AffiliateClaimStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELED');

-- CreateEnum
CREATE TYPE "PortfolioRole" AS ENUM ('AFF_MANAGER', 'SQUAD_LEADER', 'HUNTER');

-- AlterTable
ALTER TABLE "AffiliatePartner" ADD COLUMN     "ownerSince" TIMESTAMP(3),
ADD COLUMN     "ownerUserId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "portfolioParentId" TEXT,
ADD COLUMN     "portfolioRole" "PortfolioRole",
ADD COLUMN     "region" TEXT;

-- CreateTable
CREATE TABLE "AffiliateOwnershipEvent" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "fromUserId" TEXT,
    "toUserId" TEXT,
    "byUserId" TEXT,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateOwnershipEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateClaim" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "note" TEXT,
    "status" "AffiliateClaimStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decisionNote" TEXT,

    CONSTRAINT "AffiliateClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AffiliateOwnershipEvent_partnerId_at_idx" ON "AffiliateOwnershipEvent"("partnerId", "at");

-- CreateIndex
CREATE INDEX "AffiliateOwnershipEvent_toUserId_idx" ON "AffiliateOwnershipEvent"("toUserId");

-- CreateIndex
CREATE INDEX "AffiliateClaim_status_idx" ON "AffiliateClaim"("status");

-- CreateIndex
CREATE INDEX "AffiliateClaim_partnerId_idx" ON "AffiliateClaim"("partnerId");

-- CreateIndex
CREATE INDEX "AffiliateClaim_userId_idx" ON "AffiliateClaim"("userId");

-- CreateIndex
CREATE INDEX "AffiliatePartner_ownerUserId_idx" ON "AffiliatePartner"("ownerUserId");

-- AddForeignKey
ALTER TABLE "AffiliatePartner" ADD CONSTRAINT "AffiliatePartner_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateOwnershipEvent" ADD CONSTRAINT "AffiliateOwnershipEvent_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "AffiliatePartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateClaim" ADD CONSTRAINT "AffiliateClaim_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "AffiliatePartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_portfolioParentId_fkey" FOREIGN KEY ("portfolioParentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

