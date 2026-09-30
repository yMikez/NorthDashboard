// Calculadora DETERMINÍSTICA do chat IA (tool `calc`) + resolvedor de
// caminhos `$rN.caminho` (também usado pelo aggregate_result).
//
// Por que existe: conta de cabeça é a fonte nº 1 de número errado na
// resposta — variação %, soma de páginas, participação, média ponderada.
// Aqui o modelo escreve a EXPRESSÃO e referencia os valores que as tools
// devolveram (`$r3.kpis.gross`), em vez de redigitar número.
//
// Segurança: parser recursivo descendente próprio — NADA de eval/Function.
// Caminhos só leem propriedades PRÓPRIAS (hasOwnProperty) e recusam
// __proto__/constructor/prototype; tamanho de expressão, profundidade e
// listas têm teto.

import { formatCell } from '../chat/format';

// ── Caminhos ($rN.a.b[0][*][campo=valor]) ──────────────────────────────

export type PathSegment =
  | { kind: 'key'; key: string }
  | { kind: 'index'; index: number }
  | { kind: 'all' }
  | { kind: 'match'; field: string; value: string };

export class CalcError extends Error {}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const IDENT_CHAR = /[A-Za-z0-9_]/;
const MAX_LIST = 200_000;

function assertSafeKey(key: string): void {
  if (FORBIDDEN_KEYS.has(key)) throw new CalcError(`chave proibida no caminho: "${key}"`);
}

/**
 * Lê segmentos de caminho a partir de `pos` até o primeiro caractere que não
 * pertence ao caminho. Devolve os segmentos e onde parou (o lexer da
 * expressão continua dali).
 */
export function readPath(src: string, start: number): { segments: PathSegment[]; end: number } {
  const segments: PathSegment[] = [];
  let i = start;
  for (;;) {
    const ch = src[i];
    if (ch === '.') {
      let j = i + 1;
      while (j < src.length && IDENT_CHAR.test(src[j])) j++;
      if (j === i + 1) throw new CalcError(`caminho inválido perto de "${src.slice(i, i + 12)}"`);
      const key = src.slice(i + 1, j);
      assertSafeKey(key);
      segments.push({ kind: 'key', key });
      i = j;
    } else if (ch === '[') {
      const close = findBracketEnd(src, i);
      segments.push(parseBracket(src.slice(i + 1, close)));
      i = close + 1;
    } else {
      break;
    }
  }
  return { segments, end: i };
}

function findBracketEnd(src: string, open: number): number {
  let quote: string | null = null;
  for (let j = open + 1; j < src.length; j++) {
    const c = src[j];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ']') {
      return j;
    }
  }
  throw new CalcError('colchete "[" sem fechamento no caminho');
}

function unquote(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]) return t.slice(1, -1);
  return t;
}

function parseBracket(inner: string): PathSegment {
  const body = inner.trim();
  if (body === '*') return { kind: 'all' };
  if (/^-?\d+$/.test(body)) return { kind: 'index', index: Number(body) };
  if (body.startsWith('"') || body.startsWith("'")) {
    const key = unquote(body);
    assertSafeKey(key);
    return { kind: 'key', key };
  }
  const eq = body.indexOf('=');
  if (eq > 0) {
    const field = body.slice(0, eq).trim();
    if (!/^[A-Za-z0-9_]+$/.test(field)) throw new CalcError(`campo inválido no filtro [${body}]`);
    assertSafeKey(field);
    return { kind: 'match', field, value: unquote(body.slice(eq + 1)) };
  }
  throw new CalcError(`segmento inválido [${body}] — use [0], [-1], [*], [campo=valor] ou ["chave"]`);
}

/** Caminho completo como string ("kpis.gross", "platforms[slug=x].refundRate"). */
export function parsePath(path: string): PathSegment[] {
  const src = path.trim();
  if (!src) return [];
  // Aceita "kpis.gross" (sem ponto inicial) além de ".kpis.gross".
  const normalized = src.startsWith('.') || src.startsWith('[') ? src : `.${src}`;
  const { segments, end } = readPath(normalized, 0);
  if (end !== normalized.length) throw new CalcError(`caminho inválido perto de "${normalized.slice(end, end + 12)}"`);
  return segments;
}

