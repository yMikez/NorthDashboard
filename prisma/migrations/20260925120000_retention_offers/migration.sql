-- Retenção (SendTrace): degrau oferecido/aceito e valor preservado por pedido.
-- Fica FORA de Order — retenção é estorno que não aconteceu, não venda nova.

CREATE TABLE "RetentionOffer" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "email" TEXT,
    "stepOffered" TEXT,
    "stepAccepted" TEXT,
    "preservedUsd" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "orderId" TEXT,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetentionOffer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RetentionOffer_externalId_key" ON "RetentionOffer"("externalId");
CREATE INDEX "RetentionOffer_occurredAt_idx" ON "RetentionOffer"("occurredAt");
CREATE INDEX "RetentionOffer_transactionId_idx" ON "RetentionOffer"("transactionId");
CREATE INDEX "RetentionOffer_orderId_idx" ON "RetentionOffer"("orderId");
CREATE INDEX "RetentionOffer_sourceUpdatedAt_idx" ON "RetentionOffer"("sourceUpdatedAt");

ALTER TABLE "RetentionOffer" ADD CONSTRAINT "RetentionOffer_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
