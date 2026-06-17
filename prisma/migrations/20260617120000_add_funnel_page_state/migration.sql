-- Beacon manual de "estado da página" (Black/White) das páginas de Upsell 01.
-- Guarda só o ÚLTIMO estado por (plataforma, productKey) — upsert via endpoint
-- aberto/auto-corrigível. Exibido nos cards de Produto.

CREATE TABLE "FunnelPageState" (
    "id" TEXT NOT NULL,
    "platformSlug" TEXT NOT NULL,
    "productKey" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "pageUrl" TEXT,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FunnelPageState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FunnelPageState_platformSlug_productKey_key"
    ON "FunnelPageState"("platformSlug", "productKey");

CREATE INDEX "FunnelPageState_reportedAt_idx" ON "FunnelPageState"("reportedAt");
