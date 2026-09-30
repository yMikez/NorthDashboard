// Contrato declarativo de um caso do eval do chat (golden) + resolução de
// datas relativas e de caminhos dentro do resultado das tools.
//
// Princípio: o valor esperado NÃO é escrito no caso — é recalculado na hora
// chamando a MESMA tool que o modelo usa (executeTool) e lendo um caminho do
// resultado. Assim o golden não envelhece com o dado e mede exatamente o
// caminho de produção. O caso é JSON puro (vai pro banco em ChatEvalCase).

import { brtRangeForPreset } from '../../shared/datePresets';

// ── Tipos ───────────────────────────────────────────────────────────────

export const GOLDEN_CATEGORIES = [
  'numero',
  'ranking',
  'comparacao',
  'lente',
  'unidade',
  'filtro',
  'deitico',
  'indisponivel',
  'paginacao',
  'saude',
  'multiturno',
  'definicao',
  'anexo',
  'rag',
] as const;
export type GoldenCategory = (typeof GOLDEN_CATEGORIES)[number];

/**
 * Data: 'YYYY-MM-DD' fixo ou token relativo resolvido no dia civil BRT do
 * momento da execução: $today, $yesterday, $d-N (N dias antes de hoje),
 * $mstart/$pmstart/$pmend (mês atual / anterior), $wstart (segunda desta
 * semana), $pwstart/$pwend (semana passada, segunda→domingo).
 */
export type DateRef = string;

/** O que a tela mostra quando a pergunta é feita (vira o uiState do request). */
export interface UiSpec {
  route?: string;
  /** Preset da barra (today|yesterday|7d|30d|90d|mtd|qtd|ytd) — dia civil BRT. */
  preset?: string;
  /** Período personalizado (a SPA monta em dia UTC — ver spaCustomRange). */
  from?: DateRef;
  to?: DateRef;
  platforms?: string[];
  families?: string[];
  stages?: string[];
  countries?: string[];
  affiliates?: string[];
}

export type FactKind = 'usd' | 'ratio' | 'pct' | 'int' | 'number' | 'text';

export interface LensSource {
  tool: string;
  args?: Record<string, unknown>;
  /** Caminho no resultado — gramática em resolvePath. */
  path: string;
}

export type LensCalcOp = 'pct_change' | 'diff' | 'sum' | 'ratio' | 'dominant';

/**
 * Uma definição aceitável do número ("lente"). Ou lê um caminho (source), ou
 * combina caminhos (calc): pct_change = (a−b)/|b|×100 (pontos percentuais),
 * diff = a−b, sum = Σ, ratio = a/b, dominant = rótulo da entrada de maior
 * |valor| (fato de texto: "foi volume ou AOV?").
 */
export interface Lens {
  name: string;
  source?: LensSource;
  calc?: { op: LensCalcOp; inputs: LensSource[]; labels?: string[] };
  /**
   * Palavras que NOMEIAM a lente (texto simples, sem regex; caixa e acento
   * ignorados). Com várias lentes, número certo sem o nome perto = lens_mismatch.
   */
  keywords?: string[];
  /** Unidade própria da lente (ex.: taxa em fração numa lente, em pp noutra). */
  kind?: FactKind;
}

export interface FactSpec {
  label: string;
  kind: FactKind;
  lenses: Lens[];
  tol?: { rel?: number; abs?: number };
  /** Lista (ranking): os itens precisam aparecer NA ORDEM. */
  ordered?: boolean;
  /** Compara em módulo (variação escrita como "queda de 5%"). */
  absolute?: boolean;
}

export interface ToolExpectation {
  anyOf: string[];
  /**
   * Filtros que ALGUMA chamada dessas tools tem que ter aplicado (após a
   * normalização do servidor). Só as chaves presentes contam; lista vazia =
   * "não pode herdar esse filtro". Datas aceitam os tokens de DateRef.
   */
  args?: Record<string, unknown>;
  /** get_orders com hasMore precisa ser paginado (offset) antes de concluir. */
  mustPaginate?: boolean;
}

