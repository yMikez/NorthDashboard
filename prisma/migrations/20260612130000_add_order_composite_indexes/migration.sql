-- Índices compostos pros WHEREs quentes do dashboard (Fase A do plano de
-- performance). Todo endpoint de métricas filtra orderedAt-range combinado
-- com platformId/status/productType/country; sem compostos o Postgres
-- escolhia um índice simples e filtrava o resto em memória.
--
-- (productType, status, orderedAt) atende orderGroupsCount (FE+APPROVED+range),
-- que roda em TODO overview como denominador do AOV.
--
-- Volume atual (dezenas de milhares de rows) → CREATE INDEX normal é <2s;
-- quando Order passar de ~5M rows, índices novos devem ir via
-- `prisma migrate dev --create-only` + CREATE INDEX CONCURRENTLY manual
-- (psql) + `prisma migrate resolve --applied`.

CREATE INDEX "Order_platformId_orderedAt_idx" ON "Order"("platformId", "orderedAt");

CREATE INDEX "Order_status_orderedAt_idx" ON "Order"("status", "orderedAt");

CREATE INDEX "Order_productType_status_orderedAt_idx" ON "Order"("productType", "status", "orderedAt");

CREATE INDEX "Order_country_orderedAt_idx" ON "Order"("country", "orderedAt");

-- (status) solto é coberto pelo prefixo de (status, orderedAt).
DROP INDEX "Order_status_idx";