function ownProp(node: unknown, key: string): unknown {
  if (Array.isArray(node) && key === 'length') return node.length;
  if (node && typeof node === 'object' && Object.prototype.hasOwnProperty.call(node, key)) {
    return (node as Record<string, unknown>)[key];
  }
  return undefined;
}

function keysHint(node: unknown): string {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return '';
  const keys = Object.keys(node as object).slice(0, 15);
  return keys.length ? ` (chaves: ${keys.join(', ')})` : '';
}

function matchesValue(v: unknown, wanted: string, loose: boolean): boolean {
  if (v === null || v === undefined) return false;
  const s = String(v);
  return loose ? s.toLowerCase() === wanted.toLowerCase() : s === wanted;
}

function findMatch(arr: unknown[], field: string, value: string): unknown {
  // Exato primeiro; caixa diferente só como segunda chance (slug vs label).
  for (const el of arr) if (matchesValue(ownProp(el, field), value, false)) return el;
  for (const el of arr) if (matchesValue(ownProp(el, field), value, true)) return el;
  return undefined;
}

export interface ResolvedPath {
  values: unknown[];
  /** true = o caminho passou por [*] (resultado é lista). */
  multi: boolean;
}

/**
 * Resolve um caminho sobre um valor. Com [*] vira lista (multi); nas listas,
 * elementos sem a chave são descartados — mas se NENHUM tiver, é erro (o
 * modelo errou o nome do campo, e "soma = 0" seria um zero confiante).
 */
export function resolvePath(root: unknown, segments: PathSegment[], label = '$'): ResolvedPath {
  let cur: unknown[] = [root];
  let multi = false;
  let where = label;
  for (const seg of segments) {
    const next: unknown[] = [];
    switch (seg.kind) {
      case 'key': {
        where += `.${seg.key}`;
        for (const n of cur) {
          const v = ownProp(n, seg.key);
          if (v !== undefined) next.push(v);
        }
        if (!next.length) throw new CalcError(`${where}: chave "${seg.key}" não existe${keysHint(cur[0])}`);
        break;
      }
      case 'index': {
        where += `[${seg.index}]`;
        for (const n of cur) {
          if (!Array.isArray(n)) {
            if (!multi) throw new CalcError(`${where}: não é uma lista`);
            continue;
          }
          const idx = seg.index < 0 ? n.length + seg.index : seg.index;
          if (idx >= 0 && idx < n.length) next.push(n[idx]);
          else if (!multi) throw new CalcError(`${where}: índice fora da lista (tamanho ${n.length})`);
        }
        break;
      }
      case 'all': {
        where += '[*]';
        for (const n of cur) {
          if (Array.isArray(n)) next.push(...n);
          else if (n && typeof n === 'object') next.push(...Object.values(n as object));
          else if (!multi) throw new CalcError(`${where}: não é lista nem objeto`);
          if (next.length > MAX_LIST) throw new CalcError(`${where}: lista grande demais (> ${MAX_LIST} itens)`);
        }
        multi = true;
        break;
      }
      case 'match': {
        where += `[${seg.field}=${seg.value}]`;
        for (const n of cur) {
          if (!Array.isArray(n)) {
            if (!multi) throw new CalcError(`${where}: não é uma lista`);
            continue;
          }
          const hit = findMatch(n, seg.field, seg.value);
          if (hit !== undefined) next.push(hit);
          else if (!multi) {
            const sample = [...new Set(n.map((el) => ownProp(el, seg.field)).filter((v) => v != null).map(String))].slice(0, 12);
            throw new CalcError(`${where}: nenhum item com ${seg.field}="${seg.value}"${sample.length ? ` (existentes: ${sample.join(', ')})` : ''}`);
          }
        }
        break;
      }
    }
    cur = next;
  }
  return { values: cur, multi };
}

// ── Números ──────────────────────────────────────────────────────────────

const NUMERIC_STRING = /^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/;