export interface GoldenCase {
  id: string;
  category: GoldenCategory;
  /** Perguntas em ordem; só a ÚLTIMA resposta é avaliada (as anteriores montam o histórico). */
  turns: string[];
  ui?: UiSpec;
  facts?: FactSpec[];
  tools?: ToolExpectation[];
  forbidTools?: string[];
  /** Regex (fonte, flags iu) que a resposta PRECISA conter. */
  mention?: string[];
  /** Regex que a resposta NÃO pode conter. */
  forbid?: string[];
  /** Sentido da variação: fixo, ou o sinal de um fato. */
  direction?: { expected: 'up' | 'down' } | { fact: string };
  /** O dado NÃO existe no dashboard: a resposta tem que dizer isso sem inventar número. */
  unavailable?: boolean;
  citations?: { required: boolean; titlePattern?: string };
  maxRounds?: number;
  maxInputTokens?: number;
  /** Teto de consultas de dado (exclui terminal, skills, definições e busca na base). */
  maxDataCalls?: number;
  /** Hedge permitido (projeção de coorte é estimativa por natureza). */
  allowHedge?: boolean;
  /** Fixtures SINTÉTICAS de anexo (nunca dado real de cliente). O runner ainda pula esses casos. */
  attachments?: string[];
  /** Pré-requisitos: tools que precisam existir no catálogo; perfil admin. */
  requires?: { tools?: string[]; admin?: boolean };
  /** Trechos que o oráculo do selftest usa pra satisfazer as menções. */
  oracle?: string[];
  notes?: string;
}

// ── Datas relativas (BRT) ───────────────────────────────────────────────

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN_RE = /^\$(today|yesterday|mstart|pmstart|pmend|wstart|pwstart|pwend|d-(\d{1,3}))$/;

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Hoje no calendário BRT (mesma regra da barra de filtros da SPA). */
export function brtToday(now: Date): string {
  return brtRangeForPreset('today', now).start;
}

export function isDateToken(v: unknown): v is string {
  return typeof v === 'string' && TOKEN_RE.test(v);
}

/** Token ($yesterday…) ou data fixa → 'YYYY-MM-DD'. Lança se inválido. */
export function resolveDate(ref: DateRef, now: Date): string {
  if (DAY_RE.test(ref)) return ref;
  const m = TOKEN_RE.exec(ref);
  if (!m) throw new SpecError(`data inválida: "${ref}"`);
  const today = brtToday(now);
  const [y, mo] = today.split('-').map(Number);
  const monthStart = `${today.slice(0, 7)}-01`;
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = domingo
  const monday = addDays(today, -((dow + 6) % 7));
  switch (m[1]) {
    case 'today': return today;
    case 'yesterday': return addDays(today, -1);
    case 'mstart': return monthStart;
    case 'pmstart': return new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 10);
    case 'pmend': return addDays(monthStart, -1);
    case 'wstart': return monday;
    case 'pwstart': return addDays(monday, -7);
    case 'pwend': return addDays(monday, -1);
    default: return addDays(today, -Number(m[2]));
  }
}

/** Resolve todo token de data dentro dos args (recursivo). Refs $rN ficam intactas. */
export function resolveArgs<T>(value: T, now: Date): T {
  if (isDateToken(value)) return resolveDate(value, now) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => resolveArgs(v, now)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = resolveArgs(v, now);
    return out as T;
  }
  return value;
}

// ── Caminhos no resultado ───────────────────────────────────────────────

export class SpecError extends Error {}

/**
 * Valor resolvido de um fato: `items` são as posições esperadas (1 pra
 * escalar, N pra lista de ranking); cada item traz ALTERNATIVAS aceitas
 * (`nickname|externalId` → qualquer uma das duas identifica o afiliado).
 */
export interface Resolved {
  items: unknown[][];
  list: boolean;
  /**
   * Só `dominant`: alternativas dos rótulos PERDEDORES. A pergunta costuma
   * citar os dois ("foi volume ou AOV?") — o veredito é o que vem primeiro.
   */
  rivals?: string[];
}

type Selector =
  | { t: 'index'; i: number }
  | { t: 'range'; from: number; to: number }
  | { t: 'all' }
  | { t: 'extreme'; max: boolean; expr: string[][] }
  | { t: 'sort'; desc: boolean; expr: string[][] }
  | { t: 'find'; key: string[]; value: string }
  | { t: 'filter'; key: string[]; op: '=' | '>' | '<' | '>=' | '<=' | '!='; value: string };

