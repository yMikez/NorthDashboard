// aggregate_result: filtro/agrupamento/métricas sobre o resultado COMPLETO
// de uma tool já guardado no ResultStore — mesmo quando o modelo viu a lista
// truncada (fitToolResult corta pra caber no contexto; o store não).
//
// Puro (sem banco). As métricas existem pra matar dois erros clássicos:
//   - média de razões no lugar de razão de somas (taxa de reembolso média
//     por afiliado ≠ reembolsos totais ÷ pedidos totais) → ratio_of_sums;
//   - somar a olho uma lista de 600 linhas → sum/count exatos.

import { CalcError, cleanFloat, parsePath, resolvePath, toNumber } from './calc';

export const WHERE_OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'contains', 'is_null', 'not_null'] as const;
export type WhereOp = (typeof WHERE_OPS)[number];
export const METRIC_OPS = ['sum', 'avg', 'min', 'max', 'median', 'count', 'count_distinct', 'weighted_avg', 'ratio_of_sums', 'first'] as const;
export type MetricOp = (typeof METRIC_OPS)[number];

export interface WhereClause { field: string; op: WhereOp; value?: unknown }
export interface MetricSpec { name: string; op: MetricOp; field?: string; weight?: string; num?: string; den?: string }
export interface AggregateSpec {
  path?: string;
  where?: WhereClause[];
  group_by?: string[];
  metrics?: MetricSpec[];
  sort?: { by: string; dir?: 'asc' | 'desc' };
  limit?: number;
  select?: string[];
}

export interface AggregateOutput {
  path: string;
  sourceRows: number;
  matched: number;
  groups?: number;
  returned: number;
  rows: Array<Record<string, unknown>>;
  totals: Record<string, number | string | null> | null;
  notes: string[];
}

export const AGG_DEFAULT_LIMIT = 100;
export const AGG_MAX_LIMIT = 1000;
const FIELD_RE = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+){0,4}$/;
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/;

export class AggregateInputError extends Error {}

function checkField(f: unknown, where: string): string {
  if (typeof f !== 'string' || !FIELD_RE.test(f)) throw new AggregateInputError(`${where}: campo inválido "${String(f)}" (use nome ou caminho com ponto, ex.: "revenue", "platform.slug")`);
  for (const part of f.split('.')) if (FORBIDDEN.has(part)) throw new AggregateInputError(`${where}: campo proibido "${f}"`);
  return f;
}

