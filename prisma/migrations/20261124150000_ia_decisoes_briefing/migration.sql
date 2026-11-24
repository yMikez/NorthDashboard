-- IA de decisões e briefing (2026-11-24): briefing da Visão geral em cache,
-- canais e mensagens do chat do ClickUp e as decisões extraídas pela IA.
-- Só cria tabelas.

-- CreateEnum
CREATE TYPE "DecisionStatus" AS ENUM ('DETECTED', 'CONFIRMED', 'DISCARDED');

-- CreateTable
CREATE TABLE "AiBriefing" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "windowEnd" TEXT NOT NULL,
    "model" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiBriefing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClickUpChannel" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "type" TEXT NOT NULL,
    "visibility" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "leadership" BOOLEAN NOT NULL DEFAULT false,
    "latestMessageAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "backfillCursor" TEXT,
    "backfillDone" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClickUpChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClickUpMessage" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "parentId" TEXT,
    "userId" TEXT,
    "userName" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "repliesCount" INTEGER NOT NULL DEFAULT 0,
    "extractedHash" TEXT,
    "extractedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClickUpMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "channelId" TEXT,
    "threadRootId" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "decidedBy" TEXT,
    "metrics" JSONB NOT NULL,
    "scope" JSONB NOT NULL,
    "confidence" TEXT NOT NULL,
    "sourceMessageIds" TEXT[],
    "status" "DecisionStatus" NOT NULL DEFAULT 'DETECTED',
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "reviewedBy" TEXT,
    "correlation" JSONB,
    "correlationAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiBriefing_scopeKey_windowEnd_key" ON "AiBriefing"("scopeKey", "windowEnd");

-- CreateIndex
CREATE INDEX "ClickUpMessage_channelId_postedAt_idx" ON "ClickUpMessage"("channelId", "postedAt");

-- CreateIndex
CREATE INDEX "ClickUpMessage_parentId_idx" ON "ClickUpMessage"("parentId");

-- CreateIndex
CREATE INDEX "Decision_decidedAt_idx" ON "Decision"("decidedAt");

-- CreateIndex
CREATE INDEX "Decision_threadRootId_idx" ON "Decision"("threadRootId");

-- AddForeignKey
ALTER TABLE "ClickUpMessage" ADD CONSTRAINT "ClickUpMessage_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ClickUpChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

