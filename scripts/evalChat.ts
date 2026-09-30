// Eval do chat IA pela linha de comando — o mesmo runner do endpoint admin.
//
// Uso (DATABASE_URL + ANTHROPIC_API_KEY; em prod dentro do container:
//   docker exec dashboard-app node_modules/.bin/tsx scripts/evalChat.ts …):
//
//   npx tsx scripts/evalChat.ts                       # todos os casos, 1 repetição, modelo/esforço do .env
//   npx tsx scripts/evalChat.ts --cases=G01,G13 --reps=3
//   npx tsx scripts/evalChat.ts --category=lente,unidade --model=claude-opus-5-5 --effort=medium
//   npx tsx scripts/evalChat.ts --knowledge=off       # ablação da base fixa
//   npx tsx scripts/evalChat.ts --dry                 # só os valores esperados (sem LLM, custo zero)
//   npx tsx scripts/evalChat.ts --selftest            # oráculo/nulo/errado contra o grader (sem LLM)
//   (consistência entre tools, sem LLM: npx tsx scripts/eval/invariants.ts)
//   … --persist (grava ChatEvalRun/Result, aparece no painel) · --out=tmp/evals (results.jsonl + summary.json)
//   … --concurrency=2 --max-usd=15 --role=ADMIN|MEMBER
//
// Rode primeiro --dry e um smoke de 2–3 casos pra medir o custo real por caso
// antes da rodada completa. Saída 1 quando a rodada falha ou o selftest acusa.

import fs from 'node:fs';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { db } from '../lib/db';
import {
  computeCaseExpectations,
  loadEvalCases,
  normalizeEvalConfig,
  runEvalSuite,
  selectCases,
  type CaseOutcome,
  type EvalConfigInput,
} from '../lib/services/chatEval';
import { currentPromptVersion } from '../lib/services/chatTelemetry';
import { gradeAnswer, nullInput, oracleInput } from '../lib/chat/eval/grader';
import type { GoldenCase } from '../lib/chat/eval/spec';

type Flags = Record<string, string | true>;

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {};
  for (const a of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (!m) throw new Error(`argumento inválido: ${a}`);
    flags[m[1]] = m[2] ?? true;
  }
  return flags;
}

const str = (v: string | true | undefined) => (typeof v === 'string' ? v : undefined);
const list = (v: string | true | undefined) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined);
const num = (v: string | true | undefined) => (typeof v === 'string' ? Number(v) : undefined);

function table(rows: string[][]): string {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] ?? '').length)));
  return rows.map((r) => r.map((c, i) => (c ?? '').padEnd(widths[i])).join('  ')).join('\n');
}

const fmtUsd = (v: number | null | undefined) => (v == null ? '—' : `$${v.toFixed(4)}`);
const fmtPct = (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);

function preview(v: unknown): string {
  const s = JSON.stringify(v);
  return s.length > 90 ? `${s.slice(0, 87)}…` : s;
}

async function selected(flags: Flags): Promise<GoldenCase[]> {
  const { selected: cases, unknown } = selectCases(await loadEvalCases(), { cases: list(flags.cases) ?? [], categories: list(flags.category) ?? [] });
  if (unknown.length) throw new Error(`casos desconhecidos: ${unknown.join(', ')}`);
  return cases;
}

async function dry(flags: Flags): Promise<number> {
  const role = str(flags.role) === 'MEMBER' ? 'MEMBER' : 'ADMIN';
  const rows: string[][] = [['caso', 'fato', 'lente', 'valor esperado']];
  let broken = 0;
  for (const spec of await selected(flags)) {
    const exp = await computeCaseExpectations(spec, role);
    if (!exp.facts.length) rows.push([spec.id, '—', '—', spec.unavailable ? '(indisponível: sem número)' : '(sem fato numérico)']);
    for (const f of exp.facts) {
      for (const l of f.lenses) {
        if (!l.value) broken += 1;
        rows.push([spec.id, f.label, l.name, l.value ? preview(l.value.items.length === 1 ? l.value.items[0] : l.value.items) : `ERRO ${l.error}`]);
      }
    }
  }
  console.log(table(rows));
  console.log(`\n${broken ? `⚠ ${broken} lente(s) sem valor — confira tool/caminho` : '✓ todas as lentes resolveram'}`);
  return 0;
}

async function selftest(flags: Flags): Promise<number> {
  const rows: string[][] = [['caso', 'oráculo', 'nulo', 'valor errado', 'unidade errada']];
  let violations = 0;
  for (const spec of await selected(flags)) {
    const exp = await computeCaseExpectations(spec);
    const oracle = gradeAnswer(oracleInput(spec, exp.facts, exp.expectedArgs));
    const nul = gradeAnswer(nullInput(spec, exp.facts, exp.expectedArgs));
    const hasFacts = exp.facts.some((f) => f.lenses.some((l) => l.value));
    const wrong = hasFacts ? gradeAnswer(oracleInput(spec, exp.facts, exp.expectedArgs, 'wrong_value')) : null;
    // Escala errada de zero ainda é zero: só testa unidade com taxa ≠ 0.
    const pctFacts = exp.facts.some((f) => {
      const lens = f.lenses.find((l) => l.value && l.value.items.length);
      const v = lens?.value?.items[0]?.[0];
      return !!lens && (lens.kind === 'ratio' || lens.kind === 'pct') && typeof v === 'number' && v !== 0;
    });
    const unit = pctFacts ? gradeAnswer(oracleInput(spec, exp.facts, exp.expectedArgs, 'wrong_unit')) : null;
    const bad = [
      oracle.status !== 'pass',
      nul.status === 'pass',
      !!wrong && wrong.status === 'pass',
      !!unit && unit.checks.find((c) => c.id === 'unit')?.status !== 'fail',
    ];
    violations += bad.filter(Boolean).length;
    const why = (g: typeof oracle) => g.checks.filter((c) => c.status !== 'pass' && c.status !== 'skip').map((c) => c.id).join(',');
    rows.push([
      spec.id,
      oracle.status === 'pass' ? 'ok' : `✗ ${oracle.status} (${why(oracle)})`,
      nul.status === 'pass' ? '✗ passou' : `ok (${nul.status})`,
      wrong ? (wrong.status === 'pass' ? '✗ passou' : `ok (${wrong.status})`) : '—',
      unit ? (bad[3] ? '✗ unidade não acusada' : 'ok') : '—',
    ]);
  }
  console.log(table(rows));
  console.log(violations ? `\n✗ ${violations} violação(ões) — grader ou caso precisa de ajuste` : '\n✓ selftest ok');
  return violations ? 1 : 0;
}