/** Valor de resultado → número (Decimal/strings numéricas incluídos). null = ausente. */
export function toNumber(v: unknown, where: string): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new CalcError(`${where}: número não finito`);
    return v;
  }
  if (typeof v === 'string' && NUMERIC_STRING.test(v.trim())) return Number(v.trim());
  if (typeof v === 'object' && v !== null && typeof (v as { toNumber?: unknown }).toNumber === 'function') {
    const n = (v as { toNumber: () => number }).toNumber();
    if (Number.isFinite(n)) return n;
  }
  if (typeof v === 'object' && v !== null) {
    throw new CalcError(`${where}: aponta pra ${Array.isArray(v) ? 'uma lista' : 'um objeto'}, não pra um número${keysHint(v)}`);
  }
  throw new CalcError(`${where}: valor não numérico (${JSON.stringify(v).slice(0, 40)})`);
}

/** Tira o ruído de ponto flutuante (0.1+0.2) sem perder precisão útil. */
export function cleanFloat(n: number): number {
  return Number(n.toPrecision(12));
}

// ── Expressões ───────────────────────────────────────────────────────────

type Token =
  | { t: 'num'; v: number; pos: number }
  | { t: 'ref'; ref: string; segments: PathSegment[]; text: string; pos: number }
  | { t: 'id'; v: string; pos: number }
  | { t: 'op'; v: string; pos: number }
  | { t: 'end'; pos: number };

export const MAX_EXPR_LENGTH = 500;
const MAX_TOKENS = 400;
const MAX_DEPTH = 40;

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      const m = /^(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?/.exec(src.slice(i));
      if (!m) throw new CalcError(`número inválido na posição ${i + 1}`);
      if (!m[0].includes('.') && /^,\d{3}(?!\d)/.test(src.slice(i + m[0].length))) {
        // "1,234.56": separador de milhar. Dentro de sum(…) viraria DOIS
        // argumentos (1 e 234.56) e a conta sairia errada sem erro nenhum.
        throw new CalcError(`"${src.slice(i, i + m[0].length + 4)}" parece separador de milhar na posição ${i + 1} — escreva 1234.56 (sem vírgula) e separe argumentos com ", "`);
      }
      out.push({ t: 'num', v: Number(m[0]), pos: i });
      i += m[0].length;
      continue;
    }
    if (c === '$') {
      const m = /^\$(r\d+)/.exec(src.slice(i));
      if (!m) throw new CalcError(`referência inválida na posição ${i + 1} — use $r1, $r2… (a ref vem no campo _ref de cada resultado)`);
      const { segments, end } = readPath(src, i + m[0].length);
      out.push({ t: 'ref', ref: m[1], segments, text: src.slice(i, end), pos: i });
      i = end;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < src.length && IDENT_CHAR.test(src[j])) j++;
      out.push({ t: 'id', v: src.slice(i, j), pos: i });
      i = j;
      continue;
    }
    if ('+-*/^(),'.includes(c)) {
      out.push({ t: 'op', v: c, pos: i });
      i++;
      continue;
    }
    if (c === '−') { // sinal de menos tipográfico
      out.push({ t: 'op', v: '-', pos: i });
      i++;
      continue;
    }
    if (c === '%') throw new CalcError(`"%" não é operador — escreva 12.5 (pontos) ou 0.125 (fração) e use pct_change/share`);
    throw new CalcError(`caractere inesperado "${c}" na posição ${i + 1}`);
  }
  out.push({ t: 'end', pos: src.length });
  if (out.length > MAX_TOKENS) throw new CalcError(`expressão longa demais (${out.length} tokens)`);
  return out;
}

type Node =
  | { k: 'num'; v: number }
  | { k: 'ref'; ref: string; segments: PathSegment[]; text: string }
  | { k: 'name'; name: string }
  | { k: 'neg'; e: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'call'; fn: string; args: Node[] };

class Parser {
  private p = 0;
  constructor(private toks: Token[]) {}

  parse(): Node {
    const n = this.expr(0);
    const t = this.peek();
    if (t.t !== 'end') throw new CalcError(`sobrou "${this.describe(t)}" na posição ${t.pos + 1}`);
    return n;
  }

