// Monta o schema `painel` (leitura das métricas sobre os dados oficiais).
// Regras em lib/painel/ddl.ts.
//
//   npx tsx scripts/painelSchema.ts            → imprime o SQL que seria aplicado (não mexe no banco)
//   npx tsx scripts/painelSchema.ts --apply    → aplica (só se mudou; --force refaz mesmo igual)
//   npx tsx scripts/painelSchema.ts --boot     → passo do boot do container (Dockerfile):
//        só age com METRICS_SOURCE=oficial; se der certo, grava o arquivo de
//        "painel pronto" que o lib/db.ts exige antes de ligar a leitura oficial.
//
// Opções por ambiente: PAINEL_SESSAO=oficial (sessão do funil do Douglas),
// PAINEL_TEMPO_REAL=0 (sem completar com o IPN depois da última carga).

import fs from 'node:fs';
import { db, PAINEL_READY_FILE } from '../lib/db';
import { painelOptionsFromEnv, planPainel, syncPainel, type SqlRunner } from '../lib/painel/sync';

const prismaRunner: SqlRunner = {
  query: (sql) => db.$queryRawUnsafe(sql),
  transaction: async (statements) => {
    await db.$transaction(async (tx) => {
      for (const s of statements) await tx.$executeRawUnsafe(s);
    }, { maxWait: 30_000, timeout: 15 * 60_000 });
  },
};

async function main() {
  const args = new Set(process.argv.slice(2));
  const opts = painelOptionsFromEnv();

  if (args.has('--boot')) {
    try { fs.rmSync(PAINEL_READY_FILE, { force: true }); } catch { /* sem permissão: segue */ }
    if (process.env.METRICS_SOURCE !== 'oficial') {
      console.log('[painel] METRICS_SOURCE != oficial — nada a fazer.');
      return;
    }
  }

  if (args.has('--apply') || args.has('--boot')) {
    const r = await syncPainel(prismaRunner, { force: args.has('--force'), opts });
    console.log(`[painel] ${r.changed ? 'montado' : 'sem mudança'} (hash ${r.hash}, ${r.statements} comandos, ${r.ms} ms)`);
    if (args.has('--boot')) fs.writeFileSync(PAINEL_READY_FILE, `${r.hash}\n`);
    return;
  }

  const { statements, hash } = await planPainel(prismaRunner, opts);
  console.log(`-- schema painel · hash ${hash} · ${statements.length} comandos · opções ${JSON.stringify(opts)}`);
  console.log('BEGIN;');
  for (const s of statements) console.log(`${s};\n`);
  console.log('-- troca pelo painel em uso: ver swapSql() em lib/painel/ddl.ts');
  console.log('ROLLBACK;');
}

main()
  .catch((err) => {
    console.error('[painel] falhou:', err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
