-- Aba VSLs: biblioteca de VSLs (VTurb), páginas do funil que recebem a VSL
-- pelo dash, testes A/B, histórico e rastreio das visitas (beacon do snippet).

-- CreateTable
CREATE TABLE "Vsl" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "scriptUrl" TEXT NOT NULL,
    "aspectPct" DECIMAL(7,3),
    "pitchSeconds" INTEGER NOT NULL,
    "notes" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vsl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VslPage" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "vslId" TEXT,
    "fallbackVslId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "previewVslId" TEXT,
    "previewUntil" TIMESTAMP(3),
    "installedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "lastSeenUrl" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VslPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VslTest" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "winnerVslId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VslTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VslTestArm" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "vslId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,

    CONSTRAINT "VslTestArm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VslChange" (
    "id" TEXT NOT NULL,
    "pageId" TEXT,
    "pageKey" TEXT,
    "vslId" TEXT,
    "testId" TEXT,
    "kind" TEXT NOT NULL,
    "fromVslId" TEXT,
    "toVslId" TEXT,
    "detail" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VslChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VslVisit" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "vslId" TEXT,
    "testId" TEXT,
    "armId" TEXT,
    "platform" TEXT NOT NULL,
    "sessionKey" TEXT,
    "pageUrl" TEXT,
    "firstAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "playAt" TIMESTAMP(3),
    "pitchAt" TIMESTAMP(3),
    "acceptAt" TIMESTAMP(3),
    "declineAt" TIMESTAMP(3),
    "maxSecond" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "VslVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Vsl_archived_idx" ON "Vsl"("archived");

-- CreateIndex
CREATE UNIQUE INDEX "VslPage_key_key" ON "VslPage"("key");

-- CreateIndex
CREATE UNIQUE INDEX "VslPage_family_stage_platform_key" ON "VslPage"("family", "stage", "platform");

-- CreateIndex
CREATE INDEX "VslTest_pageId_status_idx" ON "VslTest"("pageId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "VslTestArm_testId_label_key" ON "VslTestArm"("testId", "label");

-- CreateIndex
CREATE INDEX "VslChange_pageId_createdAt_idx" ON "VslChange"("pageId", "createdAt");

-- CreateIndex
CREATE INDEX "VslChange_createdAt_idx" ON "VslChange"("createdAt");

-- CreateIndex
CREATE INDEX "VslVisit_firstAt_idx" ON "VslVisit"("firstAt");

-- CreateIndex
CREATE INDEX "VslVisit_pageId_firstAt_idx" ON "VslVisit"("pageId", "firstAt");

-- CreateIndex
CREATE INDEX "VslVisit_vslId_firstAt_idx" ON "VslVisit"("vslId", "firstAt");

-- CreateIndex
CREATE INDEX "VslVisit_testId_armId_idx" ON "VslVisit"("testId", "armId");

-- CreateIndex
CREATE INDEX "VslVisit_sessionKey_idx" ON "VslVisit"("sessionKey");

-- AddForeignKey
ALTER TABLE "VslPage" ADD CONSTRAINT "VslPage_vslId_fkey" FOREIGN KEY ("vslId") REFERENCES "Vsl"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VslTest" ADD CONSTRAINT "VslTest_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "VslPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VslTestArm" ADD CONSTRAINT "VslTestArm_testId_fkey" FOREIGN KEY ("testId") REFERENCES "VslTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VslTestArm" ADD CONSTRAINT "VslTestArm_vslId_fkey" FOREIGN KEY ("vslId") REFERENCES "Vsl"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- No máximo um teste aberto (rodando ou pausado) por página.
CREATE UNIQUE INDEX "VslTest_one_open_per_page" ON "VslTest"("pageId") WHERE status IN ('running', 'paused');