interface Segment {
  keys: string[]; // várias = alternativas (só no último segmento)
  selectors: Selector[];
}

/** Divide por '.' fora de colchetes (seletores têm pontos: [sort:-delta.revenue]). */
function splitTopLevel(path: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of path) {
    if (ch === '[') depth += 1;
    if (ch === ']') depth -= 1;
    if (depth < 0) throw new SpecError(`colchete sem par em "${path}"`);
    if (ch === '.' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (depth !== 0) throw new SpecError(`colchete sem par em "${path}"`);
  parts.push(cur);
  return parts;
}

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DOTTED_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

/** Expressão de ordenação: caminho pontuado, ou diferença "a-b". */
function parseExpr(src: string): string[][] {
  const terms = src.split('-');
  if (terms.length > 2 || terms.some((t) => !DOTTED_RE.test(t))) throw new SpecError(`expressão inválida: "${src}"`);
  return terms.map((t) => t.split('.'));
}

function parseSelector(src: string): Selector {
  let m: RegExpExecArray | null;
  if ((m = /^(-?\d+)$/.exec(src))) return { t: 'index', i: Number(m[1]) };
  if ((m = /^(\d+)\.\.(\d+)$/.exec(src))) return { t: 'range', from: Number(m[1]), to: Number(m[2]) };
  if (src === '*') return { t: 'all' };
  if ((m = /^(max|min):(.+)$/.exec(src))) return { t: 'extreme', max: m[1] === 'max', expr: parseExpr(m[2]) };
  if ((m = /^sort:(-?)(.+)$/.exec(src))) return { t: 'sort', desc: m[1] === '-', expr: parseExpr(m[2]) };
  if ((m = /^\?([A-Za-z0-9_.]+)(>=|<=|!=|=|>|<)(.*)$/.exec(src))) {
    if (!DOTTED_RE.test(m[1])) throw new SpecError(`filtro inválido: "${src}"`);
    return { t: 'filter', key: m[1].split('.'), op: m[2] as '=', value: m[3] };
  }
  if ((m = /^([A-Za-z0-9_.]+)=(.*)$/.exec(src))) {
    if (!DOTTED_RE.test(m[1])) throw new SpecError(`seletor inválido: "${src}"`);
    return { t: 'find', key: m[1].split('.'), value: m[2] };
  }
  throw new SpecError(`seletor desconhecido: "[${src}]"`);
}

/**
 * Gramática:
 *   caminho   := segmento ('.' segmento)*
 *   segmento  := chave('|'chave)* ('[' seletor ']')*   (alternativas só no fim)
 *   seletor   := N | -N (índice; negativo = do fim) | a..b (fatia, vira lista)
 *              | * (todos, vira lista) | max:expr | min:expr | sort:[-]expr
 *              | campo=valor (primeiro que casa) | ?campo<op>valor (filtra, vira lista)
 *   expr      := caminho.pontuado | a-b (diferença)
 * Ex.: 'kpis.gross' · 'affiliates[max:revenue].nickname|externalId'
 *      'affiliates[sort:-netAfterCpaTotalUsd][0..5].nickname|externalId'
 *      'providers[provider=logicall].commissionPct' · 'scopes.all.transitions[-1].aovEffect'
 */
export function parsePath(path: string): Segment[] {
  if (!path.trim()) throw new SpecError('caminho vazio');
  const parts = splitTopLevel(path.trim());
  return parts.map((part, idx) => {
    const open = part.indexOf('[');
    const head = open === -1 ? part : part.slice(0, open);
    const rest = open === -1 ? '' : part.slice(open);
    const keys = head ? head.split('|') : [];
    if (keys.some((k) => !KEY_RE.test(k))) throw new SpecError(`chave inválida em "${path}"`);
    if (keys.length > 1 && idx !== parts.length - 1) throw new SpecError(`alternativas (a|b) só no último segmento: "${path}"`);
    if (keys.length > 1 && rest) throw new SpecError(`alternativas não aceitam seletor: "${path}"`);
    const selectors: Selector[] = [];
    const selRe = /\[([^\]]*)\]/g;
    let consumed = 0;
    let m: RegExpExecArray | null;
    while ((m = selRe.exec(rest))) {
      if (m.index !== consumed) throw new SpecError(`seletor malformado em "${path}"`);
      selectors.push(parseSelector(m[1]));
      consumed = m.index + m[0].length;
    }
    if (consumed !== rest.length) throw new SpecError(`seletor malformado em "${path}"`);
    if (!keys.length && !selectors.length) throw new SpecError(`segmento vazio em "${path}"`);
    return { keys, selectors };
  });
}

