-- Origem do afiliado (indicação / instagram / plataforma / outro) no parceiro.

-- CreateEnum
CREATE TYPE "AffiliateOrigin" AS ENUM ('INDICACAO', 'INSTAGRAM', 'PLATAFORMA', 'OUTRO');

-- AlterTable
ALTER TABLE "AffiliatePartner"
    ADD COLUMN "originType" "AffiliateOrigin",
    ADD COLUMN "originRef" TEXT;
