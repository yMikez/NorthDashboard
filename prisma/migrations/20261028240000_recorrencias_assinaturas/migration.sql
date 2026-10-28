-- Aba Recorrências (2026-10-28): assinaturas como projeção dos eventos da plataforma.

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "phone" TEXT,
    "productName" TEXT,
    "offerName" TEXT,
    "offerId" TEXT,
    "bottles" INTEGER,
    "amountUsd" DECIMAL(12,2),
    "totalPaidUsd" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "chargeCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "lastChargeAt" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastFailedAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "lastFailureReason" TEXT,
    "canceledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "firstTransactionId" TEXT,
    "lastTransactionId" TEXT,
    "src" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionEvent" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "amountUsd" DECIMAL(12,2),
    "chargeNumber" INTEGER,
    "attempt" INTEGER,
    "nextRetryAt" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "reason" TEXT,
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

-- CreateIndex
CREATE INDEX "Subscription_email_idx" ON "Subscription"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_platform_externalId_key" ON "Subscription"("platform", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionEvent_eventId_key" ON "SubscriptionEvent"("eventId");

-- CreateIndex
CREATE INDEX "SubscriptionEvent_subscriptionId_at_idx" ON "SubscriptionEvent"("subscriptionId", "at");

-- CreateIndex
CREATE INDEX "SubscriptionEvent_kind_at_idx" ON "SubscriptionEvent"("kind", "at");

-- AddForeignKey
ALTER TABLE "SubscriptionEvent" ADD CONSTRAINT "SubscriptionEvent_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

