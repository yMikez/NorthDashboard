// POST /api/chat
//   Body: { conversationId?: string, message: string }
//
// Pipeline:
//   1. Auth (admin) + rate limit check
//   2. Create/load conversation, persist user message
//   3. Load history capped a últimos N (context truncation)
//   4. Loop tool-use com STREAMING:
//      - messages.stream() emite content_block_delta com text_delta
//        → forward token by token via SSE
//      - tool_use blocks aparecem completos no fim do stream da turn
//        → executa, push tool_result, próxima iteração
//   5. Persist assistant message + bump conversation.updatedAt
//
// SSE events: conversation | token | tool_use_start | tool_use_result
//             | done | error | rate_limited

import type Anthropic from '@anthropic-ai/sdk';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { getAnthropicClient, ANTHROPIC_MODEL, systemPrompt } from '@/lib/services/ai';
import { getKnowledgePromptBlock } from '@/lib/services/knowledge';
import { extractAndSaveMemory } from '@/lib/services/chatMemory';
import { TOOLS, executeTool, TERMINAL_TOOL } from '@/lib/services/aiTools';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RequestBody {
  conversationId?: string;
  message?: string;
}

// Limits
const MAX_TOOL_LOOPS = 6;
const HISTORY_MAX_MESSAGES = 20; // últimos N pra evitar contexto explodindo
const RATE_LIMIT_PER_DAY = 50;   // user-role messages / 24h por admin
const TOOL_RESULT_MAX_BYTES = 200_000;

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return new Response(JSON.stringify({ error: 'invalid body' }), { status: 400 });
  }

  const userMsg = (body.message ?? '').trim();
  if (!userMsg) {
    return new Response(JSON.stringify({ error: 'message vazio' }), { status: 400 });
  }

  // Rate limit: conta mensagens 'user' do admin nas últimas 24h.
  // Defesa contra loop acidental no client + custo descontrolado.
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const recentCount = await db.message.count({
    where: {
      role: 'user',
      createdAt: { gte: since },
      conversation: { userId: auth.user.id },
    },
  });
  if (recentCount >= RATE_LIMIT_PER_DAY) {
    return new Response(
      JSON.stringify({
        error: 'rate_limited',
        message: `Limite de ${RATE_LIMIT_PER_DAY} mensagens/dia atingido. Aguarde algumas horas ou ajuste RATE_LIMIT_PER_DAY no código.`,
        retryAfterSeconds: 3600,
      }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let conversationId = body.conversationId ?? '';

  if (!conversationId) {
    const created = await db.conversation.create({
      data: { userId: auth.user.id, title: userMsg.slice(0, 60) },
      select: { id: true },
    });
    conversationId = created.id;
  } else {
    const existing = await db.conversation.findUnique({
      where: { id: conversationId },
      select: { userId: true },
    });
    if (!existing || existing.userId !== auth.user.id) {
      return new Response(JSON.stringify({ error: 'conversation não encontrada' }), { status: 404 });
    }
  }

  await db.message.create({
    data: { conversationId, role: 'user', content: userMsg },
  });

  // Context cap: pega últimos N mensagens (incluindo a user que acabei
  // de criar). Mais antigas ficam no DB mas saem do contexto enviado pro
  // modelo — conversas longas eventualmente perdem início.
  const historyRaw = await db.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_MAX_MESSAGES,
    select: { role: true, content: true },
  });
  const history = historyRaw.reverse();

  let client: Anthropic;
  try {
    client = getAnthropicClient();
  } catch (err) {
    logger.error({ err }, '[chat] anthropic client init failed');
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY não configurada no servidor' }),
      { status: 500 },
    );
  }

  const apiMessages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(payload));
      }

      const toolUses: Array<{ name: string; input: unknown; result?: unknown }> = [];
      let finalText = '';
      let finalBlocks: unknown = null;

      // Carrega a base de conhecimento UMA vez por request — cache 60s no
      // service. Vai injetada no system prompt em todas as iterações do
      // tool-use loop (cache_control ephemeral garante reuso).
      const knowledgeBlock = await getKnowledgePromptBlock();

      try {
        send('conversation', { id: conversationId });

        outer: for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
          // messages.stream emite eventos enquanto o modelo gera. Forwardar
          // text_delta como SSE 'token' pra UX em tempo real.
          const ms = client.messages.stream({
            model: ANTHROPIC_MODEL,
            max_tokens: 4096,
            system: [
              {
                type: 'text',
                text: systemPrompt(new Date(), knowledgeBlock),
                cache_control: { type: 'ephemeral' },
              },
            ],
            tools: TOOLS,
            messages: apiMessages,
          });

          for await (const event of ms) {
            if (event.type === 'content_block_start') {
              const block = event.content_block;
              if (block.type === 'tool_use') {
                send('tool_use_start', { name: block.name, id: block.id });
              }
            } else if (event.type === 'content_block_delta') {
              const delta = event.delta;
              if (delta.type === 'text_delta') {
                finalText += delta.text;
                send('token', { text: delta.text });
              }
            }
          }

          const finalMessage = await ms.finalMessage();
          apiMessages.push({ role: 'assistant', content: finalMessage.content });

          if (finalMessage.stop_reason !== 'tool_use') {
            break;
          }

          // Executa cada tool_use e empilha tool_result.
          // `respond_with_blocks` é terminal: extrai os blocos do input,
          // emite SSE pra UI e quebra fora do loop sem mais iterações.
          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const block of finalMessage.content) {
            if (block.type !== 'tool_use') continue;

            if (block.name === TERMINAL_TOOL) {
              const input = block.input as { blocks?: unknown };
              finalBlocks = Array.isArray(input?.blocks) ? input.blocks : null;
              toolUses.push({ name: block.name, input: block.input, result: { ok: true } });
              send('tool_use_result', { name: block.name, id: block.id });
              if (finalBlocks) {
                send('blocks', { blocks: finalBlocks });
              }
              break outer;
            }

            const result = await executeTool(block.name, block.input as Record<string, unknown>);
            toolUses.push({ name: block.name, input: block.input, result });
            send('tool_use_result', { name: block.name, id: block.id });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result).slice(0, TOOL_RESULT_MAX_BYTES),
            });
          }
          if (toolResults.length === 0) {
            // Só terminal tool foi chamada — sem tool_results pra empilhar.
            break;
          }
          apiMessages.push({ role: 'user', content: toolResults });
        }

        await db.message.create({
          data: {
            conversationId,
            role: 'assistant',
            content: finalText,
            toolUses: toolUses.length > 0 ? (toolUses as never) : undefined,
            blocks: finalBlocks ? (finalBlocks as never) : undefined,
          },
        });

        await db.conversation.update({
          where: { id: conversationId },
          data: { updatedAt: new Date() },
        });

        send('done', { conversationId });

        // Memória automática: fire-and-forget (não bloqueia o close do
        // stream). Extrai fatos duráveis do turno e salva como
        // KnowledgeEntry source='auto' pra conversas futuras. Erros
        // são engolidos dentro de extractAndSaveMemory.
        void extractAndSaveMemory(userMsg, finalText);
      } catch (err) {
        logger.error({ err, conversationId }, '[chat] stream failed');
        send('error', { message: err instanceof Error ? err.message : 'erro desconhecido' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
