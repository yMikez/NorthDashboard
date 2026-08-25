-- Identidade unificada de afiliados (aba Análise de afiliados).
-- AffiliatePartner agrupa contas (uma por plataforma) da mesma pessoa;
-- Affiliate ganha partnerId, e-mail (JVZoo manda) e flag de interno.

-- CreateTable
CREATE TABLE "AffiliatePartner" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliatePartner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AffiliatePartner_email_idx" ON "AffiliatePartner"("email");

-- AlterTable
ALTER TABLE "Affiliate"
    ADD COLUMN "partnerId" TEXT,
    ADD COLUMN "email" TEXT,
    ADD COLUMN "isInternal" BOOLEAN;

-- CreateIndex
CREATE INDEX "Affiliate_partnerId_idx" ON "Affiliate"("partnerId");
CREATE INDEX "Affiliate_email_idx" ON "Affiliate"("email");

-- AddForeignKey
ALTER TABLE "Affiliate" ADD CONSTRAINT "Affiliate_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "AffiliatePartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
