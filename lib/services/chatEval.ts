// Runner do eval do chat IA — núcleo compartilhado pelo CLI
// (scripts/evalChat.ts) e pelo endpoint admin (/api/admin/chat-eval).
//
// Mede o caminho de PRODUÇÃO: monta system/histórico exatamente como a rota
// (getKnowledgePromptBlock → systemBlocks, buildTurnContext com o estado da
// UI, buildApiHistory sobre linhas sintéticas) e chama o MESMO runChatTurn
// com as mesmas tools. Diferenças deliberadas: nada de conversa/mensagem no
// banco, sem memória automática, captureRaw ligado (a nota olha os
// resultados brutos) e override de modelo/esforço pra A/B.
//
// Valor esperado = executeTool no MESMO handler, calculado ANTES e DEPOIS da
// resposta: se o dado mexeu no meio (estorno tardio, IPN atrasado), o caso
// sai 'inconclusive', não 'fail'.
//
// Única escrita no banco além do registro do eval: o refresh da MV que o
// get_overview já força no chat. Concorrência baixa (VPS compartilhada).

import { uiStateText, type UiState } from './chatUiState';
import type Anthropic from '@anthropic-ai/sdk';
import { Prisma } from '@prisma/client';
import { db } from '../db';
import { logger } from '../logger';
import { getAnthropicClient, ANTHROPIC_MODEL, ANTHROPIC_EFFORT, systemBlocks, buildTurnContext, type ChatEffort } from './ai';
import { getKnowledgePromptBlock } from './knowledge';
import { TOOLS, executeTool, parseFilters, uiRangeContext, type ToolContext, type ToolInput } from './aiTools';
import { runChatTurn, type TurnResult } from './chatEngine';
import { buildApiHistory, type HistoryRow } from './chatHistory';
import { roundsCostUsd } from './chatPricing';
import { buildTurnLogData, currentPromptVersion, digestResult, knowledgeHashOf, resultHash } from './chatTelemetry';
import type { ToolUser } from '../ai/toolTypes';
import { normalizeScope } from '../ai/normalizeScope';
import { ResultStore } from '../ai/resultStore';
import { SourceRegistry } from '../rag/citations';
import { brtRangeForPreset, spaCustomRange, type BrtRange } from '../shared/datePresets';
import { GOLDEN_CASES } from '../chat/eval/goldens';
import { gradeAnswer, type AppliedScope, type CaseStatus, type FactExpectation, type GradedCall, type GradeResult, type LensExpectation } from '../chat/eval/grader';
import { SpecError, resolveArgs, resolveDate, resolvePath, validateGoldenCase, type GoldenCase, type Lens, type LensSource, type Resolved, type UiSpec } from '../chat/eval/spec';
import { summarizeResults, type EvalRecord, type EvalSummary } from '../chat/eval/summary';

// ── Configuração ────────────────────────────────────────────────────────

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const satisfies readonly ChatEffort[];

