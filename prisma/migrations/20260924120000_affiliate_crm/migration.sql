-- CRM de afiliados (WhatsApp): classificação por segmento, contato manual,
-- registro dos toques da régua e parâmetros configuráveis.
-- Disparo é manual por enquanto — aqui só mora a inteligência.

-- CreateEnum
CREATE TYPE "AffiliateTier" AS ENUM ('BASE', 'ASCENDENTE', 'NORTH');

-- AlterTable: espelho do contato/tier que o NorthScale Afiliados mandar
ALTER TABLE "affiliate_mapping_state" ADD COLUMN "phone" TEXT;
ALTER TABLE "affiliate_mapping_state" ADD COLUMN "tier" TEXT;

-- CreateTable
CREATE TABLE "AffiliateCrmProfile" (
    "crmKey" TEXT NOT NULL,
    "phone" TEXT,
    "tier" "AffiliateTier",
    "notes" TEXT,
    "optOut" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliateCrmProfile_pkey" PRIMARY KEY ("crmKey")
);

-- CreateTable
CREATE TABLE "AffiliateCrmTouch" (
    "id" TEXT NOT NULL,
    "crmKey" TEXT NOT NULL,
    "cycleKey" TEXT NOT NULL,
    "segment" TEXT NOT NULL,
    "touchpoint" TEXT NOT NULL,
    "tag" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateCrmTouch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmConfig" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "dormantDaysBase" INTEGER NOT NULL DEFAULT 7,
    "dormantDaysAscendente" INTEGER NOT NULL DEFAULT 5,
    "dormantDaysNorth" INTEGER NOT NULL DEFAULT 3,
    "coldDays" INTEGER NOT NULL DEFAULT 30,
    "ladderOffsets" INTEGER[] DEFAULT ARRAY[0, 4, 7, 14]::INTEGER[],
    "onboardingOffsets" INTEGER[] DEFAULT ARRAY[0, 1, 3, 5, 7, 10]::INTEGER[],
    "onboardingDays" INTEGER NOT NULL DEFAULT 10,
    "atRiskDropPct" DECIMAL(5,2) NOT NULL DEFAULT 40,
    "atRiskWeeks" INTEGER NOT NULL DEFAULT 4,
    "upgradeWeeks" INTEGER NOT NULL DEFAULT 3,
    "upgradeSalesAscendente" INTEGER NOT NULL DEFAULT 10,
    "upgradeSalesNorth" INTEGER NOT NULL DEFAULT 25,
    "tierCpaAscendenteMin" DECIMAL(10,2) NOT NULL DEFAULT 230,
    "tierCpaNorthMin" DECIMAL(10,2) NOT NULL DEFAULT 240,
    "minValueUsd" DECIMAL(10,2) NOT NULL DEFAULT 500,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateCrmTouch_crmKey_cycleKey_touchpoint_key" ON "AffiliateCrmTouch"("crmKey", "cycleKey", "touchpoint");
CREATE INDEX "AffiliateCrmTouch_crmKey_sentAt_idx" ON "AffiliateCrmTouch"("crmKey", "sentAt");
CREATE INDEX "AffiliateCrmTouch_sentAt_idx" ON "AffiliateCrmTouch"("sentAt");
