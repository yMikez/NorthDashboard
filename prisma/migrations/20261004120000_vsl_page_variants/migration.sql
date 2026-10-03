-- Aba VSLs: variantes por etapa (mesma família + etapa + plataforma com mais
-- de uma página, ex.: Upsell 1 de quem levou 6 potes × 2–3 potes).

-- DropIndex
DROP INDEX "VslPage_family_stage_platform_key";

-- AlterTable
ALTER TABLE "VslPage" ADD COLUMN     "feBottles" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "variant" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "VslPage_family_stage_platform_variant_key" ON "VslPage"("family", "stage", "platform", "variant");