function envNum(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Mesmos tetos da rota (app/api/chat/route.ts) — o histórico do eval tem
// que ser montado com as mesmas regras do de produção.
const HISTORY_MAX_MESSAGES = envNum('CHAT_HISTORY_MAX_MESSAGES', 120);
const HISTORY_MAX_CHARS = envNum('CHAT_HISTORY_MAX_CHARS', 400_000);
const ATTACH_INLINE_BUDGET_TOKENS = envNum('CHAT_ATTACH_INLINE_BUDGET_TOKENS', 150_000);
/** Teto de custo por rodada do eval (US$) — acima disso para de agendar casos. */
export const EVAL_MAX_USD = envNum('CHAT_EVAL_MAX_USD', 15);
const STALE_RUN_MS = 2 * 3600 * 1000;

export interface EvalConfig {
  model: string;
  effort: ChatEffort;
  /** Ids/slugs dos casos (vazio = todos). */
  cases: string[];
  categories: string[];
  reps: number;
  /** Ablação da base de conhecimento fixa no system. */
  knowledge: 'on' | 'off';
  concurrency: number;
  maxUsd: number;
  /** Perfil de quem "pergunta" (tools admin-only só respondem a ADMIN). */
  role: 'ADMIN' | 'MEMBER';
}

export type EvalConfigInput = Partial<EvalConfig>;

export class EvalConfigError extends Error {}
export class EvalBusyError extends Error {}
export class EvalWindowError extends Error {}

/** Valida/normaliza a configuração (body do admin, flags do CLI). */
export function normalizeEvalConfig(input: EvalConfigInput = {}): { ok: true; value: EvalConfig } | { ok: false; error: string } {
  const model = input.model === undefined ? ANTHROPIC_MODEL : typeof input.model === 'string' ? input.model.trim() : '';
  if (!/^claude-[a-z0-9.-]{2,60}$/.test(model)) return { ok: false, error: `model inválido: "${String(input.model)}"` };
  const effort = (input.effort ?? ANTHROPIC_EFFORT) as ChatEffort;
  if (!EFFORTS.includes(effort)) return { ok: false, error: `effort inválido — válidos: ${EFFORTS.join(', ')}` };
  const list = (v: unknown, what: string): string[] | string => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !/^[A-Za-z0-9_-]{1,60}$/.test(x))) return `${what}: lista de ids`;
    return [...new Set(v as string[])];
  };
  const cases = list(input.cases, 'cases');
  if (typeof cases === 'string') return { ok: false, error: cases };
  const categories = list(input.categories, 'categories');
  if (typeof categories === 'string') return { ok: false, error: categories };
  const reps = input.reps ?? 1;
  if (!Number.isInteger(reps) || reps < 1 || reps > 5) return { ok: false, error: 'reps: inteiro de 1 a 5' };
  const concurrency = input.concurrency ?? 2;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) return { ok: false, error: 'concurrency: inteiro de 1 a 4' };
  const maxUsd = input.maxUsd ?? EVAL_MAX_USD;
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) return { ok: false, error: 'maxUsd: número positivo' };
  const knowledge = input.knowledge ?? 'on';
  if (knowledge !== 'on' && knowledge !== 'off') return { ok: false, error: 'knowledge: on | off' };
  const role = input.role ?? 'ADMIN';
  if (role !== 'ADMIN' && role !== 'MEMBER') return { ok: false, error: 'role: ADMIN | MEMBER' };
  return { ok: true, value: { model, effort, cases, categories, reps, knowledge, concurrency, maxUsd, role } };
}

/**
 * Tokens relativos ($yesterday…) são resolvidos no dia BRT da execução: perto
 * da meia-noite o "ontem" do valor esperado e o da pergunta podem cair em
 * dias diferentes. Fora da janela 23:50–00:10 BRT.
 */
export function assertSafeWindow(now: Date = new Date()): void {
  const brt = new Date(now.getTime() - 3 * 3600 * 1000);
  const minutes = brt.getUTCHours() * 60 + brt.getUTCMinutes();
  if (minutes >= 23 * 60 + 50 || minutes < 10) {
    throw new EvalWindowError('eval não roda entre 23:50 e 00:10 BRT (datas relativas virariam o dia no meio)');
  }
}

// ── Casos ───────────────────────────────────────────────────────────────

/** Goldens do código + casos do banco (ChatEvalCase habilitado; mesmo slug sobrescreve). */
export async function loadEvalCases(): Promise<GoldenCase[]> {
  const byId = new Map(GOLDEN_CASES.map((c) => [c.id, c]));
  const rows = await db.chatEvalCase.findMany({ where: { enabled: true }, orderBy: { createdAt: 'asc' } });
  for (const r of rows) {
    const v = validateGoldenCase({ ...(r.spec as Record<string, unknown>), id: r.slug, category: r.category });
    if (v.ok) byId.set(r.slug, v.value);
    else logger.warn({ slug: r.slug, errors: v.errors }, '[eval] caso do banco inválido — ignorado');
  }
  return [...byId.values()];
}

