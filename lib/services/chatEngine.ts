// Motor de UM turno do chat IA — o loop tool-use que antes vivia dentro da
// rota SSE. A rota (app/api/chat/route.ts) e o eval (lib/services/chatEval)
// chamam a MESMA função: o eval mede exatamente o caminho de produção.
//
// O que o motor faz além do loop:
//   - citações nativas: citations_delta do stream → registro de fontes →
//     marcador [[cite:n]] no texto + evento 'citation';
//   - tools que devolvem BLOCOS (search_result/document) vão como content
//     array (é o que liga a citação), o resto como JSON via fitToolResult;
//   - ResultStore: resultado COMPLETO de cada tool (pré-truncamento) com ref
//     $rN, base das tools de cálculo e da checagem de números;
//   - trava da tool terminal: respond_with_blocks junto com consultas na
//     mesma rodada = blocos escritos sem dado; as consultas rodam e a terminal
//     volta com erro pedindo pra ser chamada sozinha;
//   - grounding: número dos blocos que não bate com nenhum resultado volta
//     como erro UMA vez pro modelo corrigir (CHAT_GROUNDING=enforce|shadow|off);
//   - telemetria por rodada (tokens, cache, latência, tools).
//
// Nunca lança por erro de API/stream: devolve status 'error' com o parcial
// (a rota persiste o que já foi streamado).

import type Anthropic from '@anthropic-ai/sdk';
import type { ChatEffort } from './ai';
import { executeTool, fitToolResult, TERMINAL_TOOL, type ToolContext } from './aiTools';
import { ResultStore } from '../ai/resultStore';
import { SourceRegistry, citeMarker, type Citation } from '../rag/citations';
import { isContentResult } from '../ai/toolTypes';
import { verifyBlockNumbers } from '../ai/grounding';
import { logger } from '../logger';

export interface TurnEvents {
  token?(text: string): void;
  toolStart?(name: string, id: string): void;
  toolResult?(r: { name: string; id: string; ok: boolean; bytes: number; truncated: boolean; ms: number }): void;
  blocks?(blocks: unknown[]): void;
  truncated?(reason: string): void;
  citation?(c: Citation): void;
}

export interface StoredToolUse {
  name: string;
  input: unknown;
  result: { ok?: boolean; bytes?: number; error?: string; truncated?: unknown; ref?: string };
}

export interface ToolTrace {
  name: string;
  id: string;
  input: unknown;
  ms: number;
  bytes: number;
  error?: string;
  truncated?: boolean;
  ref?: string;
}

export interface RoundTrace {
  round: number;
  model: string;
  stopReason: string | null;
  modelMs: number;
  ttftMs: number | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
  tools: ToolTrace[];
}

export type TurnStatus = 'ok' | 'max_tokens' | 'refusal' | 'aborted' | 'error';

export interface TurnResult {
  text: string;
  blocks: unknown[] | null;
  citations: Citation[];
  toolUses: StoredToolUse[];
  rounds: RoundTrace[];
  status: TurnStatus;
  forcedFinal: boolean;
  truncatedResults: number;
  contextCharsPeak: number;
  latencyMs: number;
  ttftMs: number | null;
  /** Números dos blocos sem fonte na tentativa FINAL (vazio = todos conferem). */
  ungrounded: string[];
  error?: string;
  /** Só com captureRaw (eval): resultado bruto de cada tool. */
  raw?: Array<{ name: string; input: unknown; value: unknown }>;
}

export interface TurnInput {
  client: Anthropic;
  model: string;
  effort: ChatEffort;
  system: Anthropic.TextBlockParam[];
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
  toolCtx: ToolContext;
  /** Chars já no contexto (system + histórico) — orçamento do turno. */
  initialContextChars: number;
  signal?: AbortSignal;
  maxLoops?: number;
  maxOutputTokens?: number;
  toolResultMaxBytes?: number;
  contextMaxChars?: number;
  groundingMode?: 'enforce' | 'shadow' | 'off';
  captureRaw?: boolean;
}