  private peek(): Token { return this.toks[this.p]; }
  private next(): Token { return this.toks[this.p++]; }
  private isOp(v: string): boolean { const t = this.peek(); return t.t === 'op' && t.v === v; }
  private describe(t: Token): string {
    return t.t === 'num' ? String(t.v) : t.t === 'ref' ? t.text : t.t === 'id' || t.t === 'op' ? t.v : 'fim';
  }
  private guard(depth: number): void {
    if (depth > MAX_DEPTH) throw new CalcError('expressão aninhada demais');
  }

  private expr(d: number): Node {
    this.guard(d);
    let a = this.term(d + 1);
    while (this.isOp('+') || this.isOp('-')) {
      const op = (this.next() as { v: string }).v;
      a = { k: 'bin', op, a, b: this.term(d + 1) };
    }
    return a;
  }

  private term(d: number): Node {
    this.guard(d);
    let a = this.unary(d + 1);
    while (this.isOp('*') || this.isOp('/')) {
      const op = (this.next() as { v: string }).v;
      a = { k: 'bin', op, a, b: this.unary(d + 1) };
    }
    return a;
  }

  // Menos unário liga MENOS que a potência: -2^2 = -4 (convenção matemática).
  private unary(d: number): Node {
    this.guard(d);
    if (this.isOp('-')) { this.next(); return { k: 'neg', e: this.unary(d + 1) }; }
    if (this.isOp('+')) { this.next(); return this.unary(d + 1); }
    return this.power(d + 1);
  }

  private power(d: number): Node {
    this.guard(d);
    const base = this.primary(d + 1);
    if (this.isOp('^')) {
      this.next();
      return { k: 'bin', op: '^', a: base, b: this.unary(d + 1) }; // associativa à direita
    }
    return base;
  }

  private primary(d: number): Node {
    this.guard(d);
    const t = this.next();
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'ref') return { k: 'ref', ref: t.ref, segments: t.segments, text: t.text };
    if (t.t === 'id') {
      if (this.isOp('(')) {
        this.next();
        const args: Node[] = [];
        if (!this.isOp(')')) {
          for (;;) {
            args.push(this.expr(d + 1));
            if (this.isOp(',')) { this.next(); continue; }
            break;
          }
        }
        if (!this.isOp(')')) throw new CalcError(`faltou ")" em ${t.v}(…)`);
        this.next();
        return { k: 'call', fn: t.v, args };
      }
      return { k: 'name', name: t.v };
    }
    if (t.t === 'op' && t.v === '(') {
      const e = this.expr(d + 1);
      if (!this.isOp(')')) throw new CalcError('faltou ")"');
      this.next();
      return e;
    }
    throw new CalcError(t.t === 'end' ? 'expressão incompleta' : `"${this.describe(t)}" inesperado na posição ${t.pos + 1}`);
  }
}

export function parseExpression(src: string): Node {
  if (src.length > MAX_EXPR_LENGTH) throw new CalcError(`expressão com mais de ${MAX_EXPR_LENGTH} caracteres`);
  return new Parser(tokenize(src)).parse();
}

// ── Avaliação ────────────────────────────────────────────────────────────

type Val = { list: false; v: number | null } | { list: true; v: Array<number | null> };

export interface CalcScope {
  /** Resultado armazenado por ref (só os legíveis — rodadas anteriores). */
  ref(ref: string): unknown;
  /** Nome definido antes (mesma chamada ou calc anterior). undefined = não existe. */
  name(name: string): number | null | undefined;
}

const SCALAR = (v: number | null): Val => ({ list: false, v });

function scalarOf(val: Val, what: string): number | null {
  if (val.list) throw new CalcError(`${what} espera um número, recebeu uma lista — agregue com sum/avg/min/max/median/count`);
  return val.v;
}

function flatten(args: Val[]): number[] {
  const out: number[] = [];
  for (const a of args) {
    if (a.list) { for (const x of a.v) if (x != null) out.push(x); }
    else if (a.v != null) out.push(a.v);
  }
  return out;
}

function listOf(val: Val): Array<number | null> {
  return val.list ? val.v : [val.v];
}

