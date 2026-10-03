// Migração 20261006130000_gelazen_jvzoo_up02 no Postgres embutido: Gelazen
// na JVZoo (cross-sell do funil GlycoEden) sai do slot 1 e vai pro slot 2
// (step 3). Só sobe o que está abaixo de 3, só JVZoo, só não verificado.
import fs from 'node:fs';
import path from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { migratedPglite } from '../test/pgliteDb';

const MIGRATION = fs.readFileSync(
  path.resolve(__dirname, '../../prisma/migrations/20261006130000_gelazen_jvzoo_up02/migration.sql'),
  'utf8',
);

/** Insere preenchendo as colunas NOT NULL sem default com valor neutro do tipo. */
async function insert(db: PGlite, table: string, values: Record<string, unknown>) {
  const cols = await db.query<{ column_name: string; data_type: string; udt_name: string }>(
    `SELECT column_name, data_type, udt_name FROM information_schema.columns
      WHERE table_name = $1 AND is_nullable = 'NO' AND column_default IS NULL`,
    [table],
  );
  const row: Record<string, unknown> = { ...values };
  for (const c of cols.rows) {
    if (c.column_name in row) continue;
    if (c.data_type === 'USER-DEFINED') {
      const e = await db.query<{ enumlabel: string }>(
        `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = $1 ORDER BY e.enumsortorder LIMIT 1`,
        [c.udt_name],
      );
      row[c.column_name] = e.rows[0]?.enumlabel;
    } else if (/char|text/.test(c.data_type)) row[c.column_name] = `x-${c.column_name}`;
    else if (/numeric|integer|bigint|double|real|smallint/.test(c.data_type)) row[c.column_name] = 0;
    else if (c.data_type === 'boolean') row[c.column_name] = false;
    else if (/timestamp|date/.test(c.data_type)) row[c.column_name] = new Date('2026-10-01T12:00:00Z');
    else if (/json/.test(c.data_type)) row[c.column_name] = '{}';
    else if (c.data_type === 'ARRAY') row[c.column_name] = '{}';
  }
  const keys = Object.keys(row);
  await db.query(
    `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`,
    keys.map((k) => row[k]),
  );
}

describe('migração: Gelazen JVZoo no slot 2 (Up02/Down02)', () => {
  let db: PGlite;
  const step = async (id: string) => (await db.query<{ s: number | null }>(`SELECT "funnelStep" AS s FROM "Order" WHERE id = $1`, [id])).rows[0].s;
  const pstep = async (id: string) => (await db.query<{ s: number | null }>(`SELECT "funnelStep" AS s FROM "Product" WHERE id = $1`, [id])).rows[0].s;

  beforeAll(async () => {
    db = await migratedPglite();
    await insert(db, 'Platform', { id: 'jv', slug: 'jvzoo' });
    await insert(db, 'Platform', { id: 'bg', slug: 'buygoods' });
    const prod = (id: string, platformId: string, name: string, productType: string, funnelStep: number, verified = false) =>
      insert(db, 'Product', { id, platformId, externalId: id, name, family: id === 'glyco' ? 'GlycoEden' : 'Gelazen', productType, funnelStep, verified });
    await prod('gel6', 'jv', 'Gelazen 6 Bottles (Upgrade)', 'UPSELL', 2);
    await prod('gel3lc', 'jv', 'Gelazen 3 Bottles (Last Chance)', 'DOWNSELL', 2);
    await prod('gelver', 'jv', 'Gelazen 9 Bottles (Upgrade)', 'UPSELL', 2, true); // verificado: etapa explícita manda
    await prod('gelbg', 'bg', 'Gelazen 9 Bottles (Upgrade)', 'UPSELL', 2);        // BuyGoods: fora
    await prod('glyco', 'jv', 'Glyco Eden 12 Bottles (Upgrade)', 'UPSELL', 2);   // outra família: fora
    const ord = (id: string, platformId: string, productId: string, productType: string, funnelStep: number) =>
      insert(db, 'Order', { id, platformId, productId, externalId: id, productType, funnelStep, grossAmountUsd: 100, status: 'APPROVED', orderedAt: new Date('2026-10-02T12:00:00Z') });
    await ord('o_up_s2', 'jv', 'gel6', 'UPSELL', 2);   // recusou o 12B e comprou o Gelazen → era "Up01"
    await ord('o_up_s4', 'jv', 'gel6', 'UPSELL', 4);   // posição 4 já passa da âncora: fica
    await ord('o_lc_s2', 'jv', 'gel3lc', 'DOWNSELL', 2);
    await ord('o_ver', 'jv', 'gelver', 'UPSELL', 2);
    await ord('o_bg', 'bg', 'gelbg', 'UPSELL', 2);
    await ord('o_glyco', 'jv', 'glyco', 'UPSELL', 2);
    await db.exec(MIGRATION);
  }, 120_000);

  it('Gelazen JVZoo não verificado: Upgrade e Last Chance abaixo do slot 2 sobem pra step 3', async () => {
    expect(await step('o_up_s2')).toBe(3);
    expect(await step('o_lc_s2')).toBe(3);
    expect(await pstep('gel6')).toBe(3);
    expect(await pstep('gel3lc')).toBe(3);
  });

  it('não mexe no que já está acima, no verificado, na BuyGoods nem em outra família', async () => {
    expect(await step('o_up_s4')).toBe(4);
    expect(await step('o_ver')).toBe(2);
    expect(await step('o_bg')).toBe(2);
    expect(await step('o_glyco')).toBe(2);
    expect(await pstep('gelver')).toBe(2);
  });

  it('idempotente: rodar de novo não muda nada', async () => {
    await db.exec(MIGRATION);
    expect(await step('o_up_s2')).toBe(3);
    expect(await step('o_up_s4')).toBe(4);
  });
});