export function selectCases(all: GoldenCase[], config: Pick<EvalConfig, 'cases' | 'categories'>): { selected: GoldenCase[]; unknown: string[] } {
  const ids = new Set(config.cases);
  const cats = new Set(config.categories);
  const selected = all.filter((c) => (!ids.size || ids.has(c.id)) && (!cats.size || cats.has(c.category)));
  const unknown = [...ids].filter((id) => !all.some((c) => c.id === id));
  return { selected, unknown };
}

/** Motivo pra não rodar o caso nesta configuração (null = roda). */
export function skipReason(spec: GoldenCase, config: Pick<EvalConfig, 'role'>, toolNames: ReadonlySet<string>): string | null {
  const missing = (spec.requires?.tools ?? []).filter((t) => !toolNames.has(t));
  if (missing.length) return `tools ausentes do catálogo: ${missing.join(', ')}`;
  if (spec.requires?.admin && config.role !== 'ADMIN') return 'exige perfil ADMIN';
  if (spec.attachments?.length) return 'caso com anexo: o runner ainda não sobe fixtures';
  return null;
}

// ── Estado da UI (igual ao que a SPA manda) ─────────────────────────────

/**
 * Mesmo texto de produção: a rota e o eval usam lib/services/chatUiState.ts
 * (antes era uma cópia linha a linha daqui).
 */
export const uiStateTextForEval = uiStateText;

export interface ResolvedUi {
  state: UiState | undefined;
  text: string;
  /** defaultStart/defaultEnd das tools (o que a tela mostra). */
  defaults: ToolContext;
}

export function resolveUi(ui: UiSpec | undefined, now: Date): ResolvedUi {
  if (!ui) return { state: undefined, text: '', defaults: {} };
  let range: BrtRange | null = null;
  if (ui.preset) range = brtRangeForPreset(ui.preset, now);
  else if (ui.from && ui.to) range = spaCustomRange(resolveDate(ui.from, now), resolveDate(ui.to, now));
  const state: UiState = {
    route: ui.route,
    preset: range?.preset,
    startDate: range?.start,
    endDate: range?.end,
    startAt: range?.startAt,
    endAt: range?.endAt,
    platforms: ui.platforms,
    families: ui.families,
    stages: ui.stages,
    countries: ui.countries,
    affiliates: ui.affiliates,
  };
  return {
    state,
    text: uiStateTextForEval(state),
    defaults: uiRangeContext(state.startAt, state.endAt, state.startDate, state.endDate),
  };
}

// ── Valores esperados ───────────────────────────────────────────────────

type Exec = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

/** executeTool com memo por (tool, args): várias lentes leem o mesmo resultado. */
function memoExec(ctx: ToolContext): Exec {
  const memo = new Map<string, Promise<unknown>>();
  return (tool, args) => {
    const key = `${tool}:${JSON.stringify(args)}`;
    let p = memo.get(key);
    if (!p) {
      p = executeTool(tool, args as ToolInput, ctx);
      memo.set(key, p);
    }
    return p;
  };
}

function toolError(v: unknown): string | null {
  if (!v || typeof v !== 'object' || !('error' in (v as object))) return null;
  const e = v as { error: unknown; message?: unknown };
  return `${String(e.error)}${e.message ? `: ${String(e.message)}` : ''}`;
}

async function readSource(src: LensSource, exec: Exec, now: Date): Promise<Resolved> {
  const value = await exec(src.tool, resolveArgs(src.args ?? {}, now));
  const err = toolError(value);
  if (err) throw new SpecError(`${src.tool}: ${err}`);
  return resolvePath(value, src.path);
}

async function readScalar(src: LensSource, exec: Exec, now: Date): Promise<number> {
  const r = await readSource(src, exec, now);
  const v = r.items[0]?.[0];
  if (r.list || typeof v !== 'number' || !Number.isFinite(v)) throw new SpecError(`${src.tool} ${src.path}: esperava um número`);
  return v;
}

