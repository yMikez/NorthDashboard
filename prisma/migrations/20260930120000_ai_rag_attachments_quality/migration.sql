-- IA: RAG (base pesquisável + anexos), telemetria por turno, feedback e avaliação.
--
-- REGRA: esta migração NUNCA pode derrubar o boot (migrate deploy roda no
-- CMD do container). Extensões e configurações de busca são criadas de forma
-- tolerante: sem unaccent o ns_pt fica sem remoção de acento; sem pg_trgm o
-- índice de trigram não é criado (o código detecta e segue só com FTS).

DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS unaccent; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'unaccent indisponível: %', SQLERRM; END $$;
DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS pg_trgm;  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pg_trgm indisponível: %', SQLERRM; END $$;

-- ns_pt: português com stemming (+ unaccent quando houver). ns_simple: sem
-- stemming — códigos, IDs e termos em inglês (NSNMP6, fenix2025, take rate, D24).
DO $$ BEGIN
  CREATE TEXT SEARCH CONFIGURATION public.ns_pt (COPY = pg_catalog.portuguese);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TEXT SEARCH CONFIGURATION public.ns_simple (COPY = pg_catalog.simple);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'unaccent') THEN
    ALTER TEXT SEARCH CONFIGURATION public.ns_pt ALTER MAPPING FOR hword, hword_part, word WITH unaccent, portuguese_stem;
    ALTER TEXT SEARCH CONFIGURATION public.ns_simple ALTER MAPPING FOR hword, hword_part, word WITH unaccent, simple;
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'mapeamento unaccent falhou: %', SQLERRM; END $$;

-- CreateEnum
CREATE TYPE "KbScope" AS ENUM ('GLOBAL', 'CONVERSATION');

-- CreateEnum
CREATE TYPE "KbDocStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED', 'EXPIRED');

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "citations" JSONB,
ADD COLUMN     "turnContext" TEXT;

-- AlterTable
ALTER TABLE "KnowledgeEntry" ADD COLUMN     "confidence" DOUBLE PRECISION,
ADD COLUMN     "evidence" TEXT,
ADD COLUMN     "hitCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pinned" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active';

-- CreateTable
CREATE TABLE "KbDocument" (
    "id" TEXT NOT NULL,
    "scope" "KbScope" NOT NULL,
    "userId" TEXT,
    "conversationId" TEXT,
    "messageId" TEXT,
    "kind" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceRef" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "mimeType" TEXT NOT NULL,
    "fileName" TEXT,
    "byteSize" INTEGER,
    "pageCount" INTEGER,
    "tokenEstimate" INTEGER,
    "contentHash" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "KbDocStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "deliveryMode" TEXT NOT NULL DEFAULT 'indexed',
    "effectiveDate" TIMESTAMP(3),
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "lastRetrievedAt" TIMESTAMP(3),
    "text" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KbDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KbFile" (
    "documentId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KbFile_pkey" PRIMARY KEY ("documentId")
);

-- CreateTable
CREATE TABLE "KbChunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "docVersion" INTEGER NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "scope" "KbScope" NOT NULL,
    "conversationId" TEXT,
    "label" TEXT NOT NULL,
    "headingPath" TEXT NOT NULL DEFAULT '',
    "pageStart" INTEGER,
    "pageEnd" INTEGER,
    "content" TEXT NOT NULL,
    "context" TEXT,
    "tokenCount" INTEGER NOT NULL,
    "tsvPt" tsvector,
    "tsvSimple" tsvector,
    "embedding" BYTEA,
    "embeddingModel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KbChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KbTable" (
    "documentId" TEXT NOT NULL,
    "sheets" JSONB NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "KbTable_pkey" PRIMARY KEY ("documentId")
);

