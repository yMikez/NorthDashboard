-- Backfill one-shot: corrige timestamps de BuyGoods que foram parseados como
-- UTC mas vieram em America/New_York (Eastern). Bug afetou todas as orders
-- BuyGoods desde o início da operação até o commit que arruma o parser
-- (lib/connectors/buygoods/ingest.ts + lib/shared/datetime.ts).
--
-- Confirmado com payload real: rr_createdate "11:43" (Eastern) para uma venda
-- que ocorreu 12:43 BRT (= 15:43 UTC). Tratada como UTC, ficou 4h adiantada.
--
-- Offset: Eastern é EDT (UTC-4) entre Mar 8 e Nov 1 de 2026. A operação começou
-- em meados de abril/2026, então TODAS as orders existentes estão na janela EDT
-- → corrigimos +4h (somamos as 4h que faltavam pra chegar no UTC real).
-- (Se houvesse orders no inverno seria EST = +5h, mas não há.)
--
-- IMPORTANTE: roda só uma vez (Prisma migrate deploy é idempotente). Deve ir
-- junto com o deploy do parser corrigido — novas orders já entram em UTC certo.

DO $$
DECLARE
  buygoods_id TEXT;
  affected INTEGER;
BEGIN
  SELECT id INTO buygoods_id FROM "Platform" WHERE slug = 'buygoods';
  IF buygoods_id IS NULL THEN
    RAISE NOTICE 'No buygoods platform — skipping backfill';
    RETURN;
  END IF;

  UPDATE "Order"
  SET
    "orderedAt"    = "orderedAt"    + INTERVAL '4 hours',
    "approvedAt"   = CASE WHEN "approvedAt"   IS NOT NULL THEN "approvedAt"   + INTERVAL '4 hours' END,
    "refundedAt"   = CASE WHEN "refundedAt"   IS NOT NULL THEN "refundedAt"   + INTERVAL '4 hours' END,
    "chargebackAt" = CASE WHEN "chargebackAt" IS NOT NULL THEN "chargebackAt" + INTERVAL '4 hours' END
  WHERE "platformId" = buygoods_id;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'BuyGoods Eastern backfill: %.', affected || ' orders updated';
END $$;

-- Refresh MV pra repropagar os timestamps corrigidos pra daily_metrics.
REFRESH MATERIALIZED VIEW daily_metrics;
