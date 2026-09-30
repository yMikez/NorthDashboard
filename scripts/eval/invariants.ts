// Invariantes entre tools do chat — sem LLM, segundos, custo zero.
// O mesmo número visto por dois caminhos tem que bater; quando não bate, a
// camada de tools discorda de si mesma e o eval não pode culpar o modelo.
// Regras em lib/chat/eval/invariants.ts.
//
// Uso:
//   npx tsx scripts/eval/invariants.ts                          # mês passado (BRT)
//   npx tsx scripts/eval/invariants.ts --from=2026-08-01 --to=2026-08-31 [--tol=0.005]
// Saída 1 quando algum invariante (não informativo) diverge além da tolerância.

import { db } from '../../lib/db';
import { executeTool, type ToolInput } from '../../lib/services/aiTools';
import { runInvariants } from '../../lib/chat/eval/invariants';
import { resolveDate } from '../../lib/chat/eval/spec';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function flag(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function main(): Promise<number> {
  const now = new Date();
  const start = flag('from') ?? resolveDate('$pmstart', now);
  const end = flag('to') ?? resolveDate('$pmend', now);
  if (!DAY.test(start) || !DAY.test(end) || start > end) throw new Error('use --from=YYYY-MM-DD --to=YYYY-MM-DD (from ≤ to)');
  const tol = flag('tol') !== undefined ? Number(flag('tol')) : undefined;
  if (tol !== undefined && !(tol > 0 && tol < 1)) throw new Error('--tol é fração (0.005 = 0,5%)');

  const ctx = { user: { id: 'eval', role: 'ADMIN', allowedTabs: [] as string[] }, now };
  const results = await runInvariants((tool, args) => executeTool(tool, args as ToolInput, ctx), { start_date: start, end_date: end }, { tol });

  console.log(`Invariantes ${start} → ${end}\n`);
  for (const r of results) {
    const diff = r.maxRelDiff == null ? '—' : `${(r.maxRelDiff * 100).toFixed(2)}%`;
    const mark = r.status === 'ok' ? '✓' : r.status === 'info' ? 'i' : '✗';
    console.log(`${mark} ${r.id.padEnd(22)} ${r.status.padEnd(5)} dif. máx ${diff.padStart(8)}  ${r.title}`);
    if (r.detail) console.log(`    ${r.detail}`);
    for (const [k, v] of Object.entries(r.values)) console.log(`    ${k.padEnd(40)} ${v == null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
  }
  const broken = results.filter((r) => r.status === 'diff' || r.status === 'error');
  console.log(broken.length ? `\n✗ ${broken.length} invariante(s) divergente(s)/com erro` : '\n✓ tools consistentes entre si');
  return broken.length ? 1 : 0;
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
