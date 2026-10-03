-- Gelazen na JVZoo é cross-sell do funil GlycoEden (não tem FE próprio lá;
-- a Digistore já nomeia "UP2 - Gelazen" / "DS2 - Gelazen"): Upgrade = Up02,
-- Last Chance = Down02. O classificador passou a ancorar o Gelazen JVZoo no
-- slot 2 (step 3) e a reconciliação da sessão usa max(âncora, posição).
--
-- Pedidos já gravados: quem recusou o 12B do Up01 e comprou o Gelazen tinha
-- a compra na posição 2 → contada como Up01 (23 sessões em 30 dias). Aqui
-- só sobe pra 3 o que está abaixo de 3 — é exatamente o que a reconciliação
-- faria com a âncora nova (posição maior que 3 já passava da âncora; a
-- recompra da mesma oferta reusa a etapa, então as duas linhas sobem juntas).
-- Só produto NÃO verificado: verificado tem etapa explícita e manda.

UPDATE "Order" o
SET "funnelStep" = 3
FROM "Product" pr, "Platform" pl
WHERE o."productId" = pr.id
  AND pr."platformId" = pl.id
  AND pl.slug = 'jvzoo'
  AND pr.family = 'Gelazen'
  AND pr.verified = false
  AND o."productType" IN ('UPSELL', 'DOWNSELL')
  AND (o."funnelStep" IS NULL OR o."funnelStep" < 3)
  AND (pr.name ILIKE '%(upgrade)%' OR pr.name ILIKE '%last chance%');

-- Memória do catálogo (Product.funnelStep) acompanha a âncora nova.
UPDATE "Product" pr
SET "funnelStep" = 3
FROM "Platform" pl
WHERE pr."platformId" = pl.id
  AND pl.slug = 'jvzoo'
  AND pr.family = 'Gelazen'
  AND pr.verified = false
  AND pr."productType" IN ('UPSELL', 'DOWNSELL')
  AND (pr."funnelStep" IS NULL OR pr."funnelStep" < 3)
  AND (pr.name ILIKE '%(upgrade)%' OR pr.name ILIKE '%last chance%');
