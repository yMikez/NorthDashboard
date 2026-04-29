-- Backfill one-shot: corrige timestamps de Digistore que foram parseados
-- como UTC mas vieram em Europe/Berlin (CEST = UTC+2). Bug afetou todas
-- as orders Digistore desde o início da operação até o commit que arruma
-- o parser (lib/connectors/digistore24/ingest.ts).
--
-- Estratégia: detectar a offset correto pra cada order baseado em quando
-- ela foi criada. Tudo desde Mar 29, 2026 (last Sun de mar = início do CEST)
-- até Oct 25, 2026 (last Sun de out = fim do CEST) é -2h.
-- Antes de Mar 29 e depois de Oct 25 seria CET = -1h.
--
-- Como a operação começou em meados de abril 2026, todas as orders
-- existentes estão dentro do CEST window — aplicamos -2h em tudo.
--
-- IMPORTANTE: roda só uma vez (Prisma migrate deploy é idempotente).

DO $$
DECLARE
  digistore_id TEXT;
  affected INTEGER;
BEGIN
  SELECT id INTO digistore_id FROM "Platform" WHERE slug = 'digistore24';
  IF digistore_id IS NULL THEN
    RAISE NOTICE 'No digistore24 platform — skipping backfill';
    RETURN;
  END IF;

  UPDATE "Order"
  SET
    "orderedAt"    = "orderedAt"    - INTERVAL '2 hours',
    "approvedAt"   = CASE WHEN "approvedAt"   IS NOT NULL THEN "approvedAt"   - INTERVAL '2 hours' END,
    "refundedAt"   = CASE WHEN "refundedAt"   IS NOT NULL THEN "refundedAt"   - INTERVAL '2 hours' END,
    "chargebackAt" = CASE WHEN "chargebackAt" IS NOT NULL THEN "chargebackAt" - INTERVAL '2 hours' END
  WHERE "platformId" = digistore_id;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'Digistore CEST backfill: %.', affected || ' orders updated';
END $$;

-- Refresh MV pra repropagar os timestamps corrigidos pra daily_metrics.
REFRESH MATERIALIZED VIEW daily_metrics;
