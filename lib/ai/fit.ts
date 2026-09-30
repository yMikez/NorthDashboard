// Encolhimento do resultado de tool pro orçamento de bytes do modelo (v2).
//
// v1 cortava SEMPRE a primeira metade da maior lista e só descia em objetos.
// Simulado com get_affiliate_sequence (8 janelas × 600 linhas): sobravam
// Janela 1–2 (as MAIS ANTIGAS) e sumiam as 6 recentes; numa série diária
// ascendente, sumia a metade mais recente. E o aviso mandava "paginar com
// offset" em tools que não têm offset.
//
// v2:
//   - política POR CAMINHO: séries `daily` guardam o FIM (dias recentes);
//     `windows` das tools de sequência nunca é cortado — corta-se o ranking
//     DENTRO de cada janela (head); coortes são compactadas nas idades-marco
//     antes de qualquer corte; listas ranqueadas guardam o topo;
//   - desce em listas de objetos (windows[3].rows);
//   - cada corte diz o que sobrou e a SOMA do que saiu (droppedTotals), pra o
//     modelo não tratar o visível como total;
//   - o aviso aponta pro resultado COMPLETO no ResultStore ($rN) e pras tools
//     de agregação; offset só em get_orders (a única paginada).
// Nunca devolve JSON cortado no meio.

export type Keep = 'head' | 'tail' | 'never' | 'compact';
type Rule = readonly [RegExp, Keep];

// Caminho normalizado: chaves por '.', índice de lista vira '[]'
// ('windows[].rows', 'scopes.all.transitions').
const COMMON_RULES: Rule[] = [
  [/(^|\.)daily$/, 'tail'],
  [/(^|\.)series$/, 'tail'],
];

const TOOL_RULES: Record<string, Rule[]> = {
  get_affiliate_sequence: [
    [/^windows$/, 'never'],
    [/^transitions$/, 'never'],
    [/^windows\[\]\.rows$/, 'head'],
    [/^evolution$/, 'head'],
  ],
  get_funnel_sequence: [
    [/^windows$/, 'never'],
    [/^scopes\.[^.]+\.transitions$/, 'never'],
  ],
  get_refund_cohorts: [
    [/^cohorts\[\]\.cells$/, 'compact'],
    [/^curve$/, 'compact'],
    [/^cohorts$/, 'head'],
  ],
  get_orders: [[/^orders$/, 'head']],
};

/** Idades (dias desde a venda) que a matriz de coortes mantém quando compactada. */
export const CHECKPOINT_AGES = [0, 3, 7, 14, 21, 30, 45, 60, 90, 120, 180] as const;

export function policyFor(tool: string | undefined, pattern: string): Keep {
  for (const [re, keep] of (tool && TOOL_RULES[tool]) || []) if (re.test(pattern)) return keep;
  for (const [re, keep] of COMMON_RULES) if (re.test(pattern)) return keep;
  return 'head';
}

// ── Etiqueta de tool no valor ───────────────────────────────────────────
// O motor chama fitToolResult(valor, cap) sem o nome da tool. executeTool
// etiqueta o resultado com uma chave-SÍMBOLO: JSON.stringify ignora símbolo
// (não custa token) e o spread do motor ({ _ref, ...valor }) a preserva.

const FIT_TOOL = Symbol.for('northscale.ai.fitTool');

export function tagTool<T>(value: T, tool: string): T {
  if (value && typeof value === 'object') (value as Record<symbol, unknown>)[FIT_TOOL] = tool;
  return value;
}

function toolTagOf(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const t = (value as Record<symbol, unknown>)[FIT_TOOL];
  return typeof t === 'string' ? t : undefined;
}

// ── Números compactos ───────────────────────────────────────────────────

