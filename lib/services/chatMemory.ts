// Memória automática do chat. Depois de cada turno, extrai 0-3 fatos
// DURÁVEIS do que o usuário disse (regras de negócio, preferências,
// contexto da operação) e salva como KnowledgeEntry source='auto'.
//
// Esses entries entram no system prompt de TODAS as conversas futuras
// (via getKnowledgePromptBlock) — efeito "memória cross-chat".
//
// NÃO salva: resultados de query ("receita foi X"), perguntas, pedidos
// pontuais. Só o que vale lembrar permanentemente. Dedup por título
// case-insensitive. Cap de MAX_AUTO entries (remove as mais antigas).

import { getAnthropicClient, ANTHROPIC_MODEL } from './ai';
import { invalidateKnowledgeCache } from './knowledge';
import { db } from '../db';
import { logger } from '../logger';

const MAX_AUTO = 40;

const SYSTEM = `Você extrai MEMÓRIA DURÁVEL de uma conversa entre um operador de marketing (nutra/afiliados) e um assistente de analytics.

Salve APENAS fatos que valem lembrar PERMANENTEMENTE em conversas futuras:
- Regras de negócio ("CPA válido é entre $200 e $290", "frete cobra por sessão não por pedido")
- Preferências do usuário ("sempre mostrar margem líquida, não bruta")
- Definições/convenções específicas da operação
- Decisões estratégicas declaradas ("vamos pausar afiliados com refund > 8%")

NÃO salve:
- Resultados de consulta ("a receita foi $X em maio") — isso muda
- Perguntas, pedidos pontuais, small talk
- Nada que já seja óbvio do contexto de um dashboard de vendas

Responda SOMENTE com JSON array (pode ser vazio):
[{"title":"curto, 3-6 palavras","content":"o fato em 1-2 frases, autossuficiente"}]
Máximo 3 itens. Se nada durável, responda [].`;

/**
 * Fire-and-forget: chamada após salvar a resposta do assistente. Erros
 * são logados e engolidos — extração de memória nunca pode quebrar o chat.
 */
export async function extractAndSaveMemory(
  userText: string,
  assistantText: string,
): Promise<void> {
  try {
    if (!userText.trim() || !assistantText.trim()) return;
    const client = getAnthropicClient();
    const resp = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 600,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `USUÁRIO:\n${userText.slice(0, 4000)}\n\nASSISTENTE:\n${assistantText.slice(0, 4000)}`,
        },
      ],
    });
    const text = resp.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim();
    const jsonStr = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const parsed: unknown = JSON.parse(jsonStr);
    if (!Array.isArray(parsed) || parsed.length === 0) return;

    const facts = (parsed as Array<Record<string, unknown>>)
      .filter((f) => typeof f.title === 'string' && typeof f.content === 'string')
      .map((f) => ({
        title: (f.title as string).trim().slice(0, 120),
        content: (f.content as string).trim().slice(0, 2000),
      }))
      .filter((f) => f.title && f.content)
      .slice(0, 3);
    if (facts.length === 0) return;

    // Dedup por título (case-insensitive) contra o que já existe.
    const existing = await db.knowledgeEntry.findMany({
      select: { title: true },
    });
    const existingTitles = new Set(existing.map((e) => e.title.toLowerCase()));

    let created = 0;
    for (const f of facts) {
      if (existingTitles.has(f.title.toLowerCase())) continue;
      await db.knowledgeEntry.create({
        data: {
          title: f.title,
          content: f.content,
          source: 'auto',
          enabled: true,
          // auto entra depois das manuais no prompt (sortOrder maior).
          sortOrder: 1000,
        },
      });
      existingTitles.add(f.title.toLowerCase());
      created++;
    }
    if (created === 0) return;

    // Cap: mantém só as MAX_AUTO memórias auto mais recentes.
    const autoCount = await db.knowledgeEntry.count({ where: { source: 'auto' } });
    if (autoCount > MAX_AUTO) {
      const toDrop = await db.knowledgeEntry.findMany({
        where: { source: 'auto' },
        orderBy: { createdAt: 'asc' },
        take: autoCount - MAX_AUTO,
        select: { id: true },
      });
      await db.knowledgeEntry.deleteMany({
        where: { id: { in: toDrop.map((d) => d.id) } },
      });
    }

    invalidateKnowledgeCache();
    logger.info({ created }, 'chatMemory: saved auto memories');
  } catch (err) {
    logger.error({ err }, 'chatMemory: extraction failed (non-fatal)');
  }
}
