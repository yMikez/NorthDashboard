-- CreateTable
CREATE TABLE "SmsEvent" (
    "id" BIGSERIAL NOT NULL,
    "eventType" TEXT NOT NULL,
    "messageSid" TEXT,
    "campaign" TEXT,
    "brand" TEXT,
    "subIndex" INTEGER,
    "status" TEXT,
    "errorCode" INTEGER,
    "reason" TEXT,
    "fromNumber" TEXT,
    "toNumber" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" JSONB,

    CONSTRAINT "SmsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsCampaign" (
    "mauticId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT,
    "mauticCreatedAt" TIMESTAMP(3),
    "mauticModifiedAt" TIMESTAMP(3),
    "firstSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "raw" JSONB,

    CONSTRAINT "SmsCampaign_pkey" PRIMARY KEY ("mauticId")
);

-- CreateIndex
CREATE UNIQUE INDEX "SmsEvent_eventType_messageSid_key" ON "SmsEvent"("eventType", "messageSid");

-- CreateIndex
CREATE INDEX "SmsEvent_eventType_occurredAt_idx" ON "SmsEvent"("eventType", "occurredAt");

-- CreateIndex
CREATE INDEX "SmsEvent_campaign_occurredAt_idx" ON "SmsEvent"("campaign", "occurredAt");

-- CreateIndex
CREATE INDEX "SmsEvent_brand_occurredAt_idx" ON "SmsEvent"("brand", "occurredAt");

-- CreateIndex
CREATE INDEX "SmsEvent_toNumber_occurredAt_idx" ON "SmsEvent"("toNumber", "occurredAt");

-- CreateIndex
CREATE INDEX "SmsCampaign_slug_idx" ON "SmsCampaign"("slug");

-- CreateIndex
CREATE INDEX "SmsCampaign_archived_isPublished_idx" ON "SmsCampaign"("archived", "isPublished");
