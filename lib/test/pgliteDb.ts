// Postgres embutido (PGlite) com TODAS as migrações aplicadas — pros testes
// de SQL cru (busca do RAG, agregações) sem Docker. Só em teste (vitest).
//
//   const db = await migratedPglite();              // com pg_trgm + unaccent
//   const db = await migratedPglite({ extensions: false }); // simula produção sem contrib
//
// Prisma não roda aqui: teste a SQL gerada (Prisma.sql → .sql/.values) com
// db.query(sql, values).

import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../prisma/migrations');

export async function migratedPglite(opts: { extensions?: boolean } = {}): Promise<PGlite> {
  const db = opts.extensions === false ? new PGlite() : new PGlite({ extensions: { pg_trgm, unaccent } });
  const dirs = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((d) => fs.statSync(path.join(MIGRATIONS_DIR, d)).isDirectory())
    .sort();
  for (const d of dirs) {
    await db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, d, 'migration.sql'), 'utf8'));
  }
  return db;
}
