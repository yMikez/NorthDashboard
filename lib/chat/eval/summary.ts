// Resumo de uma rodada do eval — puro, a partir dos registros por
// (caso, repetição). Regras que evitam conclusão errada:
//   - taxa de acerto só sobre respostas AVALIADAS (pass/partial/fail):
//     erro de infra, truncamento, recusa e dado que mexeu no meio
//     (inconclusive) aparecem contados à parte, nunca como zero;
//   - intervalo de Wilson 95%: com ~30 casos × 3 repetições a margem é de
//     ±10 pp — diferença menor que isso entre dois prompts é ruído;
//   - "flaky" = caso que passa em algumas repetições e não em outras.

import type { CaseStatus, CheckResult } from './grader';

export interface EvalRecord {
  caseId: string;
  category: string;
  rep: number;
  status: CaseStatus;
  score: number;
  checks: CheckResult[];
  costUsd: number | null;
  latencyMs: number;
  rounds: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  faithfulness: number | null;
  firstFactAt: number | null;
  error?: string;
}

export interface RateWithCi {
  n: number;
  pass: number;
  rate: number | null;
  ci: [number, number] | null;
}

export interface EvalSummary {
  results: number;
  statusCounts: Record<CaseStatus, number>;
  /** pass ÷ (pass + partial + fail). */
  passRate: RateWithCi;
  /** (pass + partial) ÷ avaliadas — número certo, com algum defeito de forma. */
  acceptableRate: RateWithCi;
  meanScore: number | null;
  byCategory: Record<string, RateWithCi & { partial: number; fail: number }>;
  /** Por família de checagem (prefixo antes de ':'): fact, unit, args, hedge… */
  checks: Record<string, { n: number; pass: number; fail: number; lensMismatch: number; rate: number | null }>;
  lensMismatchRate: number | null;
  unitFailRate: number | null;
  falseDenialRate: number | null;
  faithfulness: number | null;
  /** Fração dos casos com fato cujo primeiro número certo vem nos primeiros 300 caracteres. */
  directness: number | null;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  cacheHitRatio: number | null;
  costUsd: number;
  costPerPass: number | null;
  latencyP50: number | null;
  latencyP95: number | null;
  flaky: string[];
  failures: Array<{ caseId: string; rep: number; status: CaseStatus; failed: string[] }>;
}

const Z = 1.96;

/** Intervalo de Wilson 95% (bom com n pequeno e p perto de 0/1). */
export function wilson(pass: number, n: number): [number, number] | null {
  if (n <= 0) return null;
  const p = pass / n;
  const denom = 1 + (Z * Z) / n;
  const center = (p + (Z * Z) / (2 * n)) / denom;
  const half = (Z * Math.sqrt((p * (1 - p)) / n + (Z * Z) / (4 * n * n))) / denom;
  const r = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 1000) / 1000;
  return [r(center - half), r(center + half)];
}

/** Percentil com interpolação linear (mesma regra do percentile_cont do Postgres). */
export function percentile(values: number[], p: number): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const pos = (xs.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo);
}

function rate(pass: number, n: number): RateWithCi {
  return { n, pass, rate: n ? Math.round((pass / n) * 1000) / 1000 : null, ci: wilson(pass, n) };
}

const GRADED: ReadonlySet<CaseStatus> = new Set(['pass', 'partial', 'fail']);

