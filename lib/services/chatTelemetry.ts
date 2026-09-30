// Qualidade do chat IA: telemetria por turno (ChatTurnLog), feedback 👍/👎
// (ChatFeedback) e as leituras do painel admin "Qualidade da IA".
//
// Por que existe: sem isso nada dizia se as respostas estavam certas, quanto
// custavam ou se o cache funcionava — usage/latência eram jogados fora e o
// voto do usuário vivia só no estado do componente.
//
// Privacidade (regra "nem admin lê chat alheio"): o log NÃO guarda texto do
// usuário nem resultado bruto de tool. Guarda tokens, tempos, nomes/inputs
// de tool já sem campos de PII e sem texto livre, e — quando o chamador
// entrega os resultados — um resumo numérico (digest) + hash de cada um.
// Pergunta e resposta só aparecem pro admin via feedback com shared=true
// (consentimento explícito de quem votou).

import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { TurnResult, RoundTrace, ToolTrace } from './chatEngine';
import { roundsCostUsd } from './chatPricing';
import { stablePromptText } from './ai';
import { TOOLS, TERMINAL_TOOL, executeTool, fitToolResult, uiRangeContext, type ToolInput } from './aiTools';
import { getKnowledgePromptBlock } from './knowledge';
import { isContentResult } from '../ai/toolTypes';
import { renderBlocksToText } from '../chat/format';
import { db } from '../db';
import { logger } from '../logger';

// ── Tipos ───────────────────────────────────────────────────────────────

/** Leitura mínima dos resultados completos do turno (ResultStore). */
export interface TurnResultsReader {
  all(): ReadonlyArray<{ ref: string; value: unknown }>;
}

export interface TurnLogMeta {
  messageId: string | null;
  conversationId: string | null;
  userId: string | null;
  evalRunId?: string | null;
  model: string;
  effort: string;
  knowledgeHash?: string | null;
  /**
   * Resultados completos do turno (toolCtx.results). Opcional: com eles o
   * trace ganha digest + hash por tool e o replay do admin mostra o que
   * mudou; sem eles o replay só compara tamanho.
   */
  results?: TurnResultsReader | null;
}

/** Tool no trace persistido (sem resultado bruto). */
export interface StoredToolTrace {
  name: string;
  id: string;
  input: unknown;
  ms: number;
  bytes: number;
  error?: string;
  truncated?: boolean;
  ref?: string;
  /** sha256 (16 hex) do resultado completo — muda quando o dado muda. */
  hash?: string;
  /** Escalares até profundidade 2 + tamanho das listas (sem PII). */
  digest?: unknown;
}

export interface StoredRoundTrace extends Omit<RoundTrace, 'tools'> {
  tools: StoredToolTrace[];
}

export interface TurnLogData {
  messageId: string | null;
  conversationId: string | null;
  userId: string | null;
  evalRunId: string | null;
  model: string;
  effort: string;
  promptVersion: string;
  knowledgeHash: string | null;
  status: string;
  rounds: number;
  toolCalls: number;
  toolErrors: number;
  truncatedResults: number;
  forcedFinal: boolean;
  usedBlocks: boolean;
  ungroundedNumbers: number;
  error: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number | null;
  ttftMs: number | null;
  latencyMs: number;
  toolMs: number;
  contextCharsPeak: number;
  trace: StoredRoundTrace[];
}

// ── Hash / digest / limpeza de PII ──────────────────────────────────────

export function sha256Hex(text: string, len = 64): string {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, len);
}

function stableJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? 'null';
  } catch {
    return 'null';
  }
}

/** Hash curto do resultado — igual entre execuções ⇔ mesmo dado. */
export function resultHash(value: unknown): string {
  // _meta muda com o relógio (range.endBrt/hoursElapsedToday, ressalvas de
  // cobertura com "há Nh") sem o dado mudar — fora do hash, senão o replay
  // acusa "dado mudou" à toa.
  if (value && typeof value === 'object' && !Array.isArray(value) && '_meta' in value) {
    const { _meta: _clock, ...data } = value as Record<string, unknown>;
    return sha256Hex(stableJson(data), 16);
  }
  return sha256Hex(stableJson(value), 16);
}

// Chaves que carregam dado de cliente/pessoa: nunca entram no log.
const PII_KEY = /(e-?mail|phone|telefone|^name$|^nome$|first_?name|last_?name|sobrenome|nome_?completo|buyer|customer|cliente|address|endereco|^ip$|ip_?address|cpf|document)/i;
// Chaves de texto livre derivado da pergunta (busca, cálculo sobre anexo…):
// o valor vira só o tamanho — o log não pode reconstruir a conversa.
const FREE_TEXT_KEY = /^(query|queries|q|question|pergunta|text|texto|prompt|message|content|comment|expected|where|filter|filters)$/i;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Só formatos inequívocos de telefone (+DDI… ou (DDD) 9xxxx-xxxx): um
// padrão genérico de "muitos dígitos" mascararia datas ISO e IDs de
// afiliado/pedido — e o trace perderia justamente o que o replay precisa.
const PHONE_RE = /\+\d[\d\s().-]{8,}\d|\(\d{2,3}\)\s?\d{4,5}-?\d{4}/g;

