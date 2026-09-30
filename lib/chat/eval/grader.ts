// Nota de UMA resposta do chat contra um caso golden. Determinístico, sem
// LLM: compara o que o usuário VÊ (texto + blocos renderizados pela mesma
// função da UI) com os valores esperados recalculados pelas tools.
//
// Colunas separadas em vez de uma nota misturada: número certo / lente
// certa / unidade / filtros aplicados / paginação / honestidade / hedge /
// custo. Checagem CRÍTICA reprovada = 'fail' (resposta errada ou inventada);
// as demais = 'partial' (resposta certa com defeito). Truncamento, recusa e
// erro de infra têm status próprio — nunca viram um zero na média.

import { renderBlocksToText } from '../format';
import { stripCiteMarkers } from '../../rag/citations';
import { extractNumbers, numberMatches, type MatchTolerance, type WrittenNumber } from './numbers';
import type { FactKind, GoldenCase, Resolved } from './spec';

// ── Tipos ───────────────────────────────────────────────────────────────

/** Filtros efetivos de uma chamada (datas ISO, listas como o servidor aplicou). */
export interface AppliedScope {
  start?: string;
  end?: string;
  platforms?: string[];
  families?: string[];
  countries?: string[];
  stages?: string[];
  affiliates?: string[];
  products?: string[];
}

export interface GradedCall {
  name: string;
  input: unknown;
  applied?: AppliedScope | null;
  result?: unknown;
}

export interface LensExpectation {
  name: string;
  kind: FactKind;
  keywords: string[];
  /** Valor antes da resposta do modelo (null = lente indisponível). */
  value: Resolved | null;
  /** Valor recalculado depois — se diferir além da tolerância, o dado mexeu. */
  after?: Resolved | null;
  error?: string;
}

export interface FactExpectation {
  label: string;
  kind: FactKind;
  tol?: MatchTolerance;
  ordered?: boolean;
  absolute?: boolean;
  lenses: LensExpectation[];
}

export interface GradeInput {
  spec: GoldenCase;
  /** status do motor (TurnResult.status). */
  turnStatus: string;
  text: string;
  blocks: unknown[] | null;
  citations: Array<{ title?: string; label?: string; source?: string }>;
  calls: GradedCall[];
  rounds: number;
  /** Entrada total do turno (sem cache + leitura + escrita de cache). */
  inputTokens: number;
  facts: FactExpectation[];
  /** Filtros esperados, alinhados com spec.tools (null = sem args). */
  expectedArgs: Array<AppliedScope | null>;
}

export type CheckStatus = 'pass' | 'fail' | 'lens_mismatch' | 'inconclusive' | 'skip';

export interface CheckResult {
  id: string;
  status: CheckStatus;
  critical: boolean;
  detail?: string;
}

export type CaseStatus = 'pass' | 'partial' | 'fail' | 'inconclusive' | 'truncated' | 'refusal' | 'error';

export interface GradeResult {
  status: CaseStatus;
  score: number;
  checks: CheckResult[];
  answer: string;
  soft: {
    /** Fração dos $/% da resposta que existem nos resultados das tools (±×100). */
    faithfulness: number | null;
    untraced: string[];
    /** Posição (chars) do primeiro fato certo — assertividade: veredito cedo. */
    firstFactAt: number | null;
  };
}

// ── Texto avaliado ──────────────────────────────────────────────────────

/**
 * O que o usuário lê: texto (sem os marcadores [[cite:n]]) + blocos pela
 * mesma renderização do histórico. Gráfico fica fora: é visual, e seus
 * pontos (x=y) virariam "números citados" sem ser.
 */
export function renderAnswer(text: string, blocks: unknown[] | null): string {
  const visible = Array.isArray(blocks) ? blocks.filter((b) => (b as { type?: string } | null)?.type !== 'chart') : null;
  return [stripCiteMarkers(text ?? '').trim(), renderBlocksToText(visible, 60_000)].filter(Boolean).join('\n\n');
}