-- CreateTable
CREATE TABLE "ChatTurnLog" (
    "id" TEXT NOT NULL,
    "messageId" TEXT,
    "conversationId" TEXT,
    "userId" TEXT,
    "evalRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "model" TEXT NOT NULL,
    "effort" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "knowledgeHash" TEXT,
    "status" TEXT NOT NULL,
    "rounds" INTEGER NOT NULL,
    "toolCalls" INTEGER NOT NULL,
    "toolErrors" INTEGER NOT NULL DEFAULT 0,
    "truncatedResults" INTEGER NOT NULL DEFAULT 0,
    "forcedFinal" BOOLEAN NOT NULL DEFAULT false,
    "usedBlocks" BOOLEAN NOT NULL DEFAULT false,
    "ungroundedNumbers" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION,
    "ttftMs" INTEGER,
    "latencyMs" INTEGER NOT NULL,
    "toolMs" INTEGER NOT NULL DEFAULT 0,
    "contextCharsPeak" INTEGER NOT NULL DEFAULT 0,
    "trace" JSONB NOT NULL,

    CONSTRAINT "ChatTurnLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatFeedback" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "reasons" TEXT[],
    "comment" TEXT,
    "expected" TEXT,
    "shared" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'open',
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatEvalCase" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "spec" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sourceFeedbackId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatEvalCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatEvalRun" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "createdBy" TEXT,
    "config" JSONB NOT NULL,
    "summary" JSONB,
    "costUsd" DOUBLE PRECISION,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ChatEvalRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatEvalResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "caseSlug" TEXT NOT NULL,
    "rep" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "checks" JSONB NOT NULL,
    "answer" TEXT NOT NULL,
    "trace" JSONB,
    "usage" JSONB,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatEvalResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KbDocument_scope_status_enabled_idx" ON "KbDocument"("scope", "status", "enabled");

-- CreateIndex
CREATE INDEX "KbDocument_conversationId_idx" ON "KbDocument"("conversationId");

-- CreateIndex
CREATE INDEX "KbDocument_messageId_idx" ON "KbDocument"("messageId");

-- CreateIndex
CREATE INDEX "KbDocument_userId_createdAt_idx" ON "KbDocument"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "KbDocument_scope_sourceType_sourceRef_key" ON "KbDocument"("scope", "sourceType", "sourceRef");

-- CreateIndex
CREATE INDEX "KbChunk_scope_conversationId_idx" ON "KbChunk"("scope", "conversationId");

-- CreateIndex
CREATE INDEX "KbChunk_tsvPt_idx" ON "KbChunk" USING GIN ("tsvPt");

-- CreateIndex
CREATE INDEX "KbChunk_tsvSimple_idx" ON "KbChunk" USING GIN ("tsvSimple");

-- CreateIndex
-- Trigram só se a extensão existir (a busca detecta e pula o trigram sem ela).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS "KbChunk_label_idx" ON "KbChunk" USING GIN ("label" gin_trgm_ops);
  END IF;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "KbChunk_documentId_docVersion_ordinal_key" ON "KbChunk"("documentId", "docVersion", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "ChatTurnLog_messageId_key" ON "ChatTurnLog"("messageId");

-- CreateIndex
CREATE INDEX "ChatTurnLog_createdAt_idx" ON "ChatTurnLog"("createdAt");

-- CreateIndex
CREATE INDEX "ChatTurnLog_userId_createdAt_idx" ON "ChatTurnLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatTurnLog_promptVersion_createdAt_idx" ON "ChatTurnLog"("promptVersion", "createdAt");

-- CreateIndex
CREATE INDEX "ChatFeedback_rating_status_createdAt_idx" ON "ChatFeedback"("rating", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatFeedback_messageId_userId_key" ON "ChatFeedback"("messageId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatEvalCase_slug_key" ON "ChatEvalCase"("slug");

-- CreateIndex
CREATE INDEX "ChatEvalRun_startedAt_idx" ON "ChatEvalRun"("startedAt");

-- CreateIndex
CREATE INDEX "ChatEvalResult_runId_idx" ON "ChatEvalResult"("runId");

-- CreateIndex
CREATE INDEX "KnowledgeEntry_status_createdAt_idx" ON "KnowledgeEntry"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "KbDocument" ADD CONSTRAINT "KbDocument_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KbDocument" ADD CONSTRAINT "KbDocument_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KbFile" ADD CONSTRAINT "KbFile_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KbDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KbChunk" ADD CONSTRAINT "KbChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KbDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KbTable" ADD CONSTRAINT "KbTable_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KbDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatTurnLog" ADD CONSTRAINT "ChatTurnLog_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatFeedback" ADD CONSTRAINT "ChatFeedback_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatEvalResult" ADD CONSTRAINT "ChatEvalResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ChatEvalRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