function maskString(s: string, max: number): string {
  const masked = s.replace(EMAIL_RE, '[email]').replace(PHONE_RE, '[telefone]');
  return masked.length > max ? `${masked.slice(0, max)}…` : masked;
}

/**
 * Input de tool pronto pro log: sem chaves de PII, texto livre reduzido ao
 * tamanho, e-mail/telefone mascarados em qualquer string, profundidade e
 * tamanho limitados. Input que o motor já cortou (_truncatedInput = prefixo
 * de JSON cru) não é confiável pra limpar — sai só o tamanho.
 */
export function scrubToolInput(input: unknown): unknown {
  if (input && typeof input === 'object' && !Array.isArray(input) && '_truncatedInput' in (input as object)) {
    const raw = (input as { _truncatedInput?: unknown })._truncatedInput;
    return { _omitido: 'input grande demais', chars: typeof raw === 'string' ? raw.length : 0 };
  }
  return scrub(input, 0);
}

function scrub(v: unknown, depth: number): unknown {
  if (v == null || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return maskString(v, 200);
  if (depth >= 4) return '[…]';
  if (Array.isArray(v)) return v.slice(0, 30).map((x) => scrub(x, depth + 1));
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (PII_KEY.test(k)) continue;
      // `filters` OBJETO é escopo estruturado (compare_periods: plataformas,
      // famílias…) e vai pro log como o resto; `filters`/`where` em LISTA são
      // condições sobre valores (anexo do usuário) e seguem omitidos.
      const structuredScope = k === 'filters' && !!val && typeof val === 'object' && !Array.isArray(val);
      if (FREE_TEXT_KEY.test(k) && !structuredScope) {
        out[k] = { _omitido: 'texto', chars: stableJson(val).length };
        continue;
      }
      out[k] = scrub(val, depth + 1);
    }
    return out;
  }
  return String(v);
}

const DIGEST_MAX_BYTES = 8_192;

function scalarOrNull(v: unknown): v is string | number | boolean | null {
  return v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

function digestScalar(v: string | number | boolean | null): string | number | boolean | null {
  return typeof v === 'string' ? maskString(v, 120) : v;
}

function scalarFields(item: unknown): unknown {
  if (scalarOrNull(item)) return digestScalar(item);
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
    if (PII_KEY.test(k) || !scalarOrNull(v)) continue;
    out[k] = digestScalar(v);
  }
  return out;
}

function digestNode(node: Record<string, unknown>, depth: number, withSamples: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (PII_KEY.test(k) || v === undefined) continue;
    if (scalarOrNull(v)) out[k] = digestScalar(v);
    else if (Array.isArray(v)) {
      out[k] = withSamples && depth === 0 ? { _len: v.length, first3: v.slice(0, 3).map(scalarFields) } : { _len: v.length };
    } else if (typeof v === 'object' && depth < 1) {
      out[k] = digestNode(v as Record<string, unknown>, depth + 1, withSamples);
    }
  }
  return out;
}

/**
 * Resumo auditável de um resultado de tool: escalares até profundidade 2,
 * listas como {_len, first3 (campos escalares dos 3 primeiros itens)}, sem
 * chaves de PII, ≤ 8 KB. É o que o replay compara ("o número que o modelo
 * viu era X; hoje a tool devolve Y").
 */
export function digestResult(value: unknown): unknown {
  if (isContentResult(value)) return { _content: value.__content.length };
  if (scalarOrNull(value)) return digestScalar(value);
  if (Array.isArray(value)) return { _len: value.length, first3: value.slice(0, 3).map(scalarFields) };
  if (!value || typeof value !== 'object') return null;
  const full = digestNode(value as Record<string, unknown>, 0, true);
  if (stableJson(full).length <= DIGEST_MAX_BYTES) return full;
  const lean = digestNode(value as Record<string, unknown>, 0, false);
  if (stableJson(lean).length <= DIGEST_MAX_BYTES) return lean;
  // Ainda grande (objeto com centenas de chaves): corta ENTRE chaves.
  const out: Record<string, unknown> = {};
  let size = 2;
  for (const [k, v] of Object.entries(lean)) {
    const add = stableJson(k).length + stableJson(v).length + 2;
    if (size + add > DIGEST_MAX_BYTES) {
      out._omitidas = Object.keys(lean).length - Object.keys(out).length;
      break;
    }
    out[k] = v;
    size += add;
  }
  return out;
}