/** Minúsculas, sem acento, só [a-z0-9] separados por espaço. */
export function normalizeText(s: string): string {
  return ` ${s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
}

function containsTerm(haystackNorm: string, term: string): boolean {
  const t = normalizeText(term);
  return t.trim().length > 0 && haystackNorm.includes(t);
}

// ── Regras de texto ─────────────────────────────────────────────────────

const HEDGE_RE = /(aproximadamente|cerca de|em torno de|por volta de|mais ou menos|parece|provavelmente|talvez|~)[^.\n\d$]{0,40}((?:US\$|\$)?\s?[-−]?\d[\d.,]*\s?(?:mil|k|M)?\s?%?)/giu;
const ASK_RE = /(quer que eu|deseja que eu|gostaria que eu|posso (consultar|buscar|verificar|puxar|levantar) (esses|os|estes) dados|me autoriza)/iu;
// Negativa de dado. Específica de propósito: "a Digistore ficou indisponível"
// (saúde) não é negar dado; "o dashboard não rastreia visitantes" é.
const DENIAL_RE = /(n[ãa]o tenho acesso|n[ãa]o consigo acessar|n[ãa]o (tenho|possuo|disponho de) (esses|os|estes|esse|este|o|a|essa|esta) (dados?|informa[çc][ãa]o|m[ée]trica)|n[ãa]o [ée] poss[íi]vel (consultar|acessar|calcular)|n[ãa]o est[áa]o? dispon[íi]ve(l|is)|(dados?|m[ée]trica|informa[çc][ãa]o) indispon[íi]ve(l|is)|n[ãa]o (existe|h[áa]) (esse|este|o|essa|esta) (dado|m[ée]trica|informa[çc][ãa]o)|o dashboard n[ãa]o (tem|possui|registra|rastreia|mede|coleta|recebe)|n[ãa]o (temos|rastreamos|medimos|coletamos|recebemos) (dados? de |o |a |os |as )?(visit|clique|tr[áa]fego|impress|gasto|investimento|m[íi]dia|an[úu]ncio|convers))/iu;
const BRL_RE = /R\$\s?\d/u;
const UP_RE = /\b(maior|subiu|subir|cresceu|crescimento|aumentou|aumento|alta|acima|melhorou|avan[çc]ou)\b/iu;
const DOWN_RE = /\b(menor|caiu|cair|queda|recuou|recuo|diminuiu|redu[çc][ãa]o|baixa|abaixo|piorou|retra[çc][ãa]o)\b/iu;
const EN_STOPWORDS = new Set([
  'the', 'and', 'with', 'which', 'from', 'this', 'that', 'these', 'those', 'is', 'are', 'was', 'were',
  'have', 'has', 'been', 'would', 'should', 'could', 'there', 'their', 'what', 'when', 'where',
  'because', 'however', 'therefore',
]);
// Tools que não consultam dado (não contam no teto de consultas).
const NON_DATA_TOOLS = new Set(['respond_with_blocks', 'load_skill', 'get_definitions', 'search_knowledge']);

const DEFAULT_TOL: Record<FactKind, MatchTolerance> = {
  usd: { rel: 0.002 },
  number: { rel: 0.002 },
  ratio: { abs: 0.05 },
  pct: { abs: 0.05 },
  int: { abs: 0 },
  text: {},
};
const DEFAULT_MAX_ROUNDS = 8;
const KEYWORD_WINDOW = 220;

// ── Fatos ───────────────────────────────────────────────────────────────

function numericValue(r: Resolved | null | undefined, item = 0): number | null {
  const v = r?.items[item]?.[0];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Escala do esperado pra forma escrita: fração vira pontos percentuais. */
function scaled(kind: FactKind, e: number): number {
  return kind === 'ratio' ? e * 100 : e;
}

function unitFits(kind: FactKind, n: WrittenNumber): boolean {
  if (n.yearLike) return false;
  switch (kind) {
    case 'ratio':
    case 'pct':
      return n.unit === 'pct' || n.unit === 'pp';
    case 'usd':
      return n.unit === 'usd' || n.unit === null;
    case 'int':
      return n.unit === null;
    default:
      return n.unit !== 'pct' && n.unit !== 'pp' && n.unit !== 'brl';
  }
}

function sameWithin(a: number, b: number, tol: MatchTolerance): boolean {
  return Math.abs(a - b) <= Math.max(tol.abs ?? 0, (tol.rel ?? 0) * Math.abs(b)) + 1e-9;
}

/** O dado mexeu entre o antes e o depois da resposta? */
function lensMoved(l: LensExpectation, tol: MatchTolerance): boolean {
  if (!l.value || !l.after) return false;
  if (l.value.items.length !== l.after.items.length) return true;
  return l.value.items.some((alts, i) => {
    const a = alts[0];
    const b = l.after!.items[i]?.[0];
    if (typeof a === 'number' && typeof b === 'number') return !sameWithin(scaled(l.kind, a), scaled(l.kind, b), tol);
    return String(a) !== String(b);
  });
}

interface NumericHit {
  lens: LensExpectation;
  n: WrittenNumber;
}

function numericHits(fact: FactExpectation, nums: WrittenNumber[]): NumericHit[] {
  const hits: NumericHit[] = [];
  for (const lens of fact.lenses) {
    const tol = fact.tol ?? DEFAULT_TOL[lens.kind];
    const values = [numericValue(lens.value), numericValue(lens.after)].filter((v): v is number => v != null);
    for (const n of nums) {
      if (!unitFits(lens.kind, n)) continue;
      if (values.some((v) => numberMatches(n, scaled(lens.kind, v), tol, { integerOnly: lens.kind === 'int', absolute: fact.absolute }))) {
        hits.push({ lens, n });
      }
    }
  }
  return hits.sort((a, b) => a.n.index - b.n.index);
}

function keywordNear(answer: string, hit: NumericHit): boolean {
  if (!hit.lens.keywords.length) return true;
  const window = normalizeText(answer.slice(Math.max(0, hit.n.index - KEYWORD_WINDOW), hit.n.end + KEYWORD_WINDOW));
  return hit.lens.keywords.some((k) => containsTerm(window, k));
}

function describeExpected(fact: FactExpectation): string {
  return fact.lenses
    .map((l) => {
      if (!l.value) return `${l.name}: indisponível${l.error ? ` (${l.error})` : ''}`;
      const vals = l.value.items.map((alts) => alts.map(String).join('|')).join(', ');
      return `${l.name}: ${vals}`;
    })
    .join(' · ');
}

/** Posições em que cada item (texto, qualquer alternativa) aparece. */
function textPositions(answerNorm: string, items: unknown[][]): Array<number | null> {
  return items.map((alts) => {
    let best: number | null = null;
    for (const a of alts) {
      if (a === null || a === undefined || a === '') continue;
      const t = normalizeText(String(a));
      if (!t.trim()) continue;
      const at = answerNorm.indexOf(t);
      if (at >= 0 && (best == null || at < best)) best = at;
    }
    return best;
  });
}

interface FactOutcome {
  checks: CheckResult[];
  passed: boolean;
  firstAt: number | null;
}

function gradeFact(fact: FactExpectation, answer: string, answerNorm: string, nums: WrittenNumber[]): FactOutcome {
  const id = `fact:${fact.label}`;
  const available = fact.lenses.filter((l) => l.value && l.value.items.length);
  if (!available.length) {
    return { checks: [{ id, status: 'skip', critical: true, detail: `sem valor esperado — ${describeExpected(fact)}` }], passed: false, firstAt: null };
  }
  const moved = fact.lenses.some((l) => lensMoved(l, fact.tol ?? DEFAULT_TOL[l.kind]));

  if (fact.kind === 'text' || available.some((l) => l.value!.list)) {
    // Entidade/ranking: todos os itens de ALGUMA lente, na ordem se pedido.
    let rivalFirst: string | null = null;
    for (const lens of available) {
      const cands = [lens.value!, ...(lens.after ? [lens.after] : [])];
      for (const cand of cands) {
        const positions = fact.kind === 'text'
          ? textPositions(answerNorm, cand.items)
          : cand.items.map((alts) => {
              const e = typeof alts[0] === 'number' ? (alts[0] as number) : NaN;
              const tol = fact.tol ?? DEFAULT_TOL[lens.kind];
              const n = nums.find((x) => unitFits(lens.kind, x) && numberMatches(x, scaled(lens.kind, e), tol, { integerOnly: lens.kind === 'int', absolute: fact.absolute }));
              return n ? n.index : null;
            });
        if (positions.every((p) => p != null)) {
          // Veredito (dominant): o rótulo perdedor citado ANTES do vencedor é
          // resposta errada — "Foi VOLUME…, enquanto o AOV ficou estável"
          // cita os dois, mas o veredito é volume.
          const firstAt = Math.min(...(positions as number[]));
          const rivalAt = cand.rivals?.length ? textPositions(answerNorm, [cand.rivals])[0] : null;
          if (rivalAt != null && rivalAt < firstAt) {
            rivalFirst = `cita ${cand.rivals!.join('/')} antes de ${cand.items[0].map(String).join('/')}`;
            continue;
          }
          const checks: CheckResult[] = [{ id, status: 'pass', critical: true, detail: `lente ${lens.name}` }];
          if (fact.ordered && positions.length > 1) {
            const inOrder = positions.every((p, i) => i === 0 || (p as number) > (positions[i - 1] as number));
            checks.push({ id: `order:${fact.label}`, status: inOrder ? 'pass' : 'fail', critical: false, detail: inOrder ? undefined : 'itens fora da ordem esperada' });
          }
          return { checks, passed: true, firstAt };
        }
      }
    }
    return {
      checks: [{ id, status: moved ? 'inconclusive' : 'fail', critical: true, detail: `esperado ${describeExpected(fact)}${rivalFirst ? ` — ${rivalFirst}` : ''}` }],
      passed: false,
      firstAt: null,
    };
  }

  const hits = numericHits(fact, nums);
  if (!hits.length) {
    return {
      checks: [{ id, status: moved ? 'inconclusive' : 'fail', critical: true, detail: `esperado ${describeExpected(fact)}` }],
      passed: false,
      firstAt: null,
    };
  }
  const named = fact.lenses.length > 1 ? hits.find((h) => keywordNear(answer, h)) : hits[0];
  if (!named) {
    const h = hits[0];
    return {
      checks: [{ id, status: 'lens_mismatch', critical: false, detail: `número da lente "${h.lens.name}" (${h.n.raw}) sem nomeá-la (${h.lens.keywords.join(' / ')})` }],
      passed: false,
      firstAt: h.n.index,
    };
  }
  return { checks: [{ id, status: 'pass', critical: true, detail: `lente ${named.lens.name}: ${named.n.raw}` }], passed: true, firstAt: named.n.index };
}

/**
 * Unidade: o fato não bateu, mas há um % igual ao esperado na escala errada
 * (fração exibida como % — "0.08%" pra 8% — ou ×100 duas vezes). Se o fato
 * bateu, uma coincidência de escala é outro número, não erro de unidade.
 */
function unitCheck(facts: FactExpectation[], factPassed: Map<string, boolean>, nums: WrittenNumber[]): CheckResult {
  const pctFacts = facts.filter((f) => f.lenses.some((l) => l.kind === 'ratio' || l.kind === 'pct'));
  if (!pctFacts.length) return { id: 'unit', status: 'skip', critical: true };
  const percents = nums.filter((n) => n.unit === 'pct' || n.unit === 'pp');
  for (const f of pctFacts) {
    if (factPassed.get(f.label)) continue;
    for (const l of f.lenses) {
      const e = numericValue(l.value);
      if (e == null || e === 0 || (l.kind !== 'ratio' && l.kind !== 'pct')) continue;
      const right = scaled(l.kind, e);
      const wrong = l.kind === 'ratio' ? [e, e * 10_000] : [e / 100, e * 100];
      for (const n of percents) {
        const hitWrong = wrong.some((w) => Math.abs(w - right) > 1e-9 && numberMatches(n, w, {}, { absolute: f.absolute }));
        if (hitWrong && !numberMatches(n, right, DEFAULT_TOL[l.kind], { absolute: f.absolute })) {
          return { id: 'unit', status: 'fail', critical: true, detail: `${f.label}: "${n.raw}" é ${e} na escala errada (certo: ${right.toFixed(2)}%)` };
        }
      }
    }
  }
  return { id: 'unit', status: 'pass', critical: true };
}

// ── Tools ───────────────────────────────────────────────────────────────

function sameSet(a: string[] | undefined, b: string[]): boolean {
  const x = new Set((a ?? []).map((s) => s.toLowerCase()));
  const y = new Set(b.map((s) => s.toLowerCase()));
  return x.size === y.size && [...y].every((v) => x.has(v));
}

/** Os filtros esperados (só as chaves presentes) batem com os aplicados? */
export function scopeMatches(actual: AppliedScope | null | undefined, expected: AppliedScope): boolean {
  if (!actual) return false;
  for (const [key, want] of Object.entries(expected) as Array<[keyof AppliedScope, unknown]>) {
    if (key === 'start' || key === 'end') {
      const a = actual[key] ? Date.parse(actual[key] as string) : NaN;
      const e = Date.parse(String(want));
      if (!Number.isFinite(a) || !Number.isFinite(e) || Math.abs(a - e) > 1_000) return false;
    } else if (Array.isArray(want)) {
      if (!sameSet(actual[key] as string[] | undefined, want as string[])) return false;
    }
  }
  return true;
}

function describeScope(s: AppliedScope | null | undefined): string {
  if (!s) return '—';
  return Object.entries(s)
    .filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : String(v)}`)
    .join(' ');
}

