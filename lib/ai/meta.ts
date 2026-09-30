// Envelope `_meta` dos resultados de tool + forma ÚNICA de erro.
//
// `_meta` existe porque o modelo errava a BASE do número, não a conta:
// citava "29/09" quando o fim do range em UTC era 30/09 02:59Z, comparava
// hoje-até-14h com ontem inteiro sem saber que hoje era parcial, e dizia
// "zero vendas" quando o filtro tinha um slug errado. Cada resultado agora
// diz, em BRT, qual janela foi consultada, com quais filtros, em que
// unidades e com que ressalva de dado.
//
// Erro único `{error, message, retryable, hint?, validValues?, alternatives?}`:
// antes eram 5 formatos (string solta, invalid_input, not_found, mensagem crua
// do Prisma…) e nenhum dizia se valia tentar de novo nem como corrigir.

import type { Unit } from './units';
import type { DataQualityNote } from './coverage';

// ── BRT ─────────────────────────────────────────────────────────────────

// BRT é UTC-3 fixo (sem horário de verão desde 2019).
export const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/** "2026-05-11" → 2026-05-11T00:00:00 BRT (= 03:00Z). */
export function parseBrtStart(dateStr: string): Date {
  return new Date(new Date(dateStr + 'T00:00:00Z').getTime() + BRT_OFFSET_MS);
}

/** "2026-05-11" → 2026-05-11T23:59:59.999 BRT (= 2026-05-12T02:59:59.999Z). */
export function parseBrtEnd(dateStr: string): Date {
  return new Date(new Date(dateStr + 'T23:59:59.999Z').getTime() + BRT_OFFSET_MS);
}

/** Instante → 'YYYY-MM-DD HH:mm' no relógio de Brasília. */
export function formatBrt(d: Date): string {
  return new Date(d.getTime() - BRT_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');
}

/** Índice do dia civil BRT do instante (dias desde a época). */
function brtDayIndex(t: number): number {
  return Math.floor((t - BRT_OFFSET_MS) / DAY_MS);
}

export type RangeSource = 'ui' | 'explicit' | 'default';

export interface RangeMeta {
  startBrt: string;
  /** Fim EFETIVO: nunca além de agora (dado do futuro não existe). */
  endBrt: string;
  /** Dias civis BRT tocados pela janela (inclusivo). */
  days: number;
  /** Dias da janela já encerrados (hoje, se incluído, não conta). */
  closedDays: number;
  includesToday: boolean;
  /** Hoje está na janela e ela vai até agora (ou além): os números de hoje ainda crescem. */
  partialToday: boolean;
  hoursElapsedToday?: number;
  source: RangeSource;
}

export function rangeMeta(start: Date, end: Date, now: Date, source: RangeSource): RangeMeta {
  const s = start.getTime();
  const effEnd = Math.min(end.getTime(), now.getTime());
  const today = brtDayIndex(now.getTime());
  const firstDay = brtDayIndex(s);
  const lastDay = brtDayIndex(effEnd);
  const days = effEnd >= s ? lastDay - firstDay + 1 : 0;
  const includesToday = s <= now.getTime() && firstDay <= today && brtDayIndex(end.getTime()) >= today;
  const out: RangeMeta = {
    startBrt: formatBrt(start),
    endBrt: formatBrt(new Date(Math.max(effEnd, s))),
    days,
    closedDays: Math.max(0, days - (includesToday && lastDay === today ? 1 : 0)),
    includesToday,
    partialToday: includesToday && end.getTime() >= now.getTime(),
    source,
  };
  if (includesToday) {
    const midnight = today * DAY_MS + BRT_OFFSET_MS;
    out.hoursElapsedToday = Math.round(((now.getTime() - midnight) / 3_600_000) * 10) / 10;
  }
  return out;
}

/** Janela em dias civis BRT (as tools de janela devolvem 'YYYY-MM-DD'). */
export function rangeMetaFromDays(startDay: string, endDay: string, now: Date, source: RangeSource): RangeMeta | undefined {
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  if (!ymd.test(startDay) || !ymd.test(endDay)) return undefined;
  return rangeMeta(parseBrtStart(startDay), parseBrtEnd(endDay), now, source);
}

// ── Envelope ────────────────────────────────────────────────────────────

export interface ToolMeta {
  range?: RangeMeta;
  /** Janela do `previous` quando compare=true. */
  previousRange?: { startBrt: string; endBrt: string };
  /** true = o anterior foi cortado no MESMO tempo decorrido da janela atual (hoje parcial). */
  aligned?: boolean;
  filtersApplied?: Record<string, unknown>;
  units?: Record<string, Unit>;
  dataQuality?: DataQualityNote[];
  notes?: string[];
  /** Resultado vazio COM filtro: confira o filtro antes de afirmar "zero". */
  emptyWithFilters?: true;
}

function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null || v === false) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}