export async function resolveLens(lens: Lens, exec: Exec, now: Date): Promise<Resolved> {
  if (lens.source) return readSource(lens.source, exec, now);
  if (!lens.calc) throw new SpecError(`lente "${lens.name}" sem source/calc`);
  const vals = await Promise.all(lens.calc.inputs.map((s) => readScalar(s, exec, now)));
  const scalar = (v: number): Resolved => ({ items: [[v]], list: false });
  switch (lens.calc.op) {
    case 'sum':
      return scalar(vals.reduce((a, b) => a + b, 0));
    case 'diff':
      return scalar(vals[0] - vals[1]);
    case 'ratio':
      if (!vals[1]) throw new SpecError('ratio com divisor zero');
      return scalar(vals[0] / vals[1]);
    case 'pct_change':
      if (!vals[1]) throw new SpecError('pct_change com base zero');
      return scalar(((vals[0] - vals[1]) / Math.abs(vals[1])) * 100);
    case 'dominant': {
      const labels = lens.calc.labels ?? [];
      let best = 0;
      vals.forEach((v, i) => {
        if (Math.abs(v) > Math.abs(vals[best])) best = i;
      });
      const label = labels[best];
      if (!label) throw new SpecError('dominant sem rótulo pra entrada vencedora');
      return { items: [label.split('|')], list: false };
    }
  }
}

async function computeFacts(spec: GoldenCase, exec: Exec, now: Date): Promise<FactExpectation[]> {
  return Promise.all(
    (spec.facts ?? []).map(async (f) => ({
      label: f.label,
      kind: f.kind,
      tol: f.tol,
      ordered: f.ordered,
      absolute: f.absolute,
      lenses: await Promise.all(
        f.lenses.map(async (l): Promise<LensExpectation> => {
          const base = { name: l.name, kind: l.kind ?? f.kind, keywords: l.keywords ?? [] };
          try {
            return { ...base, value: await resolveLens(l, exec, now) };
          } catch (e) {
            return { ...base, value: null, error: e instanceof Error ? e.message : String(e) };
          }
        }),
      ),
    })),
  );
}

function withAfter(before: FactExpectation[], after: FactExpectation[]): FactExpectation[] {
  return before.map((f, i) => ({
    ...f,
    lenses: f.lenses.map((l, j) => ({ ...l, after: after[i]?.lenses[j]?.value ?? null })),
  }));
}

/** Filtros efetivos de uma chamada: normalização do servidor + parseFilters. */
async function appliedScope(name: string, input: unknown, ctx: ToolContext): Promise<AppliedScope | null> {
  try {
    const { input: norm } = await normalizeScope(name, (input ?? {}) as Record<string, unknown>);
    const f = parseFilters(norm as ToolInput, ctx);
    return {
      start: f.startDate.toISOString(),
      end: f.endDate.toISOString(),
      platforms: f.platformSlugs,
      families: f.productFamilies,
      countries: f.countries,
      stages: f.productTypes,
      affiliates: f.mappedAffiliateIds,
      products: f.productExternalIds,
    };
  } catch {
    return null;
  }
}

const SCOPE_LISTS: Array<[string, keyof AppliedScope]> = [
  ['platforms', 'platforms'],
  ['families', 'families'],
  ['countries', 'countries'],
  ['stages', 'stages'],
  ['affiliate_ids', 'affiliates'],
  ['products', 'products'],
];

/** Filtros esperados de cada ToolExpectation (só as chaves que o caso pede). */
async function expectedScopes(spec: GoldenCase, ctx: ToolContext, now: Date): Promise<Array<AppliedScope | null>> {
  return Promise.all(
    (spec.tools ?? []).map(async (t) => {
      if (!t.args) return null;
      const args = resolveArgs(t.args, now);
      const exp: AppliedScope = {};
      if ('start_date' in args || 'end_date' in args) {
        const f = parseFilters({ start_date: args.start_date, end_date: args.end_date } as ToolInput, ctx);
        exp.start = f.startDate.toISOString();
        exp.end = f.endDate.toISOString();
      }
      for (const [arg, key] of SCOPE_LISTS) {
        const v = (args as Record<string, unknown>)[arg];
        if (Array.isArray(v)) (exp as Record<string, unknown>)[key] = v;
      }
      return exp;
    }),
  );
}