function toolChecks(input: GradeInput): CheckResult[] {
  const out: CheckResult[] = [];
  const { spec, calls } = input;
  (spec.tools ?? []).forEach((t, i) => {
    const used = calls.filter((c) => t.anyOf.includes(c.name));
    out.push({ id: `tools:${i}`, status: used.length ? 'pass' : 'fail', critical: false, detail: used.length ? undefined : `nenhuma chamada de ${t.anyOf.join(' | ')}` });
    const exp = input.expectedArgs[i];
    if (t.args && exp) {
      const ok = used.some((c) => scopeMatches(c.applied, exp));
      out.push({
        id: `args:${i}`,
        status: ok ? 'pass' : 'fail',
        critical: false,
        detail: ok ? undefined : `esperado ${describeScope(exp)}; aplicado ${used.map((c) => describeScope(c.applied)).join(' / ') || '—'}`,
      });
    }
    if (t.mustPaginate) {
      const orders = calls.map((c, idx) => ({ c, idx })).filter(({ c }) => c.name === 'get_orders');
      const pending = orders.filter(({ c, idx }) => {
        const page = (c.result as { page?: { hasMore?: boolean } } | undefined)?.page;
        if (!page?.hasMore) return false;
        const offset = Number((c.input as { offset?: unknown } | null)?.offset ?? 0) || 0;
        return !orders.some((o) => o.idx > idx && (Number((o.c.input as { offset?: unknown } | null)?.offset ?? 0) || 0) > offset);
      });
      out.push({ id: 'paginate', status: pending.length ? 'fail' : 'pass', critical: false, detail: pending.length ? 'get_orders com hasMore sem a página seguinte' : undefined });
    }
  });
  if (spec.forbidTools?.length) {
    const bad = calls.filter((c) => spec.forbidTools!.includes(c.name)).map((c) => c.name);
    out.push({ id: 'forbid_tools', status: bad.length ? 'fail' : 'pass', critical: false, detail: bad.length ? `usou ${[...new Set(bad)].join(', ')}` : undefined });
  }
  if (spec.maxDataCalls !== undefined) {
    const n = calls.filter((c) => !NON_DATA_TOOLS.has(c.name)).length;
    out.push({ id: 'data_calls', status: n <= spec.maxDataCalls ? 'pass' : 'fail', critical: false, detail: `${n} consulta(s), teto ${spec.maxDataCalls}` });
  }
  return out;
}