function getDotted(node: unknown, keys: string[]): unknown {
  let cur = node;
  for (const k of keys) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function evalExpr(node: unknown, expr: string[][]): number | null {
  const vals = expr.map((p) => getDotted(node, p));
  if (vals.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return null;
  const nums = vals as number[];
  return nums.length === 2 ? nums[0] - nums[1] : nums[0];
}

function asArray(v: unknown, what: string): unknown[] {
  if (!Array.isArray(v)) throw new SpecError(`${what}: esperava lista`);
  return v;
}

function compare(a: unknown, op: string, raw: string): boolean {
  const num = Number(raw);
  if (op === '=' || op === '!=') {
    const eq = String(a ?? '').toLowerCase() === raw.toLowerCase();
    return op === '=' ? eq : !eq;
  }
  if (typeof a !== 'number' || !Number.isFinite(num)) return false;
  switch (op) {
    case '>': return a > num;
    case '<': return a < num;
    case '>=': return a >= num;
    default: return a <= num;
  }
}

function applySelector(node: unknown, sel: Selector, where: string): { nodes: unknown[] } {
  switch (sel.t) {
    case 'index': {
      const arr = asArray(node, where);
      const i = sel.i < 0 ? arr.length + sel.i : sel.i;
      if (i < 0 || i >= arr.length) throw new SpecError(`${where}: índice ${sel.i} fora da lista (${arr.length})`);
      return { nodes: [arr[i]] };
    }
    case 'range':
      return { nodes: asArray(node, where).slice(sel.from, sel.to) };
    case 'all':
      return { nodes: [...asArray(node, where)] };
    case 'extreme': {
      let best: unknown;
      let bestV: number | null = null;
      for (const item of asArray(node, where)) {
        const v = evalExpr(item, sel.expr);
        if (v == null) continue;
        if (bestV == null || (sel.max ? v > bestV : v < bestV)) {
          bestV = v;
          best = item;
        }
      }
      if (bestV == null) throw new SpecError(`${where}: nenhum item com valor numérico pro ${sel.max ? 'max' : 'min'}`);
      return { nodes: [best] };
    }
    case 'sort': {
      // Ordenação estável; itens sem valor vão pro fim (null não é zero).
      const arr = asArray(node, where).map((item, idx) => ({ item, idx, v: evalExpr(item, sel.expr) }));
      arr.sort((a, b) => {
        if (a.v == null && b.v == null) return a.idx - b.idx;
        if (a.v == null) return 1;
        if (b.v == null) return -1;
        return (sel.desc ? b.v - a.v : a.v - b.v) || a.idx - b.idx;
      });
      return { nodes: [arr.map((x) => x.item)] };
    }
    case 'find': {
      const hit = asArray(node, where).find((item) => compare(getDotted(item, sel.key), '=', sel.value));
      if (hit === undefined) throw new SpecError(`${where}: nenhum item com ${sel.key.join('.')}=${sel.value}`);
      return { nodes: [hit] };
    }
    case 'filter':
      return { nodes: asArray(node, where).filter((item) => compare(getDotted(item, sel.key), sel.op, sel.value)) };
  }
}

/** Lê o caminho no resultado. Lança SpecError se o caminho não existe. */
export function resolvePath(root: unknown, path: string): Resolved {
  const segments = parsePath(path);
  let nodes: unknown[] = [root];
  let list = false;
  let where = '';
  segments.forEach((seg, idx) => {
    const last = idx === segments.length - 1;
    if (seg.keys.length > 1 && last) return; // alternativas: tratadas no fim
    if (seg.keys.length === 1) {
      const key = seg.keys[0];
      where = where ? `${where}.${key}` : key;
      nodes = nodes.map((n) => {
        if (!n || typeof n !== 'object' || !(key in (n as object))) throw new SpecError(`caminho "${where}" não existe no resultado`);
        return (n as Record<string, unknown>)[key];
      });
    }
    for (const sel of seg.selectors) {
      const expands = sel.t === 'range' || sel.t === 'all' || sel.t === 'filter';
      // Lista de listas não tem leitura clara num fato ("top 5 de cada?").
      if (expands && list) throw new SpecError(`"${path}": só uma expansão de lista por caminho`);
      nodes = nodes.flatMap((n) => applySelector(n, sel, where || '(raiz)').nodes);
      if (expands) list = true;
    }
  });
  const lastSeg = segments[segments.length - 1];
  const items = nodes.map((n) => {
    if (lastSeg.keys.length > 1) {
      if (!n || typeof n !== 'object') throw new SpecError(`"${path}": item não é objeto`);
      return lastSeg.keys.map((k) => (n as Record<string, unknown>)[k]).filter((v) => v !== undefined && v !== null && v !== '');
    }
    return [n];
  });
  return { items, list };
}

// ── Validação (casos vindos do banco / promovidos de feedback) ──────────

export function validateGoldenCase(raw: unknown): { ok: true; value: GoldenCase } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const c = raw as Partial<GoldenCase> | null;
  if (!c || typeof c !== 'object') return { ok: false, errors: ['caso deve ser um objeto'] };
  if (typeof c.id !== 'string' || !/^[A-Za-z0-9_-]{2,60}$/.test(c.id)) errors.push('id: 2–60 caracteres [A-Za-z0-9_-]');
  if (!GOLDEN_CATEGORIES.includes(c.category as GoldenCategory)) errors.push(`category inválida — válidas: ${GOLDEN_CATEGORIES.join(', ')}`);
  if (!Array.isArray(c.turns) || !c.turns.length || c.turns.some((t) => typeof t !== 'string' || !t.trim() || t.length > 2000)) {
    errors.push('turns: 1+ perguntas de texto (≤ 2000 caracteres)');
  }
  const checkDate = (v: unknown, where: string) => {
    if (v === undefined) return;
    try {
      if (typeof v !== 'string') throw new SpecError('não é texto');
      resolveDate(v, new Date());
    } catch {
      errors.push(`${where}: data inválida`);
    }
  };
  checkDate(c.ui?.from, 'ui.from');
  checkDate(c.ui?.to, 'ui.to');
  const checkSource = (s: LensSource | undefined, where: string) => {
    if (!s || typeof s.tool !== 'string' || !s.tool) return errors.push(`${where}: tool obrigatória`);
    try {
      parsePath(String(s.path ?? ''));
    } catch (e) {
      errors.push(`${where}: ${(e as Error).message}`);
    }
  };
  (c.facts ?? []).forEach((f, i) => {
    if (!f || typeof f.label !== 'string' || !f.label) errors.push(`facts[${i}].label obrigatório`);
    if (!['usd', 'ratio', 'pct', 'int', 'number', 'text'].includes(f?.kind as string)) errors.push(`facts[${i}].kind inválido`);
    if (!Array.isArray(f?.lenses) || !f.lenses.length) errors.push(`facts[${i}]: 1+ lentes`);
    (f?.lenses ?? []).forEach((l, j) => {
      const where = `facts[${i}].lenses[${j}]`;
      if (l.source) checkSource(l.source, where);
      else if (l.calc && Array.isArray(l.calc.inputs) && l.calc.inputs.length) l.calc.inputs.forEach((s, k) => checkSource(s, `${where}.calc.inputs[${k}]`));
      else errors.push(`${where}: source ou calc obrigatório`);
    });
  });
  for (const [field, list] of [['mention', c.mention], ['forbid', c.forbid]] as const) {
    (list ?? []).forEach((src, i) => {
      try {
        new RegExp(src, 'iu');
      } catch {
        errors.push(`${field}[${i}]: regex inválida`);
      }
    });
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: c as GoldenCase };
}