export interface CaseExpectations {
  facts: FactExpectation[];
  expectedArgs: Array<AppliedScope | null>;
  ui: ResolvedUi;
}

function evalUser(role: EvalConfig['role'], createdBy: string | null): ToolUser {
  return { id: createdBy ?? 'eval', role, allowedTabs: [] };
}

/** Valores esperados sem rodar o modelo (dry-run e selftest do CLI). */
export async function computeCaseExpectations(spec: GoldenCase, role: EvalConfig['role'] = 'ADMIN', now: Date = new Date()): Promise<CaseExpectations> {
  const ui = resolveUi(spec.ui, now);
  const ctx: ToolContext = { ...ui.defaults, user: evalUser(role, null), now };
  const facts = await computeFacts(spec, memoExec(ctx), now);
  return { facts, expectedArgs: await expectedScopes(spec, ctx, now), ui };
}

// ── Um caso ─────────────────────────────────────────────────────────────

export interface CaseOutcome {
  record: EvalRecord;
  answer: string;
  grade: GradeResult | null;
  trace: unknown;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costUsd: number | null;
    rounds: number;
    servedModels: string[];
  };
}

interface CaseEnv {
  client: Anthropic;
  config: EvalConfig;
  knowledgeBlock: string;
  user: ToolUser;
  runTag: string;
  signal?: AbortSignal;
}

/** Mesma nota que a rota anexa ao persistir um turno interrompido. */
function persistedContent(r: TurnResult): string {
  let note: string | undefined;
  if (r.status === 'aborted') note = '_(resposta interrompida: a conexão foi fechada)_';
  else if (r.status === 'error') note = `⚠️ _A resposta foi interrompida por um erro: ${r.error ?? 'erro desconhecido'}_`;
  return note ? `${r.text}${r.text ? '\n\n' : ''}${note}` : r.text;
}

/** Modelo servido = pedido (ou o mesmo id com sufixo de data). */
export function servedMatches(requested: string, served: string): boolean {
  return served === requested || (served.startsWith(requested) && /^-\d{8}$/.test(served.slice(requested.length)));
}