/** Remove chaves vazias (o envelope vai em TODO resultado — cada byte conta). */
export function compactMeta(meta: ToolMeta): ToolMeta {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) if (!isEmptyValue(v)) out[k] = v;
  return out as ToolMeta;
}

/**
 * Anexa `_meta` no TOPO do resultado (o modelo lê a base antes do dado).
 * Se o handler/módulo já trouxe um `_meta` parcial (ex.: aligned do
 * overview, range próprio de compare_periods), as chaves dele vencem e as
 * notas são somadas.
 */
export function attachMeta<T extends Record<string, unknown>>(value: T, meta: ToolMeta): T {
  const { _meta: own, ...rest } = value as T & { _meta?: ToolMeta };
  const notes = [...(meta.notes ?? []), ...(own?.notes ?? [])];
  const merged = compactMeta({ ...meta, ...(own ?? {}), notes: [...new Set(notes)] });
  if (!Object.keys(merged).length) return rest as T;
  // Spread copia chaves-símbolo enumeráveis: a etiqueta de tool do fit sobrevive.
  return { _meta: merged, ...rest } as unknown as T;
}

// ── Erros ───────────────────────────────────────────────────────────────

export interface ToolErrorResult {
  error: string;
  message: string;
  retryable: boolean;
  hint?: string;
  validValues?: string[];
  alternatives?: unknown[];
}

type ErrorExtra = Partial<Pick<ToolErrorResult, 'hint' | 'validValues' | 'alternatives' | 'retryable'>>;

export function toolError(error: string, message: string, extra: ErrorExtra = {}): ToolErrorResult {
  const out: ToolErrorResult = { error, message, retryable: extra.retryable ?? false };
  if (extra.hint) out.hint = extra.hint;
  if (extra.validValues?.length) out.validValues = extra.validValues;
  if (extra.alternatives?.length) out.alternatives = extra.alternatives;
  return out;
}

/** Input que o modelo pode corrigir sozinho (data inválida, filtro desconhecido…). */
export class ToolInputError extends Error {
  readonly hint?: string;
  readonly validValues?: string[];
  readonly alternatives?: unknown[];
  constructor(message: string, extra: { hint?: string; validValues?: string[]; alternatives?: unknown[] } = {}) {
    super(message);
    this.name = 'ToolInputError';
    this.hint = extra.hint;
    this.validValues = extra.validValues;
    this.alternatives = extra.alternatives;
  }
}

