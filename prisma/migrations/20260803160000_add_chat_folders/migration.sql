-- Pastas/projetos de chats do assistente IA (por usuário).
-- Deletar a pasta devolve as conversas pra raiz (SET NULL), não apaga.

CREATE TABLE "ChatFolder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatFolder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChatFolder_userId_updatedAt_idx" ON "ChatFolder"("userId", "updatedAt");

ALTER TABLE "ChatFolder" ADD CONSTRAINT "ChatFolder_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Conversation" ADD COLUMN "folderId" TEXT;

CREATE INDEX "Conversation_folderId_idx" ON "Conversation"("folderId");

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_folderId_fkey"
    FOREIGN KEY ("folderId") REFERENCES "ChatFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
