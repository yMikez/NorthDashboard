-- Teste A/B nas pesquisas (2026-10-28): SurveyExperiment + versão sorteada no convite.

-- AlterTable
ALTER TABLE "SurveyInvite" ADD COLUMN     "arm" TEXT,
ADD COLUMN     "experimentId" TEXT;

-- CreateTable
CREATE TABLE "SurveyExperiment" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "arms" JSONB NOT NULL,
    "winner" TEXT,
    "createdBy" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "SurveyExperiment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SurveyExperiment_variantId_startedAt_idx" ON "SurveyExperiment"("variantId", "startedAt");

-- CreateIndex
CREATE INDEX "SurveyInvite_experimentId_idx" ON "SurveyInvite"("experimentId");

-- AddForeignKey
ALTER TABLE "SurveyInvite" ADD CONSTRAINT "SurveyInvite_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "SurveyExperiment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyExperiment" ADD CONSTRAINT "SurveyExperiment_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "SurveyVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

