-- Integração NorthScale Afiliados (contrato integration-dashboard.md):
-- espelho do mapeamento platform+external_id → affiliate_id, fila de não
-- mapeados e a coluna de resolução por pedido/conta. Aditivo — nenhuma
-- linha existente é reescrita; o backfill roda pelo serviço
-- (POST /api/admin/affiliate-mapping/backfill) depois da carga do mapping.

-- AlterTable
ALTER TABLE "Affiliate" ADD COLUMN "mappedAffiliateId" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "mappedAffiliateId" TEXT;

-- CreateTable
CREATE TABLE "affiliate_mapping_state" (
    "affiliate_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL,
    "removed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliate_mapping_state_pkey" PRIMARY KEY ("affiliate_id")
);

-- CreateTable
CREATE TABLE "affiliate_mappings" (
    "id" TEXT NOT NULL,
    "affiliate_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliate_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unmapped_affiliate_events" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "alt_external_id" TEXT,
    "nickname" TEXT,
    "affiliate_account_id" TEXT,
    "event_id" TEXT,
    "first_seen" TIMESTAMP(3) NOT NULL,
    "last_seen" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "unmapped_affiliate_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Affiliate_mappedAffiliateId_idx" ON "Affiliate"("mappedAffiliateId");

-- CreateIndex
CREATE INDEX "Order_mappedAffiliateId_orderedAt_idx" ON "Order"("mappedAffiliateId", "orderedAt");

-- CreateIndex
CREATE INDEX "affiliate_mapping_state_occurred_at_idx" ON "affiliate_mapping_state"("occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_mappings_platform_external_id_key" ON "affiliate_mappings"("platform", "external_id");

-- CreateIndex
CREATE INDEX "affiliate_mappings_affiliate_id_idx" ON "affiliate_mappings"("affiliate_id");

-- CreateIndex
CREATE UNIQUE INDEX "unmapped_affiliate_events_platform_external_id_key" ON "unmapped_affiliate_events"("platform", "external_id");

-- CreateIndex
CREATE INDEX "unmapped_affiliate_events_last_seen_idx" ON "unmapped_affiliate_events"("last_seen");

-- AddForeignKey
ALTER TABLE "affiliate_mappings" ADD CONSTRAINT "affiliate_mappings_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "affiliate_mapping_state"("affiliate_id") ON DELETE CASCADE ON UPDATE CASCADE;