// ── Fidelidade (soft) ───────────────────────────────────────────────────

function numericLeaves(v: unknown, out: number[], budget: { left: number }): void {
  if (budget.left <= 0) return;
  if (typeof v === 'number') {
    if (Number.isFinite(v)) {
      out.push(v);
      budget.left -= 1;
    }
    return;
  }
  if (Array.isArray(v)) for (const x of v) numericLeaves(x, out, budget);
  else if (v && typeof v === 'object') for (const x of Object.values(v as Record<string, unknown>)) numericLeaves(x, out, budget);
}

function faithfulness(nums: WrittenNumber[], calls: GradedCall[]): { value: number | null; untraced: string[] } {
  const leaves: number[] = [];
  const budget = { left: 250_000 };
  for (const c of calls) numericLeaves(c.result, leaves, budget);
  const relevant = nums.filter((n) => !n.yearLike && (n.unit === 'usd' || n.unit === 'pct' || n.unit === 'pp'));
  if (!relevant.length) return { value: null, untraced: [] };
  const untraced: string[] = [];
  let traced = 0;
  for (const n of relevant) {
    const ok = leaves.some((v) => [v, v * 100, v / 100].some((x) => numberMatches(n, x, {}, { absolute: true })));
    if (ok) traced += 1;
    else if (untraced.length < 20) untraced.push(n.raw);
  }
  return { value: Math.round((traced / relevant.length) * 1000) / 1000, untraced };
}