function roundTo(x: number, d: number): number {
  // Meio pra longe do zero, sem o erro clássico de 1.005 → 1.00.
  const sign = x < 0 ? -1 : 1;
  const r = Number(`${Math.round(Number(`${Math.abs(x)}e${d}`))}e-${d}`);
  return sign * r;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function need(args: Val[], n: number, fn: string, max = n): void {
  if (args.length < n || args.length > max) {
    throw new CalcError(`${fn} recebe ${n === max ? n : `${n} a ${max}`} argumento(s), recebeu ${args.length}`);
  }
}

const FUNCTIONS: Record<string, (args: Val[]) => Val> = {
  sum: (a) => SCALAR(flatten(a).reduce((s, x) => s + x, 0)),
  avg: (a) => { const xs = flatten(a); return SCALAR(xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null); },
  median: (a) => SCALAR(median(flatten(a))),
  min: (a) => { const xs = flatten(a); return SCALAR(xs.length ? Math.min(...xs) : null); },
  max: (a) => { const xs = flatten(a); return SCALAR(xs.length ? Math.max(...xs) : null); },
  count: (a) => SCALAR(flatten(a).length),
  abs: (a) => { need(a, 1, 'abs'); const x = scalarOf(a[0], 'abs'); return SCALAR(x == null ? null : Math.abs(x)); },
  round: (a) => {
    need(a, 1, 'round', 2);
    const x = scalarOf(a[0], 'round');
    const d = a[1] ? scalarOf(a[1], 'round') : 0;
    if (d == null || !Number.isInteger(d) || d < 0 || d > 10) throw new CalcError('round(x, d): d deve ser inteiro de 0 a 10');
    return SCALAR(x == null ? null : roundTo(x, d));
  },
  safe_div: (a) => {
    need(a, 2, 'safe_div');
    const x = scalarOf(a[0], 'safe_div'); const y = scalarOf(a[1], 'safe_div');
    return SCALAR(x == null || y == null || y === 0 ? null : x / y);
  },
  pct_change: (a) => {
    need(a, 2, 'pct_change');
    const n = scalarOf(a[0], 'pct_change'); const o = scalarOf(a[1], 'pct_change');
    if (n == null || o == null) return SCALAR(null);
    if (o === 0) throw new CalcError('pct_change com base zero (valor antigo = 0)');
    return SCALAR((n / o - 1) * 100);
  },
  pp_change: (a) => {
    need(a, 2, 'pp_change');
    const n = scalarOf(a[0], 'pp_change'); const o = scalarOf(a[1], 'pp_change');
    return SCALAR(n == null || o == null ? null : (n - o) * 100);
  },
  share: (a) => {
    need(a, 2, 'share');
    const p = scalarOf(a[0], 'share'); const t = scalarOf(a[1], 'share');
    if (p == null || t == null) return SCALAR(null);
    if (t === 0) throw new CalcError('share com total zero');
    return SCALAR((p / t) * 100);
  },
  weighted_avg: (a) => {
    need(a, 2, 'weighted_avg');
    const vs = listOf(a[0]); const ws = listOf(a[1]);
    if (vs.length !== ws.length) throw new CalcError(`weighted_avg: listas de tamanhos diferentes (${vs.length} valores × ${ws.length} pesos)`);
    let num = 0; let den = 0;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i]; const w = ws[i];
      if (v == null || w == null) continue;
      num += v * w; den += w;
    }
    if (den === 0) throw new CalcError('weighted_avg: soma dos pesos = 0');
    return SCALAR(num / den);
  },
  cagr: (a) => {
    need(a, 3, 'cagr');
    const e = scalarOf(a[0], 'cagr'); const s = scalarOf(a[1], 'cagr'); const p = scalarOf(a[2], 'cagr');
    if (e == null || s == null || p == null) return SCALAR(null);
    if (s <= 0 || e < 0 || p <= 0) throw new CalcError('cagr(fim, início, períodos) exige início > 0, fim ≥ 0 e períodos > 0');
    return SCALAR((Math.pow(e / s, 1 / p) - 1) * 100);
  },
};

export const CALC_FUNCTIONS = Object.keys(FUNCTIONS);

