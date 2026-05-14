// Base de conhecimento do chat IA. Carrega entries ligadas e formata em
// markdown pra injeção no system prompt do Anthropic.
//
// Cache em memória curto (60s) pra não bater no DB a cada turn do chat.
// invalidateKnowledgeCache() é chamado pelos endpoints admin após mutate,
// então edits aparecem na próxima conversa instantaneamente.

import { db } from '../db';

interface KnowledgeCache {
  promptBlock: string;
  loadedAt: number;
}

let cache: KnowledgeCache | null = null;
const CACHE_TTL_MS = 60 * 1000;

export function invalidateKnowledgeCache(): void {
  cache = null;
}

/**
 * Retorna um bloco markdown com TODAS as entries enabled=true, ordenadas por
 * sortOrder. Vazio quando não há entries ligadas — caller decide se injeta
 * ou omite a seção inteira do prompt.
 */
export async function getKnowledgePromptBlock(): Promise<string> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache.promptBlock;
  }
  const entries = await db.knowledgeEntry.findMany({
    where: { enabled: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { title: true, content: true },
  });
  const promptBlock = entries.length === 0
    ? ''
    : entries
        .map((e) => `## ${e.title}\n\n${e.content.trim()}`)
        .join('\n\n---\n\n');
  cache = { promptBlock, loadedAt: Date.now() };
  return promptBlock;
}
