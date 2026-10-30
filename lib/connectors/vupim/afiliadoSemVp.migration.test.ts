// Migração 20261030220000_vupim_afiliado_sem_vp no Postgres embutido: marca
// de recuperação feita com o ID do painel (VP…) passa pra conta que recebe as
// vendas; conta ainda sem venda só perde o "VP".
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { migratedPglite } from '../../test/pgliteDb';

const MIGRATION = fs.readFileSync(
  path.resolve(__dirname, '../../../prisma/migrations/20261030220000_vupim_afiliado_sem_vp/migration.sql'),
  'utf8',
);

const ID = 'Q7xLmN2pR4sT6uV8wY0zA1bC3dE5fG7h';
const OUTRO = 'Hk3mP9qW2eR5tY8uI1oA4sD7fG0jK6lZ';

describe('migração: afiliado Vupim sem o VP do painel', () => {
  it('marca vai pra conta que vende; sem venda só tira o VP; o resto não muda', async () => {
    const db = await migratedPglite({ extensions: false });
    try {
      await db.exec(`
        INSERT INTO "Platform" (id, slug, "displayName") VALUES ('p_vp','vupim','Vupim'), ('p_jvz','jvzoo','JVZoo');
        INSERT INTO "Affiliate" (id, "platformId", "externalId", nickname, "firstSeenAt") VALUES
          ('a_vp',    'p_vp',  'VP${ID}',    'Bkdnorth',   '2026-10-30T12:00:00Z'), -- cadastrada pelo formulário
          ('a_certa', 'p_vp',  '${ID}',      'Bkd North',  '2026-10-30T15:00:00Z'), -- a que recebe as vendas
          ('a_nova',  'p_vp',  'VP${OUTRO}', 'Parceiro',   '2026-10-30T12:00:00Z'), -- ainda não vendeu
          ('a_jvz',   'p_jvz', 'VP${ID}',    'Outra',      '2026-10-30T12:00:00Z'); -- outra plataforma: intocada
        INSERT INTO "RecoveryAffiliate" (id, "affiliateId", "commissionPct", note, "updatedAt") VALUES
          ('r1', 'a_vp', 0.25, 'Bkdnorth', now()), ('r2', 'a_nova', 0.30, 'Parceiro', now()), ('r3', 'a_jvz', 0.1, null, now());
      `);
      await db.exec(MIGRATION);
      await db.exec(MIGRATION); // roda de novo sem estragar nada

      const recs = await db.query<{ id: string; affiliateId: string; note: string | null }>(
        `SELECT id, "affiliateId", note FROM "RecoveryAffiliate" ORDER BY id`,
      );
      expect(recs.rows.map((r) => [r.id, r.affiliateId, r.note])).toEqual([
        ['r1', 'a_certa', 'Bkdnorth'], ['r2', 'a_nova', 'Parceiro'], ['r3', 'a_jvz', null],
      ]);
      const affs = await db.query<{ id: string; externalId: string }>(`SELECT id, "externalId" FROM "Affiliate" ORDER BY id`);
      expect(Object.fromEntries(affs.rows.map((a) => [a.id, a.externalId]))).toEqual({
        a_certa: ID, a_jvz: `VP${ID}`, a_nova: OUTRO, a_vp: `VP${ID}`,
      });
    } finally {
      await db.close();
    }
  }, 60_000);
});