/** Só funções PRÓPRIAS da tabela — "constructor"/"toString" não viram chamada. */
function fnOf(name: string): ((args: Val[]) => Val) | undefined {
  return Object.prototype.hasOwnProperty.call(FUNCTIONS, name) ? FUNCTIONS[name] : undefined;
}
/** Funções que devolvem PONTOS PERCENTUAIS — definem a unidade default. */
const PERCENT_FUNCTIONS = new Set(['pct_change', 'share', 'cagr']);

function evalNode(n: Node, scope: CalcScope): Val {
  switch (n.k) {
    case 'num':
      return SCALAR(n.v);
    case 'ref': {
      const root = scope.ref(n.ref);
      const r = resolvePath(root, n.segments, `$${n.ref}`);
      if (r.multi) return { list: true, v: r.values.map((v) => toNumber(v, n.text)) };
      const only = r.values[0];
      if (Array.isArray(only)) return { list: true, v: only.map((v) => toNumber(v, n.text)) };
      return SCALAR(toNumber(only, n.text));
    }
    case 'name': {
      const v = scope.name(n.name);
      if (v === undefined) {
        throw new CalcError(fnOf(n.name) ? `${n.name} é função — use ${n.name}(…)` : `nome desconhecido "${n.name}" (defina antes, na mesma lista de expressões)`);
      }
      return SCALAR(v);
    }
    case 'neg': {
      const v = scalarOf(evalNode(n.e, scope), 'o sinal de menos');
      return SCALAR(v == null ? null : -v);
    }
    case 'bin': {
      const a = scalarOf(evalNode(n.a, scope), `"${n.op}"`);
      const b = scalarOf(evalNode(n.b, scope), `"${n.op}"`);
      if (a == null || b == null) return SCALAR(null);
      switch (n.op) {
        case '+': return SCALAR(a + b);
        case '-': return SCALAR(a - b);
        case '*': return SCALAR(a * b);
        case '/':
          if (b === 0) throw new CalcError('divisão por zero');
          return SCALAR(a / b);
        case '^': {
          const r = Math.pow(a, b);
          if (!Number.isFinite(r)) throw new CalcError('potência sem resultado finito');
          return SCALAR(r);
        }
        default:
          throw new CalcError(`operador desconhecido ${n.op}`);
      }
    }
    case 'call': {
      const fn = fnOf(n.fn);
      if (!fn) throw new CalcError(`função desconhecida "${n.fn}" (disponíveis: ${CALC_FUNCTIONS.join(', ')})`);
      return fn(n.args.map((x) => evalNode(x, scope)));
    }
  }
}

export function evaluate(src: string, scope: CalcScope): number | null {
  const v = evalNode(parseExpression(src), scope);
  if (v.list) throw new CalcError('o resultado é uma lista — agregue com sum/avg/min/max/median/count');
  if (v.v != null && !Number.isFinite(v.v)) throw new CalcError('resultado não finito');
  return v.v == null ? null : cleanFloat(v.v);
}

// ── Lote de expressões nomeadas (a tool) ─────────────────────────────────

export const CALC_UNITS = ['usd', 'percent', 'pp', 'fraction', 'count', 'number', 'days'] as const;
export type CalcUnit = (typeof CALC_UNITS)[number];

export interface CalcExpression { name: string; expr: string; unit?: CalcUnit }
export interface CalcResult { name: string; value: number | null; unit: CalcUnit; display: string }
export interface CalcOutput { results: CalcResult[]; errors: Array<{ name: string; message: string }> }

export const MAX_EXPRESSIONS = 40;
const NAME_RE = /^[a-z_][a-z0-9_]{0,40}$/;

const INT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Formato de exibição (US: $1,234.56 · 12.3%) — o que o modelo copia pros blocos. */
export function displayValue(v: number | null, unit: CalcUnit): string {
  if (v == null) return '—';
  switch (unit) {
    case 'usd': return formatCell(v, 'currency');
    case 'percent': return formatCell(v, 'percent');
    case 'fraction': return formatCell(v, 'fraction');
    case 'pp': {
      const body = formatCell(Math.abs(v), 'percent').replace('%', ' pp');
      return `${v > 0 ? '+' : v < 0 ? '−' : ''}${body}`;
    }
    case 'count': return Number.isInteger(v) ? INT.format(v) : formatCell(v, 'number');
    case 'days': return `${formatCell(v, 'number')} dias`;
    default: return formatCell(v, 'number');
  }
}

