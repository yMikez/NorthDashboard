-- Afiliado de recuperação (SMS/email recovery) + % de comissão. Seção
-- "Recuperação". Não toca em models existentes.

CREATE TABLE "RecoveryAffiliate" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "commissionPct" DECIMAL(5,4) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecoveryAffiliate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecoveryAffiliate_affiliateId_key" ON "RecoveryAffiliate"("affiliateId");
CREATE INDEX "RecoveryAffiliate_enabled_idx" ON "RecoveryAffiliate"("enabled");

ALTER TABLE "RecoveryAffiliate" ADD CONSTRAINT "RecoveryAffiliate_affiliateId_fkey"
  FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