export async function runEvalCase(spec: GoldenCase, rep: number, env: CaseEnv): Promise<CaseOutcome> {
  const started = Date.now();
  const now0 = new Date();
  const ui = resolveUi(spec.ui, now0);
  const baseCtx: ToolContext = { ...ui.defaults, user: env.user, now: now0 };
  const usage: CaseOutcome['usage'] = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, rounds: 0, servedModels: [] };
  const record = (status: CaseStatus, extra: Partial<EvalRecord> = {}): EvalRecord => ({
    caseId: spec.id,
    category: spec.category,
    rep,
    status,
    score: 0,
    checks: [],
    costUsd: usage.costUsd,
    latencyMs: Date.now() - started,
    rounds: usage.rounds,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    faithfulness: null,
    firstFactAt: null,
    ...extra,
  });

  const before = await computeFacts(spec, memoExec(baseCtx), now0);
  const expectedArgs = await expectedScopes(spec, baseCtx, now0);

  const rows: HistoryRow[] = [];
  const turns: Array<{ question: string; status: string; rounds: unknown }> = [];
  let last: TurnResult | null = null;
  let lastCtx: ToolContext = baseCtx;
  for (let i = 0; i < spec.turns.length; i++) {
    const now = new Date();
    rows.unshift({
      id: `eval-q${i}`,
      role: 'user',
      content: spec.turns[i],
      blocks: null,
      toolUses: null,
      turnContext: buildTurnContext(now, ui.text),
      createdAt: new Date(now0.getTime() + i * 2_000),
    });
    const sources = new SourceRegistry();
    const history = await buildApiHistory(rows, new Map(), {
      maxMessages: HISTORY_MAX_MESSAGES,
      maxChars: HISTORY_MAX_CHARS,
      inlineBudgetTokens: ATTACH_INLINE_BUDGET_TOKENS,
      sources,
    });
    const system = systemBlocks(env.knowledgeBlock);
    const toolCtx: ToolContext = {
      ...ui.defaults,
      user: env.user,
      conversationId: `eval:${env.runTag}:${spec.id}:${rep}`,
      results: new ResultStore(),
      sources,
      attachments: [],
      now,
      signal: env.signal,
    };
    const result = await runChatTurn({
      client: env.client,
      model: env.config.model,
      effort: env.config.effort,
      system,
      messages: history.messages,
      tools: TOOLS,
      toolCtx,
      initialContextChars: history.chars + history.attachmentTokens * 3 + system.reduce((n, b) => n + b.text.length, 0),
      signal: env.signal,
      captureRaw: true,
    });
    for (const r of result.rounds) {
      usage.inputTokens += r.usage.input_tokens;
      usage.outputTokens += r.usage.output_tokens;
      usage.cacheReadTokens += r.usage.cache_read_input_tokens;
      usage.cacheWriteTokens += r.usage.cache_creation_input_tokens;
      if (r.model && !usage.servedModels.includes(r.model)) usage.servedModels.push(r.model);
    }
    usage.rounds += result.rounds.length;
    const turnCost = roundsCostUsd(result.rounds, env.config.model);
    usage.costUsd = usage.costUsd == null || turnCost == null ? null : Math.round((usage.costUsd + turnCost) * 1_000_000) / 1_000_000;
    turns.push({
      question: spec.turns[i],
      status: result.status,
      rounds: buildTurnLogData(result, { messageId: null, conversationId: null, userId: null, model: env.config.model, effort: env.config.effort }, {
        promptVersion: currentPromptVersion(),
        knowledgeHash: knowledgeHashOf(env.knowledgeBlock),
      }).trace,
    });
    rows.unshift({
      id: `eval-a${i}`,
      role: 'assistant',
      content: persistedContent(result),
      blocks: result.blocks,
      toolUses: result.toolUses.length ? result.toolUses : null,
      turnContext: null,
      createdAt: new Date(now0.getTime() + i * 2_000 + 1_000),
    });
    last = result;
    lastCtx = toolCtx;
    if (result.status !== 'ok') break;
  }
  const final = last as TurnResult;

  const wrongModel = usage.servedModels.find((m) => !servedMatches(env.config.model, m));
  if (wrongModel) {
    return { record: record('error', { error: `modelo servido ${wrongModel} ≠ pedido ${env.config.model}` }), answer: final.text, grade: null, trace: { turns }, usage };
  }

  const after = await computeFacts(spec, memoExec({ ...baseCtx, now: new Date() }), now0);
  const facts = withAfter(before, after);
  const calls: GradedCall[] = await Promise.all(
    (final.raw ?? []).map(async (c) => ({ name: c.name, input: c.input, result: c.value, applied: await appliedScope(c.name, c.input, lastCtx) })),
  );
  const grade = gradeAnswer({
    spec,
    turnStatus: final.status,
    text: final.text,
    blocks: final.blocks,
    citations: final.citations,
    calls,
    rounds: final.rounds.length,
    inputTokens: final.rounds.reduce((n, r) => n + r.usage.input_tokens + r.usage.cache_read_input_tokens + r.usage.cache_creation_input_tokens, 0),
    facts,
    expectedArgs,
  });

  const trace = {
    turns,
    expected: facts.map((f) => ({
      label: f.label,
      lenses: f.lenses.map((l) => ({ name: l.name, value: l.value?.items ?? null, after: l.after?.items ?? null, error: l.error })),
    })),
    calls: calls.map((c) => ({ name: c.name, input: c.input, applied: c.applied, hash: resultHash(c.result), digest: digestResult(c.result) })),
    untraced: grade.soft.untraced,
    error: final.error,
  };
  return {
    record: record(grade.status, {
      score: grade.score,
      checks: grade.checks,
      faithfulness: grade.soft.faithfulness,
      firstFactAt: grade.soft.firstFactAt,
      error: final.error,
    }),
    answer: grade.answer,
    grade,
    trace,
    usage,
  };
}