/** Arredonda floats longos (0.123456789 → 0.1235): menos tokens, mesma leitura. Cópia profunda. */
function compactNumbers(value: unknown): unknown {
  if (typeof value === 'number') {
    return Number.isFinite(value) && !Number.isInteger(value) ? Math.round(value * 10_000) / 10_000 : value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(compactNumbers);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = compactNumbers(v);
    }
    return out;
  }
  return value;
}

// ── Tamanho serializado com cache ───────────────────────────────────────
// Re-serializar o resultado inteiro a cada corte (v1) é O(n) por iteração;
// com cache por nó e invalidação só da cadeia de ancestrais do corte, cada
// iteração recalcula só o que mudou. Mesma conta do JSON.stringify.

function sizeOf(v: unknown, cache: WeakMap<object, number>): number {
  if (v === null || v === undefined) return 4;
  switch (typeof v) {
    case 'string': return JSON.stringify(v).length;
    case 'number': return Number.isFinite(v) ? String(v).length : 4;
    case 'boolean': return v ? 4 : 5;
    case 'object': {
      const hit = cache.get(v);
      if (hit !== undefined) return hit;
      let n = 2;
      if (Array.isArray(v)) {
        n += Math.max(0, v.length - 1);
        for (const x of v) n += sizeOf(x, cache);
      } else {
        let first = true;
        for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
          if (x === undefined) continue;
          n += (first ? 0 : 1) + JSON.stringify(k).length + 1 + sizeOf(x, cache);
          first = false;
        }
      }
      cache.set(v, n);
      return n;
    }
    default: return 4;
  }
}

// ── Somas do que foi cortado ────────────────────────────────────────────
// Só campos ADITIVOS (receita, pedidos, contagens) — somar taxa, AOV ou
// "por FE" daria número sem sentido.

const ADDITIVE_EXACT = /^(revenue|net|cpa|cpaPaid|cogs|fulfillment|gross|volume|fees|value|refunds|chargebacks|approved|feApproved|sales|orders|bottles|packages)$/;
const ADDITIVE_SUFFIX = /(revenue|orders|count|sales|sessions|profit|usd|total)$/i;
const NON_ADDITIVE = /(rate|pct|pp$|share|aov|perfe|per[A-Z]|ticket|margin|rank|price|aftercpausd$|index|age$|days$)/i;

function isAdditiveKey(k: string): boolean {
  if (NON_ADDITIVE.test(k)) return false;
  return ADDITIVE_EXACT.test(k) || ADDITIVE_SUFFIX.test(k);
}

const MAX_TOTALS_FIELDS = 12;

function droppedTotalsOf(items: unknown[]): Record<string, number> | undefined {
  const sums = new Map<string, number>();
  const add = (k: string, v: unknown) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || !isAdditiveKey(k.split('.').pop()!)) return;
    if (!sums.has(k) && sums.size >= MAX_TOTALS_FIELDS) return;
    sums.set(k, (sums.get(k) ?? 0) + v);
  };
  for (const it of items) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) continue;
    for (const [k, v] of Object.entries(it as Record<string, unknown>)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        // Um nível de objeto aninhado (rows[].m.revenue, rows[].cur.revenue).
        for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) add(`${k}.${k2}`, v2);
      } else {
        add(k, v);
      }
    }
  }
  if (!sums.size) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of sums) out[k] = Math.round(v * 100) / 100;
  return out;
}

// ── Compactação de coortes ──────────────────────────────────────────────

/** Mantém só as idades-marco (+ a última observada). Célula vira {age, ...} porque o índice deixa de ser a idade. */
function compactByAge(arr: unknown[]): unknown[] {
  const byAgeField = arr.every((x) => x && typeof x === 'object' && typeof (x as { age?: unknown }).age === 'number');
  if (byAgeField) {
    const last = arr[arr.length - 1] as { age: number };
    return arr.filter((x) => {
      const age = (x as { age: number }).age;
      return (CHECKPOINT_AGES as readonly number[]).includes(age) || age === last.age;
    });
  }
  let lastObserved = -1;
  arr.forEach((x, i) => { if (x !== null && x !== undefined) lastObserved = i; });
  const out: unknown[] = [];
  arr.forEach((x, i) => {
    if (x === null || x === undefined) return;
    if (!(CHECKPOINT_AGES as readonly number[]).includes(i) && i !== lastObserved) return;
    out.push(x && typeof x === 'object' && !Array.isArray(x) ? { age: i, ...(x as object) } : { age: i, value: x });
  });
  return out;
}

