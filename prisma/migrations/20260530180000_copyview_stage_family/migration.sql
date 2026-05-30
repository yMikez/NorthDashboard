-- Copy Optimizer (pré-cutover): adiciona stage + family em CopyView pro
-- funnel-renderer carimbar a etapa do funil e a família do produto em cada
-- view. Precisa existir ANTES do renderer ir ao ar — senão as primeiras
-- views ficam sem essas dimensões. Aditivo, nullable, sem backfill.

-- AlterTable
ALTER TABLE "CopyView" ADD COLUMN "stage" TEXT;
ALTER TABLE "CopyView" ADD COLUMN "family" TEXT;

-- CreateIndex
CREATE INDEX "CopyView_stage_shownAt_idx" ON "CopyView"("stage", "shownAt");

-- CreateIndex
CREATE INDEX "CopyView_family_shownAt_idx" ON "CopyView"("family", "shownAt");
