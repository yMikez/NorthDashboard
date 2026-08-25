-- Pares de contas que o admin decidiu não unificar (botão "Ignorar").

-- CreateTable
CREATE TABLE "AffiliateLinkDismiss" (
    "id" TEXT NOT NULL,
    "affiliateAId" TEXT NOT NULL,
    "affiliateBId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateLinkDismiss_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateLinkDismiss_affiliateAId_affiliateBId_key" ON "AffiliateLinkDismiss"("affiliateAId", "affiliateBId");
