-- Redes de afiliados (contrato docs/integracoes/redes.md, v2 de 2026-10-22).
-- Tabelas novas com nomes próprios: as Network* existentes são do programa
-- antigo de sub-afiliados e ficam como estão (têm dados guardados).

CREATE TABLE "affiliate_networks" (
    "network_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "operation_mode" TEXT,
    "jvzoo_affiliate_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "synced_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "affiliate_networks_pkey" PRIMARY KEY ("network_id")
);

CREATE TABLE "affiliate_network_members" (
    "member_id" TEXT NOT NULL,
    "network_id" TEXT NOT NULL,
    "public_id" TEXT,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "affiliate_network_members_pkey" PRIMARY KEY ("member_id")
);
CREATE INDEX "affiliate_network_members_network_id_idx" ON "affiliate_network_members"("network_id");
CREATE INDEX "affiliate_network_members_public_id_idx" ON "affiliate_network_members"("public_id");

CREATE TABLE "network_sales" (
    "transaction_id" TEXT NOT NULL,
    "network_id" TEXT NOT NULL,
    "member_id" TEXT,
    "conversion_id" TEXT,
    "product_id" TEXT,
    "product_name" TEXT,
    "jvzoo_product_id" TEXT,
    "sold_at" TIMESTAMP(3),
    "amount_usd" DECIMAL(12,2),
    "is_test" BOOLEAN NOT NULL DEFAULT false,
    "state" TEXT,
    "refunded_at" TIMESTAMP(3),
    "transaction_type" TEXT,
    "attribution_status" TEXT NOT NULL,
    "attribution_reason" TEXT,
    "network_cpa" DECIMAL(12,2),
    "member_amount" DECIMAL(12,2),
    "network_margin" DECIMAL(12,2),
    "commission_status" TEXT,
    "commission_available_at" TIMESTAMP(3),
    "commission_paid_at" TIMESTAMP(3),
    "click_ic_code" TEXT,
    "click_id" TEXT,
    "clicked_at" TIMESTAMP(3),
    "click_page_url" TEXT,
    "click_referrer" TEXT,
    "click_suspect" BOOLEAN,
    "tid" TEXT,
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "utm_content" TEXT,
    "utm_term" TEXT,
    "sub1" TEXT,
    "sub2" TEXT,
    "sub3" TEXT,
    "sub4" TEXT,
    "sub5" TEXT,
    "ad_click" JSONB,
    "last_source" TEXT NOT NULL,
    "raw" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "network_sales_pkey" PRIMARY KEY ("transaction_id")
);
CREATE INDEX "network_sales_network_id_sold_at_idx" ON "network_sales"("network_id", "sold_at");
CREATE INDEX "network_sales_member_id_sold_at_idx" ON "network_sales"("member_id", "sold_at");
CREATE INDEX "network_sales_sold_at_idx" ON "network_sales"("sold_at");

CREATE TABLE "network_checkouts" (
    "session_id" TEXT NOT NULL,
    "network_id" TEXT NOT NULL,
    "member_id" TEXT,
    "product_id" TEXT,
    "jvzoo_product_id" TEXT,
    "jvzoo_click_id" TEXT,
    "funnel_id" TEXT,
    "at" TIMESTAMP(3) NOT NULL,
    "country" TEXT,
    "tid" TEXT,
    "utm_source" TEXT,
    "utm_campaign" TEXT,
    "sub1" TEXT,
    "raw" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "network_checkouts_pkey" PRIMARY KEY ("session_id")
);
CREATE INDEX "network_checkouts_network_id_at_idx" ON "network_checkouts"("network_id", "at");

CREATE TABLE "network_checkout_daily" (
    "day" DATE NOT NULL,
    "network_id" TEXT NOT NULL,
    "member_key" TEXT NOT NULL,
    "product_key" TEXT NOT NULL,
    "checkouts" INTEGER NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "network_checkout_daily_pkey" PRIMARY KEY ("day", "network_id", "member_key", "product_key")
);

-- Conta JVZoo de rede e pedido de rede.
ALTER TABLE "Affiliate" ADD COLUMN "networkId" TEXT;
CREATE INDEX "Affiliate_networkId_idx" ON "Affiliate"("networkId");
ALTER TABLE "Order" ADD COLUMN "networkId" TEXT;
CREATE INDEX "Order_networkId_orderedAt_idx" ON "Order"("networkId", "orderedAt");

-- A permissão 'networks' volta a existir (aba Afiliados › Networks). Quem
-- ainda tinha o id da aba ANTIGA (removida em ago/2026) não herda a nova:
-- o admin libera de novo em Usuários.
UPDATE "User" SET "allowedTabs" = array_remove("allowedTabs", 'networks') WHERE 'networks' = ANY("allowedTabs");
