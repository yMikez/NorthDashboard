// POST /api/chat
//   Body: { conversationId?: string, message: string }
//   - Cria conversa nova se não houver ID
//   - Persiste user message
//   - Loop tool-use até obter resposta final
//   - Streama via SSE pro cliente: events 'token' | 'tool_use' | 'done' | 'error'
//   - Salva assistant message no fim com toolUses metadata
//
// Admin-only. ANTHROPIC_API_KEY obrigatório no env.

import type Anthropic from '@anthropic-ai/sdk';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { getAnthropicClient, ANTHROPIC_MODEL, systemPrompt } from '@/lib/services/ai';
import { TOOLS, executeTool } from '@/lib/services/aiTools';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RequestBody {
  conversationId?: string;
  message?: string;
}

const MAX_TOOL_LOOPS = 6;

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

  let conversationId = body.conversationId ?? '';

  // Cria nova conversa se necessário. Título inicial = primeiro msg truncado.
  if (!conversationId) {
    const created = await db.conversation.create({
      data: {
        userId: auth.user.id,
        title: userMsg.slice(0, 60),
      },
      select: { id: true },
    });
    conversationId = created.id;
  } else {
    // Confirma ownership pra prevenir leak entre admins.
    const existing = await db.conversation.findUnique({
      where: { id: conversationId },
      select: { userId: true },
    });
    if (!existing || existing.userId !== auth.user.id) {
      return new Response(JSON.stringify({ error: 'conversation não encontrada' }), { status: 404 });
    }
  }

  // Persiste user message imediatamente.
  await db.message.create({
    data: {
      conversationId,
      role: 'user',
      content: userMsg,
    },
  });

  // Carrega histórico da conversa pra contexto. Toda mensagem do DB
  // entra no array messages que o Anthropic recebe.
  const history = await db.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true, toolUses: true },
  });

  let client: Anthropic;
  try {
    client = getAnthropicClient();
  } catch (err) {
    logger.error({ err }, '[chat] anthropic client init failed');
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY não configurada no servidor' }), { status: 500 });
  }

  // Monta messages array no formato do Anthropic.
  const apiMessages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  // SSE stream.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(payload));
      }

      const toolUses: Array<{ name: string; input: unknown; result?: unknown }> = [];
      let finalText = '';

      try {
        send('conversation', { id: conversationId });

        // Loop tool-use: chama o modelo, executa tools se aparecerem,
        // continua até chegar uma resposta sem tool_use.
        for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
          const response = await client.messages.create({
            model: ANTHROPIC_MODEL,
            max_tokens: 4096,
            system: [
              {
                type: 'text',
                text: systemPrompt(new Date()),
                cache_control: { type: 'ephemeral' },
              },
            ],
            tools: TOOLS,
            messages: apiMessages,
          });

          // Acumula texto + detecta tool_use blocks.
          const assistantBlocks: Anthropic.ContentBlockParam[] = [];
          const toolUseBlocks: Anthropic.ToolUseBlock[] = [];

          for (const block of response.content) {
            assistantBlocks.push(block);
            if (block.type === 'text') {
              finalText += block.text;
              send('token', { text: block.text });
            } else if (block.type === 'tool_use') {
              toolUseBlocks.push(block);
              send('tool_use_start', { name: block.name, id: block.id });
            }
          }

          // Push assistant response (com possíveis tool_use blocks).
          apiMessages.push({ role: 'assistant', content: assistantBlocks });

          if (response.stop_reason !== 'tool_use' || toolUseBlocks.length === 0) {
            // Resposta final — sair do loop.
            break;
          }

          // Executa cada tool_use e empilha tool_result na próxima msg.
          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const block of toolUseBlocks) {
            const result = await executeTool(block.name, block.input as Record<string, unknown>);
            toolUses.push({ name: block.name, input: block.input, result });
            send('tool_use_result', { name: block.name, id: block.id });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result).slice(0, 200_000), // cap em ~200kB pra não explodir contexto
            });
          }
          apiMessages.push({ role: 'user', content: toolResults });
        }

        // Persiste assistant message com texto final + toolUses metadata.
        await db.message.create({
          data: {
            conversationId,
            role: 'assistant',
            content: finalText,
            toolUses: toolUses.length > 0 ? (toolUses as never) : undefined,
          },
        });

        // Atualiza updatedAt da conversa pra ordenar lista.
        await db.conversation.update({
          where: { id: conversationId },
          data: { updatedAt: new Date() },
        });

        send('done', { conversationId });
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
