// POST /api/chat
//   Body: { conversationId?: string, message: string, uiState?, folderId? }
//
// Pipeline:
//   1. Auth (qualquer usuário logado) + rate limit (anti-loop, configurável)
//   2. Create/load conversation, persist user message
//   3. Load history (últimos N, com orçamento de caracteres)
//   4. Loop tool-use com STREAMING:
//      - messages.stream() emite content_block_delta com text_delta
//        → forward token by token via SSE
//      - tool_use blocks aparecem completos no fim do stream da turn
//        → executa (paralelo, com timeout), push tool_result, próxima iteração
//      - orçamento de CONTEXTO: quando o acumulado se aproxima da janela
//        do modelo, a rodada seguinte é forçada a responder em texto
//   5. Persist assistant message + bump conversation.updatedAt
//      (também no erro — o que já foi streamado nunca se perde)
//
// SSE events: conversation | token | tool_use_start | tool_use_result
//             | blocks | truncated | done | error | rate_limited
//
// "Sem limites, sem travar" (2026-08-24): os tetos abaixo existem só pra
// impedir um turno de ficar pendurado ou estourar a janela do modelo —
// nenhum deles é atingido por uso humano normal. Todos configuráveis por env.

import type Anthropic from '@anthropic-ai/sdk';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth/guard';
import { getAnthropicClient, ANTHROPIC_MODEL, ANTHROPIC_EFFORT, systemBlocks } from '@/lib/services/ai';
import { getKnowledgePromptBlock } from '@/lib/services/knowledge';
import { extractAndSaveMemory } from '@/lib/services/chatMemory';
import { TOOLS, executeTool, TERMINAL_TOOL, fitToolResult, uiRangeContext } from '@/lib/services/aiTools';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RequestBody {
  conversationId?: string;
  message?: string;
  // Pasta onde a conversa NOVA nasce (ignorado quando conversationId vem).
  folderId?: string | null;
  // Estado atual da UI da SPA (aba, período, filtros ativos) — vira o
  // bloco dinâmico do system pra perguntas dêiticas ("por que caiu aqui?")
  // e o período default das tools quando o modelo omite datas.
  uiState?: {
    route?: string;
    preset?: string;
    // Rótulos (YYYY-MM-DD, dia civil do que a tela mostra) — só pro texto.
    startDate?: string;
    endDate?: string;
    // Instantes exatos (ISO) que as abas usam nas queries — viram o
    // default das tools, pra o chat consultar EXATAMENTE o que está na tela.
    startAt?: string;
    endAt?: string;
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

// Lê inteiro de env; inválido ou abaixo de `min` cai no default.
function envInt(name: string, fallback: number, min = 1): number {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

// ── Tetos (defesa contra loop/explosão, não contra uso normal) ──────────
// Rodadas de tool por turno. 30 cobre "pagine tudo" em pedidos grandes;
// se estourar, o pós-loop força uma resposta em texto com o coletado.
const MAX_TOOL_LOOPS = envInt('CHAT_MAX_TOOL_LOOPS', 30);
// Histórico enviado ao modelo: últimas N mensagens E no máximo X chars
// (o que vier primeiro). Mensagens mais antigas ficam no DB.
const HISTORY_MAX_MESSAGES = envInt('CHAT_HISTORY_MAX_MESSAGES', 120);
const HISTORY_MAX_CHARS = envInt('CHAT_HISTORY_MAX_CHARS', 400_000);
// Mensagens/dia por usuário. Só existe pra frear um loop acidental no
// client (custo); 0 desliga.
const RATE_LIMIT_PER_DAY = envInt('CHAT_RATE_LIMIT_PER_DAY', 1000, 0);
// Streaming: teto alto pra nunca cortar tabela grande no meio. O caso
// raro que estourar emite SSE 'truncated'.
const MAX_OUTPUT_TOKENS = envInt('CHAT_MAX_OUTPUT_TOKENS', 64_000);
// Resultado de tool por chamada. fitToolResult garante JSON válido dentro
// disso (encolhe a maior lista e avisa o modelo pra paginar).
const TOOL_RESULT_MAX_BYTES = envInt('CHAT_TOOL_RESULT_MAX_BYTES', 600_000);
// Orçamento de CONTEXTO do turno (chars ≈ 3-4 por token): system +
// histórico + tudo que as tools devolveram. A janela do modelo é 1M
// tokens; 2,4M chars (~700k tokens) deixa folga pro output. Quando o
// acumulado chega perto, os resultados são encolhidos pro que sobra e a
// rodada seguinte é forçada a responder — em vez de a API devolver
// "prompt is too long" e o turno inteiro (com o texto já streamado) ir
// pro lixo.
const CONTEXT_MAX_CHARS = envInt('CHAT_CONTEXT_MAX_CHARS', 2_400_000, 100_000);
// Ping SSE (comentário ':') a cada 15s — mantém o stream vivo através de
// proxy (Traefik) durante execuções longas de tool (ex: refresh da MV),
// que antes derrubavam a conexão sem nenhum byte trafegando.
const KEEPALIVE_MS = 15_000;

// Forma persistida de cada tool call. O resultado BRUTO não vai pro banco
// (com paginação de 1000 pedidos × 30 rodadas uma mensagem pesaria MBs e
// voltaria inteira em cada GET da conversa) — a UI só usa o nome.
interface StoredToolUse {
  name: string;
  input: unknown;
  result: { ok?: boolean; bytes?: number; error?: string; truncated?: unknown };
}

function storedResult(raw: unknown, serialized: string): StoredToolUse['result'] {
  const r = raw as { error?: unknown; _truncated?: unknown } | null;
  const out: StoredToolUse['result'] = { bytes: serialized.length };
  if (r && typeof r === 'object' && r.error) out.error = String(r.error);
  if (serialized.startsWith('{"error":"result_too_large"')) out.error = 'result_too_large';
  if (serialized.includes('"_truncated":')) {
    try { out.truncated = (JSON.parse(serialized) as { _truncated?: unknown })._truncated; } catch { /* ignora */ }
  }
  return out;
}

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
  const toolCtx = uiRangeContext(body.uiState?.startAt, body.uiState?.endAt, body.uiState?.startDate, body.uiState?.endDate);

  // Rate limit: conta mensagens 'user' nas últimas 24h.
  if (RATE_LIMIT_PER_DAY > 0) {
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
          message: `Limite de ${RATE_LIMIT_PER_DAY} mensagens/dia atingido. Ajuste CHAT_RATE_LIMIT_PER_DAY no .env (0 desliga).`,
          retryAfterSeconds: 3600,
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      );
    }
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

  // Histórico: últimas N mensagens (incluindo a user recém-criada), depois
  // orçamento de caracteres cortando do INÍCIO. Resposta entregue só em
  // blocos (content vazio) entra como resumo JSON dos blocos — a API
  // rejeita texto vazio e o modelo precisa lembrar o que respondeu.
  const historyRaw = await db.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_MAX_MESSAGES,
    select: { role: true, content: true, blocks: true },
  });
  const history = historyRaw
    .reverse()
    .map((m) => {
      const text = (m.content ?? '').trim();
      if (text) return { role: m.role as 'user' | 'assistant', content: m.content };
      if (m.blocks) {
        return {
          role: m.role as 'user' | 'assistant',
          content: `[resposta entregue em blocos estruturados]\n${JSON.stringify(m.blocks).slice(0, 12_000)}`,
        };
      }
      return null;
    })
    .filter((m): m is { role: 'user' | 'assistant'; content: string } => m !== null);
  let chars = history.reduce((n, m) => n + m.content.length, 0);
  while (history.length > 1 && chars > HISTORY_MAX_CHARS) {
    chars -= history[0].content.length;
    history.shift();
  }
  // A API exige que a primeira mensagem seja do usuário.
  while (history.length > 1 && history[0].role !== 'user') history.shift();

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
    role: m.role,
    content: m.content,
  }));

  // Client desconectou (fechou a aba, F5)? O SDK aborta a chamada em voo e
  // o loop para — sem isso o servidor seguia pagando até 30 rodadas de
  // Opus pra ninguém.
  const signal = req.signal;

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

      const toolUses: StoredToolUse[] = [];
      let finalText = '';
      let finalBlocks: unknown = null;
      let persisted = false;
      // true quando o loop esgota (rodadas OU contexto) com o modelo ainda
      // pedindo tools — o pós-loop força uma resposta final em texto.
      let exhaustedWithToolUse = false;
      // Último tool_result marcado com cache_control: o prefixo da conversa
      // (system + histórico + resultados anteriores) é reaproveitado do cache
      // na rodada seguinte. Só UM breakpoint vivo nas mensagens (máx 4 por
      // request, 2 já vão no system).
      let cachedToolResult: Anthropic.ToolResultBlockParam | null = null;
      // Acumulado de contexto em chars (histórico + respostas + resultados).
      let contextChars = chars;

      // Carrega a base de conhecimento UMA vez por request — cache 60s no
      // service. O system é montado UMA vez por request: o timestamp BRT
      // fica antes das messages no prefixo de cache — se mudasse a cada
      // rodada (minuto virando no meio de uma tool), o breakpoint no
      // tool_result nunca acertaria o cache.
      const knowledgeBlock = await getKnowledgePromptBlock();
      const system = systemBlocks(new Date(), knowledgeBlock, uiTxt);
      contextChars += system.reduce((n, b) => n + b.text.length, 0);

      const requestBase = {
        model: ANTHROPIC_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        // Thinking adaptativo: o modelo decide quanto raciocinar por
        // pergunta (simples = quase nada; análise = bastante). Effort
        // controla a profundidade (env CHAT_EFFORT).
        thinking: { type: 'adaptive' as const },
        output_config: { effort: ANTHROPIC_EFFORT },
        system,
        tools: TOOLS,
      };

      async function persistAssistant(note?: string) {
        if (persisted) return;
        persisted = true;
        const content = note ? `${finalText}${finalText ? '\n\n' : ''}${note}` : finalText;
        await db.message.create({
          data: {
            conversationId,
            role: 'assistant',
            content,
            toolUses: toolUses.length > 0 ? (toolUses as never) : undefined,
            blocks: finalBlocks ? (finalBlocks as never) : undefined,
          },
        });
        await db.conversation.update({
          where: { id: conversationId },
          data: { updatedAt: new Date() },
        });
      }

      try {
        send('conversation', { id: conversationId });

        outer: for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
          if (signal.aborted) break;
          // messages.stream emite eventos enquanto o modelo gera. Forwardar
          // text_delta como SSE 'token' pra UX em tempo real.
          const ms = client.messages.stream({ ...requestBase, messages: apiMessages }, { signal });
          let stopDetails: Anthropic.Message['stop_details'] | undefined;

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
            } else if (event.type === 'message_delta') {
              // O acumulador do SDK (0.95) não copia stop_details pro
              // finalMessage — pega direto do evento.
              const d = event.delta as { stop_details?: Anthropic.Message['stop_details'] };
              if (d.stop_details) stopDetails = d.stop_details;
            }
          }

          const finalMessage = await ms.finalMessage();
          // Conteúdo completo (inclui blocos de thinking) volta pro modelo
          // na próxima rodada — obrigatório com thinking + tools.
          apiMessages.push({ role: 'assistant', content: finalMessage.content });
          contextChars += JSON.stringify(finalMessage.content).length;

          // Estourou o teto de output NO MEIO da resposta — avisa a UI e
          // fecha o turno com o que já foi streamado (raro com 64k, mas o
          // silêncio era exatamente o bug do "para sem terminar").
          if (finalMessage.stop_reason === 'max_tokens') {
            send('truncated', { reason: 'max_tokens' });
            logger.warn({ conversationId }, '[chat] resposta truncada por max_tokens');
            break;
          }

          if (finalMessage.stop_reason === 'refusal') {
            const details = stopDetails ?? finalMessage.stop_details;
            const why = details?.explanation;
            const msg = 'O modelo recusou esta resposta' + (why ? `: ${why}` : '.');
            finalText += (finalText ? '\n\n' : '') + msg;
            send('token', { text: msg });
            logger.warn({ conversationId, stop_details: details }, '[chat] refusal');
            break;
          }

          if (finalMessage.stop_reason !== 'tool_use') {
            break;
          }

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
          if (toolBlocks.length === 0) break;

          // Última volta do loop e o modelo ainda quer tools: executa os
          // tools abaixo e o pós-loop força uma resposta final em TEXTO
          // (tool_choice none) — antes o turno simplesmente MORRIA aqui,
          // sem resposta nenhuma ("começa e para").
          exhaustedWithToolUse = loop === MAX_TOOL_LOOPS - 1;

          // Sem terminal: executa TODAS as tools da rodada em PARALELO —
          // o modelo costuma pedir 2-3 consultas juntas (ex: comparar
          // períodos) e executá-las em série somava as latências. Cada
          // tool tem timeout próprio (executeTool) — nunca pendura o turno.
          const results = await Promise.all(
            toolBlocks.map((block) =>
              executeTool(block.name, block.input as Record<string, unknown>, toolCtx),
            ),
          );
          if (signal.aborted) break;

          // Orçamento de contexto: o que sobra é dividido entre os
          // resultados desta rodada. Se sobrou pouco, encolhe forte e força
          // a resposta final na próxima rodada (o modelo recebe o aviso
          // `_truncated` e responde com o que tem).
          const remaining = CONTEXT_MAX_CHARS - contextChars;
          const perResult = Math.floor(remaining / toolBlocks.length);
          const cap = Math.max(Math.min(TOOL_RESULT_MAX_BYTES, perResult), 20_000);
          if (perResult < TOOL_RESULT_MAX_BYTES / 2) {
            exhaustedWithToolUse = true;
            logger.warn({ conversationId, loop, contextChars, remaining }, '[chat] orçamento de contexto quase esgotado — forçando resposta final');
          }

          const toolResults: Anthropic.ToolResultBlockParam[] = toolBlocks.map((block, i) => {
            const serialized = fitToolResult(results[i], cap);
            const stored = storedResult(results[i], serialized);
            toolUses.push({ name: block.name, input: block.input, result: stored });
            send('tool_use_result', { name: block.name, id: block.id });
            contextChars += serialized.length;
            return {
              type: 'tool_result',
              tool_use_id: block.id,
              content: serialized,
              ...(stored.error ? { is_error: true } : {}),
            };
          });
          // Move o breakpoint de cache pro último resultado desta rodada.
          if (cachedToolResult) delete cachedToolResult.cache_control;
          cachedToolResult = toolResults[toolResults.length - 1];
          cachedToolResult.cache_control = { type: 'ephemeral' };
          apiMessages.push({ role: 'user', content: toolResults });

          if (exhaustedWithToolUse) break;
        }

        // Loop esgotado (rodadas ou contexto) com tools pendentes: força
        // UMA resposta final em TEXTO (tool_choice none) com os dados já
        // coletados — nunca mais terminar o turno em silêncio.
        if (exhaustedWithToolUse && !signal.aborted) {
          const finalMs = client.messages.stream({
            ...requestBase,
            tool_choice: { type: 'none' },
            messages: apiMessages,
          }, { signal });
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

        await persistAssistant(signal.aborted ? '_(resposta interrompida: a conexão foi fechada)_' : undefined);

        send('done', { conversationId });

        // Memória automática: fire-and-forget (não bloqueia o close do
        // stream). Extrai fatos duráveis do turno e salva como
        // KnowledgeEntry source='auto' pra conversas futuras. SÓ pra
        // ADMIN: a base de conhecimento é global/autoritativa e injeta o
        // system de TODOS os usuários — member não escreve nela.
        if (auth.user.role === 'ADMIN' && !signal.aborted) {
          void extractAndSaveMemory(userMsg, finalText);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'erro desconhecido';
        logger.error({ err, conversationId, aborted: signal.aborted }, '[chat] stream failed');
        // O que já foi streamado/coletado não se perde: persiste com a
        // nota do erro (o refetch da UI mostra o parcial em vez de sumir).
        try {
          await persistAssistant(signal.aborted
            ? '_(resposta interrompida: a conexão foi fechada)_'
            : `⚠️ _A resposta foi interrompida por um erro: ${message}_`);
        } catch (persistErr) {
          logger.error({ err: persistErr, conversationId }, '[chat] falha ao persistir parcial');
        }
        send('error', { message });
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
