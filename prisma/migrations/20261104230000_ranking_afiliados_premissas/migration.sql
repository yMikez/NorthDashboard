-- Ranking de afiliados (aba Afiliados › Ranking): premissas compartilhadas + histórico.

-- CreateTable
CREATE TABLE "AffiliateScoreConfig" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "params" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "AffiliateScoreConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateScoreConfigLog" (
    "id" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "changedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateScoreConfigLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AffiliateScoreConfigLog_createdAt_idx" ON "AffiliateScoreConfigLog"("createdAt");
