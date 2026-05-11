-- Phase 2 do redesign do chat: blocos estruturados emitidos pela tool
-- `respond_with_blocks` (summary/insights/table/markdown/chart). Texto livre
-- continua em `content`; blocks armazena o payload tipado pra re-renderizar
-- a resposta intacta em revisitas.

ALTER TABLE "Message" ADD COLUMN "blocks" JSONB;
