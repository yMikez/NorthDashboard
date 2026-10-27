-- Vupim (2026-10-27): upsell de outro produto virava "família" própria no Funil.
--
-- 1) Família: o nome é "<loja/funil> - <oferta>" e o classificador juntava as
--    duas num combo ("NeuroRecall + DigestFlow"). A família é a do produto
--    entregue (como na BuyGoods: "DigestFlow 6 Bottles (Upgrade)" = DigestFlow).
--    Só produto NÃO verificado — o catálogo verificado é a autoridade.
UPDATE "Product" p
SET family = CASE p.family
    WHEN 'NeuroRecall + DigestFlow' THEN 'DigestFlow'
    WHEN 'NeuroRecall + NightCalm' THEN 'NightCalm'
    WHEN 'GlycoEden + Gelazen' THEN 'Gelazen'
  END
FROM "Platform" pl
WHERE pl.id = p."platformId" AND pl.slug = 'vupim' AND NOT p.verified
  AND p.family IN ('NeuroRecall + DigestFlow', 'NeuroRecall + NightCalm', 'GlycoEden + Gelazen');

-- Potes: "6 Potes" não era lido como quantidade.
UPDATE "Product" p
SET bottles = substring(p.name FROM '(\d+)\s*[Pp]otes?')::int
FROM "Platform" pl
WHERE pl.id = p."platformId" AND pl.slug = 'vupim' AND NOT p.verified
  AND p.bottles IS NULL AND p.name ~* '\d+\s*potes?';

-- 2) Sessão: do 3º passo em diante o checkout abre outra sessão; o pedido
--    aponta pro passo anterior em rawMetadata.parentTransactionId. Upsell e
--    downsell herdam a sessão do pai, subindo a corrente até o front (no
--    máximo 3 níveis hoje; o laço para quando nada muda). Só ~400 linhas da
--    Vupim; o pai é achado pelo índice único (platformId, externalId).
DO $$
DECLARE
  vupim text;
  n int;
  i int := 0;
BEGIN
  SELECT id INTO vupim FROM "Platform" WHERE slug = 'vupim';
  IF vupim IS NULL THEN RETURN; END IF;
  LOOP
    UPDATE "Order" c
    SET "parentExternalId" = p."parentExternalId",
        "funnelSessionId" = COALESCE(p."funnelSessionId", p."parentExternalId")
    FROM "Order" p
    WHERE c."platformId" = vupim
      AND c."productType" IN ('UPSELL', 'DOWNSELL')
      AND c."rawMetadata" ? 'parentTransactionId'
      AND p."platformId" = vupim
      AND p."externalId" = c."rawMetadata"->>'parentTransactionId'
      AND p."externalId" <> c."externalId"
      AND p."parentExternalId" IS NOT NULL
      AND c."parentExternalId" IS DISTINCT FROM p."parentExternalId";
    GET DIAGNOSTICS n = ROW_COUNT;
    i := i + 1;
    EXIT WHEN n = 0 OR i >= 10;
  END LOOP;
END $$;
