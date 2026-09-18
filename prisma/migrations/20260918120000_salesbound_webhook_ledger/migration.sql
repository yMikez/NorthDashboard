-- SalesBound fase 2: o webhook do CRM passa a escrever no razão.
-- clientTxnId = ponte entre o webhook e o export CSV (o webhook não manda o
-- transactionId do export); source diz de onde a linha veio.

-- AlterTable
ALTER TABLE "SalesboundTransaction" ADD COLUMN "clientTxnId" TEXT;
ALTER TABLE "SalesboundTransaction" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'csv';

-- CreateIndex
CREATE UNIQUE INDEX "SalesboundTransaction_clientTxnId_key" ON "SalesboundTransaction"("clientTxnId");
CREATE INDEX "SalesboundTransaction_source_idx" ON "SalesboundTransaction"("source");
