-- Allowance + transaction fee rates per platform (vendor-side). Manually
-- entered via admin UI; multiplied by period revenue to render
-- "Taxas pagas" e "Reservado em allowance" no card de cada plataforma.
--
-- Seed inicial: Digistore24 com valores observados pelo usuário
-- (transaction fee ~8.37% médio, allowance reserve ~2.37%). Outras
-- plataformas ficam null até o usuário preencher.

ALTER TABLE "Platform"
  ADD COLUMN "feeRatePct"    DECIMAL(5,2),
  ADD COLUMN "allowancePct"  DECIMAL(5,2),
  ADD COLUMN "feesUpdatedAt" TIMESTAMP(3);

UPDATE "Platform"
SET "feeRatePct" = 8.37,
    "allowancePct" = 2.37,
    "feesUpdatedAt" = NOW()
WHERE "slug" = 'digistore24';
