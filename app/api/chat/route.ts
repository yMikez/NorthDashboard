// POST /api/chat
//   Body: { conversationId?, message, uiState?, folderId?, attachmentIds? }
//
// A rota é a casca: auth + rate limit + conversa + mensagem do usuário +
// anexos + histórico + SSE + persistência + telemetria. O loop tool-use
// mora em lib/services/chatEngine.ts (runChatTurn) — o eval roda o mesmo.
//
// SSE events: conversation | token | tool_use_start | tool_use_result
//             | citation | blocks | truncated | done | error | rate_limited
//   done = { conversationId, messageId } (messageId = resposta persistida —
//   o feedback 👍/👎 grava contra ele)

import type Anthropic from '@anthropic-ai/sdk';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth/guard';
import {
  getAnthropicClient,
  ANTHROPIC_MODEL,
  ANTHROPIC_EFFORT,
  systemBlocks,
  buildTurnContext,
} from '@/lib/services/ai';
import { getKnowledgePromptBlock } from '@/lib/services/knowledge';
import { extractAndSaveMemory } from '@/lib/services/chatMemory';
import { TOOLS, uiRangeContext } from '@/lib/services/aiTools';
import { runChatTurn } from '@/lib/services/chatEngine';
import { buildApiHistory } from '@/lib/services/chatHistory';
import { saveTurnLog } from '@/lib/services/chatTelemetry';
import { claimAttachments, loadMessageAttachments } from '@/lib/rag/attachments';
import { ResultStore } from '@/lib/ai/resultStore';
import { SourceRegistry } from '@/lib/rag/citations';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface UiState {
  route?: string;
  preset?: string;
  // Rótulos (YYYY-MM-DD, dia civil do que a tela mostra) — só pro texto.
  startDate?: string;
  endDate?: string;
  // Instantes exatos (ISO) que as abas usam nas queries — viram o default
  // das tools, pra o chat consultar EXATAMENTE o que está na tela.
  startAt?: string;
  endAt?: string;
  platforms?: string[];
  families?: string[];
  stages?: string[];
  countries?: string[];
  // affiliate_id do NorthScale Afiliados (filtro "Afiliado" da SPA/chat).
  affiliates?: string[];
}

interface RequestBody {
  conversationId?: string;
  message?: string;
  // Pasta onde a conversa NOVA nasce (ignorado quando conversationId vem).
  folderId?: string | null;
  uiState?: UiState;
  // Anexos já enviados por POST /api/chat/attachments (status READY).
  attachmentIds?: string[];
}

// Sanitiza e serializa o uiState num bloco curto de texto. Free-form do
// client — só strings curtas passam, listas capadas em 10 itens.
function uiStateText(ui: UiState | undefined): string {
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
  const aff = arr(ui.affiliates);
  if (aff.length) {
    // Só algumas tools aplicam o filtro — o modelo precisa saber onde ele
    // vale pra não dizer "filtrado" num número que não está.
    parts.push(
      'afiliado (affiliate_id NorthScale): ' + aff.join(', ') +
        ' — como os outros filtros da UI, vale como default só em perguntas dêiticas (em perguntas gerais não herde); nelas passe em affiliate_ids nas tools que aceitam (visão geral, afiliados, detalhe, funil, funil por janelas, ' +
        'produtos, famílias, plataformas, transações, lucro front×back, custos, fulfillment, coortes de reembolso). ' +
        'Call center, recuperação, SMS, saúde e as análises por janela de afiliados NÃO filtram por afiliado — ' +
        'se usar alguma delas, diga que o número é do total.',
    );
  }
  return parts.length ? `\n# Estado da UI (o que o usuário está vendo agora)\n${parts.join(' · ')}` : '';
}

