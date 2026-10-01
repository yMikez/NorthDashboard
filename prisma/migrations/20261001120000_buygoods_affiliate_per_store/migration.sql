-- BuyGoods numera os afiliados POR LOJA (account_id): o aff_id 62 da loja
-- 12595 é o Nicolas Yago Zapora, o 62 da 12610 é o Marco Cunha, o 62 da
-- 13457 é a MailX. A conta do dash era só o aff_id e somava pessoas
-- diferentes (auditoria 2026-10-01: 18 contas misturadas, 1.919 vendas /
-- US$ 449 mil creditadas à pessoa errada). A conta passa a ser `aff_id@loja`
-- (lib/connectors/buygoods/affiliateKey.ts) e o histórico é separado aqui.
--
-- Regras:
--   - toda conta BuyGoods com pedido vira `aff_id@loja`;
--   - conta com pedidos em várias lojas: a loja de maior bruto aprovado fica
--     com a conta original (id, parceiro, CRM, override, vínculos); cada
--     outra loja ganha conta nova e os pedidos dela vão junto;
--   - nome da conta = aff_name mais frequente do IPN naquela loja;
--   - marca de recuperação numa conta que misturava lojas é DESATIVADA: não
--     dá pra saber de qual loja era (o 62 marcado como MailX caía no
--     Nicolas). O operador remarca com o link do checkout;
--   - "0" (sem afiliado) e conta sem pedido (sem loja conhecida) ficam como
--     estão — a tela de Recuperação aponta as sem loja;
--   - tudo registrado em "BuyGoodsAffiliateSplit" (dá pra desfazer).
-- Idempotente: só toca conta BuyGoods sem "@".

-- 1) Loja normalizada (a wire às vezes repete: "12592,12592").
UPDATE "Order" o
   SET "vendorAccount" = btrim(split_part(o."vendorAccount", ',', 1))
  FROM "Platform" p
 WHERE p.id = o."platformId" AND p.slug = 'buygoods'
   AND o."vendorAccount" IS NOT NULL
   AND o."vendorAccount" <> btrim(split_part(o."vendorAccount", ',', 1));

-- 2) Registro da separação.
CREATE TABLE IF NOT EXISTS "BuyGoodsAffiliateSplit" (
  "id" TEXT NOT NULL,
  "sourceAffiliateId" TEXT NOT NULL,
  "sourceExternalId" TEXT NOT NULL,
  "store" TEXT NOT NULL,
  "affiliateId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "orders" INTEGER NOT NULL,
  "kept" BOOLEAN NOT NULL,
  "recoveryDisabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BuyGoodsAffiliateSplit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "BuyGoodsAffiliateSplit_sourceAffiliateId_idx" ON "BuyGoodsAffiliateSplit"("sourceAffiliateId");

-- 3) Separação.
DO $$
DECLARE
  bg TEXT;