// ── Núcleo ──────────────────────────────────────────────────────────────

export interface TruncationNote {
  path: string;
  kept: number;
  total: number;
  keptEnd: 'head' | 'tail' | 'checkpoints';
  droppedTotals?: Record<string, number>;
}

interface Cut { original: unknown[]; kept: number; keptEnd: 'head' | 'tail' }
interface Compaction { kept: number; total: number }

interface Candidate {
  parent: Record<string, unknown>;
  key: string;
  arr: unknown[];
  path: string;
  policy: Keep;
  /** Contêineres da raiz até o pai (cache de tamanho invalidado num corte). */
  chain: object[];
}

const SKIP_ROOT = new Set(['_meta', '_ref', '_truncated', '_hint']);
const MAX_DEPTH = 6;
const MAX_ITERATIONS = 400;

function collect(tool: string | undefined, root: Record<string, unknown>): Candidate[] {
  const out: Candidate[] = [];
  const visitObject = (obj: Record<string, unknown>, path: string, pattern: string, chain: object[], depth: number) => {
    if (depth > MAX_DEPTH) return;
    for (const [k, v] of Object.entries(obj)) {
      if (depth === 0 && SKIP_ROOT.has(k)) continue;
      if (!v || typeof v !== 'object') continue;
      const p = path ? `${path}.${k}` : k;
      const pat = pattern ? `${pattern}.${k}` : k;
      const nextChain = [...chain, obj];
      if (Array.isArray(v)) {
        out.push({ parent: obj, key: k, arr: v, path: p, policy: policyFor(tool, pat), chain: nextChain });
        v.forEach((item, i) => {
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            visitObject(item as Record<string, unknown>, `${p}[${i}]`, `${pat}[]`, [...nextChain, v], depth + 1);
          }
        });
      } else {
        visitObject(v as Record<string, unknown>, p, pat, nextChain, depth + 1);
      }
    }
  };
  visitObject(root, '', '', [], 0);
  return out;
}

function patternOf(path: string): string {
  return path.replace(/\[\d+\]/g, '[]');
}

function hintFor(tool: string | undefined, ref: string | undefined, compacted: boolean): string {
  const base = tool === 'get_orders'
    ? 'Listas encolhidas por tamanho — pagine com offset (page.hasMore) ou estreite o período/filtros; pra totais e somas use aggregate_orders.'
    : ref
      ? `Listas encolhidas por tamanho. O conjunto completo está em $${ref} — use aggregate_result/calc sobre ele em vez de concluir só pelo que ficou visível.`
      : 'Listas encolhidas por tamanho — estreite o período/filtros pra ver o restante antes de concluir.';
  return compacted ? `${base} Coortes compactadas nas idades-marco (cada célula traz \`age\`).` : base;
}

function tooLarge(bytes: number, maxBytes: number): string {
  return JSON.stringify({
    error: 'result_too_large',
    message: `O resultado tem ${bytes} bytes e o limite nesta rodada é ${maxBytes}.`,
    retryable: true,
    hint: 'Estreite o período ou os filtros e tente de novo (ou use aggregate_orders pra totais).',
  });
}

/**
 * Serializa o resultado de uma tool garantindo JSON VÁLIDO dentro de
 * maxBytes, com a política de corte da tool (`tool` explícito ou a etiqueta
 * posta pelo executeTool). Cortes anotados em `_truncated` + `_hint`.
 */