// ── Nota ────────────────────────────────────────────────────────────────

function turnStatusToCase(s: string): CaseStatus | null {
  if (s === 'max_tokens') return 'truncated';
  if (s === 'refusal') return 'refusal';
  if (s === 'error' || s === 'aborted') return 'error';
  return null;
}

export function gradeAnswer(input: GradeInput): GradeResult {
  const { spec } = input;
  const answer = renderAnswer(input.text, input.blocks);
  const answerNorm = normalizeText(answer);
  const nums = extractNumbers(answer);
  const checks: CheckResult[] = [];

  // Fatos
  const factPassed = new Map<string, boolean>();
  let firstFactAt: number | null = null;
  for (const fact of input.facts) {
    const r = gradeFact(fact, answer, answerNorm, nums);
    checks.push(...r.checks);
    factPassed.set(fact.label, r.passed);
    if (r.firstAt != null && (firstFactAt == null || r.firstAt < firstFactAt)) firstFactAt = r.firstAt;
  }
  const allFactsOk = input.facts.length > 0 && input.facts.every((f) => factPassed.get(f.label));
  if (input.facts.length) checks.push(unitCheck(input.facts, factPassed, nums));

  // Tools
  checks.push(...toolChecks(input));

  // Honestidade: dado inexistente precisa ser dito; dado existente não pode ser negado.
  const denial = DENIAL_RE.exec(answer);
  if (spec.unavailable) {
    checks.push({ id: 'unavailable', status: denial ? 'pass' : 'fail', critical: true, detail: denial ? undefined : 'não disse que o dado não existe no dashboard' });
  } else {
    const denies = !!denial && !allFactsOk;
    checks.push({ id: 'false_denial', status: denies ? 'fail' : 'pass', critical: true, detail: denies ? `negou dado disponível: "${denial![0]}"` : undefined });
  }

  // Hedge sobre número que a tool deu exato.
  if (!spec.allowHedge) {
    let flagged: string | null = null;
    for (const m of answer.matchAll(HEDGE_RE)) {
      const [n] = extractNumbers(m[2]);
      if (!n) continue;
      const isFact = input.facts.some((f) => f.lenses.some((l) => {
        const e = numericValue(l.value);
        return e != null && numberMatches(n, scaled(l.kind, e), f.tol ?? DEFAULT_TOL[l.kind], { absolute: true });
      }));
      if (n.unit === 'usd' || isFact) {
        flagged = m[0].trim();
        break;
      }
    }
    checks.push({ id: 'hedge', status: flagged ? 'fail' : 'pass', critical: false, detail: flagged ? `"${flagged}"` : undefined });
  }

  // Pediu permissão em vez de consultar (o prompt proíbe).
  if (!spec.unavailable) {
    const asked = ASK_RE.exec(answer);
    const dataCalls = input.calls.filter((c) => !NON_DATA_TOOLS.has(c.name)).length;
    const failed = !!asked && (input.facts.length ? !allFactsOk : dataCalls === 0);
    checks.push({ id: 'ask_permission', status: failed ? 'fail' : 'pass', critical: false, detail: failed ? `"${asked![0]}"` : undefined });
  }

  // Moeda: tudo é USD.
  const brl = BRL_RE.exec(answer);
  checks.push({ id: 'currency', status: brl ? 'fail' : 'pass', critical: true, detail: brl ? `valor em R$: "${brl[0]}"` : undefined });

  // Idioma
  const words = answer.replace(/`[^`]*`/g, ' ').toLowerCase().match(/[a-z]+/g) ?? [];
  const english = words.filter((w) => EN_STOPWORDS.has(w)).length;
  checks.push({ id: 'lang', status: english >= 5 ? 'fail' : 'pass', critical: false, detail: english >= 5 ? `${english} palavras em inglês` : undefined });

  // Orçamento
  const maxRounds = spec.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const overRounds = input.rounds > maxRounds;
  const overTokens = spec.maxInputTokens !== undefined && input.inputTokens > spec.maxInputTokens;
  checks.push({
    id: 'budget',
    status: overRounds || overTokens ? 'fail' : 'pass',
    critical: false,
    detail: `${input.rounds} rodada(s) (teto ${maxRounds})${spec.maxInputTokens !== undefined ? `, ${input.inputTokens} tokens de entrada (teto ${spec.maxInputTokens})` : ''}`,
  });

  // Menções / proibições do caso
  (spec.mention ?? []).forEach((src, i) => {
    const ok = new RegExp(src, 'iu').test(answer);
    checks.push({ id: `mention:${i}`, status: ok ? 'pass' : 'fail', critical: false, detail: ok ? undefined : `faltou /${src}/` });
  });
  (spec.forbid ?? []).forEach((src, i) => {
    const m = new RegExp(src, 'iu').exec(answer);
    checks.push({ id: `forbid:${i}`, status: m ? 'fail' : 'pass', critical: true, detail: m ? `"${m[0]}"` : undefined });
  });

  // Direção da variação (primeira palavra de direção decide).
  if (spec.direction) {
    let want: 'up' | 'down' | null = null;
    if ('expected' in spec.direction) want = spec.direction.expected;
    else {
      const label = spec.direction.fact;
      const f = input.facts.find((x) => x.label === label);
      const e = f ? numericValue(f.lenses.find((l) => l.value)?.value) : null;
      want = e == null || e === 0 ? null : e > 0 ? 'up' : 'down';
    }
    if (!want) checks.push({ id: 'direction', status: 'skip', critical: true, detail: 'variação zero/indisponível' });
    else {
      const up = UP_RE.exec(answer);
      const down = DOWN_RE.exec(answer);
      const said = up && (!down || up.index < down.index) ? 'up' : down ? 'down' : null;
      checks.push({ id: 'direction', status: said === want ? 'pass' : 'fail', critical: true, detail: said === want ? undefined : `esperado ${want}, disse ${said ?? 'nada'}` });
    }
  }

  // Citações (casos de definição/RAG)
  if (spec.citations?.required) {
    const re = spec.citations.titlePattern ? new RegExp(spec.citations.titlePattern, 'iu') : null;
    const ok = input.citations.length > 0 && (!re || input.citations.some((c) => re.test(`${c.title ?? ''} ${c.label ?? ''} ${c.source ?? ''}`)));
    checks.push({ id: 'citations', status: ok ? 'pass' : 'fail', critical: false, detail: ok ? undefined : `sem citação${re ? ` de /${spec.citations.titlePattern}/` : ''}` });
  }

  // Status final
  const scored = checks.filter((c) => c.status !== 'skip' && c.status !== 'inconclusive');
  const points = scored.reduce((n, c) => n + (c.status === 'pass' ? 1 : c.status === 'lens_mismatch' ? 0.5 : 0), 0);
  const score = scored.length ? Math.round((points / scored.length) * 1000) / 1000 : 0;
  let status: CaseStatus = turnStatusToCase(input.turnStatus) ?? 'pass';
  if (status === 'pass') {
    if (checks.some((c) => c.status === 'inconclusive')) status = 'inconclusive';
    else if (checks.some((c) => c.critical && c.status === 'fail')) status = 'fail';
    else if (checks.some((c) => c.status === 'fail' || c.status === 'lens_mismatch')) status = 'partial';
    // Fato sem valor esperado (spec quebrado/lente indisponível) não pode aprovar.
    else if (checks.some((c) => c.id.startsWith('fact:') && c.status === 'skip')) status = 'inconclusive';
  }

  const faith = faithfulness(nums, input.calls);
  return { status, score, checks, answer, soft: { faithfulness: faith.value, untraced: faith.untraced, firstFactAt } };
}

// ── Oráculos do selftest ────────────────────────────────────────────────

function formatFor(kind: FactKind, v: number): string {
  switch (kind) {
    case 'usd':
      return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case 'ratio':
      return `${(v * 100).toFixed(2)}%`;
    case 'pct':
      return `${v.toFixed(2)}%`;
    case 'int':
      return Math.round(v).toLocaleString('en-US');
    default:
      return v.toLocaleString('en-US', { maximumFractionDigits: 4 });
  }
}

/**
 * Resposta "perfeita" montada dos valores esperados — o grader TEM que
 * aprovar (prova que o caso é satisfazível e que o grader não é severo
 * demais). Com `mutate` vira o oráculo errado (valor ×1,07, fração exibida
 * como %), que TEM que reprovar.
 */
export function oracleInput(
  spec: GoldenCase,
  facts: FactExpectation[],
  expectedArgs: Array<AppliedScope | null>,
  mutate?: 'wrong_value' | 'wrong_unit',
): GradeInput {
  const lines: string[] = [];
  for (const f of facts) {
    const lens = f.lenses.find((l) => l.value && l.value.items.length);
    if (!lens) continue;
    const tag = f.lenses.length > 1 && lens.keywords.length ? ` (${lens.keywords[0]})` : '';
    const items = lens.value!.items.map((alts, i) => {
      const v = alts[0];
      if (typeof v !== 'number') return mutate === 'wrong_value' ? `Entidade Inexistente ${i + 1}` : String(v);
      const base = f.absolute ? Math.abs(v) : v;
      if (mutate === 'wrong_unit' && lens.kind === 'ratio') return `${base.toFixed(4)}%`;
      if (mutate === 'wrong_unit' && lens.kind === 'pct') return `${(base / 100).toFixed(4)}%`;
      // Zero ×1,07 continua zero: o errado precisa sair do lugar de verdade.
      const wrong = (base === 0 ? 1 : base * 1.07) + (lens.kind === 'int' ? 3 : 0);
      return formatFor(lens.kind, mutate === 'wrong_value' ? wrong : base);
    });
    lines.push(`- ${f.label}${tag}: ${items.join(', ')}.`);
  }
  if (spec.direction) {
    const want = 'expected' in spec.direction
      ? spec.direction.expected
      : (() => {
          const label = (spec.direction as { fact: string }).fact;
          const e = numericValue(facts.find((x) => x.label === label)?.lenses.find((l) => l.value)?.value);
          return e != null && e < 0 ? 'down' : 'up';
        })();
    lines.unshift(want === 'down' ? 'A receita caiu no período.' : 'A receita subiu no período.');
  }
  if (spec.unavailable) lines.push('Esse dado não está disponível no dashboard: não temos rastreamento de visitantes nem de mídia paga.');
  lines.push(...(spec.oracle ?? []));
  const calls: GradedCall[] = (spec.tools ?? []).map((t, i) => ({ name: t.anyOf[0], input: {}, applied: expectedArgs[i] ?? {} }));
  const citations = spec.citations?.required ? [{ title: spec.citations.titlePattern ?? 'documento da base', source: 'kb:oracle' }] : [];
  return {
    spec,
    turnStatus: 'ok',
    text: lines.join('\n'),
    blocks: null,
    citations,
    calls,
    rounds: 1,
    inputTokens: 0,
    facts,
    expectedArgs,
  };
}

/** Resposta nula ("Não sei.") — nunca pode aprovar. */
export function nullInput(spec: GoldenCase, facts: FactExpectation[], expectedArgs: Array<AppliedScope | null>): GradeInput {
  return { spec, turnStatus: 'ok', text: 'Não sei.', blocks: null, citations: [], calls: [], rounds: 1, inputTokens: 0, facts, expectedArgs };
}