function envInt(name: string, fallback: number, min = 1): number {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

// Histórico enviado ao modelo: últimas N mensagens E no máximo X chars de
// texto (anexos contam à parte e nunca são cortados).
const HISTORY_MAX_MESSAGES = envInt('CHAT_HISTORY_MAX_MESSAGES', 120);
const HISTORY_MAX_CHARS = envInt('CHAT_HISTORY_MAX_CHARS', 400_000);
// Mensagens/dia por usuário — só freia loop acidental no client; 0 desliga.
const RATE_LIMIT_PER_DAY = envInt('CHAT_RATE_LIMIT_PER_DAY', 1000, 0);
// Orçamento de anexos INLINE por conversa (PDF/imagem/texto inteiros no
// contexto). Acima disso o anexo vai indexado (busca + leitura por páginas).
const ATTACH_INLINE_BUDGET_TOKENS = envInt('CHAT_ATTACH_INLINE_BUDGET_TOKENS', 150_000, 0);
const MAX_ATTACHMENTS_PER_MESSAGE = 5;
// Ping SSE a cada 15s — segura o stream no proxy durante tool longa.
const KEEPALIVE_MS = 15_000;

export async function POST(req: Request) {
  // Aberto a QUALQUER usuário logado (2026-08-03) — conversas são
  // escopadas por userId em todas as queries.
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const user = auth.user;

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return new Response(JSON.stringify({ error: 'invalid body' }), { status: 400 });
  }

  const attachmentIds = Array.isArray(body.attachmentIds)
    ? [...new Set(body.attachmentIds.filter((x): x is string => typeof x === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(x)))]
    : [];
  if (attachmentIds.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return new Response(JSON.stringify({ error: `no máximo ${MAX_ATTACHMENTS_PER_MESSAGE} anexos por mensagem` }), { status: 400 });
  }
  let userMsg = (body.message ?? '').trim();
  if (!userMsg && attachmentIds.length === 0) {
    return new Response(JSON.stringify({ error: 'message vazio' }), { status: 400 });
  }
  if (!userMsg) userMsg = attachmentIds.length === 1 ? 'Analise o anexo.' : 'Analise os anexos.';

  const now = new Date();
  const uiTxt = uiStateText(body.uiState);
  const turnContext = buildTurnContext(now, uiTxt);

  // Rate limit: conta mensagens 'user' nas últimas 24h.
  if (RATE_LIMIT_PER_DAY > 0) {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const recentCount = await db.message.count({
      where: { role: 'user', createdAt: { gte: since }, conversation: { userId: user.id } },
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
  let createdConversation = false;
  if (!conversationId) {
    let folderId: string | null = null;
    if (body.folderId) {
      const folder = await db.chatFolder.findUnique({ where: { id: body.folderId }, select: { userId: true } });
      if (folder && folder.userId === user.id) folderId = body.folderId;
    }
    const created = await db.conversation.create({
      data: { userId: user.id, title: userMsg.slice(0, 60), folderId },
      select: { id: true },
    });
    conversationId = created.id;
    createdConversation = true;
  } else {
    const existing = await db.conversation.findUnique({ where: { id: conversationId }, select: { userId: true } });
    if (!existing || existing.userId !== user.id) {
      return new Response(JSON.stringify({ error: 'conversation não encontrada' }), { status: 404 });
    }
  }

  const userRow = await db.message.create({
    data: { conversationId, role: 'user', content: userMsg, turnContext },
    select: { id: true },
  });

  // Anexos: dono, READY, sem conversa ou desta conversa — liga à mensagem.
  if (attachmentIds.length) {
    const claim = await claimAttachments(user.id, conversationId, userRow.id, attachmentIds);
    if (!claim.ok) {
      await db.message.delete({ where: { id: userRow.id } }).catch(() => undefined);
      if (createdConversation) await db.conversation.delete({ where: { id: conversationId } }).catch(() => undefined);
      return new Response(JSON.stringify({ error: claim.error ?? 'anexo inválido' }), { status: 400 });
    }
  }

  let client: Anthropic;
  try {
    client = getAnthropicClient();
  } catch (err) {
    logger.error({ err }, '[chat] anthropic client init failed');
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY não configurada no servidor' }), { status: 500 });
  }

  const rows = await db.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_MAX_MESSAGES,
    select: { id: true, role: true, content: true, blocks: true, toolUses: true, turnContext: true, createdAt: true },
  });
  const userMessageIds = rows.filter((r) => r.role === 'user').map((r) => r.id);
  const attachmentsByMessage = await loadMessageAttachments(user.id, conversationId, userMessageIds);
  const sources = new SourceRegistry();
  const history = await buildApiHistory(rows, attachmentsByMessage, {
    maxMessages: HISTORY_MAX_MESSAGES,
    maxChars: HISTORY_MAX_CHARS,
    inlineBudgetTokens: ATTACH_INLINE_BUDGET_TOKENS,
    sources,
  });
  if (history.messages.length === 0) {
    return new Response(JSON.stringify({ error: 'histórico vazio' }), { status: 400 });
  }

  const knowledgeBlock = await getKnowledgePromptBlock();
  const system = systemBlocks(knowledgeBlock);
  const conversationAttachments = [...attachmentsByMessage.values()].flat();
  const toolCtx = {
    ...uiRangeContext(body.uiState?.startAt, body.uiState?.endAt, body.uiState?.startDate, body.uiState?.endDate),
    user: { id: user.id, role: user.role, allowedTabs: user.allowedTabs as string[] },
    conversationId,
    results: new ResultStore(),
    sources,
    attachments: conversationAttachments,
    now,
    signal: req.signal,
  };
  const initialContextChars =
    history.chars + history.attachmentTokens * 3 + system.reduce((n, b) => n + b.text.length, 0);

  // Client desconectou (fechou a aba, F5)? O SDK aborta a chamada em voo.
  const signal = req.signal;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      function send(event: string, data: unknown) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true; // client desconectou — não derruba o processamento
        }
      }
      const keepalive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          closed = true;
        }
      }, KEEPALIVE_MS);

      try {
        send('conversation', { id: conversationId });
        const result = await runChatTurn(
          {
            client,
            model: ANTHROPIC_MODEL,
            effort: ANTHROPIC_EFFORT,
            system,
            messages: history.messages,
            tools: TOOLS,
            toolCtx,
            initialContextChars,
            signal,
          },
          {
            token: (text) => send('token', { text }),
            toolStart: (name, id) => send('tool_use_start', { name, id }),
            toolResult: (r) => send('tool_use_result', r),
            citation: (c) => send('citation', c),
            blocks: (blocks) => send('blocks', { blocks }),
            truncated: (reason) => send('truncated', { reason }),
          },
        );

        // O que já foi streamado/coletado nunca se perde: persiste com nota.
        let note: string | undefined;
        if (result.status === 'aborted') note = '_(resposta interrompida: a conexão foi fechada)_';
        else if (result.status === 'error') note = `⚠️ _A resposta foi interrompida por um erro: ${result.error ?? 'erro desconhecido'}_`;
        const content = note ? `${result.text}${result.text ? '\n\n' : ''}${note}` : result.text;
        const saved = await db.message.create({
          data: {
            conversationId,
            role: 'assistant',
            content,
            toolUses: result.toolUses.length ? (result.toolUses as never) : undefined,
            blocks: result.blocks ? (result.blocks as never) : undefined,
            citations: result.citations.length ? (result.citations as never) : undefined,
          },
          select: { id: true },
        });
        await db.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });

        if (result.status === 'error') send('error', { message: result.error ?? 'erro desconhecido' });
        send('done', { conversationId, messageId: saved.id });

        void saveTurnLog(result, {
          messageId: saved.id,
          conversationId,
          userId: user.id,
          model: ANTHROPIC_MODEL,
          effort: ANTHROPIC_EFFORT,
        }).catch((err) => logger.warn({ err }, '[chat] telemetria falhou'));

        // Memória automática (só ADMIN escreve na base global). Pulada em
        // conversa com anexo: conteúdo de arquivo (dado de cliente) não pode
        // virar "fato" da base.
        if (user.role === 'ADMIN' && result.status === 'ok' && conversationAttachments.length === 0) {
          void extractAndSaveMemory(userMsg, result.text);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'erro desconhecido';
        logger.error({ err, conversationId, aborted: signal.aborted }, '[chat] stream failed');
        send('error', { message });
      } finally {
        clearInterval(keepalive);
        closed = true;
        try {
          controller.close();
        } catch {
          /* já fechado pelo client */
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