export class ToolTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} excedeu ${Math.round(ms / 1000)}s`);
    this.name = 'ToolTimeoutError';
  }
}

const strArray = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : undefined;

/**
 * Objeto de erro devolvido por handler ou módulo (qualquer formato antigo)
 * → forma única. `message` nunca some: sem ela o modelo só via o código.
 */
export function normalizeErrorResult(v: Record<string, unknown>): ToolErrorResult {
  const code = String(v.error);
  const message = typeof v.message === 'string' && v.message ? v.message : code;
  // Formato antigo: o erro inteiro era a frase ("external_id obrigatório").
  const error = /\s/.test(code) && message === code ? 'invalid_input' : code;
  return toolError(error, message, {
    retryable: typeof v.retryable === 'boolean' ? v.retryable : false,
    hint: typeof v.hint === 'string' ? v.hint : undefined,
    validValues: strArray(v.validValues),
    alternatives: Array.isArray(v.alternatives) ? v.alternatives : undefined,
  });
}

// Códigos do Prisma que indicam falha TRANSITÓRIA (conexão, pool, timeout,
// conflito de transação) — tentar de novo pode funcionar.
const TRANSIENT_PRISMA = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2034']);

function isDbError(err: Error & { code?: unknown; clientVersion?: unknown }): boolean {
  return err.name.startsWith('PrismaClient')
    || typeof err.clientVersion === 'string'
    || (typeof err.code === 'string' && /^P\d{4}$/.test(err.code));
}

export interface MappedError {
  result: ToolErrorResult;
  /** Falha do lado do servidor (não do input) — vale logar com a mensagem crua. */
  log: boolean;
}

/** Exceção de handler → erro que o modelo consegue interpretar e contornar. */
export function errorFromException(err: unknown): MappedError {
  if (err instanceof ToolInputError) {
    return {
      result: toolError('invalid_input', err.message, { hint: err.hint, validValues: err.validValues, alternatives: err.alternatives }),
      log: false,
    };
  }
  if (err instanceof ToolTimeoutError) {
    return {
      result: toolError('timeout', err.message, {
        retryable: true,
        hint: 'Estreite o período (ou os filtros) e tente de novo; pra totais use aggregate_orders em vez de paginar.',
      }),
      log: true,
    };
  }
  if (err instanceof Error) {
    // normalizeScope sinaliza filtro inválido pela mensagem
    // ("invalid_input: <campo>: "x" não existe — valid: a, b · dica"); a lista
    // vira validValues (sem repetir na mensagem) e o sufixo vira hint.
    const m = /^invalid_input:\s*/.exec(err.message);
    if (m) {
      const e = err as Error & { validValues?: unknown; hint?: unknown };
      const body = err.message.slice(m[0].length);
      const listed = /\s*—\s*valid:\s*(.*?)(?:\s+·\s+(.+))?$/.exec(body);
      const parsed = listed?.[1].split(/,\s*/).filter((v) => v && !v.startsWith('…') && v !== '(nenhum)');
      return {
        result: toolError('invalid_input', (listed ? body.slice(0, listed.index) : body) || 'filtro inválido', {
          validValues: strArray(e.validValues) ?? parsed,
          hint: typeof e.hint === 'string' ? e.hint : listed?.[2] ?? 'Corrija o filtro com um dos valores válidos (em dúvida, use resolve_entities).',
        }),
        log: false,
      };
    }
    if (err.name === 'AbortError') {
      return { result: toolError('aborted', 'Consulta cancelada (o usuário saiu do chat).'), log: false };
    }
    const dbErr = err as Error & { code?: unknown; clientVersion?: unknown };
    if (isDbError(dbErr)) {
      // Mensagem crua do Prisma (SQL, nomes de coluna) não ajuda o modelo e
      // vaza detalhe interno — vai só pro log.
      return {
        result: toolError('query_failed', 'A consulta ao banco falhou.', {
          retryable: typeof dbErr.code === 'string' && TRANSIENT_PRISMA.has(dbErr.code),
          hint: 'Tente de novo uma vez; se repetir, estreite o período ou os filtros.',
        }),
        log: true,
      };
    }
    return { result: toolError('tool_execution_failed', err.message.slice(0, 300) || 'falha interna'), log: true };
  }
  return { result: toolError('tool_execution_failed', String(err).slice(0, 300)), log: true };
}