/** Campo (com ponto) de uma linha — só propriedades próprias. */
export function fieldValue(row: unknown, field: string): unknown {
  let cur: unknown = row;
  for (const part of field.split('.')) {
    if (!cur || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, part)) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function num(v: unknown): number | null {
  try {
    return toNumber(v, 'campo');
  } catch {
    return null;
  }
}

function sameText(a: unknown, b: unknown): boolean {
  return String(a).toLowerCase() === String(b).toLowerCase();
}

function compare(a: unknown, b: unknown): number | null {
  const x = num(a); const y = num(b);
  if (x != null && y != null) return x - y;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0; // datas ISO comparam como texto
  return null;
}

function matches(row: unknown, w: WhereClause): boolean {
  const v = fieldValue(row, w.field);
  switch (w.op) {
    case 'is_null': return v === null || v === undefined;
    case 'not_null': return v !== null && v !== undefined;
    case 'eq': {
      if (v === null || v === undefined) return w.value === null;
      const x = num(v); const y = num(w.value);
      return x != null && y != null ? x === y : sameText(v, w.value);
    }
    case 'ne': return !matches(row, { ...w, op: 'eq' });
    case 'in': return Array.isArray(w.value) && w.value.some((c) => matches(row, { field: w.field, op: 'eq', value: c }));
    case 'contains': {
      if (Array.isArray(v)) return v.some((x) => sameText(x, w.value));
      return v != null && String(v).toLowerCase().includes(String(w.value ?? '').toLowerCase());
    }
    default: {
      if (v === null || v === undefined) return false;
      const c = compare(v, w.value);
      if (c == null) return false;
      return w.op === 'gt' ? c > 0 : w.op === 'gte' ? c >= 0 : w.op === 'lt' ? c < 0 : c <= 0;
    }
  }
}

function numbers(rows: unknown[], field: string): number[] {
  const out: number[] = [];
  for (const r of rows) {
    const x = num(fieldValue(r, field));
    if (x != null) out.push(x);
  }
  return out;
}

const round = (x: number | null): number | null => (x == null ? null : cleanFloat(x));

export function computeMetric(rows: unknown[], m: MetricSpec): number | string | null {
  switch (m.op) {
    case 'count':
      return m.field ? rows.filter((r) => fieldValue(r, m.field!) != null).length : rows.length;
    case 'count_distinct':
      return new Set(rows.map((r) => fieldValue(r, m.field!)).filter((v) => v != null).map((v) => String(v))).size;
    case 'sum':
      return round(numbers(rows, m.field!).reduce((s, x) => s + x, 0));
    case 'avg': {
      const xs = numbers(rows, m.field!);
      return round(xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
    }
    case 'min': { const xs = numbers(rows, m.field!); return xs.length ? Math.min(...xs) : null; }
    case 'max': { const xs = numbers(rows, m.field!); return xs.length ? Math.max(...xs) : null; }
    case 'median': {
      const xs = numbers(rows, m.field!).sort((a, b) => a - b);
      if (!xs.length) return null;
      const mid = Math.floor(xs.length / 2);
      return round(xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2);
    }
    case 'weighted_avg': {
      let n = 0; let d = 0;
      for (const r of rows) {
        const v = num(fieldValue(r, m.field!)); const w = num(fieldValue(r, m.weight!));
        if (v == null || w == null) continue;
        n += v * w; d += w;
      }
      return d === 0 ? null : round(n / d);
    }
    case 'ratio_of_sums': {
      const n = numbers(rows, m.num!).reduce((s, x) => s + x, 0);
      const d = numbers(rows, m.den!).reduce((s, x) => s + x, 0);
      return d === 0 ? null : round(n / d);
    }
    case 'first': {
      for (const r of rows) {
        const v = fieldValue(r, m.field!);
        if (v != null) return typeof v === 'number' || typeof v === 'string' ? v : String(v);
      }
      return null;
    }
  }
}

/** Valida e normaliza o input cru (vindo do modelo). */
export function parseAggregateSpec(raw: Record<string, unknown>): AggregateSpec {
  const spec: AggregateSpec = {};
  if (raw.path !== undefined) {
    if (typeof raw.path !== 'string') throw new AggregateInputError('path deve ser texto (ex.: "affiliates", "windows[-1].rows")');
    spec.path = raw.path;
  }
  if (raw.where !== undefined) {
    if (!Array.isArray(raw.where)) throw new AggregateInputError('where deve ser uma lista de {field, op, value}');
    spec.where = raw.where.map((w, i) => {
      const c = w as Record<string, unknown>;
      const op = String(c?.op ?? '') as WhereOp;
      if (!(WHERE_OPS as readonly string[]).includes(op)) throw new AggregateInputError(`where[${i}].op inválido — use ${WHERE_OPS.join(', ')}`);
      if (op === 'in' && !Array.isArray(c.value)) throw new AggregateInputError(`where[${i}]: op "in" exige value lista`);
      if (!['is_null', 'not_null'].includes(op) && c.value === undefined) throw new AggregateInputError(`where[${i}]: falta value`);
      return { field: checkField(c.field, `where[${i}]`), op, value: c.value };
    });
  }
  if (raw.group_by !== undefined) {
    if (!Array.isArray(raw.group_by) || raw.group_by.length > 3) throw new AggregateInputError('group_by deve ser lista de até 3 campos');
    spec.group_by = raw.group_by.map((f, i) => checkField(f, `group_by[${i}]`));
  }
  if (raw.metrics !== undefined) {
    if (!Array.isArray(raw.metrics) || raw.metrics.length > 20) throw new AggregateInputError('metrics deve ser lista de até 20 itens {name, op, …}');
    const names = new Set<string>();
    spec.metrics = raw.metrics.map((m, i) => {
      const c = m as Record<string, unknown>;
      const name = String(c?.name ?? '');
      if (!NAME_RE.test(name) || FORBIDDEN.has(name)) throw new AggregateInputError(`metrics[${i}].name inválido (letras, dígitos e _)`);
      if (names.has(name)) throw new AggregateInputError(`metrics[${i}].name repetido: ${name}`);
      names.add(name);
      const op = String(c.op ?? '') as MetricOp;
      if (!(METRIC_OPS as readonly string[]).includes(op)) throw new AggregateInputError(`metrics[${i}].op inválido — use ${METRIC_OPS.join(', ')}`);
      const out: MetricSpec = { name, op };
      if (op === 'ratio_of_sums') {
        out.num = checkField(c.num, `metrics[${i}].num`);
        out.den = checkField(c.den, `metrics[${i}].den`);
      } else if (op === 'weighted_avg') {
        out.field = checkField(c.field, `metrics[${i}].field`);
        out.weight = checkField(c.weight, `metrics[${i}].weight`);
      } else if (op !== 'count' || c.field !== undefined) {
        out.field = checkField(c.field, `metrics[${i}].field`);
      }
      return out;
    });
  }
  if (raw.sort !== undefined) {
    const s = raw.sort as Record<string, unknown>;
    if (!s || typeof s !== 'object') throw new AggregateInputError('sort deve ser {by, dir}');
    spec.sort = { by: checkField(s.by, 'sort.by'), dir: s.dir === 'asc' ? 'asc' : 'desc' };
  }
  if (raw.limit !== undefined) {
    const n = Math.trunc(Number(raw.limit));
    if (!Number.isFinite(n) || n < 1) throw new AggregateInputError('limit deve ser inteiro ≥ 1');
    spec.limit = Math.min(n, AGG_MAX_LIMIT);
  }
  if (raw.select !== undefined) {
    if (!Array.isArray(raw.select) || raw.select.length > 30) throw new AggregateInputError('select deve ser lista de até 30 campos');
    spec.select = raw.select.map((f, i) => checkField(f, `select[${i}]`));
  }
  return spec;
}

/** Listas dentro do valor (até 2 níveis) — pra sugerir `path` quando o modelo não passou. */
function arrayPaths(value: unknown): string[] {
  const out: string[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k.startsWith('_')) continue;
    if (Array.isArray(v)) out.push(k);
    else if (v && typeof v === 'object') {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) if (Array.isArray(v2)) out.push(`${k}.${k2}`);
    }
  }
  return out;
}