function envInt(name: string, fallback: number, min = 1): number {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

export const ENGINE_DEFAULTS = {
  maxLoops: envInt('CHAT_MAX_TOOL_LOOPS', 30),
  maxOutputTokens: envInt('CHAT_MAX_OUTPUT_TOKENS', 64_000),
  toolResultMaxBytes: envInt('CHAT_TOOL_RESULT_MAX_BYTES', 600_000),
  contextMaxChars: envInt('CHAT_CONTEXT_MAX_CHARS', 2_400_000, 100_000),
  groundingMode: ((): 'enforce' | 'shadow' | 'off' => {
    const v = (process.env.CHAT_GROUNDING ?? '').trim().toLowerCase();
    return v === 'shadow' || v === 'off' ? v : 'enforce';
  })(),
};

/** Resultado da tool com a ref $rN no topo (o modelo usa nas tools de cálculo). */
function withRef(value: unknown, ref: string): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value) && !('error' in (value as object))) {
    return { _ref: ref, ...(value as Record<string, unknown>) };
  }
  return value;
}

function storedResult(raw: unknown, serialized: string, ref?: string): StoredToolUse['result'] {
  const r = raw as { error?: unknown } | null;
  const out: StoredToolUse['result'] = { bytes: serialized.length };
  if (ref) out.ref = ref;
  if (r && typeof r === 'object' && r.error) out.error = String(r.error);
  if (serialized.startsWith('{"error":"result_too_large"')) out.error = 'result_too_large';
  if (serialized.includes('"_truncated":')) {
    try {
      out.truncated = (JSON.parse(serialized) as { _truncated?: unknown })._truncated;
    } catch {
      /* ignora */
    }
  }
  return out;
}

function compactInput(input: unknown): unknown {
  try {
    const s = JSON.stringify(input ?? {});
    return s.length > 2000 ? { _truncatedInput: s.slice(0, 2000) } : input;
  } catch {
    return null;
  }
}

