-- Copy Optimizer (Fase 0): regras de exposição da copy Black 2 + log de views
-- + audit do auto-tune. Não toca em nenhum model existente.

-- CreateTable
CREATE TABLE "AffiliateCopyRule" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "keyType" TEXT NOT NULL,
    "black2Pct" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "autotune" BOOLEAN NOT NULL DEFAULT false,
    "minPct" INTEGER NOT NULL DEFAULT 0,
    "maxPct" INTEGER NOT NULL DEFAULT 80,
    "stepPct" INTEGER NOT NULL DEFAULT 5,
    "targetAov" DECIMAL(10,2),
    "updatedBy" TEXT NOT NULL DEFAULT 'manual',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateCopyRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopyView" (
    "id" BIGSERIAL NOT NULL,
    "orderIdGlobal" TEXT NOT NULL,
    "layer" TEXT NOT NULL,
    "affId" TEXT,
    "affName" TEXT,
    "bucket" INTEGER,
    "pageUrl" TEXT,
    "referrer" TEXT,
    "sessid2" TEXT,
    "shownAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CopyView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutotuneLog" (
    "id" BIGSERIAL NOT NULL,
    "ruleId" TEXT NOT NULL,
    "pctBefore" INTEGER NOT NULL,
    "pctAfter" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "metrics" JSONB NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutotuneLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateCopyRule_key_key" ON "AffiliateCopyRule"("key");

-- CreateIndex
CREATE INDEX "AffiliateCopyRule_enabled_autotune_idx" ON "AffiliateCopyRule"("enabled", "autotune");

-- CreateIndex
CREATE INDEX "CopyView_orderIdGlobal_idx" ON "CopyView"("orderIdGlobal");

-- CreateIndex
CREATE INDEX "CopyView_affName_shownAt_idx" ON "CopyView"("affName", "shownAt");

-- CreateIndex
CREATE INDEX "CopyView_affId_shownAt_idx" ON "CopyView"("affId", "shownAt");

-- CreateIndex
CREATE INDEX "CopyView_layer_shownAt_idx" ON "CopyView"("layer", "shownAt");

-- CreateIndex
CREATE INDEX "AutotuneLog_ruleId_decidedAt_idx" ON "AutotuneLog"("ruleId", "decidedAt");

-- AddForeignKey
ALTER TABLE "AutotuneLog" ADD CONSTRAINT "AutotuneLog_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AffiliateCopyRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
