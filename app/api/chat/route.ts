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
import { requireAuth } from '@/lib/auth/guard';
import { getAnthropicClient, ANTHROPIC_MODEL, systemBlocks } from '@/lib/services/ai';
import { getKnowledgePromptBlock } from '@/lib/services/knowledge';
import { extractAndSaveMemory } from '@/lib/services/chatMemory';
import { TOOLS, executeTool, TERMINAL_TOOL } from '@/lib/services/aiTools';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RequestBody {
  conversationId?: string;
  message?: string;
  // Pasta onde a conversa NOVA nasce (ignorado quando conversationId vem).
  folderId?: string | null;
  // Estado atual da UI da SPA (aba, período, filtros ativos) — vira o
  // bloco dinâmico do system pra perguntas dêiticas ("por que caiu aqui?").
  uiState?: {
    route?: string;
    preset?: string;
    startDate?: string;
    endDate?: string;
    platforms?: string[];
    families?: string[];
    stages?: string[];
    countries?: string[];
  };
}

// Sanitiza e serializa o uiState num bloco curto de texto. Free-form do
// client — só strings curtas passam, listas capadas em 10 itens.
function uiStateText(ui: RequestBody['uiState']): string {
  if (!ui || typeof ui !== 'object') return '';
  const s = (v: unknown) => (typeof v === 'string' ? v.slice(0, 60) : '');
  const arr = (v: unknown) =>
    Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 10).map((x) => (x as string).slice(0, 40)) : [];
  const parts: string[] = [];
  if (s(ui.route)) parts.push(`aba: ${s(ui.route)}`);
  if (s(ui.preset)) parts.push(`período selecionado: ${s(ui.preset)}`);
  if (s(ui.startDate) && s(ui.endDate)) parts.push(`intervalo: ${s(ui.startDate)} → ${s(ui.endDate)}`);
  const lists: Array<[string, unknown]> = [
    ['plataformas', ui.platforms], ['famílias', ui.families],
    ['etapas', ui.stages], ['países', ui.countries],
  ];
  for (const [label, v] of lists) {
    const a = arr(v);
    if (a.length) parts.push(`${label}: ${a.join(', ')}`);
  }
  return parts.length
    ? `\n\n# Estado da UI (o que o usuário está vendo agora)\n${parts.join(' · ')}`
    : '';
}

// Limits
const MAX_TOOL_LOOPS = 8;
const HISTORY_MAX_MESSAGES = 20; // últimos N pra evitar contexto explodindo
const RATE_LIMIT_PER_DAY = 50;   // user-role messages / 24h por usuário
// 4096 truncava respostas com tabela grande no MEIO (stop_reason
// max_tokens) — o sintoma clássico de "começa a responder e para".
// 16384 dá folga; o caso raro que ainda estourar emite SSE 'truncated'.
const MAX_OUTPUT_TOKENS = 16_384;
const TOOL_RESULT_MAX_BYTES = 200_000;
// Ping SSE (comentário ':') a cada 15s — mantém o stream vivo através de
// proxy (Traefik) durante execuções longas de tool (ex: refresh da MV),
// que antes derrubavam a conexão sem nenhum byte trafegando.
const KEEPALIVE_MS = 15_000;

