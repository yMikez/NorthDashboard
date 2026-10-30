-- Vupim: o painel mostra o ID do afiliado com "VP" na frente, mas
-- o webhook manda sem. Conta de recuperação marcada com o "VP" nunca
-- recebia venda — as vendas caíam na conta sem o prefixo, não marcada
-- (Bkdnorth, 30/10/2026). O cadastro já tira o "VP"; aqui o que foi marcado antes.

-- A conta certa já existe (já vendeu): a marca (taxa, empresa, períodos) passa pra ela.
UPDATE "RecoveryAffiliate" r
SET "affiliateId" = certa.id, "updatedAt" = now()
FROM "Affiliate" vp
JOIN "Platform" p ON p.id = vp."platformId" AND p.slug = 'vupim'
JOIN "Affiliate" certa ON certa."platformId" = vp."platformId" AND certa."externalId" = substr(vp."externalId", 3)
WHERE r."affiliateId" = vp.id
  AND vp."externalId" ~ '^VP[A-Za-z0-9]{32}$'
  AND NOT EXISTS (SELECT 1 FROM "RecoveryAffiliate" x WHERE x."affiliateId" = certa.id);

-- Ainda não vendeu: só tira o "VP" do ID (a venda, quando vier, casa com ele).
UPDATE "Affiliate" a
SET "externalId" = substr(a."externalId", 3)
FROM "Platform" p
WHERE p.id = a."platformId" AND p.slug = 'vupim'
  AND a."externalId" ~ '^VP[A-Za-z0-9]{32}$'
  AND NOT EXISTS (
    SELECT 1 FROM "Affiliate" b
    WHERE b."platformId" = a."platformId" AND b."externalId" = substr(a."externalId", 3)
  );