function inferUnit(expr: string): CalcUnit {
  try {
    let n = parseExpression(expr);
    // round(…)/abs(…)/−(…) não mudam a unidade: round(pct_change(a, b), 1)
    // saía "12.5" (sem %) no display que o modelo copia pros blocos.
    for (;;) {
      if (n.k === 'neg') { n = n.e; continue; }
      if (n.k === 'call' && (n.fn === 'round' || n.fn === 'abs') && n.args.length >= 1) { n = n.args[0]; continue; }
      break;
    }
    if (n.k === 'call' && PERCENT_FUNCTIONS.has(n.fn)) return 'percent';
    if (n.k === 'call' && n.fn === 'pp_change') return 'pp';
  } catch {
    /* erro de sintaxe aparece na avaliação */
  }
  return 'number';
}

export interface CalcEnv {
  ref(ref: string): unknown;
  /** Contas de calls anteriores (ResultStore.calcValues). */
  previous?: ReadonlyMap<string, number | null>;
  /** Grava cada resultado (ResultStore.putCalc) — base da checagem de números. */
  save?(name: string, value: number | null): void;
}

export function runCalc(expressions: CalcExpression[], env: CalcEnv): CalcOutput {
  const local = new Map<string, number | null>();
  const failed = new Set<string>();
  const results: CalcResult[] = [];
  const errors: CalcOutput['errors'] = [];
  const scope: CalcScope = {
    ref: env.ref,
    name: (n) => {
      if (failed.has(n)) throw new CalcError(`depende de "${n}", que falhou`);
      if (local.has(n)) return local.get(n)!;
      if (env.previous?.has(n)) return env.previous.get(n)!;
      return undefined;
    },
  };
  for (const e of expressions) {
    const name = e.name;
    if (local.has(name) || failed.has(name)) { errors.push({ name, message: 'nome repetido nesta lista' }); continue; }
    if (fnOf(name)) { errors.push({ name, message: `"${name}" é nome de função — escolha outro` }); failed.add(name); continue; }
    try {
      const value = evaluate(e.expr, scope);
      const unit = e.unit ?? inferUnit(e.expr);
      local.set(name, value);
      env.save?.(name, value);
      results.push({ name, value, unit, display: displayValue(value, unit) });
      if (value == null) errors.push({ name, message: 'sem valor: dado ausente ou divisão por zero em safe_div' });
    } catch (err) {
      failed.add(name);
      errors.push({ name, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return { results, errors };
}

/** Valida o input cru da tool; devolve a lista tipada ou a mensagem de erro. */
export function parseCalcInput(raw: unknown): CalcExpression[] | string {
  const list = (raw as { expressions?: unknown })?.expressions;
  if (!Array.isArray(list) || list.length === 0) return 'expressions deve ser uma lista com ao menos 1 item {name, expr}';
  if (list.length > MAX_EXPRESSIONS) return `no máximo ${MAX_EXPRESSIONS} expressões por chamada`;
  const out: CalcExpression[] = [];
  for (const [i, item] of list.entries()) {
    const it = item as { name?: unknown; expr?: unknown; unit?: unknown };
    if (typeof it?.name !== 'string' || !NAME_RE.test(it.name)) return `expressions[${i}].name inválido — use minúsculas, dígitos e _ (ex.: "var_receita")`;
    if (typeof it.expr !== 'string' || !it.expr.trim()) return `expressions[${i}].expr vazio`;
    if (it.expr.length > MAX_EXPR_LENGTH) return `expressions[${i}].expr passa de ${MAX_EXPR_LENGTH} caracteres`;
    if (it.unit !== undefined && !(CALC_UNITS as readonly string[]).includes(String(it.unit))) {
      return `expressions[${i}].unit inválido — use ${CALC_UNITS.join(', ')}`;
    }
    out.push({ name: it.name, expr: it.expr, unit: it.unit as CalcUnit | undefined });
  }
  return out;
}