function outcomeRow(o: CaseOutcome): string[] {
  const failed = o.record.error
    ? [o.record.error]
    : o.record.checks.filter((c) => c.status === 'fail' || c.status === 'lens_mismatch' || c.status === 'inconclusive').map((c) => c.id);
  return [
    o.record.caseId,
    o.record.category,
    String(o.record.rep),
    o.record.status,
    o.record.score.toFixed(2),
    fmtUsd(o.usage.costUsd),
    `${(o.record.latencyMs / 1000).toFixed(1)}s`,
    String(o.usage.rounds),
    failed.join(', ').slice(0, 80),
  ];
}

async function run(flags: Flags): Promise<number> {
  const input: EvalConfigInput = {
    model: str(flags.model),
    effort: str(flags.effort) as EvalConfigInput['effort'],
    cases: list(flags.cases),
    categories: list(flags.category),
    reps: num(flags.reps),
    knowledge: str(flags.knowledge) as EvalConfigInput['knowledge'],
    concurrency: num(flags.concurrency),
    maxUsd: num(flags['max-usd']),
    role: str(flags.role) as EvalConfigInput['role'],
  };
  const cfg = normalizeEvalConfig(input);
  if (!cfg.ok) throw new Error(cfg.error);
  const config = cfg.value;

  let runId: string | null = null;
  if (flags.persist) {
    const row = await db.chatEvalRun.create({
      data: { status: 'running', trigger: 'cli', createdBy: null, config: { ...config, promptVersion: currentPromptVersion() } as unknown as Prisma.InputJsonValue },
      select: { id: true },
    });
    runId = row.id;
  }
  console.log(`eval: ${config.model} @ ${config.effort} · reps=${config.reps} · knowledge=${config.knowledge} · prompt ${currentPromptVersion()}${runId ? ` · run ${runId}` : ''}\n`);

  const header = ['caso', 'cat', 'rep', 'status', 'nota', 'custo', 'tempo', 'rod', 'falhas'];
  try {
    const { summary, outcomes } = await runEvalSuite(config, {
      runId,
      onOutcome: (o) => console.log(outcomeRow(o).join(' · ')),
    });
    if (runId) {
      await db.chatEvalRun.update({ where: { id: runId }, data: { status: 'done', summary: summary as unknown as Prisma.InputJsonValue, costUsd: summary.costUsd, finishedAt: new Date() } });
    }
    console.log(`\n${table([header, ...outcomes.map(outcomeRow)])}\n`);
    const s = summary;
    console.log(table([
      ['métrica', 'valor'],
      ['avaliadas (pass/partial/fail)', `${s.passRate.n} (${s.statusCounts.pass}/${s.statusCounts.partial}/${s.statusCounts.fail})`],
      ['taxa de acerto', `${fmtPct(s.passRate.rate)}  IC95 ${s.passRate.ci ? `${fmtPct(s.passRate.ci[0])}–${fmtPct(s.passRate.ci[1])}` : '—'}`],
      ['aceitável (pass+partial)', fmtPct(s.acceptableRate.rate)],
      ['inconclusivo / truncado / recusa / erro', `${s.statusCounts.inconclusive} / ${s.statusCounts.truncated} / ${s.statusCounts.refusal} / ${s.statusCounts.error}`],
      ['lente trocada · unidade · falsa negativa', `${fmtPct(s.lensMismatchRate)} · ${fmtPct(s.unitFailRate)} · ${fmtPct(s.falseDenialRate)}`],
      ['fidelidade · assertividade (≤300 chars)', `${fmtPct(s.faithfulness)} · ${fmtPct(s.directness)}`],
      ['cache hit', fmtPct(s.cacheHitRatio)],
      ['custo total · por acerto', `${fmtUsd(s.costUsd)} · ${fmtUsd(s.costPerPass)}`],
      ['latência p50 · p95', `${s.latencyP50 == null ? '—' : `${(s.latencyP50 / 1000).toFixed(1)}s`} · ${s.latencyP95 == null ? '—' : `${(s.latencyP95 / 1000).toFixed(1)}s`}`],
      ['flaky', s.flaky.join(', ') || '—'],
      ['pulados', s.skipped.map((x) => `${x.caseId} (${x.reason})`).join('; ') || '—'],
      ['parada antecipada', s.aborted ?? '—'],
    ]));
    const out = str(flags.out);
    if (out) {
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, 'results.jsonl'), outcomes.map((o) => JSON.stringify(o)).join('\n') + '\n');
      fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
      console.log(`\narquivos em ${out}/`);
    }
    return 0;
  } catch (err) {
    if (runId) {
      await db.chatEvalRun.update({ where: { id: runId }, data: { status: 'failed', finishedAt: new Date(), summary: { error: err instanceof Error ? err.message : String(err) } } });
    }
    throw err;
  }
}

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.dry) return dry(flags);
  if (flags.selftest) return selftest(flags);
  return run(flags);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
