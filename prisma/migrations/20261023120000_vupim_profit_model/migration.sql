-- Vupim no modelo de lucro (decisão do usuário, 2026-10-23). Antes entrava
-- com 0% de taxa e 0% de reembolso no Net after CPA.
--   taxa: 9,99% — a taxa REAL que a Vupim informa em cada venda
--         (data.fees.platformFee); igual nas 66 primeiras vendas.
--   reembolso: 15% manual (o mesmo padrão das outras plataformas) até a
--         Vupim ter coorte madura — aí o modelo passa a usar a taxa real
--         sozinho (REAL_REFUND_RATE_PLATFORMS em profitModel.ts).
-- Só preenche o que está vazio: valor já cadastrado na tela não é sobrescrito.
UPDATE "Platform"
SET "feeRatePct" = COALESCE("feeRatePct", 9.99),
    "refundCbPct" = COALESCE("refundCbPct", 15),
    "feesUpdatedAt" = now()
WHERE slug = 'vupim' AND ("feeRatePct" IS NULL OR "refundCbPct" IS NULL);