export async function runChatTurn(input: TurnInput, ev: TurnEvents = {}): Promise<TurnResult> {
  const t0 = Date.now();
  const maxLoops = input.maxLoops ?? ENGINE_DEFAULTS.maxLoops;
  const maxOut = input.maxOutputTokens ?? ENGINE_DEFAULTS.maxOutputTokens;
  const toolMax = input.toolResultMaxBytes ?? ENGINE_DEFAULTS.toolResultMaxBytes;
  const ctxMax = input.contextMaxChars ?? ENGINE_DEFAULTS.contextMaxChars;
  const grounding = input.groundingMode ?? ENGINE_DEFAULTS.groundingMode;
  const signal = input.signal;

  const ctx: ToolContext = { ...input.toolCtx };
  const store = ctx.results ?? new ResultStore();
  const sources = ctx.sources ?? new SourceRegistry();
  ctx.results = store;
  ctx.sources = sources;

  const apiMessages = input.messages;
  const result: TurnResult = {
    text: '',
    blocks: null,
    citations: [],
    toolUses: [],
    rounds: [],
    status: 'ok',
    forcedFinal: false,
    truncatedResults: 0,
    contextCharsPeak: input.initialContextChars,
    latencyMs: 0,
    ttftMs: null,
    ungrounded: [],
    ...(input.captureRaw ? { raw: [] } : {}),
  };
  let contextChars = input.initialContextChars;
  let cachedToolResult: Anthropic.ToolResultBlockParam | null = null;
  let groundingRetries = 0;
  const emittedCitations = new Set<number>();

  const requestBase = {
    model: input.model,
    max_tokens: maxOut,
    // Thinking adaptativo: o modelo decide quanto raciocinar por pergunta.
    thinking: { type: 'adaptive' as const },
    output_config: { effort: input.effort },
    system: input.system,
    tools: input.tools,
  };

  const emitText = (t: string) => {
    if (!t) return;
    result.text += t;
    if (result.ttftMs == null) result.ttftMs = Date.now() - t0;
    ev.token?.(t);
  };

  /** Consome UM stream: texto, citações por bloco, início de tool_use. */
  interface Consumed {
    finalMessage: Anthropic.Message;
    stopDetails: Anthropic.Message['stop_details'] | undefined;
    modelMs: number;
    ttftMs: number | null;
  }
  async function consume(ms: ReturnType<Anthropic['messages']['stream']>): Promise<Consumed> {
    let stopDetails: Anthropic.Message['stop_details'] | undefined;
    let firstTokenAt: number | null = null;
    const started = Date.now();
    const blockType = new Map<number, string>();
    const blockCites = new Map<number, Anthropic.TextCitation[]>();
    for await (const event of ms) {
      if (event.type === 'content_block_start') {
        blockType.set(event.index, event.content_block.type);
        if (event.content_block.type === 'tool_use') ev.toolStart?.(event.content_block.name, event.content_block.id);
      } else if (event.type === 'content_block_delta') {
        const d = event.delta;
        if (d.type === 'text_delta') {
          if (firstTokenAt == null) firstTokenAt = Date.now();
          emitText(d.text);
        } else if (d.type === 'citations_delta') {
          const list = blockCites.get(event.index) ?? [];
          list.push(d.citation);
          blockCites.set(event.index, list);
        }
      } else if (event.type === 'content_block_stop') {
        const cites = blockCites.get(event.index);
        if (cites?.length && blockType.get(event.index) === 'text') {
          const ns: number[] = [];
          for (const c of cites) {
            const resolved = sources.resolve(c);
            if (!resolved) continue;
            if (!ns.includes(resolved.n)) ns.push(resolved.n);
            if (!emittedCitations.has(resolved.n)) {
              emittedCitations.add(resolved.n);
              ev.citation?.(resolved);
            }
          }
          if (ns.length) emitText(ns.map(citeMarker).join(''));
        }
      } else if (event.type === 'message_delta') {
        // O acumulador do SDK (0.95) não copia stop_details pro finalMessage.
        const d = event.delta as { stop_details?: Anthropic.Message['stop_details'] };
        if (d.stop_details) stopDetails = d.stop_details;
      }
    }
    const finalMessage: Anthropic.Message = await ms.finalMessage();
    return { finalMessage, stopDetails, modelMs: Date.now() - started, ttftMs: firstTokenAt ? firstTokenAt - started : null };
  }

  function trace(round: number, fm: Anthropic.Message, modelMs: number, ttftMs: number | null): RoundTrace {
    const u = fm.usage as Anthropic.Usage;
    const rt: RoundTrace = {
      round,
      model: fm.model,
      stopReason: fm.stop_reason,
      modelMs,
      ttftMs,
      usage: {
        input_tokens: u?.input_tokens ?? 0,
        output_tokens: u?.output_tokens ?? 0,
        cache_read_input_tokens: u?.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: u?.cache_creation_input_tokens ?? 0,
      },
      tools: [],
    };
    result.rounds.push(rt);
    return rt;
  }

  let exhaustedWithToolUse = false;
  try {
    outer: for (let loop = 0; loop < maxLoops; loop++) {
      if (signal?.aborted) break;
      const ms = input.client.messages.stream({ ...requestBase, messages: apiMessages }, { signal });
      const { finalMessage, stopDetails, modelMs, ttftMs } = await consume(ms);
      const rt = trace(loop, finalMessage, modelMs, ttftMs);
      // Conteúdo completo (inclui thinking) volta pro modelo na próxima rodada.
      apiMessages.push({ role: 'assistant', content: finalMessage.content });
      contextChars += JSON.stringify(finalMessage.content).length;
      result.contextCharsPeak = Math.max(result.contextCharsPeak, contextChars);

      if (finalMessage.stop_reason === 'max_tokens') {
        result.status = 'max_tokens';
        ev.truncated?.('max_tokens');
        logger.warn({ conversationId: ctx.conversationId }, '[chat] resposta truncada por max_tokens');
        break;
      }
      if (finalMessage.stop_reason === 'refusal') {
        const why = (stopDetails ?? finalMessage.stop_details)?.explanation;
        emitText((result.text ? '\n\n' : '') + 'O modelo recusou esta resposta' + (why ? `: ${why}` : '.'));
        result.status = 'refusal';
        logger.warn({ conversationId: ctx.conversationId }, '[chat] refusal');
        break;
      }
      if (finalMessage.stop_reason !== 'tool_use') break;

      const toolBlocks = finalMessage.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (toolBlocks.length === 0) break;
      const terminal = toolBlocks.find((b) => b.name === TERMINAL_TOOL);
      const dataBlocks = toolBlocks.filter((b) => b.name !== TERMINAL_TOOL);

      // ── Terminal SOZINHA: confere os números e entrega ────────────────
      if (terminal && dataBlocks.length === 0) {
        const tin = terminal.input as { blocks?: unknown; sources?: unknown };
        const blocks = Array.isArray(tin?.blocks) ? (tin.blocks as unknown[]) : null;
        const report = blocks && grounding !== 'off' ? verifyBlockNumbers(blocks, store) : { unmatched: [], checked: 0 };
        if (report.unmatched.length && grounding === 'enforce' && groundingRetries === 0) {
          groundingRetries += 1;
          const list = report.unmatched.slice(0, 15).join(', ');
          const tr: Anthropic.ToolResultBlockParam = {
            type: 'tool_result',
            tool_use_id: terminal.id,
            is_error: true,
            content: `Números sem fonte nos blocos: ${list}. Todo número exibido precisa vir de um resultado de tool ou de calc. Recalcule com calc (referenciando $rN) ou corrija, e chame respond_with_blocks de novo — sozinho.`,
          };
          rt.tools.push({ name: terminal.name, id: terminal.id, input: { grounding: 'retry' }, ms: 0, bytes: 0, error: 'ungrounded' });
          apiMessages.push({ role: 'user', content: [tr] });
          logger.info({ conversationId: ctx.conversationId, unmatched: report.unmatched.length }, '[chat] grounding: pedindo correção dos blocos');
          continue;
        }
        result.ungrounded = report.unmatched;
        result.blocks = blocks;
        if (Array.isArray(tin?.sources)) {
          for (const s of tin.sources) {
            if (typeof s !== 'string') continue;
            const c = sources.markConsulted(s);
            if (c && !emittedCitations.has(c.n)) {
              emittedCitations.add(c.n);
              ev.citation?.(c);
            }
          }
        }
        result.toolUses.push({ name: terminal.name, input: terminal.input, result: { ok: true } });
        ev.toolResult?.({ name: terminal.name, id: terminal.id, ok: true, bytes: 0, truncated: false, ms: 0 });
        if (blocks) ev.blocks?.(blocks);
        break outer;
      }

      exhaustedWithToolUse = loop === maxLoops - 1;

      // ── Consultas: em PARALELO, cada uma com timeout próprio ───────────
      store.nextRound();
      const startedAt = dataBlocks.map(() => Date.now());
      const raws = await Promise.all(
        dataBlocks.map(async (block, i) => {
          startedAt[i] = Date.now();
          const v = await executeTool(block.name, block.input as Record<string, unknown>, ctx);
          return { v, ms: Date.now() - startedAt[i] };
        }),
      );
      if (signal?.aborted) break;

      const remaining = ctxMax - contextChars;
      const perResult = Math.floor(remaining / Math.max(1, dataBlocks.length));
      const cap = Math.max(Math.min(toolMax, perResult), 20_000);
      if (perResult < toolMax / 2) {
        exhaustedWithToolUse = true;
        logger.warn({ conversationId: ctx.conversationId, loop, contextChars, remaining }, '[chat] orçamento de contexto quase esgotado — forçando resposta final');
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = dataBlocks.map((block, i) => {
        const { v: raw, ms } = raws[i];
        if (input.captureRaw) result.raw!.push({ name: block.name, input: block.input, value: raw });
        if (isContentResult(raw)) {
          const content = raw.__content;
          const size = JSON.stringify(content).length;
          contextChars += size;
          result.toolUses.push({ name: block.name, input: block.input, result: { ok: true, bytes: size } });
          rt.tools.push({ name: block.name, id: block.id, input: compactInput(block.input), ms, bytes: size });
          ev.toolResult?.({ name: block.name, id: block.id, ok: true, bytes: size, truncated: false, ms });
          return { type: 'tool_result', tool_use_id: block.id, content };
        }
        const isErr = !!(raw && typeof raw === 'object' && (raw as { error?: unknown }).error);
        const ref = isErr ? undefined : store.put(block.name, block.input, raw);
        const serialized = fitToolResult(ref ? withRef(raw, ref) : raw, cap);
        const stored = storedResult(raw, serialized, ref);
        if (stored.truncated) result.truncatedResults += 1;
        result.toolUses.push({ name: block.name, input: block.input, result: stored });
        rt.tools.push({ name: block.name, id: block.id, input: compactInput(block.input), ms, bytes: serialized.length, error: stored.error, truncated: !!stored.truncated, ref });
        ev.toolResult?.({ name: block.name, id: block.id, ok: !stored.error, bytes: serialized.length, truncated: !!stored.truncated, ms });
        contextChars += serialized.length;
        return { type: 'tool_result', tool_use_id: block.id, content: serialized, ...(stored.error ? { is_error: true } : {}) };
      });

      // Terminal junto com consultas: os blocos foram escritos SEM o dado.
      if (terminal) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: terminal.id,
          is_error: true,
          content: 'respond_with_blocks foi chamado na mesma rodada das consultas — os blocos não podem ter usado esses resultados. Leia os resultados acima e chame respond_with_blocks SOZINHO na próxima rodada.',
        });
        rt.tools.push({ name: terminal.name, id: terminal.id, input: { guard: 'same_round' }, ms: 0, bytes: 0, error: 'terminal_with_data' });
      }

      result.contextCharsPeak = Math.max(result.contextCharsPeak, contextChars);
      if (cachedToolResult) delete cachedToolResult.cache_control;
      cachedToolResult = toolResults[toolResults.length - 1];
      cachedToolResult.cache_control = { type: 'ephemeral' };
      apiMessages.push({ role: 'user', content: toolResults });
      if (exhaustedWithToolUse) break;
    }

    // Loop esgotado com tools pendentes: UMA resposta final em texto.
    if (exhaustedWithToolUse && !signal?.aborted) {
      result.forcedFinal = true;
      const finalMs = input.client.messages.stream({ ...requestBase, tool_choice: { type: 'none' }, messages: apiMessages }, { signal });
      const { finalMessage, modelMs, ttftMs } = await consume(finalMs);
      trace(result.rounds.length, finalMessage, modelMs, ttftMs);
      if (finalMessage.stop_reason === 'max_tokens') {
        result.status = 'max_tokens';
        ev.truncated?.('max_tokens');
      }
    }
    if (signal?.aborted) result.status = 'aborted';
  } catch (err) {
    result.status = signal?.aborted ? 'aborted' : 'error';
    result.error = err instanceof Error ? err.message : String(err);
    logger.error({ err, conversationId: ctx.conversationId, aborted: signal?.aborted }, '[chat] turno falhou');
  }

  result.citations = sources.citations();
  result.latencyMs = Date.now() - t0;
  return result;
}