// ── Suíte ───────────────────────────────────────────────────────────────

export interface SuiteSummary extends EvalSummary {
  config: EvalConfig;
  promptVersion: string;
  knowledgeHash: string | null;
  skipped: Array<{ caseId: string; reason: string }>;
  /** Motivo de parada antecipada (teto de custo, cancelamento). */
  aborted: string | null;
}

export interface SuiteOptions {
  /** Com runId, cada resultado vira ChatEvalResult. */
  runId?: string | null;
  createdBy?: string | null;
  signal?: AbortSignal;
  onOutcome?: (o: CaseOutcome, spec: GoldenCase) => void;
}

function outcomeFromError(spec: GoldenCase, rep: number, err: unknown, started: number): CaseOutcome {
  const message = err instanceof Error ? err.message : String(err);
  return {
    record: {
      caseId: spec.id, category: spec.category, rep, status: 'error', score: 0, checks: [], costUsd: 0,
      latencyMs: Date.now() - started, rounds: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
      faithfulness: null, firstFactAt: null, error: message,
    },
    answer: '',
    grade: null,
    trace: { error: message },
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, rounds: 0, servedModels: [] },
  };
}

async function persistOutcome(runId: string, o: CaseOutcome): Promise<void> {
  await db.chatEvalResult.create({
    data: {
      runId,
      caseSlug: o.record.caseId,
      rep: o.record.rep,
      status: o.record.status,
      score: o.record.score,
      checks: o.record.checks as unknown as Prisma.InputJsonValue,
      answer: o.answer,
      trace: o.trace as Prisma.InputJsonValue,
      usage: o.usage as unknown as Prisma.InputJsonValue,
      latencyMs: o.record.latencyMs,
    },
  });
}

export async function runEvalSuite(config: EvalConfig, opts: SuiteOptions = {}): Promise<{ summary: SuiteSummary; outcomes: CaseOutcome[] }> {
  assertSafeWindow();
  const client = getAnthropicClient();
  const knowledgeBlock = config.knowledge === 'off' ? '' : await getKnowledgePromptBlock();
  const toolNames = new Set(TOOLS.map((t) => t.name));
  const { selected, unknown } = selectCases(await loadEvalCases(), config);
  if (unknown.length) throw new EvalConfigError(`casos desconhecidos: ${unknown.join(', ')}`);

  const skipped: SuiteSummary['skipped'] = [];
  const tasks: Array<{ spec: GoldenCase; rep: number }> = [];
  for (const spec of selected) {
    const why = skipReason(spec, config, toolNames);
    if (why) skipped.push({ caseId: spec.id, reason: why });
    else for (let rep = 0; rep < config.reps; rep++) tasks.push({ spec, rep });
  }

  const env: CaseEnv = {
    client,
    config,
    knowledgeBlock,
    user: evalUser(config.role, opts.createdBy ?? null),
    runTag: opts.runId ?? `cli-${Date.now()}`,
    signal: opts.signal,
  };
  const outcomes: CaseOutcome[] = [];
  let spent = 0;
  let aborted: string | null = null;
  let next = 0;
  const worker = async () => {
    while (next < tasks.length && !aborted) {
      if (opts.signal?.aborted) {
        aborted = 'cancelado';
        break;
      }
      const { spec, rep } = tasks[next++];
      const started = Date.now();
      let o: CaseOutcome;
      try {
        o = await runEvalCase(spec, rep, env);
      } catch (err) {
        logger.warn({ err, caseId: spec.id, rep }, '[eval] caso falhou');
        o = outcomeFromError(spec, rep, err, started);
      }
      outcomes.push(o);
      spent += o.usage.costUsd ?? 0;
      if (opts.runId) await persistOutcome(opts.runId, o).catch((err) => logger.warn({ err, caseId: spec.id }, '[eval] falha ao gravar resultado'));
      opts.onOutcome?.(o, spec);
      if (spent >= config.maxUsd && !aborted) aborted = `teto de custo atingido ($${spent.toFixed(2)} ≥ $${config.maxUsd})`;
    }
  };
  await Promise.all(Array.from({ length: Math.min(config.concurrency, Math.max(1, tasks.length)) }, worker));

  const summary: SuiteSummary = {
    ...summarizeResults(outcomes.map((o) => o.record)),
    config,
    promptVersion: currentPromptVersion(),
    knowledgeHash: knowledgeHashOf(knowledgeBlock),
    skipped,
    aborted,
  };
  return { summary, outcomes };
}