export function summarizeResults(records: EvalRecord[]): EvalSummary {
  const statusCounts = { pass: 0, partial: 0, fail: 0, inconclusive: 0, truncated: 0, refusal: 0, error: 0 } as Record<CaseStatus, number>;
  for (const r of records) statusCounts[r.status] += 1;
  const graded = records.filter((r) => GRADED.has(r.status));

  const byCategory: EvalSummary['byCategory'] = {};
  for (const r of graded) {
    const c = byCategory[r.category] ?? { ...rate(0, 0), partial: 0, fail: 0 };
    c.n += 1;
    if (r.status === 'pass') c.pass += 1;
    if (r.status === 'partial') c.partial += 1;
    if (r.status === 'fail') c.fail += 1;
    byCategory[r.category] = c;
  }
  for (const [k, c] of Object.entries(byCategory)) byCategory[k] = { ...c, ...rate(c.pass, c.n) };

  const checks: EvalSummary['checks'] = {};
  for (const r of graded) {
    for (const ch of r.checks) {
      if (ch.status === 'skip' || ch.status === 'inconclusive') continue;
      const fam = ch.id.split(':')[0];
      const c = checks[fam] ?? { n: 0, pass: 0, fail: 0, lensMismatch: 0, rate: null };
      c.n += 1;
      if (ch.status === 'pass') c.pass += 1;
      else if (ch.status === 'lens_mismatch') c.lensMismatch += 1;
      else c.fail += 1;
      checks[fam] = c;
    }
  }
  for (const c of Object.values(checks)) c.rate = c.n ? Math.round((c.pass / c.n) * 1000) / 1000 : null;

  const share = (fam: string, pred: (c: CheckResult) => boolean): number | null => {
    const all = graded.flatMap((r) => r.checks.filter((c) => c.id.split(':')[0] === fam && c.status !== 'skip' && c.status !== 'inconclusive'));
    return all.length ? Math.round((all.filter(pred).length / all.length) * 1000) / 1000 : null;
  };

  const faith = graded.map((r) => r.faithfulness).filter((v): v is number => v != null);
  const withFacts = graded.filter((r) => r.checks.some((c) => c.id.startsWith('fact:')));
  const tokens = records.reduce(
    (t, r) => ({ input: t.input + r.inputTokens, output: t.output + r.outputTokens, cacheRead: t.cacheRead + r.cacheReadTokens, cacheWrite: t.cacheWrite + r.cacheWriteTokens }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  );
  const inTotal = tokens.input + tokens.cacheRead + tokens.cacheWrite;
  const costUsd = Math.round(records.reduce((n, r) => n + (r.costUsd ?? 0), 0) * 10_000) / 10_000;

  // Flaky: mesmo caso com resultados diferentes entre repetições avaliadas.
  const perCase = new Map<string, Set<boolean>>();
  for (const r of graded) {
    const s = perCase.get(r.caseId) ?? new Set<boolean>();
    s.add(r.status === 'pass');
    perCase.set(r.caseId, s);
  }

  const latencies = records.filter((r) => r.status !== 'error').map((r) => r.latencyMs);
  return {
    results: records.length,
    statusCounts,
    passRate: rate(statusCounts.pass, graded.length),
    acceptableRate: rate(statusCounts.pass + statusCounts.partial, graded.length),
    meanScore: graded.length ? Math.round((graded.reduce((n, r) => n + r.score, 0) / graded.length) * 1000) / 1000 : null,
    byCategory,
    checks,
    lensMismatchRate: share('fact', (c) => c.status === 'lens_mismatch'),
    unitFailRate: share('unit', (c) => c.status === 'fail'),
    falseDenialRate: share('false_denial', (c) => c.status === 'fail'),
    faithfulness: faith.length ? Math.round((faith.reduce((a, b) => a + b, 0) / faith.length) * 1000) / 1000 : null,
    directness: withFacts.length
      ? Math.round((withFacts.filter((r) => r.firstFactAt != null && r.firstFactAt <= 300).length / withFacts.length) * 1000) / 1000
      : null,
    tokens,
    cacheHitRatio: inTotal ? Math.round((tokens.cacheRead / inTotal) * 1000) / 1000 : null,
    costUsd,
    costPerPass: statusCounts.pass ? Math.round((costUsd / statusCounts.pass) * 10_000) / 10_000 : null,
    latencyP50: percentile(latencies, 0.5),
    latencyP95: percentile(latencies, 0.95),
    flaky: [...perCase.entries()].filter(([, s]) => s.size > 1).map(([id]) => id).sort(),
    failures: records
      .filter((r) => r.status !== 'pass')
      .slice(0, 80)
      .map((r) => ({
        caseId: r.caseId,
        rep: r.rep,
        status: r.status,
        failed: r.error ? [r.error] : r.checks.filter((c) => c.status === 'fail' || c.status === 'lens_mismatch').map((c) => (c.detail ? `${c.id}: ${c.detail}` : c.id)),
      })),
  };
}