export async function POST(req: Request) {
  // Aberto a QUALQUER usuário logado (2026-08-03) — conversas são
  // escopadas por userId em todas as queries.
  const auth = await requireAuth();
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
  const uiTxt = uiStateText(body.uiState);

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
    // Conversa nova pode nascer numa pasta — valida a posse antes.
    let folderId: string | null = null;
    if (body.folderId) {
      const folder = await db.chatFolder.findUnique({
        where: { id: body.folderId },
        select: { userId: true },
      });
      if (folder && folder.userId === auth.user.id) folderId = body.folderId;
    }
    const created = await db.conversation.create({
      data: { userId: auth.user.id, title: userMsg.slice(0, 60), folderId },
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
      let closed = false;
      function send(event: string, data: unknown) {
        if (closed) return;
        try {
          const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch {
          closed = true; // client desconectou — não derruba o processamento
        }
      }
      // Keepalive: comentário SSE periódico segura a conexão viva através
      // do proxy enquanto uma tool longa roda (nenhum token trafegando).
      const keepalive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          closed = true;
        }
      }, KEEPALIVE_MS);

      const toolUses: Array<{ name: string; input: unknown; result?: unknown }> = [];
      let finalText = '';
      let finalBlocks: unknown = null;
      // true quando o loop esgota com o modelo ainda pedindo tools — o
      // pós-loop força uma resposta final em texto com o que foi coletado.
      let exhaustedWithToolUse = false;

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
            max_tokens: MAX_OUTPUT_TOKENS,
            system: systemBlocks(new Date(), knowledgeBlock, uiTxt),
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

          // Estourou o teto de output NO MEIO da resposta — avisa a UI e
          // fecha o turno com o que já foi streamado (raro com 16k, mas o
          // silêncio era exatamente o bug do "para sem terminar").
          if (finalMessage.stop_reason === 'max_tokens') {
            send('truncated', { reason: 'max_tokens' });
            logger.warn({ conversationId }, '[chat] resposta truncada por max_tokens');
            break;
          }

          if (finalMessage.stop_reason !== 'tool_use') {
            break;
          }

          // Última volta do loop e o modelo ainda quer tools: executa os
          // tools abaixo e o pós-loop força uma resposta final em TEXTO
          // (tool_choice none) — antes o turno simplesmente MORRIA aqui,
          // sem resposta nenhuma ("começa e para").
          exhaustedWithToolUse = loop === MAX_TOOL_LOOPS - 1;

          // Executa os tool_use e empilha tool_result.
          // `respond_with_blocks` é terminal: extrai os blocos do input,
          // emite SSE pra UI e quebra fora do loop sem mais iterações.
          const toolBlocks = finalMessage.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
          );

          const terminal = toolBlocks.find((b) => b.name === TERMINAL_TOOL);
          if (terminal) {
            const input = terminal.input as { blocks?: unknown };
            finalBlocks = Array.isArray(input?.blocks) ? input.blocks : null;
            toolUses.push({ name: terminal.name, input: terminal.input, result: { ok: true } });
            send('tool_use_result', { name: terminal.name, id: terminal.id });
            if (finalBlocks) {
              send('blocks', { blocks: finalBlocks });
            }
            break outer;
          }

          // Sem terminal: executa TODAS as tools da rodada em PARALELO —
          // o modelo costuma pedir 2-3 consultas juntas (ex: comparar
          // períodos) e executá-las em série somava as latências.
          const results = await Promise.all(
            toolBlocks.map((block) =>
              executeTool(block.name, block.input as Record<string, unknown>),
            ),
          );
          const toolResults: Anthropic.ToolResultBlockParam[] = toolBlocks.map((block, i) => {
            toolUses.push({ name: block.name, input: block.input, result: results[i] });
            send('tool_use_result', { name: block.name, id: block.id });
            return {
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(results[i]).slice(0, TOOL_RESULT_MAX_BYTES),
            };
          });
          if (toolResults.length === 0) {
            break;
          }
          apiMessages.push({ role: 'user', content: toolResults });
        }

        // Loop esgotado com tools pendentes: força UMA resposta final em
        // TEXTO (tool_choice none) com os dados já coletados — nunca mais
        // terminar o turno em silêncio.
        if (exhaustedWithToolUse) {
          const finalMs = client.messages.stream({
            model: ANTHROPIC_MODEL,
            max_tokens: MAX_OUTPUT_TOKENS,
            system: systemBlocks(new Date(), knowledgeBlock, uiTxt),
            tools: TOOLS,
            tool_choice: { type: 'none' },
            messages: apiMessages,
          });
          for await (const event of finalMs) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              finalText += event.delta.text;
              send('token', { text: event.delta.text });
            }
          }
          const closing = await finalMs.finalMessage();
          if (closing.stop_reason === 'max_tokens') {
            send('truncated', { reason: 'max_tokens' });
          }
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
        // KnowledgeEntry source='auto' pra conversas futuras. SÓ pra
        // ADMIN: a base de conhecimento é global/autoritativa e injeta o
        // system de TODOS os usuários — member não escreve nela.
        if (auth.user.role === 'ADMIN') {
          void extractAndSaveMemory(userMsg, finalText);
        }
      } catch (err) {
        logger.error({ err, conversationId }, '[chat] stream failed');
        send('error', { message: err instanceof Error ? err.message : 'erro desconhecido' });
      } finally {
        clearInterval(keepalive);
        closed = true;
        try { controller.close(); } catch { /* já fechado pelo client */ }
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