export function fitToolResult(value: unknown, maxBytes: number, tool?: string): string {
  const toolName = tool ?? toolTagOf(value);
  const ref = value && typeof value === 'object' && typeof (value as { _ref?: unknown })._ref === 'string'
    ? (value as { _ref: string })._ref
    : undefined;
  const compact = compactNumbers(value);
  const full = JSON.stringify(compact);
  if (full === undefined) return 'null';
  if (full.length <= maxBytes) return full;
  if (!compact || typeof compact !== 'object') return tooLarge(full.length, maxBytes);

  const root: Record<string, unknown> = Array.isArray(compact) ? { items: compact } : (compact as Record<string, unknown>);
  const cache = new WeakMap<object, number>();
  const cuts = new Map<string, Cut>();
  const compactions = new Map<string, Compaction>();
  const frozen = new WeakSet<unknown[]>();

  const replace = (c: Candidate, next: unknown[]) => {
    c.parent[c.key] = next;
    for (const o of c.chain) cache.delete(o);
  };

  const notes = (): TruncationNote[] => {
    const list: TruncationNote[] = [];
    for (const [pattern, c] of compactions) {
      list.push({ path: pattern.replace(/\[\]/g, '[*]'), kept: c.kept, total: c.total, keptEnd: 'checkpoints' });
    }
    for (const [path, c] of cuts) {
      const total = c.original.length;
      const dropped = c.keptEnd === 'tail' ? c.original.slice(0, total - c.kept) : c.original.slice(c.kept);
      const note: TruncationNote = { path, kept: c.kept, total, keptEnd: c.keptEnd };
      const totals = droppedTotalsOf(dropped);
      if (totals) note.droppedTotals = totals;
      list.push(note);
    }
    return list;
  };
  const output = () => {
    const list = notes();
    return list.length ? { ...root, _truncated: list, _hint: hintFor(toolName, ref, compactions.size > 0) } : root;
  };

  // 1) Compactação (quase sem perda) antes de qualquer corte.
  for (const c of collect(toolName, root)) {
    if (c.policy !== 'compact' || c.arr.length <= 1) continue;
    const next = compactByAge(c.arr);
    frozen.add(next);
    const pattern = patternOf(c.path);
    const acc = compactions.get(pattern) ?? { kept: 0, total: 0 };
    compactions.set(pattern, { kept: Math.max(acc.kept, next.length), total: Math.max(acc.total, c.arr.length) });
    replace(c, next);
  }

  // 2) Cortes pela metade, sempre na MAIOR lista cortável (equilibra: as
  //    8 janelas de uma sequência encolhem juntas, nenhuma some).
  let json = JSON.stringify(output());
  let fits = json.length <= maxBytes;
  for (let i = 0; i < MAX_ITERATIONS && !fits; i++) {
    let best: Candidate | null = null;
    let bestBytes = -1;
    for (const c of collect(toolName, root)) {
      if (c.arr.length <= 1 || frozen.has(c.arr) || (c.policy !== 'head' && c.policy !== 'tail')) continue;
      const bytes = sizeOf(c.arr, cache);
      if (bytes > bestBytes) { best = c; bestBytes = bytes; }
    }
    if (!best) break;
    const prev = cuts.get(best.path);
    const original = prev?.original ?? best.arr;
    const keptEnd = best.policy === 'tail' ? 'tail' : 'head';
    const keep = Math.max(1, Math.floor(best.arr.length / 2));
    const next = keptEnd === 'tail' ? best.arr.slice(best.arr.length - keep) : best.arr.slice(0, keep);
    cuts.set(best.path, { original, kept: next.length, keptEnd });
    replace(best, next);
    // Tamanho do dado pelo cache (barato); o JSON real (com as notas) só
    // quando o dado sozinho já cabe — daí em diante a árvore é pequena.
    if (sizeOf(root, cache) + 64 <= maxBytes) {
      json = JSON.stringify(output());
      fits = json.length <= maxBytes;
    }
  }
  return fits ? json : tooLarge(full.length, maxBytes);
}