/** Digest → mapa plano caminho → escalar (base do diff do replay). */
export function flattenDigest(d: unknown, prefix = '', out: Map<string, unknown> = new Map()): Map<string, unknown> {
  if (scalarOrNull(d)) {
    out.set(prefix || '(valor)', d);
    return out;
  }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return out;
  for (const [k, v] of Object.entries(d as Record<string, unknown>)) {
    if (k === 'first3') continue; // amostra: muda de ordem sem o dado mudar
    flattenDigest(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

export interface DigestChange {
  path: string;
  before: unknown;
  after: unknown;
  /** Variação relativa em % (só números com base ≠ 0). */
  deltaPct: number | null;
}

/** Diff compacto de dois digests: só o que mudou, maiores variações primeiro. */
export function diffDigests(before: unknown, after: unknown, limit = 40): DigestChange[] {
  const a = flattenDigest(before);
  const b = flattenDigest(after);
  const changes: DigestChange[] = [];
  for (const path of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(path);
    const y = b.get(path);
    if (x === y) continue;
    const deltaPct = typeof x === 'number' && typeof y === 'number' && x !== 0
      ? Math.round(((y - x) / Math.abs(x)) * 10_000) / 100
      : null;
    changes.push({ path, before: x ?? null, after: y ?? null, deltaPct });
  }
  changes.sort((p, q) => Math.abs(q.deltaPct ?? Infinity) - Math.abs(p.deltaPct ?? Infinity));
  return changes.slice(0, limit);
}

// ── Montagem do log (pura) ──────────────────────────────────────────────

// Entradas que o motor põe no trace pra registrar uma trava (terminal na
// mesma rodada das consultas; números sem fonte) — não executaram tool.
const SYNTHETIC_ERRORS = new Set(['ungrounded', 'terminal_with_data']);
// Tools cujo resultado É conteúdo (arquivo do usuário, trechos da base,
// playbooks): só o hash vai pro log — um digest copiaria o texto.
// aggregate_result entra aqui porque pode agregar um $rN de
// query_attachment_table (linhas do arquivo do usuário, chaves = colunas dele).
const CONTENT_TOOLS = new Set(['read_attachment', 'query_attachment_table', 'search_knowledge', 'get_definitions', 'load_skill', 'aggregate_result']);

function isSynthetic(t: ToolTrace): boolean {
  return t.name === TERMINAL_TOOL && !!t.error && SYNTHETIC_ERRORS.has(t.error);
}

interface ValueSource {
  byRef: Map<string, unknown>;
  /** Resultados brutos na ordem de execução (captureRaw do eval). */
  ordered: unknown[] | null;
}

function valueSource(result: TurnResult, results?: TurnResultsReader | null): ValueSource | null {
  const byRef = new Map<string, unknown>();
  if (results) for (const r of results.all()) byRef.set(r.ref, r.value);
  const ordered = result.raw ? result.raw.map((r) => r.value) : null;
  return byRef.size || ordered ? { byRef, ordered } : null;
}

/**
 * TurnResult → linha do ChatTurnLog. Pura (testável sem banco).
 *   toolCalls = todo tool_use que o modelo emitiu: consultas executadas +
 *     terminais barradas pelas travas + a terminal entregue (usedBlocks);
 *   toolErrors = entradas do trace com erro (inclui as travas: o modelo
 *     precisou se corrigir);
 *   toolMs = tempo de PAREDE em tools (tools da mesma rodada rodam em
 *     paralelo — soma de ms inflaria).
 */
export function buildTurnLogData(
  result: TurnResult,
  meta: TurnLogMeta,
  versions: { promptVersion: string; knowledgeHash: string | null },
): TurnLogData {
  const sums = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let toolEntries = 0;
  let toolErrors = 0;
  let toolMs = 0;
  const source = valueSource(result, meta.results);
  let dataIndex = 0;

  const trace: StoredRoundTrace[] = result.rounds.map((r) => {
    sums.input += r.usage.input_tokens || 0;
    sums.output += r.usage.output_tokens || 0;
    sums.cacheRead += r.usage.cache_read_input_tokens || 0;
    sums.cacheWrite += r.usage.cache_creation_input_tokens || 0;
    let roundWall = 0;
    const tools = r.tools.map((t): StoredToolTrace => {
      toolEntries += 1;
      if (t.error) toolErrors += 1;
      roundWall = Math.max(roundWall, t.ms || 0);
      const stored: StoredToolTrace = {
        name: t.name,
        id: t.id,
        input: scrubToolInput(t.input),
        ms: t.ms,
        bytes: t.bytes,
        ...(t.error ? { error: t.error } : {}),
        ...(t.truncated ? { truncated: true } : {}),
        ...(t.ref ? { ref: t.ref } : {}),
      };
      if (!isSynthetic(t) && source) {
        const value = t.ref && source.byRef.has(t.ref) ? source.byRef.get(t.ref) : source.ordered?.[dataIndex];
        if (value !== undefined && !t.error) {
          stored.hash = resultHash(value);
          if (!CONTENT_TOOLS.has(t.name)) stored.digest = digestResult(value);
        }
      }
      if (!isSynthetic(t)) dataIndex += 1;
      return stored;
    });
    toolMs += roundWall;
    const { tools: _raw, ...rest } = r;
    return { ...rest, tools };
  });

  const usedBlocks = Array.isArray(result.blocks);
  return {
    messageId: meta.messageId,
    conversationId: meta.conversationId,
    userId: meta.userId,
    evalRunId: meta.evalRunId ?? null,
    model: meta.model,
    effort: meta.effort,
    promptVersion: versions.promptVersion,
    knowledgeHash: versions.knowledgeHash,
    status: result.status,
    rounds: result.rounds.length,
    toolCalls: toolEntries + (usedBlocks ? 1 : 0),
    toolErrors,
    truncatedResults: result.truncatedResults,
    forcedFinal: result.forcedFinal,
    usedBlocks,
    ungroundedNumbers: result.ungrounded.length,
    error: result.error ? maskString(result.error, 500) : null,
    inputTokens: sums.input,
    outputTokens: sums.output,
    cacheReadTokens: sums.cacheRead,
    cacheWriteTokens: sums.cacheWrite,
    costUsd: roundsCostUsd(result.rounds, meta.model),
    ttftMs: result.ttftMs,
    latencyMs: result.latencyMs,
    toolMs,
    contextCharsPeak: result.contextCharsPeak,
    trace,
  };
}

// ── Versões (prompt / base de conhecimento) ─────────────────────────────

let promptVersionMemo: string | null = null;

/**
 * Versão do prompt = sha256(prompt estável + catálogo de tools), 12 hex.
 * Muda só em deploy — é a chave pra comparar qualidade antes × depois de
 * uma mudança de prompt/tool.
 */
export function currentPromptVersion(): string {
  if (!promptVersionMemo) promptVersionMemo = sha256Hex(stablePromptText() + JSON.stringify(TOOLS), 12);
  return promptVersionMemo;
}

/** Hash do bloco fixo da base (o mesmo que o system recebeu). null = vazio. */
export function knowledgeHashOf(block: string): string | null {
  return block.trim() ? sha256Hex(block, 12) : null;
}

// ── Gravação ────────────────────────────────────────────────────────────

const RETENTION_DAYS = (() => {
  const n = Number.parseInt(process.env.CHAT_TURNLOG_RETENTION_DAYS ?? '', 10);
  return Number.isFinite(n) && n >= 7 ? n : 90;
})();
// Limpeza "de carona" em ~1% das gravações: sem cron novo, e a tabela nunca
// passa muito da janela de retenção.
const PRUNE_PROBABILITY = 0.01;

export async function pruneTurnLogs(days = RETENTION_DAYS): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);
  const { count } = await db.chatTurnLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return count;
}

export async function saveTurnLog(result: TurnResult, meta: TurnLogMeta): Promise<void> {
  // O bloco da base vem do mesmo cache de 60s que o turno acabou de usar —
  // o hash é o do prompt que o modelo recebeu (salvo edição no meio do turno).
  const knowledgeHash = meta.knowledgeHash !== undefined ? meta.knowledgeHash : knowledgeHashOf(await getKnowledgePromptBlock());
  const data = buildTurnLogData(result, meta, { promptVersion: currentPromptVersion(), knowledgeHash });
  const row = await db.chatTurnLog.create({
    data: { ...data, trace: data.trace as unknown as Prisma.InputJsonValue },
    select: { id: true },
  });
  logger.info(
    {
      turnLogId: row.id,
      conversationId: data.conversationId,
      model: data.model,
      status: data.status,
      rounds: data.rounds,
      toolCalls: data.toolCalls,
      toolErrors: data.toolErrors,
      inTok: data.inputTokens,
      outTok: data.outputTokens,
      cacheRead: data.cacheReadTokens,
      cacheWrite: data.cacheWriteTokens,
      ttftMs: data.ttftMs,
      latencyMs: data.latencyMs,
      costUsd: data.costUsd,
    },
    '[chat] turn',
  );
  if (Math.random() < PRUNE_PROBABILITY) {
    void pruneTurnLogs().catch((err) => logger.warn({ err }, '[chat] limpeza do ChatTurnLog falhou'));
  }
}

// ── Feedback 👍/👎 ─────────────────────────────────────────────────────

export const FEEDBACK_REASONS = [
  'numero_errado',
  'periodo_errado',
  'filtro_errado',
  'nao_respondeu',
  'inventou',
  'lento',
  'formato',
  'outro',
] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

export const FEEDBACK_STATUSES = ['open', 'triaged', 'golden', 'fixed', 'wontfix'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

const FEEDBACK_TEXT_MAX = 2_000;

export interface FeedbackInputParsed {
  rating: 1 | -1;
  reasons: FeedbackReason[];
  comment: string | null;
  expected: string | null;
  shared: boolean;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function optText(v: unknown, field: string): Parsed<string | null> {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== 'string') return { ok: false, error: `${field} deve ser texto` };
  const t = v.trim();
  if (t.length > FEEDBACK_TEXT_MAX) return { ok: false, error: `${field}: no máximo ${FEEDBACK_TEXT_MAX} caracteres` };
  return { ok: true, value: t || null };
}

/** Valida o body do POST /api/chat/messages/[id]/feedback. */
export function parseFeedbackInput(body: unknown): Parsed<FeedbackInputParsed> {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body inválido' };
  const b = body as Record<string, unknown>;
  if (b.rating !== 1 && b.rating !== -1) return { ok: false, error: 'rating deve ser 1 ou -1' };
  let reasons: FeedbackReason[] = [];
  if (b.reasons !== undefined && b.reasons !== null) {
    if (!Array.isArray(b.reasons)) return { ok: false, error: 'reasons deve ser uma lista' };
    const bad = b.reasons.filter((r) => !(FEEDBACK_REASONS as readonly unknown[]).includes(r));
    if (bad.length) return { ok: false, error: `reasons inválido (${bad.map(String).join(', ')}) — válidos: ${FEEDBACK_REASONS.join(', ')}` };
    reasons = [...new Set(b.reasons as FeedbackReason[])];
  }
  const comment = optText(b.comment, 'comment');
  if (!comment.ok) return comment;
  const expected = optText(b.expected, 'expected');
  if (!expected.ok) return expected;
  if (b.shared !== undefined && typeof b.shared !== 'boolean') return { ok: false, error: 'shared deve ser booleano' };
  // 👍 não tem motivo nem "resposta certa": limpa o que sobrou de um 👎 anterior.
  const positive = b.rating === 1;
  return {
    ok: true,
    value: {
      rating: b.rating,
      reasons: positive ? [] : reasons,
      comment: comment.value,
      expected: positive ? null : expected.value,
      // 👍 não tem checkbox de consentimento na tela: só compartilha com o
      // admin quando o client pede explicitamente (shared: true).
      shared: positive ? b.shared === true : (b.shared ?? true),
    },
  };
}

export interface FeedbackPatch {
  status?: FeedbackStatus;
  adminNote?: string | null;
}

/** Valida o PATCH do admin (status de triagem + nota). */
export function parseFeedbackPatch(body: unknown): Parsed<FeedbackPatch> {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body inválido' };
  const b = body as Record<string, unknown>;
  const out: FeedbackPatch = {};
  if (b.status !== undefined) {
    if (!(FEEDBACK_STATUSES as readonly unknown[]).includes(b.status)) {
      return { ok: false, error: `status inválido — válidos: ${FEEDBACK_STATUSES.join(', ')}` };
    }
    out.status = b.status as FeedbackStatus;
  }
  if (b.adminNote !== undefined) {
    const note = optText(b.adminNote, 'adminNote');
    if (!note.ok) return note;
    out.adminNote = note.value;
  }
  if (out.status === undefined && out.adminNote === undefined) return { ok: false, error: 'nada pra atualizar (status ou adminNote)' };
  return { ok: true, value: out };
}

// ── Painel admin: agregados (SQL) ───────────────────────────────────────
//
// Convenção de unidade das respostas: *Pct = pontos percentuais (12.3 =
// 12,3%); *Ratio/*Rate = fração 0–1. Turnos do eval (evalRunId) ficam fora.

export interface QualityTotals {
  turns: number;
  latencyP50: number | null;
  latencyP95: number | null;
  ttftP50: number | null;
  costUsd: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheHitRatio: number | null;
  cacheHitRatioFirstRound: number | null;
  truncatedPct: number | null;
  outputTruncatedPct: number | null;
  forcedFinalPct: number | null;
  toolErrorRate: number | null;
  ungroundedPct: number | null;
}

export function qualityTotalsSql(since: Date): Prisma.Sql {
  return Prisma.sql`
    SELECT
      count(*)::int AS "turns",
      percentile_cont(0.5) WITHIN GROUP (ORDER BY "latencyMs")::float8 AS "latencyP50",
      percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs")::float8 AS "latencyP95",
      percentile_cont(0.5) WITHIN GROUP (ORDER BY "ttftMs")::float8 AS "ttftP50",
      coalesce(sum("costUsd"), 0)::float8 AS "costUsd",
      coalesce(sum("inputTokens"), 0)::float8 AS "inputTokens",
      coalesce(sum("cacheReadTokens"), 0)::float8 AS "cacheReadTokens",
      coalesce(sum("cacheWriteTokens"), 0)::float8 AS "cacheWriteTokens",
      (sum("cacheReadTokens")::float8
        / nullif(sum("inputTokens") + sum("cacheReadTokens") + sum("cacheWriteTokens"), 0)) AS "cacheHitRatio",
      (sum(coalesce(("trace"->0->'usage'->>'cache_read_input_tokens')::float8, 0))
        / nullif(sum(
            coalesce(("trace"->0->'usage'->>'input_tokens')::float8, 0)
          + coalesce(("trace"->0->'usage'->>'cache_read_input_tokens')::float8, 0)
          + coalesce(("trace"->0->'usage'->>'cache_creation_input_tokens')::float8, 0)), 0)) AS "cacheHitRatioFirstRound",
      (avg(CASE WHEN "truncatedResults" > 0 THEN 1 ELSE 0 END) * 100)::float8 AS "truncatedPct",
      (avg(CASE WHEN "status" = 'max_tokens' THEN 1 ELSE 0 END) * 100)::float8 AS "outputTruncatedPct",
      (avg(CASE WHEN "forcedFinal" THEN 1 ELSE 0 END) * 100)::float8 AS "forcedFinalPct",
      (sum("toolErrors")::float8 / nullif(sum("toolCalls"), 0)) AS "toolErrorRate",
      (avg(CASE WHEN "ungroundedNumbers" > 0 THEN 1 ELSE 0 END) * 100)::float8 AS "ungroundedPct"
    FROM "ChatTurnLog"
    WHERE "createdAt" >= ${since} AND "evalRunId" IS NULL`;
}

export interface ToolStat {
  name: string;
  calls: number;
  errors: number;
  avgBytes: number;
  avgMs: number;
}

export function toolStatsSql(since: Date): Prisma.Sql {
  return Prisma.sql`
    SELECT
      t->>'name' AS "name",
      count(*)::int AS "calls",
      (count(*) FILTER (WHERE coalesce(t->>'error', '') <> ''))::int AS "errors",
      avg(coalesce((t->>'bytes')::float8, 0))::float8 AS "avgBytes",
      avg(coalesce((t->>'ms')::float8, 0))::float8 AS "avgMs"
    FROM "ChatTurnLog" l
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(l."trace") = 'array' THEN l."trace" ELSE '[]'::jsonb END) r
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r->'tools') = 'array' THEN r->'tools' ELSE '[]'::jsonb END) t
    WHERE l."createdAt" >= ${since} AND l."evalRunId" IS NULL
    GROUP BY 1
    ORDER BY 2 DESC, 1
    LIMIT 60`;
}

// Dia civil BRT (UTC-3 fixo): createdAt é timestamp sem fuso gravado em UTC.
export function turnsByDaySql(since: Date): Prisma.Sql {
  return Prisma.sql`
    SELECT
      to_char("createdAt" - interval '3 hours', 'YYYY-MM-DD') AS "day",
      count(*)::int AS "turns",
      coalesce(sum("costUsd"), 0)::float8 AS "costUsd"
    FROM "ChatTurnLog"
    WHERE "createdAt" >= ${since} AND "evalRunId" IS NULL
    GROUP BY 1
    ORDER BY 1`;
}

export function feedbackByDaySql(since: Date): Prisma.Sql {
  return Prisma.sql`
    SELECT
      to_char("createdAt" - interval '3 hours', 'YYYY-MM-DD') AS "day",
      (count(*) FILTER (WHERE "rating" = 1))::int AS "up",
      (count(*) FILTER (WHERE "rating" = -1))::int AS "down"
    FROM "ChatFeedback"
    WHERE "createdAt" >= ${since}
    GROUP BY 1
    ORDER BY 1`;
}

export interface PromptVersionStat {
  promptVersion: string;
  turns: number;
  costUsd: number;
  thumbsDown: number;
  firstSeen: string;
}

export function promptVersionStatsSql(since: Date): Prisma.Sql {
  return Prisma.sql`
    SELECT
      l."promptVersion" AS "promptVersion",
      count(DISTINCT l."id")::int AS "turns",
      coalesce(sum(l."costUsd"), 0)::float8 AS "costUsd",
      (count(f."id") FILTER (WHERE f."rating" = -1))::int AS "thumbsDown",
      to_char(min(l."createdAt"), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "firstSeen"
    FROM "ChatTurnLog" l
    LEFT JOIN "ChatFeedback" f ON f."messageId" = l."messageId"
    WHERE l."createdAt" >= ${since} AND l."evalRunId" IS NULL
    GROUP BY 1
    ORDER BY min(l."createdAt") DESC
    LIMIT 12`;
}

export interface QualitySummary extends QualityTotals {
  days: number;
  thumbsUp: number;
  thumbsDown: number;
  byTool: ToolStat[];
  byDay: Array<{ day: string; turns: number; costUsd: number; thumbsUp: number; thumbsDown: number }>;
  byPromptVersion: PromptVersionStat[];
}

/** Junta turnos/dia e votos/dia (os dois lados podem ter dia sem o outro). */
export function mergeDays(
  turns: ReadonlyArray<{ day: string; turns: number; costUsd: number }>,
  votes: ReadonlyArray<{ day: string; up: number; down: number }>,
): QualitySummary['byDay'] {
  const map = new Map<string, QualitySummary['byDay'][number]>();
  for (const t of turns) map.set(t.day, { day: t.day, turns: t.turns, costUsd: Math.round(t.costUsd * 10_000) / 10_000, thumbsUp: 0, thumbsDown: 0 });
  for (const v of votes) {
    const row = map.get(v.day) ?? { day: v.day, turns: 0, costUsd: 0, thumbsUp: 0, thumbsDown: 0 };
    row.thumbsUp = v.up;
    row.thumbsDown = v.down;
    map.set(v.day, row);
  }
  return [...map.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export async function getQualitySummary(days: number, now: Date = new Date()): Promise<QualitySummary> {
  const since = new Date(now.getTime() - days * 24 * 3600 * 1000);
  const [totalsRows, byTool, turnDays, voteDays, byPromptVersion] = await Promise.all([
    db.$queryRaw<QualityTotals[]>(qualityTotalsSql(since)),
    db.$queryRaw<ToolStat[]>(toolStatsSql(since)),
    db.$queryRaw<Array<{ day: string; turns: number; costUsd: number }>>(turnsByDaySql(since)),
    db.$queryRaw<Array<{ day: string; up: number; down: number }>>(feedbackByDaySql(since)),
    db.$queryRaw<PromptVersionStat[]>(promptVersionStatsSql(since)),
  ]);
  const totals = totalsRows[0];
  const byDay = mergeDays(turnDays, voteDays);
  return {
    days,
    ...totals,
    thumbsUp: voteDays.reduce((n, v) => n + v.up, 0),
    thumbsDown: voteDays.reduce((n, v) => n + v.down, 0),
    byTool,
    byDay,
    byPromptVersion,
  };
}

// ── Painel admin: respostas avaliadas (só shared=true) ──────────────────

export interface FeedbackReviewItem {
  id: string;
  messageId: string;
  rating: number;
  reasons: string[];
  comment: string | null;
  expected: string | null;
  status: string;
  adminNote: string | null;
  createdAt: string;
  updatedAt: string;
  /** Mensagem do usuário que originou a resposta. */
  question: string | null;
  /** Contexto do turno (agora BRT + estado da UI) — base do replay e do caso de teste. */
  questionContext: string | null;
  answer: string;
  answerBlocks: unknown;
  /** Resposta como o grader lê: texto + blocos renderizados. */
  answerText: string;
  citations: unknown;
  trace: {
    turnLogId: string;
    model: string;
    effort: string;
    promptVersion: string;
    status: string;
    rounds: number;
    toolCalls: number;
    toolErrors: number;
    truncatedResults: number;
    ungroundedNumbers: number;
    costUsd: number | null;
    latencyMs: number;
    ttftMs: number | null;
    roundsTrace: unknown;
  } | null;
}

export async function listSharedFeedback(opts: { rating?: 1 | -1; status?: FeedbackStatus; limit: number }): Promise<FeedbackReviewItem[]> {
  const rows = await db.chatFeedback.findMany({
    where: {
      shared: true,
      ...(opts.rating ? { rating: opts.rating } : {}),
      ...(opts.status ? { status: opts.status } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: opts.limit,
    include: {
      message: {
        select: {
          id: true,
          conversationId: true,
          content: true,
          blocks: true,
          citations: true,
          createdAt: true,
          turnLog: true,
        },
      },
    },
  });
  const questions = await Promise.all(
    rows.map((r) =>
      db.message.findFirst({
        where: { conversationId: r.message.conversationId, role: 'user', createdAt: { lte: r.message.createdAt } },
        orderBy: { createdAt: 'desc' },
        select: { content: true, turnContext: true },
      }),
    ),
  );
  return rows.map((r, i) => {
    const log = r.message.turnLog;
    return {
      id: r.id,
      messageId: r.messageId,
      rating: r.rating,
      reasons: r.reasons,
      comment: r.comment,
      expected: r.expected,
      status: r.status,
      adminNote: r.adminNote,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      question: questions[i]?.content ?? null,
      questionContext: questions[i]?.turnContext ?? null,
      answer: r.message.content,
      answerBlocks: r.message.blocks,
      answerText: [r.message.content, renderBlocksToText(r.message.blocks)].filter(Boolean).join('\n\n'),
      citations: r.message.citations,
      trace: log
        ? {
            turnLogId: log.id,
            model: log.model,
            effort: log.effort,
            promptVersion: log.promptVersion,
            status: log.status,
            rounds: log.rounds,
            toolCalls: log.toolCalls,
            toolErrors: log.toolErrors,
            truncatedResults: log.truncatedResults,
            ungroundedNumbers: log.ungroundedNumbers,
            costUsd: log.costUsd,
            latencyMs: log.latencyMs,
            ttftMs: log.ttftMs,
            roundsTrace: log.trace,
          }
        : null,
    };
  });
}

// ── Replay de uma tool do trace ─────────────────────────────────────────

// Tools que não fazem sentido re-executar fora do turno: dependem do
// ResultStore do turno ($rN), dos anexos do DONO da conversa (o admin não lê
// arquivo alheio) ou não consultam dado.
const REPLAY_DENY = new Set([
  TERMINAL_TOOL,
  'calc',
  'aggregate_result',
  'read_attachment',
  'query_attachment_table',
  'load_skill',
]);

/** "intervalo: 2026-09-01 → 2026-09-07" do bloco de estado da UI do turno. */
export function uiRangeFromTurnContext(turnContext: string | null | undefined): { startDate: string; endDate: string } | null {
  const m = /intervalo:\s*(\d{4}-\d{2}-\d{2})\s*→\s*(\d{4}-\d{2}-\d{2})/.exec(turnContext ?? '');
  return m ? { startDate: m[1], endDate: m[2] } : null;
}

function hasOmittedMarker(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  if (!Array.isArray(v) && '_omitido' in (v as object)) return true;
  return Object.values(v as Record<string, unknown>).some(hasOmittedMarker);
}

export type ReplayOutcome =
  | { ok: false; status: 404 | 422; error: string }
  | {
      ok: true;
      tool: string;
      input: unknown;
      defaults: { startDate: string; endDate: string } | null;
      ms: number;
      error: string | null;
      bytesBefore: number;
      bytesAfter: number;
      hashBefore: string | null;
      hashAfter: string;
      /** true quando o dado mudou desde o turno (hash diferente). null = sem hash guardado. */
      changed: boolean | null;
      changes: DigestChange[];
      after: unknown;
    };

/**
 * Re-executa UMA tool de um turno registrado, com o input guardado e o
 * período da tela daquele turno como default, e compara com o que foi visto:
 * hash igual = mesmo dado (o erro foi de leitura do modelo); diferente = o
 * dado mudou (estorno tardio, IPN atrasado) ou a tool mudou.
 */
export async function replayTurnTool(args: {
  turnLogId?: string;
  messageId?: string;
  toolId: string;
  user: { id: string; role: string; allowedTabs: string[] };
}): Promise<ReplayOutcome> {
  const log = await db.chatTurnLog.findFirst({
    // Só turno com voto COMPARTILHADO (o consentimento que abre a conversa ao
    // admin) — sem isso o replay devolvia input e período de chat alheio por id.
    where: {
      ...(args.turnLogId ? { id: args.turnLogId } : { messageId: args.messageId }),
      message: { feedback: { some: { shared: true } } },
    },
    select: { trace: true, message: { select: { conversationId: true, createdAt: true } } },
  });
  if (!log) return { ok: false, status: 404, error: 'turno não encontrado' };
  const rounds = Array.isArray(log.trace) ? (log.trace as unknown as StoredRoundTrace[]) : [];
  const call = rounds.flatMap((r) => r.tools ?? []).find((t) => t.id === args.toolId);
  if (!call) return { ok: false, status: 404, error: 'tool não encontrada no trace' };
  if (REPLAY_DENY.has(call.name)) return { ok: false, status: 422, error: `${call.name} não pode ser re-executada fora do turno` };
  if (call.error && SYNTHETIC_ERRORS.has(call.error)) return { ok: false, status: 422, error: 'entrada de trava do motor, não uma consulta' };
  if (hasOmittedMarker(call.input)) return { ok: false, status: 422, error: 'o input desta chamada não foi guardado inteiro (texto livre/PII omitido) — não dá pra reproduzir' };

  let defaults: { startDate: string; endDate: string } | null = null;
  if (log.message) {
    const question = await db.message.findFirst({
      where: { conversationId: log.message.conversationId, role: 'user', createdAt: { lte: log.message.createdAt } },
      orderBy: { createdAt: 'desc' },
      select: { turnContext: true },
    });
    defaults = uiRangeFromTurnContext(question?.turnContext);
  }
  const ctx = {
    ...(defaults ? uiRangeContext(undefined, undefined, defaults.startDate, defaults.endDate) : {}),
    user: args.user,
    now: new Date(),
  };
  const started = Date.now();
  const value = await executeTool(call.name, (call.input ?? {}) as ToolInput, ctx);
  const ms = Date.now() - started;
  const err = value && typeof value === 'object' && 'error' in (value as object) ? String((value as { error: unknown }).error) : null;
  const after = digestResult(value);
  const hashAfter = resultHash(value);
  return {
    ok: true,
    tool: call.name,
    input: call.input,
    defaults,
    ms,
    error: err,
    // Mesma serialização que o modelo recebe (sem o teto de bytes): tamanho
    // comparável ao do turno, salvo o `_ref` e cortes por _truncated.
    bytesBefore: call.bytes,
    bytesAfter: fitToolResult(value, Number.MAX_SAFE_INTEGER).length,
    hashBefore: call.hash ?? null,
    hashAfter,
    changed: call.hash ? call.hash !== hashAfter : null,
    changes: call.digest !== undefined ? diffDigests(call.digest, after) : [],
    after,
  };
}
