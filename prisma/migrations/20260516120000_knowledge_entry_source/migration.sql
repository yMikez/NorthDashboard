-- AlterTable: origem da entrada (manual = admin, auto = memória da IA)
ALTER TABLE "KnowledgeEntry"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual';

-- CreateIndex
CREATE INDEX "KnowledgeEntry_source_createdAt_idx" ON "KnowledgeEntry"("source", "createdAt");