// ── Rodada em segundo plano (endpoint admin) ────────────────────────────

let starting = false;
let activeRunId: string | null = null;

/** Rodada 'running' há mais de 2h = processo morreu no meio (deploy/restart). */
export async function markStaleRuns(now: Date = new Date()): Promise<number> {
  const { count } = await db.chatEvalRun.updateMany({
    where: { status: 'running', startedAt: { lt: new Date(now.getTime() - STALE_RUN_MS) } },
    data: { status: 'failed', finishedAt: now, summary: { error: 'rodada abandonada (mais de 2h sem terminar)' } },
  });
  return count;
}

async function executeRun(runId: string, config: EvalConfig, createdBy: string | null): Promise<void> {
  try {
    const { summary } = await runEvalSuite(config, { runId, createdBy });
    await db.chatEvalRun.update({
      where: { id: runId },
      data: { status: 'done', summary: summary as unknown as Prisma.InputJsonValue, costUsd: summary.costUsd, finishedAt: new Date() },
    });
    logger.info({ runId, passRate: summary.passRate.rate, costUsd: summary.costUsd, results: summary.results }, '[eval] rodada concluída');
  } catch (err) {
    logger.error({ err, runId }, '[eval] rodada falhou');
    await db.chatEvalRun
      .update({ where: { id: runId }, data: { status: 'failed', finishedAt: new Date(), summary: { error: err instanceof Error ? err.message : String(err) } } })
      .catch(() => undefined);
  }
}

/**
 * Cria a ChatEvalRun e roda em segundo plano (mesmo padrão do scheduler da
 * Logicall: in-process). Uma rodada por vez — no processo E no banco (o CLI
 * dentro do container também conta).
 */
export async function startEvalRun(input: EvalConfigInput, meta: { trigger: 'admin' | 'cli'; createdBy: string | null }): Promise<{ runId: string; config: EvalConfig }> {
  const cfg = normalizeEvalConfig(input);
  if (!cfg.ok) throw new EvalConfigError(cfg.error);
  if (starting || activeRunId) throw new EvalBusyError(activeRunId ?? 'iniciando');
  starting = true;
  try {
    assertSafeWindow();
    await markStaleRuns();
    const running = await db.chatEvalRun.findFirst({ where: { status: 'running' }, select: { id: true } });
    if (running) throw new EvalBusyError(running.id);
    const { selected, unknown } = selectCases(await loadEvalCases(), cfg.value);
    if (unknown.length) throw new EvalConfigError(`casos desconhecidos: ${unknown.join(', ')}`);
    if (!selected.length) throw new EvalConfigError('nenhum caso selecionado');
    const run = await db.chatEvalRun.create({
      data: {
        status: 'running',
        trigger: meta.trigger,
        createdBy: meta.createdBy,
        config: { ...cfg.value, promptVersion: currentPromptVersion() } as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    activeRunId = run.id;
    void executeRun(run.id, cfg.value, meta.createdBy).finally(() => {
      activeRunId = null;
    });
    return { runId: run.id, config: cfg.value };
  } finally {
    starting = false;
  }
}
