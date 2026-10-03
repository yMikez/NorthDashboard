-- Aba VSLs: regra por afiliado (página + afiliado → VSL) e o afiliado lido
-- em cada visita (JVZoo aid da URL; BuyGoods memória da página de vendas).

-- AlterTable
ALTER TABLE "VslChange" ADD COLUMN     "ruleId" TEXT;

-- AlterTable
ALTER TABLE "VslVisit" ADD COLUMN     "affiliateKey" TEXT;

-- CreateTable
CREATE TABLE "VslAffiliateRule" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "affiliateExternalId" TEXT NOT NULL,
    "vslId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VslAffiliateRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VslAffiliateRule_vslId_idx" ON "VslAffiliateRule"("vslId");

-- CreateIndex
CREATE UNIQUE INDEX "VslAffiliateRule_pageId_affiliateId_key" ON "VslAffiliateRule"("pageId", "affiliateId");

-- CreateIndex
CREATE INDEX "VslVisit_pageId_affiliateKey_idx" ON "VslVisit"("pageId", "affiliateKey");

-- AddForeignKey
ALTER TABLE "VslAffiliateRule" ADD CONSTRAINT "VslAffiliateRule_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "VslPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VslAffiliateRule" ADD CONSTRAINT "VslAffiliateRule_vslId_fkey" FOREIGN KEY ("vslId") REFERENCES "Vsl"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