function resolveRows(value: unknown, path: string | undefined, notes: string[]): { rows: unknown[]; path: string } {
  if (!path) {
    if (Array.isArray(value)) return { rows: value, path: '' };
    const candidates = arrayPaths(value);
    if (candidates.length === 1) {
      notes.push(`path omitido: usei "${candidates[0]}" (única lista do resultado)`);
      return resolveRows(value, candidates[0], notes);
    }
    throw new AggregateInputError(`informe path — listas disponíveis: ${candidates.join(', ') || '(nenhuma)'}`);
  }
  let segments;
  try {
    segments = parsePath(path);
  } catch (err) {
    throw new AggregateInputError(err instanceof Error ? err.message : String(err));
  }
  let r;
  try {
    r = resolvePath(value, segments, path);
  } catch (err) {
    if (err instanceof CalcError) throw new AggregateInputError(`${err.message}${arrayPaths(value).length ? ` — listas: ${arrayPaths(value).join(', ')}` : ''}`);
    throw err;
  }
  // "windows[*].rows" = uma lista por janela → junta todas numa só.
  if (r.multi) return { rows: r.values.flatMap((v) => (Array.isArray(v) ? v : [v])), path };
  if (!Array.isArray(r.values[0])) throw new AggregateInputError(`"${path}" não é uma lista`);
  return { rows: r.values[0] as unknown[], path };
}

function sortRows(rows: Array<Record<string, unknown>>, by: string, dir: 'asc' | 'desc'): void {
  const sign = dir === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    const va = a[by]; const vb = b[by];
    const na = va == null; const nb = vb == null;
    if (na || nb) return na === nb ? 0 : na ? 1 : -1; // nulos sempre no fim
    const c = compare(va, vb);
    return c == null ? 0 : sign * c;
  });
}