BEGIN
  SELECT id INTO bg FROM "Platform" WHERE slug = 'buygoods';
  IF bg IS NULL THEN RETURN; END IF;

  DROP TABLE IF EXISTS _bg_plan;
  CREATE TEMP TABLE _bg_plan AS
  SELECT a.id AS src_id, a."externalId" AS aff, o."vendorAccount" AS store,
         count(*)::int AS n,
         coalesce(sum(o."grossAmountUsd") FILTER (WHERE o.status = 'APPROVED'), 0) AS g,
         min(o."orderedAt") AS first_at, max(o."orderedAt") AS last_at,
         false AS keep, NULL::text AS new_id, NULL::text AS nick
    FROM "Affiliate" a
    JOIN "Order" o ON o."affiliateId" = a.id
   WHERE a."platformId" = bg
     AND position('@' IN a."externalId") = 0
     AND a."externalId" <> '0'
     AND coalesce(o."vendorAccount", '') <> ''
   GROUP BY 1, 2, 3;

  -- Loja dominante: maior bruto aprovado, depois mais pedidos, depois menor loja.
  UPDATE _bg_plan p SET keep = true
    FROM (SELECT DISTINCT ON (src_id) src_id, store FROM _bg_plan ORDER BY src_id, g DESC, n DESC, store) d
   WHERE d.src_id = p.src_id AND d.store = p.store;

  UPDATE _bg_plan SET new_id = CASE WHEN keep THEN src_id ELSE 'cbg' || substr(md5(src_id || '|' || store), 1, 22) END;

  -- Nome de cada (loja, aff_id) pelo IPN.
  UPDATE _bg_plan p SET nick = x.nome
    FROM (
      SELECT DISTINCT ON (loja, aff_id) loja, aff_id, nome
        FROM (
          SELECT btrim(split_part(l.payload->>'account_id', ',', 1)) AS loja,
                 btrim(l.payload->>'aff_id') AS aff_id,
                 regexp_replace(btrim(l.payload->>'aff_name'), '\s+', ' ', 'g') AS nome,
                 count(*) AS c
            FROM "IngestLog" l
           WHERE l."platformSlug" = 'buygoods' AND coalesce(btrim(l.payload->>'aff_name'), '') <> ''
           GROUP BY 1, 2, 3
        ) s
       ORDER BY loja, aff_id, c DESC, nome
    ) x
   WHERE x.loja = p.store AND x.aff_id = p.aff;

  -- Contas novas (lojas não dominantes).
  INSERT INTO "Affiliate" (id, "platformId", "externalId", nickname, "firstSeenAt", "lastOrderAt")
  SELECT p.new_id, bg, p.aff || '@' || p.store, p.nick, p.first_at, p.last_at
    FROM _bg_plan p WHERE NOT p.keep
  ON CONFLICT DO NOTHING;

  -- Pedidos dessas lojas vão pra conta nova (casando pela chave, não pelo id).
  UPDATE "Order" o SET "affiliateId" = t.id
    FROM _bg_plan p
    JOIN "Affiliate" t ON t."platformId" = bg AND t."externalId" = p.aff || '@' || p.store
   WHERE NOT p.keep AND o."affiliateId" = p.src_id AND o."vendorAccount" = p.store;

  -- Comissão de network acompanha o pedido.
  UPDATE "NetworkCommission" nc SET "affiliateId" = o."affiliateId"
    FROM "Order" o
   WHERE o.id = nc."orderId" AND nc."affiliateId" <> o."affiliateId"
     AND nc."affiliateId" IN (SELECT src_id FROM _bg_plan);

  -- Conta original vira a da loja dominante.
  UPDATE "Affiliate" a
     SET "externalId" = p.aff || '@' || p.store,
         nickname = coalesce(p.nick, a.nickname),
         "firstSeenAt" = p.first_at,
         "lastOrderAt" = p.last_at
    FROM _bg_plan p
   WHERE p.keep AND a.id = p.src_id;

  -- Marca de recuperação em conta que misturava lojas: desativada.
  UPDATE "RecoveryAffiliate" r SET enabled = false, "updatedAt" = now()
   WHERE r.enabled
     AND r."affiliateId" IN (SELECT src_id FROM _bg_plan GROUP BY src_id HAVING count(*) > 1);

  -- Fila de não mapeados (NorthScale Afiliados) acompanha a conta renomeada.
  UPDATE unmapped_affiliate_events u
     SET external_id = lower(a."externalId")
    FROM "Affiliate" a
   WHERE u.platform = 'buygoods' AND u.affiliate_account_id = a.id
     AND position('@' IN u.external_id) = 0 AND position('@' IN a."externalId") > 0
     AND u.external_id = lower(btrim(split_part(a."externalId", '@', 1)))
     AND NOT EXISTS (SELECT 1 FROM unmapped_affiliate_events u2 WHERE u2.platform = 'buygoods' AND u2.external_id = lower(a."externalId"));

  INSERT INTO "BuyGoodsAffiliateSplit" (id, "sourceAffiliateId", "sourceExternalId", store, "affiliateId", "externalId", orders, kept, "recoveryDisabled")
  SELECT 'cbs' || substr(md5(p.src_id || '|' || p.store || '|split'), 1, 22), p.src_id, p.aff, p.store, t.id, t."externalId", p.n, p.keep,
         p.keep AND EXISTS (SELECT 1 FROM _bg_plan q WHERE q.src_id = p.src_id AND q.store <> p.store)
                AND EXISTS (SELECT 1 FROM "RecoveryAffiliate" r WHERE r."affiliateId" = p.src_id)
    FROM _bg_plan p
    JOIN "Affiliate" t ON t."platformId" = bg AND t."externalId" = p.aff || '@' || p.store
  ON CONFLICT (id) DO NOTHING;

  DROP TABLE IF EXISTS _bg_plan;
END $$;
