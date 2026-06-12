-- Histórico de taxas de comissão dos afiliados de recuperação. Cada venda é
-- comissionada pela taxa VIGENTE no orderedAt dela (effectiveFrom <= t <
-- effectiveTo; effectiveTo NULL = vigente). Mudar a % fecha o período aberto
-- e abre um novo — vendas antigas mantêm a taxa antiga.

CREATE TABLE "RecoveryRatePeriod" (
    "id" TEXT NOT NULL,
    "recoveryAffiliateId" TEXT NOT NULL,
    "commissionPct" DECIMAL(5,4) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecoveryRatePeriod_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RecoveryRatePeriod_recoveryAffiliateId_effectiveFrom_idx"
    ON "RecoveryRatePeriod"("recoveryAffiliateId", "effectiveFrom");

ALTER TABLE "RecoveryRatePeriod"
    ADD CONSTRAINT "RecoveryRatePeriod_recoveryAffiliateId_fkey"
    FOREIGN KEY ("recoveryAffiliateId") REFERENCES "RecoveryAffiliate"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: 1 período vigente por afiliado já marcado, com a taxa atual,
-- desde a epoch (cobre vendas anteriores à marcação — semântica que o
-- cálculo on-the-fly sempre teve).
INSERT INTO "RecoveryRatePeriod" ("id", "recoveryAffiliateId", "commissionPct", "effectiveFrom", "effectiveTo")
SELECT 'rrp_' || md5(id || random()::text), "id", "commissionPct", TIMESTAMP '1970-01-01 00:00:00', NULL
FROM "RecoveryAffiliate";