export function runAggregate(value: unknown, spec: AggregateSpec): AggregateOutput {
  const notes: string[] = [];
  const { rows: source, path } = resolveRows(value, spec.path, notes);
  // Campo com nome errado virava soma 0 / "todas as linhas são null" sem
  // erro (zero confiante) — o calc já recusa chave inexistente; aqui também.
  const used = new Set<string>([
    ...(spec.where ?? []).map((w) => w.field),
    ...(spec.group_by ?? []),
    ...(spec.metrics ?? []).flatMap((m) => [m.field, m.weight, m.num, m.den].filter((f): f is string => !!f)),
    ...(spec.select ?? []),
    ...(spec.sort && !spec.group_by?.length && !spec.metrics?.length ? [spec.sort.by] : []),
  ]);
  for (const f of used) {
    if (source.length && !source.some((r) => fieldValue(r, f) !== undefined)) {
      const first = source.find((r) => r && typeof r === 'object' && !Array.isArray(r));
      const keys = first ? Object.keys(first as object).slice(0, 30).join(', ') : '';
      throw new AggregateInputError(`campo "${f}" não existe nas linhas de "${path || '(lista)'}"${keys ? ` — campos: ${keys}` : ''}`);
    }
  }
  const matched = spec.where?.length ? source.filter((r) => spec.where!.every((w) => matches(r, w))) : source;
  const limit = spec.limit ?? AGG_DEFAULT_LIMIT;
  const metrics = spec.metrics ?? [];
  const totals = metrics.length ? Object.fromEntries(metrics.map((m) => [m.name, computeMetric(matched, m)])) : null;

  if (spec.group_by?.length) {
    const groups = new Map<string, { key: unknown[]; rows: unknown[] }>();
    for (const r of matched) {
      const key = spec.group_by.map((f) => fieldValue(r, f) ?? null);
      const k = JSON.stringify(key);
      let g = groups.get(k);
      if (!g) { g = { key, rows: [] }; groups.set(k, g); }
      g.rows.push(r);
    }
    const effective = metrics.length ? metrics : [{ name: 'count', op: 'count' as const }];
    const out = [...groups.values()].map((g) => {
      const row: Record<string, unknown> = {};
      spec.group_by!.forEach((f, i) => { row[f] = g.key[i]; });
      for (const m of effective) row[m.name] = computeMetric(g.rows, m);
      return row;
    });
    const by = spec.sort?.by ?? effective[0].name;
    if (out.length && !Object.prototype.hasOwnProperty.call(out[0], by)) throw new AggregateInputError(`sort.by "${by}" não é métrica nem campo do group_by`);
    sortRows(out, by, spec.sort?.dir ?? 'desc');
    if (spec.select?.length) notes.push('select é ignorado com group_by (as linhas são os grupos)');
    const rows = out.slice(0, limit);
    return { path, sourceRows: source.length, matched: matched.length, groups: out.length, returned: rows.length, rows, totals: totals ?? { count: matched.length }, notes };
  }

  if (metrics.length) {
    return { path, sourceRows: source.length, matched: matched.length, returned: 1, rows: [totals as Record<string, unknown>], totals, notes };
  }

  // Sem agrupamento nem métrica: as próprias linhas (filtradas/ordenadas).
  let out: Array<Record<string, unknown>> = matched.map((r) => {
    if (spec.select?.length) return Object.fromEntries(spec.select.map((f) => [f, fieldValue(r, f) ?? null]));
    return (r && typeof r === 'object' && !Array.isArray(r) ? r : { value: r }) as Record<string, unknown>;
  });
  if (spec.sort) {
    const by = spec.sort.by;
    out = out.map((r) => (Object.prototype.hasOwnProperty.call(r, by) ? r : { ...r, [by]: fieldValue(r, by) ?? null }));
    sortRows(out, by, spec.sort.dir ?? 'desc');
  }
  const rows = out.slice(0, limit);
  return { path, sourceRows: source.length, matched: matched.length, returned: rows.length, rows, totals: null, notes };
}
