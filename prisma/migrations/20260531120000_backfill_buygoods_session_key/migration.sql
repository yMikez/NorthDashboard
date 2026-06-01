-- Backfill one-shot: corrige a chave de sessão das orders BuyGoods.
--
-- O order_id_global do BuyGoods é ÚNICO POR TRANSAÇÃO (FE e cada upsell ganham
-- um novo), então o funnelSessionId tinha sido preenchido com ele e NÃO agrupa
-- a sessão. O verdadeiro identificador é o sessid2 (compartilhado por FE +
-- upsells da mesma sessão; 100% das orders BG têm). Aqui resetamos
-- funnelSessionId = sessid2 do rawMetadata. parentExternalId fica intacto
-- (= order_id_global, usado pelo Copy Optimizer pra casar o FE).
--
-- Pareado com o forward-fix em lib/connectors/buygoods/ingest.ts. O backfill de
-- Order.productType (Last Chance → DOWNSELL), o REFRESH da MV e o rebalance de
-- fulfillment rodam no script scripts/backfillBuygoodsSessions.ts (pós-deploy).

UPDATE "Order" o
SET "funnelSessionId" = NULLIF(btrim(o."rawMetadata"->>'sessid2'), '')
FROM "Platform" pl
WHERE o."platformId" = pl.id
  AND pl."slug" = 'buygoods'
  AND NULLIF(btrim(o."rawMetadata"->>'sessid2'), '') IS NOT NULL;
