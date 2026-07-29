-- AlterTable: override manual de refund&cb% por afiliado (modelo CPA).
-- NULL = herda o refundCbPct da plataforma (default global).
ALTER TABLE "Affiliate" ADD COLUMN "refundCbPctOverride" DECIMAL(5,2);
